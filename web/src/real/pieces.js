// Furniture for the realistic style. Every builder returns a Group whose origin is
// the centre of the piece's footprint on the floor, facing +z (into the room).
// Storage pieces take their size, shelf heights and tabletop height from the layout,
// so the items placed by layout.js sit exactly on them.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { materials, worldUV } from './materials.js';
import { hash } from '../layout.js';
import { model } from './models.js';

// place a loaded model (or null if models aren't loaded yet)
function placed(id, x, z, rotY = 0, opts = {}, y = 0) {
  const m = model(id, opts);
  if (!m) return null;
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  return m;
}

// box with its bottom at y, metre-scaled UVs; r > 0 gives soft edges
export function bx(w, h, d, mat, x = 0, y = 0, z = 0, r = 0) {
  const g = r ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)) : worldUV(new THREE.BoxGeometry(w, h, d), w, h, d);
  if (r) scaleUV(g, Math.max(w, d), h);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function scaleUV(g, su, sv) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}
function cyl(r, h, mat, x = 0, y = 0, z = 0, seg = 20, rTop = r) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, r, h, seg), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const group = (...kids) => {
  const g = new THREE.Group();
  kids.flat().forEach((k) => k && g.add(k));
  return g;
};
// bar handle on a front face
const handle = (len, x, y, z, vertical = false) => {
  const M = materials();
  const h = bx(vertical ? 0.014 : len, vertical ? len : 0.014, 0.022, M.blackSteel, x, y - (vertical ? len / 2 : 0.007), z + 0.011);
  h.castShadow = false;
  return h;
};

// ---------------------------------------------------------------- storage

// open bookcase (wood) or a steel rack (garage/basement)
function shelving(f, ctx) {
  const M = materials();
  const { w, d, h, levels } = f;
  if (['garage', 'storage', 'laundry'].includes(ctx.room)) {
    const p = 0.035;
    const parts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(bx(p, h, p, M.blackSteel, sx * (w / 2 - p / 2), 0, sz * (d / 2 - p / 2)));
    for (const y of [...levels, h - 0.03]) parts.push(bx(w, 0.022, d, M.oak, 0, y - 0.022, 0));
    return group(parts);
  }
  const t = 0.028;
  const wood = hash(f.name) > 0.5 ? M.oak : M.walnut;
  const parts = [bx(t, h, d, wood, -w / 2 + t / 2, 0, 0), bx(t, h, d, wood, w / 2 - t / 2, 0, 0), bx(w, t, d, wood, 0, h - t, 0), bx(w, 0.08, d, wood, 0, 0, 0), bx(w - 2 * t, h, 0.012, wood, 0, 0, -d / 2 + 0.006)];
  for (const y of levels) if (y > 0.13) parts.push(bx(w - 2 * t, 0.022, d - 0.02, wood, 0, y - 0.022, 0.01));
  return group(parts);
}

// cabinet / wardrobe / dresser / console: a carcass with shelves and its doors swung open
function cabinet(f, ctx) {
  const M = materials();
  const { w, d, h, levels } = f;
  const t = 0.022;
  const body = /dresser|nightstand|console|media|tv|sideboard/i.test(f.name) ? (hash(f.name) > 0.4 ? M.walnut : M.oak) : M.cabinet;
  const parts = [bx(t, h, d, body, -w / 2 + t / 2, 0, 0), bx(t, h, d, body, w / 2 - t / 2, 0, 0), bx(w, t, d, body, 0, h - t, 0), bx(w, 0.07, d, body, 0, 0, 0), bx(w - 2 * t, h, 0.01, body, 0, 0, -d / 2 + 0.005)];
  for (const y of levels) if (y > 0.12) parts.push(bx(w - 2 * t, 0.02, d - 0.03, body, 0, y - 0.02, 0.015));
  // two doors, opened ~110° on their hinges
  const doorW = w / 2;
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * (w / 2), 0, d / 2);
    const door = bx(doorW, h - 0.08, 0.02, body, -s * doorW / 2, 0.07, 0.01);
    pivot.add(door, handle(0.14, -s * (doorW - 0.05), h * 0.55, 0.02, true));
    pivot.rotation.y = s * 1.9;
    parts.push(pivot);
  }
  // a TV on media consoles
  if (/console|media|tv/i.test(f.name) && !['garage', 'storage'].includes(ctx.room)) parts.push(tv(Math.min(1.45, w * 0.9), 0, h, -d / 2 + 0.12));
  return group(parts);
}

function tv(width, x, y, z) {
  const M = materials();
  const hgt = width * 0.5625;
  return group(bx(width, hgt, 0.03, M.screen, x, y + 0.09, z), bx(0.3, 0.02, 0.18, M.blackSteel, x, y, z + 0.02), bx(0.05, 0.1, 0.03, M.blackSteel, x, y, z));
}

function table(f, ctx) {
  const M = materials();
  const { w, d, top } = f;
  const parts = [];
  if (/workbench|bench/i.test(f.name) || ['garage', 'storage'].includes(ctx.room)) {
    parts.push(bx(w, 0.06, d, M.oak, 0, top - 0.06, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(bx(0.06, top - 0.06, 0.06, M.blackSteel, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06)));
    parts.push(bx(w - 0.1, 0.03, d - 0.1, M.oak, 0, 0.15, 0));
    return group(parts);
  }
  const isDesk = /desk/i.test(f.name) || ctx.room === 'office';
  parts.push(bx(w, 0.035, d, isDesk ? M.oak : M.walnut, 0, top - 0.035, 0, 0.008));
  if (isDesk) {
    for (const sx of [-1, 1]) {
      parts.push(bx(0.04, top - 0.035, 0.04, M.blackSteel, sx * (w / 2 - 0.05), 0, -d / 2 + 0.06));
      parts.push(bx(0.04, top - 0.035, 0.04, M.blackSteel, sx * (w / 2 - 0.05), 0, d / 2 - 0.06));
    }
    parts.push(officeChair(0, d / 2 + 0.45));
    const lamp = placed('desk_lamp_arm_01', w / 2 - 0.15, -d / 2 + 0.15, -Math.PI / 2, { height: 0.6 }, top);
    if (lamp) parts.push(lamp);
  } else {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(cyl(0.025, top - 0.035, M.walnut, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08), 12, 0.02));
  }
  return group(parts);
}

function officeChair(x, z) {
  const M = materials();
  const g = group(
    cyl(0.28, 0.03, M.blackSteel, 0, 0.04, 0, 5),
    cyl(0.025, 0.4, M.blackSteel, 0, 0.06, 0, 10),
    bx(0.5, 0.08, 0.48, M.fabric, 0, 0.46, 0, 0.03),
    bx(0.46, 0.5, 0.06, M.fabric, 0, 0.56, 0.24, 0.03),
  );
  g.position.set(x, 0, z);
  g.rotation.y = Math.PI;
  return g;
}

// bins: plastic tote, wooden chest, chest freezer or a cardboard box, by name
function bin(f) {
  const M = materials();
  const { w, d, h } = f;
  const t = 0.02;
  const walls = (mat, hh = h, lift = 0) => [bx(w, 0.03, d, mat, 0, lift, 0), bx(w, hh, t, mat, 0, lift, -d / 2 + t / 2), bx(w, hh, t, mat, 0, lift, d / 2 - t / 2), bx(t, hh, d, mat, -w / 2 + t / 2, lift, 0), bx(t, hh, d, mat, w / 2 - t / 2, lift, 0)];
  if (/freezer/i.test(f.name)) {
    const lid = new THREE.Group();
    lid.position.set(0, h + 0.3, -d / 2);
    lid.add(bx(w + 0.04, 0.06, d + 0.04, M.ceramic, 0, 0, d / 2 + 0.02, 0.02));
    lid.rotation.x = -1.2;
    return group(walls(M.ceramic, h + 0.3), lid);
  }
  if (/trunk|chest/i.test(f.name)) {
    const lid = new THREE.Group();
    lid.position.set(0, h, -d / 2);
    lid.add(bx(w + 0.03, 0.05, d + 0.03, M.walnut, 0, 0, d / 2));
    lid.rotation.x = -1.75;
    return group(walls(M.walnut), lid);
  }
  if (/tote|bin|crate/i.test(f.name)) return group(walls(M.tote), bx(w + 0.03, 0.03, d + 0.03, M.toteLid, 0, h - 0.015, 0));
  return group(walls(M.cardboard, h * 0.8));
}

// base cabinet with its top drawer pulled out
function drawerUnit(f, ctx) {
  const M = materials();
  const { w, d, pull, drawerDepth } = f;
  const front = ctx.room === 'kitchen' ? M.cabinet : M.oak;
  const parts = [bx(w, 0.82, d, front, 0, 0.08, 0), bx(w - 0.04, 0.08, d - 0.06, M.blackSteel, 0, 0, -0.03)];
  if (ctx.room === 'kitchen') parts.push(bx(w + 0.02, 0.04, d + 0.03, M.marble, 0, 0.9, 0.015));
  // the open drawer: sides + front panel sticking out
  const z0 = -d / 2 + 0.04 + pull;
  const z1 = z0 + drawerDepth + 0.02;
  const dw = w - 0.06;
  parts.push(bx(dw, 0.012, drawerDepth, M.linen, 0, 0.6, (z0 + z1) / 2));
  parts.push(bx(0.012, 0.12, drawerDepth, M.linen, -dw / 2, 0.6, (z0 + z1) / 2), bx(0.012, 0.12, drawerDepth, M.linen, dw / 2, 0.6, (z0 + z1) / 2));
  parts.push(bx(w - 0.01, 0.2, 0.02, front, 0, 0.58, z1), handle(Math.min(0.3, w * 0.5), 0, 0.71, z1));
  // lower drawer fronts on the carcass
  for (const y of [0.1, 0.33]) parts.push(handle(Math.min(0.3, w * 0.5), 0, y + 0.13, d / 2));
  return group(parts);
}

// wall cabinet with glass doors (mounted by the caller)
function wallCabinet(f) {
  const M = materials();
  const { w, d, h, levels } = f;
  const t = 0.02;
  const parts = [bx(t, h, d, M.cabinet, -w / 2 + t / 2, 0, 0), bx(t, h, d, M.cabinet, w / 2 - t / 2, 0, 0), bx(w, t, d, M.cabinet, 0, h - t, 0), bx(w, t, d, M.cabinet, 0, 0, 0), bx(w, h, 0.01, M.cabinet, 0, 0, -d / 2 + 0.005)];
  for (const y of levels) if (y > 0.05) parts.push(bx(w - 2 * t, 0.015, d - 0.03, M.glass, 0, y - 0.015, 0));
  const n = w > 1.1 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const dw = w / n;
    const x = -w / 2 + dw * (i + 0.5);
    parts.push(bx(dw - 0.006, h - 0.004, 0.012, M.glass, x, 0.002, d / 2 + 0.006));
    parts.push(bx(dw - 0.006, 0.03, 0.016, M.cabinet, x, 0.002, d / 2 + 0.006), bx(dw - 0.006, 0.03, 0.016, M.cabinet, x, h - 0.032, d / 2 + 0.006));
  }
  return group(parts);
}

// ---------------------------------------------------------------- built-ins

function baseCabinet(w, d, ctx, { top = true } = {}) {
  const M = materials();
  const parts = [bx(w, 0.82, d - 0.02, M.cabinet, 0, 0.08, -0.01), bx(w - 0.04, 0.08, d - 0.08, M.blackSteel, 0, 0, -0.04)];
  if (top) parts.push(bx(w + 0.005, 0.04, d + 0.02, ctx.room === 'kitchen' ? M.marble : M.oak, 0, 0.9, 0.01));
  return parts;
}

function fridge(f) {
  const M = materials();
  const { w, d, h } = f;
  return group(bx(w, h, d, M.steel, 0, 0, 0, 0.02), bx(0.004, h - 0.1, 0.01, M.blackSteel, 0, 0.05, d / 2 + 0.002), handle(0.6, -0.05, 1.5, d / 2 + 0.01, true), handle(0.6, 0.05, 1.5, d / 2 + 0.01, true));
}

function sink(f, ctx) {
  const M = materials();
  const { w, d } = f;
  const basin = bx(w * 0.62, 0.02, d * 0.55, M.blackSteel, 0, 0.915, 0.02);
  const faucet = group(cyl(0.018, 0.32, M.steel, 0, 0.94, -d / 2 + 0.1, 12), bx(0.03, 0.03, 0.22, M.steel, 0, 1.24, -d / 2 + 0.2));
  return group(baseCabinet(w, d, ctx), basin, faucet, handle(0.25, 0, 0.75, d / 2));
}

function dishwasher(f, ctx) {
  const M = materials();
  return group(baseCabinet(f.w, f.d, ctx), bx(f.w - 0.01, 0.78, 0.02, M.steel, 0, 0.1, f.d / 2 - 0.01), handle(f.w * 0.6, 0, 0.84, f.d / 2));
}

function range(f) {
  const M = materials();
  const { w, d } = f;
  const parts = [bx(w, 0.9, d, M.steel, 0, 0, 0, 0.01), bx(w - 0.02, 0.012, d - 0.04, M.screen, 0, 0.9, 0), bx(w, 0.1, 0.06, M.steel, 0, 0.9, -d / 2 + 0.03)];
  parts.push(bx(w - 0.14, 0.38, 0.01, M.screen, 0, 0.3, d / 2), handle(w - 0.2, 0, 0.74, d / 2 + 0.01));
  for (const [x, z] of [[-0.18, -0.12], [0.18, -0.12], [-0.18, 0.14], [0.18, 0.14]]) parts.push(cyl(0.09, 0.004, M.blackSteel, x, 0.912, z, 24));
  return group(parts);
}

function vanity(f) {
  const M = materials();
  const { w, d } = f;
  const parts = [bx(w, 0.8, d, M.walnut, 0, 0.05, 0), bx(w + 0.01, 0.04, d + 0.02, M.marble, 0, 0.85, 0.01)];
  parts.push(bx(w * 0.45, 0.12, d * 0.6, M.porcelain, 0, 0.89, 0.02, 0.04));
  parts.push(cyl(0.012, 0.2, M.steel, 0, 0.89, -d / 2 + 0.08, 10), bx(0.02, 0.02, 0.12, M.steel, 0, 1.07, -d / 2 + 0.13));
  parts.push(bx(Math.min(0.9, w * 0.9), 0.8, 0.02, M.mirror, 0, 1.2, -d / 2 + 0.01));
  return group(parts);
}

function toilet() {
  const M = materials();
  return group(bx(0.38, 0.4, 0.5, M.porcelain, 0, 0, 0.08, 0.08), bx(0.42, 0.05, 0.52, M.porcelain, 0, 0.4, 0.07, 0.03), bx(0.44, 0.38, 0.18, M.porcelain, 0, 0.42, -0.24, 0.04));
}

function tub(f) {
  const M = materials();
  const { w, d, h } = f;
  const t = 0.07;
  return group(bx(w, 0.1, d, M.porcelain, 0, 0, 0, 0.03), bx(w, h, t, M.porcelain, 0, 0, -d / 2 + t / 2, 0.03), bx(w, h, t, M.porcelain, 0, 0, d / 2 - t / 2, 0.03), bx(t, h, d, M.porcelain, -w / 2 + t / 2, 0, 0, 0.03), bx(t, h, d, M.porcelain, w / 2 - t / 2, 0, 0, 0.03), cyl(0.015, 0.25, M.steel, w / 2 - 0.15, h, -d / 2 + 0.05, 10));
}

function appliance(f, door = 'round') {
  const M = materials();
  const { w, d, h } = f;
  const parts = [bx(w, h, d, M.ceramic, 0, 0, 0, 0.03), bx(w - 0.04, 0.12, 0.02, M.cabinetDark, 0, h - 0.15, d / 2)];
  if (door === 'round') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 12, 32), M.steel);
    ring.position.set(0, h * 0.45, d / 2 + 0.01);
    const glassDoor = new THREE.Mesh(new THREE.CircleGeometry(0.19, 32), M.screen);
    glassDoor.position.set(0, h * 0.45, d / 2 + 0.005);
    parts.push(ring, glassDoor);
  }
  return group(parts);
}

// ---------------------------------------------------------------- centre pieces

function bed(f) {
  const M = materials();
  const { w, d } = f;
  const parts = [bx(w + 0.08, 0.28, d, M.walnut, 0, 0.06, 0, 0.01), bx(w + 0.1, 1.05, 0.08, M.walnut, 0, 0, -d / 2 + 0.04, 0.01)];
  parts.push(bx(w, 0.24, d - 0.12, M.linen, 0, 0.34, 0.04, 0.05));
  parts.push(bx(w + 0.04, 0.08, d * 0.62, M.duvet, 0, 0.56, d * 0.17, 0.04));
  const pillows = w > 1.4 ? 2 : 1;
  for (let i = 0; i < pillows; i++) parts.push(bx(w / pillows - 0.12, 0.14, 0.42, M.pillow, -w / 2 + (w / pillows) * (i + 0.5), 0.56, -d / 2 + 0.36, 0.06));
  parts.push(rugMesh(w + 1.0, d * 0.75, 0, d * 0.12));
  for (const sx of [-1, 1]) {
    const t = placed('side_table_01', sx * (w / 2 + 0.4), -d / 2 + 0.3, 0);
    if (t) parts.push(t);
  }
  const p = placed('potted_plant_04', w / 2 + 0.4, -d / 2 + 0.3, 0, {}, 0.45);
  if (p) parts.push(p);
  return group(parts);
}

function rugMesh(w, d, x = 0, z = 0) {
  const M = materials();
  const r = bx(w, 0.012, d, M.rug, x, 0.002, z, 0.005);
  r.castShadow = false;
  return r;
}

function sofa(w, x, z, rot = 0) {
  const M = materials();
  const d = 0.92;
  const g = group(
    bx(w, 0.12, d, M.blackSteel, 0, 0.0, 0, 0.01),
    bx(w, 0.3, d, M.fabric, 0, 0.1, 0, 0.04),
    bx(w - 0.3, 0.16, d - 0.25, M.fabric, 0, 0.4, 0.1, 0.06),
    bx(w, 0.45, 0.22, M.fabric, 0, 0.35, -d / 2 + 0.11, 0.06),
    bx(0.17, 0.25, d, M.fabric, -w / 2 + 0.085, 0.4, 0, 0.06),
    bx(0.17, 0.25, d, M.fabric, w / 2 - 0.085, 0.4, 0, 0.06),
  );
  for (let i = 0; i < 2; i++) g.add(bx(0.42, 0.38, 0.14, M.fabricWarm, -w / 2 + 0.45 + i * (w - 0.9), 0.52, -d / 2 + 0.3, 0.06));
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  return g;
}

function plant(x, z, s = 1) {
  const M = materials();
  const g = group(cyl(0.16 * s, 0.32 * s, M.pot, 0, 0, 0, 20, 0.19 * s));
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16 * s, 10, 8), M.plant);
    const a = (i / 7) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.1 * s, (0.5 + (i % 3) * 0.16) * s, Math.sin(a) * 0.1 * s);
    leaf.scale.set(1, 1.5, 0.6);
    leaf.castShadow = true;
    g.add(leaf);
  }
  g.position.set(x, 0, z);
  return g;
}

function floorLamp(x, z) {
  const M = materials();
  const shade = cyl(0.2, 0.3, M.linen, 0, 1.35, 0, 24, 0.16);
  const g = group(cyl(0.16, 0.02, M.blackSteel, 0, 0, 0, 24), cyl(0.012, 1.4, M.blackSteel, 0, 0.02, 0, 8), shade);
  g.position.set(x, 0, z);
  return g;
}

function lounge(f) {
  const M = materials();
  const { w, d } = f;
  const big = f.size === 'large';
  const sw = big ? 2.3 : 1.9;
  // sofa faces the back wall (where the TV/console is), so we look over its shoulder
  const parts = [rugMesh(w - 0.2, d - 0.1, 0, 0)];
  const realSofa = placed('Sofa_01', 0, d / 2 - 0.45, Math.PI, { width: Math.min(sw, 1.9) });
  if (realSofa) {
    parts.push(realSofa, placed('modern_coffee_table_01', 0, -0.05, Math.PI / 2));
    if (big) parts.push(placed('mid_century_lounge_chair', -sw / 2 - 0.1, -0.2, Math.PI * 0.75), placed('potted_plant_01', sw / 2 + 0.35, d / 2 - 0.35), floorLamp(sw / 2 - 0.1, d / 2 - 0.15));
    return group(parts);
  }
  parts.push(sofa(sw, 0, d / 2 - 0.5, Math.PI));
  parts.push(bx(big ? 1.1 : 0.9, 0.04, 0.6, M.walnut, 0, 0.38, -0.05, 0.01));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(cyl(0.018, 0.38, M.blackSteel, sx * (big ? 0.5 : 0.4), 0, -0.05 + sz * 0.25, 8));
  if (big) parts.push(floorLamp(sw / 2 + 0.25, d / 2 - 0.4), plant(-sw / 2 - 0.3, d / 2 - 0.3));
  return group(parts);
}

function dining(f) {
  const M = materials();
  const six = f.size === 'six';
  const tw = six ? 1.8 : 1.1;
  const td = six ? 0.95 : 1.0;
  const parts = [rugMesh(f.w - 0.1, f.d - 0.1), bx(tw, 0.04, td, M.walnut, 0, 0.72, 0, 0.01)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(cyl(0.025, 0.72, M.walnut, sx * (tw / 2 - 0.1), 0, sz * (td / 2 - 0.1), 12, 0.02));
  const seats = six ? [[-0.55, 1], [0, 1], [0.55, 1], [-0.55, -1], [0, -1], [0.55, -1]] : [[0, 1], [0, -1], [-1, 0], [1, 0]];
  for (const [sx, sz] of seats) {
    const side = sz === 0;
    const real = model('dining_chair_02');
    const c = real || chair();
    c.position.set(side ? sx * (tw / 2 + 0.3) : sx, 0, side ? 0 : sz * (td / 2 + 0.3));
    // the code chair's back is at +z; the model faces +z (back at -z), so it turns around
    const flip = real ? Math.PI : 0;
    c.rotation.y = (side ? (sx > 0 ? Math.PI / 2 : -Math.PI / 2) : sz > 0 ? 0 : Math.PI) + flip;
    parts.push(c);
  }
  return group(parts);
}

function chair() {
  const M = materials();
  const g = group(bx(0.44, 0.04, 0.44, M.oak, 0, 0.44, 0, 0.01), bx(0.44, 0.4, 0.03, M.oak, 0, 0.48, 0.2, 0.01));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(0.016, 0.44, M.oak, sx * 0.19, 0, sz * 0.19, 8));
  return g;
}

function stool(x, z) {
  const M = materials();
  const g = group(cyl(0.18, 0.05, M.leather, 0, 0.7, 0, 20), cyl(0.02, 0.7, M.blackSteel, 0, 0, 0, 8), cyl(0.2, 0.015, M.blackSteel, 0, 0, 0, 20));
  g.position.set(x, 0, z);
  return g;
}

function island(f) {
  const M = materials();
  const w = f.w - 0.2;
  const d = 0.95;
  const parts = [bx(w, 0.86, d - 0.25, M.cabinet, 0, 0.04, -0.12), bx(w + 0.1, 0.05, d, M.marble, 0, 0.9, 0)];
  const n = Math.max(2, Math.floor(w / 0.6));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w / n) * (i + 0.5);
    parts.push(placed('metal_stool_02', x, d / 2 + 0.3, 0, { height: 0.66 }) || stool(x, d / 2 + 0.25));
  }
  return group(parts);
}

// ---------------------------------------------------------------- cars
// Bodies are side profiles (x = length, nose at +x; y = height) extruded across the
// width with rounded edges: a fastback sedan and a rear-engined coupe.
const CAR_SHAPES = {
  sedan: {
    L: 4.7, W: 1.86, axles: [1.44, -1.43], tyre: 0.34, rim: '#3a3d42', glassRoof: true,
    body: [[-2.3, 0.24], [2.25, 0.24], [2.35, 0.34], [2.36, 0.5], [2.27, 0.63], [1.6, 0.86], [0.95, 0.96], [-1.3, 0.99], [-1.95, 1.01], [-2.25, 0.93], [-2.33, 0.72], [-2.33, 0.42]],
    cabin: [[0.95, 0.95], [0.12, 1.41], [-0.62, 1.44], [-1.78, 1.0], [-1.3, 0.98]],
    heads: 'strip', tails: 'strip',
  },
  coupe: {
    L: 4.52, W: 1.85, axles: [1.36, -1.08], tyre: 0.34, rim: '#c9ccd0', glassRoof: false,
    body: [[-2.2, 0.24], [2.15, 0.24], [2.25, 0.36], [2.23, 0.55], [1.92, 0.69], [1.2, 0.8], [0.66, 0.87], [-0.8, 0.91], [-1.6, 0.96], [-2.05, 0.89], [-2.26, 0.73], [-2.26, 0.42]],
    cabin: [[0.5, 0.88], [-0.05, 1.27], [-0.48, 1.3], [-1.05, 1.17], [-1.75, 0.95], [-0.8, 0.91]],
    heads: 'round', tails: 'bar',
  },
};

function profileMesh(points, width, mat, bevel = 0.1) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const depth = Math.max(0.05, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: 5, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Replace the flat bottom edge of a body profile with arches over each axle.
function withArches(body, axles, tyre) {
  const [rearBottom, frontBottom, ...rest] = body;
  const r = tyre + 0.07;
  const pts = [rearBottom];
  for (const a of [...axles].sort((p, q) => p - q)) {
    for (let k = 0; k <= 10; k++) {
      const t = Math.PI - (k / 10) * Math.PI;
      pts.push([a + Math.cos(t) * r, Math.max(rearBottom[1], tyre + Math.sin(t) * r)]);
    }
  }
  return [...pts, frontBottom, ...rest];
}

function carModel(spec) {
  const M = materials();
  const S = CAR_SHAPES[spec.model] || CAR_SHAPES.sedan;
  const silver = /^#c|^#b|^#d/i.test(spec.color || '');
  const paint = new THREE.MeshPhysicalMaterial({ color: spec.color || '#5b6470', metalness: silver ? 0.85 : 0.45, roughness: silver ? 0.28 : 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#0d1116', metalness: 0.2, roughness: 0.08, envMapIntensity: 0.35 });
  const g = group(profileMesh(withArches(S.body, S.axles, S.tyre), S.W, paint, 0.14));
  // the glasshouse: all glass on the sedan (glass roof); painted roof + glass sides on the coupe
  if (S.glassRoof) g.add(profileMesh(S.cabin, S.W - 0.26, glass, 0.08));
  else {
    g.add(profileMesh(S.cabin, S.W - 0.3, paint, 0.08));
    const inset = S.cabin.map(([x, y]) => [x * 0.9 - 0.05, 0.9 + (y - 0.9) * 0.82]);
    g.add(profileMesh(inset, S.W - 0.27, glass, 0.06));
  }
  const lit = (c, e) => new THREE.MeshStandardMaterial({ color: c, emissive: e, emissiveIntensity: 0.8, roughness: 0.2 });
  const front = S.body[3][0] - 0.03, rear = S.body[S.body.length - 1][0] + 0.02;
  if (S.heads === 'round') {
    for (const z of [-0.6, 0.6]) {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), lit('#f4f6f8', '#cfd8e0'));
      h.scale.set(0.6, 1, 1);
      h.position.set(S.L / 2 - 0.36, 0.72, z);
      g.add(h);
    }
  } else for (const z of [-0.62, 0.62]) g.add(bx(0.05, 0.05, 0.36, lit('#f4f6f8', '#cfd8e0'), front - 0.04, 0.6, z));
  if (S.tails === 'bar') g.add(bx(0.04, 0.06, S.W - 0.3, lit('#8a0d14', '#6a080d'), rear + 0.01, 0.8, 0));
  else for (const z of [-0.62, 0.62]) g.add(bx(0.04, 0.07, 0.4, lit('#8a0d14', '#6a080d'), rear + 0.01, 0.86, z));
  const rimMat = new THREE.MeshStandardMaterial({ color: S.rim, metalness: 0.9, roughness: 0.3 });
  for (const x of S.axles) for (const side of [-1, 1]) {
    const z = side * (S.W / 2 - 0.11);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(S.tyre, S.tyre, 0.25, 32), M.rubber);
    tyre.rotation.x = Math.PI / 2;
    tyre.position.set(x, S.tyre, z);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(S.tyre * 0.64, S.tyre * 0.64, 0.255, 32), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(x, S.tyre, z);
    g.add(tyre, rim);
    for (let k = 0; k < 5; k++) {
      const spoke = bx(0.035, S.tyre * 1.2, 0.02, M.blackSteel, 0, -S.tyre * 0.6, 0);
      const hub = new THREE.Group();
      hub.position.set(x, S.tyre, z + side * 0.13);
      hub.rotation.z = (k / 5) * Math.PI * 2;
      hub.add(spoke);
      g.add(hub);
    }
  }
  return g;
}

// one or more cars parked side by side, each with a painted bay line
function cars(f) {
  const M = materials();
  const parts = [];
  f.cars.forEach((spec, i) => {
    const z = -f.d / 2 + 1.125 + i * 2.25;
    const c = carModel(spec);
    c.position.set(0, 0, z);
    parts.push(c);
    const line = bx(f.w - 0.1, 0.004, 0.06, M.pillow, 0, 0.001, z + 1.1);
    line.castShadow = false;
    parts.push(line);
  });
  return group(parts);
}

// ---------------------------------------------------------------- dispatch

export function buildPiece(f, ctx) {
  switch (f.kind) {
    case 'frame': return shelving(f, ctx);
    case 'case': return cabinet(f, ctx);
    case 'table': return table(f, ctx);
    case 'bin': return bin(f);
    case 'drawer': return drawerUnit(f, ctx);
    case 'wall': return wallCabinet(f);
    case 'rug': return group(rugMesh(f.w + 0.3, f.d + 0.3));
    case 'decor':
      switch (f.piece) {
        case 'fridge': return fridge(f);
        case 'sink': return sink(f, ctx);
        case 'dishwasher': return dishwasher(f, ctx);
        case 'range': return range(f);
        case 'vanity': return vanity(f);
        case 'toilet': return toilet(f);
        case 'tub': return tub(f);
        case 'washer': return appliance(f, 'round');
        case 'dryer': return appliance(f, 'round');
        case 'bed': return bed(f);
        case 'lounge': return lounge(f);
        case 'dining': return dining(f);
        case 'island': return island(f);
        case 'cars': return cars(f);
        case 'rug': return group(rugMesh(f.w, f.d), placed('potted_plant_02', f.w / 2 + 0.2, -f.d / 2 + 0.2) || plant(f.w / 2 + 0.2, -f.d / 2 + 0.2, 0.9));
      }
  }
  return new THREE.Group();
}

export function buildCrate(c) {
  const M = materials();
  const g = group(bx(c.w, c.h, c.d, M.tote, 0, 0, 0, 0.02), bx(c.w + 0.02, 0.025, c.d + 0.02, M.toteLid, 0, c.h - 0.012, 0));
  g.position.set(c.x, c.y, c.z);
  g.userData = { kind: 'crate', id: c.id, name: c.name };
  return g;
}
