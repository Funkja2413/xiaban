import * as THREE from 'three/webgpu';
import { clonePlayerFigure, setFigureGait, type HumanoidFigure, type HumanoidKit } from './humanoid';
import type { PlayerSlotId } from '../roster';

const PAIR: { id: PlayerSlotId; x: number }[] = [
  { id: 'player', x: -0.38 },
  { id: 'player-f', x: 0.38 },
];
const POOL_GEOM_R = 1.55;
/** idle 鞋底是圆角，最低点贴地时侧面仍像悬空，再压一点让轮廓踩实 */
const SOLE_SINK = 0.04;
const PLANT_MAX = 0.35;

const _skinV = new THREE.Vector3();
const _skinQ = new THREE.Vector4();
const _skinAcc = new THREE.Vector4();
const _skinTmp = new THREE.Vector4();
const _skinBone = new THREE.Matrix4();

/** 只算 characterMedium 蒙皮后的世界最低点，不用包围盒、不改几何。 */
function skinnedMinY(mesh: THREE.SkinnedMesh): number {
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const geo = mesh.geometry;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const skinIndex = geo.attributes.skinIndex as THREE.BufferAttribute;
  const skinWeight = geo.attributes.skinWeight as THREE.BufferAttribute;
  if (!pos || !skinIndex || !skinWeight) return NaN;
  const bindMatrix = mesh.bindMatrix;
  const bindMatrixInverse = mesh.bindMatrixInverse;
  const boneMatrices = mesh.skeleton.boneMatrices;
  if (!boneMatrices) return NaN;
  const world = mesh.matrixWorld;
  const morphs = geo.morphAttributes.position;
  const inf = mesh.morphTargetInfluences;
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    _skinV.fromBufferAttribute(pos, i);
    if (morphs && inf) {
      for (let m = 0; m < morphs.length; m++) {
        const w = inf[m];
        if (!w) continue;
        _skinV.x += morphs[m].getX(i) * w;
        _skinV.y += morphs[m].getY(i) * w;
        _skinV.z += morphs[m].getZ(i) * w;
      }
    }
    _skinQ.set(_skinV.x, _skinV.y, _skinV.z, 1).applyMatrix4(bindMatrix);
    _skinAcc.set(0, 0, 0, 0);
    const idx = [skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i)];
    const wgt = [skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i)];
    for (let j = 0; j < 4; j++) {
      if (!wgt[j]) continue;
      _skinBone.fromArray(boneMatrices, idx[j] * 16);
      _skinTmp.copy(_skinQ).applyMatrix4(_skinBone).multiplyScalar(wgt[j]);
      _skinAcc.add(_skinTmp);
    }
    _skinAcc.applyMatrix4(bindMatrixInverse);
    _skinAcc.applyMatrix4(world);
    if (_skinAcc.y < minY) minY = _skinAcc.y;
  }
  return minY;
}

function plantFigure(fig: HumanoidFigure) {
  const body = fig.group.getObjectByName('characterMedium') as THREE.SkinnedMesh | undefined;
  if (!body?.isSkinnedMesh) return;
  const minY = skinnedMinY(body);
  const dy = -SOLE_SINK - minY;
  if (!Number.isFinite(dy) || Math.abs(dy) > PLANT_MAX) return;
  if (Math.abs(dy) < 1e-4) return;
  fig.group.position.y += dy;
}

export type StudioLook = {
  camY: number;
  camZ: number;
  lookY: number;
  fov: number;
  figScale: number;
  hemi: number;
  keyI: number;
  dim: number;
  spotI: number;
  spotY: number;
  spotZ: number;
  spotAngle: number;
  poolSize: number;
  poolOpacity: number;
  fillI: number;
  fillY: number;
  fillZ: number;
  fillAim: number;
  fillAngle: number;
  gizmos: boolean;
};

export const DEFAULT_STUDIO_LOOK: StudioLook = {
  camY: 0.43,
  camZ: 6.02,
  lookY: 0.23,
  fov: 40,
  figScale: 0.7,
  hemi: 0.43,
  keyI: 0.16,
  dim: 1,
  spotI: 8.5,
  spotY: 2.18,
  spotZ: 2.58,
  spotAngle: 0.32,
  poolSize: 0.54,
  poolOpacity: 0.44,
  fillI: 0.2,
  fillY: 0.08,
  fillZ: 0.55,
  fillAim: 0.58,
  fillAngle: 0.52,
  gizmos: false,
};

function poolTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 4, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255, 252, 235, 1)');
  grd.addColorStop(0.22, 'rgba(255, 230, 160, 0.85)');
  grd.addColorStop(0.55, 'rgba(255, 200, 110, 0.28)');
  grd.addColorStop(1, 'rgba(255, 180, 80, 0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function slotX(id: PlayerSlotId | null) {
  if (id === 'player-f') return PAIR[1].x;
  return PAIR[0].x;
}

/** 选角棚：一盏顶光、一盏地面上打补光、脚下渐变光斑。 */
export class AvatarStudio {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  look: StudioLook = { ...DEFAULT_STUDIO_LOOK };
  private figs = new Map<PlayerSlotId, HumanoidFigure>();
  private selected: PlayerSlotId | null = 'player';
  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private spot: THREE.SpotLight;
  private fill: THREE.SpotLight;
  private pool: THREE.Mesh;
  private poolMat: THREE.MeshBasicMaterial;
  private gizmos: THREE.Group;
  private gizmoBall: THREE.Mesh;
  private gizmoFill: THREE.Mesh;
  private contacts = new Map<PlayerSlotId, THREE.Mesh>();

  constructor(kit: HumanoidKit, aspect: number) {
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.2, 30);

    this.hemi = new THREE.HemisphereLight(0xfff4e8, 0x1a1c24, 0.14);
    this.scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xfff1dc, 0.16);
    this.key.position.set(0, 3.2, 3.4);
    this.key.target.position.set(0, 0.5, 0);
    this.scene.add(this.key, this.key.target);

    this.spot = new THREE.SpotLight(0xfff6e4, 0, 12, 0.32, 0.45, 1.05);
    this.scene.add(this.spot, this.spot.target);

    this.fill = new THREE.SpotLight(0xffe3b8, 0, 3.6, 0.52, 0.78, 1.25);
    this.scene.add(this.fill, this.fill.target);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(4.2, 48),
      new THREE.MeshLambertMaterial({ color: 0x000000 })
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    this.poolMat = new THREE.MeshBasicMaterial({
      map: poolTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(POOL_GEOM_R, 48), this.poolMat);
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.y = 0.005;
    this.scene.add(this.pool);

    const contactMat = new THREE.MeshBasicMaterial({
      color: 0x050508,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    for (const slot of PAIR) {
      const blob = new THREE.Mesh(new THREE.CircleGeometry(0.2, 28), contactMat);
      blob.rotation.x = -Math.PI / 2;
      blob.scale.set(1.05, 0.62, 1);
      blob.position.set(slot.x, 0.004, 0.02);
      this.scene.add(blob);
      this.contacts.set(slot.id, blob);
    }

    this.gizmoBall = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, depthTest: false })
    );
    this.gizmoFill = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffc078, depthTest: false })
    );
    this.gizmos = new THREE.Group();
    this.gizmos.add(this.gizmoBall, this.gizmoFill);
    this.scene.add(this.gizmos);

    for (const slot of PAIR) {
      const fig = clonePlayerFigure(kit, slot.id);
      if (fig.playerHalo) {
        fig.playerHalo.group.removeFromParent();
        fig.playerHalo = undefined;
      }
      fig.group.position.set(slot.x, 0, 0);
      fig.group.rotation.y = slot.x < 0 ? 0.18 : -0.18;
      this.scene.add(fig.group);
      this.figs.set(slot.id, fig);
    }

    for (const fig of this.figs.values()) setFigureGait(fig, false, 1 / 60);
    this.applyLook(this.look);
  }

  applyLook(look: StudioLook) {
    this.look = look;
    this.camera.fov = look.fov;
    this.camera.position.set(0, look.camY, look.camZ);
    this.camera.lookAt(0, look.lookY, 0);
    this.camera.updateProjectionMatrix();

    for (const fig of this.figs.values()) {
      fig.group.scale.setScalar(look.figScale);
      plantFigure(fig);
    }

    this.hemi.intensity = look.hemi;
    this.key.intensity = look.keyI;
    this.spot.angle = look.spotAngle;
    this.spot.penumbra = 0.5;
    this.fill.angle = look.fillAngle;
    this.fill.penumbra = 0.78;

    this.gizmos.visible = look.gizmos;
    this.syncSelect();
  }

  private syncSelect() {
    const look = this.look;
    const on = this.selected;
    const x = slotX(on);

    this.spot.position.set(0, look.spotY, look.spotZ);
    this.spot.target.position.set(x, 0, 0);
    this.spot.intensity = on ? look.spotI : 0;

    this.fill.position.set(x, look.fillY, look.fillZ);
    this.fill.target.position.set(x, look.fillAim, 0);
    this.fill.intensity = on ? look.fillI : 0;

    const s = look.poolSize / POOL_GEOM_R;
    this.pool.scale.set(s, s, 1);
    /** 光斑前缘收到鞋尖附近，低机位时不会铺成脚前一摊 */
    this.pool.position.set(x, 0.005, 0.11 - look.poolSize);
    this.poolMat.opacity = on ? look.poolOpacity : 0;

    this.gizmoBall.position.copy(this.spot.position);
    this.gizmoFill.position.copy(this.fill.position);

    for (const [slot, fig] of this.figs) {
      const k = slot === on ? 1 : look.dim;
      fig.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          const m = mat as THREE.MeshPhongMaterial;
          if (!m.color) continue;
          if (!m.userData.baseColor) m.userData.baseColor = m.color.clone();
          m.color.copy(m.userData.baseColor).multiplyScalar(k);
        }
      });
    }
  }

  setSelected(id: PlayerSlotId | null) {
    this.selected = id;
    this.syncSelect();
  }

  setAspect(w: number, h: number) {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** 角色名牌锚点：水平用包围盒中心，竖直用脚底高度 */
  footNdc(id: PlayerSlotId): { x: number; y: number } {
    const fig = this.figs.get(id);
    const foot = new THREE.Vector3(slotX(id), 0.02, 0.02);
    foot.project(this.camera);
    const y = (1 - foot.y) / 2;
    let x = (foot.x + 1) / 2;
    if (fig) {
      const box = new THREE.Box3().setFromObject(fig.group);
      const mid = new THREE.Vector3();
      box.getCenter(mid);
      mid.y = 0.55; // 躯干高度，比脚底更能代表视觉重心
      mid.project(this.camera);
      x = (mid.x + 1) / 2;
    }
    return { x, y };
  }

  update(dt: number) {
    for (const fig of this.figs.values()) {
      setFigureGait(fig, false, dt);
      plantFigure(fig);
    }
  }
}
