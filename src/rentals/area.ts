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
    default:
      break;
  }
}

/** Search area for a clicked neighborhood cluster: its bounding box and center. */
export function rentalArea(cluster: GeoJSON.Feature, title: string): RentalArea {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  eachPosition(cluster.geometry, ([x, y]) => {
    w = Math.min(w, x); e = Math.max(e, x);
    s = Math.min(s, y); n = Math.max(n, y);
  });

  return { name: title, bounds: [w, s, e, n], center: [(w + e) / 2, (s + n) / 2] };
}
