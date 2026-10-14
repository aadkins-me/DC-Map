import type { RentalCriteria } from './criteria';

export interface RentalArea {
  /** Neighborhood cluster title shown in the popup. */
  name: string;
  /** [west, south, east, north] of the cluster. */
  bounds: [number, number, number, number];
  center: [number, number];
}

export interface SiteLink {
  id: 'redfin' | 'zillow' | 'hotpads' | 'craigslist';
  label: string;
  color: string;
  url: string;
  /** One-line summary shown under the button. */
  short: string;
  /** Tooltip: what is approximated or missing on this site. */
  detail: string;
}

const r5 = (n: number) => Number(n.toFixed(5));
const MILES_PER_DEG_LAT = 69.05;

function radiusMiles([w, s, e, n]: RentalArea['bounds']) {
  const midLat = ((s + n) / 2) * (Math.PI / 180);
  const dx = ((e - w) / 2) * MILES_PER_DEG_LAT * Math.cos(midLat);
  const dy = ((n - s) / 2) * MILES_PER_DEG_LAT;
  return Math.min(3, Math.max(0.5, Math.round(Math.hypot(dx, dy) * 10) / 10));
}

/** Map zoom that fits the area's width in a ~700px-wide results map. */
function fitZoom([w, , e]: RentalArea['bounds']) {
  return Math.min(16, Math.max(12, Math.floor(Math.log2((700 * 360) / (256 * Math.max(e - w, 0.001))))));
}

function describe(tags: string[], approx: string[]) {
  return {
    short: tags.join(' · '),
    detail: approx.length ? `Approximated: ${approx.join('; ')}` : 'Every criterion maps to a site filter.',
  };
}

// Redfin rentals: /filter/ segment. Supports half-bath minimums and an A/C amenity; no keyword search.
function redfin(a: RentalArea, c: RentalCriteria): SiteLink {
  const [w, s, e, n] = a.bounds;
  const f: string[] = [];
  if (c.beds) f.push(`min-beds=${c.beds}`);
  f.push(`min-baths=${c.baths}`);
  if (c.maxRent) f.push(`max-price=${c.maxRent}`);
  if (c.centralAir) f.push('air-conditioning');
  f.push(`viewport=${r5(n)}:${r5(s)}:${r5(e)}:${r5(w)}`);
  const approx: string[] = [];
  if (c.den) approx.push('no den/office filter or keyword search, check listings');
  if (c.centralAir) approx.push('A/C amenity (any type), heat not filterable');
  const tags = [`${c.baths}+ ba`, ...(c.den ? ['no den filter'] : []), ...(c.centralAir ? ['A/C'] : [])];
  return {
    id: 'redfin',
    label: 'Redfin',
    color: '#c82021',
    url: `https://www.redfin.com/city/12839/DC/Washington-DC/rentals/filter/${f.join(',')}`,
    ...describe(tags, approx),
  };
}

// Zillow: searchQueryState JSON. Accepts half-bath minimums, "Must have A/C" (ac) and a keyword (att).
function zillow(a: RentalArea, c: RentalCriteria): SiteLink {
  const [w, s, e, n] = a.bounds;
  const filterState: Record<string, unknown> = {
    fr: { value: true },
    fsba: { value: false },
    fsbo: { value: false },
    nc: { value: false },
    cmsn: { value: false },
    auc: { value: false },
    fore: { value: false },
    baths: { min: c.baths },
  };
  if (c.beds) filterState.beds = { min: c.beds };
  if (c.maxRent) filterState.mp = { max: c.maxRent };
  if (c.centralAir) filterState.ac = { value: true };
  if (c.den) filterState.att = { value: 'den' };
  const state = {
    isMapVisible: true,
    isListVisible: true,
    mapBounds: { west: r5(w), east: r5(e), south: r5(s), north: r5(n) },
    filterState,
  };
  const approx: string[] = [];
  if (c.den) approx.push('den matched by keyword');
  if (c.centralAir) approx.push('“Must have A/C” (any type), heat not filterable');
  const tags = [`${c.baths}+ ba`, ...(c.den ? ['“den”'] : []), ...(c.centralAir ? ['A/C'] : [])];
  return {
    id: 'zillow',
    label: 'Zillow',
    color: '#006aff',
    url: `https://www.zillow.com/washington-dc/rentals/?searchQueryState=${encodeURIComponent(JSON.stringify(state))}`,
    ...describe(tags, approx),
  };
}

// HotPads: query params. Supports half baths, A/C ("cooling") and heating amenities, and keywords.
function hotpads(a: RentalArea, c: RentalCriteria): SiteLink {
  const p = new URLSearchParams({
    lat: String(r5(a.center[1])),
    lon: String(r5(a.center[0])),
    z: String(fitZoom(a.bounds)),
    border: 'false',
  });
  if (c.beds) p.set('beds', `${c.beds}-8`);
  p.set('baths', String(c.baths));
  if (c.maxRent) p.set('price', `-${c.maxRent}`);
  if (c.centralAir) p.set('amenities', 'cooling-heating');
  if (c.den) p.set('keywords', 'den');
  const approx: string[] = [];
  if (c.den) approx.push('den matched by keyword');
  if (c.centralAir) approx.push('A/C and heating amenities (not specifically central)');
  const tags = [`${c.baths}+ ba`, ...(c.den ? ['“den”'] : []), ...(c.centralAir ? ['A/C + heat'] : [])];
  return {
    id: 'hotpads',
    label: 'HotPads',
    color: '#00a27e',
    url: `https://hotpads.com/washington-dc/${c.centralAir ? 'apartments-for-rent-with-air-conditioning' : 'apartments-for-rent'}?${p}`,
    ...describe(tags, approx),
  };
}

// Craigslist: whole-number bath minimums only; radius search around the area center; A/C checkbox; keyword OR syntax.
function craigslist(a: RentalArea, c: RentalCriteria): SiteLink {
  const p = new URLSearchParams({
    cat: 'apa',
    lat: String(r5(a.center[1])),
    lon: String(r5(a.center[0])),
    radius: String(radiusMiles(a.bounds)),
  });
  if (c.beds) p.set('min_bedrooms', String(c.beds));
  const baths = Math.floor(c.baths);
  p.set('min_bathrooms', String(baths));
  if (c.maxRent) p.set('max_price', String(c.maxRent));
  if (c.centralAir) p.set('airconditioning', '1');
  if (c.den) p.set('query', 'den | office');
  const approx: string[] = [];
  const radius = radiusMiles(a.bounds);
  if (baths !== c.baths) approx.push(`whole-number baths only, using ${baths}+`);
  if (c.den) approx.push('den or office matched by keyword');
  if (c.centralAir) approx.push('air conditioning checkbox (any type), heat not filterable');
  approx.push(`${radius} mi radius around the area center`);
  const tags = [`${baths}+ ba${baths !== c.baths ? '*' : ''}`, ...(c.den ? ['“den | office”'] : []), ...(c.centralAir ? ['A/C'] : []), `${radius} mi`];
  return {
    id: 'craigslist',
    label: 'Craigslist',
    color: '#5a3e85',
    url: `https://www.craigslist.org/search/city/washington-dc?${p}`,
    ...describe(tags, approx),
  };
}

export function buildLinks(area: RentalArea, c: RentalCriteria): SiteLink[] {
  return [zillow(area, c), redfin(area, c), hotpads(area, c), craigslist(area, c)];
}
