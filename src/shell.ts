import { WEEKDAYS, weekdaySlot, type WeekdayId } from './levels';
import {
  continueDay,
  isUnlocked,
  loadProgress,
  loadSettings,
  markBeaten,
  rememberLastPlayed,
  resetProgress,
  saveSettings,
} from './progress';

export type ShellMode = 'loading' | 'home' | 'levels' | 'settings' | 'play' | 'result';

let requestPlay: (day: WeekdayId) => void = (day) => goPlay(day);
let onReturnHome: (() => void) | null = null;

function stage() {
  return document.getElementById('stage')!;
}

function applyDebug(on: boolean) {
  document.getElementById('stats')!.classList.toggle('debugOn', on);
}

export function playUrl(day: WeekdayId) {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('play', '1');
  url.searchParams.set('day', day);
  return url.pathname + url.search;
}

export function homeUrl() {
  const url = new URL(location.href);
  url.search = '';
  return url.pathname;
}

export function setMode(mode: ShellMode) {
  const prev = stage().dataset.mode as ShellMode | undefined;
  stage().dataset.mode = mode;
  if (mode === 'home' && prev && prev !== 'home' && prev !== 'loading') {
    onReturnHome?.();
  }
}

export function bindHome(fn: () => void) {
  onReturnHome = fn;
}

export function goPlay(day: WeekdayId) {
  if (!isUnlocked(day)) return;
  rememberLastPlayed(day);
  location.assign(playUrl(day));
}

export function goHome() {
  location.assign(homeUrl());
}

export function bindPlay(fn: (day: WeekdayId) => void) {
  requestPlay = fn;
  renderLevels();
}

function bindArtSlots() {
  for (const img of document.querySelectorAll<HTMLImageElement>('.artSlot img')) {
    const slot = img.closest('.artSlot');
    const mark = () => slot?.classList.add('empty');
    const ok = () => slot?.classList.remove('empty');
    img.addEventListener('error', mark);
    img.addEventListener('load', ok);
    if (img.complete) {
      if (!img.naturalWidth) mark();
      else ok();
    }
  }
}

function renderLevels() {
  const list = document.getElementById('levelList')!;
  const p = loadProgress();
  list.innerHTML = '';
  for (const slot of WEEKDAYS) {
    const open = isUnlocked(slot.id, p);
    const beaten = p.beaten.includes(slot.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'levelCard' + (open ? '' : ' locked');
    btn.disabled = !open;
    btn.innerHTML =
      `<span class="levelDay">${slot.label}</span>` +
      `<span class="levelBlurb">${open ? slot.blurb : '尚未解锁'}</span>` +
      `<span class="levelTag">${!open ? '锁定' : beaten ? '已下班' : '可闯关'}</span>`;
    btn.addEventListener('click', () => requestPlay(slot.id));
    list.appendChild(btn);
  }
}

function bindSettings() {
  const sfx = document.getElementById('optSfx') as HTMLInputElement;
  const debug = document.getElementById('optDebug') as HTMLInputElement;
  const s = loadSettings();
  sfx.checked = s.sfx;
  debug.checked = s.debug;
  applyDebug(s.debug);
  const persist = () => saveSettings({ sfx: sfx.checked, debug: debug.checked });
  sfx.addEventListener('change', persist);
  debug.addEventListener('change', () => {
    persist();
    applyDebug(debug.checked);
  });
  document.getElementById('optReset')!.addEventListener('click', () => {
    if (!confirm('重置后只保留周一，确定？')) return;
    resetProgress();
    renderLevels();
  });
}

export function showResult(kind: 'won' | 'lost', day: WeekdayId, sub: string) {
  setMode('result');
  const title = document.querySelector('#overlay .otitle')!;
  const body = document.querySelector('#overlay .osub')!;
  const nextBtn = document.getElementById('resultNext') as HTMLButtonElement;
  const retryBtn = document.getElementById('resultRetry') as HTMLButtonElement;
  title.textContent = kind === 'won' ? '成功下班！' : '今晚走不了了…';
  body.innerHTML = sub;

  if (kind === 'won') {
    const nxt = markBeaten(day);
    retryBtn.style.display = 'none';
    if (nxt) {
      nextBtn.style.display = 'block';
      nextBtn.textContent = `下一关 · ${weekdaySlot(nxt)?.label ?? ''}`;
      nextBtn.onclick = () => requestPlay(nxt);
    } else {
      nextBtn.style.display = 'none';
      body.innerHTML = sub + '<br>本周班都下完了。';
    }
  } else {
    nextBtn.style.display = 'none';
    retryBtn.style.display = 'block';
    retryBtn.onclick = () => requestPlay(day);
  }
}

export function initShell() {
  applyDebug(loadSettings().debug);
  bindArtSlots();
  renderLevels();
  bindSettings();

  document.getElementById('btnStart')!.addEventListener('click', () => requestPlay(continueDay()));
  document.getElementById('btnLevels')!.addEventListener('click', () => setMode('levels'));
  document.getElementById('btnSettings')!.addEventListener('click', () => setMode('settings'));
  for (const id of ['btnLevelsBack', 'btnSettingsBack']) {
    document.getElementById(id)!.addEventListener('click', () => setMode('home'));
  }
  document.getElementById('resultHome')!.addEventListener('click', () => goHome());
  document.getElementById('resetBtn')!.addEventListener('click', () => goHome());
}

export function wantsAutoPlay() {
  const q = new URLSearchParams(location.search);
  if (q.get('play') === '1') {
    const day = weekdaySlot(q.get('day') ?? '')?.id ?? continueDay();
    return isUnlocked(day) ? day : continueDay();
  }
  return null;
}

export { homeBackdropDay, lastPlayedDay } from './progress';
