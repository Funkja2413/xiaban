import * as THREE from 'three/webgpu';
import { skillFx } from '../fx/catalog';
import { coffeeTintOnDay } from '../fx/days';
import type { WeekdayId } from '../levels';
import { Enemies, EState } from './enemies';
import type { SkillId } from './cards';
import { makeThrowProjectile, throwLookOf, throwSkinOnDay, type ThrowSkin } from './skillProjectiles';
import { sfx } from '../audio';

interface Decoy {
  group: THREE.Group;
  x: number;
  z: number;
  t: number;
  lv: number;
}

interface Keyboard {
  mesh: THREE.Object3D;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  /** 0 = 去程，1 = 返程 */
  phase: 0 | 1;
  traveled: number;
  hit: Set<number>;
  lv: number;
  skin: ThrowSkin;
}

/** 主动技能：分身、投掷物（按关换皮）、泼咖啡 */
export class Skills {
  cd = 0;
  private day: WeekdayId = 'monday';
  private decoy: Decoy | null = null;
  private kb: Keyboard | null = null;

  constructor(
    private scene: THREE.Scene,
    private pourCoffee: (x: number, z: number, r: number, life: number, look: { color: number; opacity: number }) => void
  ) {}

  setDay(day: WeekdayId) {
    this.day = day;
  }

  /** 分身存活时全场仇恨目标改为它 */
  get decoyPos(): { x: number; z: number } | null {
    return this.decoy ? { x: this.decoy.x, z: this.decoy.z } : null;
  }

  reset() {
    this.cd = 0;
    if (this.decoy) {
      this.scene.remove(this.decoy.group);
      this.decoy = null;
    }
    if (this.kb) {
      this.scene.remove(this.kb.mesh);
      this.kb = null;
    }
    sfx.setDecoy(false);
  }

  cast(id: SkillId, lv: number, px: number, pz: number, dirX: number, dirZ: number): boolean {
    if (this.cd > 0) return false;
    const pack = skillFx(id, lv);
    if (id === 'decoy') {
      this.cd = pack.decoy?.cooldown ?? 9;
      if (this.decoy) this.scene.remove(this.decoy.group);
      const g = this.buildStandee();
      g.position.set(px, 0, pz);
      g.rotation.y = Math.atan2(dirX, dirZ) + Math.PI;
      this.scene.add(g);
      const d = pack.decoy!;
      this.decoy = { group: g, x: px, z: pz, t: d.duration, lv };
      sfx.play('decoy');
    } else if (id === 'keyboard') {
      this.cd = pack.keyboard?.cooldown ?? 5.5;
      if (this.kb) this.scene.remove(this.kb.mesh);
      const skin = throwSkinOnDay(this.day);
      const mesh = makeThrowProjectile(skin, throwLookOf(pack.keyboard));
      this.scene.add(mesh);
      this.kb = {
        mesh,
        x: px + dirX * 0.6,
        z: pz + dirZ * 0.6,
        dirX,
        dirZ,
        phase: 0,
        traveled: 0,
        hit: new Set(),
        lv,
        skin,
      };
      sfx.play('keyboard');
    } else if (id === 'coffee') {
      const c = pack.coffee;
      if (!c) return false;
      this.cd = c.cooldown;
      const tint = coffeeTintOnDay(this.day);
      const look = { color: tint ?? c.color, opacity: c.opacity };
      const n = Math.max(1, c.count | 0);
      const sideX = -dirZ;
      const sideZ = dirX;
      for (let k = 0; k < n; k++) {
        const dist = c.range + k * c.spacing + (Math.random() - 0.5) * 0.18;
        const jx = sideX * (Math.random() - 0.5) * 0.38 + (Math.random() - 0.5) * 0.12;
        const jz = sideZ * (Math.random() - 0.5) * 0.38 + (Math.random() - 0.5) * 0.12;
        const rk = c.radius * (0.84 + Math.random() * 0.32);
        this.pourCoffee(px + dirX * dist + jx, pz + dirZ * dist + jz, rk, c.life, look);
      }
      sfx.play('coffee');
      if (c.splashRadius > 0.05) {
        const dist = c.range + Math.max(0, n - 1) * c.spacing + 0.4 + Math.random() * 0.2;
        const jx = sideX * (Math.random() - 0.5) * 0.3;
        const jz = sideZ * (Math.random() - 0.5) * 0.3;
        this.pourCoffee(
          px + dirX * dist + jx,
          pz + dirZ * dist + jz,
          c.splashRadius * (0.88 + Math.random() * 0.22),
          c.splashLife || c.life,
          look
        );
      }
    }
    return true;
  }

  update(dt: number, px: number, pz: number, enemies: Enemies) {
    this.cd = Math.max(0, this.cd - dt);

    if (this.decoy) {
      const d = this.decoy;
      d.t -= dt;
      d.group.rotation.z = Math.sin(d.t * 7) * 0.06;
      if (d.t <= 0) {
        if (d.lv >= 3) {
          const blast = skillFx('decoy', d.lv).decoy;
          if (blast && blast.blastRadius > 0.05) {
            for (let i = 0; i < enemies.cap; i++) {
              const s = enemies.state[i];
              if (s !== EState.Chase && s !== EState.Knock && s !== EState.Getup) continue;
              const dx = enemies.posX[i] - d.x;
              const dz = enemies.posZ[i] - d.z;
              const dd = Math.hypot(dx, dz);
              if (dd < blast.blastRadius) enemies.hit(i, dx / (dd || 1), dz / (dd || 1), blast.blastImpulse, { force: true });
            }
          }
        }
        this.scene.remove(d.group);
        this.decoy = null;
      }
    }
    sfx.setDecoy(!!this.decoy);

    if (this.kb) {
      const k = this.kb;
      const kb = skillFx('keyboard', k.lv).keyboard!;
      if (k.phase === 0) {
        k.x += k.dirX * kb.speed * dt;
        k.z += k.dirZ * kb.speed * dt;
        k.traveled += kb.speed * dt;
        if (k.traveled >= kb.range) {
          k.phase = 1;
          k.hit.clear();
        }
      } else {
        const dx = px - k.x;
        const dz = pz - k.z;
        const dd = Math.hypot(dx, dz);
        if (dd < 0.8) {
          this.scene.remove(k.mesh);
          this.kb = null;
          sfx.play('keyboard_catch');
        } else {
          k.x += (dx / dd) * kb.speed * dt;
          k.z += (dz / dd) * kb.speed * dt;
        }
      }
      if (this.kb) {
        k.mesh.position.set(k.x, 1.0, k.z);
        const spin = k.skin === 'boomerang' ? 28 : k.skin === 'mouse' ? 14 : 18;
        k.mesh.rotation.y += dt * spin;
        if (k.skin === 'boomerang') k.mesh.rotation.z = Math.sin(k.traveled * 2.2) * 0.35;
        const width = kb.width;
        for (let i = 0; i < enemies.cap; i++) {
          if (k.hit.has(i)) continue;
          const s = enemies.state[i];
          if (s !== EState.Chase && s !== EState.Knock && s !== EState.Getup) continue;
          const dx = enemies.posX[i] - k.x;
          const dz = enemies.posZ[i] - k.z;
          if (dx * dx + dz * dz < width * width) {
            k.hit.add(i);
            const dd = Math.hypot(dx, dz) || 1;
            const fell = k.lv >= 3 || k.phase === 0;
            enemies.hit(i, dx / dd, dz / dd, fell ? kb.knockImpulse : kb.hitImpulse, { force: fell });
          }
        }
      }
    }
  }

  /** 纸板立牌替身：纸板底色 + 蓝衬衫涂装 + 支撑斜杆 */
  private buildStandee(): THREE.Group {
    const g = new THREE.Group();
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.68, 1.46, 0.05),
      new THREE.MeshLambertMaterial({ color: 0xd9c9a3 })
    );
    board.position.y = 0.75;
    board.castShadow = true;
    g.add(board);

    const shirt = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.68, 0.03),
      new THREE.MeshLambertMaterial({ color: 0x3b82f6 })
    );
    shirt.position.set(0, 0.82, 0.035);
    g.add(shirt);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshLambertMaterial({ color: 0xf0c8a0 }));
    head.scale.z = 0.25;
    head.position.set(0, 1.34, 0.035);
    g.add(head);

    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.02), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    badge.position.set(0.12, 0.95, 0.06);
    g.add(badge);

    const strut = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.95, 0.06),
      new THREE.MeshLambertMaterial({ color: 0xb0a084 })
    );
    strut.position.set(0, 0.42, -0.26);
    strut.rotation.x = -0.55;
    g.add(strut);
    return g;
  }
}
