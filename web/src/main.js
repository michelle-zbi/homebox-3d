import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { layoutHouse, hash } from './layout.js';
import { buildStatic } from './build.js';
import { buildRealStatic, updateCutaway } from './real/build.js';
import { Walker } from './real/walk.js';
import { loadModels, modelSizes } from './real/models.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { resolveQueries, pathOf } from '../../server/match.mjs';
import './style.css';

const $ = (s) => document.querySelector(s);
const FLOOR_T = 0.06; // room floor thickness: everything sits on top of it

// ---------------------------------------------------------------- renderer & scene

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
$('#app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const bgGradient = backgroundTexture();
scene.background = bgGradient;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 500);
camera.position.set(18, 20, 26);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 2;
controls.maxDistance = 80;
controls.autoRotateSpeed = 0.35;
const walker = new Walker({ camera, controls, dom: renderer.domElement, onExit: () => { setCeilings(false); setOutdoor(false); updateWalkButton(); } });
let ceilings = [];
let lamps = [];
// A fixed pool of room lights: a constant light count means no shader recompiles
// as you walk around, and the cost doesn't grow with the number of rooms.
const lampPool = Array.from({ length: 4 }, () => {
  const l = new THREE.PointLight('#ffe9cf', 0, 6, 2);
  scene.add(l);
  return l;
});
function placeLamps() {
  if (!walker.active || !lamps.length) {
    lampPool.forEach((l) => (l.intensity = 0));
    return;
  }
  const near = [...lamps].sort((a, b) => a.pos.distanceToSquared(camera.position) - b.pos.distanceToSquared(camera.position));
  lampPool.forEach((l, i) => {
    const a = near[i];
    if (!a) return void (l.intensity = 0);
    l.position.copy(a.pos);
    l.intensity = a.intensity;
    l.distance = a.range;
  });
}
let doors = [];
function setCeilings(on) { for (const c of ceilings) c.visible = on; }
function updateWalkButton() {
  const b = document.querySelector('#walk-toggle');
  if (b) {
    b.hidden = style !== 'real' || !layout?.floors.some((f) => f.rooms.length);
    b.textContent = walker.active ? '⌂ Leave' : '🚶 Walk';
  }
}
// Outdoor sky + meadow seen through the windows while walking (CC0, Poly Haven "meadow_2")
let outdoor = null;
function setOutdoor(on) {
  if (on && !outdoor) {
    outdoor = { pending: true };
    new HDRLoader().load('/textures/outdoor.hdr', (t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      outdoor = { bg: t, env: pmrem.fromEquirectangular(t).texture };
      if (walker.active) setOutdoor(true);
    });
    return;
  }
  if (on && outdoor.bg) {
    scene.background = outdoor.bg;
    scene.backgroundIntensity = 0.9;
    scene.environment = outdoor.env;
    scene.environmentIntensity = 0.45;
  } else if (!on) {
    scene.background = bgGradient;
    scene.backgroundIntensity = 1;
    applyLighting();
  }
}

function startWalk(room) {
  if (style !== 'real' || !layout) return;
  const rooms = layout.floors.flatMap((f) => f.rooms);
  room ||= rooms.find((r) => r.type === 'living') || rooms.find((r) => r.wy === 0) || rooms[0];
  if (!room) return; // an empty Homebox has nowhere to walk yet
  setOutdoor(true);
  controls.autoRotate = false;
  walker.enter(room);
  setCeilings(true);
  updateWalkButton();
}

const hemi = new THREE.HemisphereLight('#c9dcff', '#2a2320', 0.8);
scene.add(hemi);

// ---- style: 'diorama' (stylised blocks) or 'real' (materials + furniture)
let style = 'diorama';
try { style = new URLSearchParams(location.search).get('style') || localStorage.getItem('hb3d-style') || 'diorama'; } catch {}
const roomEnv = scene.environment;
let studioEnv = null;
new HDRLoader().load('/textures/studio.hdr', (t) => {
  t.mapping = THREE.EquirectangularReflectionMapping;
  studioEnv = pmrem.fromEquirectangular(t).texture;
  t.dispose();
  if (style === 'real' && !walker.active) applyLighting();
});
function applyLighting() {
  const real = style === 'real';
  scene.environment = real && studioEnv ? studioEnv : roomEnv;
  scene.environmentIntensity = real ? 0.95 : 0.35;
  hemi.intensity = real ? 0.95 : 0.8;
  sun.intensity = real ? 2.0 : 2.4;
  sun.color.set(real ? '#fff4e6' : '#fff1dd');
  renderer.toneMappingExposure = real ? 1.0 : 1.05;
  // bright walls shouldn't bloom; only the beams/markers (pushed well above 1) should
  bloom.threshold = real ? 2.2 : 1.0;
  document.body.classList.toggle('real', real);
  const b = document.querySelector('#style-toggle');
  if (b) b.textContent = real ? '◧ Realistic' : '◧ Diorama';
  updateWalkButton?.();
}
const sun = new THREE.DirectionalLight('#fff1dd', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 4;
scene.add(sun, sun.target);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ao = new GTAOPass(scene, camera, innerWidth, innerHeight);
ao.updateGtaoMaterial({ radius: 0.35, distanceFallOff: 1, thickness: 1, scale: 1.1 });
ao.blendIntensity = 0.85;
composer.addPass(ao);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.3, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function backgroundTexture() {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 512;
  const g = c.getContext('2d').createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#0b0e14');
  g.addColorStop(0.55, '#121823');
  g.addColorStop(1, '#1b2130');
  const ctx = c.getContext('2d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- tweens

const tweens = new Set();
const ease = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  out: (t) => 1 - (1 - t) ** 3,
  smoother: (t) => t * t * t * (t * (t * 6 - 15) + 10),
  bounce(t) {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};
function tween({ duration = 1, delay = 0, easing = ease.inOut, update, done }) {
  const t = { start: performance.now() + delay * 1000, duration: duration * 1000, easing, update, done };
  tweens.add(t);
  return t;
}
function runTweens(now) {
  for (const t of tweens) {
    if (now < t.start) continue;
    const k = Math.min(1, (now - t.start) / t.duration);
    t.update(t.easing(k), k);
    if (k >= 1) {
      tweens.delete(t);
      t.done?.();
    }
  }
}

// ---------------------------------------------------------------- items

const PALETTE = ['#4f8cff', '#ff8a3d', '#ffc845', '#b07cff', '#2ec4a6', '#ff5d7a', '#7cc6e8', '#86c36a', '#e8453c', '#c49a6c', '#f78fb3', '#5ad1e8'];
const UNTAGGED = '#b9b2a7';
let house = null;
let layout = null;
let staticGroup = null;
let pickables = [];
let furnitureGroups = {};
const itemMeshes = new Map(); // id -> mesh
const itemsRoot = new THREE.Group();
scene.add(itemsRoot);

// Tags keep their Homebox colour; uncoloured tags get distinct palette colours.
let tagColors = {};
function assignTagColors() {
  tagColors = {};
  const used = new Set(Object.values(house.tags).filter(Boolean).map((c) => c.toLowerCase()));
  const free = PALETTE.filter((c) => !used.has(c.toLowerCase()));
  const uncoloured = Object.keys(house.tags).filter((t) => !house.tags[t]).sort((a, b) => hash(a) - hash(b));
  uncoloured.forEach((t, i) => (tagColors[t] = free.length ? free[i % free.length] : PALETTE[i % PALETTE.length]));
}
function tagColor(tag) {
  return house?.tags?.[tag] || tagColors[tag] || PALETTE[Math.floor(hash(tag) * PALETTE.length)];
}
const itemColor = (n) => (n.tags?.length ? tagColor(n.tags[0]) : UNTAGGED);

// A few recognisable silhouettes; everything else is a soft block.
function itemShape(name) {
  const n = name.toLowerCase();
  if (/\b(ball|basketball|globe|ornaments?|orb)\b/.test(n)) return 'sphere';
  if (/cable|cords?\b|lights|wire|hose|rope|zip ties/.test(n)) return 'coil';
  if (/bottle|cans?\b|jar|thermos|candles?|lamp|mug|cup|glasses|vase|filament|pump|thermometer|toothbrush|dryer/.test(n)) return 'cylinder';
  if (/passport|certificate|returns?|letters?|title|agreement|lease|cards?|menus?|documents?|papers?|receipts?/.test(n)) return 'paper';
  if (/\b(books?|dune|yearbooks?|records?|vinyl|novel|kindle|hail mary)\b/.test(n)) return 'book';
  return 'box';
}

function itemGeometry(node, dims) {
  const { w, h, d } = dims;
  switch (itemShape(node.name)) {
    case 'sphere': {
      const r = Math.min(w, h, d) * 0.6;
      return [new THREE.SphereGeometry(r, 24, 16), r * 2];
    }
    case 'coil': {
      const r = Math.min(w, d) * 0.36;
      const g = new THREE.TorusGeometry(r, r * 0.32, 10, 24);
      g.rotateX(Math.PI / 2);
      return [g, r * 0.64];
    }
    case 'cylinder': {
      const r = Math.min(w, d) * 0.4;
      return [new THREE.CylinderGeometry(r, r, h, 20), h];
    }
    case 'paper':
      return [new RoundedBoxGeometry(w * 1.05, h * 0.18, d * 1.1, 1, 0.008), h * 0.18];
    case 'book':
      return [new RoundedBoxGeometry(w * 0.45, h * 1.2, d, 1, 0.01), h * 1.2];
    default:
      return [new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.14), h];
  }
}

function makeItemMesh(node, slot) {
  const [geo, height] = itemGeometry(node, slot.dims);
  const color = new THREE.Color(itemColor(node));
  if (style === 'real') color.lerp(new THREE.Color('#b9b1a6'), 0.45);
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.05, emissive: color.clone(), emissiveIntensity: 0.06, transparent: true }),
  );
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData = { kind: 'item', id: node.id, height, baseColor: color, sig: sigOf(node, slot) };
  m.rotation.y = (hash(node.id) - 0.5) * 0.35;
  return m;
}
const sigOf = (node, slot) => `${style}|${node.name}|${itemColor(node)}|${slot.mini ? 1 : 0}|${slot.dims.w.toFixed(3)}`;

function slotPosition(slot, mesh) {
  const h = mesh.userData.height;
  return new THREE.Vector3(slot.x, slot.y - slot.dims.h / 2 + h / 2 + FLOOR_T, slot.z);
}

// ---------------------------------------------------------------- applying snapshots

let firstLoad = true;
let walls = [];

// Room names as small floating tags (realistic style; the diorama paints them on the floor)
const roomTags = document.createElement('div');
roomTags.id = 'room-tags';
document.body.appendChild(roomTags);
function renderRoomLabels() {
  roomTags.innerHTML = '';
  if (style !== 'real') return;
  for (const f of layout.floors) for (const r of f.rooms) {
    const el = document.createElement('span');
    el.textContent = r.name;
    el.onclick = () => (walker.active ? walker.enter(r) : flyToIds([r.id]));
    el.dataset.x = r.wx;
    el.dataset.y = r.wy + 2.7;
    el.dataset.z = r.wz;
    roomTags.appendChild(el);
  }
}
function placeRoomLabels() {
  const v = new THREE.Vector3();
  for (const el of roomTags.children) {
    v.set(+el.dataset.x, +el.dataset.y, +el.dataset.z).project(camera);
    const vis = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
    el.style.opacity = vis ? 1 : 0;
    el.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%, -50%)`;
  }
}

function setStyle(next) {
  style = next;
  try { localStorage.setItem('hb3d-style', style); } catch {}
  applyLighting();
  if (house) {
    // rebuild everything; items re-make their meshes (sig includes style) and glide to new slots
    applyHouse(house);
    frameAll();
  }
}
const prevParent = new Map();
const prevNames = new Map();

function applyHouse(next) {
  if (!next) return;
  const old = house;
  house = next;
  assignTagColors();
  layout = layoutHouse(house, style);

  if (staticGroup) scene.remove(staticGroup);
  const built = style === 'real' ? buildRealStatic(layout) : buildStatic(layout);
  walls = built.walls || [];
  ceilings = built.ceilings || [];
  doors = built.doors || [];
  lamps = built.lamps || [];
  if (style === 'real') walker.setLayout(layout, doors);
  if (walker.active) {
    if (style === 'real') setCeilings(true);
    else walker.exit();
  }
  updateWalkButton();
  renderRoomLabels();
  staticGroup = built.root;
  pickables = built.pickables;
  furnitureGroups = built.furnitureGroups;
  scene.add(staticGroup);

  const changes = [];
  const seen = new Set();
  const roomOrder = Object.fromEntries(house.roots.map((id, i) => [id, i]));

  for (const [id, slot] of Object.entries(layout.items)) {
    const node = house.nodes[id];
    seen.add(id);
    let mesh = itemMeshes.get(id);
    const parent = node.parentId;

    if (mesh && mesh.userData.sig !== sigOf(node, slot)) {
      // looks changed (renamed / retagged / qty) — swap the mesh in place
      const fresh = makeItemMesh(node, slot);
      fresh.position.copy(mesh.position);
      itemsRoot.remove(mesh);
      itemsRoot.add(fresh);
      itemMeshes.set(id, fresh);
      if (prevNames.get(id) !== node.name && old) changes.push({ type: 'renamed', id, from: prevNames.get(id) });
      mesh = fresh;
    }
    const target = slotPosition(slot, mesh || makeItemMesh(node, slot));

    if (!mesh) {
      mesh = makeItemMesh(node, slot);
      itemMeshes.set(id, mesh);
      itemsRoot.add(mesh);
      const roomIdx = roomOrder[rootOf(id)] ?? 0;
      const delay = firstLoad ? 0.25 + roomIdx * 0.16 + hash(id) * 0.7 : 0.1;
      dropIn(mesh, target, delay, !firstLoad);
      if (!firstLoad) changes.push({ type: 'added', id });
    } else if (old && prevParent.get(id) !== parent) {
      changes.push({ type: 'moved', id, origin: mesh.position.clone() });
      arcTo(mesh, target);
    } else if (mesh.position.distanceTo(target) > 0.001) {
      const from = mesh.position.clone();
      tween({ duration: 0.6, update: (k) => mesh.position.lerpVectors(from, target, k) });
    }
    prevParent.set(id, parent);
    prevNames.set(id, node.name);
  }

  for (const [id, mesh] of itemMeshes) {
    if (seen.has(id)) continue;
    itemMeshes.delete(id);
    changes.push({ type: 'removed', id, name: prevNames.get(id), fromHouse: old });
    const s0 = mesh.scale.clone();
    tween({ duration: 0.45, easing: ease.out, update: (k) => mesh.scale.copy(s0).multiplyScalar(1 - k), done: () => itemsRoot.remove(mesh) });
    prevParent.delete(id);
    prevNames.delete(id);
  }

  fitShadows();
  updateStats();
  renderLegend();
  if (firstLoad) {
    frameAll(false);
    firstLoad = false;
  } else if (changes.length) {
    changes.forEach(logChange);
    const ids = changes.filter((c) => c.type !== 'removed').map((c) => c.id);
    if (ids.length && !focus && $('#follow').checked) {
      flyToIds(ids, { soft: true, extra: changes.map((c) => c.origin).filter(Boolean) });
      glow(ids);
    }
  }
  if (focus) applyFocus(focus.matches, focus.caption, { fly: false, source: focus.source });
}

function rootOf(id) {
  let n = house.nodes[id];
  while (n?.parentId) n = house.nodes[n.parentId];
  return n?.id;
}

function dropIn(mesh, target, delay, sparkle) {
  const from = target.clone().add(new THREE.Vector3(0, 3.5 + hash(mesh.userData.id) * 2, 0));
  mesh.position.copy(from);
  mesh.visible = false;
  tween({
    delay,
    duration: 0.9,
    easing: ease.bounce,
    update: (k) => {
      mesh.visible = true;
      mesh.position.lerpVectors(from, target, k);
    },
    done: () => sparkle && ring(target, '#7dffb2'),
  });
}

function arcTo(mesh, target) {
  const from = mesh.position.clone();
  const lift = 1.6 + from.distanceTo(target) * 0.25;
  const spin = mesh.rotation.y;
  ring(from, '#ffd27a');
  tween({
    duration: 1.6,
    update: (k) => {
      mesh.position.lerpVectors(from, target, k);
      mesh.position.y += Math.sin(Math.PI * k) * lift;
      mesh.rotation.y = spin + k * Math.PI * 2;
    },
    done: () => ring(target, '#ffd27a'),
  });
}

// expanding ring on the floor, used as a "landed here" ping
function ring(pos, baseColor) {
  const color = new THREE.Color(baseColor).multiplyScalar(2);
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.12, 0.16, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(pos.x, pos.y - 0.08, pos.z);
  scene.add(m);
  tween({ duration: 1.1, easing: ease.out, update: (k) => { m.scale.setScalar(1 + k * 2.5); m.material.opacity = 0.8 * (1 - k) ** 2; }, done: () => scene.remove(m) });
}

function glow(ids) {
  for (const id of ids) {
    const m = itemMeshes.get(id);
    if (!m) continue;
    tween({ duration: 3, easing: (t) => t, update: (k) => (m.material.emissiveIntensity = 0.06 + Math.sin(k * Math.PI) * 0.9 * (0.5 + 0.5 * Math.cos(k * 18))) });
  }
}

function fitShadows() {
  const box = new THREE.Box3().setFromObject(staticGroup);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.z) * 0.6 + 2;
  sun.position.set(c.x - r * 0.5, c.y + r * 1.4, c.z + r * 0.8);
  sun.target.position.copy(c);
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.5, far: r * 4 });
  sun.shadow.camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- camera moves

function flyTo(box, { soft = false, duration } = {}) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const big = size.x > 8;
  // furniture opens toward +z, so look in from the front, a little to the side
  const side = (Math.sign(camera.position.x - controls.target.x) || 1) * (big ? 0.4 : 1);
  const elev = THREE.MathUtils.degToRad(big ? 38 : 30);
  const dir = new THREE.Vector3(0.38 * side, 0, 1).normalize().multiplyScalar(Math.cos(elev)).setY(Math.sin(elev));
  const dist = Math.max(soft ? 7 : 5.5, fitDistance(box, dir, big ? 1 : 0.6));
  moveCamera(center.clone().add(dir.multiplyScalar(dist)), center, duration);
}

// One camera move for everything: smootherstep easing, and long trips rise a little
// mid-flight so the camera doesn't skim through the walls.
function moveCamera(toPos, toTarget, duration) {
  const fromPos = camera.position.clone();
  const fromTarget = controls.target.clone();
  const travel = fromPos.distanceTo(toPos) + fromTarget.distanceTo(toTarget);
  const lift = travel > 6 ? Math.min(6, travel * 0.12) : 0;
  tween({
    duration: duration ?? Math.min(2.4, 1.3 + travel * 0.025),
    easing: ease.smoother,
    update: (k) => {
      camera.position.lerpVectors(fromPos, toPos, k);
      camera.position.y += Math.sin(Math.PI * k) * lift;
      controls.target.lerpVectors(fromTarget, toTarget, k);
    },
  });
}

function boxOfIds(ids) {
  const box = new THREE.Box3();
  for (const id of ids) {
    const m = itemMeshes.get(id);
    if (m) box.expandByPoint(layout.items[id] ? slotPosition(layout.items[id], m) : m.position);
    const g = furnitureGroups[id] || findCrateGroup(id);
    if (g) box.expandByObject(g);
    if (!m && !g && layout.floors) {
      const room = layout.floors.flatMap((f) => f.rooms).find((r) => r.id === id);
      if (room) box.expandByPoint(new THREE.Vector3(room.wx - room.w / 2, room.wy, room.wz - room.d / 2)).expandByPoint(new THREE.Vector3(room.wx + room.w / 2, room.wy + 1, room.wz + room.d / 2));
    }
  }
  return box;
}

function flyToIds(ids, opts = {}) {
  const box = boxOfIds(ids);
  for (const p of opts.extra || []) box.expandByPoint(p);
  if (!box.isEmpty()) flyTo(box, opts);
}

// Smallest distance along `dir` at which every corner of `box` lands inside the
// visible area (leaving room for the HUD panels). `pad` adds world-space slack.
function fitDistance(box, dir, pad = 0, points = null) {
  const b = box.clone().expandByScalar(pad);
  const center = b.getCenter(new THREE.Vector3());
  const corners = points || [];
  if (!points) for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const cam = camera.clone();
  const fits = (d) => {
    cam.position.copy(center).addScaledVector(dir, d);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    return corners.every((c) => {
      const p = c.clone().project(cam);
      return p.z < 1 && Math.abs(p.x) < 0.94 && p.y < 0.7 && p.y > -0.8;
    });
  };
  let lo = 0.5, hi = 400;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

function frameAll(animate = true) {
  const box = new THREE.Box3().setFromObject(staticGroup);
  const center = box.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(0.2, 1.15, 1).normalize();
  // fit the floors themselves (slab corners + furniture height), not the empty air
  // of one big bounding box spanning basement to upstairs
  const pts = [];
  for (const f of layout.floors) {
    const pad = 0.6;
    for (const x of [f.x - f.w / 2 - pad, f.x + f.w / 2 + pad]) for (const z of [f.z - f.d / 2 - pad, f.z + f.d / 2 + pad]) for (const y of [f.y - 0.25, f.y + 1.6]) pts.push(new THREE.Vector3(x, y, z));
  }
  const pos = center.clone().addScaledVector(dir, fitDistance(box, dir, 0, pts));
  if (!animate) {
    camera.position.copy(pos);
    controls.target.copy(center);
    return;
  }
  moveCamera(pos, center);
}

function findCrateGroup(id) {
  let found = null;
  staticGroup?.traverse((o) => { if (o.userData.kind === 'crate' && o.userData.id === id) found = o; });
  return found;
}

// ---------------------------------------------------------------- focus (search, click, Claude)

let focus = null;
const beams = new THREE.Group();
scene.add(beams);
const beamTex = (() => {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  return new THREE.CanvasTexture(c);
})();

const glowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

function itemIdsUnder(id) {
  const out = [];
  const walk = (nid) => {
    const n = house.nodes[nid];
    if (!n) return;
    if (n.kind === 'item') out.push(nid);
    n.children.forEach(walk);
  };
  walk(id);
  return out;
}

function addBeam(pos, baseColor, big = false) {
  const color = new THREE.Color(baseColor).multiplyScalar(style === 'real' ? 3.2 : 1.7);
  const h = 6;
  const r = big ? 0.22 : 0.05;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 1.3, h, 24, 1, true),
    new THREE.MeshBasicMaterial({ color, alphaMap: beamTex, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }),
  );
  beam.position.set(pos.x, pos.y + h / 2, pos.z);
  const base = new THREE.Mesh(
    new THREE.RingGeometry(r * 1.4, r * 1.9, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  );
  base.rotation.x = -Math.PI / 2;
  base.position.set(pos.x, pos.y + 0.01, pos.z);
  base.userData.pulse = true;
  // soft glow sprite drawn on top of everything, so a match inside a cabinet still shows
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  marker.position.set(pos.x, pos.y + (big ? 0.5 : 0.12), pos.z);
  marker.scale.setScalar(big ? 1.4 : 0.8);
  marker.renderOrder = 10;
  marker.userData.pulse = true;
  beams.add(marker);
  beam.scale.y = 0.001;
  tween({ duration: 0.7, easing: ease.out, update: (k) => { beam.scale.y = k; beam.position.y = pos.y + (h * k) / 2; } });
  beams.add(beam, base);
}

// While walking: go stand in front of the (first) match and look at it.
function walkToIds(ids) {
  const id = ids[0];
  const n = house.nodes[id];
  let target, fu;
  if (n.kind === 'item' && layout.items[id]) {
    const it = layout.items[id];
    target = new THREE.Vector3(it.x, it.y + 0.06, it.z);
    fu = layout.furniture[it.parent] || layout.furniture[layout.crates[it.parent]?.parent];
  } else if (layout.furniture[id] || layout.crates[id]) {
    fu = layout.furniture[id] || layout.furniture[layout.crates[id].parent];
    target = new THREE.Vector3(fu.wx, fu.wy + (fu.mount || 0) + Math.min(1.2, fu.h / 2), fu.wz);
  } else {
    const room = layout.floors.flatMap((f) => f.rooms).find((r) => r.id === id);
    if (room) return walker.enter(room);
  }
  if (target) walker.goTo(target, fu);
}

function applyFocus(matches, caption = '', { fly = true, source = 'search' } = {}) {
  beams.clear();
  const ids = matches.map((m) => m.id).filter((id) => house.nodes[id]);
  if (!ids.length) return clearFocus();
  focus = { matches, caption, source };

  const lit = new Set(ids.flatMap((id) => (house.nodes[id].kind === 'item' ? [id] : itemIdsUnder(id))));
  for (const [id, m] of itemMeshes) {
    const on = lit.has(id);
    m.material.opacity = on ? 1 : 0.12;
    m.material.depthWrite = on;
    m.material.emissiveIntensity = on ? 0.35 : 0;
    m.castShadow = on;
  }
  const color = source === 'claude' ? '#ffb86b' : '#8fd3ff';
  for (const id of ids) {
    const n = house.nodes[id];
    if (n.kind === 'item') {
      const m = itemMeshes.get(id);
      if (m) {
        const p = layout.items[id] ? slotPosition(layout.items[id], m) : m.position.clone();
        addBeam(p.setY(p.y - m.userData.height / 2), color, false);
      }
    } else {
      const box = boxOfIds([id]);
      if (!box.isEmpty()) {
        const c = box.getCenter(new THREE.Vector3());
        addBeam(new THREE.Vector3(c.x, box.min.y, c.z), color, true);
      }
    }
  }
  if (fly && walker.active) walkToIds(ids);
  else if (fly) flyToIds(ids);
  renderCallout();
  controls.autoRotate = false;
}

function clearFocus() {
  focus = null;
  beams.clear();
  for (const m of itemMeshes.values()) {
    m.material.opacity = 1;
    m.material.depthWrite = true;
    m.material.emissiveIntensity = 0.06;
    m.castShadow = true;
  }
  renderCallout();
}

// Callout card that tracks the first highlighted thing on screen.
function renderCallout() {
  const el = $('#callout');
  if (!focus) {
    el.hidden = true;
    return;
  }
  const items = focus.matches;
  el.hidden = false;
  el.className = (focus.source === 'claude' ? 'callout claude' : 'callout') + (items.length > 3 ? ' pinned' : '');
  el.style.transform = '';
  el.style.opacity = 1;
  el.innerHTML = `
    ${focus.source === 'claude' ? '<div class="who"><span class="spark">✦</span> Claude</div>' : ''}
    ${focus.caption ? `<div class="caption">${esc(focus.caption)}</div>` : ''}
    <ul>${items.slice(0, 6).map((m) => `<li><b>${esc(m.name)}</b><span>${esc(m.path.split(' / ').slice(0, -1).join(' › ') || 'Home')}</span></li>`).join('')}</ul>
    ${items.length > 6 ? `<div class="more">+${items.length - 6} more</div>` : ''}`;
}

function anchorOfFocus() {
  if (!focus) return null;
  const box = boxOfIds(focus.matches.map((m) => m.id));
  if (box.isEmpty()) return null;
  const c = box.getCenter(new THREE.Vector3());
  return c.setY(box.max.y + 0.35);
}

// ---------------------------------------------------------------- live stream

function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('house', (e) => applyHouse(JSON.parse(e.data)));
  es.addEventListener('focus', (e) => {
    const f = JSON.parse(e.data);
    if (!f) return clearFocus();
    applyFocus(f.matches, f.caption, { source: 'claude' });
    logEvent('✦', `Claude pointed at <b>${f.matches.length === 1 ? esc(f.matches[0].name) : f.matches.length + ' things'}</b>`, 'claude');
  });
  es.onopen = () => $('#live').classList.add('on');
  es.onerror = () => $('#live').classList.remove('on');
}

// ---------------------------------------------------------------- HUD

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
const money = (n) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function updateStats() {
  const items = Object.values(house.nodes).filter((n) => n.kind === 'item');
  const value = items.reduce((s, n) => s + (n.price || 0) * Math.max(1, n.qty || 1), 0);
  const rooms = house.roots.length;
  const spots = Object.values(house.nodes).filter((n) => n.kind === 'location' && n.parentId).length;
  $('#stats').innerHTML = `
    <div><b>${items.length}</b><span>items</span></div>
    <div><b>${rooms}</b><span>rooms</span></div>
    <div><b>${spots}</b><span>storage spots</span></div>
    ${value ? `<div><b>${money(value)}</b><span>tracked value</span></div>` : ''}`;
}

function renderLegend() {
  const counts = {};
  for (const n of Object.values(house.nodes)) for (const t of n.tags || []) counts[t] = (counts[t] || 0) + 1;
  const tags = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  $('#legend').innerHTML = tags
    .map(([t, c]) => `<button data-tag="${esc(t)}"><i style="background:${tagColor(t)}"></i>${esc(t)}<em>${c}</em></button>`)
    .join('');
}
$('#legend').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const already = focus?.tag === b.dataset.tag;
  if (already) return clearFocus();
  const r = resolveQueries(house, [b.dataset.tag]);
  applyFocus(r.matches);
  focus.tag = b.dataset.tag;
});

const feed = $('#feed');
function logEvent(icon, html, cls = '') {
  const li = document.createElement('li');
  li.className = cls;
  li.innerHTML = `<span class="ic">${icon}</span><span>${html}</span>`;
  feed.prepend(li);
  requestAnimationFrame(() => li.classList.add('in'));
  while (feed.children.length > 5) feed.lastChild.remove();
  setTimeout(() => li.classList.add('old'), 12000);
}
function logChange(c) {
  const n = house.nodes[c.id];
  const where = (id) => esc(pathOf(house, id).split(' / ').slice(0, -1).join(' › '));
  if (c.type === 'added') logEvent('+', `<b>${esc(n.name)}</b> added to ${where(c.id)}`, 'add');
  if (c.type === 'moved') logEvent('→', `<b>${esc(n.name)}</b> moved to ${where(c.id)}`, 'move');
  if (c.type === 'removed') logEvent('−', `<b>${esc(c.name)}</b> removed`, 'rm');
  if (c.type === 'renamed') logEvent('✎', `<b>${esc(c.from)}</b> is now <b>${esc(n.name)}</b>`, 'move');
}

// search
const input = $('#search input');
const results = $('#results');
let resultIdx = 0;
input.addEventListener('input', () => {
  const q = input.value.trim().toLowerCase();
  if (!q) {
    results.innerHTML = '';
    return;
  }
  const words = q.split(/\s+/);
  const hits = Object.values(house.nodes)
    .filter((n) => words.every((w) => n.name.toLowerCase().includes(w) || n.tags?.some((t) => t.toLowerCase().startsWith(w))))
    .sort((a, b) => (a.kind === b.kind ? a.name.length - b.name.length : a.kind === 'item' ? -1 : 1))
    .slice(0, 8);
  resultIdx = 0;
  results.innerHTML = hits
    .map((n, i) => `<li data-id="${n.id}" class="${i === 0 ? 'sel' : ''}"><i style="background:${n.kind === 'item' ? itemColor(n) : 'transparent'}" class="${n.kind}"></i><b>${esc(n.name)}</b><span>${esc(pathOf(house, n.id).split(' / ').slice(0, -1).join(' › '))}</span></li>`)
    .join('');
});
input.addEventListener('keydown', (e) => {
  const lis = [...results.children];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    resultIdx = (resultIdx + (e.key === 'ArrowDown' ? 1 : -1) + lis.length) % Math.max(1, lis.length);
    lis.forEach((l, i) => l.classList.toggle('sel', i === resultIdx));
  }
  if (e.key === 'Enter' && lis[resultIdx]) pick(lis[resultIdx].dataset.id);
  if (e.key === 'Escape') { input.value = ''; results.innerHTML = ''; input.blur(); clearFocus(); }
});
results.addEventListener('mousedown', (e) => {
  const li = e.target.closest('li');
  if (li) pick(li.dataset.id);
});
function pick(id) {
  applyFocus([{ id, name: house.nodes[id].name, kind: house.nodes[id].kind, path: pathOf(house, id) }]);
  results.innerHTML = '';
  input.value = '';
  input.blur();
}
addEventListener('keydown', (e) => {
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && document.activeElement !== input)) {
    e.preventDefault();
    input.focus();
    input.select();
  }
  if (e.key === 'Escape' && document.activeElement !== input) {
    if (walker.active && !document.pointerLockElement) walker.exit();
    else clearFocus();
  }
});
$('#home').addEventListener('click', () => { clearFocus(); frameAll(); });
$('#style-toggle').addEventListener('click', () => setStyle(style === 'real' ? 'diorama' : 'real'));
$('#walk-toggle').addEventListener('click', () => (walker.active ? walker.exit() : startWalk()));

// hover + click
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2(9, 9); // off-screen until the pointer moves
let hovered = null;
let downAt = null;
const tip = $('#tip');
renderer.domElement.addEventListener('pointermove', (e) => {
  // with the pointer locked (walking) clientX/Y are frozen; the tip sits at the crosshair instead
  if (document.pointerLockElement === renderer.domElement) return void (lastInteraction = performance.now());
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  tip.style.transform = `translate(${Math.min(e.clientX + 16, innerWidth - 280)}px, ${Math.min(e.clientY + 16, innerHeight - 160)}px)`;
  lastInteraction = performance.now();
});
renderer.domElement.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (walker.active && document.pointerLockElement !== renderer.domElement) {
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) <= 5) renderer.domElement.requestPointerLock?.();
    return;
  }
  if (!walker.active && (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5)) return;
  if (hovered) pick(hovered);
  else if (focus) clearFocus();
});

function updateHover() {
  ray.setFromCamera(walker.active && document.pointerLockElement ? new THREE.Vector2(0, 0) : mouse, camera);
  const targets = [...itemMeshes.values()].filter((m) => m.visible && m.material.opacity > 0.5);
  const pickFrom = walker.active ? pickables.filter((p) => p.userData.kind !== 'room') : pickables;
  const hit = ray.intersectObjects(targets, false)[0] || ray.intersectObjects(pickFrom, true)[0];
  let id = null;
  if (hit) {
    let o = hit.object;
    while (o && !o.userData.id) o = o.parent;
    id = o?.userData.id || null;
  }
  if (id === hovered) return;
  if (hovered && itemMeshes.get(hovered) && !focus) itemMeshes.get(hovered).material.emissiveIntensity = 0.06;
  hovered = id && house.nodes[id] ? id : null;
  renderer.domElement.style.cursor = hovered ? 'pointer' : '';
  if (!hovered) {
    tip.hidden = true;
    return;
  }
  const n = house.nodes[hovered];
  if (itemMeshes.get(hovered)) itemMeshes.get(hovered).material.emissiveIntensity = 0.4;
  const count = n.kind === 'location' ? itemIdsUnder(n.id).length : 0;
  tip.hidden = false;
  if (walker.active && document.pointerLockElement) tip.style.transform = `translate(${innerWidth / 2 + 18}px, ${innerHeight / 2 + 18}px)`;
  tip.innerHTML = `
    ${n.imageId ? `<img src="/api/image/${n.id}/${n.imageId}" alt="">` : ''}
    <div class="t-name">${esc(n.name)}</div>
    <div class="t-path">${esc(pathOf(house, n.id).split(' / ').slice(0, -1).join(' › ') || 'Room')}</div>
    <div class="t-meta">
      ${n.kind === 'item' ? (n.tags || []).map((t) => `<span class="chip"><i style="background:${tagColor(t)}"></i>${esc(t)}</span>`).join('') : `<span class="chip">${count} item${count === 1 ? '' : 's'}</span>`}
      ${n.qty > 1 ? `<span class="chip">×${n.qty}</span>` : ''}
      ${n.price ? `<span class="chip">${money(n.price)}</span>` : ''}
      ${n.assetId ? `<span class="chip dim">#${esc(n.assetId)}</span>` : ''}
    </div>`;
}

// ---------------------------------------------------------------- loop

let lastInteraction = performance.now();
controls.addEventListener('start', () => { lastInteraction = performance.now(); controls.autoRotate = false; });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
});

const callout = $('#callout');
function loop(now) {
  const t = now / 1000;
  runTweens(now);
  if (!focus && !walker.active && now - lastInteraction > 25000 && !tweens.size) controls.autoRotate = true;
  if (!walker.active) controls.update();
  const dt = Math.min(0.05, (now - (loop.last || now)) / 1000);
  loop.last = now;
  if (walker.active) walker.update(dt);
  placeLamps();
  if (style === 'real') {
    updateCutaway(walls, camera, dt, walker.active);
    placeRoomLabels();
  }
  for (const b of beams.children) {
    if (!b.userData.pulse) continue;
    b.userData.base ??= b.scale.x;
    b.scale.setScalar(b.userData.base * (1 + 0.22 * Math.sin(t * 4)));
  }
  if (house) updateHover();

  const a = anchorOfFocus();
  if (a && !callout.hidden && !callout.classList.contains('pinned')) {
    const p = a.project(camera);
    const x = (p.x * 0.5 + 0.5) * innerWidth;
    const y = Math.max(callout.offsetHeight + 80, (-p.y * 0.5 + 0.5) * innerHeight);
    callout.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    callout.style.opacity = p.z < 1 ? 1 : 0;
  }
  composer.render();
  requestAnimationFrame(loop);
}

applyLighting();
// real furniture models: rebuild the realistic scene once they're in
loadModels().then(() => { if (style === 'real' && house) applyHouse(house); });
await document.fonts.load('800 64px Inter').catch(() => {});
connect();
requestAnimationFrame(loop);

// handy for screenshots / debugging from the console
Object.assign(window, { hb: { modelSizes, setStyle, startWalk, walker, layoutRooms: () => layout.floors.flatMap((f) => f.rooms), applyFocus, clearFocus, frameAll, get house() { return house; }, resolve: (q) => resolveQueries(house, q) } });
