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
  glowOpacity: 0.32,
  glowSize: 1.45,
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

function glowMat(color: number, opacity: number, side: THREE.Side = THREE.DoubleSide) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side,
  });
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
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.48, 10, 8), glowMat(c, op * 0.85, THREE.BackSide));
    shell.scale.setScalar(s);
    shell.userData.throwGlow = true;
    g.add(shell);
  } else if (style === 'ring') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 6, 22), glowMat(c, Math.min(1, op * 1.15)));
    ring.rotation.x = Math.PI / 2;
    ring.scale.setScalar(s);
    ring.userData.throwGlow = true;
    g.add(ring);
  } else if (style === 'core') {
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), glowMat(0xffffff, Math.min(1, op * 1.4)));
    core.userData.throwGlow = true;
    g.add(core);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), glowMat(c, op * 0.55, THREE.BackSide));
    shell.scale.setScalar(s);
    shell.userData.throwGlow = true;
    g.add(shell);
  } else {
    // flare：两片交叉薄片，比球壳更像能量闪
    const w = 0.95 * s;
    const h = 0.22 * s;
    const a = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glowMat(c, op));
    a.userData.throwGlow = true;
    g.add(a);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glowMat(c, op * 0.85));
    b.rotation.y = Math.PI / 2;
    b.userData.throwGlow = true;
    g.add(b);
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

function makeBoomerang() {
  const g = new THREE.Group();
  g.userData.skinScale = 1;
  const mat = lambert(0xff8a4a);
  const armA = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.14), mat);
  armA.position.set(0.16, 0, -0.12);
  armA.rotation.y = 0.55;
  armA.castShadow = true;
  g.add(armA);
  const armB = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.14), mat);
  armB.position.set(-0.16, 0, -0.12);
  armB.rotation.y = -0.55;
  armB.castShadow = true;
  g.add(armB);
  const joint = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.16), lambert(0xffc14d));
  joint.position.set(0, 0, 0.02);
  g.add(joint);
  return g;
}
