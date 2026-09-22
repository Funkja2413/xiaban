import * as THREE from 'three/webgpu';
import { initPhysics } from '../sim/physics';
import { FlowField } from '../sim/flowfield';
import { Input } from '../core/input';
import { Hud } from '../core/hud';
import { Level } from './level';
import { levelById, loadLevelCatalog, pointInElevatorPad, type WeekdayId } from '../levels';
import { addLightsToScene, applyAtmosphere, createLights, type SceneLights } from './atmosphere';
import type { Atmosphere } from '../levels';
import { Player } from './player';
import { loadHumanoidKit, type HumanoidKit } from './humanoid';
import { preloadThrowSkins } from './skillProjectiles';
import { AvatarStudio } from './avatarStudio';
import { hideAvatarTune } from './avatarTune';
import { layoutAvatarNames } from '../shell';
import { Enemies, EState, EType } from './enemies';
import { RagdollFactory } from './ragdoll';
import { Chairs } from './chairs';
import { Cards } from './cards';
import { Skills } from './skills';
import { Slicks, preloadSlickProps } from './slicks';
import { DashMounts } from './dashMounts';
import { ChannelMarks, DashTrail, OvertimePop, ImpactMist, PaperBurst, SlowPulse, StatusMarks, spawnHitFx } from './look';
import { SkillChains, SkillShout, SHOUT_Y } from './skillVfx';
import { getStageSize, onStageResize } from '../core/stage';
import { lookForSlot, loadCatalog, setPlayDayHint } from '../catalog';
import { loadPlayerSlot } from '../progress';
import type { PlayerSlotId } from '../roster';
import { commonFx, crowdFx, dashFx, enemySkillFx, loadFxCatalog, mergeHitFx, overtimeMinutesOf, watchFxCatalog, type CrowdActorId, type DashKey } from '../fx/catalog';
import { dayPlayerLoadout } from '../fx/days';
import { preloadDecoyScarecrow } from './decoyGhost';
import { Hazards } from './hazards';
import { bgm, sfx } from '../audio';
import type { BootProgress } from '../boot-progress';

const FIXED_DT = 1 / 60;
const ENEMY_CAP = 80;
const FLOW_REBUILD = 0.15;
const INTERCEPT_REBUILD = 0.3;
const ELEVATOR_WAIT = 20;
/** 开局从电梯滑到出生点的准备秒数 */
const READY_DUR = 3;

type Phase = 'menu' | 'ready' | 'playing' | 'won' | 'lost';

export class Game {
  private renderer!: THREE.WebGPURenderer;
  private scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;

  private world!: Awaited<ReturnType<typeof initPhysics>>;
  /** 追玩家的主流场 */
  private flow!: FlowField;
  /** 通往电梯的静态导航流场（F 拦截 + 玩家箭头共用） */
  private elevFlow!: FlowField;
  /** F 拦截点流场（目标为通往电梯的前方卡口） */
  private interceptFlow!: FlowField;
  private interceptGateX = NaN;
  private interceptGateZ = NaN;

  private level!: Level;
  private lights!: SceneLights;
  private look!: Atmosphere;
  private player!: Player;
  private kit!: HumanoidKit;
  private studio: AvatarStudio | null = null;
  private picking = false;
  private enemies!: Enemies;
  private chairs!: Chairs;
  private input!: Input;
  private hud = new Hud();
  private cards!: Cards;
  private skills!: Skills;
  private slicks!: Slicks;
  private dashMounts!: DashMounts;
  private papers!: PaperBurst;
  private dashTrail!: DashTrail;
  private mist!: ImpactMist;
  private heads!: OvertimePop;
  private pulses!: SlowPulse;
  private chains!: SkillChains;
  private skillShout!: SkillShout;
  private chainHand = new THREE.Vector3();
  private chainHandL = new THREE.Vector3();
  private chainNeck = new THREE.Vector3();
  private playerChainGlow = false;
  private status!: StatusMarks;
  private channel!: ChannelMarks;
  private hazards!: Hazards;
  private objFx = new Set<number>();

  private phase: Phase = 'playing';
  private dayId: WeekdayId = 'monday';
  private playerSlotId: PlayerSlotId = 'player';
  /** 胜负交给产品壳，不再直接弹旧 overlay */
  onSettled: ((kind: 'won' | 'lost', info: { day: WeekdayId; title: string; sub: string }) => void) | null = null;
  private elapsed = 0;
  private elevatorCalled = false;
  private elevatorTimer = 0;
  private elevatorReady = false;
  private elevatorLeft = false;
  private elevatorOpening = false;
  private elevTickSec = -1;
  private clockWarned = false;

  private lastTime = 0;
  private acc = 0;
  private flowTimer = 0;
  private interceptTimer = 0;
  private spawnTimer = 0;
  private stepMs = 0;
  private aiming = false;
  private heavyToastCd = 0;

  private guideArrow!: THREE.Mesh;

  private raycaster = new THREE.Raycaster();
  private aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.9);
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private flowDir = { x: 0, z: 0 };
  private menuFlow!: FlowField;
  private menuWp = 0;
  private menuStuck = 0;
  private glideFrom = new THREE.Vector3();
  private glideTo = new THREE.Vector3();
  private glideT = 0;
  private glideDur = 5;
  private readyCamFrom = new THREE.Vector3();
  private readyCamTo = new THREE.Vector3();
  private readyLeft = 0;
  private readySecShown = -1;
  private readyGoFlash = 0;

  get day() {
    return this.dayId;
  }

  get playerSlot() {
    return this.playerSlotId;
  }

  async start(
    container: HTMLElement,
    day: WeekdayId = 'monday',
    opts: { menu?: boolean; playerSlot?: PlayerSlotId; onProgress?: BootProgress } = {}
  ) {
    this.dayId = day;
    this.playerSlotId = opts.playerSlot ?? loadPlayerSlot();
    setPlayDayHint(day);
    const progress = opts.onProgress;
    progress?.phase('特效', 0.08);
    await loadFxCatalog();
    watchFxCatalog();
    progress?.phase('物理引擎', 0.22);
    this.world = await initPhysics();

    this.renderer = new THREE.WebGPURenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    const size = getStageSize();
    this.renderer.setSize(size.w, size.h);
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    progress?.phase('渲染器', 0.4);
    await this.renderer.init();
    container.appendChild(this.renderer.domElement);
    this.hud.backend = (this.renderer.backend as any).isWebGPUBackend ? 'WebGPU' : 'WebGL2';

    this.camera = new THREE.PerspectiveCamera(55, size.w / size.h, 0.5, 140);

    progress?.phase('关卡', 0.66);
    const days = await loadLevelCatalog();
    const def = levelById(days, day);
    this.level = await Level.create(def);
    this.scene.add(this.level.group);
    this.level.buildPhysics(this.world);

    this.look = def.atmosphere;
    this.lights = createLights(def.atmosphere, def.pointLights);
    addLightsToScene(this.scene, this.lights);
    applyAtmosphere(this.scene, this.renderer, this.lights, def.atmosphere, def.pointLights);

    progress?.phase('同事形象', 0.96);
    const humans = await loadHumanoidKit(this.playerSlotId);
    this.kit = humans;
    await preloadThrowSkins();
    await preloadSlickProps();
    await preloadDecoyScarecrow();
    const { map, playerStart, elevatorPoint } = this.level;

    this.flow = new FlowField(map.minX, map.minZ, map.maxX, map.maxZ, 0.5);
    this.level.applyToFlow(this.flow);
    this.flow.rebuild(playerStart.x, playerStart.z);

    this.elevFlow = new FlowField(map.minX, map.minZ, map.maxX, map.maxZ, 0.5);
    this.level.applyToFlow(this.elevFlow);
    this.elevFlow.rebuild(elevatorPoint.x, elevatorPoint.z);

    this.interceptFlow = new FlowField(map.minX, map.minZ, map.maxX, map.maxZ, 0.5);
    this.level.applyToFlow(this.interceptFlow);
    const firstCut = this.elevFlow.nextGateAlong(playerStart.x, playerStart.z) ?? {
      x: playerStart.x,
      z: playerStart.z,
    };
    this.interceptGateX = firstCut.x;
    this.interceptGateZ = firstCut.z;
    this.interceptFlow.rebuild(firstCut.x, firstCut.z);

    this.menuFlow = new FlowField(map.minX, map.minZ, map.maxX, map.maxZ, 0.5);
    this.level.applyToFlow(this.menuFlow);

    const ragFactory = new RagdollFactory(this.scene, this.world);
    this.player = new Player(this.scene, this.world, playerStart.x, playerStart.z, humans, ragFactory);
    this.player.nav = this.flow;
    this.enemies = new Enemies(this.scene, this.world, this.flow, ragFactory, ENEMY_CAP, humans);
    const looks = await loadCatalog();
    this.enemies.skillOf = (id) => lookForSlot(looks, id)?.enemySkill ?? null;
    this.enemies.resetSkills();
    this.enemies.interceptFlow = this.interceptFlow;
    this.enemies.interceptAtX = firstCut.x;
    this.enemies.interceptAtZ = firstCut.z;
    this.enemies.onTaskDelivered = (type, x, z, gender) => {
      const id = crowdActorOf(type, gender);
      const mins = overtimeMinutesOf(id);
      this.hud.addOvertime(mins);
      this.cards.knockOneOut();
      this.heads.spawn(x, z, mins, crowdFx(id).overtime);
      sfx.play('stamp');
      sfx.play('outlook');
      if (this.hud.overtimeMin >= 360) this.lose();
      else if (!this.clockWarned && this.hud.overtimeMin >= 240) {
        this.clockWarned = true;
        sfx.play('clock_warn');
      }
    };
    this.chairs = new Chairs(this.scene, this.world, this.level.chairSpawns, this.level.pushables);

    // 构筑系统：击倒掉工牌 → 攒满抽卡 → 不暂停三选一
    this.cards = new Cards();
    const loadout = dayPlayerLoadout(day);
    this.cards.setDayKit(day, loadout.dashes, loadout.skills);
    this.cards.onApplied = (label) => this.hud.toast(`${label} 已装备`);
    this.player.cards = this.cards;
    this.dashMounts = new DashMounts(this.scene, this.player, this.enemies);
    await this.dashMounts.load(looks);
    this.player.onDashHit = (i) => {
      const line = this.cards.line;
      if (!line) return;
      const pack = dashFx(line, this.cards.lineLv || 1);
      const dur = pack.reclock?.duration ?? pack.blame?.duration ?? 1.5;
      this.dashMounts.mark(i, line, dur);
    };
    this.enemies.onPotBlast = (i, x, z) => {
      this.dashMounts.clearHead(i);
      spawnHitFx(this.papers, this.mist, x, z, crowdFx(this.enemies.actorId(i)).hit);
      sfx.play('knockdown');
    };
    this.enemies.onKnockdown = (type, x, z, gender, hitOver) => {
      this.cards.addBadges(type === EType.C ? 3 : 1);
      spawnHitFx(this.papers, this.mist, x, z, mergeHitFx(crowdFx(crowdActorOf(type, gender)).hit, hitOver));
      sfx.play('knockdown');
    };
    this.slicks = new Slicks(this.scene);
    this.pulses = new SlowPulse(this.scene);
    this.chains = new SkillChains(this.scene);
    this.skillShout = new SkillShout(this.scene);
    this.player.onSlowPulse = (x, z, r, color, opacity, life) => {
      this.pulses.spawn(x, z, r, color, opacity, life);
    };
    this.hazards = new Hazards();
    this.hazards.load(def, this.level.group);
    this.hazards.onPulse = (x, z, r, color, opacity, life, outline) => {
      this.pulses.spawn(x, z, r, color, opacity, life, outline);
    };
    this.enemies.onSkill = (id, phase, x, z, i) => {
      const pack = enemySkillFx(id);
      if (phase === 'windup') {
        if (id === 'cut-in' || id === 'rally') return;
        this.pulses.spawn(x, z, pack.radius * 0.32, pack.color, pack.opacity, pack.windup, true);
        return;
      }
      if (id === 'cut-in') {
        sfx.play('intercept');
        this.enemies.handWorld(i, this.chainHand);
        this.enemies.handWorld(i, this.chainHandL, true);
        this.player.neckWorld(this.chainNeck);
        this.chains.lockHands(
          i,
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
      } else if (id === 'desk-slam') {
        sfx.play('desk_slam');
        this.pulses.spawn(x, z, pack.radius, pack.color, pack.opacity, 0.4, true);
        this.chairs.blast(x, z, pack.radius, pack.knockImpulse ?? 420, pack.knockLift ?? 32);
        spawnHitFx(this.papers, this.mist, x, z, crowdFx('heavy').hit);
        this.papers.spawn(x, 1.15, z, pack.paper ?? 10, crowdFx('heavy').hit.paper);
      } else if (id === 'rally') {
        sfx.play('rally');
        const p = this.player.pos;
        this.skillShout.burst(x, SHOUT_Y, z, p.x, SHOUT_Y, p.z, pack.color, pack.opacity, pack.waves ?? 3, pack.waveGap ?? 0.14);
      }
    };
    this.skills = new Skills(this.scene, this.world, (x, z, r, life, look) => {
      this.slicks.spawn(x, z, r, life, look);
    }, () => this.player.figure, () => this.kit);
    this.skills.setDay(day);
    this.papers = new PaperBurst(this.scene);
    this.dashTrail = new DashTrail(this.scene);
    this.mist = new ImpactMist(this.scene);
    this.heads = new OvertimePop(this.scene);
    this.status = new StatusMarks(this.scene);
    this.channel = new ChannelMarks(this.scene);

    this.guideArrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.66, 8),
      new THREE.MeshBasicMaterial({ color: 0x7ef0a0, transparent: true, opacity: 0.9 })
    );
    this.guideArrow.rotation.order = 'YXZ';
    this.scene.add(this.guideArrow);

    this.input = new Input(this.renderer.domElement);

    onStageResize(({ w, h }) => {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.studio?.setAspect(w, h);
      this.renderer.setSize(w, h);
      if (this.picking) this.syncAvatarNameLayout();
    });

    this.renderer.setAnimationLoop((t) => this.tick(t));
    (window as any).__game = this;
    progress?.finish();
    if (opts.menu) this.enterMenu();
    else this.beginPlay();
  }

  enterMenu() {
    this.picking = false;
    hideAvatarTune();
    this.phase = 'menu';
    sfx.setChannel(false);
    sfx.setDecoy(false);
    this.acc = 0;
    this.menuWp = 0;
    this.menuStuck = 0;
    this.player.resetRun();
    this.hud.resetRun();
    this.cards.resetRun();
    this.skills.reset();
    this.slicks.clear();
    this.hazards.rearm();
    this.enemies.clearAll();
    this.spawnOpeningCrowd();
    this.level.elevator.setState('idle');
    this.level.elevator.setFloor(1);
    this.player.group.visible = false;
    this.player.menuGhost = true;
    this.guideArrow.visible = false;
    const pts = this.chasePath();
    const s = pts[0] ?? this.level.playerStart;
    this.player.body.setTranslation({ x: s.x, y: 0.66, z: s.z }, true);
    this.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.menuFlow.rebuild(s.x, s.z);
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
    this.pickGlideTarget(true);
    this.pickGlideTarget(false);
    bgm.play('home');
  }

  enterAvatarPick(selected: PlayerSlotId | null = null) {
    this.picking = true;
    const size = getStageSize();
    this.studio = new AvatarStudio(this.kit, size.w / size.h);
    this.studio.setAspect(size.w, size.h);
    hideAvatarTune();
    this.studio.setSelected(selected);
    this.syncAvatarNameLayout();
  }

  selectAvatar(id: PlayerSlotId | null) {
    this.studio?.setSelected(id);
  }

  exitAvatarPick() {
    this.picking = false;
    hideAvatarTune();
  }

  private syncAvatarNameLayout() {
    if (!this.studio) return;
    layoutAvatarNames({
      player: this.studio.footNdc('player'),
      'player-f': this.studio.footNdc('player-f'),
    });
  }

  beginPlay() {
    this.picking = false;
    hideAvatarTune();
    this.phase = 'ready';
    this.elapsed = 0;
    this.acc = 0;
    this.spawnTimer = 0;
    this.elevatorCalled = false;
    this.elevatorTimer = 0;
    this.elevatorReady = false;
    this.elevatorLeft = false;
    this.elevatorOpening = false;
    this.elevTickSec = -1;
    this.clockWarned = false;
    this.readyLeft = READY_DUR;
    this.readySecShown = -1;
    this.readyGoFlash = 0;
    sfx.setChannel(false);
    sfx.setDecoy(false);
    this.hud.resetRun();
    this.cards.resetRun();
    this.skills.reset();
    this.slicks.clear();
    this.hazards.rearm();
    this.player.resetRun();
    this.enemies.clearAll();
    this.spawnOpeningCrowd();
    this.level.elevator.setState('idle');
    this.level.elevator.setFloor(1);
    this.player.menuGhost = false;
    this.player.group.visible = true;
    this.guideArrow.visible = false;
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
    const s = this.level.playerStart;
    this.player.body.setTranslation({ x: s.x, y: 0.66, z: s.z }, true);
    this.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.beginReadyCamera();
    this.syncReadyCount();
    bgm.play(this.dayId);
  }

  /** 镜头先停在终点电梯，3 秒内滑翔回出生点，方便观察路线 */
  private beginReadyCamera() {
    const e = this.level.elevatorPoint;
    const s = this.level.playerStart;
    this.glideFrom.set(e.x * 0.7, 0, e.z - 3);
    this.glideTo.set(s.x * 0.7, 0, s.z - 3);
    this.readyCamFrom.set(e.x * 0.7, 17.5, e.z + 6.5);
    this.readyCamTo.set(s.x * 0.7, 17.5, s.z + 6.5);
    this.glideT = 0;
    this.glideDur = READY_DUR;
    this.camTarget.copy(this.glideFrom);
    this.camera.position.copy(this.readyCamFrom);
    this.camera.lookAt(this.camTarget);
  }

  private syncReadyCount() {
    if (this.phase !== 'ready') {
      if (this.readyGoFlash > 0) this.hud.setReadyCount('go');
      else this.hud.setReadyCount(null);
      return;
    }
    const sec = Math.max(1, Math.ceil(this.readyLeft));
    this.hud.setReadyCount(sec);
    if (sec !== this.readySecShown) {
      this.readySecShown = sec;
      sfx.play('ready_tick');
    }
  }

  private finishReady() {
    this.phase = 'playing';
    this.readyLeft = 0;
    this.readyGoFlash = 0.85;
    this.hud.setReadyCount('go');
    this.guideArrow.visible = true;
    this.snapGameplayCamera();
    sfx.play('ready_go');
  }

  /** 初始阵容：A/C 全场追，F 蹲电梯路上 */
  private spawnOpeningCrowd() {
    const start = this.level.playerStart;
    for (const s of this.level.enemySpawns) {
      const dx = s.x - start.x;
      const dz = s.z - start.z;
      if (dx * dx + dz * dz > 64) this.enemies.spawn(s.x, s.z, EType.A);
    }
    for (const s of this.level.heavyAnchors) this.enemies.spawn(s.x, s.z, EType.C);
    for (const s of this.level.interceptorSpawns) this.enemies.spawn(s.x, s.z, EType.F);
  }

  private tick(timeMs: number) {
    const dt = Math.min((timeMs - this.lastTime) / 1000, 0.05);
    this.lastTime = timeMs;

    if (this.picking && this.studio) {
      this.studio.update(dt);
      this.renderer.render(this.studio.scene, this.studio.camera);
      return;
    }

    if (this.phase === 'playing' || this.phase === 'menu' || this.phase === 'ready') {
      this.acc += dt;
      let sub = 0;
      while (this.acc >= FIXED_DT && sub < 4) {
        this.fixedUpdate(FIXED_DT);
        this.acc -= FIXED_DT;
        sub++;
      }
      if (sub === 4) this.acc = 0;
    }

    if (this.readyGoFlash > 0) {
      this.readyGoFlash -= dt;
      if (this.readyGoFlash <= 0) this.hud.setReadyCount(null);
    }

    const time = timeMs / 1000;
    this.enemies.syncVisuals(time);
    this.chairs.syncVisuals();
    this.player.syncVisual();
    this.dashMounts.update(dt);
    if (this.player.dashing) {
      const line = this.cards.line;
      const pack = dashFx((line ?? 'none') as DashKey, this.cards.lineLv || 1);
      this.dashTrail.setStyle(pack.trail);
      const p = this.player.pos;
      this.dashTrail.emit(p.x, p.z, this.player.yaw, dt);
      for (const hit of this.chairs.overlaps(p.x, p.z, pack.hit.radius)) {
        if (this.objFx.has(hit.i)) continue;
        this.objFx.add(hit.i);
        spawnHitFx(this.papers, this.mist, hit.x, hit.z, commonFx().hitObject);
      }
    } else {
      this.objFx.clear();
    }
    const cutTrail = dashFx('none', 1).trail;
    const cutPack = enemySkillFx('cut-in');
    for (let i = 0; i < this.enemies.cap; i++) {
      if (this.chains.casterOf(i)) {
        if (this.enemies.state[i] !== EState.Chase) this.chains.breakCaster(i);
        else {
          this.enemies.handWorld(i, this.chainHand);
          this.enemies.handWorld(i, this.chainHandL, true);
          this.player.neckWorld(this.chainNeck);
          this.chains.followHands(
            i,
            this.chainHand.x,
            this.chainHand.y,
            this.chainHand.z,
            this.chainHandL.x,
            this.chainHandL.y,
            this.chainHandL.z,
            this.chainNeck.x,
            this.chainNeck.y,
            this.chainNeck.z,
            cutPack.chainStyle
          );
        }
      }
      if (this.enemies.bursting(i)) {
        this.dashTrail.setStyle({ ...cutTrail, color: cutPack.color, ghost: true, opacity: 0.5, stretch: 2.4, copies: 2, interval: 0.028 });
        this.dashTrail.emit(this.enemies.posX[i], this.enemies.posZ[i], this.enemies.yawOf(i), dt);
      }
    }
    this.dashTrail.update(dt);
    this.papers.update(dt);
    this.mist.update(dt);
    this.heads.update(dt);
    this.skillShout.aim(this.player.pos.x, SHOUT_Y, this.player.pos.z);
    this.skillShout.update(dt);
    this.pulses.update(dt);
    this.chains.update(dt);
    const chain = this.chains.live();
    if (chain) {
      this.player.setLockGlow(true, chain.color, enemySkillFx('cut-in').opacity * chain.fade);
      this.playerChainGlow = true;
    } else if (this.playerChainGlow) {
      this.player.setLockGlow(false);
      this.playerChainGlow = false;
    }
    for (let i = 0; i < this.enemies.cap; i++) {
      const live = this.enemies.state[i] !== EState.Inactive;
      const fx = crowdFx(live ? this.enemies.actorId(i) : 'colleague-a-m');
      this.status.syncEnemy(
        i,
        this.enemies.posX[i],
        this.enemies.posZ[i],
        live && this.enemies.stunLeft(i) > 0,
        live && this.enemies.slowLeft(i) > 0,
        fx.stun,
        fx.slow
      );
      this.channel.syncEnemy(
        i,
        this.enemies.posX[i],
        this.enemies.posZ[i],
        live && this.enemies.isChanneling(i),
        this.enemies.bodyScale(i),
        fx.channel
      );
    }
    if (this.phase === 'menu') {
      this.status.clear(1000);
    } else {
      const pfx = crowdFx('colleague-a-m');
      const pp = this.player.pos;
      this.status.syncEnemy(1000, pp.x, pp.z, this.player.stunT > 0 || this.player.ragdolled, this.player.slowed, pfx.stun, pfx.slow);
    }
    this.status.update(dt);
    this.channel.update(dt);
    this.updateGuideArrow(time);
    this.level.elevator.update(dt, time);
    this.updateCamera(dt, time);
    this.hud.update(dt, {
      enemies: this.enemies.activeCount,
      channeling: this.enemies.channelingCount,
      stepMs: this.stepMs,
      dashCd: this.player.dashCd,
    });
    this.cards.setSkillCd(this.skills.cd);

    this.renderer.render(this.scene, this.camera);
  }

  private chasePath() {
    const pts = this.level.menuChase;
    if (pts.length >= 2) return pts;
    const s = this.level.playerStart;
    const e = this.level.elevatorPoint;
    return [s, { x: e.x * 0.35 + s.x * 0.65, z: (s.z + e.z) * 0.5 }, e, { x: -s.x * 0.4, z: s.z }];
  }

  private menuSteer(px: number, pz: number, h: number) {
    const pts = this.chasePath();
    const t = pts[this.menuWp] ?? pts[0];
    const dx = t.x - px;
    const dz = t.z - pz;
    if (dx * dx + dz * dz < 6.25 || this.menuStuck > 4.5) {
      this.menuWp = (this.menuWp + 1) % pts.length;
      this.menuStuck = 0;
      const n = pts[this.menuWp];
      this.menuFlow.rebuild(n.x, n.z);
    } else {
      this.menuStuck += h;
    }
    this.menuFlow.sample(px, pz, this.flowDir);
    if (this.flowDir.x !== 0 || this.flowDir.z !== 0) {
      return { x: this.flowDir.x, z: this.flowDir.z };
    }
    const nt = pts[this.menuWp] ?? t;
    const ndx = nt.x - px;
    const ndz = nt.z - pz;
    const len = Math.hypot(ndx, ndz) || 1;
    return { x: ndx / len, z: ndz / len };
  }

  private pickGlideTarget(snap: boolean) {
    const m = this.level.map;
    const pad = 5.5;
    let x = 0;
    let z = 0;
    for (let i = 0; i < 12; i++) {
      x = m.minX + pad + Math.random() * (m.maxX - m.minX - pad * 2);
      z = m.minZ + pad + Math.random() * (m.maxZ - m.minZ - pad * 2);
      const far = (x - this.glideTo.x) ** 2 + (z - this.glideTo.z) ** 2 > 64;
      if (!this.flow.isBlockedAt(x, z) && (snap || far)) break;
    }
    if (snap) {
      this.glideFrom.set(x, 0, z);
      this.glideTo.set(x, 0, z);
      this.glideT = 0;
      this.glideDur = 1;
      this.camTarget.set(x, 0, z);
      this.camera.position.set(x, 21.5, z + 3.2);
      this.camera.lookAt(this.camTarget);
      return;
    }
    this.glideFrom.copy(this.camTarget);
    this.glideTo.set(x, 0, z);
    this.glideT = 0;
    this.glideDur = 5.2 + Math.random() * 2.8;
  }

  /** 主页：当前关（最后游玩的那一关）里隐形追逐 + 俯视滑翔 */
  private fixedUpdateMenu(h: number) {
    const p = this.player.pos;
    const mv = this.menuSteer(p.x, p.z, h);
    this.player.update(h, mv.x, mv.z, false, this.enemies);
    this.enemies.update(h, p.x, p.z, { suppressChannel: true, bruteChain: false, forceChase: true });
    this.flowTimer += h;
    if (this.flowTimer >= FLOW_REBUILD) {
      this.flowTimer = 0;
      this.flow.rebuild(p.x, p.z);
    }
    const t0 = performance.now();
    this.world.step();
    this.stepMs = this.stepMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  private fixedUpdate(h: number) {
    if (this.phase === 'menu') {
      this.fixedUpdateMenu(h);
      return;
    }
    if (this.phase === 'ready') {
      this.fixedUpdateReady(h);
      return;
    }
    this.elapsed += h;
    this.input.pollKeyboard();
    const p = this.player.pos;

    const mvX = this.input.moveX;
    const mvZ = this.input.moveY;

    // 朝向：右摇杆 / 按住鼠标只改投掷方向，不再开火
    this.aiming = false;
    if (this.input.aiming) {
      const len = Math.hypot(this.input.aimX, this.input.aimY);
      if (len > 0.25) {
        this.player.aimDirX = this.input.aimX / len;
        this.player.aimDirZ = this.input.aimY / len;
        this.aiming = true;
      }
    } else if (this.input.mouseDown && this.input.mouseActive) {
      this.raycaster.setFromCamera(
        { x: this.input.mouseNdcX, y: this.input.mouseNdcY } as THREE.Vector2,
        this.camera
      );
      if (this.raycaster.ray.intersectPlane(this.aimPlane, this.tmpV)) {
        const dx = this.tmpV.x - p.x;
        const dz = this.tmpV.z - p.z;
        const len = Math.hypot(dx, dz);
        if (len > 0.3) {
          this.player.aimDirX = dx / len;
          this.player.aimDirZ = dz / len;
          this.aiming = true;
        }
      }
    }

    if (this.player.ragdolled) {
      this.input.consumeDash();
      this.input.consumeSkill();
    } else {
      if (this.input.consumeDash() && !this.player.requestDash(mvX, mvZ)) sfx.play('ui_deny');
      if (this.input.consumeSkill()) this.castSkill();
    }
    this.player.update(h, mvX, mvZ, this.aiming, this.enemies);
    this.hazards.update(h, this.player, this.enemies);
    this.cards.update(h);

    this.heavyToastCd = Math.max(0, this.heavyToastCd - h);
    if (this.player.bouncedByHeavy && this.heavyToastCd <= 0) {
      this.heavyToastCd = 2;
      this.hud.toast('主管纹丝不动！');
    }

    // 分身存活时全场仇恨转向替身；虚化/引流期间无法被塞任务
    const dp = this.skills.decoyPos;
    const tx = dp ? dp.x : p.x;
    const tz = dp ? dp.z : p.z;
    const pv = this.player.vel;
    this.enemies.update(h, tx, tz, {
      suppressChannel: !!dp || this.player.phasedT > 0 || this.player.ragdolled,
      bruteChain: this.cards.line === 'brute',
      baitOf: dp
        ? (ex, ez) => this.skills.nearestDecoy(ex, ez) ?? { x: tx, z: tz }
        : undefined,
      skillTarget: {
        applySlow: (d, f) => this.player.applySlow(d, f),
        stun: (d) => this.player.stun(d),
        vx: pv.x,
        vz: pv.z,
      },
    });
    this.skills.update(h, p.x, p.z, this.enemies);
    sfx.setChannel(this.phase === 'playing' && this.enemies.channelingCount > 0);
    this.slicks.update(h, this.enemies);
    this.chairs.checkHits(this.enemies);

    // 主流场：追玩家（或替身）
    this.flowTimer += h;
    if (this.flowTimer >= FLOW_REBUILD) {
      this.flowTimer = 0;
      this.flow.rebuild(tx, tz);
    }

    // 拦截流场：咬住当前卡口，玩家走过后再切下一处
    this.interceptTimer += h;
    if (this.interceptTimer >= INTERCEPT_REBUILD) {
      this.interceptTimer = 0;
      this.retargetIntercept(p.x, p.z);
    }

    this.updateElevator(h, p.x, p.z);
    this.updateSpawning(h, p.x, p.z);

    const t0 = performance.now();
    this.world.step();
    this.stepMs = this.stepMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  /** 准备阶段：冻结操作，只走镜头与倒计时 */
  private fixedUpdateReady(h: number) {
    this.input.pollKeyboard();
    this.input.consumeDash();
    this.input.consumeSkill();
    this.aiming = false;
    this.player.update(h, 0, 0, false, this.enemies);
    if (!sfx.armed()) sfx.unlock();
    this.readyLeft -= h;
    this.glideT += h;
    this.syncReadyCount();
    if (this.readyLeft <= 0) this.finishReady();
    const t0 = performance.now();
    this.world.step();
    this.stepMs = this.stepMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  private castSkill() {
    if (!this.cards.skill) return;
    const p = this.player.pos;
    const dx = this.aiming ? this.player.aimDirX : Math.sin(this.player.yaw);
    const dz = this.aiming ? this.player.aimDirZ : Math.cos(this.player.yaw);
    if (!this.skills.cast(this.cards.skill, this.cards.skillLv, p.x, p.z, dx, dz)) {
      sfx.play('ui_deny');
      return;
    }
    if (this.cards.skill === 'decoy') {
      // 放替身的同时玩家虚化 2 秒，方便脱身
      this.player.phasedT = Math.max(this.player.phasedT, 2);
      this.hud.toast('替身上岗！');
    } else if (this.cards.skill === 'coffee') {
      this.hud.toast('泼了一地！');
    }
  }

  private inElevatorZone(x: number, z: number) {
    return pointInElevatorPad(x, z, this.level.def.elevator);
  }

  private updateElevator(h: number, px: number, pz: number) {
    const inside = this.inElevatorZone(px, pz);
    if (!this.elevatorCalled) {
      if (inside) {
        this.elevatorCalled = true;
        this.elevatorLeft = false;
        this.elevatorTimer = ELEVATOR_WAIT;
        this.level.elevator.setState('called');
        this.elevTickSec = Math.ceil(ELEVATOR_WAIT);
        sfx.play('elev_call');
        this.hud.toast('电梯已呼叫！墙钮亮了，先离开再靠近一次');
      }
      return;
    }
    if (!inside) this.elevatorLeft = true;

    if (!this.elevatorReady) {
      this.elevatorTimer -= h;
      const floor = 1 + Math.max(0, Math.round(17 * (this.elevatorTimer / ELEVATOR_WAIT)));
      this.level.elevator.setFloor(floor);
      const sec = Math.ceil(this.elevatorTimer);
      this.hud.setElevatorTimer(`电梯到达还需 ${sec} 秒`);
      if (sec !== this.elevTickSec && this.elevatorTimer > 0) {
        this.elevTickSec = sec;
        sfx.play('elev_tick');
      }
      if (this.elevatorTimer <= 0) {
        this.elevatorReady = true;
        this.level.elevator.setState('ready');
        this.level.elevator.setFloor(1);
        sfx.play('elev_ding');
        this.hud.setElevatorTimer(this.elevatorLeft ? '电梯到了！再靠近一次开门' : '电梯到了！先离开门口，再靠近一次开门');
      }
      return;
    }

    if (this.elevatorOpening) {
      if (this.level.elevator.openT >= 0.58) this.win();
      return;
    }

    if (inside && this.elevatorLeft) {
      this.elevatorOpening = true;
      this.level.elevator.setState('opening');
      sfx.play('elev_open');
      this.hud.toast('电梯门开了！');
      this.hud.setElevatorTimer(null);
      return;
    }
    if (inside) this.hud.setElevatorTimer('先离开门口，再靠近一次开门');
  }

  /** 呼叫电梯后只在电梯所在半边补人，不写死周一的 z>-6 */
  private spawnOnElevHalf(x: number, z: number) {
    const { map, elevatorPoint: e } = this.level;
    const midX = (map.minX + map.maxX) * 0.5;
    const midZ = (map.minZ + map.maxZ) * 0.5;
    const alongZ = Math.abs(e.z - midZ) >= Math.abs(e.x - midX);
    return alongZ ? (e.z - midZ) * (z - midZ) >= 0 : (e.x - midX) * (x - midX) >= 0;
  }

  private updateSpawning(h: number, px: number, pz: number) {
    // 电梯呼叫后加压：刷新更快，且偏向大厅方向
    const interval = this.elevatorCalled ? 0.4 : 0.7;
    this.spawnTimer += h;
    if (this.spawnTimer >= interval && this.enemies.activeCount < ENEMY_CAP) {
      this.spawnTimer = 0;
      const spawns = this.level.enemySpawns;
      if (!spawns.length) return;
      const playerCost = this.elevFlow.costAt(px, pz);
      for (let tries = 0; tries < 12; tries++) {
        const s = spawns[(Math.random() * spawns.length) | 0];
        if (!s) continue;
        if (this.elevatorCalled) {
          if (!this.spawnOnElevHalf(s.x, s.z)) continue;
        } else if (playerCost >= 0) {
          const sc = this.elevFlow.costAt(s.x, s.z);
          // 只补在玩家前方（更靠近电梯），直跑也能碰上
          if (sc < 0 || sc > playerCost - 2) continue;
        }
        const dx = s.x - px;
        const dz = s.z - pz;
        if (dx * dx + dz * dz > 64) {
          if (this.enemies.spawn(s.x + (Math.random() - 0.5), s.z + (Math.random() - 0.5), EType.A)) {
            sfx.play('spawn');
          }
          break;
        }
      }
    }
  }

  private win() {
    if (this.phase !== 'playing') return;
    this.phase = 'won';
    sfx.playResult('won');
    this.hud.setElevatorTimer(null);
    const mm = Math.floor(this.elapsed / 60);
    const ss = Math.floor(this.elapsed % 60);
    const sub = `逃亡用时 ${mm}:${String(ss).padStart(2, '0')}<br>最终下班时间 ${this.hud.deadlineText}`;
    this.onSettled?.('won', { day: this.dayId, title: '成功下班！', sub });
  }

  private lose() {
    if (this.phase !== 'playing') return;
    this.phase = 'lost';
    sfx.playResult('lost');
    this.hud.setElevatorTimer(null);
    this.onSettled?.('lost', {
      day: this.dayId,
      title: '今晚走不了了…',
      sub: '任务塞到了 24:00<br>下次试着把人群引开、用冲刺撞穿薄弱处',
    });
  }

  private interceptPassed(px: number, pz: number, gx: number, gz: number) {
    const pc = this.elevFlow.costAt(px, pz);
    const gc = this.elevFlow.costAt(gx, gz);
    if (pc < 0 || gc < 0) return true;
    return pc <= gc;
  }

  private retargetIntercept(px: number, pz: number) {
    const held = Number.isFinite(this.interceptGateX);
    if (held && !this.interceptPassed(px, pz, this.interceptGateX, this.interceptGateZ)) {
      return;
    }
    const next = this.elevFlow.nextGateAlong(px, pz);
    if (!next) return;
    const cut = next;
    if (held && Math.hypot(cut.x - this.interceptGateX, cut.z - this.interceptGateZ) < 0.6) {
      return;
    }
    this.interceptGateX = cut.x;
    this.interceptGateZ = cut.z;
    this.interceptFlow.rebuild(cut.x, cut.z);
    this.enemies.interceptAtX = cut.x;
    this.enemies.interceptAtZ = cut.z;
  }

  private updateGuideArrow(time: number) {
    const p = this.player.pos;
    this.elevFlow.sample(p.x, p.z, this.flowDir);
    const dx = this.flowDir.x;
    const dz = this.flowDir.z;
    if (this.phase === 'menu' || this.phase === 'ready' || (dx === 0 && dz === 0) || this.elevatorCalled) {
      this.guideArrow.visible = false;
      return;
    }
    this.guideArrow.visible = true;
    const bob = Math.sin(time * 4) * 0.08;
    this.guideArrow.position.set(p.x + dx * 1.6, 2.1 + bob, p.z + dz * 1.6);
    this.guideArrow.rotation.set(Math.PI / 2, Math.atan2(dx, dz), 0, 'YXZ');
  }

  private snapGameplayCamera() {
    const p = this.player.pos;
    this.camTarget.set(p.x * 0.7, 0, p.z - 3);
    this.camera.position.set(p.x * 0.7, 17.5, p.z + 6.5);
    this.camera.lookAt(this.camTarget);
  }

  private updateCamera(dt: number, _time: number) {
    if (this.phase === 'menu') {
      this.glideT += dt;
      let u = this.glideDur > 0 ? this.glideT / this.glideDur : 1;
      if (u >= 1) {
        this.pickGlideTarget(false);
        u = 0;
      }
      const k = u * u * (3 - 2 * u);
      this.camTarget.lerpVectors(this.glideFrom, this.glideTo, k);
      this.tmpV2.set(this.camTarget.x, 21.5, this.camTarget.z + 3.2);
      const s = 1 - Math.pow(0.02, dt);
      this.camera.position.lerp(this.tmpV2, s);
      this.camera.lookAt(this.camTarget);
      return;
    }
    if (this.phase === 'ready') {
      const u = this.glideDur > 0 ? Math.min(1, this.glideT / this.glideDur) : 1;
      const k = u * u * (3 - 2 * u);
      this.camTarget.lerpVectors(this.glideFrom, this.glideTo, k);
      this.camera.position.lerpVectors(this.readyCamFrom, this.readyCamTo, k);
      this.camera.lookAt(this.camTarget);
      return;
    }
    const p = this.player.pos;
    this.camTarget.set(p.x * 0.7, 0, p.z - 3);
    this.tmpV2.set(p.x * 0.7, 17.5, p.z + 6.5);
    const k = 1 - Math.pow(0.001, dt);
    this.camera.position.lerp(this.tmpV2, k);
    this.camera.lookAt(this.camTarget);
  }
}

function crowdActorOf(type: EType, gender: number): CrowdActorId {
  if (type === EType.C) return 'heavy';
  if (type === EType.F) return 'interceptor';
  return gender ? 'colleague-a-f' : 'colleague-a-m';
}
