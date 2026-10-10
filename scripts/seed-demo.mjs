#!/usr/bin/env node
// Seeds a Homebox instance with a fictional, fully-stocked house so the 3D view
// has something to show. Point it at a THROWAWAY instance — it only adds data,
// but you don't want 150 fake items in your real inventory.
//
//   HOMEBOX_URL=http://127.0.0.1:7746 HOMEBOX_EMAIL=demo@example.com \
//   HOMEBOX_PASSWORD=demo-password npm run seed

import fs from 'node:fs';

const URL_ = (process.env.HOMEBOX_URL || 'http://127.0.0.1:7746').replace(/\/$/, '');
const EMAIL = process.env.HOMEBOX_EMAIL || 'demo@example.com';
const PASSWORD = process.env.HOMEBOX_PASSWORD || 'demo-password';

const TAGS = {
  Electronics: '#4f8cff', Tools: '#ff8a3d', Kitchen: '#ffc845', Clothing: '#b07cff',
  Documents: '#2ec4a6', Sports: '#ff5d7a', Decor: '#7cc6e8', Camping: '#86c36a',
  Holiday: '#e8453c', Books: '#c49a6c',
};

// room -> container -> [item | [item, {tags, price, qty}]] ; nested objects are sub-containers
// (SEED_PLAN=path/to/plan.json swaps in your own plan of the same shape)
const DEFAULT_HOUSE = {
  Kitchen: {
    'Upper Cabinet': [['Stand Mixer', { tags: ['Kitchen'], price: 429 }], ['Wine Glasses', { tags: ['Kitchen'], qty: 8 }], ['Dinner Plates', { tags: ['Kitchen'], qty: 12 }], ['Coffee Grinder', { tags: ['Kitchen', 'Electronics'], price: 169 }]],
    'Pantry Shelf': [['Cast Iron Skillet', { tags: ['Kitchen'], price: 45 }], ['Dutch Oven', { tags: ['Kitchen'], price: 380 }], ['Rice Cooker', { tags: ['Kitchen', 'Electronics'], price: 89 }], ['Pasta Maker', { tags: ['Kitchen'] }], ['Spice Rack', { tags: ['Kitchen'] }]],
    'Junk Drawer': [['Spare Keys', {}], ['Batteries (AA)', { qty: 24 }], ['Tape Measure', { tags: ['Tools'] }], ['Birthday Candles', { tags: ['Holiday'] }], ['Takeout Menus', { tags: ['Documents'] }]],
  },
  'Living Room': {
    'TV Console': [['PlayStation 5', { tags: ['Electronics'], price: 499 }], ['Apple TV', { tags: ['Electronics'], price: 129 }], ['Soundbar', { tags: ['Electronics'], price: 299 }], ['Controllers', { tags: ['Electronics'], qty: 3 }], ['HDMI Cables', { tags: ['Electronics'], qty: 4 }]],
    Bookshelf: [['Dune', { tags: ['Books'] }], ['Project Hail Mary', { tags: ['Books'] }], ['Board Games', { qty: 9 }], ['Polaroid Camera', { tags: ['Electronics'], price: 119 }], ['Vinyl Records', { tags: ['Decor'], qty: 40 }], ['Film Camera', { tags: ['Electronics'], price: 240 }]],
    'Coffee Table': [['Remote Controls', { tags: ['Electronics'], qty: 2 }], ['Coasters', { tags: ['Decor'], qty: 6 }], ['Throw Blanket', { tags: ['Decor'] }]],
  },
  Bedroom: {
    Closet: {
      _items: [['Winter Coat', { tags: ['Clothing'], price: 320 }], ['Rain Jacket', { tags: ['Clothing'], price: 180 }], ['Suit', { tags: ['Clothing'], price: 650 }], ['Hiking Boots', { tags: ['Clothing', 'Camping'], price: 210 }]],
      'Shoe Box': [['Dress Shoes', { tags: ['Clothing'] }], ['Sneakers', { tags: ['Clothing'], qty: 3 }]],
      'Keepsake Box': [['Passport', { tags: ['Documents'] }], ['Birth Certificate', { tags: ['Documents'] }], ['Grandpa\'s Watch', { tags: ['Decor'], price: 1200 }]],
    },
    Dresser: [['T-Shirts', { tags: ['Clothing'], qty: 22 }], ['Sweaters', { tags: ['Clothing'], qty: 7 }], ['Jewelry Box', { tags: ['Decor'], price: 300 }], ['Sunglasses', { tags: ['Clothing'], price: 160 }]],
    Nightstand: [['Kindle', { tags: ['Electronics', 'Books'], price: 139 }], ['AirPods', { tags: ['Electronics'], price: 249 }], ['Phone Charger', { tags: ['Electronics'] }], ['Reading Glasses', {}]],
  },
  Office: {
    Desk: [['MacBook Pro', { tags: ['Electronics'], price: 2499 }], ['Mechanical Keyboard', { tags: ['Electronics'], price: 179 }], ['4K Monitor', { tags: ['Electronics'], price: 449 }], ['Webcam', { tags: ['Electronics'], price: 99 }], ['Desk Lamp', { tags: ['Decor'] }]],
    'Filing Cabinet': [['Tax Returns', { tags: ['Documents'], qty: 7 }], ['Lease Agreement', { tags: ['Documents'] }], ['Warranty Cards', { tags: ['Documents'], qty: 15 }], ['Car Title', { tags: ['Documents'] }]],
    'Office Shelf': [['3D Printer', { tags: ['Electronics', 'Tools'], price: 599 }], ['PLA Filament', { tags: ['Tools'], qty: 6 }], ['Raspberry Pi', { tags: ['Electronics'], qty: 3, price: 80 }], ['Soldering Iron', { tags: ['Tools', 'Electronics'], price: 70 }], ['External SSD', { tags: ['Electronics'], price: 140 }]],
  },
  Bathroom: {
    'Medicine Cabinet': [['First Aid Kit', {}], ['Electric Toothbrush', { tags: ['Electronics'], price: 90 }], ['Thermometer', {}]],
    'Linen Closet': [['Bath Towels', { qty: 8 }], ['Hair Dryer', { tags: ['Electronics'], price: 400 }], ['Spare Toiletries', { qty: 12 }]],
  },
  Garage: {
    'Metal Shelf': {
      _items: [['Cordless Drill', { tags: ['Tools'], price: 149 }], ['Circular Saw', { tags: ['Tools'], price: 189 }], ['Leaf Blower', { tags: ['Tools'], price: 230 }], ['Car Jack', { tags: ['Tools'] }]],
      'Tote A-1': [['Drill Bits', { tags: ['Tools'], qty: 40 }], ['Screws & Anchors', { tags: ['Tools'], qty: 300 }], ['Zip Ties', { tags: ['Tools'], qty: 100 }]],
      'Tote A-2': [['Extension Cords', { tags: ['Electronics'], qty: 4 }], ['Work Lights', { tags: ['Tools'], qty: 2 }]],
    },
    Workbench: [['Socket Set', { tags: ['Tools'], price: 120 }], ['Hammer', { tags: ['Tools'] }], ['Level', { tags: ['Tools'] }], ['Stud Finder', { tags: ['Tools'] }], ['Safety Glasses', { tags: ['Tools'] }], ['Clamps', { tags: ['Tools'], qty: 6 }]],
    'Bike Rack': [['Road Bike', { tags: ['Sports'], price: 1800 }], ['Bike Helmet', { tags: ['Sports'] }], ['Bike Pump', { tags: ['Sports'] }]],
  },
  Basement: {
    'Storage Rack': {
      'Camping Bin': [['Tent', { tags: ['Camping'], price: 340 }], ['Sleeping Bags', { tags: ['Camping'], qty: 2 }], ['Camp Stove', { tags: ['Camping'], price: 110 }], ['Headlamps', { tags: ['Camping'], qty: 3 }], ['Water Filter', { tags: ['Camping'] }]],
      'Sports Bin': [['Tennis Rackets', { tags: ['Sports'], qty: 2 }], ['Basketball', { tags: ['Sports'] }], ['Yoga Mat', { tags: ['Sports'] }], ['Snorkel Set', { tags: ['Sports'] }]],
      'Paint Bin': [['Paint Cans', { tags: ['Tools'], qty: 7 }], ['Rollers & Brushes', { tags: ['Tools'], qty: 10 }], ['Drop Cloth', { tags: ['Tools'] }]],
    },
    'Chest Freezer': [['Frozen Dumplings', { tags: ['Kitchen'], qty: 4 }], ['Ice Packs', { qty: 6 }]],
    'Laundry Shelf': [['Iron', { tags: ['Electronics'] }], ['Steamer', { tags: ['Electronics'], price: 80 }], ['Sewing Kit', {}]],
  },
  Attic: {
    'Holiday Bins': {
      'Xmas Tote': [['String Lights', { tags: ['Holiday'], qty: 12 }], ['Ornaments', { tags: ['Holiday'], qty: 60 }], ['Tree Stand', { tags: ['Holiday'] }]],
      'Halloween Tote': [['Costumes', { tags: ['Holiday', 'Clothing'], qty: 5 }], ['Fake Cobwebs', { tags: ['Holiday'] }], ['Pumpkin Lights', { tags: ['Holiday'] }]],
    },
    'Old Trunk': [['Yearbooks', { tags: ['Books'], qty: 4 }], ['Baby Clothes', { tags: ['Clothing'], qty: 30 }], ['Old iPhone', { tags: ['Electronics'] }], ['Love Letters', { tags: ['Documents'] }]],
    'Luggage Corner': [['Carry-on Suitcase', { price: 275 }], ['Checked Suitcase', { price: 340 }], ['Travel Adapters', { tags: ['Electronics'], qty: 3 }]],
  },
};

const HOUSE = process.env.SEED_PLAN ? JSON.parse(fs.readFileSync(process.env.SEED_PLAN, 'utf8')) : DEFAULT_HOUSE;
// SEED_PRUNE=1 removes empty top-level rooms that aren't in the plan (fresh demo instances only)
const PRUNE = process.env.SEED_PRUNE === '1';

let token;
async function api(method, path, body) {
  const res = await fetch(`${URL_}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function main() {
  try {
    token = (await api('POST', '/users/login', { username: EMAIL, password: PASSWORD })).token;
  } catch {
    await api('POST', '/users/register', { email: EMAIL, name: 'Demo', password: PASSWORD });
    token = (await api('POST', '/users/login', { username: EMAIL, password: PASSWORD })).token;
  }

  const locType = (await api('GET', '/entity-types')).find((t) => t.isLocation).id;
  const existingTags = Object.fromEntries((await api('GET', '/tags')).map((t) => [t.name, t.id]));
  const tagIds = {};
  for (const [name, color] of Object.entries(TAGS)) {
    tagIds[name] = existingTags[name] || (await api('POST', '/tags', { name, color })).id;
  }
  const tree = await api('GET', '/entities/tree');
  const roots = Object.fromEntries(tree.map((n) => [n.name, n.id]));
  if (PRUNE) {
    for (const n of tree) if (!(n.name in HOUSE) && !n.children.length) await api('DELETE', `/entities/${n.id}`);
  }

  let count = 0;
  const createItem = async (parentId, [name, opt = {}]) => {
    const item = await api('POST', '/entities', {
      name, parentId, quantity: opt.qty || 1, tagIds: (opt.tags || []).map((t) => tagIds[t]),
    });
    if (opt.price) {
      const full = await api('GET', `/entities/${item.id}`);
      await api('PUT', `/entities/${item.id}`, {
        ...full, parentId, entityTypeId: full.entityType.id, tagIds: full.tags.map((t) => t.id),
        purchasePrice: opt.price, fields: [],
      });
    }
    count++;
  };
  const createContainer = async (parentId, name, contents) => {
    const loc = await api('POST', '/entities', { name, parentId, entityTypeId: locType });
    const items = Array.isArray(contents) ? contents : contents._items || [];
    for (const it of items) await createItem(loc.id, it);
    if (!Array.isArray(contents)) {
      for (const [sub, subContents] of Object.entries(contents)) {
        if (sub !== '_items') await createContainer(loc.id, sub, subContents);
      }
    }
  };

  for (const [room, containers] of Object.entries(HOUSE)) {
    const roomId = roots[room] || (await api('POST', '/entities', { name: room, entityTypeId: locType })).id;
    for (const [name, contents] of Object.entries(containers)) await createContainer(roomId, name, contents);
    process.stdout.write(`${room} `);
  }
  console.log(`\nSeeded ${count} items into ${URL_}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
