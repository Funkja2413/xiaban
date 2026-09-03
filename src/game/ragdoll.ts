import * as THREE from 'three/webgpu';
import RAPIER from '@dimforge/rapier3d-compat';
import { RAGDOLL_GROUPS } from '../sim/physics';
import { mats, phong } from './style';
import { cloneBattleFigure, type HumanoidFigure, type HumanoidKit } from './humanoid';

interface PartDef {
  kind: 'box' | 'ball' | 'capsule';
  /** box: 半尺寸 [hx,hy,hz]；ball: [r]；capsule: [halfH, r] */
  size: number[];
  /** 相对脚底的局部中心 */
  cx: number;
  cy: number;
  mass: number;
  paint: 'shirt' | 'pants' | 'skin' | 'arm';
}

// 7 刚体：骨盆、躯干、头、双臂、双腿。蒙皮骨跟这些刚体走，关节处会软弯
const PARTS: PartDef[] = [
  { kind: 'box', size: [0.17, 0.10, 0.11], cx: 0, cy: 0.92, mass: 10, paint: 'pants' },
  { kind: 'box', size: [0.18, 0.17, 0.12], cx: 0, cy: 1.24, mass: 14, paint: 'shirt' },
  { kind: 'ball', size: [0.15], cx: 0, cy: 1.60, mass: 5, paint: 'skin' },
  { kind: 'capsule', size: [0.20, 0.06], cx: -0.28, cy: 1.22, mass: 3, paint: 'arm' },
  { kind: 'capsule', size: [0.20, 0.06], cx: 0.28, cy: 1.22, mass: 3, paint: 'arm' },
  { kind: 'capsule', size: [0.28, 0.075], cx: -0.10, cy: 0.42, mass: 5, paint: 'pants' },
  { kind: 'capsule', size: [0.28, 0.075], cx: 0.10, cy: 0.42, mass: 5, paint: 'pants' },
];

const JOINTS: [number, number, number, number][] = [
  [0, 1, 0, 1.06],
  [1, 2, 0, 1.44],
  [1, 3, -0.26, 1.40],
  [1, 4, 0.26, 1.40],
  [0, 5, -0.10, 0.78],
  [0, 6, 0.10, 0.78],
];

export interface RagdollVisual {
  kit: HumanoidKit;
  slot: number;
  yaw?: number;
}

interface BoneBind {
  bone: THREE.Bone;
  part: number;
  offset: THREE.Matrix4;
}

export interface RagdollHandle {
  age: number;
  bodies: RAPIER.RigidBody[];
  meshes: THREE.Mesh[];
  figure: THREE.Group | null;
  binds: BoneBind[];
  skins: THREE.SkinnedMesh[];
  cannon: boolean;
  chainHits: number;
}

function bonePart(name: string): number {
  const n = name.replace(/^mixamorig/i, '');
  if (/^(Head|Neck|HeadTop|Jaw)/i.test(n)) return 2;
  if (/^LeftShoulder/i.test(n) || /^RightShoulder/i.test(n)) return 1;
  if (/^Left(Arm|ForeArm|Hand|Finger)/i.test(n)) return 3;
  if (/^Right(Arm|ForeArm|Hand|Finger)/i.test(n)) return 4;
  if (/^Left(UpLeg|Leg|Foot|Toe)/i.test(n)) return 5;
  if (/^Right(UpLeg|Leg|Foot|Toe)/i.test(n)) return 6;
  if (/^(Spine|Chest|UpperChest)/i.test(n)) return 1;
  return 0;
}

function collectSkins(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const skins: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    skins.push(mesh);
  });
  return skins;
}

function collectBones(skins: THREE.SkinnedMesh[]): THREE.Bone[] {
  const seen = new Set<THREE.Bone>();
  const bones: THREE.Bone[] = [];
  for (const mesh of skins) {
    for (const b of mesh.skeleton.bones) {
      if (seen.has(b)) continue;
      seen.add(b);
      bones.push(b);
    }
  }
  const depth = (o: THREE.Object3D) => {
    let n = 0;
    let p = o.parent;
    while (p) {
      n++;
      p = p.parent;
    }
    return n;
  };
  bones.sort((a, b) => depth(a) - depth(b));
  return bones;
}

function poseIdle(fig: HumanoidFigure) {
  for (const m of fig.ghostMats) {
    m.transparent = false;
    m.opacity = 1;
    m.needsUpdate = true;
  }
  fig.run?.stop();
  if (fig.idle) {
    fig.idle.reset();
    fig.idle.play();
    fig.idle.weight = 1;
  }
  fig.mixer.update(0);
  fig.mixer.stopAllAction();
}

export class RagdollFactory {
  readonly geoms: THREE.BufferGeometry[];
  private skinMat = mats.skin();
  private pantsMat = mats.pants();
  private shirtMats = new Map<number, THREE.MeshPhongMaterial>();
  private _bodyM = new THREE.Matrix4();
  private _invP = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _p = new THREE.Vector3();
  private _s = new THREE.Vector3();
  private _one = new THREE.Vector3(1, 1, 1);

  constructor(private scene: THREE.Scene, private world: RAPIER.World) {
    this.geoms = PARTS.map((p) => {
      if (p.kind === 'box') return new THREE.BoxGeometry(p.size[0] * 2, p.size[1] * 2, p.size[2] * 2);
      if (p.kind === 'ball') return new THREE.SphereGeometry(p.size[0], 12, 10);
      return new THREE.CapsuleGeometry(p.size[1], p.size[0] * 2, 4, 8);
    });
  }

  private shirtMat(color: number) {
    let m = this.shirtMats.get(color);
    if (!m) {
      m = phong({ color, map: mats.shirt().map ?? undefined, shininess: 16, specular: 0x444444 });
      this.shirtMats.set(color, m);
    }
    return m;
  }

  private partMat(paint: PartDef['paint'], shirtColor: number) {
    if (paint === 'skin') return this.skinMat;
    if (paint === 'pants') return this.pantsMat;
    return this.shirtMat(shirtColor);
  }

  /**
   * 在 (x,z) 生成布娃娃并施加击飞冲量。
   * 传入 visual 时用角色蒙皮跟着刚体软弯；否则退回几何块。
   */
  spawn(
    x: number,
    z: number,
    shirtColor: number,
    dirX: number,
    dirZ: number,
    power: number,
    scale = 1,
    cannon = false,
    visual?: RagdollVisual
  ): RagdollHandle {
    const bodies: RAPIER.RigidBody[] = [];
    const meshes: THREE.Mesh[] = [];
    const s = scale;
    const yaw = visual?.yaw ?? 0;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const yq = { x: 0, y: Math.sin(yaw * 0.5), z: 0, w: Math.cos(yaw * 0.5) };

    PARTS.forEach((p, i) => {
      const px = x + (p.cx * cy) * s;
      const pz = z + (-p.cx * sy) * s;
      const limb = p.paint === 'arm' || (p.paint === 'pants' && i >= 5);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(px, p.cy * s, pz)
          .setRotation(yq)
          .setLinearDamping(1.35)
          .setAngularDamping(limb ? 1.8 : 2.8)
          .setCcdEnabled(true)
      );
      let desc: RAPIER.ColliderDesc;
      if (p.kind === 'box') desc = RAPIER.ColliderDesc.cuboid(p.size[0] * s, p.size[1] * s, p.size[2] * s);
      else if (p.kind === 'ball') desc = RAPIER.ColliderDesc.ball(p.size[0] * s);
      else desc = RAPIER.ColliderDesc.capsule(p.size[0] * s, p.size[1] * s);
      desc.setMass(p.mass * s * s * s).setFriction(1.15).setRestitution(0.04).setCollisionGroups(RAGDOLL_GROUPS);
      this.world.createCollider(desc, body);
      bodies.push(body);

      if (!visual) {
        const mesh = new THREE.Mesh(this.geoms[i], this.partMat(p.paint, shirtColor));
        mesh.scale.setScalar(s);
        mesh.castShadow = true;
        this.scene.add(mesh);
        meshes.push(mesh);
      }
    });

    for (const [a, b, ax, ay] of JOINTS) {
      const pa = PARTS[a];
      const pb = PARTS[b];
      const data = RAPIER.JointData.spherical(
        { x: (ax - pa.cx) * s, y: (ay - pa.cy) * s, z: 0 },
        { x: (ax - pb.cx) * s, y: (ay - pb.cy) * s, z: 0 }
      );
      this.world.createImpulseJoint(data, bodies[a], bodies[b], true);
    }

    const up = power * 0.28;
    bodies[1].applyImpulse({ x: dirX * power * 0.55, y: up * 0.55, z: dirZ * power * 0.55 }, true);
    bodies[0].applyImpulse({ x: dirX * power * 0.28, y: up * 0.3, z: dirZ * power * 0.28 }, true);
    bodies[2].applyImpulse({ x: dirX * power * 0.06, y: 0, z: dirZ * power * 0.06 }, true);
    bodies[1].applyTorqueImpulse({ x: (Math.random() - 0.5) * 3.2, y: (Math.random() - 0.5) * 4.0, z: (Math.random() - 0.5) * 3.2 }, true);
    bodies[3].applyTorqueImpulse({ x: (Math.random() - 0.5) * 1.4, y: 0, z: (Math.random() - 0.5) * 1.4 }, true);
    bodies[4].applyTorqueImpulse({ x: (Math.random() - 0.5) * 1.4, y: 0, z: (Math.random() - 0.5) * 1.4 }, true);

    let figure: THREE.Group | null = null;
    let binds: BoneBind[] = [];
    let skins: THREE.SkinnedMesh[] = [];
    if (visual) {
      const fig = cloneBattleFigure(visual.kit, visual.slot);
      poseIdle(fig);
      fig.group.position.set(x, 0, z);
      fig.group.rotation.y = yaw;
      fig.group.scale.setScalar(s);
      this.scene.add(fig.group);
      fig.group.updateMatrixWorld(true);
      skins = collectSkins(fig.group);
      for (const mesh of skins) mesh.skeleton.update();
      const bones = collectBones(skins);
      binds = bones
        .filter((bone) => !/Ctrl|IK|Roll|Heel|_end$/i.test(bone.name))
        .map((bone) => {
          const part = bonePart(bone.name);
          const t = bodies[part]!.translation();
          const r = bodies[part]!.rotation();
          this._q.set(r.x, r.y, r.z, r.w);
          this._p.set(t.x, t.y, t.z);
          this._bodyM.compose(this._p, this._q, this._one);
          const offset = new THREE.Matrix4().copy(this._bodyM).invert().multiply(bone.matrixWorld);
          return { bone, part, offset };
        });
      figure = fig.group;
    }

    const handle: RagdollHandle = { age: 0, bodies, meshes, figure, binds, skins, cannon, chainHits: 0 };
    this.sync(handle);
    return handle;
  }

  driveStand(h: RagdollHandle) {
    if (h.age > 0.18) return;
    const k = 1 - h.age / 0.18;
    h.bodies[0].applyImpulse({ x: 0, y: 1.1 * k, z: 0 }, true);
  }

  sync(h: RagdollHandle) {
    if (h.figure && h.binds.length) {
      this.syncBones(h);
      return;
    }
    for (let i = 0; i < h.meshes.length; i++) {
      const t = h.bodies[i].translation();
      const r = h.bodies[i].rotation();
      h.meshes[i].position.set(t.x, t.y, t.z);
      h.meshes[i].quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  private syncBones(h: RagdollHandle) {
    for (const bind of h.binds) {
      const t = h.bodies[bind.part].translation();
      const r = h.bodies[bind.part].rotation();
      this._q.set(r.x, r.y, r.z, r.w);
      this._p.set(t.x, t.y, t.z);
      this._bodyM.compose(this._p, this._q, this._one).multiply(bind.offset);
      const parent = bind.bone.parent;
      if (parent) {
        this._invP.copy(parent.matrixWorld).invert();
        bind.bone.matrix.copy(this._invP).multiply(this._bodyM);
      } else {
        bind.bone.matrix.copy(this._bodyM);
      }
      bind.bone.matrix.decompose(bind.bone.position, bind.bone.quaternion, bind.bone.scale);
      bind.bone.updateMatrixWorld(true);
    }
    for (const mesh of h.skins) mesh.skeleton.update();
  }

  isSettled(h: RagdollHandle): boolean {
    const v = h.bodies[0].linvel();
    const w = h.bodies[0].angvel();
    const lin = v.x * v.x + v.y * v.y + v.z * v.z;
    const ang = w.x * w.x + w.y * w.y + w.z * w.z;
    return lin < 0.5 && ang < 3.5;
  }

  isSane(h: RagdollHandle): boolean {
    const p = h.bodies[0].translation();
    return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && Math.abs(p.x) < 80 && Math.abs(p.z) < 80 && p.y > -4 && p.y < 12;
  }

  pelvisPos(h: RagdollHandle) {
    return h.bodies[0].translation();
  }

  despawn(h: RagdollHandle) {
    for (const m of h.meshes) this.scene.remove(m);
    if (h.figure) this.scene.remove(h.figure);
    for (const b of h.bodies) this.world.removeRigidBody(b);
    h.figure = null;
    h.binds.length = 0;
    h.skins.length = 0;
  }
}
