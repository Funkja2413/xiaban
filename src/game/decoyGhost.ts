import * as THREE from 'three/webgpu';
import type { DecoyLevel, ThrowGlowStyle } from '../fx/catalog';
import { normalizeThrowGlowStyle } from '../fx/catalog';
import type { WeekdayId } from '../levels';
import type { HumanoidFigure, HumanoidKit } from './humanoid';
import { bakeFigureLocalSnapshot, clonePlayerFigure, setFigureGait } from './humanoid';
import { loadPropVisual } from './hair';
import { buildThrowGlow, clearThrowGlow, type ThrowLook } from './skillProjectiles';

export type DecoyLook = Pick<DecoyLevel, 'opacity' | 'color' | 'glowStyle' | 'glowColor' | 'glowOpacity' | 'glowSize'>;

/** ghost = 工位马甲（玩家定格）；scarecrow = 周四「我是NPC」 */
export type DecoySkin = 'ghost' | 'scarecrow';

export const DEFAULT_DECOY_LOOK: DecoyLook = {
  opacity: 0.48,
  color: 0xffffff,
  glowStyle: 'soft',
  glowColor: 0x57d98f,
  glowOpacity: 0.5,
  glowSize: 1.9,
};

/** 按关换皮：只有周四「我是NPC」用稻草人，其余工位马甲仍是玩家定格。 */
export function decoySkinOnDay(day: WeekdayId): DecoySkin {
  return day === 'thursday' ? 'scarecrow' : 'ghost';
}

/** Polyy.AI · 01_classic_burlap（LOD）· CC0（见 presets/SCARECROW_README.txt） */
const SCARECROW_GLB = '/models/colleagues/props/presets/prop-scarecrow.glb';
const SCARECROW_FBX = '/models/colleagues/props/presets/prop-scarecrow.fbx';
/** 站立高度约一人（包内模型约 1 unit 高，再略放大对齐人形） */
const SCARECROW_FIT = 1.72;

let scarecrowTemplate: THREE.Group | null = null;
let scarecrowLoad: Promise<void> | null = null;

/** 预载稻草人分身；缺文件时静默失败，施放时回退玩家定格。 */
export async function preloadDecoyScarecrow() {
  if (scarecrowTemplate || scarecrowLoad) return scarecrowLoad ?? Promise.resolve();
  scarecrowLoad = (async () => {
    for (const url of [SCARECROW_GLB, SCARECROW_FBX]) {
      try {
        scarecrowTemplate = await loadPropVisual(url, SCARECROW_FIT);
        return;
      } catch {
        /* try next */
      }
    }
    console.warn('[decoy] scarecrow model missing — put prop-scarecrow.glb next to SCARECROW_README.txt');
    scarecrowTemplate = null;
  })();
  return scarecrowLoad;
}

export function decoyScarecrowReady() {
  return !!scarecrowTemplate;
}

export function decoyLookOf(pack?: Partial<DecoyLevel> & { glow?: boolean } | null): DecoyLook {
  return {
    opacity: Math.min(1, Math.max(0.08, pack?.opacity ?? DEFAULT_DECOY_LOOK.opacity)),
    color: pack?.color ?? DEFAULT_DECOY_LOOK.color,
    glowStyle: normalizeThrowGlowStyle(pack?.glowStyle, pack?.glow) as ThrowGlowStyle,
    glowColor: pack?.glowColor ?? DEFAULT_DECOY_LOOK.glowColor,
    glowOpacity: Math.min(1, Math.max(0, pack?.glowOpacity ?? DEFAULT_DECOY_LOOK.glowOpacity)),
    glowSize: Math.max(0.8, pack?.glowSize ?? DEFAULT_DECOY_LOOK.glowSize),
  };
}

function glowLook(look: DecoyLook): ThrowLook {
  return {
    scale: 1,
    color: 0xffffff,
    glowStyle: look.glowStyle,
    glowColor: look.glowColor,
    glowOpacity: look.glowOpacity,
    glowSize: look.glowSize,
  };
}

function cloneVisual(src: THREE.Group): THREE.Group {
  const g = src.clone(true);
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => m.clone());
    else if (mesh.material) mesh.material = mesh.material.clone();
  });
  return g;
}

/**
 * 分身外观：
 * - ghost（工位马甲）：半透明玩家定格 + 可调光晕
 * - scarecrow（我是NPC）：稻草人模型；缺文件时回退 ghost / 纸板
 */
export function makeDecoy(
  fig: HumanoidFigure | null | undefined,
  look: DecoyLook = DEFAULT_DECOY_LOOK,
  skin: DecoySkin = 'ghost'
): THREE.Group {
  if (skin === 'scarecrow') {
    const scare = makeDecoyScarecrow(look);
    if (scare) return scare;
  }
  if (fig) return makeDecoyGhost(fig, look);
  return makeDecoyFallback(look);
}

/**
 * 假人下班用的可跑动分身：按当前玩家槽（男/女）克隆对应模型 + run 动画，半透明。
 * 不要 dispose 其 geometry（与 kit 模板共享）。
 * VFX 编辑器若只载入男玩家，预览分身也会是男模；战场上女玩家会索引 player-f 静帧/跑动。
 */
export function makeDecoyRunner(kit: HumanoidKit, look: DecoyLook = DEFAULT_DECOY_LOOK): HumanoidFigure {
  const fig = clonePlayerFigure(kit, kit.playerSlot);
  if (fig.playerHalo) {
    fig.group.remove(fig.playerHalo.group);
    fig.playerHalo = undefined;
  }
  applyDecoyLook(fig.group, look);
  // 立刻切到跑步权重，避免第一帧还是 idle
  if (fig.run && fig.idle) {
    fig.run.weight = 1;
    fig.idle.weight = 0;
    fig.run.timeScale = 1.15;
  }
  fig.mixer.update(0);
  return fig;
}

export function tickDecoyRunner(fig: HumanoidFigure, moving: boolean, dt: number) {
  setFigureGait(fig, moving, dt);
}

/** 释放跑动分身：只停动画、丢克隆材质，不动共享几何。 */
export function disposeDecoyRunner(fig: HumanoidFigure) {
  clearThrowGlow(fig.group);
  fig.mixer.stopAllAction();
  for (const m of fig.ghostMats) m.dispose();
}

/** 稻草人分身（仅周四「我是NPC」）。 */
export function makeDecoyScarecrow(look: DecoyLook = DEFAULT_DECOY_LOOK): THREE.Group | null {
  if (!scarecrowTemplate) return null;
  const g = new THREE.Group();
  g.name = 'decoyGhost';
  g.userData.decoyGhost = true;
  g.userData.decoyScarecrow = true;
  const body = cloneVisual(scarecrowTemplate);
  body.userData.decoyBody = true;
  g.add(body);
  applyDecoyLook(g, look);
  return g;
}

/** 把玩家当前姿态烘焙成透明分身（不含脚底光环）。男女各自用自己的玩家模型静帧。 */
export function makeDecoyGhost(fig: HumanoidFigure, look: DecoyLook = DEFAULT_DECOY_LOOK): THREE.Group {
  fig.group.updateMatrixWorld(true);
  const baked = bakeFigureLocalSnapshot(fig);
  const g = new THREE.Group();
  g.name = 'decoyGhost';
  g.userData.decoyGhost = true;
  g.scale.copy(fig.group.scale);
  g.add(baked);
  applyDecoyLook(g, look);
  return g;
}

/** 无玩家模型时的兜底纸板（编辑器启动瞬间等）。 */
export function makeDecoyFallback(look: DecoyLook = DEFAULT_DECOY_LOOK): THREE.Group {
  const g = new THREE.Group();
  g.name = 'decoyGhost';
  g.userData.decoyGhost = true;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.68, 1.46, 0.05),
    new THREE.MeshLambertMaterial({ color: 0xd9c9a3, transparent: true, opacity: look.opacity, depthWrite: false })
  );
  board.position.y = 0.75;
  board.userData.decoyBody = true;
  g.add(board);
  const shirt = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.68, 0.03),
    new THREE.MeshLambertMaterial({ color: 0x3b82f6, transparent: true, opacity: look.opacity, depthWrite: false })
  );
  shirt.position.set(0, 0.82, 0.035);
  shirt.userData.decoyBody = true;
  g.add(shirt);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xf0c8a0, transparent: true, opacity: look.opacity, depthWrite: false })
  );
  head.scale.z = 0.25;
  head.position.set(0, 1.34, 0.035);
  head.userData.decoyBody = true;
  g.add(head);
  applyDecoyLook(g, look);
  return g;
}

export function applyDecoyLook(root: THREE.Object3D, look: DecoyLook) {
  const tint = look.color;
  const mul = tint === 0xffffff;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.throwGlow) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const raw of mats) {
      const mat = raw as THREE.MeshPhongMaterial | THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;
      if (!mat || !('opacity' in mat)) continue;
      mat.transparent = true;
      mat.depthWrite = false;
      mat.opacity = look.opacity;
      if ('color' in mat && mat.color) {
        if (mesh.userData.baseColor == null) mesh.userData.baseColor = mat.color.getHex();
        const base = mesh.userData.baseColor as number;
        if (mul) mat.color.setHex(base);
        else mat.color.setHex(mixHex(base, tint, 0.55));
      }
    }
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });

  clearThrowGlow(root);
  const glow = buildThrowGlow(look.glowStyle, glowLook(look));
  if (glow) {
    glow.position.y = 0.85;
    root.add(glow);
  }
}

export function disposeDecoyGhost(root: THREE.Object3D) {
  clearThrowGlow(root);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
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
