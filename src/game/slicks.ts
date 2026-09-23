import * as THREE from 'three/webgpu';
import { skillFx } from '../fx/catalog';
import type { CoffeePropId } from '../fx/days';
import { Enemies, EState } from './enemies';
import { loadPropVisual } from './hair';
import { tex } from './style';

export type SlickLook = { color: number; opacity: number; prop?: CoffeePropId };

interface Patch {
  x: number;
  z: number;
  r: number;
  life: number;
  maxLife: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  prop: THREE.Group;
  propId: CoffeePropId | null;
  sx: number;
  sz: number;
  grow: number;
  baseOp: number;
  /** 同一泼共用的剩余放倒名额。空着表示不限（编辑器预览）。 */
  budget: { left: number } | null;
}

const MAX_PATCHES = 32;
const SPLAT_VARIANTS = 4;

const PROP_FILES: Record<CoffeePropId, string> = {
  cup: '/models/colleagues/props/presets/prop-cup.glb',
  bucket: '/models/colleagues/props/presets/prop-bucket.glb',
  bento: '/models/colleagues/props/presets/prop-bento.glb',
  poop: '/models/colleagues/props/presets/prop-poop.glb',
};

/** 地面道具最长边；手持 cup 更小，污渍中心略放大 */
const PROP_FIT: Record<CoffeePropId, number> = {
  cup: 0.2,
  bucket: 0.52,
  bento: 0.34,
  poop: 0.2,
};

/** 侧倒：杯子/铝桶泼翻；便当略歪；便便直立 */
const PROP_TIP: Record<CoffeePropId, { x: number; z: number }> = {
  cup: { x: 0, z: Math.PI / 2 },
  bucket: { x: 0.15, z: 1.05 },
  bento: { x: 0.35, z: 0.55 },
  poop: { x: 0, z: 0 },
};

const ALUMINUM = 0xb8c2cc;

const templates: Partial<Record<CoffeePropId, THREE.Group>> = {};
let propLoad: Promise<void> | null = null;

/** 污渍中心道具（catalog 已登记，构建不会被 prune 掉） */
export async function preloadSlickProps() {
  if (propLoad) return propLoad;
  propLoad = (async () => {
    const ids = Object.keys(PROP_FILES) as CoffeePropId[];
    await Promise.all(
      ids.map(async (id) => {
        try {
          const visual = await loadPropVisual(PROP_FILES[id], PROP_FIT[id]);
          if (!visual.children.length) throw new Error('empty mesh');
          if (id === 'bucket') tintAluminum(visual);
          templates[id] = visual;
        } catch (err) {
          console.warn(`[slick] ${id} glb failed`, PROP_FILES[id], err);
        }
      })
    );
    const ok = ids.filter((id) => templates[id]).length;
    if (ok < ids.length) {
      console.warn(`[slick] loaded ${ok}/${ids.length} props`);
      // 允许下次再试（热更新 / 静态资源晚到）
      if (ok === 0) propLoad = null;
    }
  })();
  return propLoad;
}

function tintAluminum(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const raw of mats) {
      const mat = raw as THREE.MeshPhongMaterial;
      if (!mat?.color) continue;
      const handle = mat.name === 'DarkMetal' || mat.name === 'Metal';
      mat.color.setHex(handle ? 0x5c656e : ALUMINUM);
      mat.specular?.setHex?.(handle ? 0x9aa3ab : 0xeef2f6);
      mat.emissive?.setHex?.(handle ? 0x121416 : 0x3a424c);
      if ('shininess' in mat) mat.shininess = handle ? 28 : 56;
      mat.map = null;
      mat.needsUpdate = true;
    }
  });
}

function splatRng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clearPropChildren(prop: THREE.Group) {
  while (prop.children.length) {
    const child = prop.children[0]!;
    prop.remove(child);
    child.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  }
}

function mountProp(prop: THREE.Group, id: CoffeePropId): boolean {
  const src = templates[id];
  if (!src) return false;
  clearPropChildren(prop);
  const body = src.clone(true);
  body.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => m.clone());
    else mesh.material = (mesh.material as THREE.Material).clone();
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.renderOrder = 2;
  });
  const tip = PROP_TIP[id];
  body.rotation.x = tip.x;
  body.rotation.z = tip.z;
  prop.add(body);
  return true;
}

function placeProp(prop: THREE.Group, x: number, z: number, yaw: number) {
  prop.position.set(x, 0, z);
  prop.rotation.y = yaw;
  prop.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(prop);
  if (!box.isEmpty()) prop.position.y = -box.min.y + 0.01;
}

function setPropFade(prop: THREE.Group, opacity: number) {
  const op = Math.min(1, Math.max(0, opacity));
  prop.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const raw of mats) {
      const mat = raw as THREE.MeshPhongMaterial;
      if (!mat || !('opacity' in mat)) continue;
      mat.transparent = op < 0.999;
      mat.depthWrite = op > 0.85;
      mat.opacity = op;
      mat.needsUpdate = true;
    }
  });
}

/** 咖啡渍地形：追击中同事踩到滑倒；渍心按关放杯子/铝桶/便当/便便。 */
export class Slicks {
  private patches: Patch[] = [];
  private geo: THREE.PlaneGeometry;
  private maps: THREE.CanvasTexture[];
  private rng = splatRng(420);

  constructor(private scene: THREE.Scene) {
    this.geo = new THREE.PlaneGeometry(2, 2);
    this.geo.rotateX(-Math.PI / 2);
    this.maps = Array.from({ length: SPLAT_VARIANTS }, (_, i) => tex.stain(i));
    for (let i = 0; i < MAX_PATCHES; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.maps[i % SPLAT_VARIANTS],
        color: 0x4a2d18,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
      const prop = new THREE.Group();
      prop.name = 'slickProp';
      prop.visible = false;
      scene.add(prop);
      this.patches.push({
        x: 0,
        z: 0,
        r: 1,
        life: 0,
        maxLife: 1,
        mesh,
        mat,
        prop,
        propId: null,
        sx: 1,
        sz: 1,
        grow: 1,
        baseOp: 0.55,
        budget: null,
      });
    }
  }

  spawn(x: number, z: number, r: number, life: number, look?: SlickLook, budget?: { left: number } | null) {
    const slot = this.patches.find((p) => !p.mesh.visible) ?? this.patches.reduce((a, b) => (a.life < b.life ? a : b));
    const slick = look ?? skillFx('coffee', 1).coffee;
    const propId = look?.prop ?? 'cup';
    slot.x = x;
    slot.z = z;
    slot.r = r;
    slot.life = life;
    slot.maxLife = life;
    slot.grow = 0;
    slot.sx = 0.78 + this.rng() * 0.5;
    slot.sz = 0.68 + this.rng() * 0.42;
    slot.baseOp = look?.opacity ?? slick?.opacity ?? 0.55;
    slot.budget = budget ?? null;
    slot.mat.map = this.maps[(this.rng() * SPLAT_VARIANTS) | 0]!;
    slot.mat.color.setHex(look?.color ?? slick?.color ?? 0x4a2d18);
    slot.mat.opacity = slot.baseOp;
    slot.mat.needsUpdate = true;
    slot.mesh.position.set(x, 0.028 + this.rng() * 0.008, z);
    slot.mesh.rotation.y = this.rng() * Math.PI * 2;
    slot.mesh.scale.set(r * slot.sx * 0.35, 1, r * slot.sz * 0.35);
    slot.mesh.visible = true;

    if (slot.propId !== propId || slot.prop.children.length === 0) {
      if (mountProp(slot.prop, propId)) slot.propId = propId;
      else {
        clearPropChildren(slot.prop);
        slot.propId = null;
      }
    }
    if (slot.propId) {
      placeProp(slot.prop, x, z, this.rng() * Math.PI * 2);
      setPropFade(slot.prop, 1);
      slot.prop.visible = true;
    } else {
      slot.prop.visible = false;
    }
  }

  clear() {
    for (const p of this.patches) {
      p.mesh.visible = false;
      p.prop.visible = false;
      p.life = 0;
    }
  }

  /** 编辑器拖颜色/透明度时改现有渍，不用重播。 */
  recolorVisible(look: Pick<SlickLook, 'color' | 'opacity'>) {
    for (const p of this.patches) {
      if (!p.mesh.visible) continue;
      if (look.color != null) {
        p.mat.color.setHex(look.color);
        p.mat.needsUpdate = true;
      }
      if (look.opacity != null) {
        p.baseOp = look.opacity;
        const fade = p.life < 0.55 ? p.life / 0.55 : 1;
        p.mat.opacity = p.baseOp * fade;
      }
    }
  }

  update(dt: number, enemies: Enemies) {
    for (const p of this.patches) {
      if (!p.mesh.visible) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        p.prop.visible = false;
        continue;
      }
      p.grow = Math.min(1, p.grow + dt * 7);
      const ease = 1 - (1 - p.grow) ** 3;
      p.mesh.scale.set(p.r * p.sx * ease, 1, p.r * p.sz * ease);
      const fade = p.life < 0.55 ? p.life / 0.55 : 1;
      p.mat.opacity = p.baseOp * fade;
      if (p.prop.visible) setPropFade(p.prop, fade);

      if (p.budget && p.budget.left <= 0) continue;
      for (let i = 0; i < enemies.cap; i++) {
        if (p.budget && p.budget.left <= 0) break;
        if (enemies.state[i] !== EState.Chase) continue;
        const dx = enemies.posX[i] - p.x;
        const dz = enemies.posZ[i] - p.z;
        if (dx * dx + dz * dz < p.r * p.r && enemies.slip(i) && p.budget) p.budget.left--;
      }
    }
  }
}
