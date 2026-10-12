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
      sources: {
        carto: {
          type: 'raster',
          tiles: ['a', 'b', 'c', 'd'].map((s) => `https://${s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png`),
          tileSize: 256,
          maxzoom: 20,
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
        },
      },
      layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
    },
  },
};
