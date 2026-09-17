import * as THREE from 'three/webgpu';
import type { KeyboardLevel, ThrowGlowStyle } from '../fx/catalog';
import { normalizeThrowGlowStyle } from '../fx/catalog';
import type { WeekdayId } from '../levels';

/** keyboard 技能族按关换皮；战斗数值仍共用。 */
export type ThrowSkin = 'mouse' | 'keyboard' | 'laptop' | 'boomerang';

export type ThrowLook = Pick<KeyboardLevel, 'scale' | 'color' | 'glowStyle' | 'glowColor' | 'glowOpacity' | 'glowSize'>;

export const THROW_SKIN_BY_DAY: Record<WeekdayId, ThrowSkin> = {
  monday: 'mouse',
  tuesday: 'mouse',
  wednesday: 'keyboard',
  thursday: 'laptop',
  friday: 'boomerang',
};

export const DEFAULT_THROW_LOOK: ThrowLook = {
  scale: 1,
  color: 0xffffff,
  glowStyle: 'soft',
  glowColor: 0xffd257,
  glowOpacity: 0.55,
  glowSize: 1.55,
};

export function throwSkinOnDay(day: WeekdayId): ThrowSkin {
  return THROW_SKIN_BY_DAY[day] ?? 'keyboard';
}

export function throwLookOf(pack?: Partial<KeyboardLevel> & { glow?: boolean } | null): ThrowLook {
  return {
    scale: Math.max(0.35, pack?.scale ?? DEFAULT_THROW_LOOK.scale),
    color: pack?.color ?? DEFAULT_THROW_LOOK.color,
    glowStyle: normalizeThrowGlowStyle(pack?.glowStyle, pack?.glow),
    glowColor: pack?.glowColor ?? DEFAULT_THROW_LOOK.glowColor,
    glowOpacity: Math.min(1, Math.max(0, pack?.glowOpacity ?? DEFAULT_THROW_LOOK.glowOpacity)),
    glowSize: Math.max(0.8, pack?.glowSize ?? DEFAULT_THROW_LOOK.glowSize),
  };
}

function lambert(color: number) {
  return new THREE.MeshLambertMaterial({ color });
}

/** 软边光斑贴图（径向渐隐），全场共用，比硬壳 mesh 好看且便宜 */
function glowCanvas(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

let BLOB_TEX: THREE.CanvasTexture | null = null;
let RING_TEX: THREE.CanvasTexture | null = null;
let STREAK_TEX: THREE.CanvasTexture | null = null;

function blobTex() {
  if (BLOB_TEX) return BLOB_TEX;
  BLOB_TEX = glowCanvas(128, (ctx, s) => {
    const m = s / 2;
    const g = ctx.createRadialGradient(m, m, 0, m, m, m);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.72)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.06)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  return BLOB_TEX;
}

function ringTex() {
  if (RING_TEX) return RING_TEX;
  RING_TEX = glowCanvas(128, (ctx, s) => {
    const m = s / 2;
    const g = ctx.createRadialGradient(m, m, m * 0.28, m, m, m * 0.92);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.08)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.72, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  return RING_TEX;
}

function streakTex() {
  if (STREAK_TEX) return STREAK_TEX;
  STREAK_TEX = glowCanvas(128, (ctx, s) => {
    const m = s / 2;
    const g = ctx.createRadialGradient(m, m, 0, m, m, m);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    // 压成细长光带
    ctx.globalCompositeOperation = 'destination-in';
    const band = ctx.createLinearGradient(0, m, s, m);
    band.addColorStop(0, 'rgba(0,0,0,0)');
    band.addColorStop(0.2, 'rgba(0,0,0,0.55)');
    band.addColorStop(0.5, 'rgba(0,0,0,1)');
    band.addColorStop(0.8, 'rgba(0,0,0,0.55)');
    band.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, s, s);
    const v = ctx.createLinearGradient(m, 0, m, s);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.35, 'rgba(0,0,0,1)');
    v.addColorStop(0.65, 'rgba(0,0,0,1)');
    v.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, s, s);
  });
  return STREAK_TEX;
}

function spriteMat(map: THREE.Texture, color: number, opacity: number) {
  return new THREE.SpriteMaterial({
    map,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

function meshGlowMat(map: THREE.Texture, color: number, opacity: number) {
  return new THREE.MeshBasicMaterial({
    map,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

function markGlow(o: THREE.Object3D) {
  o.userData.throwGlow = true;
  o.frustumCulled = false;
  o.renderOrder = 6;
  o.castShadow = false;
  return o;
}

/** 可飞出去的投掷物；按关换外形，再套本级样子。 */
export function makeThrowProjectile(skin: ThrowSkin, look: ThrowLook = DEFAULT_THROW_LOOK): THREE.Group {
  const g =
    skin === 'mouse' ? makeMouse() : skin === 'laptop' ? makeLaptop() : skin === 'boomerang' ? makeBoomerang() : makeKeyboard();
  applyThrowLook(g, look);
  return g;
}

function clearThrowGlow(root: THREE.Object3D) {
  const old = root.getObjectByName('throwGlow');
  if (!old) return;
  root.remove(old);
  old.traverse((o) => {
    const sprite = o as THREE.Sprite;
    if (sprite.isSprite) {
      sprite.material.dispose();
      return;
    }
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}

function buildThrowGlow(style: ThrowGlowStyle, look: ThrowLook): THREE.Object3D | null {
  if (style === 'off') return null;
  const g = new THREE.Group();
  g.name = 'throwGlow';
  g.userData.throwGlow = true;
  g.userData.throwGlowStyle = style;
  g.renderOrder = 5;
  g.frustumCulled = false;

  const c = look.glowColor;
  const op = look.glowOpacity;
  const s = look.glowSize;

  if (style === 'soft') {
    const outer = markGlow(new THREE.Sprite(spriteMat(blobTex(), c, op * 0.75)));
    outer.scale.setScalar(1.15 * s);
    g.add(outer);
    const inner = markGlow(new THREE.Sprite(spriteMat(blobTex(), 0xffffff, Math.min(1, op * 0.55))));
    inner.scale.setScalar(0.42 * s);
    g.add(inner);
  } else if (style === 'ring') {
    const disc = markGlow(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), meshGlowMat(ringTex(), c, Math.min(1, op * 1.05))));
    disc.rotation.x = -Math.PI / 2;
    disc.scale.setScalar(1.35 * s);
    g.add(disc);
    const soft = markGlow(new THREE.Sprite(spriteMat(blobTex(), c, op * 0.28)));
    soft.scale.setScalar(0.7 * s);
    g.add(soft);
  } else if (style === 'core') {
    const halo = markGlow(new THREE.Sprite(spriteMat(blobTex(), c, op * 0.7)));
    halo.scale.setScalar(1.25 * s);
    g.add(halo);
    const core = markGlow(new THREE.Sprite(spriteMat(blobTex(), 0xffffff, Math.min(1, op * 1.15))));
    core.scale.setScalar(0.32 * s);
    g.add(core);
  } else {
    // flare：软边光带交叉，仍跟物体转
    const w = 1.35 * s;
    const h = 0.55 * s;
    const a = markGlow(new THREE.Mesh(new THREE.PlaneGeometry(w, h), meshGlowMat(streakTex(), c, op)));
    g.add(a);
    const b = markGlow(new THREE.Mesh(new THREE.PlaneGeometry(w, h), meshGlowMat(streakTex(), c, op * 0.85)));
    b.rotation.y = Math.PI / 2;
    g.add(b);
    const nub = markGlow(new THREE.Sprite(spriteMat(blobTex(), 0xffffff, Math.min(1, op * 0.5))));
    nub.scale.setScalar(0.28 * s);
    g.add(nub);
  }

  return g;
}

/** 改已有飞出物的样子（编辑器拖滑条 / 换 LV 时可复用）。 */
export function applyThrowLook(root: THREE.Object3D, look: ThrowLook) {
  const tint = look.color;
  const mul = tint === 0xffffff;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.throwGlow) return;
    const mat = mesh.material as THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;
    if (!mat || !('color' in mat)) return;
    if (mesh.userData.baseColor == null) {
      mesh.userData.baseColor = mat.color.getHex();
    }
    const base = mesh.userData.baseColor as number;
    if (mul) mat.color.setHex(base);
    else mat.color.setHex(mixHex(base, tint, 0.72));
  });

  // 光晕 mesh 很少，换样式/参数时整组重建最省事
  clearThrowGlow(root);
  const glow = buildThrowGlow(look.glowStyle, look);
  if (glow) root.add(glow);

  const skinScale = (root.userData.skinScale as number) || 1;
  root.scale.setScalar(skinScale * look.scale);
}

function mixHex(a: number, b: number, t: number) {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

function makeKeyboard() {
  const g = new THREE.Group();
  g.userData.skinScale = 1;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.07, 0.3), lambert(0xe8e8ec));
  body.castShadow = true;
  g.add(body);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 8; c++) {
      const key = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.05), lambert(0xc8ccd4));
      key.position.set(-0.28 + c * 0.08, 0.045, -0.08 + r * 0.08);
      g.add(key);
    }
  }
  return g;
}

function makeMouse() {
  const g = new THREE.Group();
  g.userData.skinScale = 1.85;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.42), lambert(0x3a4048));
  body.scale.set(1, 0.85, 1);
  body.castShadow = true;
  g.add(body);
  const hump = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), lambert(0x4a5160));
  hump.scale.set(1.05, 0.55, 1.35);
  hump.position.set(0, 0.06, -0.02);
  g.add(hump);
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 10), lambert(0xc8ccd4));
  wheel.rotation.z = Math.PI / 2;
  wheel.position.set(0, 0.1, -0.04);
  g.add(wheel);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6), lambert(0x1a1c20));
  cord.rotation.x = Math.PI / 2;
  cord.position.set(0, 0.02, 0.28);
  g.add(cord);
  return g;
}

function makeLaptop() {
  const g = new THREE.Group();
  g.userData.skinScale = 1;
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.42), lambert(0x2a2e34));
  base.castShadow = true;
  g.add(base);
  const keys = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.28), lambert(0x1a1c20));
  keys.position.set(0, 0.035, 0.02);
  g.add(keys);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.4, 0.04), lambert(0x343a44));
  lid.position.set(0, 0.22, -0.2);
  lid.rotation.x = -0.55;
  g.add(lid);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.32, 0.01), new THREE.MeshBasicMaterial({ color: 0x6eb6ff }));
  screen.position.set(0, 0.23, -0.175);
  screen.rotation.x = -0.55;
  g.add(screen);
  return g;
}

function addBox(
  parent: THREE.Group,
  mat: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number
) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** 块状字母：和办公低模一调，不引字体资源。 */
function makeLetterO(mat: THREE.Material) {
  const g = new THREE.Group();
  const t = 0.07;
  const d = 0.12;
  const w = 0.34;
  const h = 0.42;
  addBox(g, mat, w, t, d, 0, h / 2 - t / 2, 0);
  addBox(g, mat, w, t, d, 0, -h / 2 + t / 2, 0);
  addBox(g, mat, t, h - 2 * t, d, -w / 2 + t / 2, 0, 0);
  addBox(g, mat, t, h - 2 * t, d, w / 2 - t / 2, 0, 0);
  return g;
}

function makeLetterK(mat: THREE.Material) {
  const g = new THREE.Group();
  const t = 0.07;
  const d = 0.12;
  const h = 0.42;
  addBox(g, mat, t, h, d, -0.13, 0, 0);
  const up = addBox(g, mat, 0.24, t, d, 0.02, 0.09, 0);
  up.rotation.z = 0.58;
  const dn = addBox(g, mat, 0.24, t, d, 0.02, -0.09, 0);
  dn.rotation.z = -0.58;
  return g;
}

function makeLetterR(mat: THREE.Material) {
  const g = new THREE.Group();
  const t = 0.07;
  const d = 0.12;
  const h = 0.42;
  addBox(g, mat, t, h, d, -0.13, 0, 0);
  addBox(g, mat, 0.2, t, d, 0.01, 0.175, 0);
  addBox(g, mat, t, 0.15, d, 0.09, 0.105, 0);
  addBox(g, mat, 0.2, t, d, 0.01, 0.04, 0);
  const leg = addBox(g, mat, 0.22, t, d, 0.05, -0.11, 0);
  leg.rotation.z = -0.7;
  return g;
}

/** 周五 OKR回旋镖：O K R 三字排成可飞的道具。 */
function makeBoomerang() {
  const g = new THREE.Group();
  g.userData.skinScale = 1.05;
  const oMat = lambert(0xff8a4a);
  const kMat = lambert(0xffc14d);
  const rMat = lambert(0xff6b3d);
  const O = makeLetterO(oMat);
  O.position.set(-0.4, 0, 0);
  O.rotation.y = 0.28;
  const K = makeLetterK(kMat);
  K.position.set(0, 0, 0.02);
  const R = makeLetterR(rMat);
  R.position.set(0.4, 0, 0);
  R.rotation.y = -0.28;
  g.add(O, K, R);
  const bar = addBox(g, lambert(0xd45c2a), 0.98, 0.045, 0.05, 0, -0.015, -0.03);
  bar.castShadow = false;
  return g;
}
