// Downloads public GeoJSON from DC GIS (opendata.dc.gov) and writes slimmed copies to public/data.
// Usage: npm run fetch-data
import { writeFile, mkdir } from 'node:fs/promises';

const BASE = 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA';
const QUERY = 'query?where=1%3D1&outFields=*&outSR=4326&f=geojson';
const OUT = new URL('../public/data/', import.meta.url);

const round = (n) => Math.round(n * 1e5) / 1e5;
const roundCoords = (c) => (typeof c[0] === 'number' ? c.map(round) : c.map(roundCoords));

// Drop consecutive duplicate points created by rounding.
function dedupe(coords) {
  if (typeof coords[0][0] === 'number') {
    return coords.filter((p, i) => i === 0 || p[0] !== coords[i - 1][0] || p[1] !== coords[i - 1][1]);
  }
  return coords.map(dedupe);
}

async function get(path) {
  const res = await fetch(`${BASE}/${path}/${QUERY}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function slim(fc, pick) {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      const geometry = { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) };
      if (geometry.type !== 'Point') geometry.coordinates = dedupe(geometry.coordinates);
      return { type: 'Feature', properties: pick(f.properties), geometry };
    }),
  };
}

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function main() {
  await mkdir(OUT, { recursive: true });

  const clusters = await get('Administrative_Other_Boundaries_WebMercator/MapServer/17');
  const neighborhoods = slim(clusters, (p) => ({
    id: Number(p.NAME.replace('Cluster ', '')),
    cluster: p.NAME,
    names: p.NBH_NAMES,
    title: p.NBH_NAMES.split(',')[0].trim(),
    residential: p.TYPE === 'Original',
  }));

  const labels = slim(await get('Administrative_Other_Boundaries_WebMercator/MapServer/18'), (p) => ({
    name: p.LABEL_NAME || p.NAME,
  }));

  const boundary = slim(await get('Administrative_Other_Boundaries_WebMercator/MapServer/10'), () => ({}));

  const lines = slim(await get('Transportation_Rail_Bus_WebMercator/MapServer/58'), (p) => ({
    line: p.NAME.toLowerCase(),
    name: `${titleCase(p.NAME.toLowerCase())} Line`,
  }));

  const stations = slim(await get('Transportation_Rail_Bus_WebMercator/MapServer/51'), (p) => ({
    name: p.NAME,
    lines: p.LINE.split(',').map((s) => s.trim().toLowerCase()).join(','),
    address: p.ADDRESS,
    url: p.WEB_URL,
  }));

  const files = {
    'neighborhoods.geojson': neighborhoods,
    'neighborhood-labels.geojson': labels,
    'dc-boundary.geojson': boundary,
    'metro-lines.geojson': lines,
    'metro-stations.geojson': stations,
  };
  for (const [name, data] of Object.entries(files)) {
    await writeFile(new URL(name, OUT), JSON.stringify(data));
    console.log(`wrote public/data/${name} (${data.features.length} features)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
