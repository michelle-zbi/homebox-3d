// Bridge between Homebox and the browser:
//   GET  /api/house            current snapshot
//   GET  /api/events           SSE: `house` on every inventory change, `focus` when asked to point at things
//   POST /api/focus            { queries: [...], caption? }  — used by the MCP server (show_in_3d)
//   POST /api/clear            drop the current focus
//   GET  /api/image/:id/:att   item photo proxy (keeps the Homebox token server-side)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHomebox } from './homebox.mjs';
import { resolveQueries } from './match.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.resolve(root, process.env.ENV_FILE || '.env'));

const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT || 7750);
const HOST = process.env.HOST || '127.0.0.1';
const POLL_MS = Number(process.env.POLL_MS || 1500);

if (!process.env.HOMEBOX_URL) {
  console.error('Set HOMEBOX_URL plus HOMEBOX_TOKEN (or HOMEBOX_EMAIL/HOMEBOX_PASSWORD) — see .env.example');
  process.exit(1);
}
const homebox = createHomebox({
  url: process.env.HOMEBOX_URL,
  token: process.env.HOMEBOX_TOKEN,
  email: process.env.HOMEBOX_EMAIL,
  password: process.env.HOMEBOX_PASSWORD,
});

// Optional local house details (gitignored): the building outline from
// scripts/footprint.mjs and the cars parked in the basement/garage. Re-read every poll.
const houseFile = path.resolve(root, process.env.HOUSE_FILE || 'house.json');
function readHouseFile() {
  try {
    const h = JSON.parse(fs.readFileSync(houseFile, 'utf8'));
    return { footprint: h.footprint || null, parking: h.parking || null };
  } catch {
    return { footprint: null, parking: null };
  }
}

let house = null;
let houseJson = '';
let lastFocus = null;
const clients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

async function poll() {
  try {
    const next = await homebox.snapshot();
    Object.assign(next, readHouseFile());
    const json = JSON.stringify(next);
    if (json !== houseJson) {
      const first = !house;
      house = next;
      houseJson = json;
      if (!first) broadcast('house', house);
      console.log(`[homebox] ${Object.values(house.nodes).filter((n) => n.kind === 'item').length} items`);
    }
  } catch (e) {
    console.error('[homebox]', e.message);
  } finally {
    setTimeout(poll, POLL_MS);
  }
}
await poll();

let vite;
if (DEV) {
  const { createServer } = await import('vite');
  vite = await createServer({ root, server: { middlewareMode: true, hmr: { port: PORT + 1000 } }, appType: 'spa' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/house') return json(res, house);

    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: house\ndata: ${houseJson || 'null'}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clients.delete(res); clearInterval(ping); });
      return;
    }

    if (url.pathname === '/api/focus' && req.method === 'POST') {
      const body = await readJson(req);
      const queries = [].concat(body.queries || body.query || []);
      // Pick up changes Claude just made through the Homebox MCP before resolving.
      house = await homebox.snapshot();
      Object.assign(house, readHouseFile());
      houseJson = JSON.stringify(house);
      broadcast('house', house);
      const result = resolveQueries(house, queries);
      lastFocus = { ...result, caption: body.caption || '', at: Date.now() };
      broadcast('focus', lastFocus);
      return json(res, { ...result, viewers: clients.size });
    }

    if (url.pathname === '/api/clear' && req.method === 'POST') {
      lastFocus = null;
      broadcast('focus', null);
      return json(res, { ok: true });
    }

    const img = url.pathname.match(/^\/api\/image\/([\w-]+)\/([\w-]+)$/);
    if (img) {
      const up = await homebox.image(img[1], img[2]);
      res.writeHead(200, { 'Content-Type': up.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'max-age=3600' });
      return res.end(Buffer.from(await up.arrayBuffer()));
    }

    if (vite) return vite.middlewares(req, res);
    return serveStatic(url.pathname, res);
  } catch (e) {
    console.error(e);
    res.writeHead(500).end(e.message);
  }
});

server.listen(PORT, HOST, () => console.log(`homebox-3d on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));

function json(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
function serveStatic(p, res) {
  const dist = path.join(root, 'dist');
  let file = path.join(dist, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end('Run `npm run build` first (or `npm run dev`).');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
