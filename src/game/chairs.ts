import * as THREE from 'three/webgpu';
import RAPIER from '@dimforge/rapier3d-compat';
import { Enemies, EState } from './enemies';
import type { ChairStyle, FurnitureTone } from '../levels';
import { addOfficeChair } from './look';
import { sfx } from '../audio';

export interface LoosePropBody {
  group: THREE.Group;
  hx: number;
  hz: number;
  hy: number;
  mass: number;
  yaw: number;
}

/** 动态可冲倒物：椅子 + 绿植/垃圾桶/咖啡机/打印机。高速撞飞同事。 */
export class Chairs {
  private items: { body: RAPIER.RigidBody; group: THREE.Group; mass: number; hitR: number }[] = [];

  constructor(
    scene: THREE.Scene,
    world: RAPIER.World,
    spawns: { x: number; z: number; style?: ChairStyle; rotY?: number; tone?: FurnitureTone; color?: string }[],
    loose: LoosePropBody[] = []
  ) {
    for (const s of spawns) {
      const yaw = s.rotY ?? 0;
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(s.x, 0.5, s.z)
          .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
          .setLinearDamping(1.0)
          .setAngularDamping(1.5)
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.28, 0.45, 0.28).setMass(14).setFriction(0.4).setRestitution(0.2),
        body
      );
      const group = addOfficeChair(scene, yaw, s.style ?? 'task', s.tone ?? 'dark', s.color);
      this.items.push({ body, group, mass: 14, hitR: 0.85 });
    }

    for (const p of loose) {
      const t = p.group.position;
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(t.x, p.hy, t.z)
          .setRotation({ x: 0, y: Math.sin(p.yaw / 2), z: 0, w: Math.cos(p.yaw / 2) })
          .setLinearDamping(1.15)
          .setAngularDamping(1.35)
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(p.hx, p.hy, p.hz)
          .setMass(p.mass)
          .setFriction(0.45)
          .setRestitution(0.15),
        body
      );
      this.items.push({ body, group: p.group, mass: p.mass, hitR: Math.max(0.55, Math.hypot(p.hx, p.hz) + 0.35) });
    }
  }

  /** 高速椅子/小物件撞飞附近同事。中速只推，避免布娃娃砸家具后再放倒半个办公室 */
  checkHits(enemies: Enemies) {
    for (const { body, mass, hitR } of this.items) {
      const v = body.linvel();
      const speed = Math.hypot(v.x, v.z);
      const minSpeed = mass < 10 ? 3.4 : 4.2;
      if (speed < minSpeed) continue;
      const t = body.translation();
      const dirX = v.x / speed;
      const dirZ = v.z / speed;
      const ragdoll = speed > 7.5;
      const force = ragdoll
        ? Math.min(speed * 55 * (mass / 14), 420)
        : Math.min(speed * 28 * (mass / 14), 240);
      const heavyOk = ragdoll && mass >= 10;
      for (let i = 0; i < enemies.cap; i++) {
        const s = enemies.state[i];
        if (s !== EState.Chase && s !== EState.Knock && s !== EState.Getup) continue;
        const dx = enemies.posX[i] - t.x;
        const dz = enemies.posZ[i] - t.z;
        if (dx * dx + dz * dz < hitR * hitR) {
          enemies.hit(i, dirX, dirZ, force, { force: ragdoll, heavyOk });
        }
      }
    }
  }

  overlaps(x: number, z: number, r: number) {
    const out: { i: number; x: number; z: number }[] = [];
    for (let i = 0; i < this.items.length; i++) {
      const t = this.items[i]!.body.translation();
      const dx = t.x - x;
      const dz = t.z - z;
      if (dx * dx + dz * dz < r * r) out.push({ i, x: t.x, z: t.z });
    }
    return out;
  }

  /** 拍桌：圈里的椅子/绿植/垃圾桶等向外弹开 */
  blast(x: number, z: number, radius: number, impulse: number, lift: number) {
    const rr = Math.max(0.4, radius);
    const rr2 = rr * rr;
    for (const { body } of this.items) {
      const t = body.translation();
      const dx = t.x - x;
      const dz = t.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > rr2 || d2 < 1e-5) continue;
      const d = Math.sqrt(d2);
      const fall = 1 - d / rr;
      const nx = dx / d;
      const nz = dz / d;
      const p = impulse * (0.45 + fall * 0.55);
      body.wakeUp();
      body.applyImpulse({ x: nx * p, y: lift * fall, z: nz * p }, true);
      body.applyTorqueImpulse({ x: (Math.random() - 0.5) * p * 0.03, y: (Math.random() - 0.5) * p * 0.04, z: (Math.random() - 0.5) * p * 0.03 }, true);
    }
  }

  syncVisuals() {
    for (const { body, group } of this.items) {
      const t = body.translation();
      const r = body.rotation();
      group.position.set(t.x, t.y, t.z);
      group.quaternion.set(r.x, r.y, r.z, r.w);
      const v = body.linvel();
      if (Math.hypot(v.x, v.z) > 2.2) sfx.play('chair_roll');
    }
  }
}
