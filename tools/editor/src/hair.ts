import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { HairTransform } from './variants';
import { IDENTITY_TRANSFORM } from './variants';

const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();

export const HAIR_TINTS = [
  { id: 'brown', label: '深棕', color: 0x3b2416 },
  { id: 'black', label: '黑', color: 0x1a1410 },
  { id: 'coffee', label: '咖啡', color: 0x6a4328 },
  { id: 'blonde', label: '亚麻', color: 0xc4a574 },
  { id: 'gray', label: '灰', color: 0x8a8680 },
] as const;

export const DEFAULT_HAIR_TINT = HAIR_TINTS[0].color;

function toHairMaterial(src: THREE.Material, tint: number): THREE.Material {
  const std = src as THREE.MeshStandardMaterial;
  if (std.isMeshStandardMaterial) {
    const mat = std.clone();
    mat.color.setHex(tint);
    mat.metalness = 0;
    mat.side = THREE.DoubleSide;
    if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
    return mat;
  }
  const map = 'map' in src ? (src as THREE.MeshPhongMaterial).map : null;
  const normalMap = 'normalMap' in src ? (src as THREE.MeshPhongMaterial).normalMap : null;
  const mat = new THREE.MeshPhongMaterial({
    map: map ?? undefined,
    normalMap: normalMap ?? undefined,
    color: tint,
    shininess: 14,
    specular: 0x2a2a2a,
    side: THREE.DoubleSide,
  });
  if (map) map.colorSpace = THREE.SRGBColorSpace;
  return mat;
}

export function setHairTint(root: THREE.Object3D, tint: number) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      if (mat && 'color' in mat) (mat as THREE.MeshStandardMaterial).color.setHex(tint);
    }
  });
}

export function countTris(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const idx = m.geometry.index;
    n += idx ? idx.count / 3 : m.geometry.attributes.position.count / 3;
  });
  return Math.round(n);
}

/** 丢掉发型自带骨骼，只留网格；把包围盒底中心挪到局部原点（适配 Origin at 0 / 脚底坐标系） */
export function flattenMeshes(root: THREE.Object3D): THREE.Group {
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
    const mat = toHairMaterial(src as THREE.Material, DEFAULT_HAIR_TINT);
    const out = new THREE.Mesh(geo, mat);
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
      if (m.isMesh) {
        m.geometry.translate(-c.x, -box.min.y, -c.z);
        m.geometry.computeBoundingBox();
      }
    });
  }
  return group;
}

export async function loadHairFile(file: File | string): Promise<THREE.Group> {
  const url = typeof file === 'string' ? file : URL.createObjectURL(file);
  const name = typeof file === 'string' ? file : file.name;
  try {
    if (/\.fbx$/i.test(name)) {
      const root = await fbxLoader.loadAsync(url);
      return flattenMeshes(root);
    }
    const gltf = await gltfLoader.loadAsync(url);
    return flattenMeshes(gltf.scene);
  } finally {
    if (typeof file !== 'string') URL.revokeObjectURL(url);
  }
}

/** 盖住 Kenney 短发壳的占位波波头，原点在头皮附近 */
export function makePlaceholderBob(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hairVisual';
  const mat = new THREE.MeshPhongMaterial({ color: 0x3d2914, shininess: 8 });
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.72), mat);
  cap.rotation.x = 0.18;
  cap.position.set(0, 0.07, 0.01);
  cap.castShadow = true;
  group.add(cap);
  const side = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), mat);
  side.scale.set(1.15, 0.7, 0.95);
  side.position.set(0, 0.02, 0.0);
  side.castShadow = true;
  group.add(side);
  return group;
}

export class HairRig {
  root = new THREE.Group();
  pre = new THREE.Group();
  visual: THREE.Group | null = null;
  source = '';
  preRotation: [number, number, number] = [0, 0, 0];

  constructor() {
    this.root.name = 'hairRoot';
    this.pre.name = 'hairPre';
    this.root.add(this.pre);
  }

  mount(head: THREE.Object3D, visual: THREE.Group) {
    this.clearVisual();
    this.visual = visual;
    this.pre.add(visual);
    if (this.root.parent !== head) head.add(this.root);
  }

  clearVisual() {
    if (!this.visual) return;
    this.pre.remove(this.visual);
    this.visual.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.visual = null;
  }

  unmount() {
    this.clearVisual();
    this.root.removeFromParent();
    this.source = '';
    this.setTransform(IDENTITY_TRANSFORM);
    this.setPreRotation([0, 0, 0]);
  }

  /** 用网格自身包围盒底中心对齐 Head 原点（Quaternius Origin at 0 的发在脚底坐标系里，约 y=1.5） */
  snapToHead() {
    if (!this.visual) return;
    const box = new THREE.Box3();
    this.visual.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox;
      if (b && !b.isEmpty()) box.union(b);
    });
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    this.root.position.set(-c.x, -box.min.y, -c.z);
  }

  setPreRotation(euler: [number, number, number]) {
    this.preRotation = euler;
    this.pre.rotation.set(euler[0], euler[1], euler[2], 'XYZ');
  }

  setTransform(t: HairTransform) {
    this.root.position.set(...t.position);
    this.root.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2], 'XYZ');
    this.root.scale.set(...t.scale);
  }

  getTransform(): HairTransform {
    const e = new THREE.Euler().setFromQuaternion(this.root.quaternion, 'XYZ');
    const r = (n: number) => Number(n.toFixed(4));
    return {
      position: [r(this.root.position.x), r(this.root.position.y), r(this.root.position.z)],
      rotation: [r(e.x), r(e.y), r(e.z)],
      scale: [r(this.root.scale.x), r(this.root.scale.y), r(this.root.scale.z)],
    };
  }

  resetTransform() {
    this.setTransform(IDENTITY_TRANSFORM);
  }

  async exportGlb(): Promise<ArrayBuffer> {
    if (!this.visual) throw new Error('没有发型可导出');
    const clone = this.visual.clone(true);
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.set(1, 1, 1);
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(clone, { binary: true });
    if (result instanceof ArrayBuffer) return result;
    return new TextEncoder().encode(JSON.stringify(result)).buffer;
  }
}
