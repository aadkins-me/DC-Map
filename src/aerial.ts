import type { Map as MlMap, ExpressionSpecification } from 'maplibre-gl';
import type { AerialMode } from './state';

export const AERIAL_SOURCE = 'dc-aerial';
const AERIAL_LAYER = 'dc-aerial';
const LABELS_SOURCE = 'aerial-labels';
const LABELS_LAYER = 'aerial-labels';

/** Auto mode fades the photos in between these zooms. */
export const FADE_START = 15.5;
export const FADE_END = 16.5;

export const AERIAL_MODES: { key: AerialMode; label: string }[] = [
  { key: 'auto', label: 'Auto' },
  { key: 'map', label: 'Always map' },
  { key: 'aerial', label: 'Always aerial' },
];

// DC OCTO 2025 orthophoto (3-inch, flown March 2025). It is a dynamic ImageServer with no tile
// cache, so each map tile is an exportImage call in Web Mercator. `jpgpng` keeps tiles outside
// the District transparent, so Maryland and Virginia fall back to the drawn map.
const ORTHO_SERVICE = 'https://imagery.dcgis.dc.gov/dcgis/rest/services/Ortho/Ortho_2025/ImageServer';
const ORTHO_TILE =
  `${ORTHO_SERVICE}/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857` +
  '&size=512,512&format=jpgpng&compressionQuality=82&bandIds=0,1,2&interpolation=RSP_BilinearInterpolation&f=image';
export const ORTHO_DATASET_URL = 'https://opendata.dc.gov/datasets/19d40ca7fd7947e88520367577673650';
export const AERIAL_ATTRIBUTION =
  `Aerial photos © 2025 <a href="${ORTHO_DATASET_URL}" target="_blank" rel="noopener">DC Office of the Chief Technology Officer</a> ` +
  '(<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>)';

const opacityFor = (mode: AerialMode): number | ExpressionSpecification =>
  mode === 'aerial' ? 1 : ['interpolate', ['linear'], ['zoom'], FADE_START, 0, FADE_END, 1];

/** How opaque the photos are at a zoom, 0–1. */
export function aerialAmount(mode: AerialMode, zoom: number): number {
  if (mode === 'map') return 0;
  if (mode === 'aerial') return 1;
  return Math.min(1, Math.max(0, (zoom - FADE_START) / (FADE_END - FADE_START)));
}

interface Halo {
  color: unknown;
  width: unknown;
}

/**
 * Adds DC aerial photos to the current style, under its labels and under our overlays,
 * and keeps the base map's street labels readable on top of the photos.
 */
export class AerialLayer {
  private mode: AerialMode = 'auto';
  private boosted = false;
  private savedHalos = new Map<string, Halo>();

  private map: MlMap;

  constructor(map: MlMap) {
    this.map = map;
    map.on('zoom', () => this.updateLabelBoost());
  }

  /** Call after every style load, before overlays are added. */
  install(rasterLabels: boolean) {
    const map = this.map;
    if (map.getLayer(AERIAL_LAYER)) return;
    this.savedHalos.clear();
    this.boosted = false;
    const before = map.getLayer('nbhd-fill') ? 'nbhd-fill' : map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    map.addSource(AERIAL_SOURCE, {
      type: 'raster',
      tiles: [ORTHO_TILE],
      tileSize: 256,
      maxzoom: 20,
      bounds: [-77.125, 38.79, -76.905, 39.0],
      attribution: AERIAL_ATTRIBUTION,
    });
    map.addLayer(
      {
        id: AERIAL_LAYER,
        type: 'raster',
        source: AERIAL_SOURCE,
        paint: { 'raster-opacity': opacityFor(this.mode), 'raster-fade-duration': 250, 'raster-opacity-transition': { duration: 450 } },
      },
      before,
    );
    // The Classic base is a picture with its labels baked in, so on photos it needs a labels-only layer.
    if (rasterLabels) {
      map.addSource(LABELS_SOURCE, {
        type: 'raster',
        tiles: ['a', 'b', 'c', 'd'].map((s) => `https://${s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}@2x.png`),
        tileSize: 256,
        maxzoom: 20,
        attribution: '© <a href="https://carto.com/attributions">CARTO</a>',
      });
      map.addLayer(
        { id: LABELS_LAYER, type: 'raster', source: LABELS_SOURCE, paint: { 'raster-opacity': opacityFor(this.mode), 'raster-opacity-transition': { duration: 450 } } },
        map.getLayer('nbhd-fill') ? 'nbhd-fill' : undefined,
      );
    }
    this.apply();
  }

  setMode(mode: AerialMode) {
    this.mode = mode;
    if (this.map.getLayer(AERIAL_LAYER)) this.apply();
  }

  private apply() {
    const map = this.map;
    const visible = this.mode !== 'map';
    // In Auto mode, skip requesting photos while they would be invisible.
    const minzoom = this.mode === 'auto' ? FADE_START - 0.25 : 0;
    for (const id of [AERIAL_LAYER, LABELS_LAYER]) {
      if (!map.getLayer(id)) continue;
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      map.setLayerZoomRange(id, minzoom, 24);
      map.setPaintProperty(id, 'raster-opacity', opacityFor(this.mode));
    }
    this.updateLabelBoost();
  }

  /** Swaps base-map label halos to solid white while the photos are mostly showing. */
  private updateLabelBoost() {
    const map = this.map;
    const want = aerialAmount(this.mode, map.getZoom()) >= 0.5;
    if (want === this.boosted || !map.getLayer(AERIAL_LAYER)) return;
    this.boosted = want;
    const style = map.getStyle();
    const aerialIndex = style.layers.findIndex((l) => l.id === AERIAL_LAYER);
    for (const layer of style.layers.slice(aerialIndex + 1)) {
      if (layer.type !== 'symbol' || layer.source === 'neighborhood-labels' || layer.source === 'metro-stations' || layer.source === 'landmarks') continue;
      if (!layer.layout?.['text-field']) continue;
      if (want) {
        if (!this.savedHalos.has(layer.id)) {
          this.savedHalos.set(layer.id, { color: map.getPaintProperty(layer.id, 'text-halo-color'), width: map.getPaintProperty(layer.id, 'text-halo-width') });
        }
        map.setPaintProperty(layer.id, 'text-halo-color', 'rgba(255,255,255,0.95)');
        map.setPaintProperty(layer.id, 'text-halo-width', 1.8);
      } else {
        const saved = this.savedHalos.get(layer.id);
        if (!saved) continue;
        map.setPaintProperty(layer.id, 'text-halo-color', saved.color as never);
        map.setPaintProperty(layer.id, 'text-halo-width', saved.width as never);
      }
    }
  }
}
