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
  brute: '蛮力',
  slump: '倦怠',
  phantom: '幻影',
};

export const SKILL_NAMES: Record<SkillKey, string> = {
  decoy: '摸鱼分身',
  keyboard: '回旋键盘',
  coffee: '咖啡',
};

/** 周一完整构筑。周二–周五没写自己的 dashes/skills 时套这一套。 */
export const MONDAY_LOADOUT: Omit<DayPlayerLoadout, 'inherited'> = {
  dashes: ['brute', 'slump', 'phantom'],
  skills: ['decoy', 'keyboard', 'coffee'],
};

/**
 * 只写和周一不同的关。
 * 例：tuesday: { skills: ['coffee'] } 表示周二仍用周一三条冲刺，主动技能只留咖啡。
 */
export const DAY_LOADOUTS: Partial<Record<WeekdayId, { dashes?: LineId[]; skills?: SkillKey[] }>> = {
  tuesday: {},
  wednesday: {},
  thursday: {},
  friday: {},
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
  const dashes = kit.dashes.map((id) => LINE_NAMES[id]).join(' / ') || '无';
  const skills = kit.skills.map((id) => SKILL_NAMES[id]).join(' / ') || '无';
  const traps = kit.hazards.length ? kit.hazards.map(hazardLabel).join('、') : '无';
  const enemy = kit.enemySkills.length
    ? kit.enemySkills.map((id) => ENEMY_SKILL_META[id].name).join('、')
    : '无';
  const inherit = kit.inherited ? '冲刺和主动技能先沿用周一，规划好后改 src/fx/days.ts。' : '';
  return `${inherit}冲刺 ${dashes}。主动技能 ${skills}。陷阱 ${traps}。同事主动 ${enemy}。`.trim();
}
