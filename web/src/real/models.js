// Real 3D models (CC0, Poly Haven, glTF in public/models/<id>/). Loaded once; each
// use clones the scene, re-centres it on its footprint and optionally scales it to a
// target width so it fits the space the layout gave it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MODEL_IDS = [
  'Sofa_01', 'mid_century_lounge_chair', 'modern_arm_chair_01', 'modern_coffee_table_01',
  'potted_plant_01', 'potted_plant_02', 'potted_plant_04', 'dining_chair_02', 'metal_stool_02',
  'side_table_01', 'desk_lamp_arm_01',
];

const loader = new GLTFLoader();
const cache = new Map();
let ready = null;

export function loadModels() {
  ready ||= Promise.all(
    MODEL_IDS.map((id) =>
      loader
        .loadAsync(`/models/${id}/${id}.gltf`)
        .then((g) => cache.set(id, g.scene))
        .catch((e) => console.warn('model', id, e.message)),
    ),
  );
  return ready;
}

export const hasModels = () => cache.size > 0;

// Clone a model so its footprint is centred on the origin and it stands on y = 0.
// `width` scales it uniformly to that width (x); `turn` rotates it about y first.
export function model(id, { width, height, turn = 0 } = {}) {
  const src = cache.get(id);
  if (!src) return null;
  const inner = src.clone(true);
  inner.rotation.y = turn;
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3());
  const s = width ? width / size.x : height ? height / size.y : 1;
  inner.scale.setScalar(s);
  inner.updateMatrixWorld(true);
  box.setFromObject(inner);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.x -= c.x;
  inner.position.z -= c.z;
  inner.position.y -= box.min.y;
  inner.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  const g = new THREE.Group();
  g.add(inner);
  return g;
}

// For checking orientation from the console: sizes of every loaded model.
export function modelSizes() {
  return [...cache].map(([id, s]) => {
    const b = new THREE.Box3().setFromObject(s).getSize(new THREE.Vector3());
    return `${id}: ${b.x.toFixed(2)} x ${b.y.toFixed(2)} x ${b.z.toFixed(2)}`;
  });
}
