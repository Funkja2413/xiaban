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
  retargetBodyQuats,
  type KitHairId,
  type KitSkirtId,
} from './kit';
import type { ThumbCam } from '../../../src/catalog';

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
export const BONE_BACK = ['Chest', 'Spine', 'UpperChest', 'mixamorigSpine2', 'mixamorigSpine1', 'mixamorigSpine'];

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

export type StudioLights = {
  hemi: number;
  key: number;
  fill: number;
  rim: number;
  chin: number;
  keyColor: string;
  fillColor: string;
  rimColor: string;
  chinColor: string;
  bg: string;
};

export const STUDIO_PRESETS: Record<string, StudioLights> = {
  studio: {
    hemi: 1.1,
    key: 1.6,
    fill: 0.45,
    rim: 0.55,
    chin: 0.4,
    keyColor: '#fff1dc',
    fillColor: '#c8d6f0',
    rimColor: '#ffe0c2',
    chinColor: '#ffe8d2',
    bg: '#2a2c33',
  },
  warm: {
    hemi: 0.85,
    key: 1.45,
    fill: 0.35,
    rim: 1.15,
    chin: 0.55,
    keyColor: '#ffd4a8',
    fillColor: '#8fa8c8',
    rimColor: '#ff8a4a',
    chinColor: '#ffc090',
    bg: '#1e1820',
  },
  cool: {
    hemi: 0.7,
    key: 1.2,
    fill: 0.55,
    rim: 1.35,
    chin: 0.35,
    keyColor: '#e8f0ff',
    fillColor: '#6ec8ff',
    rimColor: '#ff4fd8',
    chinColor: '#a8d8ff',
    bg: '#141820',
  },
  flat: {
    hemi: 1.6,
    key: 0.9,
    fill: 0.85,
    rim: 0.15,
    chin: 0.25,
    keyColor: '#ffffff',
    fillColor: '#ffffff',
    rimColor: '#ffffff',
    chinColor: '#ffffff',
    bg: '#2a2c33',
  },
};

function hexColor(hex: string) {
  return new THREE.Color(hex);
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
  back: THREE.Object3D | null = null;
  clips: { idle?: THREE.AnimationClip; run?: THREE.AnimationClip; jump?: THREE.AnimationClip } = {};
  playing: 'idle' | 'run' | 'jump' | 'none' = 'none';
  boneNames: string[] = [];
  bodyMorph = 0;
  bodyScale = 1;
  private figure: THREE.Group | null = null;
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
  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;
  private rim: THREE.DirectionalLight;
  private chin: THREE.DirectionalLight;
  private lights: StudioLights = { ...STUDIO_PRESETS.studio };

  constructor(private host: HTMLElement) {
    this.scene.background = new THREE.Color(0x2a2c33);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 40);
    this.camera.position.set(1.65, 0.9, 2.15);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

    this.hemi = new THREE.HemisphereLight(0xfff4e8, 0x4a5060, 1.1);
    this.key = new THREE.DirectionalLight(0xfff1dc, 1.6);
    this.key.position.set(2.4, 4.2, 2.2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0008;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.camera.near = 0.5;
    this.key.shadow.camera.far = 14;
    this.key.shadow.camera.left = -2.2;
    this.key.shadow.camera.right = 2.2;
    this.key.shadow.camera.top = 2.4;
    this.key.shadow.camera.bottom = -0.4;
    this.key.shadow.camera.updateProjectionMatrix();
    this.fill = new THREE.DirectionalLight(0xc8d6f0, 0.45);
    this.fill.position.set(-2.8, 2.2, 1.4);
    this.rim = new THREE.DirectionalLight(0xffe0c2, 0.55);
    this.rim.position.set(-1.2, 2.8, -3.2);
    // 下巴底光：从前下方往上打，提亮下颌阴影
    this.chin = new THREE.DirectionalLight(0xffe8d2, 0.4);
    this.chin.position.set(0.15, -0.8, 1.6);
    this.scene.add(this.hemi, this.key, this.fill, this.rim, this.chin);
    this.applyStudioLights(this.lights);

    // 隐形接影面：不要转盘，只要影子能落在脚底（预览和封面都保留）
    const shadowFloor = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 48),
      new THREE.ShadowMaterial({ opacity: 0.42 })
    );
    shadowFloor.name = 'shadowFloor';
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.position.y = 0.001;
    shadowFloor.receiveShadow = true;
    this.scene.add(shadowFloor);

    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
    this.renderer.setAnimationLoop(() => this.tick());
  }

  getStudioLights(): StudioLights {
    return { ...this.lights };
  }

  applyStudioLights(next: Partial<StudioLights>) {
    this.lights = { ...this.lights, ...next };
    const L = this.lights;
    this.hemi.intensity = L.hemi;
    this.key.intensity = L.key;
    this.key.color.copy(hexColor(L.keyColor));
    this.fill.intensity = L.fill;
    this.fill.color.copy(hexColor(L.fillColor));
    this.rim.intensity = L.rim;
    this.rim.color.copy(hexColor(L.rimColor));
    this.chin.intensity = L.chin;
    this.chin.color.copy(hexColor(L.chinColor));
    this.scene.background = hexColor(L.bg);
  }

  applyStudioPreset(id: keyof typeof STUDIO_PRESETS) {
    this.applyStudioLights(STUDIO_PRESETS[id]);
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
    const figure = new THREE.Group();
    figure.name = 'figureScale';
    figure.add(root);
    this.scene.add(figure);
    this.figure = figure;
    this.root = root;
    this.skinned = skinned;
    this.head = findBone(root, 'Head');
    this.hand = findBoneAny(root, BONE_HAND);
    this.back = findBoneAny(root, BONE_BACK);

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

  setBodyScale(t: number) {
    this.bodyScale = t;
    this.figure?.scale.setScalar(t);
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
    this.setCameraPose({
      position: [1.65, 0.9, 2.15],
      target: [0, 0.68, 0],
      fov: 40,
    });
  }

  getCameraPose(): ThumbCam {
    const p = this.camera.position;
    const t = this.orbit.target;
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return {
      position: [r(p.x), r(p.y), r(p.z)],
      target: [r(t.x), r(t.y), r(t.z)],
      fov: Math.round(this.camera.fov * 100) / 100,
    };
  }

  setCameraPose(pose: ThumbCam | null | undefined) {
    if (!pose?.position || !pose?.target) {
      this.camera.fov = 40;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(1.65, 0.9, 2.15);
      this.orbit.target.set(0, 0.68, 0);
      this.clearOrbitInertia();
      this.orbit.update();
      return;
    }
    const [px, py, pz] = pose.position;
    const [tx, ty, tz] = pose.target;
    if (![px, py, pz, tx, ty, tz].every((n) => Number.isFinite(n))) {
      this.resetCamera();
      return;
    }
    const fov = Number.isFinite(pose.fov) && pose.fov > 5 && pose.fov < 120 ? pose.fov : 40;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(px, py, pz);
    this.orbit.target.set(tx, ty, tz);
    this.camera.lookAt(this.orbit.target);
    this.clearOrbitInertia();
    this.orbit.update();
    // 再清一次，避免 damping 把刚写好的位姿冲掉
    this.clearOrbitInertia();
  }

  /** OrbitControls 内部惯性；不清理的话 set 完 position 会被下一帧 update 带偏 */
  private clearOrbitInertia() {
    const o = this.orbit as OrbitControls & {
      _sphericalDelta?: { set: (r: number, phi: number, theta: number) => void };
      _panOffset?: THREE.Vector3;
      _scale?: number;
    };
    o._sphericalDelta?.set(0, 0, 0);
    o._panOffset?.set(0, 0, 0);
    if (typeof o._scale === 'number') o._scale = 1;
  }

  /**
   * 用当前机位按 2:3 竖构图离屏渲染封面，保证和「还原机位」看到的角色大小/位置一致
   * （不再从宽屏画布中心裁一刀，避免封面和预览对不上）。
   */
  captureThumb(): string {
    const helper = this.gizmo.getHelper();
    const helperOn = helper.visible;
    const enabled = this.gizmo.enabled;
    this.gizmo.enabled = false;
    helper.visible = false;

    this.plantOnGround();
    this.clearOrbitInertia();
    this.orbit.update();

    const w = 320;
    const h = 480; // 2:3 封面
    const pose = this.getCameraPose();
    const shot = this.camera.clone();
    shot.aspect = w / h;
    shot.fov = pose.fov;
    shot.position.set(...pose.position);
    shot.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    shot.updateProjectionMatrix();

    const prevSize = new THREE.Vector2();
    this.renderer.getSize(prevSize);
    const prevRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.renderer.render(this.scene, shot);
    const dataUrl = this.renderer.domElement.toDataURL('image/png');
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this.camera.aspect = Math.max(prevSize.x, 1) / Math.max(prevSize.y, 1);
    this.camera.updateProjectionMatrix();

    this.gizmo.enabled = enabled;
    helper.visible = helperOn;
    return dataUrl;
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
    const back = this.back ? `Back ✓` : 'Back 未找到';
    const morph = this.bodyMorph === 0 ? '中' : this.bodyMorph > 0 ? `胖 ${this.bodyMorph.toFixed(2)}` : `瘦 ${this.bodyMorph.toFixed(2)}`;
    const scale = this.bodyScale === 1 ? '尺 1' : `尺 ${this.bodyScale.toFixed(2)}`;
    const hair = this.kitHair ?? '图集短发';
    return `${clipName} · ${morph} · ${scale} · ${hair} · ${head} · ${hand} · ${back} · 骨 ${this.boneNames.length}`;
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
