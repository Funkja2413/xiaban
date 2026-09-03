import * as THREE from 'three/webgpu';
import RAPIER from '@dimforge/rapier3d-compat';
import { dashFx, dashImpulseOf, dashReactOf, type DashKey, type DashLevelFx, type DashReact } from '../fx/catalog';
import { Enemies, EState } from './enemies';
import { PLAYER_GROUPS, PLAYER_PHASED_GROUPS } from '../sim/physics';
import { clonePlayerFigure, type HumanoidFigure, type HumanoidKit } from './humanoid';
import type { Cards } from './cards';

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
  /** 撞上重量级同事后的硬直 */
  stunT = 0;
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

  constructor(scene: THREE.Scene, private world: RAPIER.World, x: number, z: number, kit: HumanoidKit) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.66, z).lockRotations().setLinearDamping(4)
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(0.34, 0.32).setMass(70).setFriction(0.2).setCollisionGroups(PLAYER_GROUPS),
      this.body
    );

    const fig = clonePlayerFigure(kit);
    this.fig = fig;
    this.group = fig.group;
    this.ghostMats = fig.ghostMats;
    this.mixer = fig.mixer;
    this.idleAct = fig.idle;
    this.runAct = fig.run;

    // 瞄准指示箭头
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

  get dashing() {
    return this.dashT > 0;
  }

  get pos() {
    return this.body.translation();
  }

  requestDash(moveX: number, moveZ: number): boolean {
    if (this.dashCd > 0 || this.dashT > 0 || this.stunT > 0) return false;
    const len = Math.hypot(moveX, moveZ);
    if (len > 0.15) {
      this.dashDirX = moveX / len;
      this.dashDirZ = moveZ / len;
    } else {
      this.dashDirX = Math.sin(this.yaw);
      this.dashDirZ = Math.cos(this.yaw);
    }
    // 蛮力 LV2：冲刺时间更长（范围更宽 + 距离更远）
    const pack = dashFx((this.cards?.line ?? 'none') as DashKey, this.cards?.lineLv || 1);
    this.dashT = pack.hit.time;
    this.dashCd = pack.hit.cooldown;
    this.passed.clear();
    this.dashed.clear();
    return true;
  }

  update(dt: number, moveX: number, moveZ: number, aiming: boolean, enemies: Enemies) {
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.bouncedByHeavy = false;
    const line = this.cards?.line ?? null;
    const lv = this.cards?.lineLv ?? 0;
    const wasDashing = this.dashT > 0;
    const cur = this.body.linvel();

    if (this.stunT > 0) {
      // 硬直：不响应移动输入，靠阻尼自然减速
      this.stunT -= dt;
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
      this.body.setLinvel({ x: moveX * SPEED, y: cur.y, z: moveZ * SPEED }, true);
    }

    // 冲刺自然结束时的收尾效果（被重量级弹开时 stunT > 0，不触发）
    if (wasDashing && this.dashT <= 0 && this.stunT <= 0) {
      const pack = dashFx((line ?? 'none') as DashKey, lv || 1);
      if (pack.phantom && pack.phantom.phaseTime > 0) {
        this.phasedT = Math.max(this.phasedT, pack.phantom.phaseTime);
      }
    }

    // 相位切换：碰撞组 + 半透明
    this.phasedT = Math.max(0, this.phasedT - dt);
    const phased =
      this.menuGhost ||
      this.phasedT > 0 ||
      (this.dashT > 0 && !!dashFx((line ?? 'none') as DashKey, lv || 1).phantom);
    if (phased !== this.phasedNow) {
      this.phasedNow = phased;
      this.collider.setCollisionGroups(phased ? PLAYER_PHASED_GROUPS : PLAYER_GROUPS);
      for (const m of this.ghostMats) m.opacity = phased ? 0.42 : 1;
    }

    // 朝向：瞄准时朝瞄准方向，否则朝移动方向
    if (aiming) {
      this.yaw = Math.atan2(this.aimDirX, this.aimDirZ);
    } else if (Math.hypot(moveX, moveZ) > 0.15) {
      const target = Math.atan2(moveX, moveZ);
      let d = target - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * 0.35;
    }

    const moving = this.dashT > 0 || (this.stunT <= 0 && Math.hypot(moveX, moveZ) > 0.18);
    if (this.runAct && this.idleAct) {
      const target = moving ? 1 : 0;
      this.runAct.weight += (target - this.runAct.weight) * Math.min(1, dt * 8);
      this.idleAct.weight = 1 - this.runAct.weight;
      this.runAct.timeScale = moving ? 1.15 : 1;
    }
    this.mixer?.update(dt);
    this.fig.playerHalo?.update(dt, this.dashing);
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
          return 'bounce';
        }
        return 'skip';
      }
      case 'knock':
        enemies.hit(i, this.dashDirX, this.dashDirZ, impulse, { force: true, heavyOk: true, cannon: true });
        return 'hit';
      case 'stun':
        enemies.stun(i, react.stun || 0.9);
        return 'hit';
      case 'slow':
        if (impulse > 0) enemies.shove(i, this.dashDirX, this.dashDirZ, impulse);
        if (first) this.pulseSlow(enemies, enemies.posX[i], enemies.posZ[i], pack, react);
        return 'hit';
      case 'shove':
        enemies.shove(i, this.dashDirX, this.dashDirZ, impulse);
        if (react.stun > 0) enemies.stun(i, react.stun);
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
    const t = this.body.translation();
    this.group.position.set(t.x, t.y - 0.66, t.z);
    this.group.rotation.y = this.yaw;

    this.aimArrow.visible = aiming;
    if (aiming) {
      this.aimArrow.position.set(t.x, 0.12, t.z);
      this.aimArrow.rotation.y = Math.atan2(this.aimDirX, this.aimDirZ);
    }
  }
}
