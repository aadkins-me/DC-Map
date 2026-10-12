export type MetroLine = 'red' | 'orange' | 'blue' | 'green' | 'yellow' | 'silver';

// Official WMATA brand colors.
export const METRO_COLORS: Record<MetroLine, string> = {
  red: '#BF0D3E',
  orange: '#ED8B00',
  blue: '#009CDE',
  green: '#00B140',
  yellow: '#FFD100',
  silver: '#919D9D',
};

export const METRO_LINE_ORDER: MetroLine[] = ['red', 'orange', 'blue', 'green', 'yellow', 'silver'];

export interface Station {
  name: string;
  lines: MetroLine[];
  address: string;
  url: string;
  lngLat: [number, number];
}

export function parseStations(fc: GeoJSON.FeatureCollection): Station[] {
  return fc.features.map((f) => {
    const p = f.properties as Record<string, string>;
    return {
      name: p.name,
      lines: p.lines.split(',').filter(Boolean) as MetroLine[],
      address: p.address,
      url: p.url,
      lngLat: (f.geometry as GeoJSON.Point).coordinates as [number, number],
    };
  });
}

export function distanceMiles(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

export function nearestStations(stations: Station[], from: [number, number], count = 3) {
  return stations
    .map((s) => ({ station: s, miles: distanceMiles(from, s.lngLat) }))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, count);
}

// Straight-line distance; real walking routes are typically ~20–30% longer.
export function walkMinutes(miles: number): number {
  return Math.max(1, Math.round(miles * 1.25 * 20));
}
