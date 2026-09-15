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

const SPEED = 4.6;

export class Player {
  body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  group: THREE.Group;
  aimArrow: THREE.Group;

  /** 朝向（未瞄准时跟随移动方向） */
  yaw = Math.PI;
  aimDirX = 0;
  aimDirZ = -1;

  private dashT = 0;
  dashCd = 0;
  private dashDirX = 0;
  private dashDirZ = -1;
  fireCd = 0;
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

    this.aimArrow = new THREE.Group();
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.13, 0.42, 8),
      new THREE.MeshBasicMaterial({ color: 0xffa05a, transparent: true, opacity: 0.85 })
    );
    cone.rotation.x = Math.PI / 2;
    cone.position.z = 0.9;
    this.aimArrow.add(cone);
    this.aimArrow.position.y = 0.12;
    this.aimArrow.visible = false;

    scene.add(this.group);
    scene.add(this.aimArrow);
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
    this.stunT = 0;
    this.slowT = 0;
    this.slowMul = 1;
    this.phasedT = 0;
    this.fireCd = 0;
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
    this.aimArrow.visible = false;
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
    if (this.rag || this.dashCd > 0 || this.dashT > 0 || this.stunT > 0) return false;
    const len = Math.hypot(moveX, moveZ);
    if (len > 0.15) {
      this.dashDirX = moveX / len;
      this.dashDirZ = moveZ / len;
    } else {
      this.dashDirX = Math.sin(this.yaw);
      this.dashDirZ = Math.cos(this.yaw);
    }
    const pack = dashFx((this.cards?.line ?? 'none') as DashKey, this.cards?.lineLv || 1);
    this.dashT = pack.hit.time;
    this.dashCd = pack.hit.cooldown;
    this.passed.clear();
    this.dashed.clear();
    sfx.play('dash');
    return true;
  }

  update(dt: number, moveX: number, moveZ: number, aiming: boolean, enemies: Enemies) {
    this.dashCd = Math.max(0, this.dashCd - dt);
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
    } else if (this.dashT > 0) {
      const pack = dashFx((line ?? 'none') as DashKey, lv || 1);
      const hit = pack.hit;
      const phase = !!pack.phantom;
      this.dashT -= dt;
      this.body.setLinvel({ x: this.dashDirX * hit.speed, y: cur.y, z: this.dashDirZ * hit.speed }, true);
      const p = this.pos;

      for (let i = 0; i < enemies.cap; i++) {
        const s = enemies.state[i];
        if (s !== EState.Chase && s !== EState.Knock && s !== EState.Getup) continue;
        const dx = enemies.posX[i] - p.x;
        const dz = enemies.posZ[i] - p.z;
        const id = enemies.actorId(i);
        const rr = id === 'heavy' ? Math.max(hit.radius, 1.4) : hit.radius;
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
        if (outcome === 'hit' && first) this.dashed.add(i);
      }
    } else {
      const speed = SPEED * (this.slowT > 0 ? this.slowMul : 1);
      this.body.setLinvel({ x: moveX * speed, y: cur.y, z: moveZ * speed }, true);
    }

    if (wasDashing && this.dashT <= 0 && this.stunT <= 0) {
      const pack = dashFx((line ?? 'none') as DashKey, lv || 1);
      if (pack.phantom && pack.phantom.phaseTime > 0) {
        this.phasedT = Math.max(this.phasedT, pack.phantom.phaseTime);
      }
    }

    const phased =
      this.menuGhost ||
      this.phasedT > 0 ||
      (this.dashT > 0 && !!dashFx((line ?? 'none') as DashKey, lv || 1).phantom);
    if (phased !== this.phasedNow) {
      this.phasedNow = phased;
      this.collider.setCollisionGroups(phased ? PLAYER_PHASED_GROUPS : PLAYER_GROUPS);
      for (const m of this.ghostMats) m.opacity = phased ? 0.42 : 1;
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
    const x = sane ? p.x : this.ragOrigin.x;
    const z = sane ? p.z : this.ragOrigin.z;
    this.body = this.makeBody(x, z);
    this.collider = this.makeCollider(this.body);
    this.phasedNow = false;
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

  syncVisual(aiming: boolean) {
    if (this.rag) {
      this.ragFactory.sync(this.rag);
      this.group.visible = false;
      this.aimArrow.visible = false;
      return;
    }

    const t = this.body.translation();
    this.group.position.set(t.x, t.y - this.standY, t.z);
    this.group.rotation.order = 'YXZ';
    this.group.rotation.set(0, this.yaw, 0);

    this.aimArrow.visible = aiming && this.stunT <= 0;
    if (aiming) {
      this.aimArrow.position.set(t.x, 0.12, t.z);
      this.aimArrow.rotation.y = Math.atan2(this.aimDirX, this.aimDirZ);
    }
  }
}
