import { WEEKDAYS, nextWeekday, weekdayIndex, weekdaySlot, type WeekdayId } from './levels';
import { isPlayerSlotId, type PlayerSlotId } from './roster';

const KEY = 'offwork.progress.v1';

export interface Progress {
  /** 已通关的工作日 */
  beaten: WeekdayId[];
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
      return { beaten: WEEKDAYS.slice(0, -1).map((s) => s.id), lastPlayed: p.lastPlayed, playerSlot: p.playerSlot };
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
    return { beaten, lastPlayed, playerSlot };
  } catch {
    return empty();
  }
}

export function saveProgress(p: Progress) {
  localStorage.setItem(KEY, JSON.stringify({ beaten: p.beaten, lastPlayed: p.lastPlayed, playerSlot: p.playerSlot }));
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
