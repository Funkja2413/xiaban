import * as THREE from 'three/webgpu';
import { initPhysics } from '../sim/physics';
import { FlowField } from '../sim/flowfield';
import { Input } from '../core/input';
import { Hud } from '../core/hud';
import { Level } from './level';
import { levelById, loadLevelCatalog, type WeekdayId } from '../levels';
import { addLightsToScene, applyAtmosphere, createLights, type SceneLights } from './atmosphere';
import type { Atmosphere } from '../levels';
import { Player } from './player';
import { loadHumanoidKit } from './humanoid';
import { Enemies, EState, EType } from './enemies';
import { RagdollFactory } from './ragdoll';
import { Chairs } from './chairs';
import { Bullets } from './bullets';
import { Cards } from './cards';
import { Skills } from './skills';
import { Slicks } from './slicks';
import { DashTrail, HeadMark, ImpactMist, PaperBurst, SlowPulse, StatusMarks, spawnHitFx } from './look';
import { getStageSize, onStageResize } from '../core/stage';
import { setPlayDayHint } from '../catalog';
import { commonFx, crowdFx, dashFx, loadFxCatalog, watchFxCatalog, type CrowdActorId, type DashKey } from '../fx/catalog';

const FIXED_DT = 1 / 60;
const ENEMY_CAP = 80;
const FIRE_INTERVAL = 1 / 9;
const FLOW_REBUILD = 0.15;
const INTERCEPT_REBUILD = 0.3;
const ELEVATOR_WAIT = 20;

type Phase = 'menu' | 'playing' | 'won' | 'lost';

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
  private enemies!: Enemies;
  private chairs!: Chairs;
  private bullets!: Bullets;
  private input!: Input;
  private hud = new Hud();
  private cards!: Cards;
  private skills!: Skills;
  private slicks!: Slicks;
  private papers!: PaperBurst;
  private dashTrail!: DashTrail;
  private mist!: ImpactMist;
  private heads!: HeadMark;
  private pulses!: SlowPulse;
  private status!: StatusMarks;
  private objFx = new Set<number>();

  private phase: Phase = 'playing';
  private dayId: WeekdayId = 'monday';
  /** 胜负交给产品壳，不再直接弹旧 overlay */
  onSettled: ((kind: 'won' | 'lost', info: { day: WeekdayId; title: string; sub: string }) => void) | null = null;
  private elapsed = 0;
  private elevatorCalled = false;
  private elevatorTimer = 0;
  private elevatorReady = false;
  private elevatorLeft = false;
  private elevatorOpening = false;

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

  get day() {
    return this.dayId;
  }

  async start(container: HTMLElement, day: WeekdayId = 'monday', opts: { menu?: boolean } = {}) {
    this.dayId = day;
    setPlayDayHint(day);
    await loadFxCatalog();
    watchFxCatalog();
    this.world = await initPhysics();

    this.renderer = new THREE.WebGPURenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    const size = getStageSize();
    this.renderer.setSize(size.w, size.h);
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    await this.renderer.init();
    container.appendChild(this.renderer.domElement);
    this.hud.backend = (this.renderer.backend as any).isWebGPUBackend ? 'WebGPU' : 'WebGL2';

    this.camera = new THREE.PerspectiveCamera(55, size.w / size.h, 0.5, 140);

    const days = await loadLevelCatalog();
    const def = levelById(days, day);
    this.level = await Level.create(def);
    this.scene.add(this.level.group);
    this.level.buildPhysics(this.world);

    this.look = def.atmosphere;
    this.lights = createLights(def.atmosphere, def.pointLights);
    addLightsToScene(this.scene, this.lights);
    applyAtmosphere(this.scene, this.renderer, this.lights, def.atmosphere, def.pointLights);

    const humans = await loadHumanoidKit();
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

    this.player = new Player(this.scene, this.world, playerStart.x, playerStart.z, humans);
    const ragFactory = new RagdollFactory(this.scene, this.world);
    this.enemies = new Enemies(this.scene, this.world, this.flow, ragFactory, ENEMY_CAP, humans);
    this.enemies.interceptFlow = this.interceptFlow;
    this.enemies.interceptAtX = firstCut.x;
    this.enemies.interceptAtZ = firstCut.z;
    this.enemies.onTaskDelivered = (type, x, z, gender) => {
      const mins = type === EType.C ? 45 : type === EType.F ? 30 : [15, 15, 30][(Math.random() * 3) | 0];
      this.hud.addOvertime(mins);
      this.cards.knockOneOut();
      this.heads.spawn(x, z, crowdFx(crowdActorOf(type, gender)).overtime);
      if (this.hud.overtimeMin >= 360) this.lose();
    };
    this.chairs = new Chairs(this.scene, this.world, this.level.chairSpawns, this.level.pushables);
    this.bullets = new Bullets(this.scene, this.level.bulletBlockers, this.level.map);

    // 构筑系统：击倒掉工牌 → 攒满抽卡 → 不暂停三选一
    this.cards = new Cards();
    this.cards.onApplied = (label) => this.hud.toast(`${label} 已装备`);
    this.player.cards = this.cards;
    this.enemies.onKnockdown = (type, x, z, gender) => {
      this.cards.addBadges(type === EType.C ? 3 : 1);
      spawnHitFx(this.papers, this.mist, x, z, crowdFx(crowdActorOf(type, gender)).hit);
    };
    this.slicks = new Slicks(this.scene);
    this.pulses = new SlowPulse(this.scene);
    this.player.onSlowPulse = (x, z, r, color, opacity, life) => {
      this.pulses.spawn(x, z, r, color, opacity, life);
    };
    this.skills = new Skills(this.scene, (x, z, r, life, look) => {
      this.slicks.spawn(x, z, r, life, look);
    });
    this.papers = new PaperBurst(this.scene);
    this.dashTrail = new DashTrail(this.scene);
    this.mist = new ImpactMist(this.scene);
    this.heads = new HeadMark(this.scene);
    this.status = new StatusMarks(this.scene);

    // 初始阵容：A 离玩家稍远，C 封必经窄口，F 蹲电梯路上（点位由布局自动算）
    const start = this.level.playerStart;
    for (const s of this.level.enemySpawns) {
      const dx = s.x - start.x;
      const dz = s.z - start.z;
      if (dx * dx + dz * dz > 100) this.enemies.spawn(s.x, s.z, EType.A);
    }
    for (const s of this.level.heavyAnchors) this.enemies.spawn(s.x, s.z, EType.C);
    for (const s of this.level.interceptorSpawns) this.enemies.spawn(s.x, s.z, EType.F);

    // 导航箭头：沿电梯流场指路
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
      this.renderer.setSize(w, h);
    });

    this.renderer.setAnimationLoop((t) => this.tick(t));
    (window as any).__game = this;
    if (opts.menu) this.enterMenu();
    else this.beginPlay();
  }

  enterMenu() {
    this.phase = 'menu';
    this.acc = 0;
    this.menuWp = 0;
    this.menuStuck = 0;
    this.enemies.restoreAnchors();
    this.player.group.visible = false;
    this.player.menuGhost = true;
    this.player.aimArrow.visible = false;
    this.guideArrow.visible = false;
    const pts = this.chasePath();
    const s = pts[0] ?? this.level.playerStart;
    this.player.body.setTranslation({ x: s.x, y: this.player.pos.y, z: s.z }, true);
    this.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.menuFlow.rebuild(s.x, s.z);
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
    this.pickGlideTarget(true);
    this.pickGlideTarget(false);
  }

  beginPlay() {
    this.phase = 'playing';
    this.elapsed = 0;
    this.enemies.restoreAnchors();
    this.player.menuGhost = false;
    this.player.group.visible = true;
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
    const s = this.level.playerStart;
    this.player.body.setTranslation({ x: s.x, y: this.player.pos.y, z: s.z }, true);
    this.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.snapGameplayCamera();
  }

  private tick(timeMs: number) {
    const dt = Math.min((timeMs - this.lastTime) / 1000, 0.05);
    this.lastTime = timeMs;

    if (this.phase === 'playing' || this.phase === 'menu') {
      this.acc += dt;
      let sub = 0;
      while (this.acc >= FIXED_DT && sub < 4) {
        this.fixedUpdate(FIXED_DT);
        this.acc -= FIXED_DT;
        sub++;
      }
      if (sub === 4) this.acc = 0;
    }

    const time = timeMs / 1000;
    this.enemies.syncVisuals(time);
    this.chairs.syncVisuals();
    this.player.syncVisual(this.aiming);
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
    this.dashTrail.update(dt);
    this.papers.update(dt);
    this.mist.update(dt);
    this.heads.update(dt);
    this.pulses.update(dt);
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
    }
    this.status.update(dt);
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
    this.elapsed += h;
    this.input.pollKeyboard();
    const p = this.player.pos;

    const mvX = this.input.moveX;
    const mvZ = this.input.moveY;

    // 瞄准：右摇杆优先，其次鼠标按住
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

    if (this.input.consumeDash()) this.player.requestDash(mvX, mvZ);
    if (this.input.consumeSkill()) this.castSkill();
    this.player.update(h, mvX, mvZ, this.aiming, this.enemies);
    this.cards.update(h);

    this.heavyToastCd = Math.max(0, this.heavyToastCd - h);
    if (this.player.bouncedByHeavy && this.heavyToastCd <= 0) {
      this.heavyToastCd = 2;
      this.hud.toast('主管纹丝不动！');
    }

    // 射击
    this.player.fireCd -= h;
    if (this.aiming && this.player.fireCd <= 0) {
      this.player.fireCd = FIRE_INTERVAL;
      this.bullets.spawn(
        p.x + this.player.aimDirX * 0.55,
        p.z + this.player.aimDirZ * 0.55,
        this.player.aimDirX,
        this.player.aimDirZ
      );
    }

    // 分身存活时全场仇恨转向替身；虚化/引流期间无法被塞任务
    const dp = this.skills.decoyPos;
    const tx = dp ? dp.x : p.x;
    const tz = dp ? dp.z : p.z;
    this.enemies.update(h, tx, tz, {
      suppressChannel: !!dp || this.player.phasedT > 0,
      bruteChain: this.cards.line === 'brute',
    });
    this.skills.update(h, p.x, p.z, this.enemies);
    this.slicks.update(h, this.enemies);
    this.chairs.checkHits(this.enemies);
    this.bullets.update(h, this.enemies);

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

  private castSkill() {
    if (!this.cards.skill) return;
    const p = this.player.pos;
    const dx = this.aiming ? this.player.aimDirX : Math.sin(this.player.yaw);
    const dz = this.aiming ? this.player.aimDirZ : Math.cos(this.player.yaw);
    if (this.skills.cast(this.cards.skill, this.cards.skillLv, p.x, p.z, dx, dz)) {
      if (this.cards.skill === 'decoy') {
        // 放替身的同时玩家虚化 2 秒，方便脱身
        this.player.phasedT = Math.max(this.player.phasedT, 2);
        this.hud.toast('替身上岗！');
      } else if (this.cards.skill === 'coffee') {
        this.hud.toast('泼了一地！');
      }
    }
  }

  private inElevatorZone(x: number, z: number) {
    const zone = this.level.elevatorZone;
    return x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ;
  }

  private updateElevator(h: number, px: number, pz: number) {
    const inside = this.inElevatorZone(px, pz);
    if (!this.elevatorCalled) {
      if (inside) {
        this.elevatorCalled = true;
        this.elevatorLeft = false;
        this.elevatorTimer = ELEVATOR_WAIT;
        this.level.elevator.setState('called');
        this.hud.toast('电梯已呼叫！墙钮亮了，先离开再靠近一次');
      }
      return;
    }
    if (!inside) this.elevatorLeft = true;

    if (!this.elevatorReady) {
      this.elevatorTimer -= h;
      const floor = 1 + Math.max(0, Math.round(17 * (this.elevatorTimer / ELEVATOR_WAIT)));
      this.level.elevator.setFloor(floor);
      this.hud.setElevatorTimer(`电梯到达还需 ${Math.ceil(this.elevatorTimer)} 秒`);
      if (this.elevatorTimer <= 0) {
        this.elevatorReady = true;
        this.level.elevator.setState('ready');
        this.level.elevator.setFloor(1);
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
      this.hud.toast('电梯门开了！');
      this.hud.setElevatorTimer(null);
      return;
    }
    if (inside) this.hud.setElevatorTimer('先离开门口，再靠近一次开门');
  }

  private updateSpawning(h: number, px: number, pz: number) {
    // 电梯呼叫后加压：刷新更快，且偏向大厅方向
    const interval = this.elevatorCalled ? 0.45 : 1.1;
    this.spawnTimer += h;
    if (this.spawnTimer >= interval && this.enemies.activeCount < ENEMY_CAP) {
      this.spawnTimer = 0;
      const spawns = this.level.enemySpawns;
      for (let tries = 0; tries < 8; tries++) {
        const s = spawns[(Math.random() * spawns.length) | 0];
        if (this.elevatorCalled && s.z > -6) continue;
        const dx = s.x - px;
        const dz = s.z - pz;
        if (dx * dx + dz * dz > 81) {
          this.enemies.spawn(s.x + (Math.random() - 0.5), s.z + (Math.random() - 0.5), EType.A);
          break;
        }
      }
    }
  }

  private win() {
    if (this.phase !== 'playing') return;
    this.phase = 'won';
    this.hud.setElevatorTimer(null);
    const mm = Math.floor(this.elapsed / 60);
    const ss = Math.floor(this.elapsed % 60);
    const sub = `逃亡用时 ${mm}:${String(ss).padStart(2, '0')}<br>最终下班时间 ${this.hud.deadlineText}`;
    this.onSettled?.('won', { day: this.dayId, title: '成功下班！', sub });
  }

  private lose() {
    if (this.phase !== 'playing') return;
    this.phase = 'lost';
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
    if (this.phase === 'menu' || (dx === 0 && dz === 0) || this.elevatorCalled) {
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
