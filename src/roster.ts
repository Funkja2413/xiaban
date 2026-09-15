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

export const PLAYER_SLOT_IDS = ['player', 'player-f'] as const;
export type PlayerSlotId = (typeof PLAYER_SLOT_IDS)[number];

export function isPlayerSlotId(id: string | null | undefined): id is PlayerSlotId {
  return PLAYER_SLOT_IDS.some((s) => s === id);
}

export function rosterPlayers(): RosterSlot[] {
  return ROSTER.filter((s) => s.kind === 'player');
}

export const ROSTER: RosterSlot[] = [
  {
    id: 'player',
    label: '玩家·男',
    blurb: '开局二选一：男性自己',
    kind: 'player',
    gender: 'male',
  },
  {
    id: 'player-f',
    label: '玩家·女',
    blurb: '开局二选一：女性自己',
    kind: 'player',
    gender: 'female',
  },
  {
    id: 'colleague-a-m',
    label: '普通同事·男',
    blurb: 'A 型人群。花名和皮按关写在 catalog',
    kind: 'crowd',
    gender: 'male',
    enemy: 'A',
  },
  {
    id: 'colleague-a-f',
    label: '普通同事·女',
    blurb: 'A 型人群。花名和皮按关写在 catalog',
    kind: 'crowd',
    gender: 'female',
    enemy: 'A',
  },
  {
    id: 'heavy',
    label: '重量级主管',
    blurb: 'C 型：撞不动。花名和皮按关换',
    kind: 'special',
    gender: 'male',
    enemy: 'C',
  },
  {
    id: 'interceptor',
    label: '拦截者',
    blurb: 'F 型：蹲电梯。花名和皮按关换',
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
