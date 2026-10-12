import type { RentalArea } from './links';

type Position = number[];

function eachPosition(geom: GeoJSON.Geometry, fn: (p: Position) => void) {
  switch (geom.type) {
    case 'Polygon':
      geom.coordinates.forEach((ring) => ring.forEach(fn));
      break;
    case 'MultiPolygon':
      geom.coordinates.forEach((poly) => poly.forEach((ring) => ring.forEach(fn)));
      break;
    case 'Point':
      fn(geom.coordinates);
      break;
    default:
      break;
  }
}

function pointInRing([x, y]: [number, number], ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function contains(geom: GeoJSON.Geometry, pt: [number, number]) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return polys.some((rings) => pointInRing(pt, rings[0]) && !rings.slice(1).some((hole) => pointInRing(pt, hole)));
}

/**
 * Builds the search area for a clicked neighborhood cluster: its bounding box, and the local
 * neighborhood name closest to where the user tapped (used for sites that search by name).
 */
export function rentalArea(
  cluster: GeoJSON.Feature,
  title: string,
  labels: GeoJSON.FeatureCollection | undefined,
  at: [number, number],
): RentalArea {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  eachPosition(cluster.geometry, ([x, y]) => {
    w = Math.min(w, x); e = Math.max(e, x);
    s = Math.min(s, y); n = Math.max(n, y);
  });

  const kmPerDegLng = Math.cos((at[1] * Math.PI) / 180);
  let place = title;
  let best = Infinity;
  for (const f of labels?.features ?? []) {
    if (f.geometry.type !== 'Point') continue;
    const [x, y] = f.geometry.coordinates as [number, number];
    const inside = contains(cluster.geometry, [x, y]);
    const d = Math.hypot((x - at[0]) * kmPerDegLng, y - at[1]) * (inside ? 1 : 3);
    if (d < best) {
      best = d;
      place = String(f.properties?.name ?? title);
    }
  }

  return { place, cluster: title, bounds: [w, s, e, n], center: [(w + e) / 2, (s + n) / 2], at };
}
