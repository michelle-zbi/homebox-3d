// Static geometry: floors, rooms, furniture, crates. Rebuilt whenever the layout changes.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { hash } from './layout.js';

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...opts });

const M = {
  slab: mat('#1b2029', { roughness: 0.95 }),
  slabEdge: mat('#262d39'),
  wall: mat('#d9d2c6', { roughness: 0.9 }),
  wood: mat('#b88757', { roughness: 0.7 }),
  woodDark: mat('#8a5f3c', { roughness: 0.7 }),
  woodLight: mat('#d8b48a', { roughness: 0.65 }),
  metal: mat('#8b939e', { roughness: 0.35, metalness: 0.6 }),
  shelfBoard: mat('#c9ccd2', { roughness: 0.5, metalness: 0.3 }),
  rug: mat('#3c4a63', { roughness: 1 }),
  tote: new THREE.MeshPhysicalMaterial({ color: '#cfe3ff', roughness: 0.25, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }),
  toteLid: mat('#3d6fd1', { roughness: 0.5 }),
};

// Warm, slightly different floor per room so they read as separate spaces.
const ROOM_FLOORS = ['#a7835f', '#8f9aa6', '#b39272', '#7f8c7d', '#a98f78', '#9a8a7a', '#b0866a', '#8c96a0'];

function box(w, h, d, material, x = 0, y = 0, z = 0, rounded = 0) {
  const g = rounded ? new RoundedBoxGeometry(w, h, d, 2, rounded) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function textTexture(text, { size = 64, weight = 700, color = '#000', opacity = 1, letterSpacing = 0 } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `${weight} ${size}px Inter, system-ui, sans-serif`;
  ctx.font = font;
  ctx.letterSpacing = `${letterSpacing}px`;
  const w = Math.ceil(ctx.measureText(text).width + size * 0.6);
  const h = Math.ceil(size * 1.5);
  c.width = w;
  c.height = h;
  ctx.font = font;
  ctx.letterSpacing = `${letterSpacing}px`;
  ctx.fillStyle = color;
  ctx.globalAlpha = opacity;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { texture: t, aspect: w / h };
}

// Text painted flat on the floor.
function floorText(text, height, opts) {
  const { texture, aspect } = textTexture(text, opts);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(height * aspect, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

function buildRoom(room, idx) {
  const g = new THREE.Group();
  g.position.set(room.wx, room.wy, room.wz);
  g.userData = { kind: 'room', id: room.id, name: room.name };

  const floor = box(room.w, 0.06, room.d, mat(ROOM_FLOORS[idx % ROOM_FLOORS.length], { roughness: 0.85 }), 0, 0, 0);
  floor.castShadow = false;
  g.add(floor);

  // low "walls-down" walls on all sides, so you can orbit freely
  const t = 0.07;
  const wh = 0.34;
  g.add(box(room.w, wh, t, M.wall, 0, 0.06, -room.d / 2 + t / 2));
  g.add(box(room.w, wh, t, M.wall, 0, 0.06, room.d / 2 - t / 2));
  g.add(box(t, wh, room.d, M.wall, -room.w / 2 + t / 2, 0.06, 0));
  g.add(box(t, wh, room.d, M.wall, room.w / 2 - t / 2, 0.06, 0));

  // big rooms get bigger lettering, but never wider than the room
  const lh = Math.min(0.75, Math.max(0.3, Math.min(room.w, room.d) * 0.075));
  const label = floorText(room.name.toUpperCase(), lh, { color: '#ffffff', opacity: 0.8, weight: 800, letterSpacing: 8 });
  const lw = label.geometry.parameters.width;
  if (lw > room.w * 0.85) label.scale.setScalar((room.w * 0.85) / lw);
  label.position.set(0, 0.065, room.d / 2 - 0.3 - lh * label.scale.x);
  g.add(label);
  return g;
}

function buildFurniture(f) {
  const g = new THREE.Group();
  g.position.set(f.wx, f.wy + 0.06, f.wz);
  g.userData = { kind: 'furniture', id: f.id, name: f.name };
  const { w, d, h } = f;
  const r = hash(f.name);

  if (f.kind === 'table') {
    const top = f.top;
    const topMat = r > 0.5 ? M.wood : M.woodLight;
    g.add(box(w, 0.05, d, topMat, 0, top - 0.05, 0, 0.015));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.05, top - 0.05, 0.05, M.woodDark, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06)));
  } else if (f.kind === 'bin') {
    const m = r > 0.5 ? M.woodDark : M.wood;
    const t = 0.04;
    g.add(box(w, 0.04, d, m, 0, 0, 0));
    g.add(box(w, h, t, m, 0, 0, -d / 2 + t / 2));
    g.add(box(w, h * 0.7, t, m, 0, 0, d / 2 - t / 2));
    g.add(box(t, h, d, m, -w / 2 + t / 2, 0, 0));
    g.add(box(t, h, d, m, w / 2 - t / 2, 0, 0));
  } else if (f.kind === 'rug') {
    const rug = box(w + 0.2, 0.015, d + 0.2, M.rug, 0, 0, 0, 0.007);
    rug.castShadow = false;
    g.add(rug);
  } else if (f.kind === 'case') {
    // open-front cabinet: you see straight into it
    const m = r > 0.4 ? M.wood : M.woodLight;
    const t = 0.04;
    g.add(box(t, h, d, m, -w / 2 + t / 2, 0, 0));
    g.add(box(t, h, d, m, w / 2 - t / 2, 0, 0));
    g.add(box(w, h, t, M.woodDark, 0, 0, -d / 2 + t / 2));
    g.add(box(w, t, d, m, 0, h - t, 0));
    for (const y of f.levels) g.add(box(w - 2 * t, 0.03, d - t, m, 0, y - 0.03, t / 2));
  } else {
    // metal frame shelving
    const p = 0.035;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(p, h, p, M.metal, sx * (w / 2 - p / 2), 0, sz * (d / 2 - p / 2)));
    for (const y of [...f.levels, h - 0.03]) g.add(box(w, 0.025, d, M.shelfBoard, 0, y - 0.025, 0));
  }

  for (const c of f.crates) g.add(buildCrate(c, f));
  return g;
}

function buildCrate(c) {
  const g = new THREE.Group();
  g.position.set(c.x, c.y, c.z);
  g.userData = { kind: 'crate', id: c.id, name: c.name };
  const shell = box(c.w, c.h, c.d, M.tote, 0, 0, 0, 0.02);
  shell.castShadow = false;
  g.add(shell);
  const rim = box(c.w + 0.02, 0.025, c.d + 0.02, M.toteLid, 0, c.h - 0.012, 0);
  g.add(rim);
  return g;
}

export function buildStatic(layout) {
  const root = new THREE.Group();
  const pickables = [];
  let roomIdx = 0;
  for (const fl of layout.floors) {
    const pad = 0.5;
    let slab;
    if (fl.outline) {
      // the building's real outline, grown a little so it frames the rooms
      const shape = new THREE.Shape(fl.outline.map(([x, z]) => new THREE.Vector2(x, -z)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: true, bevelSize: pad * 0.8, bevelThickness: 0.02, bevelSegments: 1 });
      g.rotateX(-Math.PI / 2);
      slab = new THREE.Mesh(g, M.slab);
      slab.position.set(fl.x, fl.y - 0.22, fl.z);
      slab.receiveShadow = true;
    } else {
      slab = box(fl.w + pad * 2, 0.22, fl.d + pad * 2, M.slab, fl.x, fl.y - 0.22, fl.z, 0.04);
      slab.castShadow = false;
    }
    root.add(slab);
    const name = fl.level === 0 ? 'GROUND FLOOR' : fl.level > 0 ? (fl.level === 1 ? 'UPSTAIRS' : `FLOOR ${fl.level + 1}`) : fl.level === -1 ? 'BASEMENT' : `LEVEL ${fl.level}`;
    const label = floorText(name, 0.32, { color: '#ffffff', opacity: 0.45, weight: 700, letterSpacing: 12 });
    // front-left corner of the slab (for an outline: its front-most, then left-most corner)
    const [ax, az] = fl.outline ? fl.outline.reduce((b, p) => (p[1] > b[1] + 0.5 || (Math.abs(p[1] - b[1]) <= 0.5 && p[0] < b[0]) ? p : b)) : [-fl.w / 2, fl.d / 2];
    label.position.set(fl.x + ax - pad + 0.1, fl.y + 0.001, fl.z + az + pad + 0.3);
    label.geometry.translate((label.geometry.parameters.width / 2), 0, 0);
    root.add(label);
    for (const room of fl.rooms) {
      const rg = buildRoom(room, roomIdx++);
      root.add(rg);
      pickables.push(rg);
    }
  }
  const furnitureGroups = {};
  for (const f of Object.values(layout.furniture)) {
    const fg = buildFurniture(f);
    furnitureGroups[f.id] = fg;
    root.add(fg);
    pickables.push(fg);
  }
  return { root, pickables, furnitureGroups };
}
