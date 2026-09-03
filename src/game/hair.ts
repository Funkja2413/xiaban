import * as THREE from 'three/webgpu';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assetUrl, type HairDef, type HairTransform } from '../catalog';

const gltfLoader = () => new GLTFLoader();
const fbxLoader = () => new FBXLoader();

/** 与编辑器默认深棕一致，盖住 Quaternius 近白发卡 */
export const DEFAULT_HAIR_TINT = 0x3b2416;

export interface SlotHair {
  visual: THREE.Group;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshPhongMaterial;
  transform: HairTransform;
  preRotation: [number, number, number];
  attach: THREE.Matrix4;
}

export function findBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let bone: THREE.Object3D | null = null;
  let named: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (o.name !== name) return;
    named = o;
    if ((o as THREE.Bone).isBone) bone = o;
  });
  return bone ?? named;
}

export const BONE_HEAD = ['Head', 'head', 'mixamorigHead'];
export const BONE_HAND = ['RightHand', 'Hand_R', 'mixamorigRightHand', 'Right_Hand', 'hand_r'];

export function findBoneAny(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
  for (const n of names) {
    const found = findBone(root, n);
    if (found) return found;
  }
  return null;
}

function toHairMaterial(src: THREE.Material, tint: number): THREE.MeshPhongMaterial {
  const map = 'map' in src ? (src as THREE.MeshPhongMaterial).map : null;
  const normalMap = 'normalMap' in src ? (src as THREE.MeshPhongMaterial).normalMap : null;
  const readyMap = map && (map.image || map.source?.data) ? map : null;
  const readyNormal = normalMap && (normalMap.image || normalMap.source?.data) ? normalMap : null;
  const mat = new THREE.MeshPhongMaterial({
    map: readyMap ?? undefined,
    normalMap: readyNormal ?? undefined,
    color: tint,
    shininess: 14,
    specular: 0x2a2a2a,
    side: THREE.DoubleSide,
  });
  if (readyMap) readyMap.colorSpace = THREE.SRGBColorSpace;
  return mat;
}

/** 丢掉发型自带骨骼，只留网格；原点收到包围盒底中心（与编辑器 flatten 一致） */
export function flattenHair(root: THREE.Object3D, tint = DEFAULT_HAIR_TINT): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hairVisual';
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const out = new THREE.Mesh(geo, toHairMaterial(src as THREE.Material, tint));
    out.castShadow = true;
    group.add(out);
  });
  const box = new THREE.Box3();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    m.geometry.computeBoundingBox();
    if (m.geometry.boundingBox && !m.geometry.boundingBox.isEmpty()) box.union(m.geometry.boundingBox);
  });
  if (!box.isEmpty()) {
    const c = box.getCenter(new THREE.Vector3());
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.translate(-c.x, -box.min.y, -c.z);
      m.geometry.computeBoundingBox();
    });
  }
  return group;
}

export async function loadHairVisual(file: string): Promise<THREE.Group> {
  const url = assetUrl(file);
  if (/\.fbx$/i.test(file)) {
    const root = await fbxLoader().loadAsync(url);
    return flattenHair(root);
  }
  const gltf = await gltfLoader().loadAsync(url);
  return flattenHair(gltf.scene);
}

export function hairAttachMatrix(transform: HairTransform, preRotation: [number, number, number]): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...transform.rotation, 'XYZ'));
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...transform.position),
    q,
    new THREE.Vector3(...transform.scale)
  );
  const pre = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...preRotation, 'XYZ'));
  return m.multiply(pre);
}

export function mergeHairGeometry(visual: THREE.Group): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = [];
  visual.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) geos.push(m.geometry);
  });
  if (!geos.length) return null;
  let geo = geos[0];
  if (geos.length > 1) {
    try {
      geo = mergeGeometries(geos, false) ?? geos[0];
    } catch {
      geo = geos[0];
    }
  }
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export function firstHairMaterial(visual: THREE.Group): THREE.MeshPhongMaterial {
  let found: THREE.MeshPhongMaterial | null = null;
  visual.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!found && m.isMesh && m.material) {
      found = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshPhongMaterial;
    }
  });
  return found ?? new THREE.MeshPhongMaterial({ color: DEFAULT_HAIR_TINT, shininess: 14, side: THREE.DoubleSide });
}

export function makeSlotHair(visual: THREE.Group, def: HairDef, transform: HairTransform): SlotHair | null {
  const geometry = mergeHairGeometry(visual);
  if (!geometry) return null;
  return {
    visual,
    geometry,
    material: firstHairMaterial(visual),
    transform,
    preRotation: def.preRotation,
    attach: hairAttachMatrix(transform, def.preRotation),
  };
}

export function attachHairToHead(
  figure: THREE.Object3D,
  hair: SlotHair,
  ghostMats: THREE.MeshPhongMaterial[]
) {
  attachToBone(figure, BONE_HEAD, hair, ghostMats);
}

export function attachToBone(
  figure: THREE.Object3D,
  boneNames: string[],
  hair: SlotHair,
  ghostMats: THREE.MeshPhongMaterial[]
) {
  const head = findBoneAny(figure, boneNames);
  if (!head) return;
  const root = new THREE.Group();
  root.name = 'hairRoot';
  const pre = new THREE.Group();
  pre.name = 'hairPre';
  const visual = hair.visual.clone(true);
  visual.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = (mesh.material as THREE.Material).clone() as THREE.MeshPhongMaterial;
    mat.transparent = true;
    mesh.material = mat;
    mesh.castShadow = true;
    ghostMats.push(mat);
  });
  pre.add(visual);
  root.add(pre);
  const t = hair.transform;
  root.position.set(...t.position);
  root.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2], 'XYZ');
  root.scale.set(...t.scale);
  pre.rotation.set(hair.preRotation[0], hair.preRotation[1], hair.preRotation[2], 'XYZ');
  head.add(root);
}
