import * as THREE from 'three/webgpu';
import { skillFx } from '../fx/catalog';
import { Enemies, EState } from './enemies';
import { tex } from './style';

interface Patch {
  x: number;
  z: number;
  r: number;
  life: number;
  maxLife: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  sx: number;
  sz: number;
  grow: number;
  baseOp: number;
}

const MAX_PATCHES = 32;
const SPLAT_VARIANTS = 4;

function splatRng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 咖啡渍地形：追击中的同事踩到会滑倒（重量级免疫） */
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
      this.patches.push({
        x: 0,
        z: 0,
        r: 1,
        life: 0,
        maxLife: 1,
        mesh,
        mat,
        sx: 1,
        sz: 1,
        grow: 1,
        baseOp: 0.55,
      });
    }
  }

  spawn(x: number, z: number, r: number, life: number, look?: { color: number; opacity: number }) {
    const slot = this.patches.find((p) => !p.mesh.visible) ?? this.patches.reduce((a, b) => (a.life < b.life ? a : b));
    const slick = look ?? skillFx('coffee', 1).coffee;
    slot.x = x;
    slot.z = z;
    slot.r = r;
    slot.life = life;
    slot.maxLife = life;
    slot.grow = 0;
    slot.sx = 0.78 + this.rng() * 0.5;
    slot.sz = 0.68 + this.rng() * 0.42;
    slot.baseOp = slick?.opacity ?? 0.55;
    slot.mat.map = this.maps[(this.rng() * SPLAT_VARIANTS) | 0]!;
    slot.mat.color.setHex(slick?.color ?? 0x4a2d18);
    slot.mat.opacity = slot.baseOp;
    slot.mat.needsUpdate = true;
    slot.mesh.position.set(x, 0.028 + this.rng() * 0.008, z);
    slot.mesh.rotation.y = this.rng() * Math.PI * 2;
    slot.mesh.scale.set(r * slot.sx * 0.35, 1, r * slot.sz * 0.35);
    slot.mesh.visible = true;
  }

  clear() {
    for (const p of this.patches) {
      p.mesh.visible = false;
      p.life = 0;
    }
  }

  update(dt: number, enemies: Enemies) {
    for (const p of this.patches) {
      if (!p.mesh.visible) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      p.grow = Math.min(1, p.grow + dt * 7);
      const ease = 1 - (1 - p.grow) ** 3;
      p.mesh.scale.set(p.r * p.sx * ease, 1, p.r * p.sz * ease);
      const fade = p.life < 0.55 ? p.life / 0.55 : 1;
      p.mat.opacity = p.baseOp * fade;

      for (let i = 0; i < enemies.cap; i++) {
        if (enemies.state[i] !== EState.Chase) continue;
        const dx = enemies.posX[i] - p.x;
        const dz = enemies.posZ[i] - p.z;
        if (dx * dx + dz * dz < p.r * p.r) enemies.slip(i);
      }
    }
  }
}
