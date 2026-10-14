export type LayerKey = 'neighborhoods' | 'labels' | 'metro' | 'landmarks' | 'pins' | 'boundary';
export type BaseKey = 'streets' | 'light' | 'raster';

export const ALL_LAYERS: LayerKey[] = ['neighborhoods', 'labels', 'metro', 'landmarks', 'pins', 'boundary'];
export const DEFAULT_LAYERS: LayerKey[] = ['neighborhoods', 'labels', 'metro', 'landmarks', 'pins', 'boundary'];

export const PIN_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#9333ea', '#ea580c'];

export interface Pin {
  lng: number;
  lat: number;
  color: number;
  label: string;
}

export interface AppState {
  center: [number, number];
  zoom: number;
  base: BaseKey;
  layers: Set<LayerKey>;
  pins: Pin[];
  /** Shared notes board ID, or null when no board is open. */
  board: string | null;
  notesVisible: boolean;
}

export const BOARD_ID_RE = /^[A-Za-z0-9_-]{22,64}$/;

/** 144 random bits, base64url encoded (24 characters). */
export function newBoardId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const DEFAULT_VIEW = { center: [-77.0254, 38.9035] as [number, number], zoom: 12 };

const encodeLabel = (s: string) => encodeURIComponent(s).replace(/~/g, '%7E');

// Hash format: #map=zoom/lat/lng&base=streets&layers=a,b&pins=lat,lng,color,label~...&board=<id>&notes=off
// The notes layer is a separate flag so `layers=` stays identical to links made before notes existed.
export function serialize(state: AppState): string {
  const parts = [
    `map=${state.zoom.toFixed(2)}/${state.center[1].toFixed(5)}/${state.center[0].toFixed(5)}`,
    `base=${state.base}`,
    `layers=${ALL_LAYERS.filter((l) => state.layers.has(l)).join(',') || 'none'}`,
  ];
  if (state.pins.length) {
    parts.push(
      'pins=' +
        state.pins
          .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)},${p.color},${encodeLabel(p.label)}`)
          .join('~'),
    );
  }
  if (state.board) parts.push(`board=${state.board}`);
  if (!state.notesVisible) parts.push('notes=off');
  return '#' + parts.join('&');
}

export function parse(hash: string): AppState {
  const state: AppState = {
    center: [...DEFAULT_VIEW.center],
    zoom: DEFAULT_VIEW.zoom,
    base: 'light',
    layers: new Set(DEFAULT_LAYERS),
    pins: [],
    board: null,
    notesVisible: true,
  };
  const params = new Map<string, string>();
  for (const part of hash.replace(/^#/, '').split('&')) {
    const i = part.indexOf('=');
    if (i > 0) params.set(part.slice(0, i), part.slice(i + 1));
  }

  const map = params.get('map')?.split('/').map(Number);
  if (map && map.length === 3 && map.every(Number.isFinite)) {
    state.zoom = map[0];
    state.center = [map[2], map[1]];
  }

  const base = params.get('base');
  if (base === 'streets' || base === 'light' || base === 'raster') state.base = base;

  const layers = params.get('layers');
  if (layers) state.layers = new Set(layers.split(',').filter((l): l is LayerKey => ALL_LAYERS.includes(l as LayerKey)));

  const board = params.get('board');
  if (board && BOARD_ID_RE.test(board)) state.board = board;
  if (params.get('notes') === 'off') state.notesVisible = false;

  const pins = params.get('pins');
  if (pins) {
    for (const raw of pins.split('~')) {
      const [lat, lng, color, ...rest] = raw.split(',');
      const p: Pin = {
        lat: Number(lat),
        lng: Number(lng),
        color: Math.min(PIN_COLORS.length - 1, Math.max(0, Number(color) || 0)),
        label: safeDecode(rest.join(',')) || 'Pinned spot',
      };
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) state.pins.push(p);
    }
  }
  return state;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
