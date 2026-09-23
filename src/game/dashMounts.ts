import * as THREE from 'three/webgpu';
import {
  propFitOf,
  type ColleagueCatalog,
  type DashMountSlot,
} from '../catalog';
import type { LineId } from '../fx/catalog';
import { Enemies, EState } from './enemies';
import { BONE_HAND, findBoneAny, loadPropVisual } from './hair';
import type { Player } from './player';

const HEAD_CAP = 24;

/** 预加载冲刺挂件模型。角色编辑器写入，游戏和特效预览共用。 */
export class DashMountKit {
  private visuals = new Map<string, THREE.Group>();

  private constructor(readonly mounts: ColleagueCatalog['dashMounts']) {}

  static async from(cat: ColleagueCatalog) {
    const kit = new DashMountKit(cat.dashMounts ?? {});
    const ids = new Set<string>();
    for (const def of Object.values(kit.mounts)) {
      if (def?.hand) ids.add(def.hand.propId);
      if (def?.head) ids.add(def.head.propId);
    }
    await Promise.all(
      [...ids].map(async (id) => {
        const prop = cat.props.find((p) => p.id === id);
        if (!prop?.file) return;
        kit.visuals.set(id, await loadPropVisual(prop.file, propFitOf(id, prop.fit)));
      })
    );
    return kit;
  }

  slot(line: string, which: 'hand' | 'head'): DashMountSlot | null {
    return this.mounts[line]?.[which] ?? null;
  }

  visual(propId: string) {
    return this.visuals.get(propId) ?? null;
  }
}

/** 把已经压好尺寸的模型挂到骨头上，套用冲刺里存的姿态。 */
export function mountDashProp(
  host: THREE.Object3D,
  boneNames: string[],
  template: THREE.Group,
  slot: DashMountSlot
): THREE.Group | null {
  const bone = findBoneAny(host, boneNames);
  if (!bone) return null;
  const root = new THREE.Group();
  root.name = 'dashMount';
  const pre = new THREE.Group();
  pre.rotation.set(slot.preRotation[0], slot.preRotation[1], slot.preRotation[2], 'XYZ');
  const vis = template.clone(true);
  vis.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const src = mesh.material;
    if (src) mesh.material = Array.isArray(src) ? src.map((m) => m.clone()) : src.clone();
  });
  pre.add(vis);
  root.add(pre);
  root.position.set(slot.transform.position[0], slot.transform.position[1], slot.transform.position[2]);
  root.rotation.set(slot.transform.rotation[0], slot.transform.rotation[1], slot.transform.rotation[2], 'XYZ');
  root.scale.set(slot.transform.scale[0], slot.transform.scale[1], slot.transform.scale[2]);
  bone.add(root);
  return root;
}

type HeadPot = {
  i: number;
  line: LineId;
  t: number;
  group: THREE.Group;
  bob: number;
};

/** 冲刺时右手显示挂件；打中的人头顶另挂一份，人保持站立。 */
export class DashMounts {
  private kit: DashMountKit | null = null;
  private handRoot: THREE.Group | null = null;
  private handLine: LineId | null = null;
  private heads: HeadPot[] = [];
  private boneM = new THREE.Matrix4();
  private attachM = new THREE.Matrix4();

  constructor(
    private scene: THREE.Scene,
    private player: Player,
    private enemies: Enemies
  ) {}

  async load(cat: ColleagueCatalog) {
    this.kit = await DashMountKit.from(cat);
  }

  /** 换角色后右手挂件还别在旧模型上。 */
  detachHand() {
    this.handRoot?.removeFromParent();
    this.handRoot = null;
    this.handLine = null;
  }

  mark(i: number, line: LineId, duration: number) {
    const slot = this.kit?.slot(line, 'head');
    const template = slot ? this.kit?.visual(slot.propId) : null;
    if (!slot || !template || duration <= 0) return;
    if (i < 0 || i >= this.enemies.cap) return;
    const st = this.enemies.state[i];
    if (st === EState.Inactive || st === EState.Ragdoll) return;

    let pot = this.heads.find((p) => p.i === i);
    if (!pot) {
      if (this.heads.length >= HEAD_CAP) {
        pot = this.heads.reduce((a, b) => (a.t < b.t ? a : b));
        this.drop(pot);
        this.heads = this.heads.filter((p) => p !== pot);
        pot = undefined;
      }
      const group = new THREE.Group();
      group.name = 'dashHead';
      group.matrixAutoUpdate = false;
      // 与 mountDashProp 一致：预旋转 + 姿态打在子节点，跟随矩阵只负责贴头骨
      const pre = new THREE.Group();
      pre.rotation.set(slot.preRotation[0], slot.preRotation[1], slot.preRotation[2], 'XYZ');
      const vis = template.clone(true);
      vis.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      pre.add(vis);
      const pose = new THREE.Group();
      pose.position.set(slot.transform.position[0], slot.transform.position[1], slot.transform.position[2]);
      pose.rotation.set(slot.transform.rotation[0], slot.transform.rotation[1], slot.transform.rotation[2], 'XYZ');
      pose.scale.set(slot.transform.scale[0], slot.transform.scale[1], slot.transform.scale[2]);
      pose.add(pre);
      group.add(pose);
      this.scene.add(group);
      pot = { i, line, t: duration, group, bob: Math.random() * Math.PI * 2 };
      this.heads.push(pot);
    }
    pot.i = i;
    pot.line = line;
    pot.t = duration;
    pot.group.visible = true;
  }

  clearHead(i: number) {
    const next: HeadPot[] = [];
    for (const pot of this.heads) {
      if (pot.i === i) this.drop(pot);
      else next.push(pot);
    }
    this.heads = next;
  }

  update(dt: number) {
    this.syncHand();
    const keep: HeadPot[] = [];
    for (const pot of this.heads) {
      pot.t -= dt;
      pot.bob += dt * 6;
      const st = this.enemies.state[pot.i];
      if (pot.t <= 0 || st === EState.Inactive || st === EState.Ragdoll) {
        this.drop(pot);
        continue;
      }
      this.enemies.headMatrix(pot.i, this.boneM);
      // 姿态已在子节点，这里只贴头骨；闹钟再额外上飘一点
      this.attachM.identity();
      if (pot.line === 'reclock') {
        this.attachM.setPosition(0, 0.06 + Math.sin(pot.bob) * 0.04, 0);
      } else if (pot.line === 'blame') {
        this.attachM.setPosition(0, 0.04 + Math.sin(pot.bob) * 0.025, 0);
      }
      pot.group.matrix.copy(this.boneM).multiply(this.attachM);
      pot.group.matrixWorld.copy(pot.group.matrix);
      pot.group.matrixWorldNeedsUpdate = false;
      pot.group.visible = true;
      keep.push(pot);
    }
    this.heads = keep;
  }

  private drop(pot: HeadPot) {
    this.scene.remove(pot.group);
  }

  private syncHand() {
    const line = this.player.cards?.line ?? null;
    const slot = line && this.player.dashing ? this.kit?.slot(line, 'hand') : null;
    if (!line || !slot) {
      if (this.handRoot) this.handRoot.visible = false;
      return;
    }
    if (this.handLine !== line || !this.handRoot?.parent) {
      this.handRoot?.removeFromParent();
      this.handRoot = null;
      const template = this.kit?.visual(slot.propId);
      if (!template) return;
      this.handRoot = mountDashProp(this.player.figure.group, BONE_HAND, template, slot);
      this.handLine = line;
    } else if (this.handRoot) {
      this.handRoot.visible = true;
    }
  }
}
