import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { commonFx, crowdFx, dashFx, dashImpulseOf, dashReactOf, skillFx, type ActorId, type CrowdActorId, type DashKey, type SkillKey } from '../../../src/fx/catalog';
import { BATTLE_SLOT_IDS } from '../../../src/catalog';
import { rosterSlot } from '../../../src/roster';
import {
  cloneBattleFigure,
  clonePlayerFigure,
  setFigureGait,
  type HumanoidFigure,
  type HumanoidKit,
} from '../../../src/game/humanoid';
import { DashTrail, HeadMark, ImpactMist, PaperBurst, SlowPulse, StatusMarks, spawnHitFx } from '../../../src/game/look';
import { RagdollFactory, type RagdollHandle } from '../../../src/game/ragdoll';
import { Slicks } from '../../../src/game/slicks';

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
  x: number;
  z: number;
  hit: boolean;
  heavy: boolean;
  shirt: number;
  rag: RagdollHandle | null;
}

/** 挤在冲刺廊道里，默认半径 1、时长 0.18 能扫到一整群 */
const CROWD: { slot: number; x: number; z: number }[] = [
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

const PLAYER_START_Z = 2.35;
const HOLD_AFTER_DASH = 2.15;
const FIXED_DT = 1 / 60;

export class FxPreview {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly orbit: OrbitControls;
  skillLv = 1;
  track: 'common' | DashKey | SkillKey = 'none';
  actorId: ActorId = 'player';
  /** 正在编角色被动时，不画冲刺判定辅助圈 */
  actorEdit = false;
  castState: CastState = 'idle';

  private world: RAPIER.World;
  private rags: RagdollFactory;
  private papers: PaperBurst;
  private trail: DashTrail;
  private mist: ImpactMist;
  private heads: HeadMark;
  private pulses: SlowPulse;
  private status: StatusMarks;
  private slicks: Slicks;
  private kit: HumanoidKit;
  private playerFig: HumanoidFigure;
  private radiusRing: THREE.Mesh;
  private dummies: Dummy[] = [];
  private decoy: THREE.Group | null = null;
  private keyboard: THREE.Mesh | null = null;
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
  private commonFired = false;
  private actorFired = false;
  private overtimeAcc = 99;
  private lastOvertimeActor: ActorId | null = null;
  private onStatus: ((s: string) => void) | null = null;

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
    this.heads = new HeadMark(this.scene);
    this.pulses = new SlowPulse(this.scene);
    this.status = new StatusMarks(this.scene, 16);
    this.slicks = new Slicks(this.scene);
    this.resetPose();
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
    this.papers = new PaperBurst(this.scene);
    this.trail = new DashTrail(this.scene);
    this.mist = new ImpactMist(this.scene);
    this.heads = new HeadMark(this.scene);
    this.pulses = new SlowPulse(this.scene);
    this.slicks.clear();
  }

  start(kind: PlayKind) {
    this.clearActors();
    this.resetDummies();
    this.resetPose();
    this.rebuildFx();
    this.play = kind;
    this.t = 0;
    this.kb = { x: 0, z: 2.2, phase: 0, traveled: 0, hit: new Set() };
    this.decoyBlasted = false;
    this.slumpPulsed = false;
    this.commonFired = false;
    this.actorFired = false;
    this.trail.setStyle(dashFx(this.dashKey(), this.skillLv).trail);
    if (kind === 'decoy') this.placeDecoy();
    if (kind === 'keyboard') this.placeKeyboard();
    if (kind === 'coffee') this.pourCoffee();
    if (kind === 'common') this.placeCrate();
    this.onStatus?.(`播放 ${labelOf(kind)}`);
  }

  tick(now: number) {
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.orbit.update();
    this.step(dt);
    this.stepPhysics(dt);
    this.stepRags(dt);
    this.updateGaits(dt);
    this.papers.update(dt);
    this.trail.update(dt);
    this.mist.update(dt);
    this.heads.update(dt);
    this.pulses.update(dt);
    if (this.actorEdit && this.actorId !== 'player') {
      this.syncEditStatus();
      this.stepOvertimePreview(dt);
    } else {
      this.overtimeAcc = 99;
      this.lastOvertimeActor = null;
      if (!this.play) this.status.clearAll();
    }
    this.dummies.forEach((d, i) => this.status.follow(100 + i, d.x, d.z));
    this.status.update(dt);
    this.slicks.update(dt, emptyEnemies());
    this.syncRadius();
    const dashing = this.play === 'dash' && this.t <= dashFx(this.dashKey(), this.skillLv).hit.time + 0.02;
    this.playerFig.playerHalo?.update(dt, dashing);
    this.renderer.render(this.scene, this.camera);
  }

  private dashKey(): DashKey {
    return this.track === 'brute' || this.track === 'slump' || this.track === 'phantom' || this.track === 'none' ? this.track : 'none';
  }

  private knockLook(d: Dummy) {
    return crowdFx(BATTLE_SLOT_IDS[d.slot] as CrowdActorId).hit;
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
      if (BATTLE_SLOT_IDS[d.slot] !== this.actorId) continue;
      this.heads.spawn(d.x, d.z, look.overtime);
      n++;
    }
    if (n) this.onStatus?.('判定加时 · 头顶循环预览（不用贴近）');
  }

  private syncEditStatus() {
    const id = this.actorId;
    if (id === 'player') return;
    const look = crowdFx(id);
    for (let i = 0; i < this.dummies.length; i++) {
      const d = this.dummies[i]!;
      const key = 100 + i;
      if (BATTLE_SLOT_IDS[d.slot] !== id) {
        this.status.clear(key);
        continue;
      }
      this.status.pinStun(key, d.x, d.z, look.stun);
      this.status.pinSlow(key, d.x, d.z, look.slow);
    }
  }

  private updateGaits(dt: number) {
    const pack = dashFx(this.dashKey(), this.skillLv);
    const dashing = this.play === 'dash';
    const playerMove = dashing && this.t <= pack.hit.time + 0.02;
    setFigureGait(this.playerFig, this.castState === 'run' || playerMove, dt);
    for (const d of this.dummies) {
      setFigureGait(d.fig, !d.hit && this.castState === 'run', dt);
    }
  }

  private step(dt: number) {
    if (!this.play) return;
    this.t += dt;
    if (this.play === 'dash') this.stepDash(dt);
    else if (this.play === 'common') this.stepCommon();
    else if (this.play === 'actor') this.stepActor();
    else if (this.play === 'decoy') this.stepDecoy();
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

  private stepActor() {
    if (!this.actorFired && this.t >= 0.08) {
      this.actorFired = true;
      if (this.actorId === 'player') {
        this.onStatus?.('玩家光环');
      } else {
        const dummy = this.dummies.find((d) => BATTLE_SLOT_IDS[d.slot] === this.actorId) ?? this.dummies[0];
        if (dummy) {
          const look = crowdFx(this.actorId);
          const key = 100 + this.dummies.indexOf(dummy);
          this.heads.spawn(dummy.x, dummy.z, look.overtime);
          this.status.pinStun(key, dummy.x, dummy.z, look.stun);
          this.status.pinSlow(key, dummy.x, dummy.z, look.slow);
          spawnHitFx(this.papers, this.mist, dummy.x, dummy.z, look.hit);
        }
      }
    }
    if (this.t > HOLD_AFTER_DASH) this.finishPlay('角色被动 · 已复位');
  }

  private stepDash(dt: number) {
    const pack = dashFx(this.dashKey(), this.skillLv);
    const hit = pack.hit;
    const dur = hit.time;
    if (this.t > dur + HOLD_AFTER_DASH) {
      this.finishPlay('冲撞结束 · 已复位');
      return;
    }
    if (this.t <= dur) {
      this.pz -= hit.speed * dt;
      this.playerFig.group.position.set(this.px, 0, this.pz);
      this.playerFig.group.rotation.y = Math.PI;
      this.trail.emit(this.px, this.pz, Math.PI, dt);
      this.tryHits();
    }
  }

  private tryHits() {
    const pack = dashFx(this.dashKey(), this.skillLv);
    const hit = pack.hit;
    const r = hit.radius;
    let n = this.dummies.filter((d) => d.hit).length;
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
      const impulse = dashImpulseOf(pack, react);
      if (react.kind === 'knock' || (react.kind === 'slow' && impulse > 0)) {
        this.knockDummy(d, 0, -1, impulse);
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
      n++;
    }
  }

  private pulseSlow(x: number, z: number, radius: number) {
    const slump = dashFx(this.dashKey(), this.skillLv).slump;
    const look = slump ?? { color: 0x7a90a8, opacity: 0.45, pulseLife: 0.45 };
    this.pulses.spawn(x, z, radius || slump?.radius || 1.9, look.color, look.opacity, look.pulseLife);
  }

  private shoveDummy(d: Dummy) {
    if (d.hit) return;
    d.hit = true;
    d.z -= 0.45;
    d.fig.group.position.set(d.x, 0, d.z);
  }

  private knockDummy(d: Dummy, dirX: number, dirZ: number, impulse: number) {
    if (d.hit) return;
    d.hit = true;
    d.fig.group.visible = false;
    const len = Math.hypot(dirX, dirZ) || 1;
    const power = Math.min(Math.max(impulse * 0.85, 200), 500);
    d.rag = this.rags.spawn(d.x, d.z, d.shirt, dirX / len, dirZ / len, power, d.slot === 2 ? 1.38 : 1, false, {
      kit: this.kit,
      slot: d.slot,
    });
    spawnHitFx(this.papers, this.mist, d.x, d.z, this.knockLook(d));
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
    this.clearRags();
    this.resetDummies();
    this.resetPose();
    this.clearActors();
    this.rebuildFx();
    this.onStatus?.(msg);
  }

  private stepDecoy() {
    const d = skillFx('decoy', this.skillLv).decoy;
    if (!d) return;
    const life = d.duration;
    if (this.decoy) this.decoy.rotation.z = Math.sin(this.t * 7) * 0.06;
    if (this.t < life) return;
    if (d.blastRadius > 0.05 && !this.decoyBlasted) {
      this.decoyBlasted = true;
      spawnHitFx(this.papers, this.mist, 0, 0, crowdFx('colleague-a-m').hit);
      for (const dummy of this.dummies) {
        if (Math.hypot(dummy.x, dummy.z) < d.blastRadius) this.knockDummy(dummy, dummy.x, dummy.z, d.blastImpulse);
      }
    }
    if (this.t > life + (this.decoyBlasted ? HOLD_AFTER_DASH : 0.12)) {
      this.finishPlay('分身结束 · 已复位');
    }
  }

  private stepKeyboard(dt: number) {
    const kb = skillFx('keyboard', this.skillLv).keyboard;
    if (!this.keyboard || !kb) return;
    if (this.kb.phase === 0) {
      this.kb.z -= kb.speed * dt;
      this.kb.traveled += kb.speed * dt;
      if (this.kb.traveled >= kb.range) this.kb.phase = 1;
    } else {
      this.kb.z += kb.speed * dt;
      if (this.kb.z > 2.4) {
        this.finishPlay('键盘结束 · 已复位');
        return;
      }
    }
    this.keyboard.position.set(this.kb.x, 1, this.kb.z);
    this.keyboard.rotation.y += dt * 18;
    const width = kb.width;
    for (const [i, d] of this.dummies.entries()) {
      if (this.kb.hit.has(i) || d.hit) continue;
      if (Math.hypot(d.x - this.kb.x, d.z - this.kb.z) > width) continue;
      this.kb.hit.add(i);
      if (this.skillLv >= 3 || this.kb.phase === 0) {
        this.knockDummy(d, 0, this.kb.phase === 0 ? -1 : 1, kb.knockImpulse);
      }
    }
  }

  private placeDecoy() {
    this.decoy = makeStandee();
    this.decoy.position.set(0, 0, 0);
    this.scene.add(this.decoy);
  }

  private placeKeyboard() {
    this.keyboard = new THREE.Mesh(
      new THREE.BoxGeometry(0.74, 0.07, 0.3),
      new THREE.MeshLambertMaterial({ color: 0xe8e8ec })
    );
    this.keyboard.position.set(0, 1, 2.2);
    this.scene.add(this.keyboard);
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
    const look = { color: c.color, opacity: c.opacity };
    const n = Math.max(1, c.count | 0);
    for (let k = 0; k < n; k++) {
      const dist = c.range + k * c.spacing + (Math.random() - 0.5) * 0.16;
      const jx = (Math.random() - 0.5) * 0.34;
      this.slicks.spawn(this.px + jx, this.pz - dist, c.radius * (0.84 + Math.random() * 0.3), c.life, look);
    }
    if (c.splashRadius > 0.05) {
      const dist = c.range + Math.max(0, n - 1) * c.spacing + 0.45;
      this.slicks.spawn(this.px + (Math.random() - 0.5) * 0.28, this.pz - dist, c.splashRadius, c.splashLife || c.life, look);
    }
  }

  private stepCoffee() {
    const life = skillFx('coffee', this.skillLv).coffee?.life ?? 2.4;
    if (this.t > life + 0.6) this.finishPlay('咖啡渍 · 已复位');
  }

  private syncRadius() {
    const hit = dashFx(this.dashKey(), this.skillLv).hit;
    this.radiusRing.scale.setScalar(hit.radius);
    this.radiusRing.position.set(this.playerFig.group.position.x, 0.04, this.playerFig.group.position.z);
    const dash =
      !this.actorEdit &&
      (this.track === 'none' || this.track === 'brute' || this.track === 'slump' || this.track === 'phantom');
    this.radiusRing.visible = dash;
  }

  private spawnDummies(kit: HumanoidKit) {
    for (const spot of CROWD) {
      const fig = cloneBattleFigure(kit, spot.slot);
      fig.group.position.set(spot.x, 0, spot.z);
      fig.group.rotation.y = 0;
      if (spot.slot === 2) fig.group.scale.setScalar(1.38);
      this.scene.add(fig.group);
      this.dummies.push({
        fig,
        slot: spot.slot,
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
      d.fig.group.visible = true;
      d.fig.group.rotation.set(0, 0, 0);
      d.fig.group.position.set(d.x, 0, d.z);
    }
  }

  private resetPose() {
    this.px = 0;
    this.pz = PLAYER_START_Z;
    this.playerFig.group.position.set(0, 0, PLAYER_START_Z);
    this.playerFig.group.rotation.y = Math.PI;
  }

  private clearActors() {
    this.status.clearAll();
    if (this.decoy) {
      this.scene.remove(this.decoy);
      this.decoy = null;
    }
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

function makeStandee() {
  const g = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.46, 0.05), new THREE.MeshLambertMaterial({ color: 0xd9c9a3 }));
  board.position.y = 0.75;
  g.add(board);
  const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.68, 0.03), new THREE.MeshLambertMaterial({ color: 0x3b82f6 }));
  shirt.position.set(0, 0.82, 0.035);
  g.add(shirt);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshLambertMaterial({ color: 0xf0c8a0 }));
  head.scale.z = 0.25;
  head.position.set(0, 1.34, 0.035);
  g.add(head);
  return g;
}

function labelOf(kind: PlayKind) {
  const map: Record<PlayKind, string> = {
    dash: '冲撞',
    common: '撞物',
    decoy: '摸鱼分身',
    keyboard: '回旋键盘',
    coffee: '咖啡',
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
