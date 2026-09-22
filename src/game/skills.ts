import * as THREE from 'three/webgpu';
import RAPIER from '@dimforge/rapier3d-compat';
import { coffeeColorOnDay, skillFx, type HitBurstKind } from '../fx/catalog';
import { coffeePropOnDay, decoyCountOnDay, decoyRunDirs, decoyRunOnDay } from '../fx/days';
import type { WeekdayId } from '../levels';
import { SOLID_RAY_GROUPS } from '../sim/physics';
import { Enemies, EState } from './enemies';
import type { SkillId } from './cards';
import {
  decoyLookOf,
  decoySkinOnDay,
  disposeDecoyGhost,
  disposeDecoyRunner,
  makeDecoy,
  makeDecoyRunner,
  tickDecoyRunner,
} from './decoyGhost';
import type { HumanoidFigure, HumanoidKit } from './humanoid';
import { makeThrowProjectile, throwLookOf, throwSkinOnDay, type ThrowSkin } from './skillProjectiles';
import { sfx } from '../audio';
import type { SlickLook } from './slicks';

function skillHitFx(burst: HitBurstKind | undefined) {
  return burst ? { burst } : undefined;
}

/** 分身碰墙探测：身宽近似 + 射线高度 */
const DECOY_RADIUS = 0.32;
const DECOY_RAY_Y = 0.45;

interface Decoy {
  group: THREE.Group;
  /** 假人下班：带 run 动画的克隆；工位马甲/稻草人为 null */
  fig: HumanoidFigure | null;
  x: number;
  z: number;
  /** 剩余存活 */
  t: number;
  /** 剩余跑步 */
  runT: number;
  dirX: number;
  dirZ: number;
  speed: number;
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
  /** 返程开始时与玩家的水平距离，用来算回程弧高 */
  returnSpan: number;
  hit: Set<number>;
  lv: number;
  skin: ThrowSkin;
  spin: number;
}

/** 主动技能：分身、投掷物（按关换皮）、泼咖啡 */
export class Skills {
  cd = 0;
  private day: WeekdayId = 'monday';
  private decoys: Decoy[] = [];
  private kb: Keyboard | null = null;
  private decoyRay = new RAPIER.Ray({ x: 0, y: DECOY_RAY_Y, z: 0 }, { x: 0, y: 0, z: 1 });

  constructor(
    private scene: THREE.Scene,
    private world: RAPIER.World,
    private pourCoffee: (x: number, z: number, r: number, life: number, look: SlickLook) => void,
    private playerFig: () => HumanoidFigure | null = () => null,
    private playerKit: () => HumanoidKit | null = () => null
  ) {}

  setDay(day: WeekdayId) {
    this.day = day;
  }

  /** 分身存活时全场仇恨目标改为它（多体时取质心，给流场用） */
  get decoyPos(): { x: number; z: number } | null {
    if (!this.decoys.length) return null;
    let x = 0;
    let z = 0;
    for (const d of this.decoys) {
      x += d.x;
      z += d.z;
    }
    const n = this.decoys.length;
    return { x: x / n, z: z / n };
  }

  /** 某点最近的分身坐标（同事各自追最近那个） */
  nearestDecoy(x: number, z: number): { x: number; z: number } | null {
    if (!this.decoys.length) return null;
    let best = this.decoys[0]!;
    let bestD = Infinity;
    for (const d of this.decoys) {
      const dd = (d.x - x) * (d.x - x) + (d.z - z) * (d.z - z);
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    return { x: best.x, z: best.z };
  }

  reset() {
    this.cd = 0;
    this.clearDecoys();
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
      this.clearDecoys();
      const look = decoyLookOf(pack.decoy);
      const skin = decoySkinOnDay(this.day);
      const fig = this.playerFig();
      const kit = this.playerKit();
      const count = decoyCountOnDay(this.day, lv);
      const run = decoyRunOnDay(this.day);
      const dirs =
        run.time > 0 ? decoyRunDirs(dirX, dirZ, count) : [{ x: dirX, z: dirZ }];
      const d = pack.decoy!;
      for (let i = 0; i < count; i++) {
        const dir = dirs[i] ?? dirs[0]!;
        const len = Math.hypot(dir.x, dir.z) || 1;
        const rx = dir.x / len;
        const rz = dir.z / len;
        let group: THREE.Group;
        let runner: HumanoidFigure | null = null;
        if (run.time > 0 && kit) {
          runner = makeDecoyRunner(kit, look);
          group = runner.group;
        } else {
          group = makeDecoy(fig, look, skin);
        }
        const x = px;
        const z = pz;
        group.position.set(x, 0, z);
        group.rotation.y = Math.atan2(rx, rz);
        this.scene.add(group);
        this.decoys.push({
          group,
          fig: runner,
          x,
          z,
          t: d.duration,
          runT: run.time,
          dirX: rx,
          dirZ: rz,
          speed: run.speed,
          lv,
        });
      }
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
        returnSpan: 0,
        hit: new Set(),
        lv,
        skin,
        spin: 0,
      };
      sfx.play('keyboard');
    } else if (id === 'coffee') {
      const c = pack.coffee;
      if (!c) return false;
      this.cd = c.cooldown;
      const look: SlickLook = {
        color: coffeeColorOnDay(this.day, lv),
        opacity: c.opacity,
        prop: coffeePropOnDay(this.day),
      };
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

    if (this.decoys.length) {
      for (let i = this.decoys.length - 1; i >= 0; i--) {
        const d = this.decoys[i]!;
        const running = d.runT > 0 && d.speed > 0;
        if (running) this.stepDecoyRun(d, dt);
        if (d.fig) tickDecoyRunner(d.fig, d.runT > 0 && d.speed > 0, dt);
        d.t -= dt;
        if (d.t <= 0) {
          if (d.lv >= 3) {
            const blast = skillFx('decoy', d.lv).decoy;
            if (blast && blast.blastRadius > 0.05) {
              for (let ei = 0; ei < enemies.cap; ei++) {
                const s = enemies.state[ei];
                if (s !== EState.Chase && s !== EState.Knock && s !== EState.Getup) continue;
                const dx = enemies.posX[ei] - d.x;
                const dz = enemies.posZ[ei] - d.z;
                const dd = Math.hypot(dx, dz);
                if (dd < blast.blastRadius) {
                  enemies.hit(ei, dx / (dd || 1), dz / (dd || 1), blast.blastImpulse, {
                    force: true,
                    hitFx: skillHitFx(blast.hitBurst),
                  });
                }
              }
            }
          }
          this.removeDecoyAt(i);
        }
      }
    }
    sfx.setDecoy(this.decoys.length > 0);

    if (this.kb) {
      const k = this.kb;
      const kb = skillFx('keyboard', k.lv).keyboard!;
      const flat = k.skin === 'boomerang' || !!k.mesh.userData.throwFlat;
      if (k.phase === 0) {
        k.x += k.dirX * kb.speed * dt;
        k.z += k.dirZ * kb.speed * dt;
        k.traveled += kb.speed * dt;
        if (k.traveled >= kb.range) {
          k.phase = 1;
          k.hit.clear();
          k.returnSpan = Math.hypot(px - k.x, pz - k.z) || kb.range;
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
        const y = throwArcY(k.skin, k.phase, k.traveled, kb.range, px, pz, k.x, k.z, k.returnSpan);
        k.mesh.position.set(k.x, y, k.z);
        const spinRate = flat ? 22 : k.skin === 'mouse' ? 14 : 18;
        k.spin += dt * spinRate;
        if (flat) {
          k.mesh.rotation.set(0, k.spin, 0);
        } else {
          k.mesh.rotation.y = k.spin;
        }
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
            enemies.hit(i, dx / dd, dz / dd, fell ? kb.knockImpulse : kb.hitImpulse, {
              force: fell,
              hitFx: skillHitFx(kb.hitBurst),
            });
          }
        }
      }
    }
  }

  /**
   * 假人下班走位：前方通就跑；撞墙则左右滑；两边都堵就停跑（仍留在原地吸仇恨）。
   * 不寻路，只射线探墙/家具。
   */
  private stepDecoyRun(d: Decoy, dt: number) {
    const stepTime = Math.min(d.runT, dt);
    const want = d.speed * stepTime;
    if (want < 1e-4) {
      d.runT = 0;
      return;
    }

    const tryDir = (dx: number, dz: number): { dx: number; dz: number; go: number } | null => {
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) return null;
      dx /= len;
      dz /= len;
      const probe = want + DECOY_RADIUS;
      const ray = this.decoyRay;
      ray.origin.x = d.x;
      ray.origin.y = DECOY_RAY_Y;
      ray.origin.z = d.z;
      ray.dir.x = dx;
      ray.dir.y = 0;
      ray.dir.z = dz;
      const hit = this.world.castRay(ray, probe, true, undefined, SOLID_RAY_GROUPS);
      if (hit == null) return { dx, dz, go: want };
      const clear = hit.timeOfImpact - DECOY_RADIUS;
      if (clear > 0.04) return { dx, dz, go: Math.min(want, clear) };
      return null;
    };

    let moved = tryDir(d.dirX, d.dirZ);
    if (!moved) {
      const lx = -d.dirZ;
      const lz = d.dirX;
      const rx = d.dirZ;
      const rz = -d.dirX;
      moved =
        tryDir(lx, lz) ||
        tryDir(rx, rz) ||
        tryDir(d.dirX + lx, d.dirZ + lz) ||
        tryDir(d.dirX + rx, d.dirZ + rz);
    }

    if (!moved) {
      d.runT = 0;
      return;
    }

    d.dirX = moved.dx;
    d.dirZ = moved.dz;
    d.x += moved.dx * moved.go;
    d.z += moved.dz * moved.go;
    d.runT -= stepTime;
    d.group.position.set(d.x, 0, d.z);
    d.group.rotation.y = Math.atan2(d.dirX, d.dirZ);
  }

  private removeDecoyAt(i: number) {
    const d = this.decoys[i];
    if (!d) return;
    this.scene.remove(d.group);
    if (d.fig) disposeDecoyRunner(d.fig);
    else disposeDecoyGhost(d.group);
    this.decoys.splice(i, 1);
  }

  private clearDecoys() {
    for (let i = this.decoys.length - 1; i >= 0; i--) this.removeDecoyAt(i);
  }
}

/** 回旋镖抛物线高度；其它投掷皮保持齐胸。 */
function throwArcY(
  skin: ThrowSkin,
  phase: 0 | 1,
  traveled: number,
  range: number,
  px: number,
  pz: number,
  x: number,
  z: number,
  returnSpan: number
) {
  if (skin !== 'boomerang') return 1;
  const base = 0.7;
  const lift = 0.9;
  let u: number;
  if (phase === 0) {
    u = Math.min(1, Math.max(0, traveled / Math.max(0.01, range)));
  } else {
    const dd = Math.hypot(px - x, pz - z);
    u = Math.min(1, Math.max(0, dd / Math.max(0.01, returnSpan || range)));
  }
  return base + lift * Math.sin(Math.PI * u);
}
