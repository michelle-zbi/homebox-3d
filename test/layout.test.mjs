// Layout invariants: every item is placed, furniture stays inside its room, room
// types come from whole words, built-ins aren't dropped by substrings, and cars go
// in exactly one room. Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutHouse, roomKind } from '../web/src/layout.js';

let n = 0;
function house(spec, extra = {}) {
  const nodes = {};
  const roots = [];
  const add = (name, parentId, kind, depth) => {
    const id = `n${n++}`;
    nodes[id] = { id, name, kind, parentId, depth, children: [], ...(kind === 'item' && { qty: 1, tags: [], price: 0 }) };
    if (parentId) nodes[parentId].children.push(id);
    else roots.push(id);
    return id;
  };
  const walk = (obj, parentId, depth) => {
    for (const [name, v] of Object.entries(obj)) {
      const id = add(name, parentId, 'location', depth);
      if (Array.isArray(v)) v.forEach((it) => add(it, id, 'item', depth + 1));
      else walk(v, id, depth + 1);
    }
  };
  walk(spec, null, 0);
  return { roots, nodes, tags: {}, ...extra };
}
const items = (h) => Object.values(h.nodes).filter((x) => x.kind === 'item').map((x) => x.id);
const many = (k, p = 'Thing') => Array.from({ length: k }, (_, i) => `${p} ${i + 1}`);

const SPEC = {
  Kitchen: { 'Upper Cabinet': many(25, 'Glass'), 'Orange crate': ['Oranges'], 'Junk Drawer': ['Keys'] },
  Bathroom: { 'Tubs of yarn': ['Yarn'], 'Medicine Cabinet': ['Aspirin'] },
  'Garden Shed': { Shelf: ['Rake'] },
  'Basement Family Room': { 'TV Console': ['Remote'] },
  'Basement Bathroom': { 'Linen Closet': ['Towels'] },
  Garage: { 'Metal Shelf': many(12, 'Tool'), Workbench: ['Drill'] },
  Basement: { 'Storage Rack': { 'Camping Bin': ['Tent'] } },
  'Powder Room': { Vanity: ['Soap'] },
};

test('room types are whole words', () => {
  assert.equal(roomKind('Garden Shed').type, 'storage');
  assert.equal(roomKind('Family Room').type, 'family');
  assert.equal(roomKind('Den').type, 'family');
  assert.equal(roomKind('Basement Bathroom').type, 'bath');
  assert.equal(roomKind('Primary Bedroom').type, 'primary-bedroom');
  assert.equal(roomKind('Powder Room').type, 'powder');
});

for (const style of ['diorama', 'real']) {
  test(`${style}: every item is placed`, () => {
    const h = house(SPEC);
    const l = layoutHouse(h, style);
    const missing = items(h).filter((id) => !l.items[id]).map((id) => h.nodes[id].name);
    assert.deepEqual(missing, []);
  });
}

test('real: furniture stays inside its room', () => {
  const h = house(SPEC, { parking: [{ model: 'sedan' }, { model: 'coupe' }] });
  const l = layoutHouse(h, 'real');
  for (const f of l.floors) for (const r of f.rooms) {
    for (const fu of r.furniture) {
      const turned = Math.abs(Math.sin(fu.rot || 0)) > 0.5;
      const [w, d] = turned ? [fu.d, fu.w] : [fu.w, fu.d];
      const eps = 0.05;
      assert.ok(fu.x - w / 2 >= -r.w / 2 - eps && fu.x + w / 2 <= r.w / 2 + eps, `${r.name}/${fu.name} x out of room`);
      assert.ok(fu.z - d / 2 >= -eps && fu.z + d / 2 <= r.d + eps, `${r.name}/${fu.name} z out of room`);
    }
  }
});

test('real: built-ins are not dropped by substrings, cars go in one room', () => {
  const h = house(SPEC, { parking: [{ model: 'sedan' }, { model: 'coupe' }] });
  const l = layoutHouse(h, 'real');
  const room = (name) => l.floors.flatMap((f) => f.rooms).find((r) => r.name === name);
  const pieces = (name) => room(name).furniture.map((f) => f.piece || f.name);
  assert.ok(pieces('Kitchen').includes('range'), 'kitchen keeps its range despite "Orange crate"');
  assert.ok(pieces('Bathroom').includes('tub'), 'bath keeps its tub despite "Tubs of yarn"');
  assert.ok(!pieces('Powder Room').includes('vanity'), 'powder room has the user\'s Vanity instead of a built-in one');
  const withCars = l.floors.flatMap((f) => f.rooms).filter((r) => r.furniture.some((f) => f.piece === 'cars'));
  assert.deepEqual(withCars.map((r) => r.name), ['Garage']);
  assert.ok(!pieces('Basement Family Room').includes('cars'), 'no car in the basement family room');
});

test('real: cars go in the basement when there is no garage', () => {
  const h = house({ Kitchen: { Pantry: ['Rice'] }, Basement: { Shelf: ['Paint'] } }, { parking: [{ model: 'sedan' }] });
  const l = layoutHouse(h, 'real');
  const b = l.floors.flatMap((f) => f.rooms).find((r) => r.name === 'Basement');
  assert.ok(b.furniture.some((f) => f.piece === 'cars'));
});
