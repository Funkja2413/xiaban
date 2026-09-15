import * as THREE from 'three/webgpu';
import { Enemies } from './enemies';
import type { MapBounds } from '../levels';
import { sfx } from '../audio';

const POOL = 48;
const SPEED = 17;
const LIFE = 1.2;
const HIT_IMPULSE = 175;

interface Blocker { minX: number; minZ: number; maxX: number; maxZ: number }

/** 订书机钉子：手动运动学弹体，2D 线段检测命中，无物理刚体开销 */
export class Bullets {
  private meshes: THREE.Mesh[] = [];
  private active = new Uint8Array(POOL);
  private px = new Float32Array(POOL);
  private pz = new Float32Array(POOL);
  private dx = new Float32Array(POOL);
  private dz = new Float32Array(POOL);
  private life = new Float32Array(POOL);
  private cursor = 0;

  constructor(scene: THREE.Scene, private blockers: Blocker[], private bounds: MapBounds) {
    const geo = new THREE.BoxGeometry(0.07, 0.07, 0.3);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd76a });
    for (let i = 0; i < POOL; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      scene.add(m);
      this.meshes.push(m);
    }
  }

  spawn(x: number, z: number, dirX: number, dirZ: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % POOL;
    this.active[i] = 1;
    this.px[i] = x;
    this.pz[i] = z;
    this.dx[i] = dirX;
    this.dz[i] = dirZ;
    this.life[i] = LIFE;
    const m = this.meshes[i];
    m.visible = true;
    m.position.set(x, 0.95, z);
    m.rotation.y = Math.atan2(dirX, dirZ);
  }

  private blockedAt(x: number, z: number): boolean {
    if (x < this.bounds.minX || x > this.bounds.maxX || z < this.bounds.minZ || z > this.bounds.maxZ) return true;
    for (const b of this.blockers) {
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return true;
    }
    return false;
  }

  update(dt: number, enemies: Enemies) {
    for (let i = 0; i < POOL; i++) {
      if (!this.active[i]) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        continue;
      }
      const x0 = this.px[i];
      const z0 = this.pz[i];
      const x1 = x0 + this.dx[i] * SPEED * dt;
      const z1 = z0 + this.dz[i] * SPEED * dt;

      const hit = enemies.raycastSegment(x0, z0, x1, z1);
      if (hit >= 0) {
        enemies.hit(hit, this.dx[i], this.dz[i], HIT_IMPULSE);
        this.kill(i);
        continue;
      }
      if (this.blockedAt(x1, z1)) {
        sfx.play('staple_wall');
        this.kill(i);
        continue;
      }
      this.px[i] = x1;
      this.pz[i] = z1;
      this.meshes[i].position.set(x1, 0.95, z1);
    }
  }

  private kill(i: number) {
    this.active[i] = 0;
    this.meshes[i].visible = false;
  }
}
