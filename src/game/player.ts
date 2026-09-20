import * as THREE from 'three/webgpu';
import RAPIER from '@dimforge/rapier3d-compat';
import { dashFx, dashImpulseOf, dashReactOf, type DashKey, type DashLevelFx, type DashReact } from '../fx/catalog';
import { Enemies, EState } from './enemies';
import { PLAYER_GROUPS, PLAYER_PHASED_GROUPS } from '../sim/physics';
import { clonePlayerFigure, type HumanoidFigure, type HumanoidKit } from './humanoid';
import { BONE_NECK, findBoneAny } from './hair';
import { setFigureGlow } from './skillVfx';
import type { Cards } from './cards';
import { RagdollFactory, type RagdollHandle } from './ragdoll';
import { sfx } from '../audio';
import type { FlowField } from '../sim/flowfield';

const SPEED = 4.6;
/** 有输入却几乎走不动：判定被挤住，给短虚化脱身 */
const JAM_SPEED = 0.55;
const JAM_TIME = 0.28;
/** 覆盖起身硬直(~0.5s) + 之后一小段可走动脱身 */
const GETUP_PHASE = 1.05;

export class Player {
  body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  group: THREE.Group;

  /** 朝向（未瞄准时跟随移动方向） */
  yaw = Math.PI;
  aimDirX = 0;
  aimDirZ = -1;

  private dashT = 0;
  dashCd = 0;
  private dashDirX = 0;
  private dashDirZ = -1;
  /** 反弹冲：本段剩余可折次数 */
  private reboundLeft = 0;
  /** 补卡冲：二段窗口 / 已用段数 / 本段是否命中 */
  private reclockT = 0;
  private reclockSeg = 0;
  private reclockHitSeg = false;
  private reclockHitAll = false;
  /** 甩锅：本段是否已甩成功 */
  private blamedThisDash = false;
  /** 撞上重量级同事后的硬直 / 布娃娃落地后的起身 */
  stunT = 0;
  /** 湿地面 / 拍桌 */
  slowT = 0;
  slowMul = 1;
  /** 本帧是否刚被重量级弹开（供 HUD 提示） */
  bouncedByHeavy = false;

  /** 虚化剩余时间（幻影 LV3 / 分身相位）：穿人且不被塞任务 */
  phasedT = 0;
  /** 主页追逐演示：穿人，避免被同事挤死在墙边 */
  menuGhost = false;
  /** 构筑状态（由 Game 注入） */
  cards: Cards | null = null;
  /** 倦怠圈回调 */
  onSlowPulse: ((x: number, z: number, r: number, color: number, opacity: number, life: number) => void) | null = null;

  private phasedNow = false;
  private passed = new Set<number>();
  private dashed = new Set<number>();
  private ghostMats: THREE.MeshPhongMaterial[] = [];
  private mixer: THREE.AnimationMixer | null = null;
  private idleAct?: THREE.AnimationAction;
  private runAct?: THREE.AnimationAction;
  private fig: HumanoidFigure;
  private rag: RagdollHandle | null = null;
  private ragOrigin = { x: 0, z: 0 };
  private ragPos = { x: 0, y: 0.66, z: 0 };
  private standY = 0.66;
  private stepT = 0;
  private jamT = 0;
  /** 起身找空地（由 Game 注入主流场） */
  nav: FlowField | null = null;

  constructor(
    scene: THREE.Scene,
    private world: RAPIER.World,
    x: number,
    z: number,
    private kit: HumanoidKit,
    private ragFactory: RagdollFactory
  ) {
    this.standY = 0.66 * (kit.playerScale > 0 ? kit.playerScale : 1);
    this.body = this.makeBody(x, z);
    this.collider = this.makeCollider(this.body);

    const fig = clonePlayerFigure(kit, kit.playerSlot);
    this.fig = fig;
    this.group = fig.group;
    this.ghostMats = fig.ghostMats;
    this.mixer = fig.mixer;
    this.idleAct = fig.idle;
    this.runAct = fig.run;

    scene.add(this.group);
  }

  private makeBody(x: number, z: number) {
    return this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, this.standY, z).lockRotations().setLinearDamping(4)
    );
  }

  private makeCollider(body: RAPIER.RigidBody) {
    return this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.34 * (this.standY / 0.66), 0.32 * (this.standY / 0.66))
        .setMass(70)
        .setFriction(0.2)
        .setCollisionGroups(PLAYER_GROUPS),
      body
    );
  }

  resetRun() {
    if (this.rag) this.finishRagdoll(true);
    this.dashT = 0;
    this.dashCd = 0;
    this.reboundLeft = 0;
    this.reclockT = 0;
    this.reclockSeg = 0;
    this.reclockHitSeg = false;
    this.reclockHitAll = false;
    this.blamedThisDash = false;
    this.stunT = 0;
    this.slowT = 0;
    this.slowMul = 1;
    this.phasedT = 0;
    this.passed.clear();
    this.dashed.clear();
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setLinearDamping(4);
  }

  get dashing() {
    return this.dashT > 0 && !this.rag;
  }

  get ragdolled() {
    return !!this.rag;
  }

  get slowed() {
    return this.slowT > 0;
  }

  applySlow(duration: number, factor: number) {
    this.slowT = Math.max(this.slowT, duration);
    this.slowMul = Math.min(this.slowMul || 1, factor);
  }

  stun(duration: number) {
    this.stunT = Math.max(this.stunT, duration);
    this.dashT = 0;
    if (!this.rag) {
      const cur = this.body.linvel();
      this.body.setLinvel({ x: 0, y: cur.y, z: 0 }, true);
    }
  }

  /**
   * 弹簧门 / 隐藏地板：换成和同事同一套布娃娃飞出去。
   */
  slam(dirX: number, dirZ: number, impulse: number, lift: number, _duration: number) {
    const len = Math.hypot(dirX, dirZ) || 1;
    const nx = dirX / len;
    const nz = dirZ / len;
    this.dashT = 0;
    this.yaw = Math.atan2(-nx, -nz);
    const power = Math.min(Math.max(impulse * 0.9, 280), 640);

    if (this.rag) {
      this.rag.age = Math.min(this.rag.age, 0.35);
      this.rag.bodies[1].applyImpulse({ x: nx * power * 0.55, y: lift, z: nz * power * 0.55 }, true);
      this.rag.bodies[0].applyImpulse({ x: nx * power * 0.28, y: lift * 0.35, z: nz * power * 0.28 }, true);
      return;
    }

    const t = this.body.translation();
    this.ragOrigin.x = t.x;
    this.ragOrigin.z = t.z;
    this.world.removeRigidBody(this.body);
    this.group.visible = false;
    this.rag = this.ragFactory.spawn(t.x, t.z, 0x4f8fe8, nx, nz, power, this.kit.playerScale || 1, false, {
      kit: this.kit,
      slot: 0,
      yaw: this.yaw,
      player: true,
    });
    if (lift > 0) {
      this.rag.bodies[1].applyImpulse({ x: nx * impulse * 0.12, y: lift, z: nz * impulse * 0.12 }, true);
    }
  }

  launch(dirX: number, dirZ: number, impulse: number, lift = 48) {
    this.slam(dirX, dirZ, impulse, lift, 0.55);
  }

  get pos() {
    if (this.rag) {
      const p = this.ragFactory.pelvisPos(this.rag);
      this.ragPos.x = p.x;
      this.ragPos.z = p.z;
      return this.ragPos;
    }
    return this.body.translation();
  }

  neckWorld(out: THREE.Vector3) {
    this.group.updateWorldMatrix(true, true);
    const named = findBoneAny(this.group, ['Neck', 'mixamorigNeck', 'neck']);
    const bone = named ?? findBoneAny(this.group, BONE_NECK);
    if (bone) {
      bone.getWorldPosition(out);
      if (!named) out.y -= 0.14;
      return out;
    }
    const t = this.body.translation();
    return out.set(t.x, 1.32, t.z);
  }

  setLockGlow(on: boolean, color = 0xff5050, opacity = 0.55) {
    setFigureGlow(this.fig, on, color, opacity);
  }

  get vel() {
    if (this.rag) return this.rag.bodies[0].linvel();
    return this.body.linvel();
  }

  requestDash(moveX: number, moveZ: number): boolean {
    if (this.rag || this.dashT > 0 || this.stunT > 0) return false;
    const pack = dashFx((this.cards?.line ?? 'none') as DashKey, this.cards?.lineLv || 1);
    const follow = this.reclockT > 0 && !!pack.reclock && this.reclockSeg >= 1 && this.reclockSeg < 2;
    if (!follow && this.dashCd > 0) return false;

    const len = Math.hypot(moveX, moveZ);
    if (len > 0.15) {
      this.dashDirX = moveX / len;
      this.dashDirZ = moveZ / len;
    } else {
      this.dashDirX = Math.sin(this.yaw);
      this.dashDirZ = Math.cos(this.yaw);
    }

    const scale = follow ? pack.reclock!.segmentScale : 1;
    this.dashT = pack.hit.time * scale;
    if (!follow) {
      this.dashCd = pack.hit.cooldown;
      this.reclockSeg = 0;
      this.reclockHitAll = false;
      this.reboundLeft = pack.rebound?.maxBounces ?? 0;
    } else {
      this.reclockSeg = 2;
      this.reclockT = 0;
    }
    this.reclockHitSeg = false;
    this.blamedThisDash = false;
    this.passed.clear();
    this.dashed.clear();
    sfx.play('dash');
    return true;
  }

  update(dt: number, moveX: number, moveZ: number, aiming: boolean, enemies: Enemies) {
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.reclockT = Math.max(0, this.reclockT - dt);
    this.bouncedByHeavy = false;

    if (this.slowT > 0) {
      this.slowT -= dt;
      if (this.slowT <= 0) this.slowMul = 1;
    }

    this.phasedT = Math.max(0, this.phasedT - dt);

    if (this.rag) {
      this.tickRagdoll(dt);
      return;
    }

    const line = this.cards?.line ?? null;
    const lv = this.cards?.lineLv ?? 0;
    const wasDashing = this.dashT > 0;
    const cur = this.body.linvel();

    if (this.stunT > 0) {
      this.stunT = Math.max(0, this.stunT - dt);
      this.jamT = 0;
    } else if (this.dashT > 0) {
      const pack = dashFx((line ?? 'none') as DashKey, lv || 1);
      const hit = pack.hit;
      const phase = !!pack.phantom;
      this.dashT -= dt;
      if (pack.rebound && this.reboundLeft > 0) this.tryReboundWall(pack, enemies);
      this.body.setLinvel({ x: this.dashDirX * hit.speed, y: cur.y, z: this.dashDirZ * hit.speed }, true);
      const p = this.pos;

      for (let i = 0; i < enemies.cap; i++) {
        const s = enemies.state[i];
        if (s !== EState.Chase && s !== EState.Knock && s !== EState.Getup) continue;
        const dx = enemies.posX[i] - p.x;
        const dz = enemies.posZ[i] - p.z;
        const id = enemies.actorId(i);
        const rr = id === 'heavy' || id === 'interceptor' ? Math.max(hit.radius, 1.4) : hit.radius;
        if (dx * dx + dz * dz >= rr * rr) continue;
        const react = dashReactOf(pack, id);
        if (phase) {
          this.applyDashReact(enemies, i, pack, react, true);
          if (!this.passed.has(i)) {
            this.passed.add(i);
            const refund = pack.phantom?.cdRefund ?? 0;
            if (refund > 0) this.dashCd = Math.max(0.15, this.dashCd - refund);
          }
          continue;
        }
        const first = !this.dashed.has(i);
        if (!first) continue;
        if (hit.maxHits > 0 && this.dashed.size >= hit.maxHits) continue;
        const outcome = this.applyDashReact(enemies, i, pack, react, first);
        if (outcome === 'bounce') break;
        if (outcome === 'hit' && first) {
          this.dashed.add(i);
          this.reclockHitSeg = true;
          if (pack.blame && !this.blamedThisDash) {
            enemies.blame(i, pack.blame.duration, pack.blame.radius, pack.blame.count);
            this.blamedThisDash = true;
          }
        }
      }
      this.jamT = 0;
    } else {
      const speed = SPEED * (this.slowT > 0 ? this.slowMul : 1);
      this.body.setLinvel({ x: moveX * speed, y: cur.y, z: moveZ * speed }, true);
      const inputLen = Math.hypot(moveX, moveZ);
      const horiz = Math.hypot(cur.x, cur.z);
      if (!this.menuGhost && this.phasedT <= 0 && inputLen > 0.35 && horiz < JAM_SPEED) {
        this.jamT += dt;
        if (this.jamT >= JAM_TIME) {
          this.jamT = 0;
          this.phasedT = Math.max(this.phasedT, 0.45);
          this.body.applyImpulse({ x: moveX * 180, y: 40, z: moveZ * 180 }, true);
        }
      } else {
        this.jamT = 0;
      }
    }

    if (wasDashing && this.dashT <= 0 && this.stunT <= 0) {
      const pack = dashFx((line ?? 'none') as DashKey, lv || 1);
      if (pack.phantom && pack.phantom.phaseTime > 0) {
        this.phasedT = Math.max(this.phasedT, pack.phantom.phaseTime);
      }
      if (pack.blame && !this.blamedThisDash && pack.blame.groundRadius > 0) {
        const p = this.pos;
        enemies.blameNearest(p.x, p.z, pack.blame.duration, pack.blame.groundRadius, pack.blame.count);
        this.blamedThisDash = true;
      }
      if (pack.reclock) {
        if (this.reclockSeg === 0) {
          this.reclockSeg = 1;
          this.reclockT = pack.reclock.window;
          if (this.reclockHitSeg) this.reclockHitAll = true;
        } else if (this.reclockSeg === 2) {
          if (this.reclockHitSeg && pack.reclock.hitRefund > 0) {
            this.dashCd = Math.max(0.15, this.dashCd - pack.reclock.hitRefund);
          }
          if (pack.reclock.autoThird && this.reclockHitAll && this.reclockHitSeg) {
            this.dashT = pack.hit.time * 0.45;
            this.reclockSeg = 3;
          } else {
            this.reclockSeg = 0;
            this.reclockT = 0;
          }
        } else {
          this.reclockSeg = 0;
          this.reclockT = 0;
        }
      }
    }

    let wantPhase =
      this.menuGhost ||
      this.phasedT > 0 ||
      (this.dashT > 0 && !!dashFx((line ?? 'none') as DashKey, lv || 1).phantom);
    // 虚化结束时若还叠在同事身上，先别恢复碰撞，否则会永久卡死
    if (!wantPhase && this.phasedNow && this.overlapsEnemy(enemies)) {
      this.phasedT = Math.max(this.phasedT, 0.12);
      wantPhase = true;
    }
    if (wantPhase !== this.phasedNow) {
      this.phasedNow = wantPhase;
      this.collider.setCollisionGroups(wantPhase ? PLAYER_PHASED_GROUPS : PLAYER_GROUPS);
      for (const m of this.ghostMats) m.opacity = wantPhase ? 0.42 : 1;
    }

    if (this.stunT <= 0) {
      if (aiming) {
        this.yaw = Math.atan2(this.aimDirX, this.aimDirZ);
      } else if (Math.hypot(moveX, moveZ) > 0.15) {
        const target = Math.atan2(moveX, moveZ);
        let d = target - this.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.yaw += d * 0.35;
      }
    }

    const moving = this.dashT > 0 || (this.stunT <= 0 && Math.hypot(moveX, moveZ) > 0.18);
    if (!this.menuGhost && this.dashT <= 0 && this.stunT <= 0 && Math.hypot(moveX, moveZ) > 0.18) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = this.slowT > 0 ? 0.46 : 0.34;
        sfx.play('step');
      }
    } else {
      this.stepT = Math.min(this.stepT, 0.08);
    }
    if (this.runAct && this.idleAct) {
      const target = moving ? 1 : 0;
      this.runAct.weight += (target - this.runAct.weight) * Math.min(1, dt * 8);
      this.idleAct.weight = 1 - this.runAct.weight;
      this.runAct.timeScale = moving ? 1.15 : 1;
    }
    this.mixer?.update(dt);
    this.fig.playerHalo?.update(dt, this.dashing);
  }

  private tickRagdoll(dt: number) {
    const rag = this.rag!;
    rag.age += dt;
    this.ragFactory.driveStand(rag);
    const blown = !this.ragFactory.isSane(rag);
    if (blown || (rag.age > 1.5 && this.ragFactory.isSettled(rag)) || rag.age > 3.2) {
      this.finishRagdoll();
    }
  }

  private finishRagdoll(skipStun = false) {
    const rag = this.rag;
    if (!rag) return;
    const p = this.ragFactory.pelvisPos(rag);
    const sane = this.ragFactory.isSane(rag);
    this.ragFactory.despawn(rag);
    this.rag = null;
    const rawX = sane ? p.x : this.ragOrigin.x;
    const rawZ = sane ? p.z : this.ragOrigin.z;
    const [x, z] = this.findFreeSpot(rawX, rawZ);
    this.body = this.makeBody(x, z);
    this.collider = this.makeCollider(this.body);
    this.phasedNow = false;
    // 起身短虚化，避免胶囊嵌进墙/桌/人堆后永久卡死
    this.phasedT = Math.max(this.phasedT, GETUP_PHASE);
    this.collider.setCollisionGroups(PLAYER_PHASED_GROUPS);
    this.phasedNow = true;
    for (const m of this.ghostMats) m.opacity = 0.42;
    this.group.visible = !this.menuGhost;
    this.group.rotation.order = 'YXZ';
    this.group.rotation.set(0, this.yaw, 0);
    if (!skipStun) {
      this.stunT = Math.max(this.stunT, 0.5);
      sfx.play('getup');
    }
    if (this.runAct && this.idleAct) {
      this.runAct.weight = 0;
      this.idleAct.weight = 1;
    }
  }

  private findFreeSpot(x: number, z: number): [number, number] {
    const f = this.nav;
    if (!f) return [x, z];
    const minX = f.ox + 0.6;
    const maxX = f.ox + f.nx * f.cell - 0.6;
    const minZ = f.oz + 0.6;
    const maxZ = f.oz + f.nz * f.cell - 0.6;
    const cx = Math.max(minX, Math.min(maxX, x));
    const cz = Math.max(minZ, Math.min(maxZ, z));
    if (!f.isBlockedAt(cx, cz)) return [cx, cz];
    for (let r = 0.5; r <= 3.5; r += 0.5) {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const nx = Math.max(minX, Math.min(maxX, cx + Math.cos(ang) * r));
        const nz = Math.max(minZ, Math.min(maxZ, cz + Math.sin(ang) * r));
        if (!f.isBlockedAt(nx, nz)) return [nx, nz];
      }
    }
    // 最后退回起飞点（通常更安全）
    const ox = Math.max(minX, Math.min(maxX, this.ragOrigin.x));
    const oz = Math.max(minZ, Math.min(maxZ, this.ragOrigin.z));
    if (!f.isBlockedAt(ox, oz)) return [ox, oz];
    return [cx, cz];
  }

  private overlapsEnemy(enemies: Enemies) {
    const p = this.pos;
    for (let i = 0; i < enemies.cap; i++) {
      const s = enemies.state[i];
      if (s !== EState.Chase && s !== EState.Knock && s !== EState.Getup) continue;
      const dx = enemies.posX[i] - p.x;
      const dz = enemies.posZ[i] - p.z;
      const rr = enemies.actorId(i) === 'heavy' || enemies.actorId(i) === 'interceptor' ? 1.15 : 0.72;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  }

  private applyDashReact(
    enemies: Enemies,
    i: number,
    pack: DashLevelFx,
    react: DashReact,
    first: boolean
  ): 'hit' | 'bounce' | 'skip' {
    const impulse = dashImpulseOf(pack, react);
    switch (react.kind) {
      case 'none': {
        if (react.bounce && !pack.phantom) {
          // 反弹冲：碰主管折向续冲，而不是自己弹飞硬直
          if (pack.rebound && pack.rebound.heavyOk && this.reboundLeft > 0) {
            const dx = enemies.posX[i] - this.pos.x;
            const dz = enemies.posZ[i] - this.pos.z;
            this.reflectAwayFrom(dx, dz);
            this.reboundLeft--;
            this.pulseReboundShock(enemies, pack);
            sfx.play('dash_bounce');
            return 'hit';
          }
          const slow = this.slowReact(pack);
          if (slow) this.pulseSlow(enemies, this.pos.x, this.pos.z, pack, slow);
          this.dashT = 0;
          this.stunT = 0.45;
          this.bouncedByHeavy = true;
          this.body.applyImpulse({ x: -this.dashDirX * 420, y: 60, z: -this.dashDirZ * 420 }, true);
          sfx.play('dash_bounce');
          return 'bounce';
        }
        return 'skip';
      }
      case 'knock':
        enemies.hit(i, this.dashDirX, this.dashDirZ, impulse, { force: true, heavyOk: true, cannon: true });
        if (first) sfx.play('dash_hit');
        return 'hit';
      case 'stun':
        enemies.stun(i, react.stun || 0.9);
        if (first) sfx.play('dash_hit');
        return 'hit';
      case 'slow':
        if (impulse > 0) enemies.shove(i, this.dashDirX, this.dashDirZ, impulse);
        if (first) this.pulseSlow(enemies, enemies.posX[i], enemies.posZ[i], pack, react);
        if (first) sfx.play('dash_hit');
        return 'hit';
      case 'shove':
        enemies.shove(i, this.dashDirX, this.dashDirZ, impulse);
        if (react.stun > 0) enemies.stun(i, react.stun);
        if (first) sfx.play('dash_hit');
        return 'hit';
    }
  }

  private tryReboundWall(pack: DashLevelFx, enemies: Enemies) {
    const rb = pack.rebound;
    if (!rb || this.reboundLeft <= 0 || !this.nav) return;
    const p = this.pos;
    const probe = rb.probe;
    const fx = p.x + this.dashDirX * probe;
    const fz = p.z + this.dashDirZ * probe;
    if (!this.nav.isBlockedAt(fx, fz)) return;
    const blockX = this.nav.isBlockedAt(p.x + this.dashDirX * probe, p.z);
    const blockZ = this.nav.isBlockedAt(p.x, p.z + this.dashDirZ * probe);
    if (blockX) this.dashDirX *= -1;
    if (blockZ) this.dashDirZ *= -1;
    if (!blockX && !blockZ) {
      this.dashDirX *= -1;
      this.dashDirZ *= -1;
    }
    const len = Math.hypot(this.dashDirX, this.dashDirZ) || 1;
    this.dashDirX /= len;
    this.dashDirZ /= len;
    this.reboundLeft--;
    this.yaw = Math.atan2(this.dashDirX, this.dashDirZ);
    this.pulseReboundShock(enemies, pack);
    sfx.play('dash_bounce');
  }

  private reflectAwayFrom(dx: number, dz: number) {
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len;
    const nz = dz / len;
    const dot = this.dashDirX * nx + this.dashDirZ * nz;
    this.dashDirX -= 2 * dot * nx;
    this.dashDirZ -= 2 * dot * nz;
    const n = Math.hypot(this.dashDirX, this.dashDirZ) || 1;
    this.dashDirX /= n;
    this.dashDirZ /= n;
    this.yaw = Math.atan2(this.dashDirX, this.dashDirZ);
  }

  private pulseReboundShock(enemies: Enemies, pack: DashLevelFx) {
    const rb = pack.rebound;
    if (!rb || rb.shockRadius <= 0) return;
    const p = this.pos;
    for (let i = 0; i < enemies.cap; i++) {
      if (enemies.state[i] !== EState.Chase) continue;
      if (enemies.actorId(i) === 'heavy') continue;
      const dx = enemies.posX[i] - p.x;
      const dz = enemies.posZ[i] - p.z;
      if (dx * dx + dz * dz > rb.shockRadius * rb.shockRadius) continue;
      enemies.shove(i, this.dashDirX, this.dashDirZ, rb.shockImpulse);
    }
  }

  private slowReact(pack: DashLevelFx): DashReact | null {
    if (!pack.react) return null;
    for (const id of Object.keys(pack.react) as (keyof typeof pack.react)[]) {
      const r = dashReactOf(pack, id);
      if (r.kind === 'slow') return r;
    }
    return null;
  }

  private pulseSlow(enemies: Enemies, x: number, z: number, pack: DashLevelFx, react: DashReact) {
    const look = pack.slump;
    enemies.slowAround(x, z, react.radius, react.duration, react.factor, (j) => dashReactOf(pack, enemies.actorId(j)).kind !== 'none');
    this.onSlowPulse?.(x, z, react.radius, look?.color ?? 0x7a90a8, look?.opacity ?? 0.45, look?.pulseLife ?? 0.45);
  }

  syncVisual() {
    if (this.rag) {
      this.ragFactory.sync(this.rag);
      this.group.visible = false;
      return;
    }

    const t = this.body.translation();
    this.group.position.set(t.x, t.y - this.standY, t.z);
    this.group.rotation.order = 'YXZ';
    this.group.rotation.set(0, this.yaw, 0);
  }
}
