import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { loadSkinMap } from './skin';
import { OFFICIAL_SKINS } from './variants';
import {
  KIT_HAIR_ALBEDO,
  KIT_SKIRT_ALBEDO,
  KIT_SKINS,
  KIT_URL,
  applyKitAtlas,
  applyKitHairMaps,
  applyKitSkirtMaps,
  findKitBody,
  setBodyMorph,
  setKitHair,
  setKitSkirt,
  fixKitHairBind,
  type KitHairId,
  type KitSkirtId,
} from './kit';

const HEIGHT = 1.72;

/** 与 src/game/humanoid.ts 保持同一套选 clip 规则，禁止用 animations[0] */
export function pickClip(anims: THREE.AnimationClip[] | undefined, prefer: string): THREE.AnimationClip | undefined {
  if (!anims?.length) return undefined;
  const key = prefer.toLowerCase();
  const named = anims.find((c) => c.duration > 0.2 && c.name.toLowerCase().includes(key));
  if (named) return named;
  return [...anims]
    .filter((c) => c.duration > 0.2 && !/targeting|pose/i.test(c.name))
    .sort((a, b) => b.duration - a.duration)[0];
}

/** 包里 idle/run 经常是两帧相同的 rest pose，不能当循环用 */
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

/**
 * Kenney FBX 接到 kit：只借变形骨的 quaternion。
 * position/scale 是厘米，整段接上会把人拉飞；Ctrl/IK/Roll 会和变形骨打架。
 */
function retargetBodyQuats(clip: THREE.AnimationClip, root: THREE.Object3D) {
  const names = new Set<string>();
  root.traverse((o) => names.add(o.name));
  const tracks = clip.tracks.filter((t) => {
    const [bone, prop] = t.name.split('.');
    if (!names.has(bone) || prop !== 'quaternion') return false;
    if (/Ctrl|IK|Roll|Heel/.test(bone)) return false;
    return /^(Hips|Spine|Chest|UpperChest|Neck|Head|LeftShoulder|RightShoulder|LeftArm|RightArm|LeftForeArm|RightForeArm|LeftHand|RightHand|LeftUpLeg|RightUpLeg|LeftLeg|RightLeg|LeftFoot|RightFoot|LeftToes|RightToes)/.test(
      bone
    );
  });
  if (!tracks.length) return clip;
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

export function findSkinned(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh;
  });
  return found;
}

export function findBone(root: THREE.Object3D, name: string): THREE.Bone | THREE.Object3D | null {
  let bone: THREE.Bone | null = null;
  let named: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (o.name === name) {
      named = o;
      if ((o as THREE.Bone).isBone) bone = o as THREE.Bone;
    }
  });
  return bone ?? named;
}

export const BONE_HAND = ['RightHand', 'Hand_R', 'mixamorigRightHand', 'Right_Hand', 'hand_r'];

export function findBoneAny(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
  for (const n of names) {
    const found = findBone(root, n);
    if (found) return found;
  }
  return null;
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

export class CharacterPreview {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly orbit: OrbitControls;
  readonly gizmo: TransformControls;
  mixer: THREE.AnimationMixer | null = null;
  root: THREE.Object3D | null = null;
  skinned: THREE.SkinnedMesh | null = null;
  head: THREE.Object3D | null = null;
  hand: THREE.Object3D | null = null;
  clips: { idle?: THREE.AnimationClip; run?: THREE.AnimationClip; jump?: THREE.AnimationClip } = {};
  playing: 'idle' | 'run' | 'jump' | 'none' = 'none';
  boneNames: string[] = [];
  bodyMorph = 0;
  kitHair: KitHairId | null = null;
  kitSkirt: KitSkirtId | null = null;
  hairMap: THREE.Texture | null = null;
  skirtMap: THREE.Texture | null = null;
  hairMapFile = KIT_HAIR_ALBEDO;
  skirtMapFile = KIT_SKIRT_ALBEDO;

  private clock = new THREE.Clock();
  private idleAction: THREE.AnimationAction | null = null;
  private runAction: THREE.AnimationAction | null = null;
  private jumpAction: THREE.AnimationAction | null = null;
  private officialMaps = new Map<string, THREE.Texture>();
  private currentMap: THREE.Texture | null = null;
  private compareOfficial = false;
  private officialId = OFFICIAL_SKINS[0].id;
  private customMap: THREE.Texture | null = null;

  constructor(private host: HTMLElement) {
    this.scene.background = new THREE.Color(0x2a2c33);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 40);
    this.camera.position.set(1.65, 0.9, 2.15);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    host.appendChild(this.renderer.domElement);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0.68, 0);
    this.orbit.enableDamping = true;
    this.orbit.maxPolarAngle = Math.PI * 0.495;

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSpace('local');
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !(e as { value: boolean }).value;
    });
    this.scene.add(this.gizmo.getHelper());

    this.scene.add(new THREE.HemisphereLight(0xfff4e8, 0x4a5060, 1.1));
    const key = new THREE.DirectionalLight(0xfff1dc, 1.6);
    key.position.set(2.4, 4.2, 2.2);
    key.castShadow = true;
    this.scene.add(key);

    const pedestalH = 0.07;
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.4, pedestalH, 48),
      new THREE.MeshLambertMaterial({ color: 0x3d4048 })
    );
    pedestal.position.y = -pedestalH / 2;
    pedestal.receiveShadow = true;
    this.scene.add(pedestal);
    const cap = new THREE.Mesh(
      new THREE.CircleGeometry(0.36, 48),
      new THREE.MeshLambertMaterial({ color: 0x555861 })
    );
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = 0;
    cap.receiveShadow = true;
    this.scene.add(cap);
    const grid = new THREE.GridHelper(0.72, 4, 0x6a6e78, 0x4a4e56);
    grid.position.y = 0.001;
    this.scene.add(grid);

    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
    this.renderer.setAnimationLoop(() => this.tick());
  }

  async load() {
    const loader = new GLTFLoader();
    const fbx = new FBXLoader();
    const [gltf, idleRoot, runRoot] = await Promise.all([
      loader.loadAsync(KIT_URL),
      fbx.loadAsync('/models/kenney/idle.fbx').catch(() => null),
      fbx.loadAsync('/models/kenney/run.fbx').catch(() => null),
    ]);
    const root = gltf.scene;
    const skinned = findKitBody(root);

    const [maleMap, femaleMap, hairMap, skirtMap, ...kitMaps] = await Promise.all([
      loadSkinMap(OFFICIAL_SKINS[0].file, false),
      loadSkinMap(OFFICIAL_SKINS[1].file, false),
      loadSkinMap(KIT_HAIR_ALBEDO, false),
      loadSkinMap(KIT_SKIRT_ALBEDO, false),
      ...KIT_SKINS.map((s) => loadSkinMap(s.file, false)),
    ]);
    this.officialMaps.set(OFFICIAL_SKINS[0].id, maleMap);
    this.officialMaps.set(OFFICIAL_SKINS[1].id, femaleMap);
    for (let i = 0; i < KIT_SKINS.length; i++) this.officialMaps.set(KIT_SKINS[i].id, kitMaps[i]);

    skinned.castShadow = true;
    skinned.receiveShadow = true;
    const embedded = Array.isArray(skinned.material)
      ? (skinned.material[0] as THREE.MeshStandardMaterial).map
      : (skinned.material as THREE.MeshStandardMaterial).map;
    const startMap = this.officialMaps.get(KIT_SKINS[0].id) ?? embedded ?? maleMap;
    const mat = new THREE.MeshPhongMaterial({
      map: startMap,
      color: 0xffffff,
      shininess: 18,
      specular: 0x333333,
      vertexColors: false,
    });
    skinned.material = mat;
    this.currentMap = startMap;
    this.officialId = KIT_SKINS[0].id;
    applyKitAtlas(skinned, startMap);
    setKitHair(root, null);
    setKitSkirt(root, null);
    fixKitHairBind(root);
    this.hairMap = hairMap;
    this.skirtMap = skirtMap;
    this.hairMapFile = KIT_HAIR_ALBEDO;
    this.skirtMapFile = KIT_SKIRT_ALBEDO;
    applyKitHairMaps(root, hairMap);
    applyKitSkirtMaps(root, skirtMap);
    setBodyMorph(skinned, 0);

    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
      }
    });

    normalizeToGround(root);
    this.scene.add(root);
    this.root = root;
    this.skinned = skinned;
    this.head = findBone(root, 'Head');
    this.hand = findBoneAny(root, BONE_HAND);

    this.boneNames = [];
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.boneNames.push(o.name);
    });

    this.mixer = new THREE.AnimationMixer(root);
    const kitIdle = pickClip(gltf.animations, 'idle');
    const kitRun = pickClip(gltf.animations, 'run');
    const kitJump = pickClip(gltf.animations, 'jump');
    const fbxIdle = pickClip(idleRoot?.animations, 'idle');
    const fbxRun = pickClip(runRoot?.animations, 'run');
    const idle = clipLooksAnimated(fbxIdle) && fbxIdle ? retargetBodyQuats(fbxIdle, root) : kitIdle;
    const run = clipLooksAnimated(fbxRun) && fbxRun ? retargetBodyQuats(fbxRun, root) : kitRun;
    this.clips.idle = clipLooksAnimated(idle) ? idle : kitIdle;
    this.clips.run = clipLooksAnimated(run) ? run : kitRun;
    this.clips.jump = clipLooksAnimated(kitJump) ? kitJump : undefined;
    if (this.clips.idle) {
      this.idleAction = this.mixer.clipAction(this.clips.idle);
      this.idleAction.play();
      this.playing = 'idle';
    }
    if (this.clips.run) {
      this.runAction = this.mixer.clipAction(this.clips.run);
      this.runAction.play();
      this.runAction.weight = 0;
    }
    if (this.clips.jump) {
      this.jumpAction = this.mixer.clipAction(this.clips.jump);
      this.jumpAction.play();
      this.jumpAction.weight = 0;
    }
    this.mixer.update(0);
  }

  setMorph(t: number) {
    this.bodyMorph = t;
    if (this.skinned) setBodyMorph(this.skinned, t);
  }

  setKitHairStyle(name: KitHairId | null) {
    this.kitHair = name;
    if (this.root) {
      setKitHair(this.root, name);
      if (this.hairMap) applyKitHairMaps(this.root, this.hairMap);
    }
  }

  setKitSkirtStyle(name: KitSkirtId | null) {
    this.kitSkirt = name;
    if (this.root) {
      setKitSkirt(this.root, name);
      if (this.skirtMap) applyKitSkirtMaps(this.root, this.skirtMap);
      if (this.skinned) setBodyMorph(this.skinned, this.bodyMorph);
    }
  }

  setKitHairMap(map: THREE.Texture | null, file?: string) {
    if (!map || !this.root) return;
    this.hairMap = map;
    if (file) this.hairMapFile = file;
    applyKitHairMaps(this.root, map);
  }

  setKitSkirtMap(map: THREE.Texture | null, file?: string) {
    if (!map || !this.root) return;
    this.skirtMap = map;
    if (file) this.skirtMapFile = file;
    applyKitSkirtMaps(this.root, map);
  }

  play(which: 'idle' | 'run' | 'jump') {
    if (!this.idleAction && !this.runAction && !this.jumpAction) return;
    this.playing = which;
    if (this.idleAction) this.idleAction.weight = which === 'idle' ? 1 : 0;
    if (this.runAction) this.runAction.weight = which === 'run' ? 1 : 0;
    if (this.jumpAction) this.jumpAction.weight = which === 'jump' ? 1 : 0;
  }

  setOfficialSkin(id: string) {
    const map = this.officialMaps.get(id);
    if (!map || !this.skinned) return;
    this.officialId = id;
    if (this.compareOfficial || !this.customMap) {
      this.currentMap = map;
      applyKitAtlas(this.skinned, map);
    }
  }

  setCustomSkin(map: THREE.Texture | null) {
    this.customMap = map;
    if (!this.skinned) return;
    if (!this.compareOfficial && map) {
      this.currentMap = map;
      applyKitAtlas(this.skinned, map);
      return;
    }
    const off = this.officialMaps.get(this.officialId);
    if (off) {
      this.currentMap = off;
      applyKitAtlas(this.skinned, off);
    }
  }

  setCompareOfficial(on: boolean) {
    this.compareOfficial = on;
    if (!this.skinned) return;
    if (on) {
      const map = this.officialMaps.get(this.officialId);
      if (map) applyKitAtlas(this.skinned, map);
    } else if (this.customMap) {
      applyKitAtlas(this.skinned, this.customMap);
    } else {
      const map = this.officialMaps.get(this.officialId);
      if (map) applyKitAtlas(this.skinned, map);
    }
  }

  resetCamera() {
    this.camera.position.set(1.65, 0.9, 2.15);
    this.orbit.target.set(0, 0.68, 0);
    this.orbit.update();
  }

  captureThumb(): string {
    const helper = this.gizmo.getHelper();
    const helperOn = helper.visible;
    const enabled = this.gizmo.enabled;
    this.gizmo.enabled = false;
    helper.visible = false;
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const w = 96;
    const h = 120;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const sw = src.width;
    const sh = src.height;
    const destAspect = w / h;
    const srcAspect = sw / Math.max(1, sh);
    let sx = 0;
    let sy = 0;
    let cw = sw;
    let ch = sh;
    if (srcAspect > destAspect) {
      cw = sh * destAspect;
      sx = (sw - cw) / 2;
    } else {
      ch = sw / destAspect;
      sy = (sh - ch) / 2;
    }
    ctx.drawImage(src, sx, sy, cw, ch, 0, 0, w, h);
    this.gizmo.enabled = enabled;
    helper.visible = helperOn;
    return c.toDataURL('image/png');
  }

  attachGizmo(obj: THREE.Object3D | null) {
    if (obj) this.gizmo.attach(obj);
    else this.gizmo.detach();
  }

  statusLine() {
    const clip =
      this.playing === 'idle'
        ? this.clips.idle
        : this.playing === 'run'
          ? this.clips.run
          : this.playing === 'jump'
            ? this.clips.jump
            : undefined;
    const clipName = clip ? `${clip.name} ${clip.duration.toFixed(2)}s` : '无动画';
    const head = this.head ? `Head ✓` : 'Head 未找到';
    const hand = this.hand ? `Hand ✓` : 'Hand 未找到';
    const morph = this.bodyMorph === 0 ? '中' : this.bodyMorph > 0 ? `胖 ${this.bodyMorph.toFixed(2)}` : `瘦 ${this.bodyMorph.toFixed(2)}`;
    const hair = this.kitHair ?? '图集短发';
    return `${clipName} · ${morph} · ${hair} · ${head} · ${hand} · 骨 ${this.boneNames.length}`;
  }

  private resize() {
    const w = Math.max(this.host.clientWidth, 1);
    const h = Math.max(this.host.clientHeight, 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private tick() {
    const dt = this.clock.getDelta();
    this.mixer?.update(dt);
    this.plantOnGround();
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  }

  private plantOnGround() {
    const mesh = this.skinned;
    const root = this.root;
    if (!mesh || !root) return;
    mesh.updateMatrixWorld(true);
    mesh.skeleton.update();
    mesh.computeBoundingBox();
    const box = mesh.boundingBox;
    if (!box || box.isEmpty()) return;
    const world = box.clone().applyMatrix4(mesh.matrixWorld);
    const minY = world.min.y;
    if (!Number.isFinite(minY)) return;
    if (this.playing === 'run') {
      /** 迈步会离地，不能每帧把最低点按回地面，否则跑循环被压成滑步 */
      if (minY < -0.02) root.position.y -= minY + 0.02;
      return;
    }
    /** 鞋底是圆角，最低点贴地时侧面仍像悬空，往下压一点让轮廓踩实 */
    const dy = -0.03 - minY;
    if (Math.abs(dy) > 1e-4) root.position.y += dy;
  }
}
