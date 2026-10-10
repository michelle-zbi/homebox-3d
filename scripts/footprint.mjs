#!/usr/bin/env node
// Fetch your building's outline from OpenStreetMap and save it as house.json,
// so the ground floor is laid out inside your real footprint.
//
//   npm run footprint -- "123 Main St, Springfield, IL"
//
// house.json is gitignored: it pins down where you live, so keep it out of public repos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', process.env.HOUSE_FILE || 'house.json');
const address = process.argv.slice(2).join(' ').trim();
if (!address) {
  console.error('usage: npm run footprint -- "<street address>"');
  process.exit(1);
}
const UA = { 'User-Agent': 'homebox-3d (https://github.com/) footprint lookup' };

async function geocode() {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&limit=5&q=${encodeURIComponent(address)}`;
  const hits = await (await fetch(url, { headers: UA })).json();
  if (!hits.length) throw new Error('Address not found on OpenStreetMap.');
  return hits.find((h) => h.category === 'building' && h.geojson?.type === 'Polygon') || hits[0];
}

// No building polygon on the address itself? Take the nearest building outline.
async function nearestBuilding(lat, lon) {
  const q = `[out:json];way(around:40,${lat},${lon})[building];out geom;`;
  const res = await (await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: UA, body: 'data=' + encodeURIComponent(q) })).json();
  const d = (w) => Math.hypot(...['lat', 'lon'].map((k) => w.geometry.reduce((s, p) => s + p[k], 0) / w.geometry.length - (k === 'lat' ? lat : lon)));
  const way = res.elements.sort((a, b) => d(a) - d(b))[0];
  if (!way) throw new Error('No building outline near that address on OpenStreetMap.');
  return { coords: way.geometry.map((p) => [p.lon, p.lat]), osm: `way/${way.id}` };
}

const hit = await geocode();
const { coords, osm } = hit.geojson?.type === 'Polygon'
  ? { coords: hit.geojson.coordinates[0], osm: `${hit.osm_type}/${hit.osm_id}` }
  : await nearestBuilding(+hit.lat, +hit.lon);

// lon/lat -> local metres (x east, z south), centred
const lat0 = coords.reduce((s, p) => s + p[1], 0) / coords.length;
const lon0 = coords.reduce((s, p) => s + p[0], 0) / coords.length;
const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
const ky = 110540;
let pts = coords.map(([lon, la]) => [(lon - lon0) * kx, -(la - lat0) * ky]);
if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();

// rotate so the walls line up with the axes (length-weighted dominant edge angle, mod 90°)
let sx = 0, sy = 0;
pts.forEach((p, i) => {
  const q = pts[(i + 1) % pts.length];
  const a = Math.atan2(q[1] - p[1], q[0] - p[0]) * 4;
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  sx += Math.cos(a) * len;
  sy += Math.sin(a) * len;
});
const rot = -Math.atan2(sy, sx) / 4;
pts = pts.map(([x, z]) => [x * Math.cos(rot) - z * Math.sin(rot), x * Math.sin(rot) + z * Math.cos(rot)]);

const area = Math.abs(pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0)) / 2;
const round = (v) => Math.round(v * 100) / 100;
fs.writeFileSync(out, JSON.stringify({ footprint: pts.map(([x, z]) => [round(x), round(z)]), rotation: round((rot * 180) / Math.PI), source: `OpenStreetMap ${osm} (ODbL)` }, null, 2) + '\n');
console.log(`Saved ${pts.length}-corner outline, ${Math.round(area)} m² (${Math.round(area * 10.764)} sq ft) -> ${path.basename(out)}`);
