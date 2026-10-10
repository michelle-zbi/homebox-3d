// PBR materials for the realistic style. Textures are CC0 from Poly Haven
// (public/textures/<id>/{diff,nor,rough}.jpg) and tile in real-world metres:
// geometry built with worldBox()/worldUV() has UVs measured in metres, and each
// material's texture repeat is 1 / (how many metres one tile covers).
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map();

// one texture per (image, tile size); cloning before the image loads makes three warn
function tex(id, map, metres, srgb) {
  const key = `${id}/${map}@${metres}`;
  if (!cache.has(key)) {
    const t = loader.load(`/textures/${id}/${map}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.repeat.set(1 / metres, 1 / metres);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    cache.set(key, t);
  }
  return cache.get(key);
}

function pbr(id, metres, opts = {}) {
  const { noColor, ...rest } = opts;
  return new THREE.MeshStandardMaterial({
    map: noColor ? null : tex(id, 'diff', metres, true),
    normalMap: tex(id, 'nor', metres),
    roughnessMap: tex(id, 'rough', metres),
    normalScale: new THREE.Vector2(0.6, 0.6),
    ...rest,
  });
}

const plain = (color, roughness = 0.6, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

let M = null;
export function materials() {
  if (M) return M;
  M = {
    // floors
    oakFloor: pbr('wood_floor', 2.2, { roughness: 0.7, envMapIntensity: 0.8 }),
    plankFloor: pbr('laminate_floor_02', 2.4, { roughness: 0.75 }),
    parquet: pbr('herringbone_parquet', 1.6, { roughness: 0.7 }),
    tile: pbr('floor_tiles_06', 1.2, { roughness: 0.5 }),
    concrete: pbr('garage_floor', 3, { roughness: 0.9, color: '#d8d4cf' }),
    basement: pbr('concrete_floor_worn_001', 3, { roughness: 0.95 }),
    // surfaces
    wall: pbr('white_plaster_02', 2.5, { noColor: true, color: '#efebe4', roughness: 0.92, normalScale: new THREE.Vector2(0.15, 0.15) }),
    bathTile: pbr('marble_01', 0.9, { roughness: 0.25 }),
    marble: pbr('marble_01', 1.4, { roughness: 0.18 }),
    oak: pbr('oak_veneer_01', 1.2, { roughness: 0.6 }),
    walnut: pbr('wood_table_001', 1.2, { roughness: 0.55, color: '#9a7a62' }),
    fabric: pbr('fabric_pattern_07', 0.5, { noColor: true, color: '#8d8f88', roughness: 0.95 }),
    fabricWarm: pbr('fabric_pattern_07', 0.5, { noColor: true, color: '#b9a48a', roughness: 0.95 }),
    leather: pbr('fabric_leather_02', 0.6, { roughness: 0.5 }),
    rug: pbr('fabric_pattern_07', 0.35, { noColor: true, color: '#6f6a62', roughness: 1 }),
    // painted / plain
    cabinet: plain('#e9e6df', 0.45),
    cabinetDark: plain('#3a4048', 0.5),
    trim: plain('#f4f2ee', 0.5),
    // ceilings face the (green) ground in the outdoor light, so keep them neutral and a touch self-lit
    ceiling: plain('#f2f0ec', 1, 0, { envMapIntensity: 0, emissive: '#e8e4dc', emissiveIntensity: 0.32 }),
    steel: plain('#c9ccd0', 0.28, 1),
    blackSteel: plain('#2a2c30', 0.4, 0.8),
    ceramic: plain('#f7f7f5', 0.15),
    porcelain: plain('#fbfbfa', 0.08, 0, { envMapIntensity: 1.2 }),
    linen: plain('#eeebe4', 0.95),
    duvet: plain('#d9d4ca', 0.95),
    pillow: plain('#f4f1ea', 0.95),
    glass: new THREE.MeshPhysicalMaterial({ color: '#dfe9ee', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false, envMapIntensity: 1.5 }),
    mirror: plain('#dfe3e6', 0.02, 1),
    screen: plain('#0c0e11', 0.15, 0.2),
    plant: plain('#4d6b45', 0.8),
    pot: plain('#cbbfae', 0.85),
    rubber: plain('#1d1e20', 0.9),
    tote: new THREE.MeshPhysicalMaterial({ color: '#e8eef2', roughness: 0.35, transparent: true, opacity: 0.45, depthWrite: false }),
    toteLid: plain('#5a6670', 0.5),
    cardboard: plain('#b48d62', 0.9),
  };
  return M;
}

// Rewrite a BoxGeometry's UVs so 1 UV unit = 1 metre on every face.
export function worldUV(geo, w, h, d) {
  const uv = geo.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each, non-indexed by face)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
    }
  }
  uv.needsUpdate = true;
  return geo;
}
