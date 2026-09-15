/** Kenney Survivors kit：编辑器和战场共用。glTF 图集 flipY=false。 */

import { AnimationClip, RepeatWrapping, type KeyframeTrack, type Object3D } from 'three';

export const KIT_URL = '/models/kit/character_kit.glb';

/** 包内蒙皮头发专用，不要用身体图集（UV 不是同一套；Repeat 平铺） */
export const KIT_HAIR_ALBEDO = '/models/kit/textures/hair_albedo.png';

export const KIT_HAIR_MAPS = [{ id: 'hair-default', label: '棕点', file: KIT_HAIR_ALBEDO }] as const;

export const KIT_SKIRT_ALBEDO = '/models/kit/textures/skirt_black.png';

export const KIT_SKIRT_MAPS = [
  { id: 'skirt-black', label: '黑', file: '/models/kit/textures/skirt_black.png' },
  { id: 'skirt-gray', label: '灰', file: '/models/kit/textures/skirt_gray.png' },
  { id: 'skirt-navy', label: '藏青', file: '/models/kit/textures/skirt_navy.png' },
  { id: 'skirt-plum', label: '紫', file: '/models/kit/textures/skirt_plum.png' },
  { id: 'skirt-teal', label: '青绿', file: '/models/kit/textures/skirt_teal.png' },
] as const;

export const KIT_HAIRS = [
  { id: 'hair_odango', label: '丸子' },
  { id: 'hair_tail', label: '马尾' },
  { id: 'hair_bob', label: '波波' },
] as const;

export type KitHairId = (typeof KIT_HAIRS)[number]['id'];

export const KIT_SKINS = [
  { id: 'survivor-male-b', label: 'survivorMaleB', file: '/models/kit/textures/survivorMaleB.png' },
  { id: 'survivor-female-a', label: 'survivorFemaleA', file: '/models/kit/textures/survivorFemaleA.png' },
  { id: 'lady-01', label: '灰衫裙', file: '/models/kit/textures/lady_01_grey_shirt_skirt.png' },
  { id: 'lady-02', label: '藏青西装裤', file: '/models/kit/textures/lady_02_navy_blazer_pants.png' },
  { id: 'kenney-female-a', label: '紫马甲裙', file: '/models/kit/textures/lady_03_purple_vest_skirt.png' },
  { id: 'lady-04', label: '蓝衫裤', file: '/models/kit/textures/lady_04_blue_shirt_pants.png' },
  { id: 'lady-05', label: '藏青西装裙', file: '/models/kit/textures/lady_05_navy_blazer_skirt.png' },
  { id: 'lady-06', label: '开衫裤', file: '/models/kit/textures/lady_06_cardigan_pants.png' },
  { id: 'lady-07', label: '青绿裙', file: '/models/kit/textures/lady_07_teal_dress.png' },
  { id: 'lady-08', label: '炭黑西装', file: '/models/kit/textures/lady_08_charcoal_suit.png' },
] as const;

/** glTF 图集：y=0 在 PNG 顶，与 skin 预览画布一致 */
export const KIT_UV_ISLANDS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: '头皮短发', x: 7 / 1024, y: 6 / 1024, w: 629 / 1024, h: 305 / 1024 },
  { name: '脸', x: 13 / 1024, y: 150 / 1024, w: 618 / 1024, h: 327 / 1024 },
  { name: '上衣', x: 30 / 1024, y: 498 / 1024, w: 580 / 1024, h: 508 / 1024 },
  { name: '手', x: 754 / 1024, y: 165 / 1024, w: 216 / 1024, h: 536 / 1024 },
  { name: '鞋', x: 649 / 1024, y: 55 / 1024, w: 314 / 1024, h: 438 / 1024 },
  { name: '裤', x: 634 / 1024, y: 785 / 1024, w: 374 / 1024, h: 223 / 1024 },
];

/** 头发贴图 Repeat 平铺，UV 会超出 0–1 */
export const KIT_HAIR_UV_ISLANDS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: '头发（Repeat 平铺）', x: 0, y: 0, w: 1, h: 1 },
];

/** 铅笔裙裙布：左右两幅，v≈0.20–0.80 */
export const KIT_SKIRT_UV_ISLANDS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: '左幅', x: 0.0, y: 0.2, w: 0.48, h: 0.58 },
  { name: '右幅', x: 0.5, y: 0.2, w: 0.45, h: 0.58 },
];

export function isKitHairId(id: string | null | undefined): id is KitHairId {
  return KIT_HAIRS.some((h) => h.id === id);
}

export function isKitSkinId(id: string) {
  return KIT_SKINS.some((s) => s.id === id);
}

export const KIT_SKIRTS = [
  { id: 'skirt_pencil', label: '铅笔裙' },
] as const;

export type KitSkirtId = (typeof KIT_SKIRTS)[number]['id'];

const KIT_SKIRT_IDS = ['skirt_pencil', 'skirt_aline'] as const;

function kitSearchRoot(from: any) {
  let o = from;
  while (o?.parent) o = o.parent;
  return o ?? from;
}

type SkirtBand = { y0: number; y1: number; mid: number; fat: number; thin: number; r0: number };

function bodySkirtBands(body: any): SkirtBand[] | null {
  const geo = body?.geometry;
  if (!geo) return null;
  if (geo.userData.skirtBandsV3) return geo.userData.skirtBandsV3 as SkirtBand[];
  const dict = body.morphTargetDictionary as Record<string, number> | undefined;
  const pos = geo.attributes?.position?.array as Float32Array | undefined;
  const morphs = geo.morphAttributes?.position as { array: Float32Array }[] | undefined;
  if (!dict || !pos || !morphs) return null;
  const fatArr = dict.fat != null ? morphs[dict.fat]?.array : undefined;
  const thinArr = dict.thin != null ? morphs[dict.thin]?.array : undefined;
  if (!fatArr || !thinArr) return null;

  const yMin = 0.38;
  const yMax = 0.76;
  const nBands = 8;
  const bands: SkirtBand[] = [];
  for (let b = 0; b < nBands; b++) {
    const y0 = yMin + ((yMax - yMin) * b) / nBands;
    const y1 = yMin + ((yMax - yMin) * (b + 1)) / nBands;
    const fatR: number[] = [];
    const thinR: number[] = [];
    const restR: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      const y = pos[i + 1];
      if (y < y0 || y > y1) continue;
      const r0 = Math.hypot(pos[i], pos[i + 2]);
      if (r0 < 0.07 || r0 > 0.32) continue;
      restR.push(r0);
      fatR.push(Math.hypot(pos[i] + fatArr[i], pos[i + 2] + fatArr[i + 2]) / r0);
      thinR.push(Math.hypot(pos[i] + thinArr[i], pos[i + 2] + thinArr[i + 2]) / r0);
    }
    fatR.sort((a, c) => a - c);
    thinR.sort((a, c) => a - c);
    restR.sort((a, c) => a - c);
    const med = (arr: number[], fallback: number) => (arr.length ? arr[Math.floor(arr.length / 2)] : fallback);
    bands.push({
      y0,
      y1,
      mid: (y0 + y1) / 2,
      fat: med(fatR, 1),
      thin: med(thinR, 1),
      r0: med(restR, 0.13),
    });
  }
  geo.userData.skirtBandsV3 = bands;
  return bands;
}

function skirtBandAtY(bands: SkirtBand[] | null, y: number) {
  if (!bands?.length) return null;
  let lo = bands[0];
  let hi = bands[bands.length - 1];
  for (let i = 0; i < bands.length - 1; i++) {
    if (y >= bands[i].mid && y <= bands[i + 1].mid) {
      lo = bands[i];
      hi = bands[i + 1];
      break;
    }
  }
  if (y <= bands[0].mid) lo = hi = bands[0];
  else if (y >= bands[bands.length - 1].mid) lo = hi = bands[bands.length - 1];
  const d = hi.mid - lo.mid;
  const u = d < 1e-6 ? 0 : Math.max(0, Math.min(1, (y - lo.mid) / d));
  return {
    fat: lo.fat + (hi.fat - lo.fat) * u,
    thin: lo.thin + (hi.thin - lo.thin) * u,
    r0: lo.r0 + (hi.r0 - lo.r0) * u,
  };
}

/** 滑条 -1 瘦 … 0 … +1 胖。裙子没有 morph，按身体同一高度的髋围跟上。 */
export function setBodyMorph(body: any, t: number) {
  const dict = body?.morphTargetDictionary as Record<string, number> | undefined;
  const inf = body?.morphTargetInfluences as number[] | undefined;
  const v = Math.max(-1, Math.min(1, t));
  if (dict && inf) {
    const fat = dict.fat;
    const thin = dict.thin;
    if (fat != null) inf[fat] = Math.max(0, v);
    if (thin != null) inf[thin] = Math.max(0, -v);
  }
  setKitSkirtMorph(kitSearchRoot(body), v, body);
}

/**
 * 裙子网格没有 fat/thin。按 characterMedium 同高度中位径向变化缩放，贴着肚皮走，不额外放余量。
 */
export function setKitSkirtMorph(root: any, t: number, body?: any) {
  const v = Math.max(-1, Math.min(1, t));
  const src = body?.isSkinnedMesh ? body : root?.getObjectByName?.('characterMedium');
  const bands = bodySkirtBands(src);
  for (const id of KIT_SKIRT_IDS) {
    const mesh = root?.getObjectByName?.(id);
    const geo = mesh?.geometry;
    if (!mesh || !geo?.attributes?.position) continue;
    if (mesh.scale) mesh.scale.set(1, 1, 1);
    if (!mesh.userData.skirtMorphOwned) {
      mesh.geometry = geo.clone();
      mesh.userData.skirtMorphOwned = true;
    }
    const g = mesh.geometry;
    const attr = g.attributes.position;
    if (!g.userData.skirtRest) {
      g.userData.skirtRest = (attr.array as Float32Array).slice();
    }
    const rest = g.userData.skirtRest as Float32Array;
    const out = attr.array as Float32Array;
    for (let i = 0; i < rest.length; i += 3) {
      const x = rest[i];
      const y = rest[i + 1];
      const z = rest[i + 2];
      const r = Math.hypot(x, z);
      const band = skirtBandAtY(bands, y);
      let delta = 0;
      if (band) {
        const bodyS = v >= 0 ? 1 + v * (band.fat - 1) : 1 + v * (1 - band.thin);
        delta = band.r0 * (bodyS - 1);
      } else {
        const u = Math.max(0, Math.min(1, (y - 0.4) / 0.32));
        const amt = v >= 0 ? 0.22 + 0.42 * u : 0.06 + 0.28 * u;
        delta = 0.13 * v * amt;
      }
      const ns = r > 1e-5 ? (r + delta) / r : 1;
      out[i] = x * ns;
      out[i + 1] = y;
      out[i + 2] = z * ns;
    }
    attr.needsUpdate = true;
    g.computeVertexNormals();
  }
}

/**
 * 包进 character_kit.glb 时发型顶点被写进 Head 局部（单独 hairs/*.glb 才是角色空间）。
 * 蒙皮会再乘一次 Head 的 inverseBind，整段头发掉到胸口。加载后按 Head IBM 平移回去。
 */
export function fixKitHairBind(root: any) {
  const body = root?.getObjectByName?.('characterMedium');
  const skel = body?.skeleton;
  const bones = skel?.bones as { name: string }[] | undefined;
  const inverses = skel?.boneInverses as { elements: number[] }[] | undefined;
  if (!bones || !inverses) return;
  const hi = bones.findIndex((b) => b.name === 'Head');
  if (hi < 0 || !inverses[hi]) return;
  const e = inverses[hi].elements;
  const ox = -e[12];
  const oy = -e[13];
  const oz = -e[14];
  if (Math.abs(oy) < 0.05) return;
  for (const { id } of KIT_HAIRS) {
    const mesh = root?.getObjectByName?.(id);
    const geo = mesh?.geometry;
    const arr = geo?.attributes?.position?.array as Float32Array | undefined;
    if (!mesh || !geo || !arr || mesh.userData.hairBindFixed) continue;
    mesh.geometry = geo.clone();
    const pos = mesh.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] += ox;
      pos[i + 1] += oy;
      pos[i + 2] += oz;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox?.();
    mesh.userData.hairBindFixed = true;
  }
}

/** name 为 null 时三款头发全关，露出图集短发壳 */
export function setKitHair(root: any, name: KitHairId | null) {
  for (const { id } of KIT_HAIRS) {
    const obj = root?.getObjectByName?.(id);
    if (obj) obj.visible = obj.name === name;
  }
}

export function isKitSkirtId(id: string | null | undefined): id is KitSkirtId {
  return KIT_SKIRTS.some((s) => s.id === id);
}

/** name 为 null 时裙子全关，露出图集裤子 */
export function setKitSkirt(root: any, name: KitSkirtId | null) {
  for (const id of KIT_SKIRT_IDS) {
    const obj = root?.getObjectByName?.(id);
    if (obj) obj.visible = obj.name === name;
  }
}

export function applyKitAtlas(body: any, texture: any) {
  if (!texture) return;
  texture.flipY = false;
  texture.needsUpdate = true;
  const mats = Array.isArray(body?.material) ? body.material : [body?.material];
  for (const m of mats) {
    if (!m || !('map' in m)) continue;
    m.map = texture;
    if ('vertexColors' in m) m.vertexColors = false;
    m.needsUpdate = true;
  }
}

export function kitHairTextureFrom(root: any) {
  for (const { id } of KIT_HAIRS) {
    const mesh = root?.getObjectByName?.(id);
    const mat = mesh && (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material);
    if (mat?.map) return mat.map;
  }
  return null;
}

export function applyKitHairMap(mesh: any, texture: any) {
  if (!mesh || !texture) return;
  texture.flipY = false;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (!m || !('map' in m)) continue;
    m.map = texture;
    if ('vertexColors' in m) m.vertexColors = false;
    m.needsUpdate = true;
  }
}

export function applyKitHairMaps(root: any, texture: any) {
  for (const { id } of KIT_HAIRS) applyKitHairMap(root?.getObjectByName?.(id), texture);
}

export function applyKitSkirtMap(mesh: any, texture: any) {
  if (!mesh || !texture) return;
  texture.flipY = false;
  texture.needsUpdate = true;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (!m || !('map' in m)) continue;
    m.map = texture;
    if ('vertexColors' in m) m.vertexColors = false;
    m.needsUpdate = true;
  }
}

export function applyKitSkirtMaps(root: any, texture: any) {
  for (const id of KIT_SKIRT_IDS) applyKitSkirtMap(root?.getObjectByName?.(id), texture);
}

export function findKitBody(root: any) {
  const body = root?.getObjectByName?.('characterMedium');
  if (!body || !body.isSkinnedMesh) throw new Error('character_kit.glb 缺少名为 characterMedium 的 SkinnedMesh');
  return body;
}

export function remapAnimBoneName(name: string): string {
  return name.replace(/^mixamorig/, '').replace(/^Armature\|/, '');
}

function parseTrackBoneProp(trackName: string): { bone: string; prop: string } | null {
  const indexed = trackName.match(/\.bones\[([^\]]+)\]\.(.+)$/);
  if (indexed) return { bone: indexed[1], prop: indexed[2] };
  const dot = trackName.lastIndexOf('.');
  if (dot <= 0) return null;
  return { bone: trackName.slice(0, dot), prop: trackName.slice(dot + 1) };
}

/** Kenney FBX 接到 kit：只借变形骨 quaternion（丢掉厘米位移/缩放和 IK 辅助骨） */
export function isBodyDeformQuatTrack(trackName: string, boneExists: (name: string) => boolean) {
  const parsed = parseTrackBoneProp(trackName);
  if (!parsed) return false;
  const { bone, prop } = parsed;
  if (!boneExists(bone) || prop !== 'quaternion') return false;
  if (/Ctrl|IK|Roll|Heel|_end$/.test(bone)) return false;
  return /^(Hips|Spine|Chest|UpperChest|Neck|Head|LeftShoulder|RightShoulder|LeftArm|RightArm|LeftForeArm|RightForeArm|LeftHand|RightHand|LeftUpLeg|RightUpLeg|LeftLeg|RightLeg|LeftFoot|RightFoot|LeftToes|RightToes)/.test(
    bone
  );
}

/** 只抽 kit 上存在的变形骨旋转。 */
export function retargetBodyQuats(clip: AnimationClip, root: Object3D): AnimationClip {
  const names = new Set<string>();
  root.traverse((o) => names.add(o.name));
  const tracks: KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    const parsed = parseTrackBoneProp(t.name);
    if (!parsed) continue;
    const mapped = remapAnimBoneName(parsed.bone);
    const renamed = `${mapped}.${parsed.prop}`;
    if (!isBodyDeformQuatTrack(renamed, (n) => names.has(n))) continue;
    const copy = t.clone();
    copy.name = renamed;
    tracks.push(copy);
  }
  if (!tracks.length) return clip;
  return new AnimationClip(clip.name, clip.duration, tracks);
}
