/** 每关玩家构筑。没单独写的关沿用周一。改这里，特效编辑器和抽卡会跟上。 */

import {
  BATTLE_SLOT_IDS,
  ENEMY_SKILL_META,
  lookForSlotOnDay,
  type ColleagueCatalog,
  type EnemySkillId,
} from '../catalog';
import {
  HAZARD_KINDS,
  isHazardKind,
  levelById,
  PROP_SPECS,
  type HazardKind,
  type LevelCatalog,
  type WeekdayId,
} from '../levels';
import type { LineId, SkillKey } from './catalog';

export interface DayPlayerLoadout {
  dashes: LineId[];
  skills: SkillKey[];
  /** 冲刺/主动技能是否还在套周一。陷阱和同事技能不走这条。 */
  inherited: boolean;
}

export interface DayPlayKit extends DayPlayerLoadout {
  day: WeekdayId;
  hazards: HazardKind[];
  enemySkills: EnemySkillId[];
}

export const LINE_NAMES: Record<LineId, string> = {
  brute: '蛮力冲',
  slump: '倦怠冲',
  phantom: '幻影冲',
  rebound: '反弹冲',
  reclock: '补卡冲',
  blame: '甩锅冲',
};

/** 技能族默认名（无按天覆盖时） */
export const SKILL_NAMES: Record<SkillKey, string> = {
  decoy: '工位马甲',
  keyboard: '横飞鼠标',
  coffee: '喝咖啡',
};

/** 按关显示名：同一 SkillKey，皮不同 */
const SKILL_DAY_NAMES: Record<WeekdayId, Partial<Record<SkillKey, string>>> = {
  monday: { keyboard: '横飞鼠标', coffee: '喝咖啡' },
  tuesday: { keyboard: '横飞鼠标', coffee: '喝咖啡', decoy: '工位马甲' },
  wednesday: { keyboard: '回旋键盘', coffee: '泼脏水', decoy: '工位马甲' },
  thursday: { keyboard: '飞踹电脑', coffee: '外卖汤', decoy: '我是NPC' },
  friday: { keyboard: 'OKR回旋镖', coffee: '破罐破摔', decoy: '假人下班' },
};

export function lineName(_day: WeekdayId, id: LineId): string {
  return LINE_NAMES[id];
}

export function skillNameOnDay(day: WeekdayId, id: SkillKey): string {
  return SKILL_DAY_NAMES[day]?.[id] ?? SKILL_NAMES[id];
}

/** 抽卡角标：跟当天皮名走 */
export function skillGlyphOnDay(day: WeekdayId, id: SkillKey): string {
  if (id === 'keyboard') {
    if (day === 'friday') return '🪃';
    if (day === 'thursday') return '💻';
    if (day === 'wednesday') return '⌨️';
    return '🖱️';
  }
  if (id === 'coffee') {
    if (day === 'friday') return '💥';
    if (day === 'thursday') return '🍜';
    if (day === 'wednesday') return '💧';
    return '☕';
  }
  if (id === 'decoy') {
    if (day === 'friday') return '🧍';
    if (day === 'thursday') return '🎭';
    return '🪧';
  }
  return '•';
}

/** 咖啡渍按关换色（泼脏水 / 外卖汤等） */
export function coffeeTintOnDay(day: WeekdayId): number | null {
  if (day === 'wednesday') return 0x6a7a88;
  if (day === 'thursday') return 0xc45c28;
  if (day === 'friday') return 0x5a4038;
  return null;
}

/** 周一：2 技能 + 2 冲刺 */
export const MONDAY_LOADOUT: Omit<DayPlayerLoadout, 'inherited'> = {
  dashes: ['brute', 'slump'],
  skills: ['keyboard', 'coffee'],
};

/**
 * 只写和周一不同的关。
 * 周二起 3+3；周五冲刺换成反弹 / 补卡 / 甩锅。
 */
export const DAY_LOADOUTS: Partial<Record<WeekdayId, { dashes?: LineId[]; skills?: SkillKey[] }>> = {
  tuesday: {
    dashes: ['brute', 'slump', 'phantom'],
    skills: ['keyboard', 'coffee', 'decoy'],
  },
  wednesday: {
    dashes: ['brute', 'slump', 'rebound'],
    skills: ['keyboard', 'coffee', 'decoy'],
  },
  thursday: {
    dashes: ['brute', 'slump', 'phantom'],
    skills: ['keyboard', 'coffee', 'decoy'],
  },
  friday: {
    dashes: ['rebound', 'reclock', 'blame'],
    skills: ['keyboard', 'coffee', 'decoy'],
  },
};

export function dayPlayerLoadout(day: WeekdayId): DayPlayerLoadout {
  const over = DAY_LOADOUTS[day];
  const hasOwn = !!(over?.dashes || over?.skills);
  return {
    dashes: over?.dashes ?? MONDAY_LOADOUT.dashes,
    skills: over?.skills ?? MONDAY_LOADOUT.skills,
    inherited: day !== 'monday' && !hasOwn,
  };
}

export function hazardsInLevel(levels: LevelCatalog, day: WeekdayId): HazardKind[] {
  const have = new Set<HazardKind>();
  for (const p of levelById(levels, day).props ?? []) {
    if (isHazardKind(p.kind)) have.add(p.kind);
  }
  return HAZARD_KINDS.filter((k) => have.has(k));
}

export function enemySkillsOnDay(cat: ColleagueCatalog, day: WeekdayId): EnemySkillId[] {
  const seen = new Set<EnemySkillId>();
  const out: EnemySkillId[] = [];
  for (const id of BATTLE_SLOT_IDS) {
    const skill = lookForSlotOnDay(cat, day, id)?.enemySkill;
    if (!skill || seen.has(skill)) continue;
    seen.add(skill);
    out.push(skill);
  }
  return out;
}

export function dayPlayKit(day: WeekdayId, colleagues: ColleagueCatalog, levels: LevelCatalog): DayPlayKit {
  const loadout = dayPlayerLoadout(day);
  return {
    day,
    ...loadout,
    hazards: hazardsInLevel(levels, day),
    enemySkills: enemySkillsOnDay(colleagues, day),
  };
}

function hazardLabel(kind: HazardKind) {
  return PROP_SPECS.find((p) => p.id === kind)?.label ?? kind;
}

export function dayKitMeta(kit: DayPlayKit): string {
  const traps = kit.hazards.length ? kit.hazards.map(hazardLabel).join('、') : '无陷阱';
  const skills = kit.enemySkills.length
    ? kit.enemySkills.map((id) => ENEMY_SKILL_META[id].name).join('、')
    : '无同事主动';
  const loadout = kit.inherited ? '构筑沿用周一' : '本关构筑';
  return `${loadout} · ${traps} · ${skills}`;
}

export function dayKitHint(kit: DayPlayKit): string {
  const dashes = kit.dashes.map((id) => lineName(kit.day, id)).join(' / ') || '无';
  const skills = kit.skills.map((id) => skillNameOnDay(kit.day, id)).join(' / ') || '无';
  const traps = kit.hazards.length ? kit.hazards.map(hazardLabel).join('、') : '无';
  const enemy = kit.enemySkills.length
    ? kit.enemySkills.map((id) => ENEMY_SKILL_META[id].name).join('、')
    : '无';
  const inherit = kit.inherited ? '冲刺和主动技能先沿用周一，规划好后改 src/fx/days.ts。' : '';
  return `${inherit}冲刺 ${dashes}。主动技能 ${skills}。陷阱 ${traps}。同事主动 ${enemy}。`.trim();
}
