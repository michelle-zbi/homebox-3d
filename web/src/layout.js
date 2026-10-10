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
const FLOOR_STEP = 2.2; // extra depth gap between floors (exploded "staircase" view)
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

export function furnitureKind(name, style = 'diorama') {
  if (style === 'real') {
    if (/\b(upper|wall cabinet|medicine cabinet|wall shel(f|ves)|floating|mounted|spice rack)\b/i.test(name)) return 'wall';
    if (/\bdrawers?\b/i.test(name) && !/dresser|chest of/i.test(name)) return 'drawer';
  }
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

function furnitureLayout(house, node, style) {
  const kind = furnitureKind(node.name, style);
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

  if (kind === 'drawer') {
    // a base cabinet with its top drawer pulled out; items sit in the drawer
    const width = Math.min(1.8, Math.max(0.6, Math.sqrt(total) * 0.75 + 0.15));
    const rows = packRows(contents, width - 0.1);
    const inner = rows.reduce((s, r) => s + r.d + 0.03, 0.06);
    const depth = 0.62;
    const pull = Math.max(0.28, inner - 0.25);
    let z = -depth / 2 + 0.05 + pull;
    for (const r of rows) {
      placeRow(r, width, 0.63, z + r.d / 2, out);
      z += r.d + 0.03;
    }
    return { ...out, w: width, d: depth, h: 0.9, pull, drawerDepth: inner };
  }

  const wallRows = kind === 'wall' ? packRows(contents, Math.max(0.8, Math.min(2.2, total / 2 + 0.2)) - 0.1) : null;
  if (kind === 'wall' && wallRows.length <= 3) {
    // wall-mounted cabinet, glass doors, up to three shelves (more than that and it
    // becomes a full-height cabinet on the floor instead, so no item is ever dropped)
    const rows = wallRows;
    const width = Math.max(0.8, Math.min(2.2, Math.max(...rows.map((r) => r.w), 0.6) + 0.12));
    let y = 0.04;
    for (const r of rows) {
      out.levels.push(y);
      placeRow(r, width, y + 0.02, 0.02, out);
      y += Math.max(0.3, r.h + 0.08);
    }
    if (!rows.length) { out.levels.push(y); y += 0.3; }
    return { ...out, w: width, d: 0.36, h: y + 0.03, mount: 1.42 };
  }
  if (kind === 'wall') out.kind = 'case';

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

function roomLayout(house, node, style, carRoomId) {
  const kids = node.children.map((id) => house.nodes[id]);
  const furniture = kids.filter((k) => k.kind === 'location').sort(byName).map((k) => furnitureLayout(house, k, style));
  const loose = kids.filter((k) => k.kind === 'item');
  if (loose.length) furniture.push(looseLayout(node, loose));
  if (style === 'real') return realRoom(node, furniture, house.parking, carRoomId);
  const room = { id: node.id, name: node.name, floor: floorOf(node.name), furniture };
  room.fitTo = (w, d) => {
    const used = arrangeRoom(room, w - 0.6);
    return w >= room.minW && used.d <= d && used.w <= w + 0.01;
  };
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

// ---- realistic rooms -------------------------------------------------------------
// Real rooms are arranged like real rooms: storage and built-ins (counters, vanity…)
// line the back wall and spill onto the side walls, wall cabinets hang above the
// counter, and the big pieces (bed, sofa, table, island) take the middle.

// built-ins along the wall, by room type (no items, just set dressing)
const BUILT_INS = {
  kitchen: [
    { piece: 'fridge', w: 0.9, d: 0.74, h: 1.82, at: 'start' },
    { piece: 'sink', w: 0.9, d: 0.62, h: 0.92, at: 'middle' },
    { piece: 'dishwasher', w: 0.6, d: 0.62, h: 0.92, at: 'middle' },
    { piece: 'range', w: 0.76, d: 0.64, h: 0.95, at: 'end' },
  ],
  bath: [{ piece: 'vanity', w: 1.0, d: 0.55, h: 0.88, at: 'start' }, { piece: 'toilet', w: 0.5, d: 0.7, h: 0.8, at: 'middle' }, { piece: 'tub', w: 1.7, d: 0.78, h: 0.58, at: 'end' }],
  powder: [{ piece: 'vanity', w: 0.7, d: 0.5, h: 0.88, at: 'start' }, { piece: 'toilet', w: 0.5, d: 0.7, h: 0.8, at: 'end' }],
  laundry: [{ piece: 'washer', w: 0.68, d: 0.7, h: 0.9, at: 'start' }, { piece: 'dryer', w: 0.68, d: 0.7, h: 0.9, at: 'start' }],
};
// what goes in the middle of the room
// (sizes: first that fits wins; `required` pieces make a room "not fit" rather than be dropped)
const CENTRE = {
  'primary-bedroom': [{ piece: 'bed', sizes: [[1.95, 2.15, 'king'], [1.55, 2.1, 'queen']], required: true }],
  bedroom: [{ piece: 'bed', sizes: [[1.55, 2.1, 'queen'], [1.0, 2.0, 'twin']], required: true }],
  living: [{ piece: 'lounge', sizes: [[2.6, 2.3, 'large'], [2.1, 1.6, 'small']] }],
  family: [{ piece: 'lounge', sizes: [[2.6, 2.3, 'large'], [2.1, 1.6, 'small']] }],
  dining: [{ piece: 'dining', sizes: [[2.6, 2.1, 'six'], [1.7, 1.7, 'four']], required: true }],
  kitchen: [{ piece: 'island', sizes: [[1.9, 1.5, 'island']] }],
  office: [{ piece: 'rug', sizes: [[2.0, 1.4, 'rug']] }],
};
const RUN_GAP = { kitchen: 0, bath: 0.12, powder: 0.12, laundry: 0.02 };

function realRoom(node, furniture, parking, carRoomId) {
  const kind = roomKind(node.name).type;
  const mounted = furniture.filter((f) => f.kind === 'wall');
  const user = furniture.filter((f) => f.kind !== 'wall');
  // skip a built-in when you already store something by that name ("Vanity" -> no extra vanity);
  // whole words, so "Orange crate" doesn't remove the range
  const have = (piece) => user.some((f) => new RegExp(`\\b${piece}\\b`, 'i').test(f.name));
  const built = (BUILT_INS[kind] || []).filter((b) => !have(b.piece)).map((b, i) => ({ ...b, id: `${node.id}:${b.piece}:${i}`, name: b.piece, kind: 'decor', slots: [], crates: [], levels: [] }));
  // order the wall run: fridge first, sink mid-run, range last
  const half = Math.ceil(user.length / 2);
  const run = [...built.filter((b) => b.at === 'start'), ...user.slice(0, half), ...built.filter((b) => b.at === 'middle'), ...user.slice(half), ...built.filter((b) => b.at === 'end')];
  const centreSpec = [...(CENTRE[kind] || [])];
  // the cars (house.json "parking", else one generic car) go in one room: the garage, or else the basement
  if (node.id === carRoomId) {
    const cars = parking?.length ? parking : [{ model: 'sedan', color: '#5b6470' }];
    centreSpec.unshift({ piece: 'cars', cars, sizes: [[4.9, cars.length * 2.25, 'cars']], required: true });
  }
  const centre = centreSpec.map((c, i) => ({ ...c, w: c.sizes[0][0], d: c.sizes[0][1], id: `${node.id}:${c.piece}:${i}`, name: c.piece, kind: 'decor', slots: [], crates: [], levels: [] }));
  const room = { id: node.id, name: node.name, floor: floorOf(node.name), type: kind, furniture: [], run, mounted, centre, real: true };
  const gap = RUN_GAP[kind] ?? 0.3;
  const runLen = run.reduce((s, f) => s + f.w + gap, 0);
  const runDepth = Math.max(0.5, ...run.map((f) => f.d));
  const widest = Math.max(0, ...centre.map((c) => c.w));
  const deepest = centre.reduce((s, c) => s + c.d, 0);
  const natW = Math.min(7, Math.max(3, widest + 1.4, runLen + 0.3, ...mounted.map((m) => m.w + 0.6)));
  const sideLen = Math.max(0, runLen + 0.3 - natW);
  const natD = Math.max(3, runDepth + (centre.length ? deepest + 1.4 : 1.2), sideLen / 2 + runDepth + 1.2);
  room.fitTo = (w, d) => arrangeReal(room, w, d, gap);
  room.minW = 2.2;
  // grow until everything fits; if even a big room can't hold the centre pieces,
  // make them optional rather than lose the room's storage (and its items)
  let w = natW, d = natD;
  for (let i = 0; i < 16 && !room.fitTo(w, d); i++) { w += 0.5; d += 0.5; }
  if (!room.furniture.length && (run.length || mounted.length)) {
    centre.forEach((c) => (c.required = false));
    w = natW; d = natD;
    for (let i = 0; i < 16 && !room.fitTo(w, d); i++) { w += 0.5; d += 0.5; }
  }
  return Object.assign(room, { w, d });
}

// Place the run along back → left → right walls, mounted cabinets above the low part
// of the back run, and the centre piece in whatever floor is left. Positions are
// relative to the room centre (x) and the back wall (z); rot turns a piece to face
// into the room from a side wall.
function arrangeReal(room, W, D, gap) {
  const wall = 0.1;
  const runDepth = Math.max(0.5, ...room.run.map((f) => f.d));
  const backLen = W - 2 * wall;
  const segs = { back: [], left: [], right: [] };
  const moves = []; // [piece, {x, z, rot, …}] — applied only once the whole room fits
  let x = 0;
  let side = 'back';
  const sideUsed = { left: 0, right: 0 };
  const sideLen = D - runDepth - wall - 0.9;
  for (const f of room.run) {
    if (side === 'back' && x + f.w > backLen + 0.001) side = 'left';
    if (side === 'left' && sideUsed.left + f.w > sideLen) side = 'right';
    if (side === 'right' && sideUsed.right + f.w > sideLen) return false;
    if (side === 'back') { segs.back.push([f, x]); x += f.w + gap; }
    else { segs[side].push([f, sideUsed[side]]); sideUsed[side] += f.w + gap; }
  }
  const backUsed = Math.max(0, x - gap);
  const x0 = -backLen / 2 + Math.max(0, (backLen - backUsed) / 2) * (room.type === 'kitchen' ? 0 : 1);
  const backX = new Map();
  for (const [f, off] of segs.back) {
    backX.set(f, x0 + off + f.w / 2);
    moves.push([f, { x: x0 + off + f.w / 2, z: wall + f.d / 2, rot: 0 }]);
  }
  const zs = wall + runDepth + 0.15;
  for (const [f, off] of segs.left) moves.push([f, { x: -W / 2 + wall + f.d / 2, z: zs + off + f.w / 2, rot: Math.PI / 2 }]);
  for (const [f, off] of segs.right) moves.push([f, { x: W / 2 - wall - f.d / 2, z: zs + off + f.w / 2, rot: -Math.PI / 2 }]);

  // wall cabinets: over back-run pieces that are counter height or lower
  let mx = -backLen / 2;
  const tallSpans = segs.back.filter(([f]) => f.h > 1.2).map(([f]) => [backX.get(f) - f.w / 2, backX.get(f) + f.w / 2]);
  for (const m of room.mounted) {
    for (let guard = 0; guard < 20; guard++) {
      const hit = tallSpans.find(([a, b]) => mx < b && mx + m.w > a);
      if (!hit) break;
      mx = hit[1] + 0.02;
    }
    if (mx + m.w > backLen / 2 + 0.001) return false;
    moves.push([m, { x: mx + m.w / 2, z: wall + m.d / 2, rot: 0 }]);
    mx += m.w + 0.04;
  }

  // centre pieces share the free rectangle, side by side along x; each takes the
  // biggest size that fits, turned 90° if that helps
  const left = segs.left.length ? wall + runDepth + 0.45 : wall + 0.3;
  const right = segs.right.length ? wall + runDepth + 0.45 : wall + 0.3;
  const top = wall + (room.run.length ? runDepth + 0.5 : 0.2);
  const freeD = D - top - 0.3;
  let freeX = -W / 2 + left;
  const freeEnd = W / 2 - right;
  const centreFit = [];
  for (const c of room.centre) {
    let fit = null;
    for (const [w, d, size] of c.sizes) {
      for (const turned of [false, true]) {
        const [fw, fd] = turned ? [d, w] : [w, d];
        if (freeX + fw <= freeEnd + 0.001 && fd <= freeD) { fit = { w, d, size, fw, rot: turned ? Math.PI / 2 : 0 }; break; }
      }
      if (fit) break;
    }
    if (!fit) {
      if (c.required) return false;
      continue;
    }
    centreFit.push([c, fit]);
    freeX += fit.fw + 0.4;
  }
  // centre the group of centre pieces in the free width
  const used = centreFit.reduce((s, [, f]) => s + f.fw + 0.4, -0.4);
  let cx = (-W / 2 + left + freeEnd) / 2 - used / 2;
  for (const [c, f] of centreFit) {
    moves.push([c, { w: f.w, d: f.d, size: f.size, x: cx + f.fw / 2, z: top + freeD / 2, rot: f.rot }]);
    cx += f.fw + 0.4;
  }

  for (const [piece, props] of moves) Object.assign(piece, props);
  room.furniture = [...room.run, ...room.mounted, ...centreFit.map(([c]) => c)];
  return true;
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

// whole words only, so "Garden Shed" isn't a den and "Bedrock" isn't a bedroom
const ROOM_KINDS = [
  [/\b(living|great room|lounge)\b/i, 0, 30, 'living'], [/\bdining\b/i, 1, 15, 'dining'], [/\bkitchen\b/i, 2, 18, 'kitchen'],
  [/\b(family|den|media room|tv room|play ?room|rec room)\b/i, 3, 22, 'family'],
  [/\b(entry|foyer|hall(way)?|mud ?room)\b/i, 4, 8, 'hall'], [/\b(laundry|utility)\b/i, 5, 6, 'laundry'], [/\b(office|study|library)\b/i, 6, 11, 'office'],
  [/\b(primary|master) bed(room)?\b/i, 7, 20, 'primary-bedroom'], [/\b((primary|master) bath(room)?|en ?suite)\b/i, 8, 9, 'bath'],
  [/\b(bed(room)?|guest room|nursery)\b/i, 9, 13, 'bedroom'], [/\b(powder( room)?|half bath)\b/i, 11, 3.5, 'powder'], [/\bbath(room)?\b/i, 10, 7, 'bath'],
  [/\bcloset\b/i, 12, 3, 'closet'], [/\b(garage|carport)\b/i, 13, 36, 'garage'],
  [/\b(basement|cellar|attic|storage|shed)\b/i, 14, 20, 'storage'],
];
export function roomKind(name) {
  for (const [re, order, area, type] of ROOM_KINDS) if (re.test(name)) return { order, area, type };
  return { order: 12.5, area: 12, type: 'other' };
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
      groups[gi].sort((a, b) => need(b) - need(a));
      const cells = squarify(groups[gi].map(need), q);
      groups[gi].forEach((o, i) => {
        const c = cells[i];
        const inset = 0.08;
        const cw = c.w - inset * 2, cd = c.d - inset * 2;
        if (!o.r.fitTo(cw, cd)) ok = false;
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
  // couldn't fit — fall back to the generic plan (realistic rooms re-fit in layoutHouse)
  rooms.forEach((r) => !r.real && arrangeRoom(r, r.rowW));
  return packFloor(rooms);
}

export function layoutHouse(house, style = 'diorama') {
  // the cars go in the garage if there is one, else the basement
  const roots = house.roots.map((id) => house.nodes[id]);
  const carRoom = roots.find((n) => roomKind(n.name).type === 'garage') || roots.find((n) => /\bbasement\b/i.test(n.name) && roomKind(n.name).type === 'storage');
  const rooms = roots.map((n) => roomLayout(house, n, style, carRoom?.id));
  const floorIds = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => a - b);
  const floors = floorIds.map((level) => {
    const fr = rooms.filter((r) => r.floor === level);
    const plan = level === 0 && house.footprint?.length > 2 ? packFootprint(fr, house.footprint) : packFloor(fr);
    // realistic rooms re-run their arrangement for the size they ended up with
    if (style === 'real') for (const r of fr) r.fitTo(r.w, r.d);
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
        const rot = fu.rot || 0;
        const mount = fu.mount || 0;
        // local (x, z) inside the piece -> world, honouring the piece's turn (same convention as three's rotation.y)
        const cos = Math.cos(rot), sin = Math.sin(rot);
        const wxz = (lx, lz) => [fx + lx * cos + lz * sin, fz - lx * sin + lz * cos];
        furniture[fu.id] = { ...fu, wx: fx, wy: f.y, wz: fz, rot, mount, room: r };
        for (const s of fu.slots) {
          const [x, z] = wxz(s.x, s.z);
          items[s.id] = { x, y: f.y + mount + s.y + s.dims.h / 2, z, dims: s.dims, parent: fu.id };
        }
        for (const c of fu.crates) {
          const [cx, cz] = wxz(c.x, c.z);
          const cy = f.y + mount + c.y;
          crates[c.id] = { ...c, wx: cx, wy: cy, wz: cz, rot, parent: fu.id };
          for (const s of c.slots) {
            const [x, z] = wxz(c.x + s.x, c.z + s.z);
            items[s.id] = { x, y: cy + s.y + s.dims.h / 2, z, dims: s.dims, parent: c.id, mini: true };
          }
        }
      }
    }
  }
  return { floors, items, crates, furniture };
}
