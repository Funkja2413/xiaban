import * as THREE from 'three/webgpu';
import { mergeHazardFx } from '../fx/catalog';
import { isHazardKind, type HazardKind, type HazardTune, type LevelDef } from '../levels';
import type { Enemies } from './enemies';
import type { Player } from './player';
import { sfx } from '../audio';

interface Zone {
  id: string;
  kind: HazardKind;
  x: number;
  z: number;
  rotY: number;
  armed: boolean;
  cool: number;
  inside: boolean;
  tune?: HazardTune;
  hinge?: THREE.Object3D;
  slamSign: number;
  animT: number;
}

const DOOR_OPEN = 0.12;
const DOOR_HOLD = 0.28;
const DOOR_CLOSE = 0.9;
const DOOR_ANIM = DOOR_OPEN + DOOR_HOLD + DOOR_CLOSE;

export class Hazards {
  private zones: Zone[] = [];
  onPulse: ((x: number, z: number, radius: number, color: number, opacity: number, life: number, outline?: boolean) => void) | null = null;

  load(def: LevelDef, root?: THREE.Object3D) {
    const hinges = new Map<string, THREE.Object3D>();
    root?.traverse((o) => {
      if (o.userData.editKind === 'launch' && o.userData.launchHinge) {
        hinges.set(o.userData.editId as string, o.userData.launchHinge as THREE.Object3D);
      }
    });
    this.zones = [];
    for (const p of def.props) {
      if (!isHazardKind(p.kind)) continue;
      const hinge = hinges.get(p.id);
      if (hinge) hinge.rotation.y = 0;
      this.zones.push({
        id: p.id,
        kind: p.kind,
        x: p.x,
        z: p.z,
        rotY: p.rotY ?? 0,
        armed: true,
        cool: 0,
        inside: false,
        tune: p.hazard,
        hinge,
        slamSign: 1,
        animT: DOOR_ANIM,
      });
    }
  }

  rearm() {
    for (const z of this.zones) {
      z.armed = true;
      z.cool = 0;
      z.inside = false;
      z.animT = DOOR_ANIM;
      z.slamSign = 1;
      if (z.hinge) z.hinge.rotation.y = 0;
    }
  }

  update(dt: number, player: Player, enemies: Enemies) {
    const px = player.pos.x;
    const pz = player.pos.z;
    for (const z of this.zones) {
      z.cool = Math.max(0, z.cool - dt);
      this.tickDoor(z, dt);
      const fx = mergeHazardFx(z.kind, z.tune);
      const dx = px - z.x;
      const dz = pz - z.z;

      if (z.kind === 'launch') {
        this.updateLaunch(z, dt, player, dx, dz, fx);
        continue;
      }

      const hit = dx * dx + dz * dz <= fx.radius * fx.radius;
      if (!hit) {
        z.inside = false;
        if (z.kind === 'pit' || z.kind === 'crate' || z.kind === 'alarm') z.armed = z.cool <= 0;
        continue;
      }

      if (z.kind === 'wet') {
        player.applySlow(fx.duration, fx.factor ?? 0.55);
        if (!z.inside) {
          this.pulse(z.x, z.z, fx);
          sfx.play('wet');
        }
        z.inside = true;
        continue;
      }

      if (!z.armed || z.cool > 0) continue;

      if (z.kind === 'pit' || z.kind === 'crate') {
        player.stun(fx.duration);
        z.armed = false;
        z.cool = fx.duration + 1;
        this.pulse(z.x, z.z, fx);
        sfx.play('trip');
      } else if (z.kind === 'alarm') {
        const dirX = dx;
        const dirZ = dz;
        const len = Math.hypot(dirX, dirZ);
        const nx = len > 0.08 ? dirX / len : Math.sin(z.rotY) || 1;
        const nz = len > 0.08 ? dirZ / len : Math.cos(z.rotY);
        player.slam(nx, nz, fx.impulse ?? 520, fx.lift ?? 140, fx.duration);
        enemies.flingAround(z.x, z.z, fx.radius, fx.impulse ?? 520, fx.lift ?? 140);
        z.armed = false;
        z.cool = 1.35;
        this.onPulse?.(z.x, z.z, fx.radius, 0xffffff, 0.92, 1.45, true);
        sfx.play('floor_clunk');
      }
      z.inside = true;
    }
  }

  private updateLaunch(
    z: Zone,
    _dt: number,
    player: Player,
    dx: number,
    dz: number,
    fx: ReturnType<typeof mergeHazardFx>
  ) {
    const fwdX = Math.sin(z.rotY);
    const fwdZ = Math.cos(z.rotY);
    const rightX = Math.cos(z.rotY);
    const rightZ = -Math.sin(z.rotY);
    const localRight = dx * rightX + dz * rightZ;
    const localFwd = dx * fwdX + dz * fwdZ;
    const halfW = Math.max(0.72, fx.radius);
    const reach = Math.max(1.45, fx.radius * 1.9);
    const inLane = Math.abs(localRight) < halfW;
    const inFront = inLane && localFwd > 0.12 && localFwd < reach;
    const inBack = inLane && localFwd < -0.12 && localFwd > -reach * 0.75;
    const hit = inFront || inBack;

    if (!hit) {
      z.inside = false;
      if (z.cool <= 0) z.armed = true;
      return;
    }

    if (!z.armed || z.cool > 0) {
      z.inside = true;
      return;
    }

    const sign = localFwd >= 0 ? 1 : -1;
    z.slamSign = sign;
    z.animT = 0;
    player.slam(fwdX * sign, fwdZ * sign, fx.impulse ?? 620, fx.lift ?? 36, fx.duration);
    z.armed = false;
    z.cool = 1.65;
    z.inside = true;
    this.pulse(z.x + fwdX * sign * 0.55, z.z + fwdZ * sign * 0.55, fx);
    sfx.play('door_slam');
  }

  private tickDoor(z: Zone, dt: number) {
    if (!z.hinge || z.kind !== 'launch') return;
    z.animT = Math.min(DOOR_ANIM, z.animT + dt);
    const t = z.animT;
    const slam = 2.05 * z.slamSign;
    let ang = 0;
    if (t < DOOR_OPEN) ang = slam * (t / DOOR_OPEN);
    else if (t < DOOR_OPEN + DOOR_HOLD) ang = slam;
    else if (t < DOOR_ANIM) {
      const u = (t - DOOR_OPEN - DOOR_HOLD) / DOOR_CLOSE;
      ang = slam * (1 - u * u);
    }
    z.hinge.rotation.y = ang;
  }

  private pulse(x: number, z: number, fx: ReturnType<typeof mergeHazardFx>) {
    this.onPulse?.(x, z, fx.radius * 1.4, fx.color, fx.opacity, 0.4);
  }
}
