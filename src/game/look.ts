import * as THREE from 'three/webgpu';
import { commonFx, crowdFx, dashFx, mergeHazardFx, overtimePopText, playerRingFx, type ChannelLookFx, type HaloBandFx, type HitFx, type ImpactMistFx, type OvertimeFx, type PaperBurstFx, type ShockRingFx, type SlowLookFx, type StunElem, type StunLookFx, type TrailFx } from '../fx/catalog';
import type { ChairStyle, DeskDef, DeskKit, DeskTop, FurnitureTone, PlantKit, PropDef, PropKind, SkyKind } from '../levels';
import { deskYaw, ELEVATOR_PAD_ALONG, ELEVATOR_PAD_FAR, ELEVATOR_PAD_NEAR, hexToInt, migrateHexColor } from '../levels';
import { channelStampMap } from './channelStamp';
import { mats, phong, phongFresh, tex } from './style';

type FurnLook = {
  body: number;
  bodyAlt: number;
  wood: number;
  woodPlank: number;
  woodDark: number;
  metal: number;
  fabric: number;
  fabricAlt: number;
  leather: number;
  appliance: number;
  applianceDark: number;
  bin: number;
  pot: number;
  sofa: number;
  locker: number;
  slot: number;
  kb: number;
  mouse: number;
  bezel: number;
  pad: number;
  frame: number;
};

const LIGHT_FURN: FurnLook = {
  body: 0xf3f1ec,
  bodyAlt: 0xe6e2da,
  wood: 0xe8dfd2,
  woodPlank: 0xddd4c6,
  woodDark: 0xc8bfb4,
  metal: 0xd4dae0,
  fabric: 0xeee8de,
  fabricAlt: 0xd8cfc4,
  leather: 0xf0ebe4,
  appliance: 0xf5f6f8,
  applianceDark: 0xc5cad0,
  bin: 0xe8ecef,
  pot: 0xf2efe8,
  sofa: 0xe4ddd4,
  locker: 0xe8edf2,
  slot: 0xd0cac0,
  kb: 0xe6e4e0,
  mouse: 0xdedcd8,
  bezel: 0xc8ccd2,
  pad: 0xf7f4ee,
  frame: 0xd8dce0,
};

const DARK_FURN: FurnLook = {
  body: 0x3a322c,
  bodyAlt: 0x2a2622,
  wood: 0xc4b8a4,
  woodPlank: 0xc4b49a,
  woodDark: 0x8a7a66,
  metal: 0x8a9098,
  fabric: 0x3d6a8a,
  fabricAlt: 0x2a4a62,
  leather: 0x1a1410,
  appliance: 0x2a2e34,
  applianceDark: 0x1a1c20,
  bin: 0x3a4048,
  pot: 0xb85c38,
  sofa: 0x3d6a8a,
  locker: 0x4a6280,
  slot: 0x8a7a66,
  kb: 0x2a2e34,
  mouse: 0x2c3036,
  bezel: 0x1a1d22,
  pad: 0x2a3038,
  frame: 0x3a3e44,
};

function mixHex(a: number, b: number, t: number) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}

function scaleHex(a: number, k: number) {
  const c = new THREE.Color(a);
  c.r = Math.min(1, c.r * k);
  c.g = Math.min(1, c.g * k);
  c.b = Math.min(1, c.b * k);
  return c.getHex();
}

/** 亮色 = 白/米家具配深地板；暗色 = 现有木色/炭灰。color 有值时整件换成该主色。 */
export function furnitureLook(tone: FurnitureTone = 'dark', color?: string): FurnLook {
  const base = tone === 'light' ? LIGHT_FURN : DARK_FURN;
  const hex = migrateHexColor(color);
  if (!hex) return base;
  const main = hexToInt(hex);
  const dark = scaleHex(main, 0.78);
  const darker = scaleHex(main, 0.55);
  const pale = mixHex(main, 0xffffff, 0.28);
  const metal = mixHex(main, 0x8a9098, 0.4);
  return {
    body: main,
    bodyAlt: dark,
    wood: mixHex(main, 0xc4b49a, 0.22),
    woodPlank: mixHex(main, 0xb8a888, 0.28),
    woodDark: darker,
    metal,
    fabric: main,
    fabricAlt: dark,
    leather: darker,
    appliance: main,
    applianceDark: dark,
    bin: mixHex(main, 0x4a5058, 0.25),
    pot: main,
    sofa: main,
    locker: main,
    slot: dark,
    kb: darker,
    mouse: dark,
    bezel: darker,
    pad: pale,
    frame: metal,
  };
}

function isTinted(color?: string) {
  return !!migrateHexColor(color);
}

function shade(tone: FurnitureTone, color: string | undefined, pal: FurnLook, key: keyof FurnLook, darkHex: number) {
  return isTinted(color) || tone === 'light' ? pal[key] : darkHex;
}

/** 自定义色用近白织纹，避免蓝布纹把橙/红/黄乘没。 */
function clothFor(color?: string) {
  return isTinted(color) ? tex.cloth() : tex.fabric();
}

const HAIR = [0x2c1a10, 0x5c4033, 0x8b5a2b, 0xc4a574, 0x3d2914, 0x6d4c41];

export function hairColor(i: number) {
  return HAIR[i % HAIR.length];
}

/** 玩家：衬衫贴图 + 四肢，材质独立以便虚化 */
export function buildPlayerFigure(): { group: THREE.Group; ghostMats: THREE.MeshPhongMaterial[] } {
  const group = new THREE.Group();
  const ghostMats: THREE.MeshPhongMaterial[] = [];
  const add = (mesh: THREE.Mesh, ghost = false) => {
    mesh.castShadow = true;
    group.add(mesh);
    if (ghost && mesh.material instanceof THREE.MeshPhongMaterial) {
      mesh.material.transparent = true;
      ghostMats.push(mesh.material);
    }
  };

  const pants = phongFresh({ color: 0x2c3544, map: tex.pants(), transparent: true, shininess: 10, specular: 0x222222 });
  const shirt = phongFresh({ color: 0x3b82f6, map: tex.shirt(), transparent: true, shininess: 16, specular: 0x446688 });
  const skin = phongFresh({ color: 0xf0c4a0, map: tex.skin(), transparent: true, shininess: 36, specular: 0x553322 });
  const hair = phongFresh({ color: 0x4a3224, map: tex.hair(), transparent: true, shininess: 18, specular: 0x221100 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.48, 4, 10), shirt);
  torso.position.set(0, 0.96, 0);
  add(torso, true);

  const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.38, 3, 6), pants);
  leftLeg.position.set(-0.16, 0.4, 0);
  leftLeg.name = 'leftLeg';
  add(leftLeg, true);
  const rightLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.38, 3, 6), pants);
  rightLeg.position.set(0.16, 0.4, 0);
  rightLeg.name = 'rightLeg';
  add(rightLeg, true);

  const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.32, 3, 6), shirt);
  leftArm.position.set(-0.32, 1.12, 0);
  leftArm.name = 'leftArm';
  add(leftArm, true);
  const rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.32, 3, 6), shirt);
  rightArm.position.set(0.32, 1.12, 0);
  rightArm.name = 'rightArm';
  add(rightArm, true);

  const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.22), phong({ color: 0x1a1c20, shininess: 40, specular: 0x555555 }));
  shoeL.position.set(-0.16, 0.05, 0.04);
  add(shoeL);
  const shoeR = shoeL.clone();
  shoeR.position.x = 0.12;
  add(shoeR);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.175, 12, 10), skin);
  head.position.set(0, 1.46, 0);
  add(head, true);

  const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.48), hair);
  hairMesh.position.set(0, 1.55, -0.05);
  hairMesh.scale.set(1.12, 0.72, 1.18);
  add(hairMesh, true);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.38, 0.5, 24),
    new THREE.MeshBasicMaterial({ color: 0x7ef0a0, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);

  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.14), phong({ color: 0x1e293b, shininess: 20 }));
  pack.position.set(0, 0.98, -0.3);
  add(pack);

  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.02), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
  badge.position.set(0.13, 1.06, 0.25);
  group.add(badge);

  return { group, ghostMats };
}

export function deskAO(parent: THREE.Group, w: number, d: number) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 0.45, d + 0.45),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0.011, 0);
  parent.add(mesh);
}

/** 命中冲击环 */
function fxBlend(additive: boolean) {
  return additive ? THREE.AdditiveBlending : THREE.NormalBlending;
}

const HALO_TEX = 160;

function smooth01(e0: number, e1: number, x: number) {
  if (e1 <= e0) return x >= e1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function hash01(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function paintBand(
  ctx: CanvasRenderingContext2D,
  band: HaloBandFx,
  pad: number,
  fill: number,
  dashed: boolean,
  hotspot: number
) {
  const size = ctx.canvas.width || HALO_TEX;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const cx = (size - 1) * 0.5;
  const inner = Math.max(0.02, band.inner);
  const outer = Math.max(inner + 0.02, band.outer);
  const edge = Math.max(pad / cx, band.softness * (outer - inner + 0.08) * 0.9);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cx;
      const ang = Math.atan2(dy, dx);
      const r = (Math.hypot(dx, dy) / cx) * pad;
      const aIn = smooth01(inner - edge, inner + edge, r);
      const aOut = 1 - smooth01(outer - edge, outer + edge, r);
      let a = aIn * aOut;
      if (fill > 0 && r < inner + edge) {
        const core = 1 - smooth01(0, Math.max(0.02, inner * 0.92), r);
        a = Math.max(a, fill * core);
      }
      if (dashed && a > 0.002) {
        const u = ((ang + Math.PI) / (Math.PI * 2)) * 8;
        if (u - Math.floor(u) > 0.58) a = 0;
      }
      if (hotspot > 0 && a > 0.002) {
        const lobe = Math.max(0, Math.cos(ang));
        a *= 1 - hotspot * 0.62 + hotspot * 1.4 * lobe * lobe;
      }
      const i = (y * size + x) * 4;
      const v = Math.round(Math.min(1, Math.max(0, a)) * 255);
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const SLOW_TEX_SIZE = 96;
const slowAuraCache = new Map<string, THREE.CanvasTexture>();

/** 减速脚底圈：按内径/模糊/心雾缓存贴图，全场共用，不给每个角色单独画布 */
function slowAuraMap(innerFrac: number, softness: number, fill: number): THREE.CanvasTexture {
  const inner = Math.max(0, Math.min(0.82, innerFrac));
  const soft = Math.max(0, Math.min(1, softness));
  const f = Math.max(0, Math.min(1, fill));
  const key = `${inner.toFixed(2)}:${soft.toFixed(2)}:${f.toFixed(2)}`;
  let tex = slowAuraCache.get(key);
  if (tex) return tex;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SLOW_TEX_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const disc = inner <= 0.03;
  const band: HaloBandFx = {
    on: true,
    color: 0xffffff,
    opacity: 1,
    inner: disc ? 0.05 : 0.12 + inner * 0.62,
    outer: 0.78,
    softness: soft,
    additive: false,
  };
  paintBand(ctx, band, 1, disc ? Math.max(f, 0.78) : f, false, 0);
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  slowAuraCache.set(key, tex);
  return tex;
}

class HaloLayer {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private map: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D | null;
  private key = '';
  pad = 0.6;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = HALO_TEX;
    canvas.height = HALO_TEX;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.map = new THREE.CanvasTexture(canvas);
    this.map.colorSpace = THREE.NoColorSpace;
    this.mat = new THREE.MeshBasicMaterial({
      map: this.map,
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 2;
  }

  apply(band: HaloBandFx, fill: number, dashed: boolean, hotspot: number, mul: number, pulseScale: number) {
    if (!band.on) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const inner = Math.max(0.02, band.inner);
    const outer = Math.max(inner + 0.02, band.outer);
    const key = `${inner.toFixed(3)}:${outer.toFixed(3)}:${band.softness.toFixed(3)}:${fill.toFixed(3)}:${dashed ? 1 : 0}:${hotspot.toFixed(3)}`;
    if (key !== this.key && this.ctx) {
      this.key = key;
      this.pad = outer + band.softness * 0.55 + 0.1;
      paintBand(this.ctx, { ...band, inner, outer }, this.pad, fill, dashed, hotspot);
      this.map.needsUpdate = true;
    }
    this.mat.color.setHex(band.color);
    this.mat.opacity = Math.max(0, Math.min(1, band.opacity * mul));
    this.mat.blending = fxBlend(band.additive);
    const s = this.pad * 2 * pulseScale;
    this.mesh.scale.set(s, s, 1);
  }
}

/** 玩家脚下光环：内环 / 外环分开画，样式由 catalog 锁 */
export class PlayerHalo {
  readonly group = new THREE.Group();
  private spin = new THREE.Group();
  private core = new HaloLayer();
  private rim = new HaloLayer();
  private t = 0;
  private flickerMul = 1;

  constructor() {
    this.core.mesh.renderOrder = 2;
    this.rim.mesh.renderOrder = 1;
    this.rim.mesh.position.y = 0.004;
    this.spin.add(this.core.mesh, this.rim.mesh);
    this.group.add(this.spin);
    this.update(0, false);
  }

  update(dt: number, dashing = false) {
    const cfg = playerRingFx();
    this.t += dt;
    this.group.position.y = cfg.y;
    this.spin.rotation.y += cfg.spin * dt * Math.PI * 2;

    const pulse = cfg.pulse * Math.sin(this.t * cfg.pulseSpeed * Math.PI * 2);
    const dash = dashing ? cfg.dashBoost : 0;
    if (cfg.flicker <= 0.001) this.flickerMul = 1;
    else {
      const target = 1 - cfg.flicker * hash01(Math.floor(this.t * Math.max(0.4, cfg.flickerSpeed) * 3));
      this.flickerMul += (target - this.flickerMul) * Math.min(1, dt * 22);
    }
    const mul = this.flickerMul * (1 + pulse * 0.28) * (1 + dash);
    const scale = 1 + pulse * 0.1 + dash * 0.06;
    const dashed = cfg.style === 'dashed';
    this.core.apply(cfg.core, cfg.fill, dashed, cfg.hotspot, mul, scale);
    this.rim.apply(cfg.rim, 0, dashed, cfg.hotspot, mul, scale);
  }
}

export class ShockRing {
  private rings: {
    mesh: THREE.Mesh;
    fill: THREE.Mesh;
    life: number;
    max: number;
    startScale: number;
    grow: number;
    opacity: number;
    fillOpacity: number;
  }[] = [];
  private geo = new THREE.RingGeometry(0.35, 0.55, 24);
  private fillGeo = new THREE.CircleGeometry(0.52, 24);
  private pool: { ring: THREE.Mesh; fill: THREE.Mesh }[] = [];

  constructor(private scene: THREE.Scene) {
    this.geo.rotateX(-Math.PI / 2);
    this.fillGeo.rotateX(-Math.PI / 2);
    const n = Math.max(1, commonFx().pools.ring | 0);
    const cfg = {
      color: 0xffe7a0,
      opacity: 0.7,
      additive: true,
      fillOpacity: 0.12,
    };
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: cfg.color,
        transparent: true,
        opacity: cfg.opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: fxBlend(cfg.additive),
      });
      const fillMat = new THREE.MeshBasicMaterial({
        color: cfg.color,
        transparent: true,
        opacity: cfg.fillOpacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: fxBlend(cfg.additive),
      });
      const ring = new THREE.Mesh(this.geo, mat);
      const fill = new THREE.Mesh(this.fillGeo, fillMat);
      ring.visible = false;
      fill.visible = false;
      ring.castShadow = false;
      fill.castShadow = false;
      scene.add(ring);
      scene.add(fill);
      this.pool.push({ ring, fill });
    }
  }

  spawn(x: number, z: number, look?: ShockRingFx, color?: number) {
    const cfg = look ?? {
      color: 0xffe7a0,
      opacity: 0.7,
      duration: 0.28,
      startScale: 0.4,
      grow: 2.4,
      y: 0.06,
      yStep: 0,
      recycle: true,
      additive: true,
      fillOpacity: 0.12,
    };
    const slot = this.pool.find((p) => !p.ring.visible) ?? (cfg.recycle ? this.pool[0] : undefined);
    if (!slot) return;
    const idx = Math.max(0, this.pool.indexOf(slot));
    const hex = color ?? cfg.color;
    const y = cfg.y + idx * cfg.yStep;
    const ringMat = slot.ring.material as THREE.MeshBasicMaterial;
    const fillMat = slot.fill.material as THREE.MeshBasicMaterial;
    ringMat.color.setHex(hex);
    fillMat.color.setHex(hex);
    ringMat.opacity = cfg.opacity;
    fillMat.opacity = cfg.fillOpacity;
    ringMat.blending = fxBlend(cfg.additive);
    fillMat.blending = fxBlend(cfg.additive);
    slot.ring.position.set(x, y, z);
    slot.fill.position.set(x, y - 0.002, z);
    slot.ring.scale.setScalar(cfg.startScale);
    // 心盘只留脚底闪光，不跟着环扩成一团体积光
    slot.fill.scale.setScalar(Math.max(0.28, cfg.startScale * 0.9));
    slot.ring.visible = true;
    slot.fill.visible = cfg.fillOpacity > 0.01;
    const rec = this.rings.find((r) => r.mesh === slot.ring);
    const snap = {
      life: cfg.duration,
      max: cfg.duration,
      startScale: cfg.startScale,
      grow: cfg.grow,
      opacity: cfg.opacity,
      fillOpacity: cfg.fillOpacity,
    };
    if (rec) Object.assign(rec, snap, { fill: slot.fill });
    else this.rings.push({ mesh: slot.ring, fill: slot.fill, ...snap });
  }

  update(dt: number) {
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.life -= dt;
      const k = 1 - r.life / r.max;
      const s = r.startScale + k * r.grow;
      r.mesh.scale.setScalar(s);
      r.fill.scale.setScalar(Math.max(0.28, r.startScale * 0.9));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, r.opacity * (1 - k));
      (r.fill.material as THREE.MeshBasicMaterial).opacity = Math.max(0, r.fillOpacity * (1 - k) * (1 - k));
      if (r.life <= 0) {
        r.mesh.visible = false;
        r.fill.visible = false;
      }
    }
  }

  dispose() {
    for (const p of this.pool) {
      this.scene.remove(p.ring);
      this.scene.remove(p.fill);
      (p.ring.material as THREE.Material).dispose();
      (p.fill.material as THREE.Material).dispose();
    }
    this.pool.length = 0;
    this.rings.length = 0;
    this.geo.dispose();
    this.fillGeo.dispose();
  }
}
function deskSurface(top: DeskTop) {
  if (top === 'walnut') {
    return {
      board: phongFresh({ color: 0x6b4423, map: tex.wood(), bumpMap: tex.woodBump(), bumpScale: 0.8, shininess: 32, specular: 0x442200 }),
      leg: phongFresh({ color: 0x2a1c12, shininess: 40 }),
      panel: phongFresh({ color: 0x5a381c, shininess: 18 }),
    };
  }
  if (top === 'dark') {
    return {
      board: phongFresh({ color: 0x3a332c, shininess: 28, specular: 0x221800 }),
      leg: phongFresh({ color: 0x1a1a1c, shininess: 50, specular: 0x444444 }),
      panel: phongFresh({ color: 0x2a2622, shininess: 16 }),
    };
  }
  if (top === 'white') {
    return {
      board: phongFresh({ color: 0xece8e0, shininess: 42, specular: 0x888888 }),
      leg: mats.metal(),
      panel: phongFresh({ color: 0xd8d4cc, shininess: 22 }),
    };
  }
  if (top === 'steel') {
    return {
      board: phongFresh({ color: 0x8a9098, map: tex.metal(), shininess: 70, specular: 0xaaaaaa }),
      leg: mats.metal(),
      panel: phongFresh({ color: 0x6a7078, shininess: 40 }),
    };
  }
  if (top === 'bench') {
    return {
      board: phongFresh({ color: 0xf2f0ec, shininess: 42, specular: 0x888888 }),
      leg: mats.metal(),
      panel: phongFresh({ color: 0xc4282e, shininess: 22, specular: 0x662222 }),
    };
  }
  return { board: mats.wood(), leg: mats.metal(), panel: mats.wood() };
}

function addCup(parent: THREE.Group, x: number, y: number, z: number, color = 0xf0f0f0) {
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.08, 8), phong({ color, shininess: 50 }));
  cup.position.set(x, y, z);
  parent.add(cup);
}

function addKeyboard(parent: THREE.Group, x: number, y: number, z: number, color = 0x2a2e34) {
  const kb = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.025, 0.14), phong({ color, shininess: 25 }));
  kb.position.set(x, y, z);
  parent.add(kb);
}

function addMouse(parent: THREE.Group, x: number, y: number, z: number, color = 0x2c3036) {
  const mouse = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.11), phong({ color, shininess: 35 }));
  mouse.position.set(x, y, z);
  parent.add(mouse);
}

function addMonitor(parent: THREE.Group, x: number, z: number, face: number, opts: { wide?: boolean; y?: number; bezel?: number } = {}) {
  const tilt = -0.48 * face;
  const y = opts.y ?? 1.16;
  const bw = opts.wide ? 0.72 : 0.56;
  const sw = opts.wide ? 0.66 : 0.5;
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.38, 0.05), phong({ color: opts.bezel ?? 0x1a1d22, shininess: 40 }));
  bezel.position.set(x, y, z);
  bezel.rotation.x = tilt;
  bezel.castShadow = true;
  parent.add(bezel);
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(sw, 0.32, 0.02),
    new THREE.MeshBasicMaterial({ map: tex.screen(), color: 0xd8f4ff })
  );
  screen.position.set(x, y, z + 0.06 * face);
  screen.rotation.x = tilt;
  parent.add(screen);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.08, 0.16, 6), mats.metal());
  stand.position.set(x, y - 0.3, z);
  parent.add(stand);
}

function addLaptop(parent: THREE.Group, x: number, z: number, face: number) {
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.018, 0.24), phong({ color: 0xc8ccd2, shininess: 60, specular: 0x8899aa }));
  base.position.set(x, 0.785, z + 0.08 * face);
  parent.add(base);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.012), phong({ color: 0xb8bcc2, shininess: 50 }));
  lid.position.set(x, 0.9, z - 0.04 * face);
  lid.rotation.x = -0.85 * face;
  lid.castShadow = true;
  parent.add(lid);
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.18, 0.006),
    new THREE.MeshBasicMaterial({ map: tex.screen(), color: 0xc8e8ff })
  );
  screen.position.set(x, 0.9, z - 0.03 * face);
  screen.rotation.x = -0.85 * face;
  parent.add(screen);
}

function addPapers(parent: THREE.Group, x: number, z: number, face: number) {
  const paper = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.008, 0.26), phong({ color: 0xf4f1ea, shininess: 8 }));
  paper.position.set(x, 0.782, z + 0.1 * face);
  paper.rotation.y = 0.2;
  parent.add(paper);
  const paper2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.008, 0.2), phong({ color: 0xfff8d8, shininess: 8 }));
  paper2.position.set(x + 0.06, 0.79, z + 0.04 * face);
  paper2.rotation.y = -0.35;
  parent.add(paper2);
}

function addDeskPlant(parent: THREE.Group, x: number, z: number, tall = false) {
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(tall ? 0.05 : 0.04, 0.035, tall ? 0.08 : 0.06, 8), phong({ color: 0xb85c38, shininess: 18 }));
  pot.position.set(x, 0.81, z);
  parent.add(pot);
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(tall ? 0.1 : 0.07, 8, 6), phong({ color: tall ? 0x247a3c : 0x2f8a48, shininess: 16 }));
  leaf.position.set(x, tall ? 0.96 : 0.9, z);
  parent.add(leaf);
  if (tall) {
    const leaf2 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 7, 5), phong({ color: 0x1f6a32, shininess: 16 }));
    leaf2.position.set(x + 0.05, 0.92, z - 0.03);
    parent.add(leaf2);
  }
}

function addBook(parent: THREE.Group, x: number, z: number, rotY: number, color: number, h = 0.03) {
  const book = new THREE.Mesh(new THREE.BoxGeometry(0.16, h, 0.22), phong({ color, shininess: 12 }));
  book.position.set(x, 0.78 + h / 2, z);
  book.rotation.y = rotY;
  parent.add(book);
}

function addPhone(parent: THREE.Group, x: number, z: number, rotY: number) {
  const phone = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.14), phong({ color: 0x1a1c20, shininess: 60 }));
  phone.position.set(x, 0.786, z);
  phone.rotation.y = rotY;
  parent.add(phone);
}

function addHeadphones(parent: THREE.Group, x: number, z: number) {
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 12, Math.PI), phong({ color: 0x222428, shininess: 30 }));
  band.position.set(x, 0.86, z);
  band.rotation.z = Math.PI / 2;
  parent.add(band);
  const cupL = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 8), phong({ color: 0x1a1c20, shininess: 25 }));
  cupL.rotation.z = Math.PI / 2;
  cupL.position.set(x, 0.82, z + 0.07);
  parent.add(cupL);
  const cupR = cupL.clone();
  cupR.position.z = z - 0.07;
  parent.add(cupR);
}

function addPenCup(parent: THREE.Group, x: number, z: number) {
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.07, 8), phong({ color: 0xc45c48, shininess: 30 }));
  cup.position.set(x, 0.815, z);
  parent.add(cup);
  const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 5), phong({ color: 0x1a4a8a, shininess: 40 }));
  pen.position.set(x + 0.01, 0.88, z);
  pen.rotation.z = 0.15;
  parent.add(pen);
}

function addSticky(parent: THREE.Group, x: number, y: number, z: number, color: number, rotX: number, rotY = 0) {
  const note = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.004), phong({ color, shininess: 6 }));
  note.position.set(x, y, z);
  note.rotation.x = rotX;
  note.rotation.y = rotY;
  parent.add(note);
}

function addCan(parent: THREE.Group, x: number, z: number, color: number) {
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.1, 8), phong({ color, shininess: 55, specular: 0x888888 }));
  can.position.set(x, 0.83, z);
  parent.add(can);
}

function addTissue(parent: THREE.Group, x: number, z: number) {
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.1), phong({ color: 0xf2e6d8, shininess: 10 }));
  box.position.set(x, 0.82, z);
  parent.add(box);
}

function addFrame(parent: THREE.Group, x: number, z: number, face: number) {
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.02), phong({ color: 0xc4a574, shininess: 25 }));
  frame.position.set(x, 0.86, z);
  frame.rotation.x = -0.35 * face;
  parent.add(frame);
  const pic = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.008), phong({ color: 0x88aacc, shininess: 8 }));
  pic.position.set(x, 0.86, z + 0.012 * face);
  pic.rotation.x = -0.35 * face;
  parent.add(pic);
}

function addPad(parent: THREE.Group, x: number, z: number, face: number, color = 0x2a3038) {
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.008, 0.22), phong({ color, shininess: 8 }));
  pad.position.set(x, 0.778, z + 0.22 * face);
  parent.add(pad);
}

function addNameplate(parent: THREE.Group, x: number, z: number, face: number) {
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.06), phong({ color: 0xc4b49a, shininess: 30 }));
  base.position.set(x, 0.79, z);
  parent.add(base);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.008), phong({ color: 0xf0ece4, shininess: 18 }));
  plate.position.set(x, 0.82, z + 0.01 * face);
  plate.rotation.x = -0.25 * face;
  parent.add(plate);
}

function addStapler(parent: THREE.Group, x: number, z: number, rotY: number) {
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 0.04), phong({ color: 0xc03030, shininess: 40 }));
  body.position.set(x, 0.798, z);
  body.rotation.y = rotY;
  parent.add(body);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.035), phong({ color: 0xa02828, shininess: 40 }));
  arm.position.set(x - 0.01, 0.82, z);
  arm.rotation.y = rotY;
  parent.add(arm);
}

function addTape(parent: THREE.Group, x: number, z: number) {
  const roll = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.01, 6, 10), phong({ color: 0xe8d080, shininess: 35 }));
  roll.position.set(x, 0.81, z);
  roll.rotation.x = Math.PI / 2;
  parent.add(roll);
}

function addTray(parent: THREE.Group, x: number, z: number, face: number) {
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.025, 0.28), phong({ color: 0xb8c0c8, shininess: 22 }));
  tray.position.set(x, 0.792, z);
  parent.add(tray);
  const stack = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.24), phong({ color: 0xf4f0e6, shininess: 6 }));
  stack.position.set(x, 0.825, z + 0.01 * face);
  parent.add(stack);
}

function addBottle(parent: THREE.Group, x: number, z: number, color = 0x3a82c8) {
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.16, 8), phong({ color, shininess: 55, specular: 0x88aacc }));
  body.position.set(x, 0.86, z);
  parent.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.025, 6), phong({ color: 0x1a1c20, shininess: 30 }));
  cap.position.set(x, 0.95, z);
  parent.add(cap);
}

function addNoodles(parent: THREE.Group, x: number, z: number) {
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.09, 10), phong({ color: 0xe8a030, shininess: 25 }));
  cup.position.set(x, 0.825, z);
  parent.add(cup);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.008, 10), phong({ color: 0xf4e8c8, shininess: 12 }));
  lid.position.set(x, 0.872, z);
  parent.add(lid);
}

function addSnack(parent: THREE.Group, x: number, z: number, rotY: number, color = 0xc45c38) {
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.04), phong({ color, shininess: 18 }));
  bag.position.set(x, 0.835, z);
  bag.rotation.y = rotY;
  parent.add(bag);
}

function addDock(parent: THREE.Group, x: number, z: number, face: number) {
  const dock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.1), phong({ color: 0x2a2e34, shininess: 45 }));
  dock.position.set(x, 0.798, z);
  parent.add(dock);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 0.008), new THREE.MeshBasicMaterial({ color: 0x4ade80 }));
  led.position.set(x - 0.05, 0.818, z + 0.04 * face);
  parent.add(led);
}

function addWebcam(parent: THREE.Group, x: number, y: number, z: number, face: number) {
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 0.04), phong({ color: 0x1a1c20, shininess: 40 }));
  cam.position.set(x, y, z);
  parent.add(cam);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 8), phong({ color: 0x223344, shininess: 70 }));
  lens.rotation.x = Math.PI / 2;
  lens.position.set(x, y, z + 0.02 * face);
  parent.add(lens);
}

function addSpeaker(parent: THREE.Group, x: number, z: number) {
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.07), phong({ color: 0x2a2c30, shininess: 28 }));
  box.position.set(x, 0.84, z);
  parent.add(box);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.01, 8), phong({ color: 0x4a4e54, shininess: 12 }));
  cone.position.set(x, 0.86, z + 0.032);
  cone.rotation.x = Math.PI / 2;
  parent.add(cone);
}

function addDeskLamp(parent: THREE.Group, x: number, z: number, face: number) {
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.02, 8), mats.metal());
  base.position.set(x, 0.79, z);
  parent.add(base);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.22, 0.018), mats.metal());
  arm.position.set(x, 0.9, z - 0.02 * face);
  arm.rotation.x = 0.35 * face;
  parent.add(arm);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.05, 8), new THREE.MeshBasicMaterial({ color: 0xffe7b0 }));
  head.position.set(x, 1.02, z + 0.04 * face);
  head.rotation.x = 1.1 * face;
  parent.add(head);
}

function addBadge(parent: THREE.Group, x: number, z: number, rotY: number) {
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.002, 0.09), phong({ color: 0xe8f0ff, shininess: 40 }));
  card.position.set(x, 0.782, z);
  card.rotation.y = rotY;
  parent.add(card);
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 0.015), mats.metal());
  clip.position.set(x, 0.788, z - 0.04);
  parent.add(clip);
}

function addGlasses(parent: THREE.Group, x: number, z: number, rotY: number) {
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.008, 0.04), phong({ color: 0x1a1c20, shininess: 50 }));
  frame.position.set(x, 0.784, z);
  frame.rotation.y = rotY;
  parent.add(frame);
}

function addCable(parent: THREE.Group, x: number, z: number, rotY: number) {
  const cord = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.007, 5, 10), phong({ color: 0x1a1c20, shininess: 20 }));
  cord.position.set(x, 0.786, z);
  cord.rotation.x = Math.PI / 2;
  cord.rotation.z = rotY;
  parent.add(cord);
}

function addCalendar(parent: THREE.Group, x: number, z: number, face: number) {
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.02), phong({ color: 0xf4f0e8, shininess: 10 }));
  body.position.set(x, 0.85, z);
  body.rotation.x = -0.2 * face;
  parent.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.022), phong({ color: 0xc03030, shininess: 16 }));
  head.position.set(x, 0.91, z - 0.002 * face);
  head.rotation.x = -0.2 * face;
  parent.add(head);
}

function addFigurine(parent: THREE.Group, x: number, z: number, color: number) {
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.035, 7, 6), phong({ color, shininess: 35 }));
  body.position.set(x, 0.82, z);
  parent.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), phong({ color: 0xf0c4a0, shininess: 20 }));
  head.position.set(x, 0.86, z);
  parent.add(head);
}

function addUsbHub(parent: THREE.Group, x: number, z: number, face: number) {
  const hub = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.018, 0.04), phong({ color: 0x3a3e44, shininess: 40 }));
  hub.position.set(x, 0.79, z);
  parent.add(hub);
  for (let i = 0; i < 3; i++) {
    const port = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, 0.008), new THREE.MeshBasicMaterial({ color: 0x111318 }));
    port.position.set(x - 0.03 + i * 0.03, 0.8, z + 0.018 * face);
    parent.add(port);
  }
}

function hashSeed(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = Math.imul(s ^ (s >>> 15), 0x45d9f3b);
    s ^= s >>> 16;
    return (s >>> 0) / 4294967296;
  };
}

function pickN<T>(rand: () => number, list: T[], n: number): T[] {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = copy[i];
    copy[i] = copy[j];
    copy[j] = t;
  }
  return copy.slice(0, Math.max(0, Math.min(n, copy.length)));
}

const CUP_COLORS = [0xf4d0a0, 0xf0f0f0, 0x2a2e34, 0xe8f0ff, 0xc45c48];
const CAN_COLORS = [0xc03030, 0x3060c0, 0xe8a030, 0x2a8a5a];
const SNACK_COLORS = [0xc45c38, 0xe8c040, 0x3a82c8, 0x8a3030];
const FIG_COLORS = [0x3b82f6, 0xe85c8a, 0xf5c542, 0x2f8a48];
const NOTE_COLORS = [0xfff38a, 0xffb0c8, 0xc8f0c0, 0xc8e4f4];
const BOOK_COLORS = [0x8a3030, 0x2a5a3a, 0x3a5a8a, 0x5a381c];

function dressStation(parent: THREE.Group, x: number, z: number, face: number, kit: DeskKit, slot: number, seed: number, pal: FurnLook) {
  const rand = makeRng(seed ^ (slot + 1) * 0x9e3779b9);
  const kbZ = z + 0.28 * face;
  const mouseZ = z + 0.3 * face;
  const jx = () => (rand() - 0.5) * 0.1;
  const jz = () => (rand() - 0.5) * 0.08 * face;

  if (kit === 'simple') {
    addMonitor(parent, x, z, face, { bezel: pal.bezel });
    addPad(parent, x, z, face, pal.pad);
    addKeyboard(parent, x, 0.79, kbZ, pal.kb);
    addMouse(parent, x + 0.26, 0.79, mouseZ, pal.mouse);
    if (rand() > 0.35) addCup(parent, x + 0.48 + jx(), 0.82, z + 0.1 * face + jz(), CUP_COLORS[(rand() * CUP_COLORS.length) | 0]);
    if (rand() > 0.4) addPenCup(parent, x - 0.48 + jx(), z + 0.06 * face + jz());
    return;
  }
  if (kit === 'dual') {
    addMonitor(parent, x - 0.3, z, face, { bezel: pal.bezel });
    addMonitor(parent, x + 0.3, z, face, { bezel: pal.bezel });
    if (rand() > 0.45) addWebcam(parent, x + jx() * 0.4, 1.38, z + 0.02 * face, face);
    addPad(parent, x, z, face, pal.pad);
    addKeyboard(parent, x, 0.79, kbZ, pal.kb);
    addMouse(parent, x + 0.28, 0.79, mouseZ, pal.mouse);
    if (rand() > 0.25) addCup(parent, x + 0.52 + jx(), 0.82, z + 0.12 * face + jz(), CUP_COLORS[(rand() * CUP_COLORS.length) | 0]);
    if (rand() > 0.35) addPenCup(parent, x - 0.52 + jx(), z + 0.08 * face + jz());
    if (rand() > 0.4) addPhone(parent, x - 0.22 + jx(), z + 0.2 * face + jz(), (rand() - 0.5) * 0.8);
    if (rand() > 0.45) addBottle(parent, x + 0.58 + jx(), z - 0.04 * face + jz(), CAN_COLORS[(rand() * CAN_COLORS.length) | 0]);
    if (rand() > 0.55) addNameplate(parent, x + 0.16 + jx(), z - 0.12 * face, face);
    return;
  }
  if (kit === 'clutter') {
    addMonitor(parent, x - 0.06 + jx() * 0.4, z, face, { bezel: pal.bezel });
    addPad(parent, x, z, face, pal.pad);
    addKeyboard(parent, x, 0.79, kbZ, pal.kb);
    addMouse(parent, x + 0.26, 0.79, mouseZ, pal.mouse);
    const clutterBits: Array<() => void> = [
      () => addSticky(parent, x + 0.16, 1.22, z + 0.04 * face, NOTE_COLORS[(rand() * NOTE_COLORS.length) | 0], -0.48 * face),
      () => addSticky(parent, x + 0.26, 1.16, z + 0.04 * face, NOTE_COLORS[(rand() * NOTE_COLORS.length) | 0], -0.48 * face, 0.25),
      () => addPapers(parent, x + 0.36 + jx(), z + jz(), face),
      () => addBook(parent, x + 0.48 + jx(), z - 0.08 * face + jz(), (rand() - 0.5) * 0.8, BOOK_COLORS[(rand() * BOOK_COLORS.length) | 0]),
      () => addCup(parent, x + 0.42 + jx(), 0.82, z + 0.16 * face + jz(), CUP_COLORS[(rand() * CUP_COLORS.length) | 0]),
      () => addDeskPlant(parent, x - 0.42 + jx(), z + 0.1 * face + jz()),
      () => addPhone(parent, x - 0.22 + jx(), z + 0.22 * face + jz(), (rand() - 0.5)),
      () => addPenCup(parent, x - 0.38 + jx(), z + 0.2 * face + jz()),
      () => addCan(parent, x + 0.54 + jx(), z + 0.14 * face + jz(), CAN_COLORS[(rand() * CAN_COLORS.length) | 0]),
      () => addTissue(parent, x - 0.52 + jx(), z - 0.06 * face + jz()),
      () => addStapler(parent, x + 0.22 + jx(), z - 0.14 * face + jz(), (rand() - 0.5)),
      () => addUsbHub(parent, x + 0.12 + jx(), z + 0.18 * face + jz(), face),
      () => addBadge(parent, x - 0.08 + jx(), z + 0.24 * face + jz(), (rand() - 0.5)),
    ];
    for (const fn of pickN(rand, clutterBits, 6 + ((rand() * 4) | 0))) fn();
    return;
  }

  dressPacked(parent, x, z, face, rand, pal);
}

function dressPacked(parent: THREE.Group, x: number, z: number, face: number, rand: () => number, pal: FurnLook) {
  const jx = (span = 0.12) => (rand() - 0.5) * span;
  const jz = (span = 0.1) => (rand() - 0.5) * span * face;
  const kbZ = z + 0.28 * face;
  const layout = rand();

  addPad(parent, x + jx(0.08), z, face, pal.pad);
  addKeyboard(parent, x + jx(0.1), 0.79, kbZ, pal.kb);
  addMouse(parent, x + 0.2 + jx(0.08), 0.79, z + 0.3 * face, pal.mouse);

  if (layout < 0.34) {
    addMonitor(parent, x + jx(0.08), z, face, { wide: rand() > 0.4, bezel: pal.bezel });
    if (rand() > 0.4) addWebcam(parent, x + jx(0.1), 1.38, z + 0.04 * face, face);
  } else if (layout < 0.72) {
    addMonitor(parent, x - 0.28 + jx(0.06), z, face, { bezel: pal.bezel });
    addMonitor(parent, x + 0.3 + jx(0.06), z, face, { bezel: pal.bezel });
    if (rand() > 0.5) addWebcam(parent, x + jx(0.08), 1.38, z + 0.02 * face, face);
  } else {
    addMonitor(parent, x - 0.18 + jx(0.05), z, face, { wide: true, bezel: pal.bezel });
    addMonitor(parent, x + 0.34 + jx(0.05), z - 0.04 * face, face, { y: 1.28 + rand() * 0.1, bezel: pal.bezel });
    if (rand() > 0.35) addWebcam(parent, x - 0.18, 1.38, z + 0.04 * face, face);
  }

  const notes = (rand() * 4) | 0;
  for (let i = 0; i < notes; i++) {
    addSticky(
      parent,
      x - 0.08 + rand() * 0.36,
      1.16 + rand() * 0.14,
      z + 0.04 * face,
      NOTE_COLORS[(rand() * NOTE_COLORS.length) | 0],
      -0.48 * face,
      (rand() - 0.5) * 0.5
    );
  }

  const extras: Array<() => void> = [
    () => addLaptop(parent, x + 0.48 + jx(0.1), z + 0.06 * face + jz(0.08), face),
    () => addPapers(parent, x - 0.42 + jx(0.1), z + jz(0.1), face),
    () => addTray(parent, x - 0.58 + jx(0.08), z - 0.04 * face + jz(0.08), face),
    () => addBook(parent, x - 0.5 + jx(0.1), z - 0.14 * face + jz(0.08), (rand() - 0.5) * 0.9, BOOK_COLORS[(rand() * BOOK_COLORS.length) | 0], 0.03 + rand() * 0.02),
    () => addBook(parent, x + 0.46 + jx(0.1), z - 0.12 * face + jz(0.08), (rand() - 0.5) * 0.9, BOOK_COLORS[(rand() * BOOK_COLORS.length) | 0]),
    () => addCup(parent, x + jx(0.5), 0.82, z + 0.18 * face + jz(0.08), CUP_COLORS[(rand() * CUP_COLORS.length) | 0]),
    () => addCan(parent, x + jx(0.9), z + 0.18 * face + jz(0.1), CAN_COLORS[(rand() * CAN_COLORS.length) | 0]),
    () => addCan(parent, x + jx(0.9), z + 0.12 * face + jz(0.1), CAN_COLORS[(rand() * CAN_COLORS.length) | 0]),
    () => addBottle(parent, x + (rand() > 0.5 ? 0.64 : -0.64) + jx(0.08), z + jz(0.12), CAN_COLORS[(rand() * CAN_COLORS.length) | 0]),
    () => addNoodles(parent, x + (rand() > 0.5 ? 0.5 : -0.52) + jx(0.1), z - 0.14 * face + jz(0.08)),
    () => addSnack(parent, x + (rand() > 0.5 ? 0.56 : -0.6) + jx(0.1), z + 0.16 * face + jz(0.08), (rand() - 0.5), SNACK_COLORS[(rand() * SNACK_COLORS.length) | 0]),
    () => addDeskPlant(parent, x + (rand() > 0.5 ? 0.64 : -0.62) + jx(0.08), z + jz(0.14), rand() > 0.5),
    () => addHeadphones(parent, x + 0.54 + jx(0.12), z - 0.16 * face + jz(0.08)),
    () => addPenCup(parent, x - 0.12 + jx(0.16), z + 0.2 * face + jz(0.08)),
    () => addPhone(parent, x + 0.28 + jx(0.16), z + 0.22 * face + jz(0.08), (rand() - 0.5)),
    () => addTissue(parent, x - 0.64 + jx(0.1), z + 0.06 * face + jz(0.1)),
    () => addFrame(parent, x + (rand() > 0.5 ? 0.64 : -0.6) + jx(0.08), z - 0.12 * face + jz(0.08), face),
    () => addDeskLamp(parent, x + (rand() > 0.5 ? 0.68 : -0.7) + jx(0.06), z - 0.02 * face + jz(0.08), face),
    () => addDock(parent, x + 0.06 + jx(0.14), z - 0.14 * face + jz(0.08), face),
    () => addUsbHub(parent, x + 0.2 + jx(0.12), z + 0.16 * face + jz(0.08), face),
    () => addSpeaker(parent, x - 0.46 + jx(0.1), z - 0.16 * face + jz(0.08)),
    () => addSpeaker(parent, x + 0.42 + jx(0.1), z - 0.18 * face + jz(0.08)),
    () => addStapler(parent, x + 0.12 + jx(0.16), z - 0.18 * face + jz(0.08), (rand() - 0.5)),
    () => addTape(parent, x + 0.26 + jx(0.14), z - 0.16 * face + jz(0.08)),
    () => addBadge(parent, x + jx(0.2), z + 0.24 * face + jz(0.06), (rand() - 0.5)),
    () => addGlasses(parent, x + 0.32 + jx(0.14), z + 0.18 * face + jz(0.08), (rand() - 0.5)),
    () => addCable(parent, x + 0.44 + jx(0.16), z - 0.06 * face + jz(0.1), rand() * Math.PI),
    () => addCalendar(parent, x - 0.32 + jx(0.14), z - 0.14 * face + jz(0.08), face),
    () => addNameplate(parent, x + jx(0.2), z - 0.18 * face + jz(0.06), face),
    () => addFigurine(parent, x + (rand() > 0.5 ? 0.7 : -0.68) + jx(0.08), z - 0.06 * face + jz(0.1), FIG_COLORS[(rand() * FIG_COLORS.length) | 0]),
  ];

  const count = 11 + ((rand() * 7) | 0);
  for (const fn of pickN(rand, extras, count)) fn();
}

function dressDesk(parent: THREE.Group, desk: DeskDef, pal: FurnLook) {
  const w = desk.maxX - desk.minX;
  const kit = desk.kit ?? 'simple';
  const n = Math.max(1, Math.round(w / 2.2));
  for (let i = 0; i < n; i++) {
    const lx = -w / 2 + (i + 0.5) * (w / n);
    dressStation(parent, lx, 0.06, 1, kit, i, hashSeed(desk.id) ^ Math.imul(i + 3, 0x9e3779b9), pal);
  }
}

/** 碰撞仍是实心桌，视觉按 top / kit 换桌面和桌上物品。朝向转整张桌子。 */
export function buildDesk(parent: THREE.Group, desk: DeskDef, tone: FurnitureTone = 'dark') {
  const { minX, minZ, maxX, maxZ } = desk;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const top = desk.top ?? 'oak';
  const pal = furnitureLook(tone, desk.color);
  const matsFor = deskSurface(top);
  if (isTinted(desk.color)) {
    matsFor.leg = phongFresh({ color: pal.bodyAlt, shininess: 40 });
    matsFor.panel = phongFresh({ color: pal.body, shininess: 18 });
  }

  const body = new THREE.Group();
  body.position.set(cx, 0, cz);
  body.rotation.y = deskYaw(desk);
  parent.add(body);

  const board = new THREE.Mesh(new THREE.BoxGeometry(w, top === 'bench' ? 0.07 : 0.05, d), matsFor.board);
  board.position.set(0, 0.76, 0);
  board.castShadow = true;
  board.receiveShadow = true;
  body.add(board);

  const inset = 0.09;
  const hx = w / 2 - inset;
  const hz = d / 2 - inset;
  for (const [lx, lz] of [
    [-hx, -hz],
    [hx, -hz],
    [-hx, hz],
    [hx, hz],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.74, 0.09), matsFor.leg);
    leg.position.set(lx, 0.37, lz);
    leg.castShadow = true;
    body.add(leg);
  }

  if (top === 'bench') {
    const divider = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.3, w - 0.12), 0.42, 0.04), matsFor.panel);
    divider.position.set(0, 0.99, -d / 2 + 0.04);
    divider.castShadow = true;
    body.add(divider);
  } else {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.2, w - 0.16), 0.28, 0.025), matsFor.panel);
    panel.position.set(0, 0.52, 0);
    body.add(panel);
  }

  dressDesk(body, desk, pal);
  deskAO(body, w, d);
}

function starBase(group: THREE.Group, frameMat: THREE.Material, y = -0.45) {
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10), frameMat);
  hub.position.y = y;
  group.add(hub);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.045), frameMat);
    arm.position.set(Math.cos(a) * 0.12, y, Math.sin(a) * 0.12);
    arm.rotation.y = -a;
    group.add(arm);
  }
}

function frameMat(tone: FurnitureTone, color?: string) {
  const pal = furnitureLook(tone, color);
  return isTinted(color) || tone === 'light'
    ? phong({ color: pal.metal, shininess: 55, specular: 0xaaaaaa })
    : mats.metal();
}

/** 和游戏里能撞飞的办公椅同一套模型，编辑器直接摆这把椅子。 */
export function addOfficeChair(
  parent: THREE.Object3D,
  rotY = 0,
  style: ChairStyle = 'task',
  tone: FurnitureTone = 'dark',
  color?: string
): THREE.Group {
  const group = new THREE.Group();
  group.rotation.y = rotY;
  const pal = furnitureLook(tone, color);
  const frame = frameMat(tone, color);

  if (style === 'stool') {
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.07, 14), phongFresh({ color: shade(tone, color, pal, 'fabricAlt', 0x3a3530), map: clothFor(color), shininess: 14 }));
    seat.position.y = -0.02;
    seat.castShadow = true;
    group.add(seat);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.38, 8), frame);
    pole.position.y = -0.24;
    group.add(pole);
    starBase(group, frame, -0.44);
    parent.add(group);
    return group;
  }

  if (style === 'guest') {
    const wood = phongFresh({ color: shade(tone, color, pal, 'wood', 0x8a6238), map: tex.wood(), shininess: 28 });
    const fabric = phongFresh({ color: shade(tone, color, pal, 'fabric', 0xd8c4a8), map: clothFor(color), shininess: 10 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.07, 0.46), fabric);
    seat.position.y = -0.04;
    seat.castShadow = true;
    group.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.06), fabric);
    back.position.set(0, 0.24, -0.2);
    back.rotation.x = -0.12;
    back.castShadow = true;
    group.add(back);
    for (const [lx, lz] of [[-0.18, -0.16], [0.18, -0.16], [-0.18, 0.16], [0.18, 0.16]] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.46, 0.045), wood);
      leg.position.set(lx, -0.27, lz);
      leg.castShadow = true;
      group.add(leg);
    }
    parent.add(group);
    return group;
  }

  if (style === 'mesh') {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), phongFresh({ color: shade(tone, color, pal, 'fabric', 0x2a4a62), map: clothFor(color), shininess: 16 }));
    seat.position.y = -0.04;
    seat.castShadow = true;
    group.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.58, 0.04), phongFresh({ color: shade(tone, color, pal, 'fabricAlt', 0x1e3344), shininess: 12 }));
    back.position.set(0, 0.3, -0.23);
    back.castShadow = true;
    group.add(back);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.28), frame);
    armL.position.set(-0.28, 0.08, -0.02);
    group.add(armL);
    const armR = armL.clone();
    armR.position.x = 0.28;
    group.add(armR);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.34, 8), frame);
    pole.position.y = -0.26;
    group.add(pole);
    starBase(group, frame);
    parent.add(group);
    return group;
  }

  if (style === 'exec') {
    const leather = phongFresh({ color: pal.leather, shininess: 36, specular: 0x333333 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.1, 0.54), leather);
    seat.position.y = -0.03;
    seat.castShadow = true;
    group.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.72, 0.1), leather);
    back.position.set(0, 0.38, -0.24);
    back.castShadow = true;
    group.add(back);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.08), leather);
    head.position.set(0, 0.78, -0.22);
    group.add(head);
    for (const sx of [-0.3, 0.3]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.32), leather);
      arm.position.set(sx, 0.12, 0);
      group.add(arm);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 8), frame);
    pole.position.y = -0.26;
    group.add(pole);
    starBase(group, frame);
    parent.add(group);
    return group;
  }

  const seatMat = isTinted(color) || tone === 'light' ? phongFresh({ color: pal.fabric, map: clothFor(color), shininess: 12 }) : mats.fabric();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.09, 0.52), seatMat);
  seat.position.y = -0.05;
  seat.castShadow = true;
  group.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.52, 0.08), seatMat);
  back.position.set(0, 0.26, -0.24);
  back.castShadow = true;
  group.add(back);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.34, 8), frame);
  pole.position.y = -0.27;
  group.add(pole);
  starBase(group, frame);
  parent.add(group);
  return group;
}

const LEAF_COLORS = [0x2f8a48, 0x247a3c, 0x1f6a32, 0x3d8a44, 0x5a9a48, 0x6a8a30, 0x1a5a2c, 0x8aaa50];
const LEAF_ACCENT = [0x4aaa58, 0x2a6a38, 0xc46a38, 0xb8a838];
type Folio = 'bush' | 'tall' | 'succulent' | 'palm' | 'snake' | 'fern';

function pickFolio(rand: () => number, size: 's' | 'm' | 'l'): Folio {
  const u = rand();
  if (size === 's') {
    if (u < 0.34) return 'succulent';
    if (u < 0.62) return 'bush';
    if (u < 0.84) return 'snake';
    return 'fern';
  }
  if (size === 'l') {
    if (u < 0.32) return 'palm';
    if (u < 0.62) return 'tall';
    if (u < 0.82) return 'bush';
    return 'fern';
  }
  if (u < 0.22) return 'bush';
  if (u < 0.4) return 'tall';
  if (u < 0.56) return 'snake';
  if (u < 0.72) return 'palm';
  if (u < 0.88) return 'fern';
  return 'succulent';
}

function pick<T>(rand: () => number, list: T[]): T {
  return list[(rand() * list.length) | 0]!;
}

function addPotted(
  parent: THREE.Group,
  x: number,
  z: number,
  tone: FurnitureTone,
  opts: { scale: number; folio: Folio; leaf: number; accent: number; pot: number },
  color?: string
) {
  const s = opts.scale;
  const pal = furnitureLook(tone, color);
  const potH = 0.14 * s + 0.08;
  const potR = 0.08 * s + 0.05;
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(potR, potR * 0.82, potH, 8),
    phong({ color: opts.pot || pal.pot, shininess: 22 })
  );
  pot.position.set(x, potH / 2, z);
  pot.castShadow = true;
  parent.add(pot);
  const dirt = new THREE.Mesh(new THREE.CylinderGeometry(potR * 0.82, potR * 0.82, 0.02, 8), phong({ color: 0x3a2a1c, shininess: 6 }));
  dirt.position.set(x, potH - 0.01, z);
  parent.add(dirt);
  const leafM = phong({ color: opts.leaf, shininess: 16, specular: 0x113311 });
  const accM = phong({ color: opts.accent, shininess: 16, specular: 0x113311 });
  const y0 = potH;

  if (opts.folio === 'succulent') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(potR * 1.15, 8, 6), leafM);
    body.position.set(x, y0 + potR * 0.9, z);
    body.castShadow = true;
    parent.add(body);
    for (const [dx, dz] of [[0.7, 0.2], [-0.55, 0.4], [0.1, -0.7]] as const) {
      const nub = new THREE.Mesh(new THREE.SphereGeometry(potR * 0.45, 6, 5), accM);
      nub.position.set(x + dx * potR, y0 + potR * 0.55, z + dz * potR);
      parent.add(nub);
    }
    return;
  }
  if (opts.folio === 'snake') {
    for (let i = 0; i < 4; i++) {
      const h = (0.28 + i * 0.06) * s + 0.12;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035 * s + 0.02, h, 0.012 * s + 0.01), i % 2 ? accM : leafM);
      const a = (i / 4) * Math.PI * 2 + 0.2;
      blade.position.set(x + Math.cos(a) * potR * 0.35, y0 + h / 2, z + Math.sin(a) * potR * 0.35);
      blade.rotation.z = (i - 1.5) * 0.08;
      blade.castShadow = true;
      parent.add(blade);
    }
    return;
  }
  if (opts.folio === 'palm') {
    const stemH = 0.42 * s + 0.22;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018 * s + 0.012, 0.03 * s + 0.02, stemH, 6), phong({ color: 0x6a4a28, shininess: 10 }));
    stem.position.set(x, y0 + stemH / 2, z);
    parent.add(stem);
    const top = y0 + stemH;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const frond = new THREE.Mesh(new THREE.SphereGeometry(0.16 * s + 0.1, 7, 5), i % 2 ? accM : leafM);
      frond.scale.set(1.35, 0.22, 0.55);
      frond.position.set(x + Math.cos(a) * (0.12 * s + 0.06), top, z + Math.sin(a) * (0.12 * s + 0.06));
      frond.rotation.y = -a;
      frond.rotation.z = 0.45;
      frond.castShadow = true;
      parent.add(frond);
    }
    return;
  }
  if (opts.folio === 'fern') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.15;
      const len = (0.22 + (i % 3) * 0.06) * s + 0.14;
      const frond = new THREE.Mesh(new THREE.SphereGeometry(len * 0.55, 7, 5), i % 2 ? accM : leafM);
      frond.scale.set(0.28, 0.18, 1.15);
      frond.position.set(x + Math.cos(a) * potR * 0.45, y0 + len * 0.35, z + Math.sin(a) * potR * 0.45);
      frond.rotation.y = -a;
      frond.rotation.z = 0.85;
      frond.castShadow = true;
      parent.add(frond);
    }
    return;
  }
  if (opts.folio === 'tall') {
    const stemH = 0.22 * s + 0.1;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, stemH, 6), phong({ color: 0x4a3828, shininess: 8 }));
    stem.position.set(x, y0 + stemH / 2, z);
    parent.add(stem);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.16 * s + 0.12, 8, 6), leafM);
    crown.scale.set(0.85, 1.45, 0.75);
    crown.position.set(x, y0 + stemH + (0.2 * s + 0.14), z);
    crown.castShadow = true;
    parent.add(crown);
    const side = new THREE.Mesh(new THREE.SphereGeometry(0.1 * s + 0.08, 7, 5), accM);
    side.position.set(x + 0.1 * s, y0 + stemH + 0.12 * s, z - 0.06);
    parent.add(side);
    return;
  }
  const bush = new THREE.Mesh(new THREE.SphereGeometry(0.18 * s + 0.12, 8, 6), leafM);
  bush.position.set(x, y0 + 0.16 * s + 0.1, z);
  bush.castShadow = true;
  parent.add(bush);
  const bush2 = new THREE.Mesh(new THREE.SphereGeometry(0.11 * s + 0.08, 7, 5), accM);
  bush2.position.set(x + 0.1 * s, y0 + 0.2 * s + 0.12, z - 0.06 * s);
  parent.add(bush2);
}

function potColor(rand: () => number, tone: FurnitureTone, color?: string) {
  const hex = migrateHexColor(color);
  if (hex) return hexToInt(hex);
  const pal = furnitureLook(tone);
  const dark = [0xb85c38, 0x8a5a38, pal.pot, 0x3a4048, 0x6a7a68];
  const light = [pal.pot, 0xf2efe8, 0xe8e0d4, 0xd8d4cc, 0xc4b8a4];
  return pick(rand, tone === 'light' ? light : dark);
}

function plantSpec(rand: () => number, size: 's' | 'm' | 'l', scale: number, tone: FurnitureTone, color?: string) {
  return {
    scale,
    folio: pickFolio(rand, size),
    leaf: pick(rand, LEAF_COLORS),
    accent: pick(rand, LEAF_ACCENT),
    pot: potColor(rand, tone, color),
  };
}

export function addPlant(parent: THREE.Group, tone: FurnitureTone = 'dark', kit: PlantKit = 'pot', seed = 1, color?: string) {
  const rand = makeRng(seed);
  const spec = (size: 's' | 'm' | 'l', scale: number) => plantSpec(rand, size, scale, tone, color);
  const pot = (x: number, z: number, s: ReturnType<typeof plantSpec>) => addPotted(parent, x, z, tone, s, color);
  if (kit === 'pair') {
    pot(-0.16, 0.02, spec(rand() > 0.45 ? 'm' : 's', 0.72 + rand() * 0.28));
    pot(0.18, -0.04, spec(rand() > 0.4 ? 'm' : 'l', 0.9 + rand() * 0.35));
    return;
  }
  if (kit === 'trio') {
    pot(-0.2, 0.12, spec('s', 0.62 + rand() * 0.22));
    pot(0.18, 0.1, spec('m', 0.85 + rand() * 0.28));
    pot(0.02, -0.18, spec(rand() > 0.5 ? 'l' : 'm', 1.0 + rand() * 0.28));
    return;
  }
  if (kit === 'cluster') {
    pot(-0.22, 0.16, spec('s', 0.55 + rand() * 0.2));
    pot(0.2, 0.18, spec('s', 0.6 + rand() * 0.22));
    pot(-0.08, -0.02, spec('m', 0.88 + rand() * 0.25));
    pot(0.22, -0.16, spec('m', 0.78 + rand() * 0.28));
    if (rand() > 0.35) pot(-0.24, -0.2, spec('s', 0.5 + rand() * 0.18));
    return;
  }
  if (kit === 'grove') {
    pot(0.02, -0.04, spec('l', 1.28 + rand() * 0.32));
    pot(-0.28, 0.18, spec('s', 0.58 + rand() * 0.2));
    pot(0.26, 0.16, spec('m', 0.8 + rand() * 0.22));
    pot(0.18, -0.24, spec('s', 0.55 + rand() * 0.2));
    pot(-0.22, -0.22, spec(rand() > 0.5 ? 'm' : 's', 0.62 + rand() * 0.22));
    return;
  }
  pot(0, 0, spec(rand() > 0.55 ? 'm' : rand() > 0.35 ? 'l' : 's', 0.85 + rand() * 0.4));
}

export function addCooler(parent: THREE.Group, tone: FurnitureTone = 'dark', color?: string) {
  const pal = furnitureLook(tone, color);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.9, 0.42), phong({ color: shade(tone, color, pal, 'appliance', 0xe8eef4), map: tex.metal(), shininess: 45 }));
  body.position.y = 0.45;
  body.castShadow = true;
  parent.add(body);
  const jug = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 12, 10),
    new THREE.MeshPhongMaterial({
      color: 0x8ecfff,
      transparent: true,
      opacity: 0.45,
      shininess: 80,
      specular: 0xaadfff,
    })
  );
  jug.position.y = 1.08;
  parent.add(jug);
}

export function addCoffee(parent: THREE.Group, tone: FurnitureTone = 'dark', color?: string) {
  const pal = furnitureLook(tone, color);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.38, 0.28), phong({ color: pal.appliance, shininess: 40 }));
  body.position.y = 0.35;
  body.castShadow = true;
  parent.add(body);
  const tank = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.22, 0.08),
    new THREE.MeshPhongMaterial({ color: 0xa8d4f0, transparent: true, opacity: 0.45, shininess: 70 })
  );
  tank.position.set(0.06, 0.58, -0.06);
  parent.add(tank);
  const spout = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.1), frameMat(tone, color));
  spout.position.set(0, 0.42, 0.14);
  parent.add(spout);
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.12), frameMat(tone, color));
  tray.position.set(0, 0.18, 0.12);
  parent.add(tray);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.06, 8), phong({ color: 0xf4f0ea, shininess: 40 }));
  cup.position.set(0, 0.22, 0.12);
  parent.add(cup);
  const btn = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.04), phong({ color: 0xc45c48, shininess: 30 }));
  btn.position.set(-0.08, 0.55, 0.12);
  parent.add(btn);
}

export function addFridge(parent: THREE.Group, tone: FurnitureTone = 'dark', color?: string) {
  const pal = furnitureLook(tone, color);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.58, 1.55, 0.52), phong({ color: shade(tone, color, pal, 'appliance', 0xe8eef2), map: tex.metal(), shininess: 50 }));
  body.position.y = 0.775;
  body.castShadow = true;
  parent.add(body);
  const freeze = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.02, 0.02), phong({ color: pal.metal, shininess: 20 }));
  freeze.position.set(0, 1.18, 0.27);
  parent.add(freeze);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, 0.03), frameMat(tone, color));
  handle.position.set(0.22, 0.7, 0.28);
  parent.add(handle);
  const note = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.01), phong({ color: 0xfff38a, shininess: 6 }));
  note.position.set(-0.12, 1.05, 0.27);
  parent.add(note);
}

export function addSofa(parent: THREE.Group, tone: FurnitureTone = 'dark', color?: string) {
  const pal = furnitureLook(tone, color);
  const fabric = phongFresh({ color: pal.sofa, map: tex.cloth(), shininess: 10 });
  const seat = new THREE.Mesh(new THREE.SphereGeometry(0.48, 12, 10), fabric);
  seat.scale.set(1.15, 0.52, 0.95);
  seat.position.y = 0.26;
  seat.castShadow = true;
  parent.add(seat);
  const back = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), fabric);
  back.scale.set(1.1, 0.7, 0.45);
  back.position.set(0, 0.42, -0.28);
  back.castShadow = true;
  parent.add(back);
  const armL = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), fabric);
  armL.scale.set(0.7, 0.7, 1.1);
  armL.position.set(-0.42, 0.28, 0.02);
  parent.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.42;
  parent.add(armR);
}

export function addSink(parent: THREE.Group, tone: FurnitureTone = 'dark', color?: string) {
  const pal = furnitureLook(tone, color);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.08, 0.48), phong({ color: shade(tone, color, pal, 'body', 0xe8e6e1), shininess: 35 }));
  counter.position.y = 0.86;
  counter.castShadow = true;
  parent.add(counter);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.78, 0.46), phong({ color: shade(tone, color, pal, 'bodyAlt', 0xd8d4cc), shininess: 18 }));
  body.position.y = 0.43;
  parent.add(body);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.08, 12), phong({ color: 0xf4f6f8, shininess: 70 }));
  basin.position.set(-0.18, 0.92, 0.02);
  parent.add(basin);
  const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), frameMat(tone, color));
  tap.position.set(-0.18, 1.02, -0.08);
  parent.add(tap);
  const spout = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.14), frameMat(tone, color));
  spout.position.set(-0.18, 1.08, 0.02);
  parent.add(spout);
  const soap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.05), phong({ color: 0xc8e4f4, shininess: 40 }));
  soap.position.set(0.22, 0.96, 0.04);
  parent.add(soap);
  const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.03), phong({ color: 0xc8d8e8, shininess: 80, specular: 0xffffff }));
  mirror.position.set(0, 1.35, -0.2);
  parent.add(mirror);
}

export function addBar(parent: THREE.Group, tone: FurnitureTone = 'dark', color?: string) {
  const pal = furnitureLook(tone, color);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.06, 0.58), phong({ color: shade(tone, color, pal, 'wood', 0x6a4a32), map: tex.wood(), shininess: 28 }));
  top.position.y = 1.02;
  top.castShadow = true;
  parent.add(top);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.98, 0.54), phong({ color: shade(tone, color, pal, 'bodyAlt', 0x3a322c), shininess: 12 }));
  body.position.y = 0.5;
  parent.add(body);
  const machine = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.38, 0.28), phong({ color: pal.appliance, shininess: 40 }));
  machine.position.set(-0.45, 1.24, 0);
  parent.add(machine);
  const tank = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.2, 0.08),
    new THREE.MeshPhongMaterial({ color: 0xa8d4f0, transparent: true, opacity: 0.45, shininess: 70 })
  );
  tank.position.set(-0.4, 1.46, -0.06);
  parent.add(tank);
  for (const lx of [0.15, 0.32, 0.49]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.07, 8), phong({ color: 0xf4f0ea, shininess: 40 }));
    cup.position.set(lx, 1.09, 0.08);
    parent.add(cup);
  }
  const menu = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.36, 0.02), phong({ color: 0xf4e8c8, shininess: 8 }));
  menu.position.set(0.62, 1.32, -0.2);
  parent.add(menu);
}

export function addCabinet(parent: THREE.Group, tone: FurnitureTone = 'dark', color?: string) {
  const pal = furnitureLook(tone, color);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 1.22, 0.42), phong({ color: pal.wood, map: tex.wood(), shininess: 16 }));
  body.position.y = 0.61;
  body.castShadow = true;
  parent.add(body);
  for (const y of [0.32, 0.62, 0.92]) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.02), phong({ color: pal.slot, shininess: 10 }));
    slot.position.set(0, y, 0.22);
    parent.add(slot);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.03), frameMat(tone, color));
    handle.position.set(0, y + 0.08, 0.23);
    parent.add(handle);
  }
}

export function addPrinter(parent: THREE.Group, tone: FurnitureTone = 'dark', color?: string) {
  const pal = furnitureLook(tone, color);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.42), phong({ color: shade(tone, color, pal, 'bodyAlt', 0xd0d4d8), shininess: 20 }));
  stand.position.y = 0.28;
  parent.add(stand);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.22, 0.4), phong({ color: pal.frame, shininess: 35 }));
  body.position.y = 0.68;
  body.castShadow = true;
  parent.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.32), phong({ color: pal.appliance, shininess: 40 }));
  lid.position.set(0, 0.81, -0.02);
  parent.add(lid);
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.18), phong({ color: 0xf4f0e6, shininess: 8 }));
  tray.position.set(0, 0.58, 0.22);
  parent.add(tray);
}

export function addBin(parent: THREE.Group, tone: FurnitureTone = 'dark', color?: string) {
  const pal = furnitureLook(tone, color);
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.42, 12), phong({ color: pal.bin, shininess: 30 }));
  can.position.y = 0.21;
  can.castShadow = true;
  parent.add(can);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 12), frameMat(tone, color));
  rim.position.y = 0.43;
  parent.add(rim);
}

export function addShelf(parent: THREE.Group, tone: FurnitureTone = 'dark', color?: string) {
  const pal = furnitureLook(tone, color);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.38, 0.04), phong({ color: pal.wood, map: tex.wood(), shininess: 14 }));
  back.position.set(0, 0.7, -0.12);
  parent.add(back);
  for (const y of [0.18, 0.52, 0.86, 1.2]) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.28), phong({ color: pal.woodPlank, map: tex.wood(), shininess: 16 }));
    plank.position.set(0, y, 0);
    plank.castShadow = true;
    parent.add(plank);
  }
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.14), phong({ color: 0x8a3030, shininess: 10 }));
  box.position.set(-0.22, 1.31, 0.02);
  parent.add(box);
  const plant = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), phong({ color: 0x2f8a48, shininess: 12 }));
  plant.position.set(0.24, 1.32, 0);
  parent.add(plant);
}

export function addWhiteboard(parent: THREE.Group, tone: FurnitureTone = 'dark', color?: string) {
  const pal = furnitureLook(tone, color);
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.98, 0.04), phong({ color: 0xf4f6f8, shininess: 40 }));
  board.position.set(0, 1.05, 0);
  board.castShadow = true;
  parent.add(board);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.06, 0.05), phong({ color: pal.frame, shininess: 20 }));
  frame.position.set(0, 1.05, -0.01);
  parent.add(frame);
  const standL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.56, 0.05), frameMat(tone, color));
  standL.position.set(-0.7, 0.28, 0);
  parent.add(standL);
  const standR = standL.clone();
  standR.position.x = 0.7;
  parent.add(standR);
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.01), phong({ color: 0x3a82f6, shininess: 8 }));
  mark.position.set(-0.35, 1.15, 0.025);
  parent.add(mark);
}

export function addConferenceTable(parent: THREE.Group, tone: FurnitureTone = 'dark', color?: string) {
  const pal = furnitureLook(tone, color);
  const topMat = phong({ color: pal.wood, map: tex.wood(), shininess: 28, specular: 0x554433 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.06, 20), topMat);
  top.scale.set(2.05, 1, 1.08);
  top.position.y = 0.73;
  top.castShadow = true;
  parent.add(top);
  const apron = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.07, 16), phong({ color: pal.woodDark, map: tex.wood(), shininess: 18 }));
  apron.scale.set(2.0, 1, 1.05);
  apron.position.y = 0.67;
  parent.add(apron);
  const leg = phong({ color: pal.metal, map: tex.metal(), shininess: 50 });
  for (const [x, z] of [[-0.78, -0.32], [0.78, -0.32], [-0.78, 0.32], [0.78, 0.32]] as const) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.68, 8), leg);
    post.position.set(x, 0.34, z);
    parent.add(post);
  }
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 10), phong({ color: pal.frame, shininess: 20 }));
  hole.position.y = 0.765;
  parent.add(hole);
  const phone = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.16), phong({ color: pal.applianceDark, shininess: 30 }));
  phone.position.set(0.18, 0.78, 0.08);
  parent.add(phone);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.008, 0.2), phong({ color: pal.pad, shininess: 8 }));
  pad.position.set(-0.35, 0.765, -0.12);
  parent.add(pad);
}

export function addLocker(parent: THREE.Group, tone: FurnitureTone = 'dark', color?: string) {
  const pal = furnitureLook(tone, color);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.58, 0.46), phong({ color: pal.locker, map: tex.metal(), shininess: 35 }));
  body.position.y = 0.79;
  body.castShadow = true;
  parent.add(body);
  const split = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.5, 0.02), phong({ color: pal.applianceDark, shininess: 20 }));
  split.position.set(0, 0.79, 0.24);
  parent.add(split);
  for (const x of [-0.1, 0.1]) {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.03), frameMat(tone, color));
    handle.position.set(x, 0.82, 0.25);
    parent.add(handle);
  }
}

function addTrafficCone(parent: THREE.Group, x: number, z: number) {
  const orange = phong({ color: 0xff5a1a, shininess: 28 });
  const white = phong({ color: 0xf4f0ea, shininess: 22 });
  const black = phong({ color: 0x2a2c30, shininess: 16 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.22), black);
  base.position.set(x, 0.018, z);
  parent.add(base);
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.46, 10), orange);
  body.position.set(x, 0.265, z);
  body.castShadow = true;
  parent.add(body);
  const lo = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.088, 0.045, 10), white);
  lo.position.set(x, 0.16, z);
  parent.add(lo);
  const hi = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.042, 10), white);
  hi.position.set(x, 0.28, z);
  parent.add(hi);
}

function addWet(parent: THREE.Group, prop?: PropDef) {
  const fx = mergeHazardFx('wet', prop?.hazard);
  const r = fx.radius;
  const n = hashSeed(prop?.id ?? 'wet');
  const sx = 0.86 + (n % 17) / 50;
  const sz = 0.74 + ((n >> 3) % 19) / 55;
  const geo = new THREE.PlaneGeometry(2, 2);
  geo.rotateX(-Math.PI / 2);
  const puddle = new THREE.Mesh(
    geo,
    new THREE.MeshPhongMaterial({
      map: tex.stain(n),
      color: fx.color,
      transparent: true,
      opacity: Math.min(0.88, (fx.opacity ?? 0.5) + 0.16),
      depthWrite: false,
      shininess: 110,
      specular: new THREE.Color(0xe8f8ff),
      side: THREE.DoubleSide,
    })
  );
  puddle.rotation.y = (n % 360) * 0.017;
  puddle.position.y = 0.022;
  puddle.scale.set(r * sx, 1, r * sz);
  puddle.renderOrder = 1;
  parent.add(puddle);
  const sheen = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      map: tex.stain(n + 1),
      color: 0xd8f4ff,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      toneMapped: false,
    })
  );
  sheen.rotation.y = puddle.rotation.y + 0.35;
  sheen.position.y = 0.028;
  sheen.scale.set(r * sx * 0.52, 1, r * sz * 0.48);
  sheen.renderOrder = 2;
  parent.add(sheen);
  addTrafficCone(parent, r * sx * 0.72, r * sz * 0.18);
}

function addPit(parent: THREE.Group, _tone: FurnitureTone, color?: string, prop?: PropDef) {
  const n = hashSeed(prop?.id ?? 'paper');
  const tint = isTinted(color) ? hexToInt(migrateHexColor(color)!) : 0xf3ead6;
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const sheet = (w: number, d: number, y: number, ox: number, oz: number, rot: number, col: number) => {
    const m = new THREE.Mesh(
      geo,
      phong({ color: col, map: tex.news(), shininess: 5, specular: 0x332211 })
    );
    m.position.set(ox, y, oz);
    m.rotation.y = rot;
    m.scale.set(w, 1, d);
    m.renderOrder = 2;
    parent.add(m);
  };
  const yaw = ((n % 41) - 20) * 0.022;
  sheet(0.78, 0.56, 0.012, 0.02, 0, yaw, tint);
  sheet(0.5, 0.38, 0.02, -0.12, 0.1, yaw - 0.4, mixHex(tint, 0xe4d6b8, 0.4));
}

function addCrate(parent: THREE.Group, _tone: FurnitureTone, color?: string) {
  const brown = isTinted(color) ? hexToInt(migrateHexColor(color)!) : 0x7a4a26;
  const dark = scaleHex(brown, 0.7);
  const kraft = phong({ color: brown, map: tex.wood(), shininess: 8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.32), kraft);
  body.position.y = 0.13;
  body.castShadow = true;
  parent.add(body);
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.045, 0.35),
    phong({ color: scaleHex(brown, 0.88), map: tex.wood(), shininess: 10 })
  );
  lid.position.y = 0.278;
  parent.add(lid);
  const flap = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.008, 0.16),
    phong({ color: scaleHex(brown, 0.82), map: tex.wood(), shininess: 8 })
  );
  flap.position.set(0, 0.3, 0.12);
  flap.rotation.x = -0.55;
  parent.add(flap);
  const label = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.008), phong({ color: 0xf3eee4, shininess: 4 }));
  label.position.set(0, 0.15, 0.164);
  parent.add(label);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.018, 0.01), phong({ color: dark, shininess: 6 }));
  stripe.position.set(0, 0.15, 0.17);
  parent.add(stripe);
  const hole = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.032, 0.02), phong({ color: dark, shininess: 4 }));
  hole.position.set(-0.215, 0.18, 0);
  parent.add(hole);
  const holeR = hole.clone();
  holeR.position.x = 0.215;
  parent.add(holeR);
}

function addLaunch(parent: THREE.Group, tone: FurnitureTone, color?: string) {
  const pal = furnitureLook(tone, color);
  const openW = 0.96;
  const openH = 1.56;
  const frame = 0.09;
  const thick = 0.12;
  const z = -0.02;
  const postH = openH + frame;
  const left = new THREE.Mesh(new THREE.BoxGeometry(frame, postH, thick), phong({ color: pal.metal, shininess: 28 }));
  left.position.set(-(openW / 2 + frame / 2), postH / 2, z);
  parent.add(left);
  const right = new THREE.Mesh(new THREE.BoxGeometry(frame, postH, thick), phong({ color: pal.metal, shininess: 28 }));
  right.position.set(openW / 2 + frame / 2, postH / 2, z);
  parent.add(right);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(openW + frame * 2, frame, thick), phong({ color: pal.metal, shininess: 28 }));
  cap.position.set(0, openH + frame / 2, z);
  parent.add(cap);
  const hinge = new THREE.Group();
  hinge.position.set(-openW / 2 + 0.02, 0, 0.05);
  parent.add(hinge);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(openW - 0.04, openH - 0.04, 0.045), phong({ color: 0xe8b86a, shininess: 22 }));
  slab.position.set((openW - 0.04) / 2, (openH - 0.04) / 2 + 0.02, 0);
  hinge.add(slab);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 8), phong({ color: pal.metal, shininess: 40 }));
  handle.rotation.z = Math.PI / 2;
  handle.position.set(openW - 0.14, openH * 0.48, 0.04);
  hinge.add(handle);
  parent.userData.launchHinge = hinge;
}

function addAlarm(parent: THREE.Group, prop?: PropDef) {
  const fx = mergeHazardFx('alarm', prop?.hazard);
  const r = fx.radius;
  const plate = new THREE.Mesh(
    new THREE.CircleGeometry(r, 22),
    new THREE.MeshPhongMaterial({
      color: fx.color,
      transparent: true,
      opacity: Math.min(0.22, Math.max(0.05, fx.opacity)),
      depthWrite: false,
      shininess: 8,
      specular: 0x222222,
    })
  );
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = 0.012;
  plate.renderOrder = 1;
  parent.add(plate);
  const seam = new THREE.Mesh(
    new THREE.RingGeometry(r * 0.82, r * 0.98, 22),
    new THREE.MeshBasicMaterial({
      color: 0x3a3834,
      transparent: true,
      opacity: Math.min(0.28, Math.max(0.08, fx.opacity + 0.06)),
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  seam.rotation.x = -Math.PI / 2;
  seam.position.y = 0.016;
  seam.renderOrder = 2;
  parent.add(seam);
}

export function placeOfficeProp(parent: THREE.Group, kind: PropKind, tone: FurnitureTone = 'dark', prop?: PropDef, sky: SkyKind = 'day') {
  const color = prop?.color;
  if (kind === 'plant') addPlant(parent, tone, prop?.plantKit ?? 'pot', hashSeed(prop?.id ?? 'plant'), color);
  else if (kind === 'cooler') addCooler(parent, tone, color);
  else if (kind === 'coffee') addCoffee(parent, tone, color);
  else if (kind === 'fridge') addFridge(parent, tone, color);
  else if (kind === 'sofa') addSofa(parent, tone, color);
  else if (kind === 'sink') addSink(parent, tone, color);
  else if (kind === 'bar') addBar(parent, tone, color);
  else if (kind === 'cabinet') addCabinet(parent, tone, color);
  else if (kind === 'printer') addPrinter(parent, tone, color);
  else if (kind === 'bin') addBin(parent, tone, color);
  else if (kind === 'shelf') addShelf(parent, tone, color);
  else if (kind === 'whiteboard') addWhiteboard(parent, tone, color);
  else if (kind === 'locker') addLocker(parent, tone, color);
  else if (kind === 'table') addConferenceTable(parent, tone, color);
  else if (kind === 'tv') addTv(parent, tone, color);
  else if (kind === 'window') addWindow(parent, 0, prop?.y ?? 1.15, 0, 0, prop?.w ?? 2.4, prop?.h ?? 1.05, sky);
  else if (kind === 'wet') addWet(parent, prop);
  else if (kind === 'pit') addPit(parent, tone, color, prop);
  else if (kind === 'crate') addCrate(parent, tone, color);
  else if (kind === 'launch') addLaunch(parent, tone, color);
  else if (kind === 'alarm') addAlarm(parent, prop);
}

export function addCeilingLight(
  parent: THREE.Group,
  x: number,
  z: number,
  opts: { lampColor?: number; lampIntensity?: number } = {}
) {
  const tray = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.58), phong({ color: 0x6a7078, shininess: 30 }));
  tray.position.set(x, 2.54, z);
  parent.add(tray);
  const lampColor = opts.lampColor ?? 0xfff6d8;
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.03, 0.42),
    new THREE.MeshBasicMaterial({ color: lampColor })
  );
  panel.position.set(x, 2.51, z);
  parent.add(panel);
}

export type ElevatorState = 'idle' | 'called' | 'ready' | 'opening';

export interface ElevatorRig {
  group: THREE.Group;
  openT: number;
  setState(state: ElevatorState): void;
  setFloor(n: number): void;
  update(dt: number, time: number): void;
}

const SEG7 = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

function paintElevatorSign(ctx: CanvasRenderingContext2D, w: number, h: number, floor: number, lit: boolean) {
  ctx.fillStyle = '#070b09';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = lit ? '#14331c' : '#101410';
  ctx.fillRect(8, 8, w - 16, h - 16);
  const on = lit ? '#7cff90' : '#3d7a48';
  const off = lit ? '#0c2214' : '#122018';
  const dw = 52;
  const dh = 72;
  const y = (h - dh) / 2;
  const tens = Math.floor(floor / 10);
  const ones = floor % 10;
  const drawDigit = (n: number, x: number, faint: boolean) => {
    const mask = SEG7[n] ?? 0;
    const t = 7;
    const segs: [number, number, number, number][] = [
      [x + t, y, dw - t * 2, t],
      [x + dw - t, y + t, t, dh / 2 - t],
      [x + dw - t, y + dh / 2, t, dh / 2 - t],
      [x + t, y + dh - t, dw - t * 2, t],
      [x, y + dh / 2, t, dh / 2 - t],
      [x, y + t, t, dh / 2 - t],
      [x + t, y + dh / 2 - t / 2, dw - t * 2, t],
    ];
    segs.forEach((s, i) => {
      ctx.fillStyle = faint ? off : (mask & (1 << i) ? on : off);
      ctx.fillRect(s[0], s[1], s[2], s[3]);
    });
  };
  drawDigit(tens, 48, tens === 0);
  drawDigit(ones, 118, false);
}

/** 轿厢 + 对开门 + 墙钮 + 楼层屏。无点光，亮的全靠自发光。姿态跟所贴墙面。 */
export function buildElevator(
  pose: { x: number; z: number; rotY: number },
  glow: number
): ElevatorRig {
  const group = new THREE.Group();
  group.position.set(pose.x, 0, pose.z);
  group.rotation.y = pose.rotY;

  const steel = phongFresh({ color: 0xb8bec6, map: tex.metal(), shininess: 78, specular: 0xccd0d4 });
  const steelDark = phongFresh({ color: 0x6a7078, map: tex.metal(), shininess: 55, specular: 0x889099 });
  const inner = phongFresh({ color: 0x4a5058, map: tex.metal(), shininess: 40, specular: 0x667088 });
  const trim = phongFresh({ color: 0x2a2e34, shininess: 30 });

  const cabin = new THREE.Group();
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.7, 2.35, 0.08), inner);
  back.position.set(0, 1.18, -1.22);
  cabin.add(back);
  const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.35, 1.28), inner);
  sideL.position.set(-1.35, 1.18, -0.58);
  cabin.add(sideL);
  const sideR = sideL.clone();
  sideR.position.x = 1.35;
  cabin.add(sideR);
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.06, 1.28), steelDark);
  ceil.position.set(0, 2.34, -0.58);
  cabin.add(ceil);
  const ceilGlow = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.02, 0.4),
    new THREE.MeshPhongMaterial({ color: 0xf2efe4, emissive: new THREE.Color(0xfff2c8), emissiveIntensity: 0.55, shininess: 10 })
  );
  ceilGlow.position.set(0, 2.3, -0.5);
  cabin.add(ceilGlow);
  const cabinFloor = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 1.2), steelDark);
  cabinFloor.position.set(0, 0.03, -0.55);
  cabin.add(cabinFloor);
  group.add(cabin);

  const jambL = new THREE.Mesh(new THREE.BoxGeometry(0.38, 2.42, 0.22), steel);
  jambL.position.set(-1.38, 1.21, 0.02);
  group.add(jambL);
  const jambR = jambL.clone();
  jambR.position.x = 1.38;
  group.add(jambR);
  const header = new THREE.Mesh(new THREE.BoxGeometry(3.16, 0.52, 0.24), steel);
  header.position.set(0, 2.48, 0.02);
  group.add(header);
  const track = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.05, 0.1), trim);
  track.position.set(0, 2.18, 0.08);
  group.add(track);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.18), steelDark);
  sill.position.set(0, 0.03, 0.06);
  group.add(sill);

  const doorW = 1.08;
  const doorH = 2.12;
  const makeDoor = (side: number) => {
    const g = new THREE.Group();
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.06), steel);
    leaf.position.y = doorH / 2;
    g.add(leaf);
    const slit = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 1.28, 0.02),
      new THREE.MeshPhongMaterial({ color: 0x1a2228, emissive: new THREE.Color(0x22303a), emissiveIntensity: 0.2, shininess: 90 })
    );
    slit.position.set(side * 0.22, 1.28, 0.035);
    g.add(slit);
    const groove = new THREE.Mesh(new THREE.BoxGeometry(doorW - 0.1, 0.012, 0.01), trim);
    groove.position.set(0, 1.55, 0.034);
    g.add(groove);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.03, doorH - 0.08, 0.07), trim);
    edge.position.set(-side * (doorW / 2 - 0.02), doorH / 2, 0);
    g.add(edge);
    g.position.set(side * (doorW / 2 + 0.01), 0.06, 0.11);
    return g;
  };
  const doorL = makeDoor(-1);
  const doorR = makeDoor(1);
  group.add(doorL, doorR);

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  const signTex = new THREE.CanvasTexture(canvas);
  signTex.colorSpace = THREE.SRGBColorSpace;
  signTex.minFilter = THREE.LinearFilter;
  signTex.magFilter = THREE.LinearFilter;
  signTex.generateMipmaps = false;
  paintElevatorSign(ctx, 256, 96, 18, false);
  signTex.needsUpdate = true;
  const signMat = new THREE.MeshPhongMaterial({
    map: signTex,
    emissive: new THREE.Color(0x1a3a22),
    emissiveMap: signTex,
    emissiveIntensity: 0.55,
    shininess: 8,
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.4), signMat);
  sign.position.set(0.08, 2.5, 0.16);
  group.add(sign);
  const signFrame = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.48, 0.05), trim);
  signFrame.position.set(0.08, 2.5, 0.13);
  group.add(signFrame);

  const arrowMatOff = phongFresh({ color: 0x1a221c, emissive: 0x0a120e, shininess: 20 });
  const arrowDown = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.14, 3), arrowMatOff);
  arrowDown.position.set(-0.72, 2.42, 0.18);
  arrowDown.rotation.z = Math.PI;
  group.add(arrowDown);
  const arrowUp = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.14, 3), arrowMatOff.clone());
  arrowUp.position.set(-0.72, 2.6, 0.18);
  group.add(arrowUp);

  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.62, 0.06), steelDark);
  plate.position.set(1.62, 1.18, 0.18);
  group.add(plate);
  const buttonMat = phongFresh({ color: 0x3a3230, emissive: 0x3a1010, shininess: 70, specular: 0x886666 });
  buttonMat.emissiveIntensity = 0.55;
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 14), buttonMat);
  button.rotation.x = Math.PI / 2;
  button.position.set(1.62, 1.28, 0.22);
  group.add(button);
  const btnRing = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 6, 14), trim);
  btnRing.position.set(1.62, 1.28, 0.215);
  group.add(btnRing);

  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(ELEVATOR_PAD_ALONG * 2, ELEVATOR_PAD_FAR - ELEVATOR_PAD_NEAR),
    new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.22 })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.02, (ELEVATOR_PAD_NEAR + ELEVATOR_PAD_FAR) / 2);
  group.add(pad);

  const doorClosed = doorW / 2 + 0.01;
  let state: ElevatorState = 'idle';
  let openT = 0;
  let floorNo = 18;
  const arrowDownMat = arrowDown.material as THREE.MeshPhongMaterial;
  const arrowUpMat = arrowUp.material as THREE.MeshPhongMaterial;

  const paint = () => {
    paintElevatorSign(ctx, 256, 96, floorNo, state !== 'idle');
    signTex.needsUpdate = true;
    signMat.emissiveIntensity = state === 'idle' ? 0.7 : state === 'called' ? 1.05 : 1.25;
  };

  const setButton = (on: boolean, pulse = 0) => {
    if (on) {
      buttonMat.color.setHex(0x1d4a2c);
      buttonMat.emissive.setHex(0x3ee06a);
      buttonMat.emissiveIntensity = 1.15 + pulse * 0.45;
    } else {
      buttonMat.color.setHex(0x3a3230);
      buttonMat.emissive.setHex(0x3a1010);
      buttonMat.emissiveIntensity = 0.45;
    }
  };

  const setArrows = (down: boolean, time: number) => {
    const blink = 0.55 + Math.sin(time * 8) * 0.45;
    arrowDownMat.emissive.setHex(down ? 0x3ee06a : 0x0a120e);
    arrowDownMat.color.setHex(down ? 0x1a4a28 : 0x1a221c);
    arrowDownMat.emissiveIntensity = down ? blink : 0.15;
    arrowUpMat.emissive.setHex(0x0a120e);
    arrowUpMat.emissiveIntensity = 0.12;
  };

  paint();

  return {
    group,
    get openT() {
      return openT;
    },
    setState(next) {
      state = next;
      setButton(next !== 'idle');
      paint();
    },
    setFloor(n) {
      const v = Math.max(1, Math.min(18, n | 0));
      if (v === floorNo) return;
      floorNo = v;
      paint();
    },
    update(dt, time) {
      if (state === 'opening') openT = Math.min(1, openT + dt / 1.15);
      const e = 1 - (1 - openT) ** 3;
      doorL.position.x = -doorClosed - 1.12 * e;
      doorR.position.x = doorClosed + 1.12 * e;
      setButton(state !== 'idle', state === 'called' ? (0.5 + 0.5 * Math.sin(time * 6)) : 0.15);
      setArrows(state !== 'idle', time);
      const padMat = pad.material as THREE.MeshBasicMaterial;
      padMat.opacity = state === 'idle' ? 0.16 : 0.22 + (state === 'ready' || state === 'opening' ? 0.12 : 0) + Math.sin(time * 3) * 0.04;
    },
  };
}

export function addTv(parent: THREE.Group, tone: FurnitureTone = 'dark', color?: string) {
  const pal = furnitureLook(tone, color);
  const y = 1.38;
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.78, 0.05), phong({ color: pal.bezel, shininess: 42, specular: 0x667088 }));
  bezel.position.set(0, y, 0.03);
  parent.add(bezel);
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(1.18, 0.64, 0.02),
    new THREE.MeshPhongMaterial({
      color: 0x12161c,
      emissive: new THREE.Color(0x1a3048),
      emissiveIntensity: 0.45,
      shininess: 70,
      specular: 0x445566,
    })
  );
  screen.position.set(0, y, 0.055);
  parent.add(screen);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.018, 0.01), phong({ color: pal.metal, shininess: 40 }));
  bar.position.set(0, y - 0.34, 0.058);
  parent.add(bar);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.01), new THREE.MeshBasicMaterial({ color: 0xff3a3a }));
  led.position.set(0.52, y - 0.34, 0.06);
  parent.add(led);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.08), phong({ color: pal.frame, map: tex.metal(), shininess: 50 }));
  arm.position.set(0, y, -0.03);
  parent.add(arm);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.03), phong({ color: pal.frame, map: tex.metal(), shininess: 45 }));
  plate.position.set(0, y, -0.07);
  parent.add(plate);
}

export function addWindow(
  parent: THREE.Group,
  x: number,
  y: number,
  z: number,
  rotY: number,
  w = 2.2,
  h = 1.05,
  sky: SkyKind = 'day'
) {
  const glassColor = sky === 'dusk' ? 0xff9a4a : sky === 'night' ? 0x152038 : 0xc8e8ff;
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshPhongMaterial({
      color: glassColor,
      emissive: new THREE.Color(glassColor),
      emissiveIntensity: sky === 'night' ? 0.45 : sky === 'dusk' ? 0.85 : 0.7,
      side: THREE.FrontSide,
      shininess: 40,
      specular: 0x8899aa,
    })
  );
  glass.position.set(x, y, z);
  glass.rotation.y = rotY;
  parent.add(glass);

  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.05), mats.metal());
  frame.position.set(x, y, z);
  frame.rotation.y = rotY;
  parent.add(frame);
  const barV = new THREE.Mesh(new THREE.BoxGeometry(0.04, h, 0.04), mats.metal());
  barV.position.set(x, y, z);
  barV.rotation.y = rotY;
  parent.add(barV);
  const barH = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, 0.04), mats.metal());
  barH.position.set(x, y, z);
  barH.rotation.y = rotY;
  parent.add(barH);
}

/**
 * 纸片特效池：倒地时爆出一叠 A4。
 * 纯视觉，不进物理。
 */
export class PaperBurst {
  private meshes: THREE.Mesh[] = [];
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private spin: Float32Array;
  private life: Float32Array;
  private cursor = 0;
  private geo: THREE.BufferGeometry;

  constructor(private scene: THREE.Scene) {
    const cfg = crowdFx('colleague-a-m').hit.paper;
    const n = Math.max(1, commonFx().pools.paper | 0);
    this.geo = new THREE.PlaneGeometry(cfg.width, cfg.height);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.life = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: cfg.color, side: THREE.DoubleSide, transparent: true });
      const m = new THREE.Mesh(this.geo, mat);
      m.visible = false;
      scene.add(m);
      this.meshes.push(m);
    }
  }

  spawn(x: number, y: number, z: number, n?: number, look?: PaperBurstFx) {
    const cfg = look ?? crowdFx('colleague-a-m').hit.paper;
    const count = Math.max(0, n ?? cfg.count);
    const span = Math.max(0, cfg.lifeMax - cfg.lifeMin);
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.meshes.length;
      this.life[i] = cfg.lifeMin + Math.random() * span;
      this.vx[i] = (Math.random() - 0.5) * cfg.speed;
      this.vy[i] = cfg.upMin + Math.random() * Math.max(0, cfg.upMax - cfg.upMin);
      this.vz[i] = (Math.random() - 0.5) * cfg.speed;
      this.spin[i] = (Math.random() - 0.5) * 14;
      const m = this.meshes[i];
      (m.material as THREE.MeshBasicMaterial).color.setHex(cfg.color);
      m.visible = true;
      m.position.set(x, y, z);
      m.rotation.set(Math.random(), Math.random(), Math.random());
    }
  }

  update(dt: number) {
    const g = crowdFx('colleague-a-m').hit.paper.gravity;
    for (let i = 0; i < this.meshes.length; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.meshes[i].visible = false;
        continue;
      }
      this.vy[i] -= g * dt;
      const m = this.meshes[i];
      m.position.x += this.vx[i] * dt;
      m.position.y += this.vy[i] * dt;
      m.position.z += this.vz[i] * dt;
      m.rotation.x += this.spin[i] * dt;
      m.rotation.z += this.spin[i] * 0.6 * dt;
      if (m.position.y < 0.04) {
        m.position.y = 0.04;
        this.vy[i] *= -0.2;
        this.vx[i] *= 0.6;
        this.vz[i] *= 0.6;
      }
      (m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, this.life[i] * 2);
    }
  }

  dispose() {
    for (const m of this.meshes) {
      this.scene.remove(m);
      (m.material as THREE.Material).dispose();
    }
    this.meshes.length = 0;
    this.geo.dispose();
  }
}

/** 冲刺残影：无影子的半透明剪影，可加色、沿冲刺方向拉长 */
export class DashTrail {
  private meshes: THREE.Mesh[] = [];
  private life: Float32Array;
  private maxLife: Float32Array;
  private peak: Float32Array;
  private cursor = 0;
  private acc = 0;
  private geo: THREE.BufferGeometry;
  private style: TrailFx = dashFx('none', 1).trail;

  constructor(private scene: THREE.Scene) {
    const cfg = this.style;
    const n = Math.max(1, commonFx().pools.trail | 0);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.peak = new Float32Array(n);
    this.geo = new THREE.CapsuleGeometry(cfg.radius, cfg.height, 3, 8);
    this.geo.translate(0, 0.7, 0);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.geo, this.makeMat(cfg));
      m.visible = false;
      m.castShadow = false;
      m.receiveShadow = false;
      scene.add(m);
      this.meshes.push(m);
    }
  }

  private makeMat(cfg: TrailFx) {
    return new THREE.MeshBasicMaterial({
      color: cfg.color,
      transparent: true,
      opacity: cfg.opacity,
      depthWrite: false,
      blending: fxBlend(cfg.additive || cfg.ghost),
    });
  }

  setStyle(cfg: TrailFx) {
    this.style = cfg;
    for (const m of this.meshes) (m.material as THREE.MeshBasicMaterial).color.setHex(cfg.color);
  }

  emit(x: number, z: number, yaw: number, dt: number) {
    this.acc += dt;
    if (this.acc < this.style.interval) return;
    this.acc = 0;
    this.stamp(x, z, yaw);
  }

  /** 立刻盖一枚残影，间隔由调用方自己控（多人加速时不能共用 acc）。 */
  stamp(x: number, z: number, yaw: number) {
    const cfg = this.style;
    const copies = Math.max(1, cfg.copies | 0);
    const stretch = Math.max(0.4, cfg.stretch);
    const ghost = cfg.ghost;
    for (let c = 0; c < copies; c++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.meshes.length;
      const back = c * (ghost ? 0.16 : 0.1);
      this.life[i] = cfg.life;
      this.maxLife[i] = cfg.life;
      this.peak[i] = cfg.opacity * (1 - c / (copies + 0.35));
      const m = this.meshes[i];
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setHex(cfg.color);
      mat.blending = fxBlend(cfg.additive || ghost);
      mat.opacity = this.peak[i];
      m.visible = true;
      m.position.set(x - Math.sin(yaw) * back, 0, z - Math.cos(yaw) * back);
      m.rotation.y = yaw;
      const sy = ghost ? 0.78 : 1;
      const sx = ghost ? 1.12 : 1;
      m.scale.set(sx, sy, stretch);
    }
  }

  update(dt: number) {
    const cfg = this.style;
    const pow = Math.max(0.4, cfg.fadePow);
    for (let i = 0; i < this.meshes.length; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const m = this.meshes[i];
      if (this.life[i] <= 0) {
        m.visible = false;
        continue;
      }
      const u = Math.max(0, this.life[i] / (this.maxLife[i] || cfg.life));
      (m.material as THREE.MeshBasicMaterial).opacity = this.peak[i] * u ** pow;
    }
  }

  dispose() {
    for (const m of this.meshes) {
      this.scene.remove(m);
      (m.material as THREE.Material).dispose();
    }
    this.meshes.length = 0;
    this.geo.dispose();
  }
}

/** 命中气雾：软团向外胀、上飘、加色，不投影 */
export class ImpactMist {
  private meshes: THREE.Mesh[] = [];
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grow: Float32Array;
  private growAmt: Float32Array;
  private op: Float32Array;
  private flatten: Float32Array;
  private cursor = 0;
  private geo: THREE.SphereGeometry;

  constructor(private scene: THREE.Scene) {
    const cfg = crowdFx('colleague-a-m').hit.mist;
    const n = Math.max(1, commonFx().pools.mist | 0);
    this.geo = new THREE.SphereGeometry(1, 10, 8);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.growAmt = new Float32Array(n);
    this.op = new Float32Array(n);
    this.flatten = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(
        this.geo,
        new THREE.MeshBasicMaterial({
          color: cfg.color,
          transparent: true,
          opacity: cfg.opacity,
          depthWrite: false,
          blending: fxBlend(cfg.additive),
        })
      );
      m.visible = false;
      m.castShadow = false;
      m.receiveShadow = false;
      scene.add(m);
      this.meshes.push(m);
    }
  }

  spawn(x: number, z: number, look?: ImpactMistFx) {
    const cfg = look ?? crowdFx('colleague-a-m').hit.mist;
    if (!cfg.enabled) return;
    const count = Math.max(0, cfg.count | 0);
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.meshes.length;
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * cfg.spread;
      this.life[i] = cfg.life * (0.75 + Math.random() * 0.4);
      this.maxLife[i] = this.life[i];
      this.vx[i] = Math.cos(ang) * rad;
      this.vz[i] = Math.sin(ang) * rad;
      this.vy[i] = cfg.rise * (0.45 + Math.random() * 0.7);
      this.grow[i] = cfg.size * (0.7 + Math.random() * 0.6);
      this.growAmt[i] = cfg.grow;
      this.op[i] = cfg.opacity;
      this.flatten[i] = Math.max(0.12, cfg.flatten);
      const m = this.meshes[i];
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setHex(cfg.color);
      mat.blending = fxBlend(cfg.additive);
      mat.opacity = cfg.opacity;
      m.visible = true;
      m.position.set(x + Math.cos(ang) * rad * 0.25, 0.35 + Math.random() * 0.45, z + Math.sin(ang) * rad * 0.25);
      m.scale.set(this.grow[i], this.grow[i] * this.flatten[i], this.grow[i]);
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.meshes.length; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const m = this.meshes[i];
      if (this.life[i] <= 0) {
        m.visible = false;
        continue;
      }
      const k = 1 - this.life[i] / (this.maxLife[i] || 1);
      m.position.x += this.vx[i] * dt;
      m.position.z += this.vz[i] * dt;
      m.position.y += this.vy[i] * dt;
      const s = this.grow[i] * (1 + k * this.growAmt[i]);
      m.scale.set(s, s * this.flatten[i], s);
      (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.op[i] * (1 - k) ** 1.35);
    }
  }

  dispose() {
    for (const m of this.meshes) {
      this.scene.remove(m);
      (m.material as THREE.Material).dispose();
    }
    this.meshes.length = 0;
    this.geo.dispose();
  }
}

export function spawnHitFx(papers: PaperBurst, mist: ImpactMist, x: number, z: number, look?: HitFx) {
  const hit = look ?? crowdFx('colleague-a-m').hit;
  papers.spawn(x, hit.paper.spawnY, z, hit.paper.count, hit.paper);
  mist.spawn(x, z, hit.mist);
}

function hexCss(n: number) {
  return `#${(n >>> 0).toString(16).padStart(6, '0')}`;
}

const popTexCache = new Map<string, THREE.CanvasTexture>();

function overtimePopMap(text: string, color: number, outline: boolean, outlineColor: number): THREE.CanvasTexture {
  const key = `${text}|${color}|${outline ? outlineColor : 'x'}`;
  const hit = popTexCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.font = '700 72px "PingFang SC","Hiragino Sans GB","Noto Sans SC",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (outline) {
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = 12;
    ctx.strokeStyle = hexCss(outlineColor);
    ctx.strokeText(text, 256, 68);
  }
  ctx.fillStyle = hexCss(color);
  ctx.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  popTexCache.set(key, tex);
  return tex;
}

/** 判定加时：头顶飘出 +N分钟，不再用色块 */
export class OvertimePop {
  private items: {
    sprite: THREE.Sprite;
    life: number;
    max: number;
    rise: number;
    opacity: number;
    size: number;
  }[] = [];

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.SpriteMaterial({
        transparent: true,
        depthWrite: false,
        opacity: 1,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.center.set(0.5, 0.35);
      scene.add(sprite);
      this.items.push({ sprite, life: 0, max: 1, rise: 1, opacity: 1, size: 0.48 });
    }
  }

  spawn(x: number, z: number, minutes: number, look?: OvertimeFx) {
    const cfg = look ?? crowdFx('colleague-a-m').overtime;
    if (!cfg.enabled) return;
    const slot = this.items.find((s) => !s.sprite.visible) ?? this.items[0]!;
    const mat = slot.sprite.material;
    mat.map = overtimePopMap(overtimePopText(minutes), cfg.color, cfg.outline, cfg.outlineColor);
    mat.color.setHex(0xffffff);
    mat.opacity = cfg.opacity;
    mat.needsUpdate = true;
    slot.sprite.position.set(x, cfg.y, z);
    slot.sprite.scale.set(cfg.size * 4, cfg.size, 1);
    slot.sprite.visible = true;
    slot.life = cfg.duration;
    slot.max = cfg.duration;
    slot.rise = cfg.rise;
    slot.opacity = cfg.opacity;
    slot.size = cfg.size;
  }

  update(dt: number) {
    for (const s of this.items) {
      if (!s.sprite.visible) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.sprite.visible = false;
        continue;
      }
      const k = 1 - s.life / s.max;
      s.sprite.position.y += s.rise * dt;
      const sc = s.size * (1 + k * 0.18);
      s.sprite.scale.set(sc * 4, sc, 1);
      s.sprite.material.opacity = Math.max(0, s.opacity * (1 - k * k));
    }
  }

  dispose() {
    for (const s of this.items) {
      this.scene.remove(s.sprite);
      s.sprite.material.dispose();
    }
    this.items.length = 0;
  }
}

export { OvertimePop as HeadMark };

/** 倦怠圈：撞人后地面一圈灰蓝减速波 */
export class SlowPulse {
  private items: { mesh: THREE.Mesh; life: number; max: number; radius: number; opacity: number; outline: boolean }[] = [];
  private geo: THREE.PlaneGeometry;
  private fillMap: THREE.CanvasTexture;
  private ringMap: THREE.CanvasTexture;

  constructor(private scene: THREE.Scene) {
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.geo.rotateX(-Math.PI / 2);
    this.fillMap = slowAuraMap(0.4, 0.72, 0.1);
    this.ringMap = slowAuraMap(0.78, 0.22, 0.04);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(
        this.geo,
        new THREE.MeshBasicMaterial({
          map: this.fillMap,
          color: 0x7a90a8,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        })
      );
      m.visible = false;
      m.castShadow = false;
      m.renderOrder = 1;
      scene.add(m);
      this.items.push({ mesh: m, life: 0, max: 1, radius: 1, opacity: 0.45, outline: false });
    }
  }

  spawn(x: number, z: number, radius: number, color: number, opacity: number, life: number, outline = false) {
    const slot = this.items.find((s) => !s.mesh.visible) ?? this.items[0]!;
    const mat = slot.mesh.material as THREE.MeshBasicMaterial;
    mat.map = outline ? this.ringMap : this.fillMap;
    mat.color.setHex(color);
    mat.opacity = opacity;
    mat.needsUpdate = true;
    slot.mesh.position.set(x, outline ? 0.03 : 0.04, z);
    const s = Math.max(0.2, radius) * 2;
    slot.mesh.scale.set(s, 1, s);
    slot.mesh.visible = true;
    slot.life = Math.max(0.08, life);
    slot.max = slot.life;
    slot.radius = radius;
    slot.opacity = opacity;
    slot.outline = outline;
  }

  update(dt: number) {
    for (const s of this.items) {
      if (!s.mesh.visible) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        continue;
      }
      const k = 1 - s.life / s.max;
      const sc = s.outline ? s.radius * (1.05 + k * 0.12) * 2 : s.radius * (0.35 + k * 0.65) * 2;
      s.mesh.scale.set(sc, 1, sc);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, s.opacity * (s.outline ? 1 - k * k : (1 - k) ** 1.2));
    }
  }

  dispose() {
    for (const s of this.items) {
      this.scene.remove(s.mesh);
      (s.mesh.material as THREE.Material).dispose();
    }
    this.items.length = 0;
    this.geo.dispose();
  }
}

const STAR_MAX = 8;
const TAU = Math.PI * 2;

function fxCanvas(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function sparkTex() {
  return fxCanvas(128, (ctx, s) => {
    const m = s / 2;
    const g = ctx.createRadialGradient(m, m, 0, m, m, m);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.14, 'rgba(255,255,230,0.9)');
    g.addColorStop(0.42, 'rgba(255,220,90,0.28)');
    g.addColorStop(1, 'rgba(255,200,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#fffce8';
    ctx.beginPath();
    ctx.moveTo(m, 6);
    ctx.lineTo(m + 4.5, m);
    ctx.lineTo(m, s - 6);
    ctx.lineTo(m - 4.5, m);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(6, m);
    ctx.lineTo(m, m + 4.5);
    ctx.lineTo(s - 6, m);
    ctx.lineTo(m, m - 4.5);
    ctx.closePath();
    ctx.fill();
  });
}

function starTex() {
  return fxCanvas(128, (ctx, s) => {
    const m = s / 2;
    const r = m * 0.8;
    const ri = r * 0.38;
    ctx.translate(m, m);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * TAU) / 5;
      const b = a + Math.PI / 5;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineTo(Math.cos(b) * ri, Math.sin(b) * ri);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,240,170,0.95)');
    g.addColorStop(1, 'rgba(255,200,50,0)');
    ctx.fillStyle = g;
    ctx.fill();
  });
}

function blobTex() {
  return fxCanvas(128, (ctx, s) => {
    const m = s / 2;
    const g = ctx.createRadialGradient(m, m, 0, m, m, m);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.22, 'rgba(255,245,180,0.55)');
    g.addColorStop(0.6, 'rgba(255,210,80,0.12)');
    g.addColorStop(1, 'rgba(255,180,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

const STUN_TEX: Record<StunElem, THREE.CanvasTexture> = {
  spark: sparkTex(),
  star: starTex(),
  disc: blobTex(),
};
const STUN_GLOW_TEX = blobTex();

type StunSlot = {
  group: THREE.Group;
  glow: THREE.Sprite;
  ring: THREE.Mesh;
  stars: THREE.Sprite[];
  key: number;
  spin: number;
  orbit: number;
  bob: number;
  tilt: number;
  y: number;
  ringInner: number;
  t: number;
};

type SlowSlot = {
  mesh: THREE.Mesh;
  key: number;
  spin: number;
  size: number;
  opacity: number;
  t: number;
};

type ChannelSlot = {
  group: THREE.Group;
  tilt: THREE.Group;
  card: THREE.Mesh;
  logoF: THREE.Mesh;
  logoB: THREE.Mesh;
  key: number;
  spin: number;
  bob: number;
  bobSpeed: number;
  y: number;
  t: number;
};

/** 贴身读条：平躺文件卡 + 透明底 Logo，绕竖轴水平转 */
export class ChannelMarks {
  private items: ChannelSlot[] = [];
  private cardGeo = new THREE.BoxGeometry(1, 1, 1);
  private logoGeo = new THREE.PlaneGeometry(0.78, 0.78);

  constructor(private scene: THREE.Scene, cap = 24) {
    for (let i = 0; i < cap; i++) {
      const group = new THREE.Group();
      group.visible = false;
      const tilt = new THREE.Group();
      tilt.rotation.x = -Math.PI / 2;
      const card = new THREE.Mesh(
        this.cardGeo,
        phongFresh({ color: 0xf3ead2, shininess: 12, specular: 0x444433, transparent: true, opacity: 1 })
      );
      card.castShadow = true;
      const logoMat = () =>
        new THREE.MeshBasicMaterial({
          map: channelStampMap('word'),
          transparent: true,
          depthWrite: false,
          alphaTest: 0.08,
        });
      const logoF = new THREE.Mesh(this.logoGeo, logoMat());
      logoF.position.z = 0.52;
      const logoB = new THREE.Mesh(this.logoGeo, logoMat());
      logoB.position.z = -0.52;
      logoB.rotation.y = Math.PI;
      tilt.add(card, logoF, logoB);
      group.add(tilt);
      scene.add(group);
      this.items.push({ group, tilt, card, logoF, logoB, key: -1, spin: 1.8, bob: 0.04, bobSpeed: 10, y: 2.05, t: 0 });
    }
  }

  pin(key: number, x: number, z: number, look?: ChannelLookFx, bodyScale = 1) {
    const cfg = look ?? crowdFx('colleague-a-m').channel;
    if (!cfg.enabled) {
      this.clear(key);
      return;
    }
    const slot = this.items.find((s) => s.key === key) ?? this.items.find((s) => s.key < 0) ?? this.items[0]!;
    const cardMat = slot.card.material as THREE.MeshPhongMaterial;
    const paper = cfg.stamp === 'paper';
    cardMat.color.setHex(cfg.color);
    cardMat.map = paper ? channelStampMap('paper') : null;
    cardMat.opacity = cfg.opacity;
    cardMat.transparent = paper || cfg.opacity < 0.98;
    cardMat.needsUpdate = true;
    const map = channelStampMap(cfg.stamp);
    for (const logo of [slot.logoF, slot.logoB]) {
      const mat = logo.material as THREE.MeshBasicMaterial;
      mat.map = map;
      logo.visible = !paper;
      mat.needsUpdate = true;
    }
    slot.key = key;
    slot.spin = cfg.spin;
    slot.bob = cfg.bob;
    slot.bobSpeed = cfg.bobSpeed;
    slot.y = cfg.y * bodyScale;
    slot.tilt.scale.set(cfg.width * bodyScale, cfg.height * bodyScale, cfg.thick * bodyScale);
    slot.group.position.set(x, slot.y, z);
    slot.group.visible = true;
  }

  follow(key: number, x: number, z: number) {
    const slot = this.items.find((s) => s.key === key);
    if (!slot) return;
    slot.group.position.x = x;
    slot.group.position.z = z;
  }

  clear(key: number) {
    const slot = this.items.find((s) => s.key === key);
    if (!slot) return;
    slot.key = -1;
    slot.group.visible = false;
  }

  clearAll() {
    for (const s of this.items) {
      s.key = -1;
      s.group.visible = false;
    }
  }

  syncEnemy(i: number, x: number, z: number, on: boolean, scale: number, look: ChannelLookFx) {
    if (on && look.enabled) this.pin(i, x, z, look, scale);
    else this.clear(i);
    this.follow(i, x, z);
  }

  update(dt: number) {
    for (const s of this.items) {
      if (!s.group.visible) continue;
      s.t += dt;
      s.group.rotation.y += s.spin * dt;
      s.group.position.y = s.y + Math.sin(s.t * s.bobSpeed) * s.bob;
    }
  }

  dispose() {
    for (const s of this.items) this.scene.remove(s.group);
    this.items.length = 0;
    this.cardGeo.dispose();
    this.logoGeo.dispose();
  }
}

/** 眩晕金星+转圈、减速脚底雾圈：跟在角色身上，样子锁在角色目录 */
export class StatusMarks {
  private stuns: StunSlot[] = [];
  private slows: SlowSlot[] = [];
  private auraGeo: THREE.PlaneGeometry;

  constructor(private scene: THREE.Scene, pool = 24) {
    this.auraGeo = new THREE.PlaneGeometry(1, 1);
    this.auraGeo.rotateX(-Math.PI / 2);
    const defaultSlowMap = slowAuraMap(0.36, 0.58, 0.22);
    for (let i = 0; i < pool; i++) {
      const group = new THREE.Group();
      group.visible = false;
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: STUN_GLOW_TEX,
          color: 0xffd56a,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      group.add(glow);
      const ringGeo = new THREE.RingGeometry(0.78, 1, 48, 1);
      ringGeo.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffe08a,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        })
      );
      group.add(ring);
      const stars: THREE.Sprite[] = [];
      for (let s = 0; s < STAR_MAX; s++) {
        const star = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: STUN_TEX.spark,
            color: 0xfff2a8,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          })
        );
        star.visible = false;
        group.add(star);
        stars.push(star);
      }
      scene.add(group);
      this.stuns.push({
        group,
        glow,
        ring,
        stars,
        key: -1,
        spin: 3.2,
        orbit: 0.34,
        bob: 0.05,
        tilt: 0.42,
        y: 1.88,
        ringInner: 0.78,
        t: 0,
      });
      const aura = new THREE.Mesh(
        this.auraGeo,
        new THREE.MeshBasicMaterial({
          map: defaultSlowMap,
          color: 0x7a90a8,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        })
      );
      aura.renderOrder = 1;
      aura.visible = false;
      scene.add(aura);
      this.slows.push({ mesh: aura, key: -1, spin: 1.2, size: 0.58, opacity: 0.4, t: 0 });
    }
  }

  pinStun(key: number, x: number, z: number, look?: StunLookFx) {
    const cfg = look ?? crowdFx('colleague-a-m').stun;
    if (!cfg.enabled) {
      this.releaseStun(key);
      return;
    }
    const slot = this.stuns.find((s) => s.key === key) ?? this.stuns.find((s) => s.key < 0) ?? this.stuns[0]!;
    this.applyStun(slot, key, cfg);
    slot.group.position.set(x, 0, z);
  }

  pinSlow(key: number, x: number, z: number, look?: SlowLookFx) {
    const cfg = look ?? crowdFx('colleague-a-m').slow;
    if (!cfg.enabled) {
      this.releaseSlow(key);
      return;
    }
    const slot = this.slows.find((s) => s.key === key) ?? this.slows.find((s) => s.key < 0) ?? this.slows[0]!;
    this.applySlow(slot, key, cfg);
    slot.mesh.position.set(x, cfg.y, z);
  }

  follow(key: number, x: number, z: number) {
    const stun = this.stuns.find((s) => s.key === key);
    if (stun) stun.group.position.set(x, 0, z);
    const slow = this.slows.find((s) => s.key === key);
    if (slow) {
      slow.mesh.position.x = x;
      slow.mesh.position.z = z;
    }
  }

  clear(key: number) {
    this.releaseStun(key);
    this.releaseSlow(key);
  }

  clearAll() {
    for (const s of this.stuns) {
      s.key = -1;
      s.group.visible = false;
    }
    for (const s of this.slows) {
      s.key = -1;
      s.mesh.visible = false;
    }
  }

  syncEnemy(i: number, x: number, z: number, stunned: boolean, slowed: boolean, stunLook: StunLookFx, slowLook: SlowLookFx) {
    if (stunned && stunLook.enabled) this.pinStun(i, x, z, stunLook);
    else this.releaseStun(i);
    if (slowed && slowLook.enabled) this.pinSlow(i, x, z, slowLook);
    else this.releaseSlow(i);
  }

  update(dt: number) {
    for (const s of this.stuns) {
      if (!s.group.visible) continue;
      s.t += dt;
      s.ring.rotation.y += s.spin * 0.35 * dt;
      const pulse = 0.88 + Math.sin(s.t * 4.2) * 0.12;
      s.glow.scale.setScalar((s.glow.userData.glowSize as number) * pulse);
      const n = s.stars.filter((st) => st.visible).length || 1;
      let k = 0;
      for (const star of s.stars) {
        if (!star.visible) continue;
        const a = s.t * s.spin + (k / n) * TAU;
        const x = Math.cos(a) * s.orbit;
        const z = Math.sin(a) * s.orbit;
        const y = s.y + Math.sin(a) * s.orbit * s.tilt + Math.sin(s.t * 7 + k) * s.bob;
        star.position.set(x, y, z);
        const twinkle = 0.82 + Math.sin(s.t * 9 + k * 1.7) * 0.18;
        star.scale.setScalar((star.userData.size as number) * twinkle);
        k++;
      }
    }
    for (const s of this.slows) {
      if (!s.mesh.visible) continue;
      s.t += dt;
      s.mesh.rotation.y += s.spin * dt;
      const pulse = 0.88 + Math.sin(s.t * 3.2) * 0.12;
      const sc = s.size * 2 * pulse;
      s.mesh.scale.set(sc, 1, sc);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, s.opacity * pulse);
    }
  }

  dispose() {
    for (const s of this.stuns) this.scene.remove(s.group);
    for (const s of this.slows) this.scene.remove(s.mesh);
    this.stuns.length = 0;
    this.slows.length = 0;
    this.auraGeo.dispose();
  }

  private applyStun(slot: StunSlot, key: number, cfg: StunLookFx) {
    slot.key = key;
    slot.spin = cfg.spin;
    slot.orbit = cfg.orbit;
    slot.bob = cfg.bob ?? 0.05;
    slot.tilt = cfg.tilt ?? 0.4;
    slot.y = cfg.y;
    slot.group.visible = true;
    const elem: StunElem = cfg.elem === 'star' || cfg.elem === 'disc' ? cfg.elem : 'spark';
    const map = STUN_TEX[elem];

    slot.glow.visible = !!cfg.glowOn;
    slot.glow.position.y = cfg.y;
    const glowSize = cfg.glowSize || 0.5;
    slot.glow.scale.setScalar(glowSize);
    slot.glow.userData.glowSize = glowSize;
    const glowMat = slot.glow.material as THREE.SpriteMaterial;
    glowMat.map = STUN_GLOW_TEX;
    glowMat.color.setHex(cfg.glowColor || cfg.starColor);
    glowMat.opacity = cfg.glowOpacity ?? 0.4;
    glowMat.blending = THREE.AdditiveBlending;

    slot.ring.visible = cfg.ringOn !== false;
    const inner = Math.max(0.2, Math.min(0.94, 1 - (cfg.ringWidth ?? 0.2)));
    if (Math.abs(inner - slot.ringInner) > 0.01) {
      slot.ring.geometry.dispose();
      const g = new THREE.RingGeometry(inner, 1, 48, 1);
      g.rotateX(-Math.PI / 2);
      slot.ring.geometry = g;
      slot.ringInner = inner;
    }
    slot.ring.scale.setScalar(cfg.ringSize || 0.4);
    slot.ring.position.y = cfg.y;
    const ringMat = slot.ring.material as THREE.MeshBasicMaterial;
    ringMat.color.setHex(cfg.ringColor);
    ringMat.opacity = cfg.ringOpacity;
    ringMat.blending = fxBlend(cfg.ringAdditive !== false);

    const n = Math.max(1, Math.min(STAR_MAX, Math.round(cfg.starCount)));
    const size = cfg.starSize || 0.26;
    for (let i = 0; i < STAR_MAX; i++) {
      const star = slot.stars[i]!;
      star.visible = i < n;
      star.userData.size = size;
      star.scale.setScalar(size);
      const mat = star.material as THREE.SpriteMaterial;
      mat.map = map;
      mat.color.setHex(cfg.starColor);
      mat.opacity = cfg.starOpacity ?? 0.95;
      mat.blending = THREE.AdditiveBlending;
      mat.needsUpdate = true;
    }
  }

  private applySlow(slot: SlowSlot, key: number, cfg: SlowLookFx) {
    slot.key = key;
    slot.spin = cfg.spin;
    slot.size = cfg.size;
    slot.opacity = cfg.opacity;
    slot.mesh.visible = true;
    slot.mesh.position.y = cfg.y;
    const mat = slot.mesh.material as THREE.MeshBasicMaterial;
    mat.map = slowAuraMap(cfg.inner ?? 0.36, cfg.softness ?? 0.55, cfg.fill ?? 0.2);
    mat.color.setHex(cfg.color);
    mat.opacity = cfg.opacity;
    mat.blending = fxBlend(!!cfg.additive);
    mat.needsUpdate = true;
    const sc = cfg.size * 2;
    slot.mesh.scale.set(sc, 1, sc);
  }

  private releaseStun(key: number) {
    for (const s of this.stuns) {
      if (s.key !== key) continue;
      s.key = -1;
      s.group.visible = false;
    }
  }

  private releaseSlow(key: number) {
    for (const s of this.slows) {
      if (s.key !== key) continue;
      s.key = -1;
      s.mesh.visible = false;
    }
  }
}
