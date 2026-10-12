import * as maplibregl from 'maplibre-gl';
import type { LngLatLike, MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import './style.css';
import { BASEMAPS } from './basemaps';
import { CATEGORY_META, LANDMARKS, landmarksGeoJSON } from './data/landmarks';
import { METRO_COLORS, METRO_LINE_ORDER, nearestStations, parseStations, walkMinutes, type MetroLine, type Station } from './data/metro';
import { ALL_LAYERS, PIN_COLORS, parse, serialize, type AppState, type BaseKey, type LayerKey, type Pin } from './state';

const DATA = `${import.meta.env.BASE_URL}data/`;
const fitPadding = () =>
  window.matchMedia('(max-width: 720px)').matches ? { top: 60, bottom: 110, left: 16, right: 16 } : { top: 24, bottom: 24, left: 356, right: 70 };
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

const state: AppState = parse(location.hash);
let stations: Station[] = [];
let data: Record<string, GeoJSON.FeatureCollection> = {};
let selectedCluster: number | null = null;
let addPinMode = false;
let popup: maplibregl.Popup | null = null;
const markers: maplibregl.Marker[] = [];

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
  if (next.base !== state.base) setBase(next.base);
  map.jumpTo({ center: next.center, zoom: next.zoom });
  applyLayerVisibility();
  renderPins();
  renderPanel();
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
  const beforeLabels = firstSymbolLayer();

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
function setBase(base: BaseKey) {
  state.base = base;
  styleErrored = false;
  map.setStyle(BASEMAPS[base].style);
  renderPanel();
  syncUrl();
}

// The style and the bundled data load independently; whichever finishes last adds the overlays.
function ensureOverlays() {
  if (map.getStyle()?.layers?.length && map.isStyleLoaded()) addOverlays();
}
map.on('style.load', () => {
  ensureOverlays();
  $('#loading').classList.add('is-done');
});
map.on('styledata', ensureOverlays);
map.on('idle', ensureOverlays);

map.on('error', (e) => {
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

function openPopup(lngLat: LngLatLike, content: HTMLElement | string, className = '') {
  popup?.remove();
  popup = new maplibregl.Popup({ maxWidth: '320px', className, focusAfterOpen: false, offset: 12 }).setLngLat(lngLat);
  if (typeof content === 'string') popup.setHTML(content);
  else popup.setDOMContent(content);
  popup.addTo(map);
  popup.on('close', () => {
    if (popup?.isOpen() === false) selectCluster(null);
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
    <button class="btn btn-primary btn-sm" data-pin>Pin this spot</button>`;
  el.querySelector('[data-pin]')!.addEventListener('click', () => {
    addPin({ lng: at[0], lat: at[1], color: 0, label: p.title });
  });
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
      <button class="btn btn-primary btn-sm" data-done>Done</button>
    </div>`;
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
      const ll = marker.getLngLat();
      pin.lng = ll.lng;
      pin.lat = ll.lat;
      syncUrl();
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
  setAddPinMode(false);
  renderPins();
  renderPanel();
  applyLayerVisibility();
  syncUrl();
  pinPopup(state.pins.length - 1);
}

function setAddPinMode(on: boolean) {
  addPinMode = on;
  document.body.classList.toggle('adding-pin', on);
  document.querySelectorAll('[data-action="add-pin"]').forEach((b) => b.classList.toggle('is-active', on));
  if (on) {
    popup?.remove();
    toast('Tap the map to drop a pin');
  }
}

// ---------- Map interaction ----------
const CLICKABLE = ['landmarks', 'metro-stations', 'nbhd-fill'];
let hoverId: number | null = null;

map.on('mousemove', (e) => {
  if (!map.getLayer('nbhd-fill')) return;
  const layers = CLICKABLE.filter((id) => map.getLayoutProperty(id, 'visibility') !== 'none');
  const feats = map.queryRenderedFeatures(e.point, { layers });
  map.getCanvas().style.cursor = addPinMode ? 'crosshair' : feats.length ? 'pointer' : '';
  const hood = feats.find((f) => f.layer.id === 'nbhd-fill');
  const nextHover = hood ? (hood.id as number) : null;
  if (nextHover !== hoverId) {
    if (hoverId !== null) map.setFeatureState({ source: 'neighborhoods', id: hoverId }, { hover: false });
    if (nextHover !== null) map.setFeatureState({ source: 'neighborhoods', id: nextHover }, { hover: true });
    hoverId = nextHover;
  }
});

map.on('click', (e) => {
  const at: [number, number] = [e.lngLat.lng, e.lngLat.lat];
  if (addPinMode) {
    addPin({ lng: at[0], lat: at[1], color: 0, label: `Spot ${state.pins.length + 1}` });
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

// ---------- Panel ----------
const LAYER_UI: { key: LayerKey; label: string; hint: string; swatch: string }[] = [
  { key: 'neighborhoods', label: 'Neighborhood areas', hint: '46 DC neighborhood clusters', swatch: '<span class="sw sw-area"></span>' },
  { key: 'labels', label: 'Neighborhood names', hint: '130+ local names', swatch: '<span class="sw sw-text">Aa</span>' },
  { key: 'metro', label: 'Metro rail', hint: '6 lines · 98 stations', swatch: '<span class="sw sw-metro"></span>' },
  { key: 'landmarks', label: 'Landmarks', hint: `${LANDMARKS.length} key places`, swatch: '<span class="sw sw-landmark"></span>' },
  { key: 'pins', label: 'Your pins', hint: 'Saved in the share link', swatch: '<span class="sw sw-pin"></span>' },
  { key: 'boundary', label: 'DC border', hint: 'District boundary', swatch: '<span class="sw sw-border"></span>' },
];

function renderPanel() {
  $('#base-switch').innerHTML = (Object.keys(BASEMAPS) as BaseKey[])
    .map((k) => `<button class="seg${k === state.base ? ' is-active' : ''}" data-base="${k}" aria-pressed="${k === state.base}">${BASEMAPS[k].label}</button>`)
    .join('');

  $('#layer-list').innerHTML = LAYER_UI.map(
    (l) => `
    <label class="toggle">
      ${l.swatch}
      <span class="toggle-text"><span class="toggle-label">${l.label}</span><span class="toggle-hint">${l.hint}</span></span>
      <input type="checkbox" data-layer="${l.key}" ${state.layers.has(l.key) ? 'checked' : ''} />
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
  const goto = t.closest<HTMLElement>('[data-goto]')?.dataset.goto;
  if (goto !== undefined) {
    const pin = state.pins[Number(goto)];
    map.flyTo({ center: [pin.lng, pin.lat], zoom: Math.max(map.getZoom(), 15) });
    map.once('moveend', () => pinPopup(Number(goto)));
    if (window.matchMedia('(max-width: 720px)').matches) setPanelOpen(false);
  }
});

$('#panel').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const key = input.dataset.layer as LayerKey | undefined;
  if (!key) return;
  if (input.checked) state.layers.add(key);
  else state.layers.delete(key);
  applyLayerVisibility();
  syncUrl();
});

document.querySelectorAll('[data-action="add-pin"]').forEach((b) => b.addEventListener('click', () => setAddPinMode(!addPinMode)));
document.querySelectorAll('[data-action="share"]').forEach((b) => b.addEventListener('click', share));
$('#reset-view').addEventListener('click', () => map.fitBounds(DC_BOUNDS, { padding: fitPadding() }));
$('#clear-pins').addEventListener('click', () => {
  if (!state.pins.length || !confirm(`Remove all ${state.pins.length} pins?`)) return;
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
if (window.matchMedia('(max-width: 720px)').matches) setPanelOpen(false);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && addPinMode) setAddPinMode(false);
});

// ---------- Share ----------
async function share() {
  const c = map.getCenter();
  state.center = [c.lng, c.lat];
  state.zoom = map.getZoom();
  const url = `${location.origin}${location.pathname}${serialize(state)}`;
  history.replaceState(null, '', serialize(state));
  try {
    await navigator.clipboard.writeText(url);
    toast(state.pins.length ? `Link copied with ${state.pins.length} pin${state.pins.length > 1 ? 's' : ''}` : 'Link copied to clipboard');
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
renderPins();
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
