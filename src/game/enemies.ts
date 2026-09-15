import * as THREE from 'three/webgpu';
import RAPIER from '@dimforge/rapier3d-compat';
import { FlowField } from '../sim/flowfield';
import { ENEMY_CUT_GROUPS, ENEMY_GROUPS } from '../sim/physics';
import { RagdollFactory, type RagdollHandle } from './ragdoll';
import type { HumanoidKit } from './humanoid';
import { enemySkillFx, type CrowdActorId, type EnemySkillId } from '../fx/catalog';
import { sfx } from '../audio';

export interface SkillTarget {
  applySlow(duration: number, factor: number): void
  stun(duration: number): void
  vx: number
  vz: number
}

export enum EState { Inactive = 0, Chase = 1, Knock = 2, Ragdoll = 3, Getup = 4 }

/**
 * 敌人体系：每种类型只违反基础规则（被玩家吸引、可被撞开）中的一条。
 * A 普通同事：成群追玩家，可撞飞。
 * C 重量级：用身体封必经窄口，冲刺撞不动；被引出来后全场最快，回家也快，把门重新封上。
 * F 拦截者：抢占玩家通往电梯的前方卡口，不追当前位置。
 */
export enum EType { A = 0, C = 1, F = 2 }

const PALETTE = [0x4f8fe8, 0x5fbf72, 0xe0a24a, 0xd45c5c, 0x8b6fd4, 0x4fc0d8, 0xd44f9a, 0x8aa04a];
const COLOR_C = 0x37415c;
const COLOR_F = 0xe05252;

const RAGDOLL_IMPULSE = 400;
const STAGGER_TO_RAGDOLL = 3;
/** 被引开后最远离开卡口这么远，再远就强制回家 */
const HEAVY_LEASH = 12;
/** 要贴到卡口这么近才勾引成功 */
const HEAVY_ZONE = 3;
/** 玩家离开这片区域才脱仇（按离锚点，不按有没有跑过主管） */
const HEAVY_LOSE = 14;
/** 主管归位后站岗半径 */
const HEAVY_POST = 0.55;
/** 被勾引后加快，但仍慢于玩家，避免两个人夹死 */
const HEAVY_SPRINT = 3.6;
/** F 认为已经抢到拦截点 */
const INTERCEPT_ARRIVE = 1.25;
/** 已占点时，玩家挤过来才上前堵 */
const INTERCEPT_ENGAGE = 1.45;
/** 贴身交任务半径 */
const CHANNEL_RANGE = 1.15;
/** 本局第一次交任务（让几乎每局都会加时） */
const CHANNEL_FIRST = 0.45;
/** 之后：普通/拦截 */
const CHANNEL_NEED_A = 0.85;
/** 之后：主管 */
const CHANNEL_NEED_C = 1.2;
/** 离开范围后先停这么久再掉进度 */
const CHANNEL_GRACE = 0.25;
/** 离身掉进度倍率（秒进度 / 秒），原先是 2 */
const CHANNEL_DECAY = 0.6;

export interface HitOpts {
  /** 直接布娃娃（冲刺/椅子） */
  force?: boolean;
  /** 允许对重量级生效（只有高速椅子给 true） */
  heavyOk?: boolean;
  /** 这次倒地是玩家冲刺打出的，蛮力可当炮弹 */
  cannon?: boolean;
}

export class Enemies {
  readonly cap: number;

  state: Uint8Array;
  types: Uint8Array;
  private bodies: (RAPIER.RigidBody | null)[];
  private rags: (RagdollHandle | null)[];
  private speed: Float32Array;
  private colorIdx: Uint8Array;
  private knockT: Float32Array;
  private channelT: Float32Array;
  /** 离开贴身范围后的宽限，宽限内不掉读条 */
  private channelAwayT: Float32Array;
  /** 本局是否已经交过一次任务 */
  private deliveredOnce = false;
  private getupT: Float32Array;
  private staggT: Float32Array;
  private stagger: Uint8Array;
  private yaw: Float32Array;
  private bobPhase: Float32Array;
  /** 各自的步态时钟，避免挤成一团时齐步乱闪 */
  private walkClock: Float32Array;
  private gait: Uint8Array;
  /** 1 = 站岗/占点，转向看玩家而不是速度 */
  private posting: Uint8Array;
  /** 1 = 拦截者正在赶往卡口，逆行穿过人潮 */
  private rushing: Uint8Array;
  /** 1 = 主管已被勾引，正在压向玩家 */
  private aggro: Uint8Array;
  private aimPX = 0;
  private aimPZ = 0;
  /** 平滑后的水平速度，主管转向只看这个，不跟物理抖动 */
  private faceX: Float32Array;
  private faceZ: Float32Array;
  private visTime = 0;
  private anchorX: Float32Array;
  private anchorZ: Float32Array;
  posX: Float32Array;
  posZ: Float32Array;
  private velX: Float32Array;
  private velZ: Float32Array;
  private slowT: Float32Array;
  private slowMul: Float32Array;
  private stunFxT: Float32Array;
  private skill: string[];
  private skillCd: Float32Array;
  private skillWind: Float32Array;
  private burstT: Float32Array;
  private burstX: Float32Array;
  private burstZ: Float32Array;
  private shoutT: Float32Array;
  private hasteT: Float32Array;
  private hasteMul: Float32Array;
  private rallyLeft = 2;
  skillOf: ((id: CrowdActorId) => EnemySkillId | null) | null = null;
  onSkill: ((id: EnemySkillId, phase: 'windup' | 'fire', x: number, z: number, i: number) => void) | null = null;
  private ragCount = 0;
  private static readonly MAX_RAG = 8;

  /** F 拦截流场（目标 = 通往电梯的前方卡口），由 Game 维护 */
  interceptFlow: FlowField | null = null;
  interceptAtX = 0;
  interceptAtZ = 0;

  private gender: Uint8Array;
  /** pose 0 = idle，其后为 run 循环帧。0 普通男 / 1 普通女 / 2 重量级 / 3 拦截者 */
  private poseSets: THREE.InstancedMesh[][] = [];
  /** 与 poseSets / BATTLE_SLOT_IDS 对齐；无发型则为 null */
  private hairMeshes: (THREE.InstancedMesh | null)[] = [];
  private hatMeshes: (THREE.InstancedMesh | null)[] = [];
  private heldMeshes: (THREE.InstancedMesh | null)[] = [];
  private backMeshes: (THREE.InstancedMesh | null)[] = [];
  private kitHairMeshes: (THREE.InstancedMesh | null)[] = [];
  /** 与 poseSets 同槽；无裙则为 null */
  private skirtPoseSets: (THREE.InstancedMesh[] | null)[] = [];
  private tmpHair = new THREE.Matrix4();
  private blobMesh: THREE.InstancedMesh;
  private lastPose: Uint8Array;
  private lastBody: THREE.Matrix4[];
  private tmpGlow = new THREE.Matrix4();

  private tmpM = new THREE.Matrix4();
  private tmpM2 = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpQL = new THREE.Quaternion();
  private tmpQR = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private tmpAxis = new THREE.Vector3();
  private flowDir = { x: 0, z: 0 };

  private hash = new Map<number, number[]>();

  onTaskDelivered: ((type: EType, x: number, z: number, gender: number) => void) | null = null;
  /** 每次同事被放倒（进入布娃娃）时回调，用于掉落工牌 */
  onKnockdown: ((type: EType, x: number, z: number, gender: number) => void) | null = null;

  constructor(
    private scene: THREE.Scene,
    private world: RAPIER.World,
    private flow: FlowField,
    private ragFactory: RagdollFactory,
    capacity: number,
    private kit: HumanoidKit
  ) {
    this.cap = capacity;
    this.state = new Uint8Array(capacity);
    this.types = new Uint8Array(capacity);
    this.bodies = new Array(capacity).fill(null);
    this.rags = new Array(capacity).fill(null);
    this.speed = new Float32Array(capacity);
    this.colorIdx = new Uint8Array(capacity);
    this.knockT = new Float32Array(capacity);
    this.channelT = new Float32Array(capacity);
    this.channelAwayT = new Float32Array(capacity);
    this.getupT = new Float32Array(capacity);
    this.staggT = new Float32Array(capacity);
    this.stagger = new Uint8Array(capacity);
    this.yaw = new Float32Array(capacity);
    this.bobPhase = new Float32Array(capacity);
    this.walkClock = new Float32Array(capacity);
    this.gait = new Uint8Array(capacity);
    this.posting = new Uint8Array(capacity);
    this.rushing = new Uint8Array(capacity);
    this.aggro = new Uint8Array(capacity);
    this.faceX = new Float32Array(capacity);
    this.faceZ = new Float32Array(capacity);
    this.anchorX = new Float32Array(capacity);
    this.anchorZ = new Float32Array(capacity);
    this.gender = new Uint8Array(capacity);
    this.posX = new Float32Array(capacity);
    this.posZ = new Float32Array(capacity);
    this.velX = new Float32Array(capacity);
    this.velZ = new Float32Array(capacity);
    this.slowT = new Float32Array(capacity);
    this.slowMul = new Float32Array(capacity);
    this.stunFxT = new Float32Array(capacity);
    this.skill = new Array(capacity).fill('');
    this.skillCd = new Float32Array(capacity);
    this.skillWind = new Float32Array(capacity);
    this.burstT = new Float32Array(capacity);
    this.burstX = new Float32Array(capacity);
    this.burstZ = new Float32Array(capacity);
    this.shoutT = new Float32Array(capacity);
    this.hasteT = new Float32Array(capacity);
    this.hasteMul = new Float32Array(capacity);
    this.lastPose = new Uint8Array(capacity);
    this.lastBody = Array.from({ length: capacity }, () => new THREE.Matrix4());

    const blobGeo = new THREE.CircleGeometry(0.34, 14);
    blobGeo.rotateX(-Math.PI / 2);

    const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false });

    const poseMats = [kit.maleMat, kit.femaleMat, kit.heavyMat, kit.interceptorMat];
    for (let s = 0; s < poseMats.length; s++) {
      const geos = kit.slotGeos[s]?.length ? kit.slotGeos[s] : [kit.geometry, ...kit.walkGeos];
      const poses: THREE.InstancedMesh[] = [];
      for (const geo of geos) poses.push(new THREE.InstancedMesh(geo, poseMats[s], capacity));
      this.poseSets.push(poses);
    }

    const fillAttach = (src: (typeof kit.slotHair)[number][], dest: (THREE.InstancedMesh | null)[]) => {
      for (const item of src) {
        if (!item) {
          dest.push(null);
          continue;
        }
        dest.push(new THREE.InstancedMesh(item.geometry, item.material, capacity));
      }
    };
    fillAttach(kit.slotHair, this.hairMeshes);
    fillAttach(kit.slotHat, this.hatMeshes);
    fillAttach(kit.slotHeld, this.heldMeshes);
    fillAttach(kit.slotBack, this.backMeshes);
    fillAttach(kit.slotKitHair, this.kitHairMeshes);

    for (let s = 0; s < poseMats.length; s++) {
      const geos = kit.slotSkirtGeos[s];
      const mat = kit.slotSkirtMat[s];
      if (!geos?.length || !mat) {
        this.skirtPoseSets.push(null);
        continue;
      }
      this.skirtPoseSets.push(geos.map((geo) => new THREE.InstancedMesh(geo, mat, capacity)));
    }

    this.blobMesh = new THREE.InstancedMesh(blobGeo, blobMat, capacity);

    const attachLive = [...this.hairMeshes, ...this.hatMeshes, ...this.heldMeshes, ...this.backMeshes, ...this.kitHairMeshes].filter(
      (m): m is THREE.InstancedMesh => !!m
    );
    const skirtLive = this.skirtPoseSets.flatMap((set) => set ?? []);
    for (const mesh of [...this.poseSets.flat(), ...attachLive, ...skirtLive]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    this.blobMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.blobMesh);

    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) {
      for (const mesh of this.poseSets.flat()) mesh.setMatrixAt(i, zero);
      for (const mesh of this.hairMeshes) mesh?.setMatrixAt(i, zero);
      for (const mesh of this.hatMeshes) mesh?.setMatrixAt(i, zero);
      for (const mesh of this.heldMeshes) mesh?.setMatrixAt(i, zero);
      for (const mesh of this.backMeshes) mesh?.setMatrixAt(i, zero);
      for (const mesh of this.kitHairMeshes) mesh?.setMatrixAt(i, zero);
      for (const set of this.skirtPoseSets) {
        if (!set) continue;
        for (const mesh of set) mesh.setMatrixAt(i, zero);
      }
      this.blobMesh.setMatrixAt(i, zero);
    }
  }

  get activeCount() {
    let n = 0;
    for (let i = 0; i < this.cap; i++) if (this.state[i] !== EState.Inactive) n++;
    return n;
  }

  /** 再试一次：清掉所有活人/布娃娃，下一波重新刷 */
  clearAll() {
    for (let i = 0; i < this.cap; i++) {
      if (this.state[i] === EState.Inactive && !this.bodies[i] && !this.rags[i]) continue;
      const rag = this.rags[i];
      if (rag) {
        this.ragFactory.despawn(rag);
        this.rags[i] = null;
      }
      const body = this.bodies[i];
      if (body) {
        this.world.removeRigidBody(body);
        this.bodies[i] = null;
      }
      this.state[i] = EState.Inactive;
      this.clearChannel(i);
    }
    this.ragCount = 0;
    this.deliveredOnce = false;
    this.resetSkills();
  }

  /** 体型缩放（渲染 + 布娃娃 + 命中半径共用） */
  private scaleOf(i: number) {
    const fromKit = this.kit.slotScale[this.poseSetOf(i)];
    if (fromKit && fromKit > 0) return fromKit;
    return this.types[i] === EType.C ? 1.38 : 1;
  }

  private hitRadiusOf(i: number) {
    return 0.42 * this.scaleOf(i);
  }

  private colorOf(i: number) {
    const t = this.types[i];
    if (t === EType.C) return COLOR_C;
    if (t === EType.F) return COLOR_F;
    return PALETTE[this.colorIdx[i]];
  }

  spawn(x: number, z: number, type: EType = EType.A): boolean {
    for (let i = 0; i < this.cap; i++) {
      if (this.state[i] !== EState.Inactive) continue;
      this.state[i] = EState.Chase;
      this.types[i] = type;
      this.colorIdx[i] = (Math.random() * PALETTE.length) | 0;
      this.bobPhase[i] = Math.random() * Math.PI * 2;
      this.walkClock[i] = Math.random() * 8;
      this.gait[i] = 0;
      this.posting[i] = 0;
      this.rushing[i] = 0;
      this.aggro[i] = 0;
      this.faceX[i] = 0;
      this.faceZ[i] = 0;
      this.stagger[i] = 0;
      this.clearChannel(i);
      this.anchorX[i] = x;
      this.anchorZ[i] = z;
      this.gender[i] = type === EType.A && Math.random() < 0.5 ? 1 : 0;
      this.speed[i] =
        type === EType.C ? 1.0 + Math.random() * 0.2 :
        type === EType.F ? 3.2 + Math.random() * 0.3 :
        2.1 + Math.random() * 0.9;
      this.slowT[i] = 0;
      this.slowMul[i] = 1;
      this.stunFxT[i] = 0;
      this.hasteT[i] = 0;
      this.hasteMul[i] = 1;
      this.burstT[i] = 0;
      this.shoutT[i] = 0;
      this.bindSkill(i);
      this.createBody(i, x, z);
      return true;
    }
    return false;
  }

  private createBody(i: number, x: number, z: number) {
    const heavy = this.types[i] === EType.C;
    const s = this.scaleOf(i);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, 0.66 * s, z)
        .lockRotations()
        .setLinearDamping(2.5)
    );
    const desc = heavy
      ? RAPIER.ColliderDesc.capsule(0.35 * s, 0.3 * s).setMass(220).setFriction(0.3)
      : RAPIER.ColliderDesc.capsule(0.35 * s, 0.3 * s).setMass(60).setFriction(0.2);
    desc.setCollisionGroups(this.types[i] === EType.F ? ENEMY_CUT_GROUPS : ENEMY_GROUPS);
    this.world.createCollider(desc, body);
    this.bodies[i] = body;
    this.posX[i] = x;
    this.posZ[i] = z;
  }

  raycastSegment(x0: number, z0: number, x1: number, z1: number): number {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const lenSq = dx * dx + dz * dz || 1e-9;
    let best = -1;
    let bestT = Infinity;
    for (let i = 0; i < this.cap; i++) {
      const s = this.state[i];
      if (s !== EState.Chase && s !== EState.Knock && s !== EState.Getup) continue;
      const R = this.hitRadiusOf(i);
      const px = this.posX[i] - x0;
      const pz = this.posZ[i] - z0;
      let t = (px * dx + pz * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const ex = px - dx * t;
      const ez = pz - dz * t;
      if (ex * ex + ez * ez < R * R && t < bestT) {
        best = i;
        bestT = t;
      }
    }
    return best;
  }

  hit(i: number, dirX: number, dirZ: number, impulse: number, opts: HitOpts = {}) {
    const s = this.state[i];
    if (s === EState.Inactive) return;
    if (s === EState.Ragdoll) {
      const rag = this.rags[i];
      if (rag) rag.bodies[1].applyImpulse({ x: dirX * impulse * 0.5, y: impulse * 0.2, z: dirZ * impulse * 0.5 }, true);
      return;
    }

    const heavy = this.types[i] === EType.C;
    if (heavy) {
      // 重量级：只有高速椅子能砸翻；其余攻击只能微推 + 打断读条
      if (opts.force && opts.heavyOk) {
        this.toRagdoll(i, dirX, dirZ, Math.min(impulse, 900), opts.cannon === true);
        return;
      }
      this.clearChannel(i);
      this.bodies[i]!.applyImpulse({ x: dirX * impulse * 0.25, y: 0, z: dirZ * impulse * 0.25 }, true);
      return;
    }

    this.stagger[i]++;
    this.staggT[i] = 1.3;
    this.clearChannel(i);

    if (opts.force || impulse >= RAGDOLL_IMPULSE || this.stagger[i] >= STAGGER_TO_RAGDOLL) {
      this.toRagdoll(i, dirX, dirZ, Math.min(Math.max(impulse * 0.85, 200), 500), opts.cannon === true);
      return;
    }
    const body = this.bodies[i]!;
    body.applyImpulse({ x: dirX * impulse, y: impulse * 0.12, z: dirZ * impulse }, true);
    this.state[i] = EState.Knock;
    this.knockT[i] = Math.max(this.knockT[i], 0.35);
  }

  toRagdoll(i: number, dirX: number, dirZ: number, power: number, cannon = false) {
    const body = this.bodies[i];
    if (!body) return;
    if (this.ragCount >= Enemies.MAX_RAG) this.recycleOldestRagdoll();
    const t = body.translation();
    this.world.removeRigidBody(body);
    this.bodies[i] = null;
    this.rags[i] = this.ragFactory.spawn(
      t.x,
      t.z,
      this.colorOf(i),
      dirX,
      dirZ,
      power,
      this.scaleOf(i),
      cannon,
      { kit: this.kit, slot: this.poseSetOf(i), yaw: this.yaw[i] }
    );
    this.state[i] = EState.Ragdoll;
    this.stagger[i] = 0;
    this.ragCount++;
    this.onKnockdown?.(this.types[i] as EType, t.x, t.z, this.gender[i]);
  }

  private finishRagdoll(i: number) {
    const rag = this.rags[i];
    if (!rag) return;
    const p = this.ragFactory.pelvisPos(rag);
    const sane = this.ragFactory.isSane(rag);
    this.ragFactory.despawn(rag);
    this.rags[i] = null;
    this.ragCount--;
    const [rx, rz] = this.findFreeSpot(sane ? p.x : this.posX[i], sane ? p.z : this.posZ[i]);
    this.createBody(i, rx, rz);
    this.state[i] = EState.Getup;
    this.getupT[i] = 0.65;
    sfx.play('getup');
  }

  private recycleOldestRagdoll() {
    let best = -1;
    let bestAge = -1;
    for (let i = 0; i < this.cap; i++) {
      if (this.state[i] !== EState.Ragdoll || !this.rags[i]) continue;
      if (this.rags[i]!.age > bestAge) {
        bestAge = this.rags[i]!.age;
        best = i;
      }
    }
    if (best < 0) return;
    this.finishRagdoll(best);
    this.getupT[best] = 0.45;
  }

  /** 幻影穿身：打断读条并短暂定住（对重量级同样有效，但不摔倒） */
  stun(i: number, dur = 0.9) {
    const s = this.state[i];
    if (s !== EState.Chase && s !== EState.Knock) return;
    this.clearChannel(i);
    this.state[i] = EState.Knock;
    this.knockT[i] = Math.max(this.knockT[i], dur);
    this.stunFxT[i] = Math.max(this.stunFxT[i], dur);
  }

  stunLeft(i: number) {
    return this.stunFxT[i];
  }

  slowLeft(i: number) {
    return this.slowT[i];
  }

  /** 咖啡渍滑倒：只对追击中且在移动的普通/拦截者生效 */
  slip(i: number) {
    if (this.state[i] !== EState.Chase || this.types[i] === EType.C) return;
    const b = this.bodies[i];
    if (!b) return;
    const v = b.linvel();
    const sp = Math.hypot(v.x, v.z);
    if (sp < 1.2) return;
    sfx.play('slick_slip');
    this.toRagdoll(i, v.x / sp, v.z / sp, 150 + sp * 30);
  }

  /** 倦怠：追击中的同事减速。默认不管主管。 */
  slow(i: number, duration: number, factor: number, allowHeavy = false) {
    const s = this.state[i];
    if (s !== EState.Chase && s !== EState.Knock && s !== EState.Getup) return;
    if (this.types[i] === EType.C && !allowHeavy) return;
    this.slowT[i] = Math.max(this.slowT[i], duration);
    this.slowMul[i] = Math.min(this.slowMul[i] || 1, factor);
  }

  slowAround(
    x: number,
    z: number,
    radius: number,
    duration: number,
    factor: number,
    allowHeavy: boolean | ((i: number) => boolean) = false
  ) {
    const rr = radius * radius;
    const pred = typeof allowHeavy === 'function' ? allowHeavy : null;
    const heavyOk = allowHeavy === true;
    for (let i = 0; i < this.cap; i++) {
      const dx = this.posX[i] - x;
      const dz = this.posZ[i] - z;
      if (dx * dx + dz * dz > rr) continue;
      if (pred) {
        if (!pred(i)) continue;
        this.slow(i, duration, factor, true);
      } else {
        this.slow(i, duration, factor, heavyOk);
      }
    }
  }

  isChanneling(i: number) {
    return this.state[i] === EState.Chase && this.channelT[i] > 0.12;
  }

  bodyScale(i: number) {
    return this.scaleOf(i);
  }

  resetSkills() {
    this.rallyLeft = 2;
  }

  private bindSkill(i: number) {
    const id = this.skillOf?.(this.actorId(i)) ?? null;
    if (id === 'rally') {
      if (this.rallyLeft <= 0) {
        this.skill[i] = '';
        return;
      }
      this.rallyLeft -= 1;
    }
    this.skill[i] = id ?? '';
    this.skillCd[i] = 1.2;
    this.skillWind[i] = 0;
  }

  boostAround(x: number, z: number, radius: number, duration: number, mul: number, pred?: (i: number) => boolean) {
    const r2 = radius * radius;
    for (let i = 0; i < this.cap; i++) {
      if (this.state[i] === EState.Inactive) continue;
      if (pred && !pred(i)) continue;
      const dx = this.posX[i] - x;
      const dz = this.posZ[i] - z;
      if (dx * dx + dz * dz > r2) continue;
      this.hasteT[i] = Math.max(this.hasteT[i], duration);
      this.hasteMul[i] = Math.max(this.hasteMul[i] || 1, mul);
    }
  }

  bursting(i: number) {
    return this.burstT[i] > 0;
  }

  hastening(i: number) {
    return this.hasteT[i] > 0;
  }

  yawOf(i: number) {
    return this.yaw[i];
  }

  handWorld(i: number, out: THREE.Vector3, left = false) {
    const pose = this.lastPose[i] ?? 0;
    const locals = left ? this.kit.leftHandLocals : this.kit.handLocals;
    const bone = locals[pose] ?? locals[0];
    if (!bone) return out.set(this.posX[i], 0.95, this.posZ[i]);
    this.tmpGlow.copy(this.lastBody[i]!).multiply(bone);
    return out.setFromMatrixPosition(this.tmpGlow);
  }

  actorId(i: number): CrowdActorId {
    const t = this.types[i];
    if (t === EType.C) return 'heavy';
    if (t === EType.F) return 'interceptor';
    return this.gender[i] ? 'colleague-a-f' : 'colleague-a-m';
  }

  private clearChannel(i: number) {
    this.channelT[i] = 0;
    this.channelAwayT[i] = 0;
  }

  private channelNeedOf(i: number) {
    if (!this.deliveredOnce) return CHANNEL_FIRST;
    return this.types[i] === EType.C ? CHANNEL_NEED_C : CHANNEL_NEED_A;
  }

  private decayChannel(i: number, dt: number) {
    this.channelAwayT[i] += dt;
    if (this.channelAwayT[i] < CHANNEL_GRACE) return;
    this.channelT[i] = Math.max(0, this.channelT[i] - dt * CHANNEL_DECAY);
    if (this.channelT[i] <= 0) this.channelAwayT[i] = 0;
  }

  /** 隐藏地板：范围内的同事直接弹飞（含主管） */
  flingAround(x: number, z: number, radius: number, impulse: number, lift: number) {
    const r2 = radius * radius;
    for (let i = 0; i < this.cap; i++) {
      const s = this.state[i];
      if (s === EState.Inactive || s === EState.Ragdoll) continue;
      const body = this.bodies[i];
      if (!body) continue;
      const t = body.translation();
      const dx = t.x - x;
      const dz = t.z - z;
      if (dx * dx + dz * dz > r2) continue;
      const len = Math.hypot(dx, dz);
      const dirX = len > 0.08 ? dx / len : 1;
      const dirZ = len > 0.08 ? dz / len : 0;
      this.hit(i, dirX, dirZ, impulse, { force: true, heavyOk: true });
      const rag = this.rags[i];
      if (rag) rag.bodies[1].applyImpulse({ x: dirX * impulse * 0.15, y: lift, z: dirZ * impulse * 0.15 }, true);
      else this.bodies[i]?.applyImpulse({ x: dirX * impulse * 0.2, y: lift, z: dirZ * impulse * 0.2 }, true);
    }
  }

  /** 蛮力 LV3：把重量级推开（不摔，纯位移 + 打断读条） */
  shove(i: number, dirX: number, dirZ: number, impulse: number) {
    const b = this.bodies[i];
    if (!b) return;
    this.clearChannel(i);
    b.applyImpulse({ x: dirX * impulse, y: 0, z: dirZ * impulse }, true);
  }

  /** 主页运镜：全体同事改追给定点，忽略守门/拦截 */
  private forceChase = false;

  halt() {
    for (let i = 0; i < this.cap; i++) {
      const b = this.bodies[i];
      if (!b || this.state[i] === EState.Inactive) continue;
      const v = b.linvel();
      b.setLinvel({ x: 0, y: v.y, z: 0 }, true);
    }
  }

  /** 定格：停步、切 idle，不再原地跑 */
  freezeStill() {
    this.halt();
    for (let i = 0; i < this.cap; i++) {
      if (this.state[i] === EState.Inactive) continue;
      this.gait[i] = 0;
      this.faceX[i] = 0;
      this.faceZ[i] = 0;
      this.posting[i] = 0;
      this.rushing[i] = 0;
    }
  }

  /** 回到出生点，供主页运镜重播 / 开局 */
  restoreAnchors() {
    for (let i = 0; i < this.cap; i++) {
      const b = this.bodies[i];
      if (!b || this.state[i] === EState.Inactive) continue;
      if (this.state[i] === EState.Ragdoll) continue;
      const y = this.types[i] === EType.C ? 0.92 : 0.66;
      b.setTranslation({ x: this.anchorX[i], y, z: this.anchorZ[i] }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.posX[i] = this.anchorX[i];
      this.posZ[i] = this.anchorZ[i];
      this.velX[i] = 0;
      this.velZ[i] = 0;
      this.state[i] = EState.Chase;
      this.gait[i] = 0;
      this.posting[i] = 0;
      this.rushing[i] = 0;
      this.aggro[i] = 0;
      this.clearChannel(i);
      this.faceX[i] = 0;
      this.faceZ[i] = 0;
    }
  }

  update(
    dt: number,
    playerX: number,
    playerZ: number,
    opts?: { suppressChannel?: boolean; bruteChain?: boolean; forceChase?: boolean; skillTarget?: SkillTarget }
  ) {
    this.forceChase = opts?.forceChase === true;
    this.aimPX = playerX;
    this.aimPZ = playerZ;
    this.hash.clear();
    for (let i = 0; i < this.cap; i++) {
      const s = this.state[i];
      if (s !== EState.Chase && s !== EState.Knock && s !== EState.Getup) continue;
      const b = this.bodies[i]!;
      const t = b.translation();
      this.posX[i] = t.x;
      this.posZ[i] = t.z;
      const v = b.linvel();
      this.velX[i] = v.x;
      this.velZ[i] = v.z;
      const key = (Math.floor(t.x + 40) << 8) | Math.floor(t.z + 40);
      let arr = this.hash.get(key);
      if (!arr) this.hash.set(key, (arr = []));
      arr.push(i);
    }

    for (let i = 0; i < this.cap; i++) {
      switch (this.state[i]) {
        case EState.Chase:
          this.updateChase(i, dt, playerX, playerZ, opts?.suppressChannel === true, opts?.skillTarget);
          break;
        case EState.Knock:
          this.knockT[i] -= dt;
          if (this.knockT[i] <= 0) this.state[i] = EState.Chase;
          break;
        case EState.Ragdoll: this.updateRagdoll(i, dt); break;
        case EState.Getup: {
          this.getupT[i] -= dt;
          const b = this.bodies[i]!;
          const v = b.linvel();
          b.setLinvel({ x: 0, y: v.y, z: 0 }, true);
          if (this.getupT[i] <= 0) this.state[i] = EState.Chase;
          break;
        }
      }
      if (this.staggT[i] > 0) {
        this.staggT[i] -= dt;
        if (this.staggT[i] <= 0) this.stagger[i] = 0;
      }
      if (this.stunFxT[i] > 0) this.stunFxT[i] = Math.max(0, this.stunFxT[i] - dt);
    }

    if (opts?.bruteChain) this.updateBruteChain();
  }

  /** 蛮力：只有玩家撞飞的那具布娃娃能当炮弹，且每人最多再放倒一个，避免人堆核爆 */
  private updateBruteChain() {
    const taken = new Set<number>();
    for (let i = 0; i < this.cap; i++) {
      if (this.state[i] !== EState.Ragdoll) continue;
      const rag = this.rags[i];
      if (!rag?.cannon || rag.chainHits >= 1 || rag.age > 0.55) continue;
      const torso = rag.bodies[1];
      const v = torso.linvel();
      const sp = Math.hypot(v.x, v.z);
      if (sp < 7.5) continue;
      const t = torso.translation();
      const cx = Math.floor(t.x + 40);
      const cz = Math.floor(t.z + 40);
      let best = -1;
      let bestD = 0.58 * 0.58;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const arr = this.hash.get(((cx + ox) << 8) | (cz + oz));
          if (!arr) continue;
          for (const j of arr) {
            if (taken.has(j)) continue;
            const dx = this.posX[j] - t.x;
            const dz = this.posZ[j] - t.z;
            const dSq = dx * dx + dz * dz;
            if (dSq < bestD) {
              bestD = dSq;
              best = j;
            }
          }
        }
      }
      if (best < 0) continue;
      taken.add(best);
      rag.chainHits++;
      this.hit(best, v.x / sp, v.z / sp, 240, { force: true });
    }
  }

  /** 各类型的追踪目标方向。A 追人；C 守防区；F 抢电梯卡口。 */
  private steerDir(i: number, px: number, pz: number, distSq: number, outDir: { x: number; z: number }) {
    const x = this.posX[i];
    const z = this.posZ[i];
    const type = this.types[i];

    if (!this.forceChase && type === EType.C) {
      this.steerHeavy(i, px, pz, outDir);
      return;
    }
    if (!this.forceChase && type === EType.F) {
      this.steerInterceptor(i, px, pz, distSq, outDir);
      return;
    }

    this.posting[i] = 0;
    this.rushing[i] = 0;
    if (distSq < 2.8 * 2.8) {
      const d = Math.sqrt(distSq) || 1;
      outDir.x = (px - x) / d;
      outDir.z = (pz - z) / d;
      return;
    }
    this.flow.sample(x, z, outDir);
    if (outDir.x === 0 && outDir.z === 0) this.toward(px, pz, x, z, outDir);
  }

  private toward(tx: number, tz: number, x: number, z: number, outDir: { x: number; z: number }) {
    const dx = tx - x;
    const dz = tz - z;
    const d = Math.hypot(dx, dz) || 1;
    outDir.x = dx / d;
    outDir.z = dz / d;
  }

  private steerHeavy(i: number, px: number, pz: number, outDir: { x: number; z: number }) {
    const x = this.posX[i];
    const z = this.posZ[i];
    const ax = this.anchorX[i] - x;
    const az = this.anchorZ[i] - z;
    const aDist = Math.hypot(ax, az);
    const pFromAnchor = Math.hypot(px - this.anchorX[i], pz - this.anchorZ[i]);

    this.rushing[i] = 0;
    if (aDist > HEAVY_LEASH) {
      this.aggro[i] = 0;
      this.posting[i] = 0;
      this.toward(this.anchorX[i], this.anchorZ[i], x, z, outDir);
      return;
    }
    if (pFromAnchor < HEAVY_ZONE) this.aggro[i] = 1;
    else if (pFromAnchor > HEAVY_LOSE) this.aggro[i] = 0;
    if (this.aggro[i] && aDist < HEAVY_LEASH - 0.25) {
      this.posting[i] = 0;
      this.toward(px, pz, x, z, outDir);
      return;
    }
    if (aDist > HEAVY_POST) {
      this.posting[i] = 0;
      this.toward(this.anchorX[i], this.anchorZ[i], x, z, outDir);
      return;
    }
    this.posting[i] = 1;
    outDir.x = 0;
    outDir.z = 0;
  }

  private steerInterceptor(i: number, px: number, pz: number, distSq: number, outDir: { x: number; z: number }) {
    const x = this.posX[i];
    const z = this.posZ[i];
    const dI = Math.hypot(this.interceptAtX - x, this.interceptAtZ - z);
    const dP = Math.sqrt(distSq);

    if (dI <= INTERCEPT_ARRIVE) {
      this.rushing[i] = 0;
      if (dP < INTERCEPT_ENGAGE) {
        this.posting[i] = 0;
        this.toward(px, pz, x, z, outDir);
      } else {
        this.posting[i] = 1;
        outDir.x = 0;
        outDir.z = 0;
      }
      return;
    }

    this.rushing[i] = 1;
    this.posting[i] = 0;
    if (this.interceptFlow) {
      this.interceptFlow.sample(x, z, outDir);
      if (outDir.x !== 0 || outDir.z !== 0) return;
    }
    this.toward(this.interceptAtX, this.interceptAtZ, x, z, outDir);
  }

  private tickSkill(i: number, dt: number, px: number, pz: number, target: SkillTarget) {
    const id = this.skill[i] as EnemySkillId | '';
    if (!id) return;
    const fx = enemySkillFx(id);
    if (this.skillCd[i] > 0) this.skillCd[i] -= dt;
    if (this.skillWind[i] > 0) {
      this.skillWind[i] -= dt;
      if (this.skillWind[i] <= 0) this.fireSkill(i, id, px, pz, target);
      return;
    }
    if (this.skillCd[i] > 0 || this.state[i] !== EState.Chase) return;
    const dist = Math.hypot(px - this.posX[i], pz - this.posZ[i]);
    let ready = false;
    if (id === 'cut-in') ready = this.types[i] === EType.F && dist < fx.radius;
    else if (id === 'desk-slam') ready = this.types[i] === EType.C && dist < fx.radius;
    else if (id === 'rally') ready = this.types[i] === EType.A && dist < fx.radius;
    if (!ready) return;
    this.skillWind[i] = fx.windup;
    this.skillCd[i] = fx.cooldown;
    this.onSkill?.(id, 'windup', this.posX[i], this.posZ[i], i);
  }

  private fireSkill(i: number, id: EnemySkillId, px: number, pz: number, target: SkillTarget) {
    const fx = enemySkillFx(id);
    this.onSkill?.(id, 'fire', this.posX[i], this.posZ[i], i);
    if (id === 'cut-in') {
      this.burstT[i] = fx.duration;
      this.burstX[i] = px + target.vx * 0.45;
      this.burstZ[i] = pz + target.vz * 0.45;
      target.stun(fx.lock ?? 2);
    } else if (id === 'desk-slam') {
      target.applySlow(fx.duration, fx.factor ?? 0.45);
    } else if (id === 'rally') {
      let factor = fx.factor ?? 0.5;
      if (factor > 1) factor = Math.max(0.25, 1 / factor);
      target.applySlow(fx.duration, factor);
      this.shoutT[i] = 0.55 + (fx.waves ?? 3) * (fx.waveGap ?? 0.14);
    }
  }

  private updateChase(i: number, dt: number, px: number, pz: number, suppressChannel: boolean, skillTarget?: SkillTarget) {
    const x = this.posX[i];
    const z = this.posZ[i];
    const dxp = px - x;
    const dzp = pz - z;
    const distSq = dxp * dxp + dzp * dzp;

    if (skillTarget) this.tickSkill(i, dt, px, pz, skillTarget);
    this.steerDir(i, px, pz, distSq, this.flowDir);
    if (this.burstT[i] > 0) {
      this.burstT[i] -= dt;
      this.toward(this.burstX[i], this.burstZ[i], x, z, this.flowDir);
    }
    if (this.skillWind[i] > 0) {
      this.flowDir.x = 0;
      this.flowDir.z = 0;
    }
    if (this.shoutT[i] > 0) {
      this.shoutT[i] -= dt;
      this.flowDir.x = 0;
      this.flowDir.z = 0;
    }
    const dirX = this.flowDir.x;
    const dirZ = this.flowDir.z;
    const ti0 = this.types[i];
    const heavySprint = ti0 === EType.C && !this.posting[i];
    let sp = this.burstT[i] > 0 ? enemySkillFx('cut-in').speed ?? 7.2 : heavySprint ? HEAVY_SPRINT : this.speed[i];
    if (this.hasteT[i] > 0) {
      this.hasteT[i] -= dt;
      sp *= this.hasteMul[i] > 0 ? this.hasteMul[i] : 1;
      if (this.hasteT[i] <= 0) this.hasteMul[i] = 1;
    }
    if (this.slowT[i] > 0) {
      this.slowT[i] -= dt;
      sp *= this.slowMul[i] > 0 ? this.slowMul[i] : 0.4;
      if (this.slowT[i] <= 0) this.slowMul[i] = 1;
    }
    const prefX = dirX * sp;
    const prefZ = dirZ * sp;

    // 简化 ORCA：看邻居相对速度做避让，半径故意留松，允许轻撞
    let avX = 0;
    let avZ = 0;
    const ti = ti0;
    const iRush = ti === EType.F && this.rushing[i];
    const ri = ti === EType.C ? 0.52 : 0.30;
    const cx = Math.floor(x + 40);
    const cz = Math.floor(z + 40);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const arr = this.hash.get(((cx + ox) << 8) | (cz + oz));
        if (!arr) continue;
        for (const j of arr) {
          if (j === i) continue;
          const tj = this.types[j];
          const jRush = tj === EType.F && this.rushing[j];
          // 拦截者逆行人潮：自己不让路；占点后也不被同事挤开
          if (ti === EType.F && (tj === EType.A || tj === EType.C)) continue;
          const ddx = x - this.posX[j];
          const ddz = z - this.posZ[j];
          const dSq = ddx * ddx + ddz * ddz;
          const rj = tj === EType.C ? 0.52 : tj === EType.F && !jRush ? 0.42 : 0.30;
          const rsum = (ri + rj) * 0.88;
          if (dSq > (rsum * 1.55) * (rsum * 1.55) || dSq < 1e-6) continue;
          const d = Math.sqrt(dSq);
          const relVx = this.velX[i] - this.velX[j];
          const relVz = this.velZ[i] - this.velZ[j];
          const closing = relVx * ddx + relVz * ddz;
          if (closing > 0 && d > rsum) continue;
          let push = (rsum * 1.15 - d) / d;
          if (ti === EType.C) push *= 0.2;
          if (tj === EType.C) push *= 1.55;
          if (ti === EType.A && tj === EType.F) push *= jRush ? 1.75 : 1.4;
          avX += ddx * push;
          avZ += ddz * push;
          const side = ddx * relVz - ddz * relVx;
          const s = side >= 0 ? 1 : -1;
          const sideW = ti === EType.A && tj === EType.F ? 0.7 : 0.35;
          avX += (-ddz / d) * s * push * sideW;
          avZ += (ddx / d) * s * push * sideW;
        }
      }
    }

    const commit = iRush || heavySprint ? 0.94 : 0.78;
    const avoid = iRush ? 0.7 : 2.1;
    let vx = prefX * commit + avX * avoid;
    let vz = prefZ * commit + avZ * avoid;
    if (this.posting[i]) {
      vx *= 0.22;
      vz *= 0.22;
    }
    const vLen = Math.hypot(vx, vz);
    const vMax = sp * 1.4;
    if (vLen > vMax) {
      vx = (vx / vLen) * vMax;
      vz = (vz / vLen) * vMax;
    }
    const body = this.bodies[i]!;
    const cur = body.linvel();
    body.setLinvel({ x: vx, y: cur.y, z: vz }, true);

    // 塞任务：首刀快、之后普通 0.85 / 主管 1.2；离身先停 0.25s 再慢掉
    const inRange = distSq < CHANNEL_RANGE * CHANNEL_RANGE;
    if (suppressChannel) {
      this.decayChannel(i, dt);
    } else if (inRange) {
      this.channelAwayT[i] = 0;
      this.channelT[i] += dt;
      if (this.channelT[i] >= this.channelNeedOf(i)) {
        this.clearChannel(i);
        this.deliveredOnce = true;
        this.onTaskDelivered?.(this.types[i], x, z, this.gender[i]);
        const d = Math.sqrt(distSq) || 1;
        if (this.types[i] !== EType.C) {
          body.applyImpulse({ x: (-dxp / d) * 320, y: 30, z: (-dzp / d) * 320 }, true);
          this.state[i] = EState.Knock;
          this.knockT[i] = 1.2;
        }
      }
    } else if (this.channelT[i] > 0) {
      this.decayChannel(i, dt);
    }
  }

  private updateRagdoll(i: number, dt: number) {
    const rag = this.rags[i]!;
    rag.age += dt;
    this.ragFactory.driveStand(rag);
    const blown = !this.ragFactory.isSane(rag);
    if (blown || (rag.age > 1.5 && this.ragFactory.isSettled(rag)) || rag.age > 3.2) {
      this.finishRagdoll(i);
    }
  }

  private findFreeSpot(x: number, z: number): [number, number] {
    const f = this.flow;
    const minX = f.ox + 0.6;
    const maxX = f.ox + f.nx * f.cell - 0.6;
    const minZ = f.oz + 0.6;
    const maxZ = f.oz + f.nz * f.cell - 0.6;
    const cx = Math.max(minX, Math.min(maxX, x));
    const cz = Math.max(minZ, Math.min(maxZ, z));
    if (!f.isBlockedAt(cx, cz)) return [cx, cz];
    for (let r = 0.5; r <= 3; r += 0.5) {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const nx = Math.max(minX, Math.min(maxX, cx + Math.cos(ang) * r));
        const nz = Math.max(minZ, Math.min(maxZ, cz + Math.sin(ang) * r));
        if (!f.isBlockedAt(nx, nz)) return [nx, nz];
      }
    }
    return [cx, cz];
  }

  private poseSetOf(i: number) {
    const t = this.types[i];
    if (t === EType.C) return 2;
    if (t === EType.F) return 3;
    return this.gender[i] ? 1 : 0;
  }

  private hideInstance(i: number) {
    this.tmpM.makeScale(0, 0, 0);
    for (const mesh of this.poseSets.flat()) mesh.setMatrixAt(i, this.tmpM);
    for (const mesh of this.hairMeshes) mesh?.setMatrixAt(i, this.tmpM);
    for (const mesh of this.hatMeshes) mesh?.setMatrixAt(i, this.tmpM);
    for (const mesh of this.heldMeshes) mesh?.setMatrixAt(i, this.tmpM);
    for (const mesh of this.backMeshes) mesh?.setMatrixAt(i, this.tmpM);
    for (const mesh of this.kitHairMeshes) mesh?.setMatrixAt(i, this.tmpM);
    for (const set of this.skirtPoseSets) {
      if (!set) continue;
      for (const mesh of set) mesh.setMatrixAt(i, this.tmpM);
    }
    this.blobMesh.setMatrixAt(i, this.tmpM);
  }

  /** 开跑/停步阀值：体型越大巡航越慢，阀值按 scale 压低，避免大块头永远 idle 滑步。 */
  private gaitBand(i: number) {
    const scale = this.scaleOf(i);
    const t = this.types[i];
    const flavor = t === EType.C ? 0.78 : t === EType.F ? 1.12 : 1;
    const on = (0.5 / scale) * flavor;
    return { on, off: on * 0.52 };
  }

  private poseIndex(i: number, hSpeed: number, dt: number) {
    const walkN = this.poseSets[0].length - 1;
    const { on, off } = this.gaitBand(i);
    if (this.gait[i]) {
      if (hSpeed < off) this.gait[i] = 0;
    } else if (hSpeed > on) {
      this.gait[i] = 1;
    }
    if (!this.gait[i] || walkN <= 0) return 0;
    const scale = this.scaleOf(i);
    // 小个子步频快、大块头步频慢；主管狂奔时跟实际速度走，避免滑步
    const drive = Math.max(this.speed[i], hSpeed * 0.85);
    const cadence = (0.88 + drive * 0.1) / scale + (this.bobPhase[i] % 1) * 0.16;
    this.walkClock[i] += dt * cadence;
    return 1 + (((Math.floor(this.walkClock[i] * walkN) % walkN) + walkN) % walkN);
  }

  private setBodyPose(i: number, pose: number, matrix: THREE.Matrix4) {
    this.tmpM2.makeScale(0, 0, 0);
    const mineIdx = this.poseSetOf(i);
    for (let s = 0; s < this.poseSets.length; s++) {
      const poses = this.poseSets[s];
      for (let p = 0; p < poses.length; p++) {
        poses[p].setMatrixAt(i, s === mineIdx && p === pose ? matrix : this.tmpM2);
      }
    }
    this.setAttachPose(i, pose, matrix, mineIdx, this.kit.slotHair, this.kit.headLocals, this.hairMeshes);
    this.setAttachPose(i, pose, matrix, mineIdx, this.kit.slotHat, this.kit.headLocals, this.hatMeshes);
    this.setAttachPose(i, pose, matrix, mineIdx, this.kit.slotHeld, this.kit.handLocals, this.heldMeshes);
    this.setAttachPose(i, pose, matrix, mineIdx, this.kit.slotBack, this.kit.backLocals, this.backMeshes);
    this.setAttachPose(i, pose, matrix, mineIdx, this.kit.slotKitHair, this.kit.headLocals, this.kitHairMeshes);
    this.tmpM2.makeScale(0, 0, 0);
    for (let s = 0; s < this.skirtPoseSets.length; s++) {
      const poses = this.skirtPoseSets[s];
      if (!poses) continue;
      for (let p = 0; p < poses.length; p++) {
        poses[p].setMatrixAt(i, s === mineIdx && p === pose ? matrix : this.tmpM2);
      }
    }
  }

  private setAttachPose(
    i: number,
    pose: number,
    body: THREE.Matrix4,
    mineIdx: number,
    slots: (typeof this.kit.slotHair)[number][],
    locals: THREE.Matrix4[],
    meshes: (THREE.InstancedMesh | null)[]
  ) {
    this.tmpM2.makeScale(0, 0, 0);
    const item = slots[mineIdx];
    const bone = locals[pose] ?? locals[0];
    if (item && bone) this.tmpHair.copy(body).multiply(bone).multiply(item.attach);
    for (let s = 0; s < meshes.length; s++) {
      const mesh = meshes[s];
      if (!mesh) continue;
      mesh.setMatrixAt(i, s === mineIdx && item && bone ? this.tmpHair : this.tmpM2);
    }
  }

  syncVisuals(time: number) {
    const m = this.tmpM;
    const m2 = this.tmpM2;
    const q = this.tmpQ;
    const leanQ = this.tmpQ2;
    const pos = this.tmpV;
    const axis = this.tmpAxis;
    const dt = this.visTime > 0 ? Math.min(0.05, Math.max(0, time - this.visTime)) : 1 / 60;
    this.visTime = time;

    for (let i = 0; i < this.cap; i++) {
      const s = this.state[i];
      if (s === EState.Ragdoll) {
        const rag = this.rags[i];
        if (rag) this.ragFactory.sync(rag);
        this.hideInstance(i);
        continue;
      }
      if (s === EState.Inactive) {
        this.hideInstance(i);
        continue;
      }

      const body = this.bodies[i]!;
      const t = body.translation();
      const v = body.linvel();
      const hSpeed = Math.hypot(v.x, v.z);
      const scale = this.scaleOf(i);
      const yOff = this.types[i] === EType.C ? 0.92 : 0.66;

      const heavy = this.types[i] === EType.C;
      const pose = this.poseIndex(i, hSpeed, dt);
      const posting = this.posting[i] === 1;
      if (posting) {
        const fx = this.aimPX - t.x;
        const fz = this.aimPZ - t.z;
        const fl = Math.hypot(fx, fz);
        if (fl > 0.25) {
          const targetYaw = Math.atan2(fx, fz);
          let d = targetYaw - this.yaw[i];
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          if (Math.abs(d) > 0.08) this.yaw[i] += d * (heavy ? 0.08 : 0.18);
        }
        this.faceX[i] = fx;
        this.faceZ[i] = fz;
      } else {
        const blend = heavy ? 0.07 : 0.2;
        this.faceX[i] += (v.x - this.faceX[i]) * blend;
        this.faceZ[i] += (v.z - this.faceZ[i]) * blend;
        const faceSp = Math.hypot(this.faceX[i], this.faceZ[i]);
        const yawNeed = heavy ? 0.85 : 0.5;
        if (faceSp > yawNeed) {
          const targetYaw = Math.atan2(this.faceX[i], this.faceZ[i]);
          let d = targetYaw - this.yaw[i];
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          if (Math.abs(d) > 0.14) this.yaw[i] += d * (heavy ? 0.05 : 0.16);
        }
      }
      q.setFromAxisAngle(axis.set(0, 1, 0), this.yaw[i]);

      const faceSp = Math.hypot(this.faceX[i], this.faceZ[i]);
      if (this.gait[i] && !posting && faceSp > (heavy ? 0.85 : 0.5)) {
        const lean = Math.min(faceSp * 0.05, heavy ? 0.12 : 0.28);
        axis.set(this.faceZ[i] / faceSp, 0, -this.faceX[i] / faceSp);
        leanQ.setFromAxisAngle(axis, lean);
        q.premultiply(leanQ);
      }

      const walk = this.gait[i] ? Math.sin(this.walkClock[i] * 6.2 + this.bobPhase[i]) : 0;
      const bob = this.gait[i] ? Math.abs(walk) * 0.045 : 0;
      const bx = t.x;
      const by = t.y - yOff + bob;
      const bz = t.z;
      pos.set(bx, by, bz);

      let sy = scale;
      if (s === EState.Getup) {
        const k = 1 - this.getupT[i] / 0.65;
        sy = scale * (0.35 + 0.65 * k);
      } else if (this.skillWind[i] > 0) {
        const pack = enemySkillFx(this.skill[i] as EnemySkillId);
        const u = 1 - this.skillWind[i] / Math.max(0.05, pack.windup);
        const dip = pack.squash ?? 0.78;
        sy = scale * (dip + (1 - dip) * u * u);
      }
      m.compose(pos, q, this.tmpS.set(scale, sy, scale));
      this.lastPose[i] = pose;
      this.lastBody[i]!.copy(m);
      this.setBodyPose(i, pose, m);

      m2.compose(this.tmpV.set(t.x, 0.02, t.z), this.tmpQL.identity(), this.tmpS.set(scale * 1.2, 1, scale * 1.2));
      this.blobMesh.setMatrixAt(i, m2);

    }
    for (const mesh of this.poseSets.flat()) mesh.instanceMatrix.needsUpdate = true;
    for (const mesh of [...this.hairMeshes, ...this.hatMeshes, ...this.heldMeshes, ...this.backMeshes, ...this.kitHairMeshes]) {
      if (mesh) mesh.instanceMatrix.needsUpdate = true;
    }
    for (const set of this.skirtPoseSets) {
      if (!set) continue;
      for (const mesh of set) mesh.instanceMatrix.needsUpdate = true;
    }
    this.blobMesh.instanceMatrix.needsUpdate = true;
  }

  get channelingCount() {
    let n = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.state[i] === EState.Chase && this.channelT[i] > 0.1) n++;
    }
    return n;
  }
}
