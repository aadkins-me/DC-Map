// Pure validation and board logic for the shared notes board, kept free of Netlify imports so it can be tested directly.

export const BOARD_ID_RE = /^[A-Za-z0-9_-]{22,64}$/;
export const NOTE_ID_RE = /^[A-Za-z0-9_-]{16}$/;
export const LIMITS = {
  text: 500,
  author: 30,
  ref: 60,
  notesPerBoard: 200,
  bodyBytes: 4096,
};
// Same box the map is allowed to pan within.
const BOUNDS = { minLng: -77.6, maxLng: -76.5, minLat: 38.6, maxLat: 39.25 };

export type NoteKind = 'free' | 'pin' | 'hood';

export interface Note {
  id: string;
  author: string;
  text: string;
  lat: number;
  lng: number;
  kind: NoteKind;
  /** Pin label or neighborhood name the note is attached to. */
  ref?: string;
  hoodId?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Board {
  rev: number;
  notes: Note[];
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const emptyBoard = (): Board => ({ rev: 0, notes: [] });

export function isValidBoardId(id: unknown): id is string {
  return typeof id === 'string' && BOARD_ID_RE.test(id);
}

// Strip control characters (keeping newlines in note text) and collapse surrounding whitespace.
function cleanText(value: unknown, max: number, field: string, multiline = false): string {
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text`);
  const stripped = value.replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, '').trim();
  if (!stripped) throw new HttpError(400, `${field} can't be empty`);
  if ([...stripped].length > max) throw new HttpError(400, `${field} is longer than ${max} characters`);
  return stripped;
}

function cleanCoord(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new HttpError(400, `${field} is outside the DC area`);
  return Math.round(value * 1e6) / 1e6;
}

function cleanAttachment(body: Record<string, unknown>): Pick<Note, 'kind' | 'ref' | 'hoodId'> {
  const kind = body.kind ?? 'free';
  if (kind === 'free') return { kind };
  if (kind !== 'pin' && kind !== 'hood') throw new HttpError(400, 'kind must be free, pin or hood');
  const ref = cleanText(body.ref, LIMITS.ref, kind === 'pin' ? 'Pin label' : 'Neighborhood name');
  if (kind === 'pin') return { kind, ref };
  const hoodId = body.hoodId;
  if (typeof hoodId !== 'number' || !Number.isInteger(hoodId) || hoodId < 0 || hoodId > 10000) throw new HttpError(400, 'hoodId must be a neighborhood id');
  return { kind, ref, hoodId };
}

export function parseJsonBody(raw: string): Record<string, unknown> {
  if (new TextEncoder().encode(raw).length > LIMITS.bodyBytes) throw new HttpError(413, 'Request is too large');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Request body must be JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Request body must be a JSON object');
  return body as Record<string, unknown>;
}

export function createNote(board: Board, body: Record<string, unknown>, id: string, now: number): Note {
  if (board.notes.length >= LIMITS.notesPerBoard) throw new HttpError(409, `This board is full (${LIMITS.notesPerBoard} notes). Delete a few to add more.`);
  const note: Note = {
    id,
    author: cleanText(body.author, LIMITS.author, 'Name'),
    text: cleanText(body.text, LIMITS.text, 'Note', true),
    lat: cleanCoord(body.lat, BOUNDS.minLat, BOUNDS.maxLat, 'Latitude'),
    lng: cleanCoord(body.lng, BOUNDS.minLng, BOUNDS.maxLng, 'Longitude'),
    ...cleanAttachment(body),
    createdAt: now,
    updatedAt: now,
  };
  board.notes.push(note);
  board.rev++;
  return note;
}

/** Text and position can change; the author and attachment stay as created. */
export function updateNote(board: Board, id: string, body: Record<string, unknown>, now: number): Note {
  const note = board.notes.find((n) => n.id === id);
  if (!note) throw new HttpError(404, 'That note was deleted');
  if (body.text !== undefined) note.text = cleanText(body.text, LIMITS.text, 'Note', true);
  if (body.lat !== undefined || body.lng !== undefined) {
    note.lat = cleanCoord(body.lat, BOUNDS.minLat, BOUNDS.maxLat, 'Latitude');
    note.lng = cleanCoord(body.lng, BOUNDS.minLng, BOUNDS.maxLng, 'Longitude');
  }
  if (body.ref !== undefined && note.kind !== 'free') note.ref = cleanText(body.ref, LIMITS.ref, 'Label');
  note.updatedAt = now;
  board.rev++;
  return note;
}

export function deleteNote(board: Board, id: string): boolean {
  const before = board.notes.length;
  board.notes = board.notes.filter((n) => n.id !== id);
  if (board.notes.length === before) return false;
  board.rev++;
  return true;
}

export function normalizeBoard(data: unknown): Board {
  const b = data as Partial<Board> | null;
  if (!b || !Array.isArray(b.notes)) return emptyBoard();
  return { rev: Number(b.rev) || 0, notes: b.notes };
}

/** Fixed-window limiter. State is per function instance, so it is a best-effort backstop to the platform rate limit. */
export class RateLimiter {
  private hits = new Map<string, { start: number; count: number }>();
  private limit: number;
  private windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  allow(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      if (this.hits.size > 5000) this.hits.clear();
      this.hits.set(key, { start: now, count: 1 });
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }
}
