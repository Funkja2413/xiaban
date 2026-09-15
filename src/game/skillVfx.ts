import * as THREE from 'three/webgpu';
import { chainStyleOf, type ChainStyleId } from '../fx/catalog';
import { BONE_BACK, BONE_HAND, BONE_HAND_L, BONE_NECK, findBoneAny } from './hair';
import type { HumanoidFigure } from './humanoid';

const LINK_N = 12;

function chainTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#6a6e78';
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = '#f4f6fa';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(32, 18, 12, 15, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(32, 46, 12, 15, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(26, 16, 5, 8, 0, -0.8, 1.2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

let CHAIN_MAP: THREE.CanvasTexture | null = null;
function chainMap() {
  return (CHAIN_MAP ??= chainTex());
}

type ChainSlot = {
  group: THREE.Group;
  links: THREE.Mesh[];
  glows: THREE.Mesh[];
  collar: THREE.Mesh;
  collarGlow: THREE.Mesh;
  coreMat: THREE.MeshBasicMaterial;
  glowMat: THREE.MeshBasicMaterial;
  life: number;
  caster: number;
  /** 0 右手，1 左手。项圈只挂在右手那条上。 */
  hand: 0 | 1;
  width: number;
  sag: number;
  color: number;
  style: ChainStyleId;
};

/** 截杀锁链：双手各一条，全程最多两名施法者。 */
export class SkillChains {
  private slots: ChainSlot[] = [];
  private geo: THREE.BoxGeometry;
  private ringGeo: THREE.TorusGeometry;
  private map: THREE.CanvasTexture;

  constructor(private scene: THREE.Scene, pool = 4) {
    this.geo = new THREE.BoxGeometry(1, 1, 1);
    this.ringGeo = new THREE.TorusGeometry(0.48, 0.14, 6, 10);
    this.ringGeo.rotateY(Math.PI / 2);
    this.map = chainMap();
    for (let s = 0; s < pool; s++) {
      const group = new THREE.Group();
      group.visible = false;
      group.renderOrder = 8;
      const links: THREE.Mesh[] = [];
      const coreMat = new THREE.MeshBasicMaterial({
        map: this.map,
        color: 0xff8080,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xff5050,
        transparent: true,
        opacity: 0.5,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const glows: THREE.Mesh[] = [];
      for (let i = 0; i < LINK_N; i++) {
        const m = new THREE.Mesh(this.geo, coreMat);
        m.castShadow = false;
        m.frustumCulled = false;
        m.renderOrder = 8;
        const g = new THREE.Mesh(this.geo, glowMat);
        g.castShadow = false;
        g.frustumCulled = false;
        g.scale.set(1.85, 1.85, 1.45);
        m.add(g);
        group.add(m);
        links.push(m);
        glows.push(g);
      }
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.022, 8, 16), coreMat.clone());
      collar.rotation.x = Math.PI / 2;
      collar.castShadow = false;
      collar.frustumCulled = false;
      collar.renderOrder = 8;
      const collarGlow = new THREE.Mesh(collar.geometry, glowMat);
      collarGlow.scale.setScalar(1.55);
      collarGlow.frustumCulled = false;
      collar.add(collarGlow);
      group.add(collar);
      scene.add(group);
      this.slots.push({
        group,
        links,
        glows,
        collar,
        collarGlow,
        coreMat,
        glowMat,
        life: 0,
        caster: -1,
        hand: 0,
        width: 0.08,
        sag: 0.42,
        color: 0xff5050,
        style: 'links',
      });
    }
  }

  lock(
    caster: number,
    hand: 0 | 1,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    life: number,
    color: number,
    width: number,
    sag: number,
    style?: ChainStyleId
  ) {
    const slot =
      this.slots.find((s) => s.group.visible && s.caster === caster && s.hand === hand) ??
      this.slots.find((s) => !s.group.visible) ??
      this.slots.find((s) => s.caster !== caster) ??
      this.slots[0]!;
    slot.caster = caster;
    slot.hand = hand;
    slot.life = Math.max(0.2, life);
    slot.width = Math.max(0.04, width);
    slot.sag = Math.max(0, sag);
    slot.color = color;
    slot.coreMat.color.setHex(color);
    slot.glowMat.color.setHex(color);
    (slot.collar.material as THREE.MeshBasicMaterial).color.setHex(color);
    slot.collar.visible = hand === 0;
    slot.group.visible = true;
    this.applyStyle(slot, chainStyleOf(style));
    this.place(slot, ax, ay, az, bx, by, bz, 1);
  }

  lockHands(
    caster: number,
    ax: number,
    ay: number,
    az: number,
    lx: number,
    ly: number,
    lz: number,
    bx: number,
    by: number,
    bz: number,
    life: number,
    color: number,
    width: number,
    sag: number,
    style?: ChainStyleId
  ) {
    this.lock(caster, 0, ax, ay, az, bx, by, bz, life, color, width, sag, style);
    this.lock(caster, 1, lx, ly, lz, bx, by, bz, life, color, width, sag, style);
  }

  casterOf(i: number) {
    return this.slots.find((s) => s.group.visible && s.caster === i) ?? null;
  }

  private slotOf(caster: number, hand: 0 | 1) {
    return this.slots.find((s) => s.group.visible && s.caster === caster && s.hand === hand) ?? null;
  }

  /** 有锁链在场时，给被栓的玩家同步发光。 */
  live() {
    const slot = this.slots.find((s) => s.group.visible);
    if (!slot) return null;
    const fade = slot.life < 0.18 ? Math.max(0, slot.life / 0.18) : 1;
    return { color: slot.color, fade };
  }

  follow(
    caster: number,
    hand: 0 | 1,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    style?: ChainStyleId
  ) {
    const slot = this.slotOf(caster, hand);
    if (!slot) return;
    if (style) this.applyStyle(slot, chainStyleOf(style));
    this.place(slot, ax, ay, az, bx, by, bz, Math.min(1, slot.life / 0.35));
  }

  followHands(
    caster: number,
    ax: number,
    ay: number,
    az: number,
    lx: number,
    ly: number,
    lz: number,
    bx: number,
    by: number,
    bz: number,
    style?: ChainStyleId
  ) {
    this.follow(caster, 0, ax, ay, az, bx, by, bz, style);
    this.follow(caster, 1, lx, ly, lz, bx, by, bz, style);
  }

  breakCaster(caster: number) {
    for (const slot of this.slots) {
      if (slot.group.visible && slot.caster === caster) this.hide(slot);
    }
  }

  update(dt: number) {
    for (const slot of this.slots) {
      if (!slot.group.visible) continue;
      slot.life -= dt;
      const fade = slot.life < 0.18 ? Math.max(0, slot.life / 0.18) : 1;
      slot.coreMat.opacity = fade;
      (slot.collar.material as THREE.MeshBasicMaterial).opacity = fade;
      slot.glowMat.opacity = 0.22 + fade * 0.42;
      if (slot.life <= 0) this.hide(slot);
    }
  }

  private hide(slot: ChainSlot) {
    slot.group.visible = false;
    slot.caster = -1;
    slot.hand = 0;
    slot.life = 0;
  }

  private applyStyle(slot: ChainSlot, style: ChainStyleId) {
    if (slot.style === style) return;
    slot.style = style;
    const geo = style === 'rings' ? this.ringGeo : this.geo;
    const painted = style === 'links' || style === 'rings';
    slot.coreMat.map = painted ? this.map : null;
    slot.coreMat.needsUpdate = true;
    const gx = style === 'rings' ? 1.28 : style === 'beam' ? 1.7 : 1.85;
    const gz = style === 'rings' ? 1.28 : 1.45;
    for (const m of slot.links) {
      m.geometry = geo;
      const glow = m.children[0] as THREE.Mesh | undefined;
      if (glow) {
        glow.geometry = geo;
        glow.scale.set(gx, gx, gz);
      }
    }
  }

  private place(
    slot: ChainSlot,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    appear: number
  ) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const dist = Math.hypot(dx, dz) || 0.01;
    const sagMul = slot.style === 'beam' ? 0.22 : slot.style === 'rope' ? 1.45 : slot.style === 'rings' ? 0.85 : 1;
    const sag = slot.sag * sagMul * Math.min(1.6, dist * 0.22);
    const w = slot.width * appear;
    for (let i = 0; i < LINK_N; i++) {
      const t0 = i / LINK_N;
      const t1 = (i + 1) / LINK_N;
      const drop0 = 4 * t0 * (1 - t0) * sag;
      const drop1 = 4 * t1 * (1 - t1) * sag;
      const x0 = ax + dx * t0;
      const y0 = ay + dy * t0 - drop0;
      const z0 = az + dz * t0;
      const x1 = ax + dx * t1;
      const y1 = ay + dy * t1 - drop1;
      const z1 = az + dz * t1;
      const lx = x1 - x0;
      const ly = y1 - y0;
      const lz = z1 - z0;
      const seg = Math.hypot(lx, ly, lz) || 0.01;
      const m = slot.links[i]!;
      m.position.set((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5);
      if (slot.style === 'rings') {
        const s = Math.max(0.15, w * 3.4);
        m.scale.setScalar(s);
        m.lookAt(x1, y1, z1);
        m.rotateZ(i % 2 ? Math.PI / 2 : 0);
      } else if (slot.style === 'beam') {
        const t = Math.max(0.07, w * 1.55);
        m.scale.set(t, t, Math.max(0.1, seg * 1.08));
        m.lookAt(x1, y1, z1);
      } else if (slot.style === 'rope') {
        const t = Math.max(0.05, w * 0.95);
        m.scale.set(t, t, Math.max(0.1, seg * 1.06));
        m.lookAt(x1, y1, z1);
        m.rotateZ(i * 0.35);
      } else {
        m.scale.set(Math.max(0.11, w * 2.4), Math.max(0.14, w * 3.2), Math.max(0.12, seg * 1.12));
        m.lookAt(x1, y1, z1);
        m.rotateX(i % 2 ? 0.85 : 0.15);
      }
    }
    slot.collar.position.set(bx, by, bz);
    slot.collar.scale.setScalar(0.7 + appear * 0.45);
  }

  dispose() {
    for (const slot of this.slots) {
      this.scene.remove(slot.group);
      slot.coreMat.dispose();
      slot.glowMat.dispose();
      (slot.collar.material as THREE.Material).dispose();
      slot.collar.geometry.dispose();
    }
    this.slots.length = 0;
    this.geo.dispose();
    this.ringGeo.dispose();
  }
}

export const SHOUT_Y = 1.2;

const _shoutDir = new THREE.Vector3();
const _shoutZ = new THREE.Vector3(0, 0, 1);

type ShoutQueued = {
  delay: number;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  r0: number;
  r1: number;
  color: number;
  opacity: number;
  life: number;
};

type ShoutLive = {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  r0: number;
  r1: number;
  opacity: number;
};

function shoutMat(color: number, opacity: number) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

function shoutOrient(mesh: THREE.Mesh, dx: number, dy: number, dz: number) {
  _shoutDir.set(dx, dy, dz);
  if (_shoutDir.lengthSq() < 1e-8) _shoutDir.set(0, 0, 1);
  else _shoutDir.normalize();
  mesh.quaternion.setFromUnitVectors(_shoutZ, _shoutDir);
}

/** 喊人声波：立圈从胸口飞向目标，圈面垂直于地面。 */
export class SkillShout {
  private geo: THREE.TorusGeometry;
  private glowGeo: THREE.TorusGeometry;
  private rings: THREE.Mesh[] = [];
  private glows: THREE.Mesh[] = [];
  private cursor = 0;
  private q: ShoutQueued[] = [];
  private live: ShoutLive[] = [];
  private tx = 0;
  private ty = SHOUT_Y;
  private tz = 0;
  private aimed = false;

  constructor(private scene: THREE.Scene, pool = 6) {
    this.geo = new THREE.TorusGeometry(1, 0.09, 8, 28);
    this.glowGeo = new THREE.TorusGeometry(1, 0.16, 6, 20);
    const n = Math.max(3, pool | 0);
    for (let i = 0; i < n; i++) {
      this.rings.push(this.make(this.geo, 0.95));
      this.glows.push(this.make(this.glowGeo, 0.35));
    }
  }

  private make(geo: THREE.BufferGeometry, opacity: number) {
    const mesh = new THREE.Mesh(geo, shoutMat(0xffc14d, opacity));
    mesh.visible = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 6;
    this.scene.add(mesh);
    return mesh;
  }

  burst(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    color: number,
    opacity: number,
    count: number,
    gap: number
  ) {
    this.aim(bx, by, bz);
    const n = Math.max(1, Math.min(5, count | 0));
    const g = Math.max(0.04, gap);
    const dist = Math.hypot(bx - ax, by - ay, bz - az);
    const fly = Math.max(0.28, Math.min(0.52, dist / 9));
    for (let i = 0; i < n; i++) {
      this.q.push({
        delay: i * g,
        ax,
        ay,
        az,
        bx,
        by,
        bz,
        r0: 0.22 + i * 0.03,
        r1: 0.58 + i * 0.05,
        color,
        opacity: Math.min(1, opacity * (1.2 - i * 0.12)),
        life: fly + i * 0.04,
      });
    }
  }

  aim(x: number, y: number, z: number) {
    this.tx = x;
    this.ty = y;
    this.tz = z;
    this.aimed = true;
    for (const w of this.q) {
      w.bx = x;
      w.by = y;
      w.bz = z;
    }
    for (const s of this.live) {
      s.bx = x;
      s.by = y;
      s.bz = z;
    }
  }

  update(dt: number) {
    for (let i = this.q.length - 1; i >= 0; i--) {
      const w = this.q[i]!;
      w.delay -= dt;
      if (w.delay > 0) continue;
      this.spawn(w);
      this.q.splice(i, 1);
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i]!;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        const gi = this.rings.indexOf(s.mesh);
        if (gi >= 0) this.glows[gi]!.visible = false;
        this.live.splice(i, 1);
        continue;
      }
      this.place(s);
    }
  }

  clear() {
    this.q.length = 0;
    this.aimed = false;
    for (const s of this.live) s.mesh.visible = false;
    for (const g of this.glows) g.visible = false;
    this.live.length = 0;
  }

  dispose() {
    this.clear();
    for (const m of [...this.rings, ...this.glows]) {
      this.scene.remove(m);
      (m.material as THREE.Material).dispose();
    }
    this.rings.length = 0;
    this.glows.length = 0;
    this.geo.dispose();
    this.glowGeo.dispose();
  }

  private spawn(w: ShoutQueued) {
    const mesh = this.take();
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(w.color);
    mat.opacity = w.opacity;
    mesh.visible = true;
    const glow = this.glows[this.rings.indexOf(mesh)]!;
    const glowMat = glow.material as THREE.MeshBasicMaterial;
    glowMat.color.setHex(w.color);
    glow.visible = true;
    const s: ShoutLive = {
      mesh,
      life: w.life,
      maxLife: w.life,
      ax: w.ax,
      ay: w.ay,
      az: w.az,
      bx: this.aimed ? this.tx : w.bx,
      by: this.aimed ? this.ty : w.by,
      bz: this.aimed ? this.tz : w.bz,
      r0: w.r0,
      r1: w.r1,
      opacity: w.opacity,
    };
    this.live.push(s);
    this.place(s);
  }

  private place(s: ShoutLive) {
    const u = 1 - s.life / s.maxLife;
    const k = u * u * (3 - 2 * u);
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const dz = s.bz - s.az;
    s.mesh.position.set(s.ax + dx * k, s.ay + dy * k, s.az + dz * k);
    shoutOrient(s.mesh, dx, dy, dz);
    const mid = Math.sin(u * Math.PI);
    const r = s.r0 + (s.r1 - s.r0) * (0.35 + 0.65 * mid);
    s.mesh.scale.setScalar(r);
    const fadeIn = Math.min(1, u / 0.1);
    const fadeOut = Math.min(1, (1 - u) / 0.2);
    const fade = s.opacity * fadeIn * fadeOut;
    (s.mesh.material as THREE.MeshBasicMaterial).opacity = fade;
    const gi = this.rings.indexOf(s.mesh);
    const glow = this.glows[gi]!;
    glow.position.copy(s.mesh.position);
    glow.quaternion.copy(s.mesh.quaternion);
    glow.scale.setScalar(r * 1.08);
    (glow.material as THREE.MeshBasicMaterial).opacity = fade * 0.4;
    glow.visible = fade > 0.02;
  }

  private take() {
    const m = this.rings[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.rings.length;
    for (let i = this.live.length - 1; i >= 0; i--) {
      if (this.live[i]!.mesh === m) this.live.splice(i, 1);
    }
    return m;
  }
}

const _anchor = new THREE.Vector3();

/** 骨骼世界坐标；没有骨就用角色原点 + 高度。 */
export function figureAnchor(fig: HumanoidFigure, names: string[], fallbackY: number, out = _anchor) {
  fig.group.updateWorldMatrix(true, true);
  const bone = findBoneAny(fig.group, names);
  if (bone) {
    bone.getWorldPosition(out);
    return out;
  }
  const p = fig.group.position;
  return out.set(p.x, fallbackY, p.z);
}

export function figureHand(fig: HumanoidFigure, out?: THREE.Vector3) {
  return figureAnchor(fig, BONE_HAND, 0.95, out);
}

const _handL = new THREE.Vector3();

/** 左手；没有左骨时按角色局部 X 镜像右手。 */
export function figureHandL(fig: HumanoidFigure, out?: THREE.Vector3) {
  const dest = out ?? _handL;
  fig.group.updateWorldMatrix(true, true);
  const bone = findBoneAny(fig.group, BONE_HAND_L);
  if (bone) {
    bone.getWorldPosition(dest);
    return dest;
  }
  figureHand(fig, dest);
  fig.group.worldToLocal(dest);
  dest.x *= -1;
  fig.group.localToWorld(dest);
  return dest;
}

export function figureChest(fig: HumanoidFigure, out?: THREE.Vector3) {
  return figureAnchor(fig, BONE_BACK, SHOUT_Y, out);
}

export function figureNeck(fig: HumanoidFigure, out?: THREE.Vector3) {
  const p = figureAnchor(fig, BONE_NECK, 1.32, out);
  const neck = findBoneAny(fig.group, ['Neck', 'mixamorigNeck', 'neck']);
  if (!neck) p.y -= 0.14;
  return p;
}

type GlowShell = { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial };

function glowShells(fig: HumanoidFigure): GlowShell[] {
  let shells = fig.group.userData.skillGlowShells as GlowShell[] | undefined;
  if (shells) return shells;
  shells = [];
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff5050,
    transparent: true,
    opacity: 0.55,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  fig.group.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (mesh.userData.skillGlowShell) return;
    let shell: THREE.Mesh;
    if (mesh.isSkinnedMesh) {
      const sk = new THREE.SkinnedMesh(mesh.geometry, mat);
      sk.bind(mesh.skeleton, mesh.bindMatrix);
      shell = sk;
    } else {
      shell = new THREE.Mesh(mesh.geometry, mat);
    }
    shell.userData.skillGlowShell = true;
    shell.scale.setScalar(1.08);
    shell.frustumCulled = false;
    shell.castShadow = false;
    shell.visible = false;
    mesh.add(shell);
    shells!.push({ mesh: shell, mat });
  });
  fig.group.userData.skillGlowShells = shells;
  fig.group.userData.skillGlowMat = mat;
  return shells;
}

/** 整身外发光：被锁链栓住的玩家用。 */
export function setFigureGlow(fig: HumanoidFigure, on: boolean, color = 0xff5050, opacity = 0.55) {
  const shells = glowShells(fig);
  const mat = (fig.group.userData.skillGlowMat as THREE.MeshBasicMaterial | undefined) ?? shells[0]?.mat;
  if (mat) {
    mat.color.setHex(color);
    mat.opacity = Math.min(1, 0.28 + opacity * 0.85);
  }
  for (const s of shells) s.mesh.visible = on;
  const emit = on ? Math.min(1.8, 0.45 + opacity * 1.5) : 0;
  for (const m of fig.ghostMats) {
    m.emissive.setHex(on ? color : 0);
    m.emissiveIntensity = emit;
  }
}
