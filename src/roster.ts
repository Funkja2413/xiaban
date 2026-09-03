/** 游戏角色规划。增删改这里，编辑器「刷新规划」或 HMR 后会跟上。 */
export type RosterKind = 'player' | 'crowd' | 'special';
export type EnemyKind = 'A' | 'C' | 'F';

export interface RosterSlot {
  id: string;
  label: string;
  blurb: string;
  kind: RosterKind;
  gender: 'male' | 'female';
  /** 对应 enemies.EType；玩家没有 */
  enemy?: EnemyKind;
}

export const ROSTER: RosterSlot[] = [
  {
    id: 'player',
    label: '玩家',
    blurb: '你自己，往电梯跑的那一个',
    kind: 'player',
    gender: 'male',
  },
  {
    id: 'colleague-a-f',
    label: '普通同事·女',
    blurb: 'A 型人群：被你吸引，可撞飞',
    kind: 'crowd',
    gender: 'female',
    enemy: 'A',
  },
  {
    id: 'colleague-a-m',
    label: '普通同事·男',
    blurb: 'A 型人群：被你吸引，可撞飞',
    kind: 'crowd',
    gender: 'male',
    enemy: 'A',
  },
  {
    id: 'heavy',
    label: '重量级主管',
    blurb: 'C 型：冲刺撞不动，守门口',
    kind: 'special',
    gender: 'male',
    enemy: 'C',
  },
  {
    id: 'interceptor',
    label: '拦截者',
    blurb: 'F 型：去电梯必经之路蹲守',
    kind: 'special',
    gender: 'female',
    enemy: 'F',
  },
];

export function rosterSlot(id: string): RosterSlot | undefined {
  return ROSTER.find((s) => s.id === id);
}

export function rosterByEnemy(kind: EnemyKind): RosterSlot[] {
  return ROSTER.filter((s) => s.enemy === kind);
}
