import * as THREE from 'three/webgpu';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {
  BATTLE_SLOT_IDS,
  IDENTITY_TRANSFORM,
  assetUrl,
  bodyMorphForSlot,
  bodyScaleForSlot,
  kitHairForSlot,
  kitHairMapForSlot,
  kitSkirtForSlot,
  kitSkirtMapForSlot,
  catalogForPlayerSlot,
  loadCatalog,
  setPlayDayHint,
  propFitOf,
  propForSlot,
  skinForSlot,
  type AttachAnchor,
} from '../catalog';
import { PLAYER_SLOT_IDS, isPlayerSlotId, type PlayerSlotId } from '../roster';
import { PlayerHalo } from './look';
import {
  applyKitAtlas,
  applyKitHairMaps,
  applyKitSkirtMaps,
  findKitBody,
  KIT_HAIR_ALBEDO,
  KIT_SKIRT_ALBEDO,
  kitHairTextureFrom,
  fixKitHairBind,
  retargetBodyQuats,
  setBodyMorph,
  setKitHair,
  setKitSkirt,
  type KitHairId,
  type KitSkirtId,
} from '../kit';
import {
  BONE_BACK,
  BONE_HAND,
  BONE_HAND_L,
  BONE_HEAD,
  attachHairToHead,
  attachToBone,
  findBone,
  findBoneAny,
  loadHairVisual,
  loadPropVisual,
  makeSlotHair,
  type SlotHair,
} from './hair';

const HEIGHT = 1.72;

const WALK_FRAMES = 4;

export interface HumanoidKit {
  /** 已缩放到身高 1.72m、脚底贴地的蒙皮模板，供玩家 SkeletonUtils.clone */
  template: THREE.Object3D;
  /** idle 站姿（手臂放下），同事实例静止时用 */
  geometry: THREE.BufferGeometry;
  /** run 循环采样帧，同事实例走动时轮播 */
  walkGeos: THREE.BufferGeometry[];
  /** idle + run 采样帧，按 BATTLE_SLOT_IDS 分槽（含各自 morph） */
  slotGeos: THREE.BufferGeometry[][];
  maleMat: THREE.MeshPhongMaterial;
  femaleMat: THREE.MeshPhongMaterial;
  playerMat: THREE.MeshPhongMaterial;
  heavyMat: THREE.MeshPhongMaterial;
  interceptorMat: THREE.MeshPhongMaterial;
  /** idle + 各跑步帧的 Head / 右手 / 左手 / 后背位姿；缩放统一用 idle，与编辑器一致 */
  headLocals: THREE.Matrix4[];
  handLocals: THREE.Matrix4[];
  leftHandLocals: THREE.Matrix4[];
  backLocals: THREE.Matrix4[];
  /** 与 BATTLE_SLOT_IDS / poseSets 对齐 */
  slotHair: (SlotHair | null)[];
  slotHat: (SlotHair | null)[];
  slotHeld: (SlotHair | null)[];
  slotBack: (SlotHair | null)[];
  slotKitHair: (SlotHair | null)[];
  slotMorph: number[];
  slotScale: number[];
  slotKitHairId: (KitHairId | null)[];
  slotKitSkirtId: (KitSkirtId | null)[];
  /** idle + run 裙网格，与 slotGeos 同姿态；无裙则为 null */
  slotSkirtGeos: (THREE.BufferGeometry[] | null)[];
  slotSkirtMat: (THREE.MeshPhongMaterial | null)[];
  slotHairMap: (THREE.Texture | null)[];
  slotSkirtMap: (THREE.Texture | null)[];
  playerSlot: PlayerSlotId;
  playerLooks: Record<PlayerSlotId, PlayerLookPack>;
  playerHair: SlotHair | null;
  playerHat: SlotHair | null;
  playerHeld: SlotHair | null;
  playerBack: SlotHair | null;
  playerMorph: number;
  playerScale: number;
  playerKitHair: KitHairId | null;
  playerKitSkirt: KitSkirtId | null;
  playerHairMap: THREE.Texture | null;
  playerSkirtMap: THREE.Texture | null;
  clips: { idle?: THREE.AnimationClip; run?: THREE.AnimationClip };
}

export interface PlayerLookPack {
  mat: THREE.MeshPhongMaterial;
  morph: number;
  scale: number;
  kitHair: KitHairId | null;
  kitSkirt: KitSkirtId | null;
  hairMap: THREE.Texture | null;
  skirtMap: THREE.Texture | null;
  hair: SlotHair | null;
  hat: SlotHair | null;
  held: SlotHair | null;
  back: SlotHair | null;
}

/** Kenney 动画 FBX 的 animations[0] 经常是 1 帧 Targeting Pose，不能当循环用 */
function pickClip(anims: THREE.AnimationClip[] | undefined, prefer: string): THREE.AnimationClip | undefined {
  if (!anims?.length) return undefined;
  const key = prefer.toLowerCase();
  const named = anims.find((c) => c.duration > 0.2 && c.name.toLowerCase().includes(key));
  if (named) return named;
  return [...anims]
    .filter((c) => c.duration > 0.2 && !/targeting|pose/i.test(c.name))
    .sort((a, b) => b.duration - a.duration)[0];
}

function clipLooksAnimated(clip: THREE.AnimationClip | undefined) {
  if (!clip || clip.duration < 0.25) return false;
  return clip.tracks.some((tr) => {
    if (tr.times.length > 3) return true;
    const stride = tr.times.length ? Math.round(tr.values.length / tr.times.length) : 0;
    if (stride < 1 || tr.values.length < stride * 2) return false;
    for (let i = stride; i < tr.values.length; i++) if (Math.abs(tr.values[i] - tr.values[i - stride]) > 1e-4) return true;
    return false;
  });
}

function toPhong(map: THREE.Texture, tint = 0xffffff) {
  return new THREE.MeshPhongMaterial({
    map,
    color: tint,
    shininess: 18,
    specular: 0x333333,
  });
}

function toKitHairPhong(map: THREE.Texture) {
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  map.needsUpdate = true;
  return new THREE.MeshPhongMaterial({
    map,
    color: 0xffffff,
    shininess: 14,
    specular: 0x2a2a2a,
    side: THREE.DoubleSide,
    vertexColors: false,
  });
}

function toKitSkirtPhong(map: THREE.Texture) {
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  map.needsUpdate = true;
  return new THREE.MeshPhongMaterial({
    map,
    color: 0xffffff,
    shininess: 12,
    specular: 0x222222,
    side: THREE.DoubleSide,
    vertexColors: false,
  });
}

function normalizeToGround(root: THREE.Object3D) {
  const body = findKitBody(root);
  root.updateMatrixWorld(true);
  body.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(body);
  const size = box.getSize(new THREE.Vector3());
  if (size.y < 1e-4) return;
  root.scale.multiplyScalar(HEIGHT / size.y);
  root.updateMatrixWorld(true);
  box.setFromObject(body);
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
}

const _headPos = new THREE.Vector3();
const _headQuat = new THREE.Quaternion();
const _headScl = new THREE.Vector3();

function captureBoneLocal(
  bone: THREE.Object3D | null,
  snapY: number,
  fallback: [number, number, number]
): THREE.Matrix4 {
  if (!bone) return new THREE.Matrix4().setPosition(...fallback);
  const m = bone.matrixWorld.clone();
  if (snapY) m.premultiply(new THREE.Matrix4().makeTranslation(0, -snapY, 0));
  return m;
}

function mirrorHandX(src: THREE.Matrix4): THREE.Matrix4 {
  src.decompose(_headPos, _headQuat, _headScl);
  _headPos.x *= -1;
  return new THREE.Matrix4().compose(_headPos, _headQuat, _headScl);
}

function captureLeftHand(bone: THREE.Object3D | null, snapY: number, right: THREE.Matrix4): THREE.Matrix4 {
  if (bone) return captureBoneLocal(bone, snapY, [-0.22, 0.95, 0.12]);
  return mirrorHandX(right);
}

/** 走路帧不要用动画里晃动的骨缩放，统一成编辑器 idle 时的 Head 缩放 */
function lockHeadScale(locals: THREE.Matrix4[], restScale: THREE.Vector3) {
  for (const m of locals) {
    m.decompose(_headPos, _headQuat, _headScl);
    m.compose(_headPos, _headQuat, restScale);
  }
}

function bakeSkinned(mesh: THREE.SkinnedMesh, snapGround = true): { geometry: THREE.BufferGeometry; snapY: number } {
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const geo = mesh.geometry.clone();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const skinIndex = geo.attributes.skinIndex as THREE.BufferAttribute;
  const skinWeight = geo.attributes.skinWeight as THREE.BufferAttribute;
  const bindMatrix = mesh.bindMatrix;
  const bindMatrixInverse = mesh.bindMatrixInverse;
  const boneMatrices = mesh.skeleton.boneMatrices;
  if (!boneMatrices) throw new Error('skeleton boneMatrices missing');
  const vertex = new THREE.Vector3();
  const skinVertex = new THREE.Vector4();
  const acc = new THREE.Vector4();
  const tmp = new THREE.Vector4();
  const boneMat = new THREE.Matrix4();
  const world = mesh.matrixWorld;
  const morphs = geo.morphAttributes.position;
  const inf = mesh.morphTargetInfluences;

  for (let i = 0; i < pos.count; i++) {
    vertex.fromBufferAttribute(pos, i);
    if (morphs && inf) {
      for (let m = 0; m < morphs.length; m++) {
        const w = inf[m];
        if (!w) continue;
        vertex.x += morphs[m].getX(i) * w;
        vertex.y += morphs[m].getY(i) * w;
        vertex.z += morphs[m].getZ(i) * w;
      }
    }
    skinVertex.set(vertex.x, vertex.y, vertex.z, 1).applyMatrix4(bindMatrix);
    acc.set(0, 0, 0, 0);
    const idx = [skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i)];
    const wgt = [skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i)];
    for (let j = 0; j < 4; j++) {
      if (wgt[j] === 0) continue;
      boneMat.fromArray(boneMatrices, idx[j] * 16);
      tmp.copy(skinVertex).applyMatrix4(boneMat).multiplyScalar(wgt[j]);
      acc.add(tmp);
    }
    acc.applyMatrix4(bindMatrixInverse);
    acc.applyMatrix4(world);
    pos.setXYZ(i, acc.x, acc.y, acc.z);
  }
  geo.deleteAttribute('skinIndex');
  geo.deleteAttribute('skinWeight');
  geo.morphAttributes = {};
  geo.morphTargetsRelative = false;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  let snapY = 0;
  if (snapGround) {
    snapY = geo.boundingBox!.min.y;
    geo.translate(0, -snapY, 0);
    geo.computeBoundingBox();
  }
  geo.computeBoundingSphere();
  return { geometry: geo, snapY };
}

function poseMixer(mixer: THREE.AnimationMixer, mesh: THREE.SkinnedMesh, root: THREE.Object3D, clip: THREE.AnimationClip, t: number) {
  mixer.stopAllAction();
  const act = mixer.clipAction(clip);
  act.play();
  mixer.setTime(t);
  root.updateMatrixWorld(true);
  mesh.skeleton.update();
  root.traverse((o) => {
    const sk = o as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh && sk.skeleton !== mesh.skeleton) sk.skeleton.update();
  });
}

function snapWalkGeos(walkGeos: THREE.BufferGeometry[], ...locals: THREE.Matrix4[][]) {
  let minY = Infinity;
  for (const g of walkGeos) minY = Math.min(minY, g.boundingBox!.min.y);
  for (const g of walkGeos) {
    g.translate(0, -minY, 0);
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  const lift = new THREE.Matrix4().makeTranslation(0, -minY, 0);
  for (const list of locals) for (const h of list) h.premultiply(lift);
  return minY;
}

function bakeKitHairToHead(
  root: THREE.Object3D,
  hairId: KitHairId,
  head: THREE.Object3D | null,
  hairMat: THREE.MeshPhongMaterial
): SlotHair | null {
  const mesh = root.getObjectByName(hairId) as THREE.SkinnedMesh | undefined;
  if (!mesh?.isSkinnedMesh || !head) return null;
  const was = mesh.visible;
  mesh.visible = true;
  const { geometry } = bakeSkinned(mesh, false);
  mesh.visible = was;
  head.updateMatrixWorld(true);
  geometry.applyMatrix4(new THREE.Matrix4().copy(head.matrixWorld).invert());
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return {
    visual: new THREE.Group(),
    geometry,
    material: hairMat.clone(),
    transform: { ...IDENTITY_TRANSFORM },
    preRotation: [0, 0, 0],
    attach: new THREE.Matrix4(),
  };
}

function bakeKitSkirtFrame(root: THREE.Object3D, skirtId: KitSkirtId, snapY: number): THREE.BufferGeometry | null {
  const mesh = root.getObjectByName(skirtId) as THREE.SkinnedMesh | undefined;
  if (!mesh?.isSkinnedMesh) return null;
  const was = mesh.visible;
  mesh.visible = true;
  const { geometry } = bakeSkinned(mesh, false);
  mesh.visible = was;
  if (snapY) {
    geometry.translate(0, -snapY, 0);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return geometry;
}

/** Kenney Survivors kit + FBX idle/run 重定向 */
export async function loadHumanoidKit(playerSlot: PlayerSlotId = 'player', day?: string | null): Promise<HumanoidKit> {
  if (day) setPlayDayHint(day);
  const gltfLoader = new GLTFLoader();
  const fbxLoader = new FBXLoader();
  const texLoader = new THREE.TextureLoader();

  const catalog = await loadCatalog();
  const activePlayer = isPlayerSlotId(playerSlot) ? playerSlot : 'player';
  const playerCat = (id: PlayerSlotId) => catalogForPlayerSlot(catalog, id);
  const maleSkin = skinForSlot(catalog, 'colleague-a-m');
  const femaleSkin = skinForSlot(catalog, 'colleague-a-f');
  const playerSkin = skinForSlot(playerCat('player'), 'player');
  const playerFSkin = skinForSlot(playerCat('player-f'), 'player-f');
  const heavySkin = skinForSlot(catalog, 'heavy');
  const interceptorSkin = skinForSlot(catalog, 'interceptor');
  const slotIds = [...BATTLE_SLOT_IDS];

  const capMap = async (map: THREE.Texture, max = 1024) => {
    const img = map.image as ImageBitmap | HTMLImageElement | undefined;
    const w = img && 'width' in img ? img.width : 0;
    const h = img && 'height' in img ? img.height : 0;
    if (img && (w > max || h > max) && typeof createImageBitmap === 'function') {
      try {
        const scale = max / Math.max(w, h);
        const bitmap = await createImageBitmap(img, {
          resizeWidth: Math.max(1, Math.round(w * scale)),
          resizeHeight: Math.max(1, Math.round(h * scale)),
          resizeQuality: 'high',
        });
        if ('close' in img && typeof img.close === 'function') img.close();
        map.image = bitmap;
      } catch {
        /* 缩放失败就用原图，避免 canvas 贴图在 WebGPU 上变成白模 */
      }
    }
    map.generateMipmaps = true;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.needsUpdate = true;
    return map;
  };

  const loadMap = async (skin: { file: string; flipY: boolean }) => {
    try {
      const map = await texLoader.loadAsync(assetUrl(skin.file));
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = false;
      return capMap(map);
    } catch (err) {
      console.warn('皮肤未加载', skin.file, err);
      const map = await texLoader.loadAsync(assetUrl('/models/kit/textures/survivorMaleB.png'));
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = false;
      return capMap(map);
    }
  };

  const loadKitMap = async (file: string, repeat: boolean, fallback = file) => {
    try {
      const map = await texLoader.loadAsync(assetUrl(file));
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = false;
      if (repeat) {
        map.wrapS = THREE.RepeatWrapping;
        map.wrapT = THREE.RepeatWrapping;
      }
      return capMap(map);
    } catch (err) {
      if (fallback !== file) return loadKitMap(fallback, repeat, fallback);
      console.warn('配件贴图未加载', file, err);
      throw err;
    }
  };

  const hairFileOf = (id: string) => kitHairMapForSlot(catalogForPlayerSlot(catalog, id), id) || KIT_HAIR_ALBEDO;
  const skirtFileOf = (id: string) => kitSkirtMapForSlot(catalogForPlayerSlot(catalog, id), id) || KIT_SKIRT_ALBEDO;
  const kitLookIds = [...PLAYER_SLOT_IDS, ...slotIds];
  const hairMapFiles = [...new Set(kitLookIds.map(hairFileOf))];
  const skirtMapFiles = [...new Set(kitLookIds.map(skirtFileOf))];

  const [gltf, maleMap, femaleMap, playerMap, playerFMap, heavyMap, interceptorMap, idleRoot, runRoot, hairTexList, skirtTexList] =
    await Promise.all([
      gltfLoader.loadAsync(assetUrl(catalog.base.mesh)),
      loadMap(maleSkin),
      loadMap(femaleSkin),
      loadMap(playerSkin),
      loadMap(playerFSkin),
      loadMap(heavySkin),
      loadMap(interceptorSkin),
      fbxLoader.loadAsync(assetUrl(catalog.base.idle)).catch(() => null),
      fbxLoader.loadAsync(assetUrl(catalog.base.run)).catch(() => null),
      Promise.all(hairMapFiles.map((f) => loadKitMap(f, true, KIT_HAIR_ALBEDO))),
      Promise.all(skirtMapFiles.map((f) => loadKitMap(f, false, KIT_SKIRT_ALBEDO))),
    ]);

  const hairMaps = new Map(hairMapFiles.map((f, i) => [f, hairTexList[i]!]));
  const skirtMaps = new Map(skirtMapFiles.map((f, i) => [f, skirtTexList[i]!]));

  const root = gltf.scene;
  const maleMat = toPhong(maleMap);
  const femaleMat = toPhong(femaleMap);
  const playerMatM = toPhong(playerMap);
  const playerMatF = toPhong(playerFMap);
  const playerMats: Record<PlayerSlotId, THREE.MeshPhongMaterial> = { player: playerMatM, 'player-f': playerMatF };
  const playerMat = playerMats[activePlayer];
  const heavyMat = toPhong(heavyMap);
  const interceptorMat = toPhong(interceptorMap);
  const skinned = findKitBody(root);
  skinned.castShadow = true;
  skinned.receiveShadow = true;
  skinned.material = maleMat;
  applyKitAtlas(skinned, maleMap);
  setKitHair(root, null);
  setKitSkirt(root, null);
  fixKitHairBind(root);
  setBodyMorph(skinned, 0);

  const defaultHairMap = hairMaps.get(KIT_HAIR_ALBEDO) ?? (kitHairTextureFrom(root) as THREE.Texture | null);
  const defaultSkirtMap = skirtMaps.get(KIT_SKIRT_ALBEDO) ?? null;
  const kitHairMat = toKitHairPhong(defaultHairMap ?? (await loadKitMap(KIT_HAIR_ALBEDO, true)));
  if (defaultHairMap) applyKitHairMaps(root, defaultHairMap);
  if (defaultSkirtMap) applyKitSkirtMaps(root, defaultSkirtMap);

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    }
  });

  normalizeToGround(root);

  const mixer = new THREE.AnimationMixer(root);
  const fbxIdle = pickClip(idleRoot?.animations, 'idle');
  const fbxRun = pickClip(runRoot?.animations, 'run');
  const kitIdle = pickClip(gltf.animations, 'idle');
  const kitRun = pickClip(gltf.animations, 'run');
  const idleSrc = clipLooksAnimated(fbxIdle) && fbxIdle ? retargetBodyQuats(fbxIdle, root) : kitIdle;
  const runSrc = clipLooksAnimated(fbxRun) && fbxRun ? retargetBodyQuats(fbxRun, root) : kitRun;
  const idleClip = clipLooksAnimated(idleSrc) ? idleSrc : kitIdle;
  const runClip = clipLooksAnimated(runSrc) ? runSrc : kitRun;

  const head = findBoneAny(root, BONE_HEAD) ?? findBone(root, 'Head');
  const hand = findBoneAny(root, BONE_HAND);
  const handL = findBoneAny(root, BONE_HAND_L);
  const back = findBoneAny(root, BONE_BACK);
  const headLocals: THREE.Matrix4[] = [];
  const handLocals: THREE.Matrix4[] = [];
  const leftHandLocals: THREE.Matrix4[] = [];
  const backLocals: THREE.Matrix4[] = [];

  if (idleClip) poseMixer(mixer, skinned, root, idleClip, Math.min(0.3, idleClip.duration * 0.4));
  else mixer.stopAllAction();
  const idleBake = bakeSkinned(skinned, true);
  const geometry = idleBake.geometry;
  headLocals.push(captureBoneLocal(head, idleBake.snapY, [0, 1.46, 0]));
  const idleHand = captureBoneLocal(hand, idleBake.snapY, [0.22, 0.95, 0.12]);
  handLocals.push(idleHand);
  leftHandLocals.push(captureLeftHand(handL, idleBake.snapY, idleHand));
  backLocals.push(captureBoneLocal(back, idleBake.snapY, [0, 1.08, -0.06]));

  const walkGeos: THREE.BufferGeometry[] = [];
  const walkHeads: THREE.Matrix4[] = [];
  const walkHands: THREE.Matrix4[] = [];
  const walkHandsL: THREE.Matrix4[] = [];
  const walkBacks: THREE.Matrix4[] = [];
  if (runClip && runClip.duration > 0.2) {
    for (let i = 0; i < WALK_FRAMES; i++) {
      poseMixer(mixer, skinned, root, runClip, (i / WALK_FRAMES) * runClip.duration);
      walkGeos.push(bakeSkinned(skinned, false).geometry);
      walkHeads.push(captureBoneLocal(head, 0, [0, 1.46, 0]));
      const rh = captureBoneLocal(hand, 0, [0.22, 0.95, 0.12]);
      walkHands.push(rh);
      walkHandsL.push(captureLeftHand(handL, 0, rh));
      walkBacks.push(captureBoneLocal(back, 0, [0, 1.08, -0.06]));
    }
    snapWalkGeos(walkGeos, walkHeads, walkHands, walkHandsL, walkBacks);
    headLocals.push(...walkHeads);
    handLocals.push(...walkHands);
    leftHandLocals.push(...walkHandsL);
    backLocals.push(...walkBacks);
  }

  const slotGeos: THREE.BufferGeometry[][] = [];
  const slotKitHair: (SlotHair | null)[] = [];
  const slotMorph: number[] = [];
  const slotScale: number[] = [];
  const slotKitHairId: (KitHairId | null)[] = [];
  const slotKitSkirtId: (KitSkirtId | null)[] = [];
  const slotSkirtGeos: (THREE.BufferGeometry[] | null)[] = [];
  const slotSkirtMat: (THREE.MeshPhongMaterial | null)[] = [];
  const slotHairMap: (THREE.Texture | null)[] = [];
  const slotSkirtMap: (THREE.Texture | null)[] = [];
  for (let s = 0; s < slotIds.length; s++) {
    const id = slotIds[s];
    const morph = bodyMorphForSlot(catalog, id);
    const hairId = kitHairForSlot(catalog, id);
    const skirtId = kitSkirtForSlot(catalog, id);
    const hairTex = hairMaps.get(hairFileOf(id)) ?? defaultHairMap ?? kitHairMat.map;
    const skirtTex = skirtMaps.get(skirtFileOf(id)) ?? defaultSkirtMap;
    const hairMat = hairTex ? toKitHairPhong(hairTex) : kitHairMat;
    if (hairTex) applyKitHairMaps(root, hairTex);
    setKitHair(root, hairId);
    setKitSkirt(root, skirtId);
    if (skirtTex) applyKitSkirtMaps(root, skirtTex);
    setBodyMorph(skinned, morph);
    if (idleClip) poseMixer(mixer, skinned, root, idleClip, Math.min(0.3, idleClip.duration * 0.4));
    const idleBake = bakeSkinned(skinned, true);
    const idleGeo = idleBake.geometry;
    const idleSkirt = skirtId ? bakeKitSkirtFrame(root, skirtId, idleBake.snapY) : null;
    const walks: THREE.BufferGeometry[] = [];
    const walkSkirts: THREE.BufferGeometry[] = [];
    const dummyH: THREE.Matrix4[] = [];
    const dummyHd: THREE.Matrix4[] = [];
    if (runClip && runClip.duration > 0.2) {
      for (let i = 0; i < WALK_FRAMES; i++) {
        poseMixer(mixer, skinned, root, runClip, (i / WALK_FRAMES) * runClip.duration);
        walks.push(bakeSkinned(skinned, false).geometry);
        dummyH.push(new THREE.Matrix4());
        dummyHd.push(new THREE.Matrix4());
        if (skirtId) {
          const g = bakeKitSkirtFrame(root, skirtId, 0);
          if (g) walkSkirts.push(g);
        }
      }
      const liftY = snapWalkGeos(walks, dummyH, dummyHd);
      for (const g of walkSkirts) {
        g.translate(0, -liftY, 0);
        g.computeBoundingBox();
        g.computeBoundingSphere();
      }
    }
    slotGeos.push([idleGeo, ...walks]);
    if (idleClip) poseMixer(mixer, skinned, root, idleClip, Math.min(0.3, idleClip.duration * 0.4));
    slotKitHair.push(hairId ? bakeKitHairToHead(root, hairId, head, hairMat) : null);
    slotMorph.push(morph);
    slotScale.push(bodyScaleForSlot(catalog, id));
    slotKitHairId.push(hairId);
    slotKitSkirtId.push(skirtId);
    slotHairMap.push(hairTex ?? null);
    slotSkirtMap.push(skirtTex ?? null);
    if (skirtId && idleSkirt && walkSkirts.length === walks.length) {
      slotSkirtGeos.push([idleSkirt, ...walkSkirts]);
      slotSkirtMat.push(skirtTex ? toKitSkirtPhong(skirtTex) : null);
    } else {
      slotSkirtGeos.push(null);
      slotSkirtMat.push(null);
    }
  }
  setBodyMorph(skinned, 0);
  setKitHair(root, null);
  setKitSkirt(root, null);

  if (idleClip) poseMixer(mixer, skinned, root, idleClip, 0);
  else mixer.stopAllAction();
  if (head) {
    const restScale = new THREE.Vector3();
    head.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), restScale);
    if (restScale.x === 0 || restScale.y === 0 || restScale.z === 0) restScale.set(1, 1, 1);
    lockHeadScale(headLocals, restScale);
  }
  if (hand) {
    const restScale = new THREE.Vector3();
    hand.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), restScale);
    if (restScale.x === 0 || restScale.y === 0 || restScale.z === 0) restScale.set(1, 1, 1);
    lockHeadScale(handLocals, restScale);
  }
  if (handL) {
    const restScale = new THREE.Vector3();
    handL.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), restScale);
    if (restScale.x === 0 || restScale.y === 0 || restScale.z === 0) restScale.set(1, 1, 1);
    lockHeadScale(leftHandLocals, restScale);
  } else if (hand) {
    const restScale = new THREE.Vector3();
    hand.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), restScale);
    if (restScale.x === 0 || restScale.y === 0 || restScale.z === 0) restScale.set(1, 1, 1);
    lockHeadScale(leftHandLocals, restScale);
  }
  if (back) {
    const restScale = new THREE.Vector3();
    back.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), restScale);
    if (restScale.x === 0 || restScale.y === 0 || restScale.z === 0) restScale.set(1, 1, 1);
    lockHeadScale(backLocals, restScale);
  }

  skinned.material = playerMat;
  applyKitAtlas(skinned, playerMat.map!);
  setBodyMorph(skinned, bodyMorphForSlot(playerCat(activePlayer), activePlayer));
  const playerHairTex = hairMaps.get(hairFileOf(activePlayer)) ?? defaultHairMap ?? null;
  const playerSkirtTex = skirtMaps.get(skirtFileOf(activePlayer)) ?? defaultSkirtMap ?? null;
  const playerKitHairId = kitHairForSlot(playerCat(activePlayer), activePlayer);
  const playerKitSkirtId = kitSkirtForSlot(playerCat(activePlayer), activePlayer);
  setKitHair(root, playerKitHairId);
  setKitSkirt(root, playerKitSkirtId);
  if (playerHairTex) applyKitHairMaps(root, playerHairTex);
  if (playerSkirtTex) applyKitSkirtMaps(root, playerSkirtTex);

  const clips: HumanoidKit['clips'] = {};
  if (idleClip) clips.idle = idleClip;
  if (runClip) clips.run = runClip;

  const propVisuals = new Map<string, THREE.Group>();
  const needed = new Map<string, { file: string; fit?: number }>();
  const note = (look: { def: { id: string; file: string; fit?: number } } | null) => {
    if (!look) return;
    const fit = propFitOf(look.def.id, look.def.fit);
    needed.set(`${look.def.file}#${fit ?? ''}`, { file: look.def.file, fit });
  };
  for (const id of [...PLAYER_SLOT_IDS, ...BATTLE_SLOT_IDS]) {
    note(propForSlot(catalogForPlayerSlot(catalog, id), id, 'head'));
    note(propForSlot(catalogForPlayerSlot(catalog, id), id, 'hand'));
    note(propForSlot(catalogForPlayerSlot(catalog, id), id, 'back'));
  }
  await Promise.all(
    [...needed].map(async ([key, { file, fit }]) => {
      try {
        propVisuals.set(key, await loadPropVisual(file, fit));
      } catch (err) {
        console.warn('配件未加载', file, err);
      }
    })
  );

  const packProp = (id: string, anchor: AttachAnchor): SlotHair | null => {
    const look = propForSlot(catalogForPlayerSlot(catalog, id), id, anchor);
    if (!look) return null;
    const fit = propFitOf(look.def.id, look.def.fit);
    const visual = propVisuals.get(`${look.def.file}#${fit ?? ''}`);
    if (!visual) return null;
    return makeSlotHair(visual, look.def, look.transform);
  };

  return {
    template: root,
    geometry,
    walkGeos,
    slotGeos,
    maleMat,
    femaleMat,
    playerMat,
    heavyMat,
    interceptorMat,
    headLocals,
    handLocals,
    leftHandLocals,
    backLocals,
    slotHair: BATTLE_SLOT_IDS.map(() => null),
    slotHat: BATTLE_SLOT_IDS.map((id) => packProp(id, 'head')),
    slotHeld: BATTLE_SLOT_IDS.map((id) => packProp(id, 'hand')),
    slotBack: BATTLE_SLOT_IDS.map((id) => packProp(id, 'back')),
    slotKitHair,
    slotMorph,
    slotScale,
    slotKitHairId,
    slotKitSkirtId,
    slotSkirtGeos,
    slotSkirtMat,
    slotHairMap,
    slotSkirtMap,
    playerSlot: activePlayer,
    playerLooks: {
      player: {
        mat: playerMatM,
        morph: bodyMorphForSlot(playerCat('player'), 'player'),
        scale: bodyScaleForSlot(playerCat('player'), 'player'),
        kitHair: kitHairForSlot(playerCat('player'), 'player'),
        kitSkirt: kitSkirtForSlot(playerCat('player'), 'player'),
        hairMap: hairMaps.get(hairFileOf('player')) ?? defaultHairMap ?? null,
        skirtMap: skirtMaps.get(skirtFileOf('player')) ?? defaultSkirtMap ?? null,
        hair: null,
        hat: packProp('player', 'head'),
        held: packProp('player', 'hand'),
        back: packProp('player', 'back'),
      },
      'player-f': {
        mat: playerMatF,
        morph: bodyMorphForSlot(playerCat('player-f'), 'player-f'),
        scale: bodyScaleForSlot(playerCat('player-f'), 'player-f'),
        kitHair: kitHairForSlot(playerCat('player-f'), 'player-f'),
        kitSkirt: kitSkirtForSlot(playerCat('player-f'), 'player-f'),
        hairMap: hairMaps.get(hairFileOf('player-f')) ?? defaultHairMap ?? null,
        skirtMap: skirtMaps.get(skirtFileOf('player-f')) ?? defaultSkirtMap ?? null,
        hair: null,
        hat: packProp('player-f', 'head'),
        held: packProp('player-f', 'hand'),
        back: packProp('player-f', 'back'),
      },
    },
    playerHair: null,
    playerHat: packProp(activePlayer, 'head'),
    playerHeld: packProp(activePlayer, 'hand'),
    playerBack: packProp(activePlayer, 'back'),
    playerMorph: bodyMorphForSlot(playerCat(activePlayer), activePlayer),
    playerScale: bodyScaleForSlot(playerCat(activePlayer), activePlayer),
    playerKitHair: playerKitHairId,
    playerKitSkirt: playerKitSkirtId,
    playerHairMap: playerHairTex,
    playerSkirtMap: playerSkirtTex,
    clips,
  };
}

export interface HumanoidFigure {
  group: THREE.Group;
  ghostMats: THREE.MeshPhongMaterial[];
  mixer: THREE.AnimationMixer;
  idle?: THREE.AnimationAction;
  run?: THREE.AnimationAction;
  playerHalo?: PlayerHalo;
}

function cloneKitFigure(
  kit: HumanoidKit,
  look: {
    map: THREE.Texture | null;
    morph: number;
    scale?: number;
    kitHair: KitHairId | null;
    kitSkirt: KitSkirtId | null;
    hairMap: THREE.Texture | null;
    skirtMap: THREE.Texture | null;
    hair: SlotHair | null;
    hat: SlotHair | null;
    held: SlotHair | null;
    back: SlotHair | null;
  }
): HumanoidFigure {
  const figure = cloneSkeleton(kit.template) as THREE.Object3D;
  const ghostMats: THREE.MeshPhongMaterial[] = [];
  figure.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const mat = (mesh.material as THREE.Material).clone() as THREE.MeshPhongMaterial;
    mat.transparent = true;
    if (o.name === 'characterMedium' && look.map) {
      mat.map = look.map;
      if ('vertexColors' in mat) mat.vertexColors = false;
    }
    mesh.material = mat;
    ghostMats.push(mat);
  });
  const body = figure.getObjectByName('characterMedium') as THREE.SkinnedMesh | undefined;
  if (body?.isSkinnedMesh && look.map) {
    applyKitAtlas(body, look.map);
  }
  setKitHair(figure, look.kitHair);
  setKitSkirt(figure, look.kitSkirt);
  if (look.hairMap) applyKitHairMaps(figure, look.hairMap);
  if (look.skirtMap) applyKitSkirtMaps(figure, look.skirtMap);
  if (body?.isSkinnedMesh) setBodyMorph(body, look.morph);
  if (look.hair) attachHairToHead(figure, look.hair, ghostMats);
  if (look.hat) attachToBone(figure, BONE_HEAD, look.hat, ghostMats);
  if (look.held) attachToBone(figure, BONE_HAND, look.held, ghostMats);
  if (look.back) attachToBone(figure, BONE_BACK, look.back, ghostMats);

  const group = new THREE.Group();
  group.scale.setScalar(look.scale && look.scale > 0 ? look.scale : 1);
  group.add(figure);

  const mixer = new THREE.AnimationMixer(figure);
  const idle = kit.clips.idle ? mixer.clipAction(kit.clips.idle) : undefined;
  const run = kit.clips.run ? mixer.clipAction(kit.clips.run) : undefined;
  idle?.play();
  run?.play();
  if (run) run.weight = 0;
  if (idle) idle.weight = 1;

  return { group, ghostMats, mixer, idle, run };
}

export function setFigureGait(fig: HumanoidFigure, moving: boolean, dt = 0) {
  if (fig.run && fig.idle) {
    const target = moving ? 1 : 0;
    fig.run.weight += (target - fig.run.weight) * Math.min(1, dt * 8 || 1);
    fig.idle.weight = 1 - fig.run.weight;
    fig.run.timeScale = moving ? 1.15 : 1;
  }
  fig.mixer.update(dt || 1 / 60);
}

export function clonePlayerFigure(kit: HumanoidKit, slot?: PlayerSlotId): HumanoidFigure {
  const id = slot && isPlayerSlotId(slot) ? slot : kit.playerSlot;
  const look = kit.playerLooks[id] ?? kit.playerLooks.player;
  const fig = cloneKitFigure(kit, {
    map: look.mat.map,
    morph: look.morph,
    scale: look.scale,
    kitHair: look.kitHair,
    kitSkirt: look.kitSkirt,
    hairMap: look.hairMap,
    skirtMap: look.skirtMap,
    hair: look.hair,
    hat: look.hat,
    held: look.held,
    back: look.back,
  });
  const halo = new PlayerHalo();
  fig.group.add(halo.group);
  fig.playerHalo = halo;
  return fig;
}

/** 战场槽：0 普通男 / 1 普通女 / 2 主管 / 3 拦截者 */
export function cloneBattleFigure(kit: HumanoidKit, slot: number): HumanoidFigure {
  const i = Math.max(0, Math.min(3, slot | 0));
  const mats = [kit.maleMat, kit.femaleMat, kit.heavyMat, kit.interceptorMat];
  return cloneKitFigure(kit, {
    map: mats[i]!.map,
    morph: kit.slotMorph[i] ?? 0,
    kitHair: kit.slotKitHairId[i] ?? null,
    kitSkirt: kit.slotKitSkirtId[i] ?? null,
    hairMap: kit.slotHairMap[i] ?? null,
    skirtMap: kit.slotSkirtMap[i] ?? null,
    hair: kit.slotHair[i] ?? null,
    hat: kit.slotHat[i] ?? null,
    held: kit.slotHeld[i] ?? null,
    back: kit.slotBack[i] ?? null,
  });
}
