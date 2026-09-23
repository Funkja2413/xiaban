import * as THREE from 'three/webgpu';
import RAPIER from '@dimforge/rapier3d-compat';
import { Enemies, EState } from './enemies';
import type { ChairStyle, FurnitureTone } from '../levels';
import { addOfficeChair } from './look';
import { commonFx } from '../fx/catalog';
import { sfx } from '../audio';

export interface LoosePropBody {
  group: THREE.Group;
  hx: number;
  hz: number;
  hy: number;
  mass: number;
  yaw: number;
}

type SlamChair = {
  group: THREE.Group;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
};

/** 动态可冲倒物：椅子 + 绿植/垃圾桶/咖啡机/打印机。高速撞飞同事。 */
export class Chairs {
  private items: { body: RAPIER.RigidBody; group: THREE.Group; mass: number; hitR: number }[] = [];
  private readonly scene: THREE.Scene;
  /** 拍桌时在施法者周围炸开的椅子，和特效编辑器同一套弹道。 */
  private bursts: SlamChair[] = [];

  constructor(
    scene: THREE.Scene,
    world: RAPIER.World,
    spawns: { x: number; z: number; style?: ChairStyle; rotY?: number; tone?: FurnitureTone; color?: string }[],
    loose: LoosePropBody[] = []
  ) {
    this.scene = scene;
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
          enemies.hit(i, dirX, dirZ, force, {
            force: ragdoll,
            heavyOk,
            hitFx: ragdoll ? { burst: commonFx().hitObject.burst } : undefined,
          });
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
    this.spawnSlamChairs(x, z, radius, impulse, lift);
  }

  /** 编辑器里拍桌会在施法者脚边摆四把椅子再弹飞。关卡椅子常常不在半径里，这里用同一套落点和速度。 */
  private spawnSlamChairs(x: number, z: number, radius: number, impulse: number, lift: number) {
    const r = Math.min(1.15, Math.max(0.7, radius * 0.48));
    const spots = [
      { x: x - r, z: z + 0.12 },
      { x: x + r, z: z - 0.18 },
      { x: x + 0.28, z: z + r * 0.72 },
      { x: x - 0.22, z: z - r * 0.7 },
    ];
    const k = (impulse / 420) * 4.4;
    const hop = (lift / 32) * 3.8;
    for (const s of spots) {
      const dx = s.x - x;
      const dz = s.z - z;
      const len = Math.hypot(dx, dz) || 0.2;
      const group = addOfficeChair(this.scene, Math.random() * Math.PI * 2, 'task', 'dark');
      group.position.set(s.x, SLAM_CHAIR_Y, s.z);
      this.bursts.push({
        group,
        x: s.x,
        y: 0,
        z: s.z,
        vx: (dx / len) * k,
        vy: hop,
        vz: (dz / len) * k,
        life: 2.4,
      });
    }
  }

  dispose(world: RAPIER.World) {
    for (const { body, group } of this.items) {
      world.removeRigidBody(body);
      group.removeFromParent();
    }
    this.items.length = 0;
    for (const burst of this.bursts) dropChairMesh(burst.group);
    this.bursts.length = 0;
  }

  syncVisuals(dt = 1 / 60) {
    for (const { body, group } of this.items) {
      const t = body.translation();
      const r = body.rotation();
      group.position.set(t.x, t.y, t.z);
      group.quaternion.set(r.x, r.y, r.z, r.w);
      const v = body.linvel();
      if (Math.hypot(v.x, v.z) > 2.2) sfx.play('chair_roll');
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const p = this.bursts[i]!;
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
        if (Math.abs(p.vy) < 0.35) p.vy = 0;
      }
      p.life -= dt;
      p.group.position.set(p.x, p.y + SLAM_CHAIR_Y, p.z);
      p.group.rotation.x += p.vz * dt * 0.7;
      p.group.rotation.z -= p.vx * dt * 0.7;
      if (p.life <= 0) {
        dropChairMesh(p.group);
        this.bursts.splice(i, 1);
      }
    }
  }
}

const SLAM_CHAIR_Y = 0.5;

function dropChairMesh(group: THREE.Object3D) {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose();
  });
  group.removeFromParent();
}
