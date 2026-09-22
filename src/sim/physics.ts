import RAPIER from '@dimforge/rapier3d-compat';

/** 碰撞分组位（Rapier: (membership << 16) | filter） */
export const G_PLAYER = 0x2;
export const G_ENEMY = 0x4;
export const G_RAGDOLL = 0x8;
/** 布娃娃只撞地面/墙/家具。不撞活人、玩家、其他布娃娃，避免在人堆里重叠爆炸飞满屏 */
export const RAGDOLL_GROUPS = (G_RAGDOLL << 16) | (0xffff & ~(G_RAGDOLL | G_ENEMY | G_PLAYER));
/** 敌人胶囊体：与一切碰撞 */
export const ENEMY_GROUPS = (G_ENEMY << 16) | 0xffff;
/** 拦截者赶路：穿过其他同事，仍撞玩家 / 墙 / 布娃娃 */
export const ENEMY_CUT_GROUPS = (G_ENEMY << 16) | (0xffff & ~G_ENEMY);
/** 玩家常态：与一切碰撞 */
export const PLAYER_GROUPS = (G_PLAYER << 16) | 0xffff;
/** 玩家虚化（幻影冲刺/分身相位）：穿过敌人与布娃娃，仍被墙挡 */
export const PLAYER_PHASED_GROUPS = (G_PLAYER << 16) | (0xffff & ~(G_ENEMY | G_RAGDOLL));
/** 探路射线：只撞墙/家具/地面，忽略人与布娃娃 */
export const SOLID_RAY_GROUPS = (0xffff << 16) | (0xffff & ~(G_ENEMY | G_PLAYER | G_RAGDOLL));

let initialized = false;

export async function initPhysics(): Promise<RAPIER.World> {
  if (!initialized) {
    await RAPIER.init();
    initialized = true;
  }
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  return world;
}
