import { WEEKDAYS, nextWeekday, weekdayIndex, weekdaySlot, type WeekdayId } from './levels';
import { isPlayerSlotId, type PlayerSlotId } from './roster';

const KEY = 'offwork.progress.v1';

export interface Progress {
  /** 已通关的工作日 */
  beaten: WeekdayId[];
  /** 各关最好下班钟点，从 0 点起的分钟。18:00 起算，越早越好 */
  bests?: Partial<Record<WeekdayId, number>>;
  /** 上次进入过的关，主页 3D 背景用 */
  lastPlayed?: WeekdayId;
  /** 上次选进关的主角；编辑器男女都改，进游戏只带这一个 */
  playerSlot?: PlayerSlotId;
}

function empty(): Progress {
  return { beaten: [] };
}

export function loadProgress(): Progress {
  try {
    if (new URLSearchParams(location.search).get('unlock') === 'all') {
      const p = loadProgressRaw();
      return { beaten: WEEKDAYS.slice(0, -1).map((s) => s.id), bests: p.bests, lastPlayed: p.lastPlayed, playerSlot: p.playerSlot };
    }
  } catch {
    /* ignore */
  }
  return loadProgressRaw();
}

function loadProgressRaw(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const data = JSON.parse(raw) as Progress;
    const beaten = (data.beaten ?? []).filter((id): id is WeekdayId => !!weekdaySlot(id));
    const lastPlayed = data.lastPlayed && weekdaySlot(data.lastPlayed) ? data.lastPlayed : undefined;
    const playerSlot = isPlayerSlotId(data.playerSlot) ? data.playerSlot : undefined;
    const bests: Partial<Record<WeekdayId, number>> = {};
    if (data.bests && typeof data.bests === 'object') {
      for (const [id, sec] of Object.entries(data.bests)) {
        if (!weekdaySlot(id)) continue;
        if (typeof sec !== 'number' || !isLeaveClock(sec)) continue;
        bests[id as WeekdayId] = Math.floor(sec);
      }
    }
    return { beaten, bests, lastPlayed, playerSlot };
  } catch {
    return empty();
  }
}

export function saveProgress(p: Progress) {
  const bests = p.bests && Object.keys(p.bests).length ? p.bests : undefined;
  localStorage.setItem(KEY, JSON.stringify({ beaten: p.beaten, bests, lastPlayed: p.lastPlayed, playerSlot: p.playerSlot }));
}

/** 预计下班钟点。18:00 是 1080，24:00 之前才算成功下班 */
const SHIFT_START = 18 * 60;
const SHIFT_END = 24 * 60;

function isLeaveClock(min: number) {
  return Number.isFinite(min) && min >= SHIFT_START && min < SHIFT_END;
}

/** 关卡列表上的最好成绩：预计下班时间，形如 20:10 */
export function formatBest(clockMin: number) {
  const total = Math.floor(clockMin);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 成功下班才记成绩。更早的下班钟点替换原纪录 */
export function recordBest(id: WeekdayId, clockMin: number) {
  const p = loadProgress();
  const min = Math.floor(clockMin);
  if (!p.beaten.includes(id)) p.beaten.push(id);
  if (isLeaveClock(min)) {
    const prev = p.bests?.[id];
    if (prev == null || min < prev) p.bests = { ...p.bests, [id]: min };
  }
  saveProgress(p);
  return nextWeekday(id);
}

export function rememberPlayerSlot(id: PlayerSlotId) {
  const p = loadProgress();
  p.playerSlot = id;
  saveProgress(p);
}

export function loadPlayerSlot(): PlayerSlotId {
  return loadProgress().playerSlot ?? 'player';
}

export function rememberLastPlayed(id: WeekdayId) {
  const p = loadProgress();
  p.lastPlayed = id;
  saveProgress(p);
}

export function lastPlayedDay(): WeekdayId {
  const p = loadProgress();
  if (p.lastPlayed && isUnlocked(p.lastPlayed, p)) return p.lastPlayed;
  return 'monday';
}

/** 主页俯视滑翔的背景关：上次玩过的已解锁日，没有则周一。五关都走这里，不要写死某一天。 */
export function homeBackdropDay(): WeekdayId {
  return lastPlayedDay();
}

export function resetProgress() {
  const playerSlot = loadProgressRaw().playerSlot;
  saveProgress({ beaten: [], playerSlot });
}

/** 已解锁：周一，以及每个已通关日的下一天 */
export function isUnlocked(id: WeekdayId, p = loadProgress()) {
  if (id === 'monday') return true;
  const i = weekdayIndex(id);
  if (i <= 0) return false;
  return p.beaten.includes(WEEKDAYS[i - 1].id);
}

export function markBeaten(id: WeekdayId) {
  const p = loadProgress();
  if (!p.beaten.includes(id)) {
    p.beaten.push(id);
    saveProgress(p);
  }
  return nextWeekday(id);
}

/** 开始游戏：第一关未通关的已解锁日；全通则停在周五 */
export function continueDay(p = loadProgress()): WeekdayId {
  for (const slot of WEEKDAYS) {
    if (isUnlocked(slot.id, p) && !p.beaten.includes(slot.id)) return slot.id;
  }
  return 'friday';
}

export type Settings = { music: boolean; sfx: boolean; debug: boolean };

/** 旧档只有 sfx，当时表示音乐。缺 music 时沿用旧 sfx；新 sfx 默认开。 */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('offwork.settings.v1');
    if (!raw) return { music: true, sfx: true, debug: false };
    const data = JSON.parse(raw) as { sfx?: boolean; music?: boolean; debug?: boolean };
    const music = data.music !== undefined ? data.music !== false : data.sfx !== false;
    const sfx = data.music !== undefined ? data.sfx !== false : true;
    return { music, sfx, debug: !!data.debug };
  } catch {
    return { music: true, sfx: true, debug: false };
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem('offwork.settings.v1', JSON.stringify(s));
}
