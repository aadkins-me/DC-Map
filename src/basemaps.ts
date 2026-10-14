import type { StyleSpecification } from 'maplibre-gl';
import type { BaseKey } from './state';

export const BASEMAPS: Record<BaseKey, { label: string; style: string | StyleSpecification; font: string[]; boldFont: string[] }> = {
  streets: {
    label: 'Streets',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    font: ['Noto Sans Regular'],
    boldFont: ['Noto Sans Bold'],
  },
  light: {
    label: 'Light',
    style: 'https://tiles.openfreemap.org/styles/positron',
    font: ['Noto Sans Regular'],
    boldFont: ['Noto Sans Bold'],
  },
  // Raster fallback that does not depend on the OpenFreeMap vector service.
  raster: {
    label: 'Classic',
    font: ['Open Sans Semibold'],
    boldFont: ['Open Sans Semibold'],
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      // OpenStreetMap's standard tiles: keyless, fine for a low-traffic personal site under the OSM
      // tile usage policy (browser requests send a valid Referer; attribution is required).
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        },
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    },
  },
};
