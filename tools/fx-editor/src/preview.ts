import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { LINE_IDS, coffeeColorOnDay, commonFx, crowdFx, dashFx, dashImpulseOf, dashReactOf, enemySkillFx, mergeHitFx, overtimePopText, overtimePreviewMin, skillFx, type ActorId, type CrowdActorId, type DashKey, type HitFx, type SkillKey } from '../../../src/fx/catalog';
import type { EnemySkillId } from '../../../src/catalog';
import { BATTLE_SLOT_IDS, ENEMY_SKILL_META, loadCatalog, type ColleagueCatalog } from '../../../src/catalog';
import { rosterSlot } from '../../../src/roster';
import {
  cloneBattleFigure,
  clonePlayerFigure,
  setFigureGait,
  type HumanoidFigure,
  type HumanoidKit,
} from '../../../src/game/humanoid';
import { coffeePropOnDay, decoyCountOnDay, decoyRunDirs, decoyRunOnDay, skillNameOnDay } from '../../../src/fx/days';
import type { WeekdayId } from '../../../src/levels';
import {
  decoyLookOf,
  decoySkinOnDay,
  disposeDecoyGhost,
  disposeDecoyRunner,
  makeDecoy,
  makeDecoyRunner,
  tickDecoyRunner,
} from '../../../src/game/decoyGhost';
import { applyThrowLook, makeThrowProjectile, throwLookOf, throwSkinOnDay } from '../../../src/game/skillProjectiles';
import { ChannelMarks, DashTrail, ImpactMist, OvertimePop, PaperBurst, SlowPulse, StatusMarks, spawnHitFx } from '../../../src/game/look';
import { SkillChains, SkillShout, SHOUT_Y, figureChest, figureHand, figureHandL, figureNeck, setFigureGlow } from '../../../src/game/skillVfx';
import { RagdollFactory, type RagdollHandle } from '../../../src/game/ragdoll';
import { Slicks } from '../../../src/game/slicks';
import { DashMountKit, mountDashProp } from '../../../src/game/dashMounts';
import { BONE_HAND, BONE_HEAD } from '../../../src/game/hair';

export type PlayKind = 'common' | 'dash' | 'decoy' | 'keyboard' | 'coffee' | 'actor';
export type CastState = 'idle' | 'run';

export interface CastRow {
  label: string;
  tag: string;
}

const SHIRT = [0x4f8fe8, 0x5fbf72, 0xe0a24a, 0xd45c5c, 0x8b6fd4, 0x4fc0d8, 0xd44f9a, 0x8aa04a];
const SHIRT_C = 0x37415c;
const SHIRT_F = 0xe05252;

interface Dummy {
  fig: HumanoidFigure;
  slot: number;
  restX: number;
  restZ: number;
  x: number;
  z: number;
  hit: boolean;
  heavy: boolean;
  shirt: number;
  rag: RagdollHandle | null;
}

interface SkillProp {
  mesh: THREE.Group;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  flying: boolean;
}

/** 挤在冲刺廊道里的点位池；演示人数从这里截取，不够再往外扩 */
const CROWD_SPOTS: { slot: number; x: number; z: number }[] = [
  { slot: 0, x: -0.78, z: 1.18 },
  { slot: 1, x: -0.26, z: 1.12 },
  { slot: 0, x: 0.28, z: 1.2 },
  { slot: 1, x: 0.8, z: 1.1 },
  { slot: 0, x: -0.72, z: 0.68 },
  { slot: 3, x: -0.18, z: 0.62 },
  { slot: 1, x: 0.32, z: 0.7 },
  { slot: 0, x: 0.84, z: 0.58 },
  { slot: 1, x: -0.8, z: 0.18 },
  { slot: 0, x: -0.22, z: 0.22 },
  { slot: 2, x: 0.3, z: 0.12 },
  { slot: 0, x: 0.78, z: 0.2 },
  { slot: 1, x: -0.55, z: -0.28 },
  { slot: 0, x: 0.05, z: -0.22 },
  { slot: 3, x: 0.58, z: -0.32 },
];

const CROWD_COUNT_MIN = 1;
const CROWD_COUNT_MAX = 24;
const CROWD_COUNT_DEFAULT = 15;

function clampCrowdCount(n: number) {
  return Math.max(CROWD_COUNT_MIN, Math.min(CROWD_COUNT_MAX, Math.round(n)));
}

/** 取前 n 个点；人数≥4 时尽量带齐各槽位，方便点角色预览主动技。 */
function crowdSpots(n: number): { slot: number; x: number; z: number }[] {
  const count = clampCrowdCount(n);
  const pool = CROWD_SPOTS.map((s) => ({ ...s }));
  const slots = [0, 1, 2, 3];
  let extra = 0;
  while (pool.length < count) {
    const i = pool.length;
    const col = (i % 5) - 2;
    const row = Math.floor(i / 5);
    pool.push({
      slot: slots[i % slots.length]!,
      x: col * 0.52 + (extra % 2) * 0.06,
      z: 1.15 - row * 0.48,
    });
    extra++;
  }
  const picked = pool.slice(0, count);
  if (count >= 4) {
    for (const slot of slots) {
      if (picked.some((p) => p.slot === slot)) continue;
      const donor = pool.find((p) => p.slot === slot) ?? { slot, x: slot * 0.4 - 0.6, z: -0.55 };
      const dup = picked.findIndex((p) => picked.filter((q) => q.slot === p.slot).length > 1);
      picked[dup >= 0 ? dup : picked.length - 1] = { ...donor };
    }
  }
  return picked;
}

const PLAYER_START_Z = 2.35;
const HOLD_AFTER_DASH = 2.15;
const FIXED_DT = 1 / 60;
const MOVE_SPEED = 3.4;
const MOVE_SPEED_RUN = 4.6;
const ARENA = 7.2;

function typingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export class FxPreview {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly orbit: OrbitControls;
  skillLv = 1;
  day: WeekdayId = 'monday';
  track: 'common' | DashKey | SkillKey | 'hazards' | 'enemySkills' = 'none';
  actorId: ActorId = 'player';
  /** 正在编角色被动时，不画冲刺判定辅助圈 */
  actorEdit = false;
  /** 当前关这个角色挂的主动技能。播放角色时走技能预览。 */
  actorSkill: EnemySkillId | null = null;
  castState: CastState = 'idle';
  /** 演示区同事人数（仅编辑器预览） */
  crowdCount = CROWD_COUNT_DEFAULT;

  private world: RAPIER.World;
  private rags: RagdollFactory;
  private papers: PaperBurst;
  private trail: DashTrail;
  private mist: ImpactMist;
  private heads: OvertimePop;
  private pulses: SlowPulse;
  private chains: SkillChains;
  private skillShout: SkillShout;
  private status: StatusMarks;
  private channel: ChannelMarks;
  private slicks: Slicks;
  private dashKit: DashMountKit | null = null;
  private handPot: THREE.Group | null = null;
  private handPotLine: DashKey | null = null;
  private headPots: {
    root: THREE.Group;
    t: number;
    fig: HumanoidFigure;
    /** 场景浮空跟随（补卡闹钟）；骨头挂件则为 null */
    dummy: Dummy | null;
    blastR: number;
    blastImpulse: number;
    bob: number;
  }[] = [];
  private kit: HumanoidKit;
  private playerFig: HumanoidFigure;
  private radiusRing: THREE.Mesh;
  private dummies: Dummy[] = [];
  private decoys: {
    group: THREE.Group;
    fig: HumanoidFigure | null;
    dirX: number;
    dirZ: number;
    speed: number;
    runLeft: number;
  }[] = [];
  private keyboard: THREE.Object3D | null = null;
  private crate: THREE.Mesh | null = null;
  private play: PlayKind | null = null;
  private t = 0;
  private px = 0;
  private pz = PLAYER_START_Z;
  private kb = { x: 0, z: 0, phase: 0 as 0 | 1, traveled: 0, hit: new Set<number>() };
  private last = 0;
  private physAcc = 0;
  private decoyBlasted = false;
  private slumpPulsed = false;
  private reclockMarked = false;
  private reclockBait: Dummy | null = null;
  private blamePotCount = 0;
  private blameBlasts: { d: Dummy; wait: number; r: number; impulse: number }[] = [];
  private commonFired = false;
  private actorFired = false;
  private actorPhase: 'windup' | 'cast' | 'hold' = 'windup';
  private actorHold = HOLD_AFTER_DASH;
  private skillStaged = false;
  private stagedActor: ActorId | null = null;
  private stagedSkill: EnemySkillId | null = null;
  private casterRunning = false;
  private extrasRunning = false;
  private playerLocked = false;
  private skillProps: SkillProp[] = [];
  private overtimeAcc = 99;
  private lastOvertimeActor: ActorId | null = null;
  private onStatus: ((s: string) => void) | null = null;
  private chainHand = new THREE.Vector3();
  private chainHandL = new THREE.Vector3();
  private chainNeck = new THREE.Vector3();
  private glowFig: HumanoidFigure | null = null;
  private keys = new Set<string>();
  private roaming = false;
  private faceX = 0;
  private faceZ = -1;
  private moveFwd = new THREE.Vector3();
  private moveRight = new THREE.Vector3();
  private moveWish = new THREE.Vector3();

  constructor(host: HTMLElement, renderer: THREE.WebGPURenderer, kit: HumanoidKit, world: RAPIER.World) {
    this.renderer = renderer;
    host.appendChild(renderer.domElement);
    this.scene.background = new THREE.Color(0x2a2c33);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.2, 80);
    this.camera.position.set(5.6, 8.6, 8.8);
    this.orbit = new OrbitControls(this.camera, renderer.domElement);
    this.orbit.target.set(0, 0.55, 0.15);
    this.orbit.enableDamping = true;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f98, 1.15));
    const sun = new THREE.DirectionalLight(0xfff2df, 1.6);
    sun.position.set(6, 14, 8);
    this.scene.add(sun);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 16),
      new THREE.MeshLambertMaterial({ color: 0xb88958 })
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.scene.add(new THREE.GridHelper(16, 16, 0x7a5a38, 0x8a6a42));

    this.playerFig = clonePlayerFigure(kit);
    this.scene.add(this.playerFig.group);
    this.radiusRing = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1.02, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffc14a,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.radiusRing.rotation.x = -Math.PI / 2;
    this.radiusRing.position.y = 0.04;
    this.scene.add(this.radiusRing);

    this.world = world;
    this.kit = kit;
    const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.1, 20).setFriction(0.9), groundBody);
    this.rags = new RagdollFactory(this.scene, world);
    this.spawnDummies(kit);
    this.papers = new PaperBurst(this.scene);
    this.trail = new DashTrail(this.scene);
    this.mist = new ImpactMist(this.scene);
    this.heads = new OvertimePop(this.scene);
    this.pulses = new SlowPulse(this.scene);
    this.chains = new SkillChains(this.scene);
    this.skillShout = new SkillShout(this.scene);
    this.status = new StatusMarks(this.scene, 16);
    this.channel = new ChannelMarks(this.scene, 16);
    this.slicks = new Slicks(this.scene);
    this.resetPose();
    this.bindMoveKeys();
    void this.bootDashMounts();
  }

  private async bootDashMounts() {
    try {
      this.dashKit = await DashMountKit.from(await loadCatalog());
    } catch (err) {
      console.warn('冲刺挂件未加载', err);
    }
  }

  async reloadDashMounts(cat: ColleagueCatalog) {
    this.clearDashProps();
    try {
      this.dashKit = await DashMountKit.from(cat);
    } catch (err) {
      console.warn('冲刺挂件未加载', err);
    }
  }

  private bindMoveKeys() {
    window.addEventListener('keydown', (e) => {
      if (typingTarget(e.target)) return;
      if (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD') {
        this.keys.add(e.code);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD') {
        this.keys.delete(e.code);
      }
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** 角色清单变了：换人，不整页重载。 */
  adoptKit(kit: HumanoidKit) {
    this.play = null;
    this.casterRunning = false;
    this.extrasRunning = false;
    this.playerLocked = false;
    this.skillStaged = false;
    this.stagedActor = null;
    this.stagedSkill = null;
    this.clearGlow();
    this.clearRags();
    this.clearSkillProps();
    this.clearDashProps();
    this.scene.remove(this.playerFig.group);
    for (const d of this.dummies) this.scene.remove(d.fig.group);
    this.dummies.length = 0;
    this.kit = kit;
    this.playerFig = clonePlayerFigure(kit);
    this.scene.add(this.playerFig.group);
    this.spawnDummies(kit);
    this.resetPose();
  }

  /** 改演示人数：立刻重摆，不碰战场。 */
  setCrowdCount(n: number) {
    const next = clampCrowdCount(n);
    if (next === this.crowdCount && this.dummies.length === next) return;
    this.crowdCount = next;
    this.play = null;
    this.casterRunning = false;
    this.extrasRunning = false;
    this.playerLocked = false;
    this.clearGlow();
    this.clearRags();
    this.clearSkillProps();
    this.clearDashProps();
    if (this.keyboard) {
      this.scene.remove(this.keyboard);
      this.keyboard = null;
    }
    if (this.decoys.length) this.clearDecoys();
    if (this.crate) {
      this.scene.remove(this.crate);
      this.crate = null;
    }
    for (const d of this.dummies) this.scene.remove(d.fig.group);
    this.dummies.length = 0;
    this.spawnDummies(this.kit);
    if (this.actorEdit && this.actorSkill && this.actorId !== 'player') {
      this.layoutSkillStage();
      this.skillStaged = true;
      this.stagedActor = this.actorId;
      this.stagedSkill = this.actorSkill;
    } else {
      this.restoreCrowdLayout();
      this.skillStaged = false;
      this.stagedActor = null;
      this.stagedSkill = null;
    }
    if (this.track === 'keyboard') this.placeKeyboard();
    if (this.track === 'decoy') this.placeDecoy();
    this.onStatus?.(`演示人数 ${next}`);
  }

  castRows(): CastRow[] {
    const player = rosterSlot('player');
    const rows: CastRow[] = [{ label: player?.label ?? '玩家', tag: '你' }];
    const order: number[] = [];
    const n = new Map<number, number>();
    for (const d of this.dummies) {
      if (!n.has(d.slot)) order.push(d.slot);
      n.set(d.slot, (n.get(d.slot) ?? 0) + 1);
    }
    for (const slot of order) {
      const id = BATTLE_SLOT_IDS[slot]!;
      const r = rosterSlot(id);
      const c = n.get(slot) ?? 1;
      rows.push({ label: `${r?.label ?? id} ×${c}`, tag: r?.enemy ?? 'A' });
    }
    return rows;
  }

  setStatus(fn: (s: string) => void) {
    this.onStatus = fn;
  }

  /** 改判定加时参数后立刻再飘一次，不用等循环间隔 */
  refreshOvertime() {
    this.overtimeAcc = 99;
  }

  /** 选中带主动技能的同事时，把舞台收成「他对着玩家放技能」。 */
  applyActorLayout() {
    if (this.play) return;
    if (this.actorEdit && this.actorSkill && this.actorId !== 'player') {
      if (!this.skillStaged || this.stagedActor !== this.actorId || this.stagedSkill !== this.actorSkill) {
        this.skillStaged = true;
        this.stagedActor = this.actorId;
        this.stagedSkill = this.actorSkill;
        this.layoutSkillStage();
      }
      return;
    }
    if (this.skillStaged) {
      this.skillStaged = false;
      this.stagedActor = null;
      this.stagedSkill = null;
      this.restoreCrowdLayout();
    }
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  rebuildFx() {
    this.papers.dispose();
    this.trail.dispose();
    this.mist.dispose();
    this.heads.dispose();
    this.pulses.dispose();
    this.chains.dispose();
    this.skillShout.dispose();
    this.papers = new PaperBurst(this.scene);
    this.trail = new DashTrail(this.scene);
    this.mist = new ImpactMist(this.scene);
    this.heads = new OvertimePop(this.scene);
    this.pulses = new SlowPulse(this.scene);
    this.chains = new SkillChains(this.scene);
    this.skillShout = new SkillShout(this.scene);
    this.slicks.clear();
  }

  start(kind: PlayKind) {
    this.clearGlow();
    this.clearActors();
    this.resetDummies();
    // 保留玩家当前位置朝向，方便连着测冲刺/技能
    this.syncPlayerFromFig();
    this.rebuildFx();
    this.play = kind;
    this.t = 0;
    this.kb = { x: this.px, z: this.pz, phase: 0, traveled: 0, hit: new Set() };
    this.decoyBlasted = false;
    this.slumpPulsed = false;
    this.reclockMarked = false;
    this.reclockBait = null;
    this.blamePotCount = 0;
    this.blameBlasts = [];
    this.commonFired = false;
    this.actorFired = false;
    this.actorPhase = 'windup';
    this.actorHold = HOLD_AFTER_DASH;
    this.casterRunning = false;
    this.extrasRunning = false;
    this.playerLocked = false;
    this.skillStaged = false;
    this.skillShout.clear();
    this.trail.setStyle(dashFx(this.dashKey(), this.skillLv).trail);
    if (kind === 'decoy') {
      this.placeDecoy();
      const run = decoyRunOnDay(this.day);
      const n = decoyCountOnDay(this.day, this.skillLv);
      this.onStatus?.(
        run.time > 0
          ? `播放 ${skillNameOnDay(this.day, 'decoy')} · ${n} 个假人分向跑动 ${run.time}s`
          : `播放 ${skillNameOnDay(this.day, 'decoy')} · 分身定格，WASD 走开`
      );
      return;
    }
    if (kind === 'keyboard') this.placeKeyboard();
    if (kind === 'coffee') this.pourCoffee();
    if (kind === 'common') this.placeCrate();
    if (kind === 'actor' && this.actorSkill && this.actorId !== 'player') {
      this.layoutSkillStage();
      this.skillStaged = true;
      this.stagedActor = this.actorId;
      this.stagedSkill = this.actorSkill;
      this.onStatus?.(`播放 ${ENEMY_SKILL_META[this.actorSkill].name} · 同事打在玩家身上`);
      return;
    }
    this.onStatus?.(`播放 ${labelOf(kind, this.day)} · WASD 移动`);
  }

  tick(now: number) {
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.orbit.update();
    this.stepFreeMove(dt);
    this.step(dt);
    this.syncDashHand();
    this.tickHeadPots(dt);
    this.tickBlameBlasts(dt);
    this.stepPhysics(dt);
    this.stepRags(dt);
    this.updateGaits(dt);
    this.papers.update(dt);
    this.trail.update(dt);
    this.mist.update(dt);
    this.heads.update(dt);
    this.pulses.update(dt);
    if (this.play === 'actor' && this.actorSkill === 'rally') {
      this.skillShout.aim(this.px, SHOUT_Y, this.pz);
    }
    this.skillShout.update(dt);
    this.chains.update(dt);
    this.stepSkillProps(dt);
    if (this.play === 'actor' && this.actorSkill === 'cut-in') {
      const pack = enemySkillFx('cut-in');
      const dummy = this.casterDummy();
      if (dummy) {
        figureHand(dummy.fig, this.chainHand);
        figureHandL(dummy.fig, this.chainHandL);
        figureNeck(this.playerFig, this.chainNeck);
        this.chains.followHands(
          0,
          this.chainHand.x,
          this.chainHand.y,
          this.chainHand.z,
          this.chainHandL.x,
          this.chainHandL.y,
          this.chainHandL.z,
          this.chainNeck.x,
          this.chainNeck.y,
          this.chainNeck.z,
          pack.chainStyle
        );
      }
      const live = this.chains.live();
      if (live) {
        setFigureGlow(this.playerFig, true, live.color, pack.opacity * live.fade);
        this.glowFig = this.playerFig;
      } else if (this.glowFig === this.playerFig) {
        setFigureGlow(this.playerFig, false);
        this.glowFig = null;
      }
    }
    const skillPlay = this.play === 'actor' && !!this.actorSkill;
    if (this.actorEdit && this.actorId !== 'player' && !skillPlay) {
      this.syncEditStatus();
      this.stepOvertimePreview(dt);
    } else if (!this.actorEdit) {
      this.overtimeAcc = 99;
      this.lastOvertimeActor = null;
      if (!this.play) {
        this.status.clearAll();
        this.channel.clearAll();
      }
    }
    this.dummies.forEach((d, i) => {
      this.status.follow(100 + i, d.x, d.z);
      this.channel.follow(100 + i, d.x, d.z);
    });
    if (this.play === 'actor' && (this.actorSkill === 'cut-in' || this.actorSkill === 'desk-slam' || this.actorSkill === 'rally')) {
      this.status.follow(1000, this.px, this.pz);
    }
    this.status.update(dt);
    this.channel.update(dt);
    this.slicks.update(dt, emptyEnemies());
    this.syncRadius();
    const dashing = this.play === 'dash' && this.t <= dashFx(this.dashKey(), this.skillLv).hit.time + 0.02;
    this.playerFig.playerHalo?.update(dt, dashing);
    this.renderer.render(this.scene, this.camera);
  }

  private dashKey(): DashKey {
    if (this.track === 'none') return 'none';
    if ((LINE_IDS as readonly string[]).includes(this.track)) return this.track as DashKey;
    return 'none';
  }

  private knockLook(d: Dummy, over?: Partial<HitFx> | null) {
    return mergeHitFx(crowdFx(BATTLE_SLOT_IDS[d.slot] as CrowdActorId).hit, over);
  }

  private knockDummy(d: Dummy, dirX: number, dirZ: number, impulse: number, hitOver?: Partial<HitFx> | null) {
    if (d.hit) return;
    d.hit = true;
    d.fig.group.visible = false;
    const len = Math.hypot(dirX, dirZ) || 1;
    const power = Math.min(Math.max(impulse * 0.85, 200), 500);
    d.rag = this.rags.spawn(d.x, d.z, d.shirt, dirX / len, dirZ / len, power, d.slot === 2 ? 1.38 : 1, false, {
      kit: this.kit,
      slot: d.slot,
    });
    spawnHitFx(this.papers, this.mist, d.x, d.z, this.knockLook(d, hitOver));
  }

  private stepOvertimePreview(dt: number) {
    if (this.play) return;
    if (this.lastOvertimeActor !== this.actorId) {
      this.lastOvertimeActor = this.actorId;
      this.overtimeAcc = 99;
    }
    const look = crowdFx(this.actorId as CrowdActorId);
    const gap = Math.max(0.45, look.overtime.duration + 0.25);
    this.overtimeAcc += dt;
    if (this.overtimeAcc < gap) return;
    this.overtimeAcc = 0;
    if (!look.overtime.enabled) return;
    let n = 0;
    for (const d of this.dummies) {
      if (!d.fig.group.visible || BATTLE_SLOT_IDS[d.slot] !== this.actorId) continue;
      this.heads.spawn(d.x, d.z, overtimePreviewMin(this.actorId as CrowdActorId), look.overtime);
      n++;
    }
    if (n) this.onStatus?.(`判定加时 · ${overtimePopText(overtimePreviewMin(this.actorId as CrowdActorId))} 循环预览`);
  }

  private syncEditStatus() {
    const id = this.actorId;
    if (id === 'player') return;
    const look = crowdFx(id);
    for (let i = 0; i < this.dummies.length; i++) {
      const d = this.dummies[i]!;
      const key = 100 + i;
      if (BATTLE_SLOT_IDS[d.slot] !== id || !d.fig.group.visible) {
        this.status.clear(key);
        this.channel.clear(key);
        continue;
      }
      this.status.pinStun(key, d.x, d.z, look.stun);
      this.status.pinSlow(key, d.x, d.z, look.slow);
      this.channel.pin(key, d.x, d.z, look.channel, d.slot === 2 ? 1.38 : 1);
    }
  }

  private updateGaits(dt: number) {
    const pack = dashFx(this.dashKey(), this.skillLv);
    const dashing = this.play === 'dash';
    const playerMove = dashing && this.t <= pack.hit.time + 0.02;
    const playerRun = !this.playerLocked && (this.castState === 'run' || playerMove || this.roaming);
    setFigureGait(this.playerFig, playerRun, dt);
    const caster = this.casterDummy();
    for (const d of this.dummies) {
      if (!d.fig.group.visible || d.hit) {
        setFigureGait(d.fig, false, dt);
        continue;
      }
      const isCaster = d === caster;
      const skillPlay = this.play === 'actor' && !!this.actorSkill;
      const run = skillPlay
        ? (isCaster && this.casterRunning) || (!isCaster && this.extrasRunning)
        : this.castState === 'run';
      setFigureGait(d.fig, run, dt);
    }
  }

  private step(dt: number) {
    if (!this.play) return;
    this.t += dt;
    if (this.play === 'dash') this.stepDash(dt);
    else if (this.play === 'common') this.stepCommon();
    else if (this.play === 'actor') this.stepActor(dt);
    else if (this.play === 'decoy') this.stepDecoy(dt);
    else if (this.play === 'keyboard') this.stepKeyboard(dt);
    else if (this.play === 'coffee') this.stepCoffee();
  }

  private stepCommon() {
    if (!this.commonFired && this.t >= 0.08) {
      this.commonFired = true;
      spawnHitFx(this.papers, this.mist, 1.15, -0.2, commonFx().hitObject);
    }
    if (this.t > HOLD_AFTER_DASH) this.finishPlay('撞物预览 · 已复位');
  }

  private stepActor(dt: number) {
    const skill = this.actorSkill;
    if (!skill) {
      this.stepActorPassive();
      return;
    }
    const dummy = this.casterDummy();
    if (!dummy) {
      if (this.t > HOLD_AFTER_DASH) this.finishPlay('找不到施法角色');
      return;
    }
    const pack = enemySkillFx(skill);
    const wind = Math.max(0.08, pack.windup);
    const base = dummy.heavy ? 1.38 : 1;
    const name = ENEMY_SKILL_META[skill].name;

    if (this.t < wind) {
      if (!this.actorFired) {
        this.actorFired = true;
        if (skill !== 'cut-in' && skill !== 'rally') {
          this.pulses.spawn(dummy.x, dummy.z, pack.radius * 0.32, pack.color, pack.opacity, wind, true);
        }
        this.onStatus?.(`${name} · 前摇`);
      }
      dummy.fig.group.scale.set(base, base * (pack.squash ?? 0.8), base);
      this.faceToward(dummy, this.px, this.pz);
      return;
    }

    dummy.fig.group.scale.setScalar(base);
    if (this.actorPhase === 'windup') {
      this.actorPhase = 'cast';
      this.fireActorSkill(dummy, skill, pack, wind);
    }

    if (skill === 'cut-in' && this.actorPhase === 'cast') {
      const elapsed = this.t - wind;
      const reach = Math.hypot(this.px - dummy.x, this.pz - dummy.z);
      if (elapsed < pack.duration && reach > 0.62) {
        this.casterRunning = true;
        const yaw = Math.atan2(this.px - dummy.x, this.pz - dummy.z);
        const sp = pack.speed ?? 7.2;
        dummy.x += Math.sin(yaw) * sp * dt;
        dummy.z += Math.cos(yaw) * sp * dt;
        dummy.fig.group.position.set(dummy.x, 0, dummy.z);
        dummy.fig.group.rotation.y = yaw;
        this.trail.emit(dummy.x, dummy.z, yaw, dt);
      } else {
        this.casterRunning = false;
        this.actorPhase = 'hold';
        this.faceToward(dummy, this.px, this.pz);
      }
    }

    if (this.t > this.actorHold) this.finishPlay(`${name} · 已复位`);
  }

  private fireActorSkill(dummy: Dummy, skill: EnemySkillId, pack: ReturnType<typeof enemySkillFx>, wind: number) {
    const victim = crowdFx('colleague-a-m');
    const name = ENEMY_SKILL_META[skill].name;
    if (skill === 'cut-in') {
      figureHand(dummy.fig, this.chainHand);
      figureHandL(dummy.fig, this.chainHandL);
      figureNeck(this.playerFig, this.chainNeck);
      this.chains.lockHands(
        0,
        this.chainHand.x,
        this.chainHand.y,
        this.chainHand.z,
        this.chainHandL.x,
        this.chainHandL.y,
        this.chainHandL.z,
        this.chainNeck.x,
        this.chainNeck.y,
        this.chainNeck.z,
        pack.lock ?? 2,
        pack.color,
        pack.chainWidth ?? 0.08,
        pack.chainSag ?? 0.42,
        pack.chainStyle
      );
      this.status.pinStun(1000, this.px, this.pz, victim.stun);
      this.playerLocked = true;
      const trail = dashFx('none', 1).trail;
      this.trail.setStyle({
        ...trail,
        color: pack.color,
        ghost: true,
        opacity: 0.5,
        stretch: 2.4,
        copies: 2,
        interval: 0.028,
      });
      this.actorHold = wind + (pack.lock ?? 2) + 0.45;
      this.onStatus?.(`${name} · 冲向玩家，锁链扣住脖子`);
    } else if (skill === 'desk-slam') {
      this.pulses.spawn(dummy.x, dummy.z, pack.radius, pack.color, pack.opacity, 0.4, true);
      spawnHitFx(this.papers, this.mist, dummy.x, dummy.z, crowdFx('heavy').hit);
      this.papers.spawn(dummy.x, 1.15, dummy.z, pack.paper ?? 10, crowdFx('heavy').hit.paper);
      this.blastSkillProps(dummy.x, dummy.z, pack.knockImpulse ?? 420, pack.knockLift ?? 32);
      this.status.pinSlow(1000, this.px, this.pz, victim.slow);
      this.playerLocked = true;
      this.actorHold = wind + pack.duration + 0.55;
      this.onStatus?.(`${name} · 震飞周围，玩家减速`);
    } else if (skill === 'rally') {
      figureChest(dummy.fig, this.chainHand);
      figureChest(this.playerFig, this.chainNeck);
      this.skillShout.burst(
        this.chainHand.x,
        SHOUT_Y,
        this.chainHand.z,
        this.chainNeck.x,
        SHOUT_Y,
        this.chainNeck.z,
        pack.color,
        pack.opacity,
        pack.waves ?? 3,
        pack.waveGap ?? 0.14
      );
      this.status.pinSlow(1000, this.px, this.pz, victim.slow);
      this.playerLocked = true;
      this.actorHold = wind + pack.duration + 0.45;
      this.onStatus?.(`${name} · 站住喊人，玩家减速`);
    }
  }

  private stepActorPassive() {
    const dummy = this.casterDummy() ?? this.dummies[0];
    if (!this.actorFired && this.t >= 0.08) {
      this.actorFired = true;
      if (this.actorId === 'player') {
        this.onStatus?.('玩家光环');
      } else if (dummy) {
        const look = crowdFx(this.actorId);
        const key = 100 + this.dummies.indexOf(dummy);
        this.heads.spawn(dummy.x, dummy.z, overtimePreviewMin(this.actorId as CrowdActorId), look.overtime);
        this.status.pinStun(key, dummy.x, dummy.z, look.stun);
        this.status.pinSlow(key, dummy.x, dummy.z, look.slow);
        spawnHitFx(this.papers, this.mist, dummy.x, dummy.z, look.hit);
      }
    }
    if (this.t > this.actorHold) this.finishPlay('角色被动 · 已复位');
  }

  private stepDash(dt: number) {
    const pack = dashFx(this.dashKey(), this.skillLv);
    const hit = pack.hit;
    const dur = hit.time;
    if (this.t > dur + HOLD_AFTER_DASH) {
      this.finishPlay('冲撞结束 · 可继续 WASD');
      return;
    }
    if (this.t <= dur) {
      this.px += this.faceX * hit.speed * dt;
      this.pz += this.faceZ * hit.speed * dt;
      this.clampArena();
      this.playerFig.group.position.set(this.px, 0, this.pz);
      this.playerFig.group.rotation.y = Math.atan2(this.faceX, this.faceZ);
      this.trail.emit(this.px, this.pz, this.playerFig.group.rotation.y, dt);
      this.tryHits();
    }
  }

  private tryHits() {
    const pack = dashFx(this.dashKey(), this.skillLv);
    const hit = pack.hit;
    const r = hit.radius;
    let n = this.dummies.filter((d) => d.hit).length;

    if (pack.reclock && !this.reclockMarked) {
      const pool = this.dummies.filter((d) => {
        if (d.hit) return false;
        const dx = d.x - this.px;
        const dz = d.z - this.pz;
        if (dx * dx + dz * dz > r * r) return false;
        const id = BATTLE_SLOT_IDS[d.slot] as CrowdActorId;
        return dashReactOf(pack, id).kind !== 'none';
      });
      if (pool.length) {
        this.reclockMarked = true;
        this.reclockBait = pool[(Math.random() * pool.length) | 0]!;
        this.potReclockHead(this.reclockBait);
        this.onStatus?.('补卡 · 命中池随机闹钟（不倒地）');
      }
    }

    for (const d of this.dummies) {
      if (d.hit) continue;
      const dx = d.x - this.px;
      const dz = d.z - this.pz;
      if (dx * dx + dz * dz > r * r) continue;
      const id = BATTLE_SLOT_IDS[d.slot] as CrowdActorId;
      const react = dashReactOf(pack, id);
      if (react.kind === 'none') {
        if (pack.slump && !this.slumpPulsed) {
          this.slumpPulsed = true;
          const slow = dashReactOf(pack, 'colleague-a-m');
          this.pulseSlow(this.px, this.pz, slow.kind === 'slow' ? slow.radius : pack.slump.radius);
        }
        continue;
      }
      if (hit.maxHits > 0 && n >= hit.maxHits) break;
      const key = 100 + this.dummies.indexOf(d);
      const look = crowdFx(id);

      // 挂钟目标：标记已处理但不倒地
      if (pack.reclock && d === this.reclockBait) {
        d.hit = true;
        n++;
        continue;
      }

      // 甩锅：命中挂锅减速，不倒地；满级排进依次小爆
      if (pack.blame) {
        const maxPots = Math.max(1, pack.blame.maxPots | 0);
        if (this.blamePotCount < maxPots) {
          const order = this.blamePotCount;
          this.blamePotCount++;
          this.potHead(d);
          this.status.pinSlow(key, d.x, d.z, look.slow);
          if (pack.blame.blastRadius > 0 && pack.blame.blastImpulse > 0) {
            const wait =
              Math.max(0.05, pack.blame.blastDelay) + order * Math.max(0.05, pack.blame.blastGap);
            this.blameBlasts.push({
              d,
              wait,
              r: pack.blame.blastRadius,
              impulse: pack.blame.blastImpulse,
            });
          }
          if (order === 0) this.onStatus?.('甩锅 · 命中挂锅减速');
        }
        d.hit = true;
        n++;
        continue;
      }

      const impulse = dashImpulseOf(pack, react);
      if (react.kind === 'knock' || (react.kind === 'slow' && impulse > 0)) {
        this.knockDummy(d, this.faceX || 0, this.faceZ || -1, impulse);
      } else if (react.kind === 'shove') {
        this.shoveDummy(d);
      } else {
        d.hit = true;
      }
      if (react.kind === 'stun') this.status.pinStun(key, d.x, d.z, look.stun);
      if (react.kind === 'slow') {
        this.pulseSlow(d.x, d.z, react.radius);
        this.status.pinSlow(key, d.x, d.z, look.slow);
      }
      this.potHead(d);
      n++;
    }
  }

  private syncDashHand() {
    const key = this.dashKey();
    const pack = dashFx(key, this.skillLv);
    const show = this.play === 'dash' && key !== 'none' && this.t <= pack.hit.time;
    const slot = show ? this.dashKit?.slot(key, 'hand') : null;
    const template = slot ? this.dashKit?.visual(slot.propId) : null;
    if (!slot || !template) {
      if (this.handPot) this.handPot.visible = false;
      return;
    }
    if (this.handPotLine !== key || !this.handPot?.parent) {
      this.handPot?.removeFromParent();
      this.handPot = mountDashProp(this.playerFig.group, BONE_HAND, template, slot);
      this.handPotLine = key;
    }
    if (this.handPot) this.handPot.visible = true;
  }

  private potHead(d: Dummy) {
    const key = this.dashKey();
    if (key === 'none' || !this.dashKit) {
      if (key === 'blame') this.onStatus?.('甩锅：挂件包未就绪');
      return;
    }
    if (this.headPots.some((p) => p.fig === d.fig)) return;
    const slot = this.dashKit.slot(key, 'head');
    const template = slot ? this.dashKit.visual(slot.propId) : null;
    if (!slot || !template) {
      if (key === 'blame') this.onStatus?.(`甩锅：头顶锅未加载（${slot?.propId ?? '无 head 槽'}）`);
      return;
    }
    const root = mountDashProp(d.fig.group, BONE_HEAD, template, slot);
    if (!root) {
      if (key === 'blame') this.onStatus?.('甩锅：找不到头骨');
      return;
    }
    root.userData.baseY = root.position.y;
    const pack = dashFx(key, this.skillLv);
    this.headPots.push({
      root,
      fig: d.fig,
      dummy: key === 'blame' ? d : null,
      t: pack.reclock?.duration ?? pack.blame?.duration ?? 1.5,
      blastR: 0,
      blastImpulse: 0,
      bob: Math.random() * Math.PI * 2,
    });
  }

  /** 补卡闹钟：挂在不倒地的命中目标头骨上 */
  private potReclockHead(d: Dummy) {
    if (!this.dashKit) {
      this.onStatus?.('补卡闹钟：挂件包未就绪');
      return;
    }
    if (this.headPots.some((p) => p.fig === d.fig)) return;
    const slot = this.dashKit.slot('reclock', 'head');
    const template = slot ? this.dashKit.visual(slot.propId) : null;
    if (!slot || !template) {
      this.onStatus?.('补卡闹钟未加载（检查 prop-clock / dashMounts）');
      return;
    }
    const root = mountDashProp(d.fig.group, BONE_HEAD, template, slot);
    if (!root) {
      this.onStatus?.('补卡闹钟：找不到头骨');
      return;
    }
    root.userData.baseY = root.position.y;
    const cfg = dashFx('reclock', this.skillLv).reclock;
    this.headPots.push({
      root,
      fig: d.fig,
      dummy: d,
      t: cfg?.duration ?? 1,
      blastR: cfg?.blastRadius ?? 0,
      blastImpulse: cfg?.blastImpulse ?? 0,
      bob: Math.random() * Math.PI * 2,
    });
  }

  private tickHeadPots(dt: number) {
    const keep: typeof this.headPots = [];
    for (const pot of this.headPots) {
      pot.t -= dt;
      pot.bob += dt * 6;
      // 只在存档高度上轻微晃，别把 slot.y 盖掉（否则放大闹钟会埋进头里）
      if (pot.dummy && pot.root.parent) {
        const baseY = typeof pot.root.userData.baseY === 'number' ? pot.root.userData.baseY : pot.root.position.y;
        pot.root.position.y = baseY + Math.sin(pot.bob) * 0.03;
      }
      if (pot.t <= 0 || !pot.root.parent) {
        if (pot.t <= 0 && pot.blastR > 0 && pot.dummy) this.blastReclock(pot.dummy, pot.blastR, pot.blastImpulse);
        pot.root.removeFromParent();
        continue;
      }
      keep.push(pot);
    }
    this.headPots = keep;
  }

  private blastReclock(d: Dummy, radius: number, impulse: number) {
    const r2 = radius * radius;
    // 挂钟本人之前被标成 hit 但不倒；爆炸时清掉好一并炸飞
    d.hit = false;
    for (const o of this.dummies) {
      if (o.hit) continue;
      const dx = o.x - d.x;
      const dz = o.z - d.z;
      if (dx * dx + dz * dz > r2) continue;
      this.knockDummy(o, dx || 1, dz, impulse);
    }
    spawnHitFx(this.papers, this.mist, d.x, d.z, crowdFx('colleague-a-m').hit);
    this.onStatus?.('补卡 · 闹钟爆炸');
  }

  private tickBlameBlasts(dt: number) {
    if (!this.blameBlasts.length) return;
    const keep: typeof this.blameBlasts = [];
    for (const pot of this.blameBlasts) {
      pot.wait -= dt;
      if (pot.wait > 0) {
        keep.push(pot);
        continue;
      }
      this.detonateBlamePot(pot.d, pot.r, pot.impulse);
    }
    this.blameBlasts = keep;
  }

  private detonateBlamePot(d: Dummy, radius: number, impulse: number) {
    // 清头上的锅
    this.headPots = this.headPots.filter((p) => {
      if (p.fig !== d.fig) return true;
      p.root.removeFromParent();
      return false;
    });
    d.hit = false;
    this.knockDummy(d, 1, 0, impulse);
    const r2 = radius * radius;
    const near = this.dummies
      .filter((o) => o !== d && !o.hit)
      .map((o) => ({ o, d: (o.x - d.x) ** 2 + (o.z - d.z) ** 2 }))
      .filter((x) => x.d <= r2)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { o } of near) {
      this.knockDummy(o, o.x - d.x || 1, o.z - d.z, impulse);
    }
    spawnHitFx(this.papers, this.mist, d.x, d.z, crowdFx('colleague-a-m').hit);
    this.onStatus?.('甩锅 · 锅爆');
  }

  private clearDashProps() {
    this.handPot?.removeFromParent();
    this.handPot = null;
    this.handPotLine = null;
    for (const pot of this.headPots) pot.root.removeFromParent();
    this.headPots = [];
    this.reclockBait = null;
    this.blamePotCount = 0;
    this.blameBlasts = [];
  }

  private pulseSlow(x: number, z: number, radius: number) {
    const slump = dashFx(this.dashKey(), this.skillLv).slump;
    const look = slump ?? { color: 0x7a90a8, opacity: 0.45, pulseLife: 0.45 };
    this.pulses.spawn(x, z, radius || slump?.radius || 1.9, look.color, look.opacity, look.pulseLife);
  }

  private shoveDummy(d: Dummy) {
    if (d.hit) return;
    d.hit = true;
    d.x += this.faceX * 0.45;
    d.z += this.faceZ * 0.45;
    d.fig.group.position.set(d.x, 0, d.z);
  }

  private stepPhysics(dt: number) {
    this.physAcc += dt;
    let steps = 0;
    while (this.physAcc >= FIXED_DT && steps < 4) {
      this.world.step();
      this.physAcc -= FIXED_DT;
      steps++;
    }
  }

  private stepRags(dt: number) {
    for (const d of this.dummies) {
      if (!d.rag) continue;
      d.rag.age += dt;
      this.rags.driveStand(d.rag);
      this.rags.sync(d.rag);
    }
  }

  private clearRags() {
    for (const d of this.dummies) {
      if (!d.rag) continue;
      this.rags.despawn(d.rag);
      d.rag = null;
    }
  }

  private finishPlay(msg: string) {
    this.play = null;
    this.casterRunning = false;
    this.extrasRunning = false;
    this.playerLocked = false;
    this.clearGlow();
    this.clearRags();
    this.clearDashProps();
    this.clearActors();
    this.rebuildFx();
    if (this.actorEdit && this.actorSkill && this.actorId !== 'player') {
      this.layoutSkillStage();
      this.skillStaged = true;
      this.stagedActor = this.actorId;
      this.stagedSkill = this.actorSkill;
    } else {
      this.restoreCrowdLayout(false);
      this.skillStaged = false;
      this.stagedActor = null;
      this.stagedSkill = null;
    }
    if (this.track === 'keyboard') this.placeKeyboard();
    if (this.track === 'decoy') this.placeDecoy();
    this.onStatus?.(msg);
  }

  private stepDecoy(dt: number) {
    const d = skillFx('decoy', this.skillLv).decoy;
    if (!d) return;
    const life = d.duration;
    for (const slot of this.decoys) {
      const running = slot.runLeft > 0 && slot.speed > 0;
      if (running) {
        const step = Math.min(slot.runLeft, dt);
        slot.group.position.x += slot.dirX * slot.speed * step;
        slot.group.position.z += slot.dirZ * slot.speed * step;
        slot.group.rotation.y = Math.atan2(slot.dirX, slot.dirZ);
        slot.runLeft -= step;
      }
      if (slot.fig) tickDecoyRunner(slot.fig, running, dt);
    }
    if (this.t < life) return;
    if (d.blastRadius > 0.05 && !this.decoyBlasted) {
      this.decoyBlasted = true;
      for (const slot of this.decoys) {
        const gx = slot.group.position.x;
        const gz = slot.group.position.z;
        spawnHitFx(this.papers, this.mist, gx, gz, mergeHitFx(crowdFx('colleague-a-m').hit, { burst: d.hitBurst }));
        for (const dummy of this.dummies) {
          if (Math.hypot(dummy.x - gx, dummy.z - gz) < d.blastRadius) {
            this.knockDummy(dummy, dummy.x - gx, dummy.z - gz, d.blastImpulse, { burst: d.hitBurst });
          }
        }
      }
    }
    if (this.t > life + (this.decoyBlasted ? HOLD_AFTER_DASH : 0.12)) {
      this.finishPlay(`${skillNameOnDay(this.day, 'decoy')} · 可继续 WASD`);
    }
  }

  private clearDecoys() {
    for (const slot of this.decoys) {
      this.scene.remove(slot.group);
      if (slot.fig) disposeDecoyRunner(slot.fig);
      else disposeDecoyGhost(slot.group);
    }
    this.decoys.length = 0;
  }

  private placeDecoy() {
    this.clearDecoys();
    this.bakePlayerPose();
    const look = decoyLookOf(skillFx('decoy', this.skillLv).decoy);
    const skin = decoySkinOnDay(this.day);
    const count = decoyCountOnDay(this.day, this.skillLv);
    const run = decoyRunOnDay(this.day);
    const dirs = run.time > 0 ? decoyRunDirs(this.faceX, this.faceZ, count) : [{ x: this.faceX, z: this.faceZ }];
    const playing = this.play === 'decoy';
    for (let i = 0; i < count; i++) {
      const dir = dirs[i] ?? dirs[0]!;
      const len = Math.hypot(dir.x, dir.z) || 1;
      const rx = dir.x / len;
      const rz = dir.z / len;
      let group: THREE.Group;
      let fig: HumanoidFigure | null = null;
      if (run.time > 0 && playing) {
        fig = makeDecoyRunner(this.kit, look);
        group = fig.group;
      } else {
        group = makeDecoy(this.playerFig, look, skin);
      }
      if (playing) {
        group.position.set(this.px, 0, this.pz);
        group.rotation.y = Math.atan2(rx, rz);
      } else {
        const yaw = this.playerFig.group.rotation.y;
        const sideX = -Math.sin(yaw);
        const sideZ = -Math.cos(yaw);
        const spread = count === 1 ? 0 : (i - (count - 1) / 2) * 0.55;
        group.position.set(
          this.px - Math.cos(yaw) * 1.25 + sideX * spread,
          0,
          this.pz + Math.sin(yaw) * 1.25 + sideZ * spread
        );
        group.rotation.y = yaw;
      }
      this.scene.add(group);
      this.decoys.push({
        group,
        fig,
        dirX: rx,
        dirZ: rz,
        speed: run.speed,
        runLeft: playing && run.time > 0 ? run.time : 0,
      });
    }
  }

  private stepKeyboard(dt: number) {
    const kb = skillFx('keyboard', this.skillLv).keyboard;
    if (!this.keyboard || !kb) return;
    const skin = throwSkinOnDay(this.day);
    const flat = skin === 'boomerang' || !!this.keyboard.userData.throwFlat;
    if (this.kb.phase === 0) {
      this.kb.x += this.faceX * kb.speed * dt;
      this.kb.z += this.faceZ * kb.speed * dt;
      this.kb.traveled += kb.speed * dt;
      if (this.kb.traveled >= kb.range) this.kb.phase = 1;
    } else {
      this.kb.x -= this.faceX * kb.speed * dt;
      this.kb.z -= this.faceZ * kb.speed * dt;
      this.kb.traveled -= kb.speed * dt;
      if (this.kb.traveled <= 0) {
        this.finishPlay(`${skillNameOnDay(this.day, 'keyboard')} · 可继续 WASD`);
        return;
      }
    }
    let y = 1;
    if (flat) {
      const u = Math.min(1, Math.max(0, this.kb.traveled / Math.max(0.01, kb.range)));
      y = 0.7 + 0.9 * Math.sin(Math.PI * u);
    }
    this.keyboard.position.set(this.kb.x, y, this.kb.z);
    const spin = flat ? 22 : skin === 'mouse' ? 14 : 18;
    this.keyboard.rotation.y += dt * spin;
    if (flat) {
      this.keyboard.rotation.x = 0;
      this.keyboard.rotation.z = 0;
    }
    const width = kb.width;
    for (const [i, d] of this.dummies.entries()) {
      if (this.kb.hit.has(i) || d.hit) continue;
      if (Math.hypot(d.x - this.kb.x, d.z - this.kb.z) > width) continue;
      this.kb.hit.add(i);
      if (this.skillLv >= 3 || this.kb.phase === 0) {
        this.knockDummy(d, this.faceX, this.faceZ, kb.knockImpulse, { burst: kb.hitBurst });
      }
    }
  }

  private bakePlayerPose() {
    const running = this.castState === 'run' || this.roaming;
    for (let i = 0; i < 10; i++) setFigureGait(this.playerFig, running, 1 / 30);
  }

  /** 拖滑条 / 切待机跑步时立刻改分身样子。 */
  refreshDecoyLook() {
    if (this.track !== 'decoy') return;
    // 换姿态要重建定格，不能只改材质
    this.placeDecoy();
  }

  private placeKeyboard() {
    const look = throwLookOf(skillFx('keyboard', this.skillLv).keyboard);
    this.keyboard = makeThrowProjectile(throwSkinOnDay(this.day), look);
    const ox = this.px + this.faceX * 0.55;
    const oz = this.pz + this.faceZ * 0.55;
    this.keyboard.position.set(ox, 1, oz);
    this.scene.add(this.keyboard);
    if (this.play === 'keyboard') {
      this.kb.x = ox;
      this.kb.z = oz;
      this.kb.phase = 0;
      this.kb.traveled = 0;
      this.kb.hit = new Set();
    }
  }

  /** 拖滑条时立刻改飞出物样子，不用重播。 */
  refreshThrowLook() {
    if (!this.keyboard) {
      if (this.track !== 'keyboard') return;
      this.placeKeyboard();
      return;
    }
    applyThrowLook(this.keyboard, throwLookOf(skillFx('keyboard', this.skillLv).keyboard));
  }

  /** 拖污渍颜色/透明度时立刻改场上渍。 */
  refreshCoffeeLook() {
    const c = skillFx('coffee', this.skillLv).coffee;
    if (!c) return;
    this.slicks.recolorVisible({ color: coffeeColorOnDay(this.day, this.skillLv), opacity: c.opacity });
  }

  private placeCrate() {
    this.crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.7, 0.45),
      new THREE.MeshLambertMaterial({ color: 0x8a6a42 })
    );
    this.crate.position.set(1.15, 0.35, -0.2);
    this.scene.add(this.crate);
  }

  private pourCoffee() {
    const c = skillFx('coffee', this.skillLv).coffee;
    if (!c) return;
    const look = { color: coffeeColorOnDay(this.day, this.skillLv), opacity: c.opacity, prop: coffeePropOnDay(this.day) };
    const n = Math.max(1, c.count | 0);
    const sideX = -this.faceZ;
    const sideZ = this.faceX;
    for (let k = 0; k < n; k++) {
      const dist = c.range + k * c.spacing + (Math.random() - 0.5) * 0.16;
      const j = (Math.random() - 0.5) * 0.34;
      this.slicks.spawn(
        this.px + this.faceX * dist + sideX * j,
        this.pz + this.faceZ * dist + sideZ * j,
        c.radius * (0.84 + Math.random() * 0.3),
        c.life,
        look
      );
    }
    if (c.splashRadius > 0.05) {
      const dist = c.range + Math.max(0, n - 1) * c.spacing + 0.45;
      const j = (Math.random() - 0.5) * 0.28;
      this.slicks.spawn(
        this.px + this.faceX * dist + sideX * j,
        this.pz + this.faceZ * dist + sideZ * j,
        c.splashRadius,
        c.splashLife || c.life,
        look
      );
    }
  }

  private stepCoffee() {
    const life = skillFx('coffee', this.skillLv).coffee?.life ?? 2.4;
    if (this.t > life + 0.6) this.finishPlay(`${skillNameOnDay(this.day, 'coffee')} · 已复位`);
  }

  private syncRadius() {
    const hit = dashFx(this.dashKey(), this.skillLv).hit;
    this.radiusRing.scale.setScalar(hit.radius);
    this.radiusRing.position.set(this.playerFig.group.position.x, 0.04, this.playerFig.group.position.z);
    const dash =
      !this.actorEdit &&
      (this.track === 'none' || (LINE_IDS as readonly string[]).includes(this.track));
    this.radiusRing.visible = dash;
  }

  private spawnDummies(kit: HumanoidKit) {
    for (const spot of crowdSpots(this.crowdCount)) {
      const fig = cloneBattleFigure(kit, spot.slot);
      fig.group.position.set(spot.x, 0, spot.z);
      fig.group.rotation.y = 0;
      if (spot.slot === 2) fig.group.scale.setScalar(1.38);
      this.scene.add(fig.group);
      this.dummies.push({
        fig,
        slot: spot.slot,
        restX: spot.x,
        restZ: spot.z,
        x: spot.x,
        z: spot.z,
        hit: false,
        heavy: spot.slot === 2,
        shirt: shirtOf(spot.slot, this.dummies.length),
        rag: null,
      });
    }
  }

  private resetDummies() {
    this.clearRags();
    for (const d of this.dummies) {
      d.hit = false;
      d.x = d.restX;
      d.z = d.restZ;
      d.fig.group.visible = true;
      d.fig.group.rotation.set(0, 0, 0);
      d.fig.group.scale.setScalar(d.heavy ? 1.38 : 1);
      d.fig.group.position.set(d.x, 0, d.z);
    }
  }

  private casterDummy() {
    return this.dummies.find((d) => BATTLE_SLOT_IDS[d.slot] === this.actorId);
  }

  private faceToward(d: Dummy, x: number, z: number) {
    d.fig.group.rotation.y = Math.atan2(x - d.x, z - d.z);
  }

  private restoreCrowdLayout(resetPlayer = true) {
    this.clearSkillProps();
    this.resetDummies();
    if (resetPlayer) this.resetPose();
    this.orbit.target.set(0, 0.55, 0.15);
  }

  private layoutSkillStage() {
    const skill = this.actorSkill;
    const pack = skill ? enemySkillFx(skill) : null;
    this.px = 0;
    this.pz = 1.45;
    this.faceX = 0;
    this.faceZ = -1;
    this.playerFig.group.position.set(0, 0, this.pz);
    this.playerFig.group.rotation.y = Math.PI;

    const dist =
      skill === 'cut-in'
        ? Math.min(4.4, Math.max(2.8, (pack?.radius ?? 8) * 0.42))
        : skill === 'rally'
          ? Math.min(3.2, Math.max(2.0, (pack?.radius ?? 5) * 0.45))
          : Math.min(2.45, Math.max(1.65, (pack?.radius ?? 2.4) * 0.78));
    const cz = this.pz - dist;
    const caster = this.casterDummy();
    for (const d of this.dummies) {
      d.hit = false;
      d.fig.group.scale.setScalar(d.heavy ? 1.38 : 1);
      const isCaster = d === caster;
      if (isCaster) {
        d.x = 0;
        d.z = cz;
        d.fig.group.visible = true;
        d.fig.group.position.set(0, 0, cz);
        this.faceToward(d, this.px, this.pz);
      } else {
        d.x = d.restX;
        d.z = d.restZ;
        d.fig.group.visible = false;
        d.fig.group.position.set(d.restX, 0, d.restZ);
      }
    }
    this.clearSkillProps();
    if (skill === 'desk-slam') this.placeSlamProps(0, cz, pack?.radius ?? 2.4);
    this.orbit.target.set(0, 0.65, (this.pz + cz) * 0.5);
  }

  private placeSlamProps(cx: number, cz: number, radius: number) {
    const r = Math.min(1.15, Math.max(0.7, radius * 0.48));
    const spots = [
      { x: cx - r, z: cz + 0.12 },
      { x: cx + r, z: cz - 0.18 },
      { x: cx + 0.28, z: cz + r * 0.72 },
      { x: cx - 0.22, z: cz - r * 0.7 },
    ];
    for (const s of spots) {
      const mesh = makeChair();
      mesh.position.set(s.x, 0, s.z);
      this.scene.add(mesh);
      this.skillProps.push({ mesh, x: s.x, y: 0, z: s.z, vx: 0, vy: 0, vz: 0, flying: false });
    }
  }

  private blastSkillProps(cx: number, cz: number, impulse: number, lift: number) {
    for (const p of this.skillProps) {
      const dx = p.x - cx;
      const dz = p.z - cz;
      const len = Math.hypot(dx, dz) || 0.2;
      const k = (impulse / 420) * 4.4;
      p.vx = (dx / len) * k;
      p.vz = (dz / len) * k;
      p.vy = (lift / 32) * 3.8;
      p.flying = true;
    }
  }

  private stepSkillProps(dt: number) {
    for (const p of this.skillProps) {
      if (!p.flying) continue;
      p.vy -= 18 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= Math.max(0, 1 - 1.15 * dt);
      p.vz *= Math.max(0, 1 - 1.15 * dt);
      if (p.y < 0) {
        p.y = 0;
        p.vy *= -0.22;
        p.vx *= 0.55;
        p.vz *= 0.55;
        if (Math.abs(p.vy) < 0.35) {
          p.vy = 0;
          p.flying = Math.hypot(p.vx, p.vz) > 0.12;
        }
      }
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.rotation.x += p.vz * dt * 0.7;
      p.mesh.rotation.z -= p.vx * dt * 0.7;
    }
  }

  private clearSkillProps() {
    for (const p of this.skillProps) this.scene.remove(p.mesh);
    this.skillProps.length = 0;
  }

  private resetPose() {
    this.px = 0;
    this.pz = PLAYER_START_Z;
    this.faceX = 0;
    this.faceZ = -1;
    this.playerFig.group.position.set(0, 0, PLAYER_START_Z);
    this.playerFig.group.rotation.y = Math.PI;
  }

  private syncPlayerFromFig() {
    this.px = this.playerFig.group.position.x;
    this.pz = this.playerFig.group.position.z;
    const yaw = this.playerFig.group.rotation.y;
    this.faceX = Math.sin(yaw);
    this.faceZ = Math.cos(yaw);
    const len = Math.hypot(this.faceX, this.faceZ) || 1;
    this.faceX /= len;
    this.faceZ /= len;
  }

  private clampArena() {
    this.px = Math.max(-ARENA, Math.min(ARENA, this.px));
    this.pz = Math.max(-ARENA, Math.min(ARENA, this.pz));
  }

  private stepFreeMove(dt: number) {
    const dashing = this.play === 'dash' && this.t <= dashFx(this.dashKey(), this.skillLv).hit.time + 0.02;
    if (dashing || this.playerLocked) {
      this.roaming = false;
      return;
    }
    let ix = 0;
    let iz = 0;
    if (this.keys.has('KeyW')) iz -= 1;
    if (this.keys.has('KeyS')) iz += 1;
    if (this.keys.has('KeyA')) ix -= 1;
    if (this.keys.has('KeyD')) ix += 1;
    if (!ix && !iz) {
      this.roaming = false;
      return;
    }
    this.camera.getWorldDirection(this.moveFwd);
    this.moveFwd.y = 0;
    if (this.moveFwd.lengthSq() < 1e-6) this.moveFwd.set(0, 0, -1);
    else this.moveFwd.normalize();
    this.moveRight.set(-this.moveFwd.z, 0, this.moveFwd.x);
    this.moveWish.set(0, 0, 0);
    this.moveWish.addScaledVector(this.moveFwd, -iz);
    this.moveWish.addScaledVector(this.moveRight, ix);
    if (this.moveWish.lengthSq() < 1e-8) {
      this.roaming = false;
      return;
    }
    this.moveWish.normalize();
    const sp = this.castState === 'run' ? MOVE_SPEED_RUN : MOVE_SPEED;
    this.px += this.moveWish.x * sp * dt;
    this.pz += this.moveWish.z * sp * dt;
    this.clampArena();
    this.faceX = this.moveWish.x;
    this.faceZ = this.moveWish.z;
    this.playerFig.group.position.set(this.px, 0, this.pz);
    this.playerFig.group.rotation.y = Math.atan2(this.faceX, this.faceZ);
    this.roaming = true;
  }

  private clearGlow() {
    if (!this.glowFig) return;
    setFigureGlow(this.glowFig, false);
    this.glowFig = null;
  }

  private clearActors() {
    this.status.clearAll();
    this.channel.clearAll();
    this.clearSkillProps();
    if (this.decoys.length) this.clearDecoys();
    if (this.keyboard) {
      this.scene.remove(this.keyboard);
      this.keyboard = null;
    }
    if (this.crate) {
      this.scene.remove(this.crate);
      this.crate = null;
    }
  }
}

function makeChair() {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0x8a6a42 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.4), wood);
  seat.position.y = 0.42;
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.06), wood);
  back.position.set(0, 0.66, -0.17);
  g.add(back);
  const legGeo = new THREE.BoxGeometry(0.05, 0.4, 0.05);
  for (const [x, z] of [
    [-0.16, -0.14],
    [0.16, -0.14],
    [-0.16, 0.14],
    [0.16, 0.14],
  ] as const) {
    const leg = new THREE.Mesh(legGeo, wood);
    leg.position.set(x, 0.2, z);
    g.add(leg);
  }
  return g;
}

function labelOf(kind: PlayKind, day: WeekdayId = 'monday') {
  if (kind === 'keyboard') return skillNameOnDay(day, 'keyboard');
  if (kind === 'coffee') return skillNameOnDay(day, 'coffee');
  if (kind === 'decoy') return skillNameOnDay(day, 'decoy');
  const map: Record<Exclude<PlayKind, 'keyboard' | 'coffee' | 'decoy'>, string> = {
    dash: '冲撞',
    common: '撞物',
    actor: '角色被动',
  };
  return map[kind];
}

function shirtOf(slot: number, i: number) {
  if (slot === 2) return SHIRT_C;
  if (slot === 3) return SHIRT_F;
  return SHIRT[i % SHIRT.length]!;
}

function emptyEnemies() {
  return {
    cap: 0,
    state: new Uint8Array(0),
    posX: new Float32Array(0),
    posZ: new Float32Array(0),
    slip() {},
  } as unknown as import('../../../src/game/enemies').Enemies;
}
