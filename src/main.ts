import * as maplibregl from 'maplibre-gl';
import type { LngLatLike, MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import './style.css';
import { AERIAL_MODES, AERIAL_SOURCE, AerialLayer, aerialAmount } from './aerial';
import { BASEMAPS } from './basemaps';
import { CATEGORY_META, LANDMARKS, landmarksGeoJSON } from './data/landmarks';
import { METRO_COLORS, METRO_LINE_ORDER, nearestStations, parseStations, walkMinutes, type MetroLine, type Station } from './data/metro';
import { ALL_LAYERS, BOARD_ID_RE, PIN_COLORS, newBoardId, parse, serialize, type AerialMode, type AppState, type BaseKey, type LayerKey, type Pin } from './state';
import { STREET_VIEW_MIN_ZOOM, onLongPress, streetViewLink, streetViewUrl } from './streetview';
import { AUTHOR_MAX_LENGTH, BoardClient, BoardError, NOTE_MAX_LENGTH, fullTime, timeAgo, type NewNote, type Note } from './board';
import { rentalArea } from './rentals/area';
import { focusRentalCriteria, mountRentalCriteria, rentalHashParam, rentalLinksElement } from './rentals/ui';

const DATA = `${import.meta.env.BASE_URL}data/`;
const isMobile = () => window.matchMedia('(max-width: 720px)').matches;
const fitPadding = () =>
  isMobile() ? { top: 60, bottom: 110, left: 16, right: 16 } : { top: 24, bottom: 24, left: 356, right: 70 };
const DC_BOUNDS: [[number, number], [number, number]] = [[-77.12, 38.79], [-76.909, 38.996]];

const NBHD_PALETTE = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#22c55e', '#f97316'];

const LAYER_GROUPS: Record<LayerKey, string[]> = {
  neighborhoods: ['nbhd-fill', 'nbhd-line', 'nbhd-selected'],
  labels: ['nbhd-labels'],
  metro: ['metro-casing', 'metro-lines', 'metro-stations', 'metro-station-labels'],
  landmarks: ['landmarks-halo', 'landmarks', 'landmark-labels'],
  boundary: ['dc-boundary'],
  pins: [],
};

const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* storage disabled (private mode); the feature still works for this visit */
    }
  },
};
const LAST_BOARD_KEY = 'dcmap.board';
const AUTHOR_KEY = 'dcmap.author';

const state: AppState = parse(location.hash);
if (!state.board) {
  const last = storage.get(LAST_BOARD_KEY);
  if (last && BOARD_ID_RE.test(last)) state.board = last;
}
let stations: Station[] = [];
let data: Record<string, GeoJSON.FeatureCollection> = {};
let selectedCluster: number | null = null;
type PlaceMode = 'pin' | 'note' | null;
let placeMode: PlaceMode = null;
let popup: maplibregl.Popup | null = null;
const markers: maplibregl.Marker[] = [];
const noteMarkers = new Map<string, maplibregl.Marker>();
let openNoteId: string | null = null;
let editingNote = false;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

maplibregl.setWorkerUrl(workerUrl);

const map = new maplibregl.Map({
  container: 'map',
  style: BASEMAPS[state.base].style,
  center: state.center,
  zoom: state.zoom,
  maxBounds: [[-77.6, 38.6], [-76.5, 39.25]],
  attributionControl: { compact: true },
  cooperativeGestures: false,
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
const aerial = new AerialLayer(map);
aerial.setMode(state.aerial);

// ---------- URL state ----------
let writeTimer: number | undefined;
function syncUrl() {
  window.clearTimeout(writeTimer);
  writeTimer = window.setTimeout(() => {
    const c = map.getCenter();
    state.center = [c.lng, c.lat];
    state.zoom = map.getZoom();
    history.replaceState(null, '', serialize(state));
  }, 150);
}
map.on('moveend', syncUrl);

window.addEventListener('hashchange', () => {
  const next = parse(location.hash);
  state.layers = next.layers;
  state.pins = next.pins;
  state.notesVisible = next.notesVisible;
  if (next.board) state.board = next.board;
  if (next.base !== state.base) setBase(next.base);
  if (next.aerial !== state.aerial) setAerial(next.aerial);
  map.jumpTo({ center: next.center, zoom: next.zoom });
  applyLayerVisibility();
  renderPins();
  renderPanel();
  openBoard(state.board);
});

// ---------- Overlays ----------
async function loadData() {
  const files = ['neighborhoods', 'neighborhood-labels', 'metro-lines', 'metro-stations', 'dc-boundary'];
  const results = await Promise.all(
    files.map(async (f) => {
      const res = await fetch(`${DATA}${f}.geojson`);
      if (!res.ok) throw new Error(`Could not load ${f} (HTTP ${res.status})`);
      return [f, (await res.json()) as GeoJSON.FeatureCollection] as const;
    }),
  );
  data = Object.fromEntries(results);
  stations = parseStations(data['metro-stations']);
}

function firstSymbolLayer(): string | undefined {
  return map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
}

function addOverlays() {
  if (!data.neighborhoods || map.getSource('neighborhoods')) return;
  const { font, boldFont } = BASEMAPS[state.base];
  const beforeLabels = aerial.overlaysBefore ?? firstSymbolLayer();

  map.addSource('dc-boundary', { type: 'geojson', data: data['dc-boundary'] });
  map.addSource('neighborhoods', { type: 'geojson', data: data.neighborhoods, promoteId: 'id' });
  map.addSource('neighborhood-labels', { type: 'geojson', data: data['neighborhood-labels'] });
  map.addSource('metro-lines', { type: 'geojson', data: data['metro-lines'] });
  map.addSource('metro-stations', { type: 'geojson', data: data['metro-stations'] });
  map.addSource('landmarks', { type: 'geojson', data: landmarksGeoJSON() });

  const paletteExpr: maplibregl.ExpressionSpecification = [
    'match',
    ['%', ['get', 'id'], NBHD_PALETTE.length],
    ...NBHD_PALETTE.flatMap((c, i) => [i, c]),
    NBHD_PALETTE[0],
  ] as unknown as maplibregl.ExpressionSpecification;

  map.addLayer(
    {
      id: 'nbhd-fill',
      type: 'fill',
      source: 'neighborhoods',
      paint: {
        'fill-color': ['case', ['get', 'residential'], paletteExpr, '#94a3b8'],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], 0.32,
          ['boolean', ['feature-state', 'hover'], false], 0.24,
          ['get', 'residential'], 0.1,
          0.05,
        ],
      },
    },
    beforeLabels,
  );
  map.addLayer(
    {
      id: 'nbhd-line',
      type: 'line',
      source: 'neighborhoods',
      paint: { 'line-color': '#4338ca', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 15, 2], 'line-dasharray': [3, 2] },
    },
    beforeLabels,
  );
  map.addLayer(
    {
      id: 'nbhd-selected',
      type: 'line',
      source: 'neighborhoods',
      filter: ['==', ['get', 'id'], -1],
      paint: { 'line-color': '#312e81', 'line-width': 3.5 },
    },
    beforeLabels,
  );
  map.addLayer(
    {
      id: 'dc-boundary',
      type: 'line',
      source: 'dc-boundary',
      paint: { 'line-color': '#0f172a', 'line-width': 2, 'line-opacity': 0.6 },
    },
    beforeLabels,
  );
  map.addLayer(
    {
      id: 'metro-casing',
      type: 'line',
      source: 'metro-lines',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 9] },
    },
    beforeLabels,
  );
  map.addLayer(
    {
      id: 'metro-lines',
      type: 'line',
      source: 'metro-lines',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['match', ['get', 'line'], ...METRO_LINE_ORDER.flatMap((l) => [l, METRO_COLORS[l]]), '#555'] as unknown as maplibregl.ExpressionSpecification,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 6],
      },
    },
    beforeLabels,
  );

  map.addLayer({
    id: 'nbhd-labels',
    type: 'symbol',
    source: 'neighborhood-labels',
    minzoom: 11.5,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': boldFont,
      'text-size': ['interpolate', ['linear'], ['zoom'], 11.5, 10, 15, 14],
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.08,
      'text-max-width': 8,
      'text-padding': 6,
    },
    paint: { 'text-color': '#3730a3', 'text-halo-color': 'rgba(255,255,255,0.92)', 'text-halo-width': 1.6, 'text-opacity': 0.85 },
  });

  map.addLayer({
    id: 'metro-stations',
    type: 'circle',
    source: 'metro-stations',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['in', ',', ['get', 'lines']], 4, 3], 15, ['case', ['in', ',', ['get', 'lines']], 9, 7]],
      'circle-color': '#ffffff',
      'circle-stroke-color': '#111827',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 15, 2.5],
    },
  });
  map.addLayer({
    id: 'metro-station-labels',
    type: 'symbol',
    source: 'metro-stations',
    minzoom: 12.5,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': boldFont,
      'text-size': 11.5,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-max-width': 9,
      'text-optional': true,
    },
    paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 1.8 },
  });

  map.addLayer({
    id: 'landmarks-halo',
    type: 'circle',
    source: 'landmarks',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 8, 15, 14], 'circle-color': ['get', 'color'], 'circle-opacity': 0.2 },
  });
  map.addLayer({
    id: 'landmarks',
    type: 'circle',
    source: 'landmarks',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4.5, 15, 7.5],
      'circle-color': ['get', 'color'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'landmark-labels',
    type: 'symbol',
    source: 'landmarks',
    minzoom: 11,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': font,
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10.5, 15, 13],
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
      'text-max-width': 9,
      'text-optional': true,
    },
    paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#ffffff', 'text-halo-width': 1.8 },
  });

  if (selectedCluster !== null) selectCluster(selectedCluster);
  applyLayerVisibility();
}

function applyLayerVisibility() {
  for (const key of ALL_LAYERS) {
    const visible = state.layers.has(key);
    for (const id of LAYER_GROUPS[key]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  }
  for (const m of markers) m.getElement().classList.toggle('is-hidden', !state.layers.has('pins'));
  for (const m of noteMarkers.values()) m.getElement().classList.toggle('is-hidden', !state.notesVisible);
}

function selectCluster(id: number | null) {
  if (selectedCluster !== null && map.getSource('neighborhoods')) map.setFeatureState({ source: 'neighborhoods', id: selectedCluster }, { selected: false });
  selectedCluster = id;
  if (!map.getLayer('nbhd-selected')) return;
  map.setFilter('nbhd-selected', ['==', ['get', 'id'], id ?? -1]);
  if (id !== null) map.setFeatureState({ source: 'neighborhoods', id }, { selected: true });
}

// ---------- Base map switching ----------
let styleErrored = false;
let styleReady = false;
function setBase(base: BaseKey) {
  state.base = base;
  styleErrored = false;
  styleReady = false;
  map.setStyle(BASEMAPS[base].style);
  renderPanel();
  syncUrl();
}

function setAerial(mode: AerialMode) {
  state.aerial = mode;
  aerial.setMode(mode);
  renderPanel();
  syncUrl();
}

// The style and the bundled data load independently; whichever finishes last adds the overlays.
// isStyleLoaded() stays false while aerial tiles stream in, so readiness is tracked separately.
function ensureOverlays() {
  if (styleReady || (map.getStyle()?.layers?.length && map.isStyleLoaded())) addOverlays();
}
map.on('style.load', () => {
  styleReady = true;
  aerial.install(state.base === 'raster');
  ensureOverlays();
  updateStreetViewButton();
  $('#loading').classList.add('is-done');
});
map.on('styledata', ensureOverlays);
map.on('idle', ensureOverlays);

let aerialErrorShown = false;
map.on('error', (e) => {
  if ((e as { sourceId?: string }).sourceId === AERIAL_SOURCE) {
    if (!aerialErrorShown && aerialAmount(state.aerial, map.getZoom()) > 0) {
      aerialErrorShown = true;
      toast("DC aerial photos aren't loading right now, so you're seeing the drawn map.");
    }
    return;
  }
  // If the keyless vector provider is unreachable, drop to the raster fallback once.
  const msg = String(e.error?.message ?? '');
  const styleUrl = BASEMAPS[state.base].style;
  const styleFetchFailed = typeof styleUrl === 'string' && (msg.includes(styleUrl) || /Failed to fetch|NetworkError|AJAXError/i.test(msg));
  if (!map.isStyleLoaded() && state.base !== 'raster' && !styleErrored && styleFetchFailed) {
    styleErrored = true;
    toast('Vector tiles unavailable, switched to the classic map.');
    setBase('raster');
  }
});

// ---------- Popups ----------
function lineDots(lines: MetroLine[]) {
  return `<span class="dots">${lines.map((l) => `<span class="dot" style="background:${METRO_COLORS[l]}" title="${l} line"></span>`).join('')}</span>`;
}

function nearestHtml(lngLat: [number, number], heading = 'Closest Metro stations') {
  if (!stations.length) return '';
  const rows = nearestStations(stations, lngLat)
    .map(
      ({ station, miles }) => `
      <li>
        ${lineDots(station.lines)}
        <span class="st-name">${esc(station.name)}</span>
        <span class="st-dist">${miles < 0.1 ? '<0.1' : miles.toFixed(1)} mi · ~${walkMinutes(miles)} min walk</span>
      </li>`,
    )
    .join('');
  return `<div class="pop-section">${heading}</div><ul class="st-list">${rows}</ul>`;
}

function openPopup(lngLat: LngLatLike, content: HTMLElement | string, className = '', offset: maplibregl.Offset = 12, anchor?: maplibregl.PositionAnchor) {
  const previous = popup;
  popup = null;
  previous?.remove();
  openNoteId = null;
  editingNote = false;
  popup = new maplibregl.Popup({ maxWidth: '320px', className, focusAfterOpen: false, offset, anchor }).setLngLat(lngLat);
  if (typeof content === 'string') popup.setHTML(content);
  else popup.setDOMContent(content);
  popup.addTo(map);
  const opened = popup;
  requestAnimationFrame(() => {
    const box = popup?.getElement().getBoundingClientRect();
    if (!box) return;
    const bottomLimit = window.innerHeight - (window.matchMedia('(max-width: 720px)').matches ? 236 : 16);
    const dy = box.bottom > bottomLimit ? Math.min(box.bottom - bottomLimit, box.top - 16) : box.top < 16 ? box.top - 16 : 0;
    if (dy) map.panBy([0, dy]);
  });
  popup.on('close', () => {
    if (popup === opened) {
      selectCluster(null);
      openNoteId = null;
      editingNote = false;
      highlightNoteMarker();
    }
  });
}

function neighborhoodPopup(f: MapGeoJSONFeature, at: [number, number]) {
  const p = f.properties as { id: number; title: string; names: string; cluster: string; residential: boolean };
  selectCluster(p.id);
  const el = document.createElement('div');
  el.className = 'pop';
  el.innerHTML = `
    <div class="pop-kicker">${esc(p.cluster)}${p.residential ? '' : ' · mostly non-residential'}</div>
    <h3>${esc(p.title)}</h3>
    <p class="pop-sub">${esc(p.names)}</p>
    ${nearestHtml(at, 'Closest Metro to where you tapped')}
    <div class="pop-buttons">
      <button class="btn btn-primary btn-sm" data-pin>Pin this spot</button>
      ${state.board ? '<button class="btn btn-note btn-sm" data-note>Add note</button>' : ''}
      ${streetViewLink(at[1], at[0], 'btn btn-outline btn-sm', 'Street View')}
    </div>`;
  el.querySelector('[data-pin]')!.addEventListener('click', () => {
    addPin({ lng: at[0], lat: at[1], color: 0, label: p.title });
  });
  el.querySelector('[data-note]')?.addEventListener('click', () => {
    startNote({ lng: at[0], lat: at[1], kind: 'hood', ref: p.title, hoodId: p.id });
  });
  const cluster = data.neighborhoods?.features.find((x) => x.properties?.id === p.id) ?? f;
  el.insertBefore(rentalLinksElement(rentalArea(cluster, p.title), openRentalCriteria), el.querySelector('.pop-buttons'));
  openPopup(at, el);
}

/** Opened by right-click or long-press anywhere on the map. */
function spotPopup(at: [number, number]) {
  const hood = map.getLayer('nbhd-fill') ? map.queryRenderedFeatures(map.project(at), { layers: ['nbhd-fill'] })[0] : undefined;
  const title = (hood?.properties as { title?: string } | undefined)?.title;
  const station = nearestStations(stations, at, 1)[0];
  const el = document.createElement('div');
  el.className = 'pop spot-pop';
  el.innerHTML = `
    <div class="pop-kicker">${title ? esc(title) : 'This spot'}</div>
    <h3>${streetViewLink(at[1], at[0], 'spot-sv')}</h3>
    <p class="pop-sub">${at[1].toFixed(5)}, ${at[0].toFixed(5)}${station ? ` · ${station.miles < 0.1 ? '<0.1' : station.miles.toFixed(1)} mi to ${esc(station.station.name)}` : ''}</p>
    <div class="pop-buttons">
      <button class="btn btn-outline btn-sm" data-pin>Pin this spot</button>
      ${state.board ? '<button class="btn btn-note btn-sm" data-note>Add note</button>' : ''}
    </div>`;
  el.querySelector('[data-pin]')!.addEventListener('click', () => {
    addPin({ lng: at[0], lat: at[1], color: 0, label: title ?? `Spot ${state.pins.length + 1}` });
  });
  el.querySelector('[data-note]')?.addEventListener('click', () => startNote({ lng: at[0], lat: at[1], kind: 'free' }));
  el.querySelector('[data-street-view]')!.addEventListener('click', () => popup?.remove());
  openPopup(at, el);
}

function stationPopup(f: MapGeoJSONFeature) {
  const s = stations.find((x) => x.name === f.properties.name);
  if (!s) return;
  openPopup(
    s.lngLat,
    `<div class="pop">
      <div class="pop-kicker">Metro station</div>
      <h3>${esc(s.name)}</h3>
      <div class="line-chips">${s.lines.map((l) => `<span class="chip" style="--c:${METRO_COLORS[l]}">${l}</span>`).join('')}</div>
      <p class="pop-sub">${esc(s.address)}</p>
      <a class="pop-link" href="${esc(s.url)}" target="_blank" rel="noopener">Station info on wmata.com ↗</a>
    </div>`,
  );
}

function landmarkPopup(f: MapGeoJSONFeature) {
  const l = LANDMARKS[f.properties.index as number];
  const meta = CATEGORY_META[l.category];
  openPopup(
    l.lngLat,
    `<div class="pop">
      <div class="pop-kicker" style="color:${meta.color}">${meta.label}</div>
      <h3>${esc(l.name)}</h3>
      <p class="pop-sub">${esc(l.blurb)}</p>
      ${nearestHtml(l.lngLat)}
    </div>`,
  );
}

function pinPopup(index: number) {
  const pin = state.pins[index];
  const el = document.createElement('div');
  el.className = 'pop';
  el.innerHTML = `
    <div class="pop-kicker">Your pin</div>
    <label class="field">
      <span>Label</span>
      <input type="text" maxlength="60" value="${esc(pin.label)}" placeholder="e.g. Apartment on 14th St" />
    </label>
    <div class="swatches" role="radiogroup" aria-label="Pin color">
      ${PIN_COLORS.map((c, i) => `<button class="swatch${i === pin.color ? ' is-active' : ''}" style="--c:${c}" data-color="${i}" aria-label="Color ${i + 1}" role="radio" aria-checked="${i === pin.color}"></button>`).join('')}
    </div>
    ${nearestHtml([pin.lng, pin.lat])}
    <div class="pop-actions">
      <button class="btn btn-ghost btn-sm" data-delete>Remove</button>
      <span class="pop-actions-end">
        ${state.board ? '<button class="btn btn-note btn-sm" data-note>Add note</button>' : ''}
        <button class="btn btn-primary btn-sm" data-done>Done</button>
      </span>
    </div>`;
  el.querySelector('[data-note]')?.addEventListener('click', () => {
    startNote({ lng: round5(pin.lng), lat: round5(pin.lat), kind: 'pin', ref: pin.label });
  });
  const input = el.querySelector('input')!;
  input.addEventListener('input', () => {
    pin.label = input.value.trim() || 'Pinned spot';
    updatePinsUi();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') popup?.remove();
  });
  el.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) =>
    b.addEventListener('click', () => {
      pin.color = Number(b.dataset.color);
      el.querySelectorAll('.swatch').forEach((s) => {
        s.classList.toggle('is-active', s === b);
        s.setAttribute('aria-checked', String(s === b));
      });
      renderPins();
      syncUrl();
    }),
  );
  el.querySelector('[data-delete]')!.addEventListener('click', () => {
    popup?.remove();
    state.pins.splice(index, 1);
    renderPins();
    renderPanel();
    syncUrl();
  });
  el.querySelector('[data-done]')!.addEventListener('click', () => popup?.remove());
  openPopup([pin.lng, pin.lat], el, 'pin-popup');
  setTimeout(() => input.select(), 50);
}

// ---------- Pins ----------
function pinElement(pin: Pin) {
  const el = document.createElement('div');
  el.className = 'pin';
  el.style.setProperty('--c', PIN_COLORS[pin.color]);
  el.innerHTML = `<svg viewBox="0 0 24 32" aria-hidden="true"><path d="M12 0C5.4 0 0 5.3 0 11.9 0 20.8 12 32 12 32s12-11.2 12-20.1C24 5.3 18.6 0 12 0z"/><circle cx="12" cy="12" r="4.5" fill="#fff"/></svg><span class="pin-label"></span>`;
  el.querySelector('.pin-label')!.textContent = pin.label;
  return el;
}

function renderPins() {
  markers.splice(0).forEach((m) => m.remove());
  state.pins.forEach((pin, i) => {
    const el = pinElement(pin);
    el.classList.toggle('is-hidden', !state.layers.has('pins'));
    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat([pin.lng, pin.lat]).addTo(map);
    marker.on('dragend', () => {
      const attached = board.notes.filter((n) => isOnPin(n, pin));
      const ll = marker.getLngLat();
      pin.lng = ll.lng;
      pin.lat = ll.lat;
      syncUrl();
      for (const n of attached) {
        board.update(n.id, { lng: round5(pin.lng), lat: round5(pin.lat), ref: pin.label }).catch(showBoardError);
      }
      renderNotes();
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      pinPopup(i);
    });
    markers.push(marker);
  });
}

function updatePinsUi() {
  state.pins.forEach((p, i) => {
    const label = markers[i]?.getElement().querySelector('.pin-label');
    if (label) label.textContent = p.label;
  });
  renderPinList();
  syncUrl();
}

function addPin(pin: Pin) {
  pin.color = state.pins.length % PIN_COLORS.length;
  state.pins.push(pin);
  state.layers.add('pins');
  setPlaceMode(null);
  renderPins();
  renderPanel();
  applyLayerVisibility();
  syncUrl();
  pinPopup(state.pins.length - 1);
}

function setPlaceMode(mode: PlaceMode) {
  placeMode = mode;
  document.body.classList.toggle('adding-pin', mode !== null);
  document.querySelectorAll('[data-action="add-pin"]').forEach((b) => b.classList.toggle('is-active', mode === 'pin'));
  document.querySelectorAll('[data-action="add-note"]').forEach((b) => b.classList.toggle('is-active', mode === 'note'));
  $('#place-hint-text').textContent = mode === 'note' ? 'Tap anywhere to place a note' : 'Tap anywhere to drop a pin';
  if (mode) {
    popup?.remove();
    toast(mode === 'note' ? 'Tap the map to place your note' : 'Tap the map to drop a pin');
  }
}

// ---------- Map interaction ----------
const CLICKABLE = ['landmarks', 'metro-stations', 'nbhd-fill'];
let hoverId: number | null = null;

map.on('mousemove', (e) => {
  if (!map.getLayer('nbhd-fill')) return;
  const layers = CLICKABLE.filter((id) => map.getLayoutProperty(id, 'visibility') !== 'none');
  const feats = map.queryRenderedFeatures(e.point, { layers });
  map.getCanvas().style.cursor = placeMode ? 'crosshair' : feats.length ? 'pointer' : '';
  const hood = feats.find((f) => f.layer.id === 'nbhd-fill');
  const nextHover = hood ? (hood.id as number) : null;
  if (nextHover !== hoverId) {
    if (hoverId !== null) map.setFeatureState({ source: 'neighborhoods', id: hoverId }, { hover: false });
    if (nextHover !== null) map.setFeatureState({ source: 'neighborhoods', id: nextHover }, { hover: true });
    hoverId = nextHover;
  }
});

const longPress = onLongPress(map, (at) => {
  if (!placeMode) spotPopup(at);
});
map.on('contextmenu', (e) => {
  e.originalEvent.preventDefault();
  if (placeMode || longPress.justFired()) return;
  spotPopup([e.lngLat.lng, e.lngLat.lat]);
});

map.on('click', (e) => {
  if (longPress.justFired()) return;
  const at: [number, number] = [e.lngLat.lng, e.lngLat.lat];
  if (placeMode === 'pin') {
    addPin({ lng: at[0], lat: at[1], color: 0, label: `Spot ${state.pins.length + 1}` });
    return;
  }
  if (placeMode === 'note') {
    setPlaceMode(null);
    startNote({ lng: at[0], lat: at[1], kind: 'free' });
    return;
  }
  if (!map.getLayer('nbhd-fill')) return;
  const layers = CLICKABLE.filter((id) => map.getLayoutProperty(id, 'visibility') !== 'none');
  const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
    [e.point.x - 6, e.point.y - 6],
    [e.point.x + 6, e.point.y + 6],
  ];
  const feats = map.queryRenderedFeatures(bbox, { layers });
  const landmark = feats.find((f) => f.layer.id === 'landmarks');
  const station = feats.find((f) => f.layer.id === 'metro-stations');
  const hood = map.queryRenderedFeatures(e.point, { layers: layers.filter((l) => l === 'nbhd-fill') })[0];
  if (landmark) landmarkPopup(landmark);
  else if (station) stationPopup(station);
  else if (hood) neighborhoodPopup(hood, at);
  else {
    popup?.remove();
    selectCluster(null);
  }
});

// ---------- Shared notes board ----------
const board = new BoardClient((notesChanged) => {
  if (notesChanged) renderNotes();
  renderNoteList();
  syncOpenNote();
});
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
const isOnPin = (n: Note, p: Pin) => n.kind === 'pin' && Math.abs(n.lat - p.lat) < 2e-5 && Math.abs(n.lng - p.lng) < 2e-5;
const initial = (name: string) => [...name.trim()][0]?.toUpperCase() ?? '?';

function noteColorStyle(author: string) {
  const c = board.colorFor(author);
  return `--nb:${c.bg};--ne:${c.edge}`;
}

function attachmentLabel(n: Note): string {
  if (n.kind === 'pin') {
    const pin = state.pins.find((p) => isOnPin(n, p));
    return `on pin “${pin?.label ?? n.ref ?? 'Pinned spot'}”`;
  }
  if (n.kind === 'hood') return `about ${n.ref ?? 'a neighborhood'}`;
  const st = nearestStations(stations, [n.lng, n.lat], 1)[0]?.station.name;
  return st ? `near ${st}` : 'on the map';
}

function showBoardError(err: unknown) {
  toast(err instanceof BoardError ? err.message : "Can't reach the shared board, so that change wasn't saved. Try again in a moment.");
}

function openBoard(id: string | null) {
  if (id) storage.set(LAST_BOARD_KEY, id);
  document.querySelectorAll<HTMLElement>('[data-action="add-note"]').forEach((b) => (b.hidden = !id));
  board.open(id);
}

function startBoard() {
  state.board = newBoardId();
  state.notesVisible = true;
  openBoard(state.board);
  syncUrl();
  renderPanel();
  toast('Board started. Tap “Copy share link” to invite your friend.');
}

function leaveBoard() {
  if (!state.board) return;
  if (!confirm('Close this board on this device? The notes stay saved. To come back you will need the share link, so copy it first if you don’t have it.')) return;
  state.board = null;
  storage.set(LAST_BOARD_KEY, null);
  popup?.remove();
  openBoard(null);
  syncUrl();
}

// The name is asked for once and kept in this browser only.
function askAuthor(force = false): Promise<string | null> {
  const saved = storage.get(AUTHOR_KEY);
  if (saved && !force) return Promise.resolve(saved);
  const dialog = $<HTMLDialogElement>('#name-dialog');
  const input = $<HTMLInputElement>('#name-input');
  input.value = saved ?? '';
  input.maxLength = AUTHOR_MAX_LENGTH;
  dialog.returnValue = '';
  dialog.showModal();
  setTimeout(() => input.focus(), 30);
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        const name = input.value.trim().slice(0, AUTHOR_MAX_LENGTH);
        if (dialog.returnValue === 'ok' && name) {
          storage.set(AUTHOR_KEY, name);
          renderNoteList();
          resolve(name);
        } else resolve(force ? saved : null);
      },
      { once: true },
    );
  });
}
const ensureAuthor = () => askAuthor(false);

function noteMarkerElement(n: Note) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'note-marker';
  el.setAttribute('style', noteColorStyle(n.author));
  el.setAttribute('aria-label', `Note by ${n.author}: ${n.text.slice(0, 80)}`);
  el.title = `${n.author}: ${n.text.slice(0, 80)}${n.text.length > 80 ? '…' : ''}`;
  el.innerHTML = `<span class="note-sticky" aria-hidden="true"><span class="note-marker-initial"></span></span>`;
  el.querySelector('.note-marker-initial')!.textContent = initial(n.author);
  return el;
}

function noteMarkerPlacement(n: Note): { anchor: maplibregl.PositionAnchor; offset: [number, number] } {
  if (n.kind !== 'pin') return { anchor: 'center', offset: [0, 0] };
  const siblings = board.notes.filter((o) => o.kind === 'pin' && Math.abs(o.lat - n.lat) < 2e-5 && Math.abs(o.lng - n.lng) < 2e-5);
  const k = Math.max(0, siblings.findIndex((o) => o.id === n.id));
  return { anchor: 'left', offset: [13 + k * 14, -28 + k * 3] };
}

function renderNotes() {
  for (const m of noteMarkers.values()) m.remove();
  noteMarkers.clear();
  for (const n of board.notes) {
    const el = noteMarkerElement(n);
    el.classList.toggle('is-hidden', !state.notesVisible);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      notePopup(n.id);
    });
    const { anchor, offset } = noteMarkerPlacement(n);
    noteMarkers.set(n.id, new maplibregl.Marker({ element: el, anchor, offset }).setLngLat([n.lng, n.lat]).addTo(map));
  }
  highlightNoteMarker();
}

function highlightNoteMarker() {
  for (const [id, m] of noteMarkers) m.getElement().classList.toggle('is-open', id === openNoteId);
}

/** Keeps an open note popup in step with changes from the other person. */
function syncOpenNote() {
  if (!openNoteId || editingNote) return;
  const n = board.notes.find((x) => x.id === openNoteId);
  if (!n) {
    popup?.remove();
    toast('That note was deleted');
  } else if (popup?.getElement()?.dataset.rev !== String(n.updatedAt)) notePopup(n.id);
}

function popupOffset(n: Pick<Note, 'kind' | 'lat' | 'lng'> & { id?: string }): maplibregl.Offset {
  if (n.kind !== 'pin') return 18;
  const { offset } = noteMarkerPlacement(n as Note);
  return [offset[0] + 14, offset[1] - 16];
}

function notePopup(id: string, edit = false) {
  const n = board.notes.find((x) => x.id === id);
  if (!n) return;
  const el = document.createElement('div');
  el.className = 'pop note-pop';
  el.setAttribute('style', noteColorStyle(n.author));
  const edited = n.updatedAt - n.createdAt > 60_000;
  el.innerHTML = `
    <div class="pop-kicker"></div>
    <div class="note-view">
      <p class="note-text"></p>
      <div class="note-meta">
        <span class="note-chip" aria-hidden="true"></span>
        <span><strong class="note-author"></strong> · <time datetime="${new Date(n.updatedAt).toISOString()}" title="${esc(fullTime(n.updatedAt))}">${esc(timeAgo(n.updatedAt))}</time>${edited ? ' · edited' : ''}</span>
      </div>
      <div class="pop-actions">
        <button class="btn btn-ghost btn-sm" data-delete>Delete</button>
        <button class="btn btn-outline btn-sm" data-edit>Edit</button>
      </div>
    </div>
    <form class="note-edit" hidden>
      <textarea maxlength="${NOTE_MAX_LENGTH}" rows="4" aria-label="Note text" required></textarea>
      <div class="note-edit-foot"><span></span><span class="note-counter"></span></div>
      <div class="pop-actions">
        <button type="button" class="btn btn-ghost-muted btn-sm" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm">Save</button>
      </div>
    </form>`;
  el.querySelector('.pop-kicker')!.textContent = `Note ${attachmentLabel(n)}`;
  el.querySelector('.note-text')!.textContent = n.text;
  el.querySelector('.note-author')!.textContent = n.author;
  el.querySelector('.note-chip')!.textContent = initial(n.author);

  const form = el.querySelector('form')!;
  const textarea = form.querySelector('textarea')!;
  wireCounter(textarea, form.querySelector('.note-counter')!);
  const setEditing = (on: boolean) => {
    editingNote = on;
    el.querySelector<HTMLElement>('.note-view')!.hidden = on;
    form.hidden = !on;
    if (on) {
      textarea.value = n.text;
      textarea.dispatchEvent(new Event('input'));
      setTimeout(() => textarea.focus(), 30);
    }
  };
  el.querySelector('[data-edit]')!.addEventListener('click', () => setEditing(true));
  el.querySelector('[data-cancel]')!.addEventListener('click', () => setEditing(false));
  el.querySelector('[data-delete]')!.addEventListener('click', async () => {
    if (!confirm(`Delete this note by ${n.author}? Your friend will stop seeing it too.`)) return;
    try {
      await board.remove(n.id);
      popup?.remove();
      toast('Note deleted');
    } catch (err) {
      showBoardError(err);
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;
    if (text === n.text) return setEditing(false);
    await saveWith(form, async () => {
      await board.update(n.id, { text });
      editingNote = false;
      notePopup(n.id);
    });
  });

  // On phones, center the note so its popup (always above the note) never runs off the screen edge.
  if (isMobile() && !map.isMoving()) map.easeTo({ center: [n.lng, n.lat], offset: [0, window.innerHeight * 0.12], duration: 300 });
  openPopup([n.lng, n.lat], el, 'note-popup', popupOffset(n), isMobile() ? 'bottom' : undefined);
  popup!.getElement().dataset.rev = String(n.updatedAt);
  openNoteId = n.id;
  highlightNoteMarker();
  if (edit) setEditing(true);
}

function wireCounter(textarea: HTMLTextAreaElement, counter: Element) {
  const update = () => {
    const left = NOTE_MAX_LENGTH - textarea.value.length;
    counter.textContent = left <= 100 ? `${left} characters left` : '';
  };
  textarea.addEventListener('input', update);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) textarea.form?.requestSubmit();
  });
}

async function saveWith(form: HTMLFormElement, action: () => Promise<void>) {
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const label = submit.textContent;
  submit.disabled = true;
  submit.textContent = 'Saving…';
  try {
    await action();
  } catch (err) {
    showBoardError(err);
    submit.disabled = false;
    submit.textContent = label;
  }
}

/** Opens an empty note editor at a spot; nothing is saved until the user taps Save. */
async function startNote(draft: Omit<NewNote, 'author' | 'text'>) {
  if (!state.board) return;
  const author = await ensureAuthor();
  if (!author) return;
  const el = document.createElement('div');
  el.className = 'pop note-pop';
  el.setAttribute('style', noteColorStyle(author));
  el.innerHTML = `
    <div class="pop-kicker"></div>
    <form class="note-edit">
      <textarea maxlength="${NOTE_MAX_LENGTH}" rows="4" aria-label="Note text" placeholder="e.g. Love this block, but the Metro walk is long" required></textarea>
      <div class="note-edit-foot"><span class="note-writing-as"></span><span class="note-counter"></span></div>
      <div class="pop-actions">
        <button type="button" class="btn btn-ghost-muted btn-sm" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm">Save note</button>
      </div>
    </form>`;
  const kicker = draft.kind === 'pin' ? `New note on pin “${draft.ref}”` : draft.kind === 'hood' ? `New note about ${draft.ref}` : 'New note';
  el.querySelector('.pop-kicker')!.textContent = kicker;
  el.querySelector('.note-writing-as')!.textContent = `as ${author}`;
  const form = el.querySelector('form')!;
  const textarea = form.querySelector('textarea')!;
  wireCounter(textarea, form.querySelector('.note-counter')!);
  el.querySelector('[data-cancel]')!.addEventListener('click', () => popup?.remove());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;
    await saveWith(form, async () => {
      const note = await board.create({ ...draft, author, text });
      editingNote = false;
      if (!state.notesVisible) {
        state.notesVisible = true;
        applyLayerVisibility();
        renderPanel();
        syncUrl();
      }
      notePopup(note.id);
      toast('Note saved to the shared board');
    });
  });
  if (isMobile()) map.easeTo({ center: [draft.lng, draft.lat], offset: [0, window.innerHeight * 0.18], duration: 300 });
  openPopup([draft.lng, draft.lat], el, 'note-popup', popupOffset(draft), isMobile() ? 'bottom' : undefined);
  editingNote = true;
  setTimeout(() => textarea.focus(), 60);
}

function flyToNote(id: string) {
  const n = board.notes.find((x) => x.id === id);
  if (!n) return;
  if (!state.notesVisible) {
    state.notesVisible = true;
    applyLayerVisibility();
    renderPanel();
    syncUrl();
  }
  if (isMobile()) setPanelOpen(false);
  map.flyTo({ center: [n.lng, n.lat], zoom: Math.max(map.getZoom(), 15), offset: isMobile() ? [0, window.innerHeight * 0.12] : [0, 60] });
  map.once('moveend', () => notePopup(id));
}

function renderNoteList() {
  const body = $('#notes-body');
  const status = $('#board-status');
  $('#note-count').textContent = board.notes.length ? String(board.notes.length) : '';
  status.className = `status-pill is-${board.status}`;
  status.textContent = { none: '', connecting: 'Connecting…', live: 'Live', offline: 'Offline' }[board.status];

  if (!state.board) {
    body.innerHTML = `
      <p class="notes-intro">Leave sticky notes for each other on pins, neighborhoods, or anywhere on the map. Starting a board creates a private link: anyone you send it to can read and add notes.</p>
      <button class="btn btn-note btn-block" data-start-board>Start shared board</button>`;
    return;
  }

  const author = storage.get(AUTHOR_KEY);
  const offline =
    board.status === 'offline'
      ? `<div class="notes-offline" role="status"><strong>Shared board is offline.</strong> We can't reach the notes server, so new notes and edits are paused.${board.notes.length ? ' You’re seeing the last notes we loaded.' : ''} <button class="link-btn" data-retry>Retry now</button></div>`
      : '';
  const rows = [...board.notes]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(
      (n) => `
      <li>
        <button class="note-row" data-goto-note="${esc(n.id)}" style="${noteColorStyle(n.author)}">
          <span class="note-chip" aria-hidden="true">${esc(initial(n.author))}</span>
          <span class="note-row-body">
            <span class="note-row-text">${esc(n.text)}</span>
            <span class="note-row-meta">${esc(n.author)} · ${esc(timeAgo(n.updatedAt))} · ${esc(attachmentLabel(n))}</span>
          </span>
        </button>
      </li>`,
    )
    .join('');
  const empty =
    board.status === 'connecting'
      ? '<li class="empty">Loading notes…</li>'
      : board.status === 'live'
        ? '<li class="empty">No notes yet. Add one anywhere on the map, or open a pin or neighborhood and tap “Add note”.</li>'
        : '';
  body.innerHTML = `
    ${offline}
    <ul class="note-list">${rows || empty}</ul>
    <button class="btn btn-note btn-block" data-add-note-panel ${board.status === 'offline' ? 'disabled' : ''}>+ Add a note</button>
    <div class="notes-foot">
      <span>${author ? `Writing as <strong>${esc(author)}</strong>` : 'We’ll ask your name first'} · <button class="link-btn" data-change-name>${author ? 'Change' : 'Set name'}</button></span>
      <button class="link-btn link-muted" data-leave-board>Close board</button>
    </div>`;
}
window.setInterval(() => {
  if (state.board && document.visibilityState === 'visible') renderNoteList();
}, 60_000);

// ---------- Panel ----------
const LAYER_UI: { key: LayerKey | 'notes'; label: string; hint: string; swatch: string }[] = [
  { key: 'neighborhoods', label: 'Neighborhood areas', hint: '46 DC neighborhood clusters', swatch: '<span class="sw sw-area"></span>' },
  { key: 'labels', label: 'Neighborhood names', hint: '130+ local names', swatch: '<span class="sw sw-text">Aa</span>' },
  { key: 'metro', label: 'Metro rail', hint: '6 lines · 98 stations', swatch: '<span class="sw sw-metro"></span>' },
  { key: 'landmarks', label: 'Landmarks', hint: `${LANDMARKS.length} key places`, swatch: '<span class="sw sw-landmark"></span>' },
  { key: 'pins', label: 'Your pins', hint: 'Saved in the share link', swatch: '<span class="sw sw-pin"></span>' },
  { key: 'notes', label: 'Notes', hint: 'Sticky notes on the shared board', swatch: '<span class="sw sw-note"></span>' },
  { key: 'boundary', label: 'DC border', hint: 'District boundary', swatch: '<span class="sw sw-border"></span>' },
];

const AERIAL_HINTS: Record<AerialMode, string> = {
  auto: 'Fades to DC’s 2025 aerial photos as you zoom in to street level.',
  map: 'Always show the drawn map, even up close.',
  aerial: 'Show DC’s 2025 aerial photos at every zoom.',
};

function renderPanel() {
  $('#base-switch').innerHTML = (Object.keys(BASEMAPS) as BaseKey[])
    .map((k) => `<button class="seg${k === state.base ? ' is-active' : ''}" data-base="${k}" aria-pressed="${k === state.base}">${BASEMAPS[k].label}</button>`)
    .join('');
  $('#aerial-switch').innerHTML = AERIAL_MODES.map(
    ({ key, label }) => `<button class="seg${key === state.aerial ? ' is-active' : ''}" data-aerial="${key}" aria-pressed="${key === state.aerial}">${label}</button>`,
  ).join('');
  $('#aerial-hint').textContent = AERIAL_HINTS[state.aerial];

  $('#layer-list').innerHTML = LAYER_UI.map(
    (l) => `
    <label class="toggle">
      ${l.swatch}
      <span class="toggle-text"><span class="toggle-label">${l.label}</span><span class="toggle-hint">${l.hint}</span></span>
      <input type="checkbox" data-layer="${l.key}" ${(l.key === 'notes' ? state.notesVisible : state.layers.has(l.key)) ? 'checked' : ''} />
      <span class="switch" aria-hidden="true"></span>
    </label>`,
  ).join('');

  $('#metro-legend').innerHTML = METRO_LINE_ORDER.map(
    (l) => `<li><span class="legend-line" style="background:${METRO_COLORS[l]}"></span>${l[0].toUpperCase() + l.slice(1)}</li>`,
  ).join('');

  $('#landmark-legend').innerHTML = Object.values(CATEGORY_META)
    .map((c) => `<li><span class="legend-dot" style="background:${c.color}"></span>${c.label}</li>`)
    .join('');

  renderPinList();
  renderNoteList();
}

function renderPinList() {
  const list = $('#pin-list');
  $('#pin-count').textContent = state.pins.length ? String(state.pins.length) : '';
  if (!state.pins.length) {
    list.innerHTML = `<li class="empty">No pins yet. Drop pins on places you're considering, then share the link with your friend.</li>`;
    return;
  }
  list.innerHTML = state.pins
    .map(
      (p, i) => `
      <li>
        <button class="pin-row" data-goto="${i}">
          <span class="pin-dot" style="background:${PIN_COLORS[p.color]}"></span>
          <span class="pin-row-label">${esc(p.label)}</span>
          <span class="pin-row-meta">${esc(nearestStations(stations, [p.lng, p.lat], 1)[0]?.station.name ?? '')}</span>
        </button>
      </li>`,
    )
    .join('');
}

$('#panel').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const base = t.closest<HTMLElement>('[data-base]')?.dataset.base as BaseKey | undefined;
  if (base && base !== state.base) setBase(base);
  const aerialMode = t.closest<HTMLElement>('[data-aerial]')?.dataset.aerial as AerialMode | undefined;
  if (aerialMode && aerialMode !== state.aerial) setAerial(aerialMode);
  const goto = t.closest<HTMLElement>('[data-goto]')?.dataset.goto;
  if (goto !== undefined) {
    const pin = state.pins[Number(goto)];
    map.flyTo({ center: [pin.lng, pin.lat], zoom: Math.max(map.getZoom(), 15) });
    map.once('moveend', () => pinPopup(Number(goto)));
    if (isMobile()) setPanelOpen(false);
  }
  const noteId = t.closest<HTMLElement>('[data-goto-note]')?.dataset.gotoNote;
  if (noteId) flyToNote(noteId);
  if (t.closest('[data-start-board]')) startBoard();
  if (t.closest('[data-leave-board]')) leaveBoard();
  if (t.closest('[data-change-name]')) askAuthor(true);
  if (t.closest('[data-retry]')) board.refresh();
  if (t.closest('[data-add-note-panel]')) {
    ensureAuthor().then((name) => {
      if (!name) return;
      if (isMobile()) setPanelOpen(false);
      setPlaceMode('note');
    });
  }
});

$('#panel').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const key = input.dataset.layer as LayerKey | 'notes' | undefined;
  if (!key) return;
  if (key === 'notes') state.notesVisible = input.checked;
  else if (input.checked) state.layers.add(key);
  else state.layers.delete(key);
  applyLayerVisibility();
  syncUrl();
});

document.querySelectorAll('[data-action="add-pin"]').forEach((b) => b.addEventListener('click', () => setPlaceMode(placeMode === 'pin' ? null : 'pin')));
document.querySelectorAll('[data-action="add-note"]').forEach((b) =>
  b.addEventListener('click', async () => {
    if (placeMode === 'note') return setPlaceMode(null);
    if (!(await ensureAuthor())) return;
    if (isMobile()) setPanelOpen(false);
    setPlaceMode('note');
  }),
);
document.querySelectorAll('[data-action="share"]').forEach((b) => b.addEventListener('click', share));
$('#reset-view').addEventListener('click', () => map.fitBounds(DC_BOUNDS, { padding: fitPadding() }));
$('#clear-pins').addEventListener('click', () => {
  if (!state.pins.length || !confirm(`Remove all ${state.pins.length} pins? Notes on them stay on the board.`)) return;
  state.pins = [];
  popup?.remove();
  renderPins();
  renderPanel();
  syncUrl();
});

function setPanelOpen(open: boolean) {
  $('#panel').classList.toggle('is-collapsed', !open);
  $('#panel-toggle').setAttribute('aria-expanded', String(open));
}
$('#panel-toggle').addEventListener('click', () => setPanelOpen($('#panel').classList.contains('is-collapsed')));
if (isMobile()) setPanelOpen(false);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && placeMode) setPlaceMode(null);
});

function openRentalCriteria() {
  if (window.matchMedia('(max-width: 720px)').matches) {
    popup?.remove();
    setPanelOpen(true);
  }
  focusRentalCriteria();
}

// ---------- Street View ----------
function updateStreetViewButton() {
  const btn = $<HTMLAnchorElement>('#sv-button');
  const show = map.getZoom() >= STREET_VIEW_MIN_ZOOM;
  btn.classList.toggle('is-visible', show);
  btn.tabIndex = show ? 0 : -1;
  btn.setAttribute('aria-hidden', String(!show));
  if (show) {
    const c = map.getCenter();
    btn.href = streetViewUrl(c.lat, c.lng);
  }
}
map.on('move', updateStreetViewButton);

// ---------- Share ----------
async function share() {
  const c = map.getCenter();
  state.center = [c.lng, c.lat];
  state.zoom = map.getZoom();
  const hash = serialize(state) + rentalHashParam();
  const url = `${location.origin}${location.pathname}${hash}`;
  history.replaceState(null, '', hash);
  try {
    await navigator.clipboard.writeText(url);
    const pins = state.pins.length ? `${state.pins.length} pin${state.pins.length > 1 ? 's' : ''}` : '';
    const what = [pins, state.board ? 'the shared board' : ''].filter(Boolean).join(' and ');
    toast(what ? `Link copied with ${what}` : 'Link copied to clipboard');
  } catch {
    window.prompt('Copy this link:', url);
  }
}

let toastTimer: number | undefined;
function toast(msg: string) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('is-visible'), 2600);
}

// ---------- Boot ----------
renderPanel();
mountRentalCriteria($('#panel-body'), toast);
renderPins();
openBoard(state.board);
if (state.board && !location.hash.includes('board=')) syncUrl();
if (!location.hash.includes('map=')) map.fitBounds(DC_BOUNDS, { padding: fitPadding(), animate: false });

loadData()
  .then(() => {
    ensureOverlays();
    renderPinList();
  })
  .catch((err: Error) => {
    $('#loading').classList.add('is-done');
    const banner = $('#error');
    banner.textContent = `Map overlays failed to load: ${err.message}. Try refreshing the page.`;
    banner.hidden = false;
  });
