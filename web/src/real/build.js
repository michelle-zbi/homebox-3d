// Static scene for the realistic style: slab, floors, full-height walls (the ones
// facing the camera drop down so you can see in), furniture and built-ins.
import * as THREE from 'three';
import { materials, worldUV } from './materials.js';
import { buildPiece, buildCrate, bx } from './pieces.js';

export const WALL_H = 2.5;
const WALL_T = 0.1;
const CUT_H = 0.32; // cut-away walls drop to this height

const FLOOR_BY_TYPE = {
  kitchen: 'plankFloor', bath: 'bathTile', powder: 'bathTile', laundry: 'bathTile', garage: 'concrete', storage: 'basement',
  living: 'parquet', dining: 'parquet', hall: 'parquet',
};

// One wall piece. Its origin is on the floor (scale.y lowers it for the cutaway).
function wallPiece(len, y0, y1, along, mat) {
  const h = y1 - y0;
  const g = worldUV(new THREE.BoxGeometry(len, h, WALL_T), len, h, WALL_T);
  g.translate(along, y0 + h / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// A wall of length `len` with openings: gaps = [{ t (centre along the wall), w, y0, y1 }].
// Returns a group of solid pieces around the openings, plus glass/frames for windows.
function wallWithGaps(len, gaps, mat) {
  const M = materials();
  const g = new THREE.Group();
  const sorted = [...gaps].sort((a, b) => a.t - b.t);
  let cur = -len / 2;
  for (const gap of sorted) {
    const a = gap.t - gap.w / 2;
    const b = gap.t + gap.w / 2;
    if (a > cur + 0.01) g.add(wallPiece(a - cur, 0, WALL_H, (cur + a) / 2, mat));
    if (gap.y0 > 0.01) g.add(wallPiece(gap.w, 0, gap.y0, gap.t, mat));
    if (gap.y1 < WALL_H - 0.01) g.add(wallPiece(gap.w, gap.y1, WALL_H, gap.t, mat));
    if (gap.window) {
      const pane = new THREE.Mesh(new THREE.BoxGeometry(gap.w, gap.y1 - gap.y0, 0.012), M.glass);
      pane.position.set(gap.t, (gap.y0 + gap.y1) / 2, 0);
      g.add(pane);
      // frame: sill, head, two jambs and a centre mullion (x, y are box centres)
      const H = gap.y1 - gap.y0;
      for (const [w, h, x, y] of [
        [gap.w, 0.05, gap.t, gap.y0 + 0.025],
        [gap.w, 0.05, gap.t, gap.y1 - 0.025],
        [0.05, H, gap.t - gap.w / 2 + 0.025, gap.y0 + H / 2],
        [0.05, H, gap.t + gap.w / 2 - 0.025, gap.y0 + H / 2],
        [0.04, H, gap.t, gap.y0 + H / 2],
      ]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, WALL_T + 0.02), M.blackSteel);
        f.position.set(x, y, 0);
        g.add(f);
      }
    } else {
      // door casing
      for (const sx of [-1, 1]) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.06, gap.y1, WALL_T + 0.03), M.trim);
        c.position.set(gap.t + sx * (gap.w / 2 + 0.03), gap.y1 / 2, 0);
        g.add(c);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(gap.w + 0.12, 0.06, WALL_T + 0.03), M.trim);
      top.position.set(gap.t, gap.y1 + 0.03, 0);
      g.add(top);
    }
    cur = b;
  }
  if (cur < len / 2 - 0.01) g.add(wallPiece(len / 2 - cur, 0, WALL_H, (cur + len / 2) / 2, mat));
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// Doors between rooms that share a wall, and windows in outside walls.
// Returns per-room, per-side openings and the door corridors for walking.
export function openings(layout) {
  const rooms = layout.floors.flatMap((f) => f.rooms.map((r) => ({ r, y: f.y, x0: r.wx - r.w / 2, x1: r.wx + r.w / 2, z0: r.wz - r.d / 2, z1: r.wz + r.d / 2 })));
  const gaps = new Map(rooms.map((o) => [o.r.id, { back: [], front: [], left: [], right: [] }]));
  const doors = [];
  const DOOR = 0.92, NEAR = 0.6;
  const adj = { back: false, front: false, left: false, right: false };
  const touches = new Map(rooms.map((o) => [o.r.id, { ...adj }]));
  for (let i = 0; i < rooms.length; i++) for (let j = 0; j < rooms.length; j++) {
    const a = rooms[i], b = rooms[j];
    if (i === j || a.y !== b.y) continue;
    // b to the right of a
    if (Math.abs(b.x0 - a.x1) < NEAR) {
      const lo = Math.max(a.z0, b.z0), hi = Math.min(a.z1, b.z1);
      if (hi - lo > 0.5) touches.get(a.r.id).right = true;
      if (hi - lo > DOOR + 0.5) {
        const zc = (lo + hi) / 2;
        gaps.get(a.r.id).right.push({ t: zc - a.r.wz, w: DOOR, y0: 0, y1: 2.1 });
        gaps.get(b.r.id).left.push({ t: zc - b.r.wz, w: DOOR, y0: 0, y1: 2.1 });
        doors.push({ x0: a.x1 - 0.7, x1: b.x0 + 0.7, z0: zc - DOOR / 2 + 0.12, z1: zc + DOOR / 2 - 0.12, y: a.y });
      }
    }
    // b in front of a (+z)
    if (Math.abs(b.z0 - a.z1) < NEAR) {
      const lo = Math.max(a.x0, b.x0), hi = Math.min(a.x1, b.x1);
      if (hi - lo > 0.5) touches.get(a.r.id).front = true;
      if (hi - lo > DOOR + 0.5) {
        const xc = (lo + hi) / 2;
        gaps.get(a.r.id).front.push({ t: xc - a.r.wx, w: DOOR, y0: 0, y1: 2.1 });
        gaps.get(b.r.id).back.push({ t: xc - b.r.wx, w: DOOR, y0: 0, y1: 2.1 });
        doors.push({ x0: xc - DOOR / 2 + 0.12, x1: xc + DOOR / 2 - 0.12, z0: a.z1 - 0.7, z1: b.z0 + 0.7, y: a.y });
      }
    }
  }
  // left/back adjacency mirrors right/front
  for (const a of rooms) for (const b of rooms) {
    if (a === b || a.y !== b.y) continue;
    if (Math.abs(a.x0 - b.x1) < NEAR && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 0.5) touches.get(a.r.id).left = true;
    if (Math.abs(a.z0 - b.z1) < NEAR && Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5) touches.get(a.r.id).back = true;
  }
  // windows: centred in outside walls that are long enough and free of tall furniture
  for (const o of rooms) {
    const t = touches.get(o.r.id);
    for (const side of ['back', 'front', 'left', 'right']) {
      if (t[side]) continue;
      const len = side === 'back' || side === 'front' ? o.r.w : o.r.d;
      if (len < 2.2) continue;
      const w = Math.min(2.6, len * 0.5);
      // back wall: windows sit above counters/furniture, so keep them high and narrow
      const y0 = side === 'back' ? 1.25 : 0.85;
      gaps.get(o.r.id)[side].push({ t: 0, w, y0, y1: 2.15, window: true });
    }
  }
  return { gaps, doors };
}

export function buildRealStatic(layout) {
  const M = materials();
  const root = new THREE.Group();
  const pickables = [];
  const furnitureGroups = {};
  const walls = []; // { mesh, normal (world, outward), centre }
  const ceilings = [];
  const lamps = [];
  const { gaps: holes, doors } = openings(layout);
  const slabMat = new THREE.MeshStandardMaterial({ color: '#1c2028', roughness: 0.95 });

  for (const fl of layout.floors) {
    const pad = 0.5;
    let slab;
    if (fl.outline) {
      const shape = new THREE.Shape(fl.outline.map(([x, z]) => new THREE.Vector2(x, -z)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: true, bevelSize: pad * 0.8, bevelThickness: 0.02, bevelSegments: 1 });
      g.rotateX(-Math.PI / 2);
      slab = new THREE.Mesh(g, slabMat);
      slab.position.set(fl.x, fl.y - 0.22, fl.z);
    } else {
      slab = bx(fl.w + pad * 2, 0.22, fl.d + pad * 2, slabMat, fl.x, fl.y - 0.22, fl.z);
    }
    slab.receiveShadow = true;
    root.add(slab);

    for (const room of fl.rooms) {
      const g = new THREE.Group();
      g.position.set(room.wx, room.wy, room.wz);
      g.userData = { kind: 'room', id: room.id, name: room.name };
      const floor = bx(room.w, 0.06, room.d, M[FLOOR_BY_TYPE[room.type] || 'oakFloor'], 0, 0, 0);
      floor.castShadow = false;
      g.add(floor);
      const hw = room.w / 2, hd = room.d / 2;
      const h = holes.get(room.id);
      // (rotation -π/2 on the side walls maps "along" to +z, matching the gap coordinates)
      for (const [side, len, x, z, rot, nx, nz] of [
        ['back', room.w, 0, -hd + WALL_T / 2, 0, 0, -1],
        ['front', room.w, 0, hd - WALL_T / 2, 0, 0, 1],
        ['left', room.d, -hw + WALL_T / 2, 0, -Math.PI / 2, -1, 0],
        ['right', room.d, hw - WALL_T / 2, 0, -Math.PI / 2, 1, 0],
      ]) {
        const m = wallWithGaps(len, h[side], M.wall);
        m.position.set(x, 0.06, z);
        m.rotation.y = rot;
        g.add(m);
        walls.push({ mesh: m, normal: new THREE.Vector3(nx, 0, nz), centre: new THREE.Vector3(room.wx + x, room.wy + 1.2, room.wz + z) });
      }
      // ceiling, only shown while walking
      const ceil = new THREE.Mesh(new THREE.BoxGeometry(room.w, 0.05, room.d), M.ceiling);
      ceil.position.set(0, WALL_H + 0.06 + 0.025, 0);
      ceil.visible = false;
      ceil.castShadow = true;
      g.add(ceil);
      ceilings.push(ceil);
      // where this room's ceiling light hangs (a small shared pool of lights visits the nearest rooms)
      lamps.push({ pos: new THREE.Vector3(room.wx, room.wy + WALL_H - 0.2, room.wz), intensity: 1.2 + room.w * room.d * 0.06, range: Math.max(room.w, room.d) * 1.4 });
      root.add(g);
      pickables.push(g);
    }
  }

  for (const f of Object.values(layout.furniture)) {
    const fg = buildPiece(f, { room: f.room?.type });
    fg.position.set(f.wx, f.wy + 0.06 + (f.mount || 0), f.wz);
    fg.rotation.y = f.rot || 0;
    fg.userData = { kind: f.kind === 'decor' ? 'decor' : 'furniture', id: f.id, name: f.name };
    for (const c of f.crates) fg.add(buildCrate(c));
    fg.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    root.add(fg);
    furnitureGroups[f.id] = fg;
    if (f.kind !== 'decor') pickables.push(fg);
  }

  return { root, pickables, furnitureGroups, walls, ceilings, doors, lamps };
}

// Drop the walls between the camera and each room's interior; raise the rest.
// Called every frame; eases so walls glide rather than pop.
export function updateCutaway(walls, camera, dt, allUp = false) {
  const k = 1 - Math.exp(-dt * 10);
  for (const w of walls) {
    const toCam = camera.position.clone().sub(w.centre);
    const facing = !allUp && toCam.x * w.normal.x + toCam.z * w.normal.z > 0;
    const target = facing ? CUT_H / WALL_H : 1;
    w.mesh.scale.y += (target - w.mesh.scale.y) * k;
  }
}
