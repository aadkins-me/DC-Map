import { getStore } from '@netlify/blobs';
import type { Config, Context } from '@netlify/functions';
import { createHash, randomBytes } from 'node:crypto';
import {
  HttpError,
  NOTE_ID_RE,
  RateLimiter,
  createNote,
  deleteNote,
  emptyBoard,
  isValidBoardId,
  normalizeBoard,
  parseJsonBody,
  updateNote,
  type Board,
} from '../lib/board.ts';

// The board ID travels in a header (never the URL) so it stays out of request logs,
// and blobs are keyed by its hash so the store never holds the raw ID either.
const BOARD_HEADER = 'x-board-id';

const readLimiter = new RateLimiter(120, 60_000);
const writeLimiter = new RateLimiter(30, 60_000);

const json = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const boardKey = (boardId: string) => `boards/${createHash('sha256').update(boardId).digest('hex')}`;

async function mutate<T>(key: string, change: (board: Board) => T): Promise<{ board: Board; result: T }> {
  const store = getStore({ name: 'map-notes', consistency: 'strong' });
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await store.getWithMetadata(key, { type: 'json' });
    const board = current ? normalizeBoard(current.data) : emptyBoard();
    const result = change(board);
    // Production Blobs returns an ETag for optimistic locking; the local `netlify dev` emulator does not, so write plainly there.
    const condition = !current ? { onlyIfNew: true } : current.etag ? { onlyIfMatch: current.etag } : {};
    const write = await store.setJSON(key, board, condition);
    if (write.modified) return { board, result };
  }
  throw new HttpError(503, 'The board is busy, please try again');
}

export default async (req: Request, context: Context) => {
  try {
    const boardId = req.headers.get(BOARD_HEADER);
    if (!isValidBoardId(boardId)) throw new HttpError(400, 'Missing or malformed board link');

    const ip = context.ip || 'unknown';
    const isRead = req.method === 'GET';
    if (!(isRead ? readLimiter : writeLimiter).allow(ip)) throw new HttpError(429, 'Too many requests, slow down a little');

    const key = boardKey(boardId);
    const noteId = context.params.id;
    if (noteId !== undefined && !NOTE_ID_RE.test(noteId)) throw new HttpError(400, 'Malformed note id');

    if (req.method === 'GET' && !noteId) {
      const store = getStore({ name: 'map-notes', consistency: 'strong' });
      const board = normalizeBoard(await store.get(key, { type: 'json' }));
      return json(200, board);
    }

    if (req.method === 'POST' && !noteId) {
      const body = parseJsonBody(await req.text());
      const id = randomBytes(12).toString('base64url');
      const { board, result } = await mutate(key, (b) => createNote(b, body, id, Date.now()));
      return json(201, { note: result, rev: board.rev });
    }

    if (req.method === 'PATCH' && noteId) {
      const body = parseJsonBody(await req.text());
      const { board, result } = await mutate(key, (b) => updateNote(b, noteId, body, Date.now()));
      return json(200, { note: result, rev: board.rev });
    }

    if (req.method === 'DELETE' && noteId) {
      const { board } = await mutate(key, (b) => deleteNote(b, noteId));
      return json(200, { rev: board.rev });
    }

    throw new HttpError(405, 'Method not allowed');
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message });
    // Log only the error class, never request details that could include the board ID.
    console.error('notes function failed:', err instanceof Error ? err.name : 'unknown error');
    return json(500, { error: 'Something went wrong on the server' });
  }
};

export const config: Config = {
  path: ['/api/notes', '/api/notes/:id'],
  method: ['GET', 'POST', 'PATCH', 'DELETE'],
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
