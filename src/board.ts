export type NoteKind = 'free' | 'pin' | 'hood';

export interface Note {
  id: string;
  author: string;
  text: string;
  lat: number;
  lng: number;
  kind: NoteKind;
  ref?: string;
  hoodId?: number;
  createdAt: number;
  updatedAt: number;
}

export type NewNote = Pick<Note, 'author' | 'text' | 'lat' | 'lng' | 'kind' | 'ref' | 'hoodId'>;
export type BoardStatus = 'none' | 'connecting' | 'live' | 'offline';

export const NOTE_MAX_LENGTH = 500;
export const AUTHOR_MAX_LENGTH = 30;
const POLL_MS = 10_000;
const TIMEOUT_MS = 8_000;
const API = `${import.meta.env.BASE_URL}api/notes`.replace(/^\.\//, '/');

/** Sticky-note colors, handed out to authors in the order they first wrote on the board. */
export const NOTE_COLORS = [
  { bg: '#fde68a', edge: '#d97706' },
  { bg: '#bae6fd', edge: '#0284c7' },
  { bg: '#fbcfe8', edge: '#db2777' },
  { bg: '#bbf7d0', edge: '#16a34a' },
  { bg: '#ddd6fe', edge: '#7c3aed' },
  { bg: '#fed7aa', edge: '#ea580c' },
];

/** Thrown for server-side rejections (validation, full board) whose message is safe to show. */
export class BoardError extends Error {}

class OfflineError extends Error {}

export class BoardClient {
  boardId: string | null = null;
  notes: Note[] = [];
  status: BoardStatus = 'none';
  private rev = -1;
  private timer: number | undefined;
  private inflight: Promise<void> | null = null;

  private onChange: (notesChanged: boolean) => void;

  constructor(onChange: (notesChanged: boolean) => void) {
    this.onChange = onChange;
    window.addEventListener('focus', () => this.refresh());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.refresh();
    });
  }

  open(boardId: string | null) {
    if (boardId === this.boardId) return;
    window.clearInterval(this.timer);
    this.boardId = boardId;
    this.notes = [];
    this.rev = -1;
    this.status = boardId ? 'connecting' : 'none';
    this.onChange(true);
    if (!boardId) return;
    this.refresh();
    this.timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') this.refresh();
    }, POLL_MS);
  }

  refresh(): Promise<void> {
    if (!this.boardId) return Promise.resolve();
    this.inflight ??= this.load().finally(() => (this.inflight = null));
    return this.inflight;
  }

  async create(note: NewNote): Promise<Note> {
    const res = await this.request<{ note: Note; rev: number }>('POST', '', note);
    this.notes = [...this.notes.filter((n) => n.id !== res.note.id), res.note];
    this.applied(res.rev);
    return res.note;
  }

  async update(id: string, patch: Partial<Pick<Note, 'text' | 'lat' | 'lng' | 'ref'>>): Promise<Note> {
    const res = await this.request<{ note: Note; rev: number }>('PATCH', `/${id}`, patch);
    this.notes = this.notes.map((n) => (n.id === id ? res.note : n));
    this.applied(res.rev);
    return res.note;
  }

  async remove(id: string): Promise<void> {
    const res = await this.request<{ rev: number }>('DELETE', `/${id}`);
    this.notes = this.notes.filter((n) => n.id !== id);
    this.applied(res.rev);
  }

  /** Authors in the order they first wrote on this board; index = color. */
  authorOrder(): string[] {
    return [...new Set([...this.notes].sort((a, b) => a.createdAt - b.createdAt).map((n) => n.author))];
  }

  colorFor(author: string) {
    const order = this.authorOrder();
    const i = order.indexOf(author);
    return NOTE_COLORS[(i === -1 ? order.length : i) % NOTE_COLORS.length];
  }

  private applied(rev: number) {
    this.rev = rev;
    this.setStatus('live', true);
  }

  private async load() {
    const board = this.boardId;
    try {
      const res = await this.request<{ rev: number; notes: Note[] }>('GET', '');
      if (board !== this.boardId) return;
      const changed = res.rev !== this.rev;
      if (changed) {
        this.notes = res.notes;
        this.rev = res.rev;
      }
      this.setStatus('live', changed);
    } catch {
      if (board === this.boardId) this.setStatus('offline', false);
    }
  }

  private setStatus(status: BoardStatus, notesChanged: boolean) {
    const statusChanged = status !== this.status;
    this.status = status;
    if (statusChanged || notesChanged) this.onChange(notesChanged);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.boardId) throw new BoardError('Start a shared board first');
    const ctrl = new AbortController();
    const timeout = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(API + path, {
        method,
        headers: { 'x-board-id': this.boardId, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        cache: 'no-store',
      });
    } catch {
      this.setStatus('offline', false);
      throw new OfflineError("Can't reach the shared board right now");
    } finally {
      window.clearTimeout(timeout);
    }
    // Without Netlify Functions (plain `vite` dev, static hosting) this path serves HTML or 404.
    const isJson = res.headers.get('content-type')?.includes('application/json');
    if (!isJson || res.status === 404 || res.status >= 500) {
      const data = isJson ? await res.json().catch(() => null) : null;
      if (res.status === 404 && data?.error) throw new BoardError(data.error);
      this.setStatus('offline', false);
      throw new OfflineError("Can't reach the shared board right now");
    }
    const data = await res.json();
    if (!res.ok) throw new BoardError(data?.error || 'The board rejected that change');
    return data as T;
  }
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' });
}

export function fullTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
