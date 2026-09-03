import { WEEKDAYS, nextWeekday, weekdayIndex, weekdaySlot, type WeekdayId } from './levels';

const KEY = 'offwork.progress.v1';

export interface Progress {
  /** 已通关的工作日 */
  beaten: WeekdayId[];
  /** 上次进入过的关，主页 3D 背景用 */
  lastPlayed?: WeekdayId;
}

function empty(): Progress {
  return { beaten: [] };
}

export function loadProgress(): Progress {
  try {
    if (new URLSearchParams(location.search).get('unlock') === 'all') {
      const p = loadProgressRaw();
      return { beaten: WEEKDAYS.slice(0, -1).map((s) => s.id), lastPlayed: p.lastPlayed };
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
    return { beaten, lastPlayed };
  } catch {
    return empty();
  }
}

export function saveProgress(p: Progress) {
  localStorage.setItem(KEY, JSON.stringify({ beaten: p.beaten, lastPlayed: p.lastPlayed }));
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
  saveProgress(empty());
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

export function loadSettings() {
  try {
    const raw = localStorage.getItem('offwork.settings.v1');
    if (!raw) return { sfx: true, debug: false };
    const data = JSON.parse(raw) as { sfx?: boolean; debug?: boolean };
    return { sfx: data.sfx !== false, debug: !!data.debug };
  } catch {
    return { sfx: true, debug: false };
  }
}

export function saveSettings(s: { sfx: boolean; debug: boolean }) {
  localStorage.setItem('offwork.settings.v1', JSON.stringify(s));
}
