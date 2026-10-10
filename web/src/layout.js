// Pure layout: Homebox snapshot -> floors, rooms, furniture and item slots in
// world units (≈ metres). No three.js here so it stays easy to reason about.
//
//   top-level location  -> room (floor picked from its name: attic/upstairs, basement…)
//   location in a room  -> furniture, shape picked from its name (shelf, desk, tote…)
//   deeper location     -> a tote/crate sitting in its parent furniture
//   item                -> a little block in a slot

const ITEM = 0.26; // base item footprint
const PITCH = 0.34; // item spacing on a surface
const MINI = 0.13; // items inside a crate
const MINI_PITCH = 0.17;

export const FLOOR_RISE = 2.6; // vertical offset between floors
const FLOOR_STEP = 3.5; // extra depth gap between floors (exploded "staircase" view)
const ROOM_GAP = 0.35;

const FLOOR_RULES = [
  [/attic|upstairs|loft|2nd floor|second floor|floor 2|upper/i, 1],
  [/basement|cellar|crawl ?space|lower level/i, -1],
];

const KIND_RULES = [
  [/\b(desk|table|bench|counter|island|workbench|bike rack)\b/i, 'table'],
  [/\b(totes?|bins?|box(es)?|crates?|baskets?|bags?|trunks?|chests?|drawers?|freezer|buckets?|piles?|corner|suitcases?|hamper)\b/i, 'bin'],
  [/\b(cabinet|closet|wardrobe|dresser|filing|nightstand|console|cupboard|locker|hutch|armoire|vanity|pantry|sideboard)\b/i, 'case'],
  [/shel(f|ves|ving)|rack|bookcase|bookshelf|stand|cart/i, 'frame'],
];

export function floorOf(name) {
  for (const [re, f] of FLOOR_RULES) if (re.test(name)) return f;
  return 0;
}

export function furnitureKind(name) {
  for (const [re, k] of KIND_RULES) if (re.test(name)) return k;
  return 'frame';
}

export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

// Item block dimensions, varied a little per name so shelves don't look like a spreadsheet.
export function itemDims(item, mini = false) {
  const base = mini ? MINI : ITEM;
  const r = hash(item.name);
  const r2 = hash(item.name + '#');
  const q = Math.min(0.45, Math.log10(Math.max(1, item.qty || 1)) * 0.22);
  return {
    w: base * (0.8 + r * 0.35) * (1 + q),
    h: base * (0.65 + r2 * 0.85) * (1 + q * 0.6),
    d: base * (0.8 + r2 * 0.3),
  };
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });

// ---- crates (locations nested inside furniture) --------------------------------

function crateLayout(house, node) {
  // flatten everything below this crate into mini items
  const items = [];
  const collect = (id) => {
    for (const c of house.nodes[id].children.map((x) => house.nodes[x]).sort(byName)) {
      if (c.kind === 'item') items.push(c);
      else collect(c.id);
    }
  };
  collect(node.id);
  const cols = Math.max(2, Math.ceil(Math.sqrt(items.length * 1.6)));
  const rows = Math.max(1, Math.ceil(items.length / cols));
  const w = Math.max(0.42, cols * MINI_PITCH + 0.1);
  const d = Math.max(0.34, rows * MINI_PITCH + 0.1);
  const h = 0.3;
  const slots = items.map((it, i) => {
    const cx = (i % cols) - (cols - 1) / 2;
    const cz = Math.floor(i / cols) - (rows - 1) / 2;
    return { id: it.id, x: cx * MINI_PITCH, z: cz * MINI_PITCH, y: 0.03, dims: itemDims(it, true) };
  });
  return { id: node.id, name: node.name, w, d, h, slots };
}

// ---- furniture -----------------------------------------------------------------

function contentsOf(house, node) {
  const kids = node.children.map((id) => house.nodes[id]);
  const crates = kids.filter((k) => k.kind === 'location').sort(byName).map((k) => ({ crate: crateLayout(house, k) }));
  const items = kids.filter((k) => k.kind === 'item').sort(byName).map((k) => ({ item: k, dims: itemDims(k) }));
  return [...crates, ...items].map((c) => ({
    ...c,
    w: c.crate ? c.crate.w + 0.06 : PITCH * Math.max(1, c.dims.w / ITEM),
    d: c.crate ? c.crate.d : c.dims.d,
    h: c.crate ? c.crate.h + 0.12 : c.dims.h,
  }));
}

// Greedy row packing: fill rows up to maxW.
function packRows(contents, maxW) {
  const rows = [];
  let row = null;
  for (const c of contents) {
    if (!row || (row.w + c.w > maxW && row.items.length)) rows.push((row = { items: [], w: 0, d: 0, h: 0 }));
    row.items.push(c);
    row.w += c.w;
    row.d = Math.max(row.d, c.d);
    row.h = Math.max(row.h, c.h);
  }
  return rows;
}

function placeRow(row, width, y, z, out) {
  let x = -row.w / 2;
  for (const c of row.items) {
    const cx = x + c.w / 2;
    if (c.crate) out.crates.push({ ...c.crate, x: cx, y, z });
    else out.slots.push({ id: c.item.id, x: cx, y, z, dims: c.dims });
    x += c.w;
  }
}

function furnitureLayout(house, node) {
  const kind = furnitureKind(node.name);
  const contents = contentsOf(house, node);
  const total = contents.reduce((s, c) => s + c.w, 0) || PITCH;
  const out = { id: node.id, name: node.name, kind, slots: [], crates: [], levels: [] };

  if (kind === 'table') {
    const width = Math.min(2.6, Math.max(1.2, total / 2 + 0.3));
    const rows = packRows(contents, width - 0.2);
    const depth = Math.max(0.75, rows.reduce((s, r) => s + r.d + 0.08, 0.2));
    const top = 0.74;
    let z = -depth / 2 + 0.1;
    for (const r of rows) {
      placeRow(r, width, top + 0.03, z + r.d / 2, out);
      z += r.d + 0.08;
    }
    return { ...out, w: width, d: depth, h: top + 0.03, top };
  }

  if (kind === 'bin') {
    // a big floor crate; contents sit inside in a grid
    const width = Math.min(2.2, Math.max(0.8, Math.sqrt(total) * 0.8 + 0.2));
    const rows = packRows(contents, width - 0.12);
    const depth = Math.max(0.6, rows.reduce((s, r) => s + r.d + 0.04, 0.12));
    let z = -depth / 2 + 0.06;
    for (const r of rows) {
      placeRow(r, width, 0.06, z + r.d / 2, out);
      z += r.d + 0.04;
    }
    return { ...out, w: width, d: depth, h: 0.55 };
  }

  // frame / case: shelves stacked vertically, one row per level
  let levels = 1;
  while (levels < 5 && total / levels > 1.9) levels++;
  const width = Math.max(0.9, Math.min(2.4, total / levels + 0.2));
  const rows = packRows(contents, width - 0.14);
  const depth = Math.max(0.5, ...rows.map((r) => r.d + 0.14));
  let y = 0.12;
  for (const r of rows) {
    out.levels.push(y);
    placeRow(r, width, y + 0.025, 0, out);
    y += Math.max(0.42, r.h + 0.16);
  }
  if (!rows.length) {
    out.levels.push(y);
    y += 0.42;
  }
  return { ...out, w: width, d: depth, h: y + 0.03 };
}

// Loose items sitting directly in a room become a rug "pile".
function looseLayout(room, items) {
  const contents = items.sort(byName).map((k) => ({ item: k, dims: itemDims(k), w: PITCH, d: itemDims(k).d, h: 0 }));
  const width = Math.min(2.4, Math.max(0.9, Math.sqrt(contents.length) * PITCH + 0.3));
  const rows = packRows(contents, width - 0.1);
  const depth = rows.reduce((s, r) => s + r.d + 0.1, 0.2);
  const out = { id: room.id + ':floor', name: 'Floor', kind: 'rug', slots: [], crates: [], levels: [] };
  let z = -depth / 2 + 0.1;
  for (const r of rows) {
    placeRow(r, width, 0.02, z + r.d / 2, out);
    z += r.d + 0.1;
  }
  return { ...out, w: width, d: depth, h: 0.02 };
}

// ---- rooms ---------------------------------------------------------------------

function roomLayout(house, node) {
  const kids = node.children.map((id) => house.nodes[id]);
  const furniture = kids.filter((k) => k.kind === 'location').sort(byName).map((k) => furnitureLayout(house, k));
  const loose = kids.filter((k) => k.kind === 'item');
  if (loose.length) furniture.push(looseLayout(node, loose));
  const room = { id: node.id, name: node.name, floor: floorOf(node.name), furniture };
  const totalW = furniture.reduce((sum, f) => sum + f.w + FURN_GAP, 0);
  const rowCount = Math.max(1, Math.ceil(totalW / 7.5));
  room.rowW = Math.max(3.2, totalW / rowCount + FURN_GAP);
  const { w, d } = arrangeRoom(room, room.rowW);
  room.minW = Math.max(2.2, ...furniture.map((f) => f.w + 0.6));
  return Object.assign(room, { w: Math.max(3.2, w), d: Math.max(2.6, d) });
}

const FURN_GAP = 0.45;

// Furniture in rows against the back wall, facing +z (the open side of the dollhouse).
// Positions are relative to the room centre (x) and back wall (z). Returns the space used.
function arrangeRoom(room, maxRowW) {
  const rows = [];
  let row = null;
  for (const f of room.furniture) {
    if (!row || (row.w + f.w > maxRowW && row.items.length)) rows.push((row = { items: [], w: 0, d: 0 }));
    row.items.push(f);
    row.w += f.w + FURN_GAP;
    row.d = Math.max(row.d, f.d);
  }
  let z = 0.3;
  for (const r of rows) {
    let x = -r.w / 2 + FURN_GAP / 2;
    for (const f of r.items) {
      f.x = x + f.w / 2;
      f.z = z + f.d / 2;
      x += f.w + FURN_GAP;
    }
    z += r.d + 0.9;
  }
  return { w: Math.max(0, ...rows.map((r) => r.w + 0.6)), d: z + 0.5 };
}

// Pack rooms of one floor into bands (rows of rooms sharing a depth). Tries every
// band count, balancing widths, and keeps the plan closest to a pleasant aspect.
function packFloor(rooms) {
  rooms.sort((a, b) => b.w * b.d - a.w * a.d || a.name.localeCompare(b.name));
  let best = null;
  for (let k = 1; k <= rooms.length; k++) {
    const bands = Array.from({ length: k }, () => ({ rooms: [], w: -ROOM_GAP, d: 0 }));
    for (const r of rooms) {
      const b = bands.reduce((m, x) => (x.w < m.w ? x : m));
      b.rooms.push(r);
      b.w += r.w + ROOM_GAP;
      b.d = Math.max(b.d, r.d);
    }
    const W = Math.max(...bands.map((b) => b.w));
    const D = bands.reduce((s, b) => s + b.d + ROOM_GAP, -ROOM_GAP);
    // penalise empty space from stretching and plans far from ~1.7:1
    const used = rooms.reduce((s, r) => s + r.w * r.d, 0);
    const score = Math.abs(Math.log(W / D / 1.7)) + (1 - used / (W * D)) * 1.5;
    if (!best || score < best.score) best = { score, bands, W, D };
  }
  const { bands, W, D } = best;
  let z = -D / 2;
  for (const b of bands) {
    const extra = (W - b.w) / b.rooms.length;
    let x = -W / 2;
    b.rooms.sort((a, c) => a.name.localeCompare(c.name));
    for (const r of b.rooms) {
      r.w += extra;
      r.d = b.d;
      r.x = x + r.w / 2;
      r.z = z + r.d / 2;
      x += r.w + ROOM_GAP;
    }
    z += b.d + ROOM_GAP;
  }
  return { w: W, d: D };
}

// ---- real footprint ------------------------------------------------------------
// With a building outline (house.json), the ground floor becomes a floor plan:
// the outline is cut into rectangles ("wings"), rooms are grouped by kind so living
// spaces and bedrooms cluster, and each wing is split into rooms sized like real ones.

const ROOM_KINDS = [
  [/living|great room|lounge/i, 0, 30], [/dining/i, 1, 15], [/kitchen/i, 2, 18], [/family|den|media|tv|play/i, 3, 22],
  [/entry|foyer|hall|mud/i, 4, 8], [/laundry|utility/i, 5, 6], [/office|study|library/i, 6, 11],
  [/primary bed|master bed/i, 7, 20], [/primary bath|master bath|en ?suite/i, 8, 9], [/bed|guest|nursery/i, 9, 13],
  [/powder|half bath/i, 11, 3.5], [/bath/i, 10, 7], [/closet/i, 12, 3], [/garage|carport/i, 13, 36],
];
function roomKind(name) {
  for (const [re, order, area] of ROOM_KINDS) if (re.test(name)) return { order, area };
  return { order: 12.5, area: 12 };
}

function polyContains(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Cover a (roughly rectilinear) polygon with a few big rectangles.
function rectangles(poly) {
  const C = 0.25;
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  const x0 = Math.min(...xs), z0 = Math.min(...zs);
  const nx = Math.ceil((Math.max(...xs) - x0) / C), nz = Math.ceil((Math.max(...zs) - z0) / C);
  const grid = Array.from({ length: nz }, (_, j) => Array.from({ length: nx }, (_, i) => polyContains(poly, x0 + (i + 0.5) * C, z0 + (j + 0.5) * C)));
  const total = grid.flat().filter(Boolean).length;
  const rects = [];
  for (;;) {
    // largest all-true rectangle (histogram method)
    const h = new Array(nx).fill(0);
    let best = { area: 0 };
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) h[i] = grid[j][i] ? h[i] + 1 : 0;
      const stack = [];
      for (let i = 0; i <= nx; i++) {
        const cur = i < nx ? h[i] : 0;
        while (stack.length && h[stack.at(-1)] >= cur) {
          const top = stack.pop();
          const left = stack.length ? stack.at(-1) + 1 : 0;
          const area = h[top] * (i - left);
          if (area > best.area) best = { area, i0: left, i1: i, j0: j - h[top] + 1, j1: j + 1 };
        }
        stack.push(i);
      }
    }
    if (!best.area || best.area < total * 0.06 || best.area * C * C < 6) break;
    for (let j = best.j0; j < best.j1; j++) for (let i = best.i0; i < best.i1; i++) grid[j][i] = false;
    rects.push({ x: x0 + best.i0 * C, z: z0 + best.j0 * C, w: (best.i1 - best.i0) * C, d: (best.j1 - best.j0) * C });
  }
  return rects;
}

// Squarified treemap: split rect r among weights, keeping cells close to square.
function squarify(weights, r) {
  const total = weights.reduce((a, b) => a + b, 0);
  const items = weights.map((w, i) => ({ i, a: (w / total) * r.w * r.d }));
  const out = new Array(weights.length);
  let { x, z, w, d } = r;
  const worst = (row, side) => {
    const sum = row.reduce((s, it) => s + it.a, 0);
    return Math.max(...row.map((it) => Math.max((side * side * it.a) / (sum * sum), (sum * sum) / (side * side * it.a))));
  };
  let row = [];
  const flush = () => {
    const sum = row.reduce((s, it) => s + it.a, 0);
    if (w >= d) {
      const cw = sum / d;
      let cz = z;
      for (const it of row) { const ch = it.a / cw; out[it.i] = { x, z: cz, w: cw, d: ch }; cz += ch; }
      x += cw; w -= cw;
    } else {
      const ch = sum / w;
      let cx = x;
      for (const it of row) { const cw = it.a / ch; out[it.i] = { x: cx, z, w: cw, d: ch }; cx += cw; }
      z += ch; d -= ch;
    }
    row = [];
  };
  for (const it of items) {
    const side = Math.min(w, d);
    if (row.length && worst([...row, it], side) > worst(row, side)) flush();
    row.push(it);
  }
  if (row.length) flush();
  return out;
}

function packFootprint(rooms, footprint) {
  // lay the long side along x so it suits a landscape screen
  let poly = footprint;
  const span = (k) => Math.max(...poly.map((p) => p[k])) - Math.min(...poly.map((p) => p[k]));
  if (span(1) > span(0)) poly = poly.map(([x, z]) => [-z, x]);
  const base = rectangles(poly);
  const ordered = rooms.map((r) => ({ r, k: roomKind(r.name) })).sort((a, b) => a.k.order - b.k.order || a.r.name.localeCompare(b.r.name, undefined, { numeric: true }));
  const need = (o) => Math.max(o.k.area, o.r.w * o.r.d);

  for (let scale = 1; scale < 6; scale *= 1.08) {
    const rects = base.map((q) => ({ x: q.x * scale, z: q.z * scale, w: q.w * scale, d: q.d * scale })).sort((a, b) => b.w * b.d - a.w * a.d);
    // split the ordered room list into contiguous runs, one per wing, sized to the wing
    const totalNeed = ordered.reduce((s, o) => s + need(o), 0);
    const totalArea = rects.reduce((s, q) => s + q.w * q.d, 0);
    const groups = rects.map(() => []);
    let acc = 0;
    let wi = 0;
    let cap = (rects[0].w * rects[0].d * totalNeed) / totalArea;
    for (const o of ordered) {
      if (acc + need(o) / 2 > cap && wi < rects.length - 1 && groups[wi].length) {
        wi++;
        cap += (rects[wi].w * rects[wi].d * totalNeed) / totalArea;
      }
      groups[wi].push(o);
      acc += need(o);
    }
    let ok = true;
    const placed = [];
    rects.forEach((q, gi) => {
      if (!groups[gi].length) return;
      const cells = squarify(groups[gi].map(need), q);
      groups[gi].forEach((o, i) => {
        const c = cells[i];
        const inset = 0.08;
        const cw = c.w - inset * 2, cd = c.d - inset * 2;
        const used = arrangeRoom(o.r, cw - 0.6);
        if (cw < o.r.minW || used.d > cd || used.w > cw + 0.01) ok = false;
        placed.push({ room: o.r, x: c.x + c.w / 2, z: c.z + c.d / 2, w: cw, d: cd });
      });
    });
    if (!ok) continue;
    for (const p of placed) Object.assign(p.room, { x: p.x, z: p.z, w: p.w, d: p.d });
    const outline = poly.map(([x, z]) => [x * scale, z * scale]);
    const xs = outline.map((p) => p[0]), zs = outline.map((p) => p[1]);
    // centre the plan on the origin
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    for (const r of rooms) { r.x -= cx; r.z -= cz; }
    return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs), outline: outline.map(([x, z]) => [x - cx, z - cz]), scale };
  }
  rooms.forEach((r) => arrangeRoom(r, r.rowW)); // couldn't fit — fall back to the generic plan
  return packFloor(rooms);
}

export function layoutHouse(house) {
  const rooms = house.roots.map((id) => roomLayout(house, house.nodes[id]));
  const floorIds = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => a - b);
  const floors = floorIds.map((level) => {
    const fr = rooms.filter((r) => r.floor === level);
    const plan = level === 0 && house.footprint?.length > 2 ? packFootprint(fr, house.footprint) : packFloor(fr);
    return { level, rooms: fr, ...plan };
  });

  // exploded staircase, left to right: basement low on the left, upstairs high on the right
  const sorted = [...floors].sort((a, b) => a.level - b.level);
  const ground = sorted.find((f) => f.level === 0) || sorted[0];
  const gi = sorted.indexOf(ground);
  ground.x = 0;
  for (let i = gi + 1; i < sorted.length; i++) sorted[i].x = sorted[i - 1].x + sorted[i - 1].w / 2 + FLOOR_STEP + sorted[i].w / 2;
  for (let i = gi - 1; i >= 0; i--) sorted[i].x = sorted[i + 1].x - sorted[i + 1].w / 2 - FLOOR_STEP - sorted[i].w / 2;
  for (const f of sorted) {
    f.y = (f.level - ground.level) * FLOOR_RISE;
    f.z = 0;
  }

  // world-space positions for every item, crate and furniture piece
  const items = {};
  const crates = {};
  const furniture = {};
  for (const f of floors) {
    for (const r of f.rooms) {
      r.wx = r.x + f.x;
      r.wz = r.z + f.z;
      r.wy = f.y;
      for (const fu of r.furniture) {
        const fx = r.wx + fu.x;
        const fz = r.wz - r.d / 2 + fu.z;
        furniture[fu.id] = { ...fu, wx: fx, wy: f.y, wz: fz, room: r };
        for (const s of fu.slots) items[s.id] = { x: fx + s.x, y: f.y + s.y + s.dims.h / 2, z: fz + s.z, dims: s.dims, parent: fu.id };
        for (const c of fu.crates) {
          const cx = fx + c.x;
          const cy = f.y + c.y;
          const cz = fz + c.z;
          crates[c.id] = { ...c, wx: cx, wy: cy, wz: cz, parent: fu.id };
          for (const s of c.slots) items[s.id] = { x: cx + s.x, y: cy + s.y + s.dims.h / 2, z: cz + s.z, dims: s.dims, parent: c.id, mini: true };
        }
      }
    }
  }
  return { floors, items, crates, furniture };
}
