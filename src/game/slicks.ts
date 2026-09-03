import * as THREE from 'three/webgpu';
import { skillFx } from '../fx/catalog';
import { Enemies, EState } from './enemies';

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

/** 预烘焙不规则水渍：启动时画 4 张，运行时只换贴图/拉伸/旋转 */
function coffeeSplatTex(seed: number): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const rnd = splatRng(seed * 7919 + 17);
  ctx.clearRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';
  const blobs = 5 + ((rnd() * 3) | 0);
  for (let i = 0; i < blobs; i++) {
    const ox = (rnd() - 0.5) * size * 0.38;
    const oy = (rnd() - 0.5) * size * 0.34;
    const rad = size * (0.16 + rnd() * 0.28);
    const g = ctx.createRadialGradient(size * 0.5 + ox, size * 0.5 + oy, 0, size * 0.5 + ox, size * 0.5 + oy, rad);
    const core = 0.55 + rnd() * 0.4;
    g.addColorStop(0, `rgba(255,255,255,${core})`);
    g.addColorStop(0.42, `rgba(255,255,255,${core * 0.55})`);
    g.addColorStop(0.78, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const drops = 6 + ((rnd() * 5) | 0);
  for (let i = 0; i < drops; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = size * (0.2 + rnd() * 0.32);
    const x = size * 0.5 + Math.cos(ang) * dist;
    const y = size * 0.5 + Math.sin(ang) * dist;
    const rad = size * (0.035 + rnd() * 0.07);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
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
    this.maps = Array.from({ length: SPLAT_VARIANTS }, (_, i) => coffeeSplatTex(i + 1));
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
