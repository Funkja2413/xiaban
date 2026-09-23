import { WEEKDAYS, nextWeekday, weekdaySlot, type WeekdayId } from './levels';
import {
  continueDay,
  formatBest,
  isUnlocked,
  loadPlayerSlot,
  loadProgress,
  loadSettings,
  markBeaten,
  recordBest,
  rememberLastPlayed,
  rememberPlayerSlot,
  resetProgress,
  saveSettings,
} from './progress';
import { isPlayerSlotId, rosterSlot, type PlayerSlotId } from './roster';
import { BATTLE_SLOT_IDS, assetUrl, loadCatalog, lookForSlotOnDay, type ColleagueCatalog } from './catalog';
import { bgm, sfx } from './audio';

export type ShellMode = 'loading' | 'home' | 'levels' | 'settings' | 'avatar' | 'play' | 'result' | 'roster';

let requestPlay: (day: WeekdayId, player: PlayerSlotId) => void = (day, player) => goPlay(day, player);
let onReturnHome: (() => void) | null = null;
let onAvatarShow: ((selected: PlayerSlotId | null) => void) | null = null;
let onAvatarHide: (() => void) | null = null;
let onAvatarSelect: ((id: PlayerSlotId | null) => void) | null = null;
let pendingDay: WeekdayId = 'monday';
let pendingBack: 'home' | 'levels' = 'home';
let pendingPlayer: PlayerSlotId | null = null;

function stage() {
  return document.getElementById('stage')!;
}

function applyDebug(on: boolean) {
  document.getElementById('stats')!.classList.toggle('debugOn', on);
}

export function playUrl(day: WeekdayId, player: PlayerSlotId = loadPlayerSlot()) {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('play', '1');
  url.searchParams.set('day', day);
  url.searchParams.set('player', player);
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
  if (mode === 'avatar' && prev !== 'avatar') {
    onAvatarShow?.(pendingPlayer);
  }
  if (prev === 'avatar' && mode !== 'avatar') {
    onAvatarHide?.();
  }
}

export function bindHome(fn: () => void) {
  onReturnHome = fn;
}

export function bindAvatar(hooks: {
  show: (selected: PlayerSlotId | null) => void;
  hide: () => void;
  select: (id: PlayerSlotId | null) => void;
}) {
  onAvatarShow = hooks.show;
  onAvatarHide = hooks.hide;
  onAvatarSelect = hooks.select;
}

export function goPlay(day: WeekdayId, player: PlayerSlotId = loadPlayerSlot()) {
  if (!isUnlocked(day)) return;
  rememberPlayerSlot(player);
  rememberLastPlayed(day);
  location.assign(playUrl(day, player));
}

export function goHome() {
  const url = homeUrl();
  if (`${location.pathname}${location.search}` !== url) history.replaceState(null, '', url);
  setMode('home');
}

export function bindPlay(fn: (day: WeekdayId, player: PlayerSlotId) => void) {
  requestPlay = fn;
  renderLevels();
}

function confirmPlay(day: WeekdayId, player: PlayerSlotId) {
  if (!isUnlocked(day)) return;
  rememberPlayerSlot(player);
  rememberLastPlayed(day);
  requestPlay(day, player);
}

function askAvatar(day: WeekdayId, back: 'home' | 'levels') {
  if (!isUnlocked(day)) return;
  pendingDay = day;
  pendingBack = back;
  pendingPlayer = 'player';
  syncAvatarPick();
  setMode('avatar');
}

function pickAvatar(id: PlayerSlotId) {
  pendingPlayer = id;
  syncAvatarPick();
  onAvatarSelect?.(id);
}

function syncAvatarPick() {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.avatarHit')) {
    const id = btn.dataset.slot;
    btn.classList.toggle('selected', !!pendingPlayer && id === pendingPlayer);
  }
  for (const name of document.querySelectorAll<HTMLElement>('.avatarNameArt')) {
    const id = name.dataset.slot;
    name.classList.toggle('selected', !!pendingPlayer && id === pendingPlayer);
  }
  const go = document.getElementById('avatarGo') as HTMLButtonElement;
  go.disabled = !pendingPlayer;
}

/** 把名牌锚在 3D 角色脚底下方（归一化 0–1，左上原点） */
export function layoutAvatarNames(feet: Partial<Record<PlayerSlotId, { x: number; y: number }>>) {
  for (const el of document.querySelectorAll<HTMLElement>('.avatarNameArt')) {
    const id = el.dataset.slot;
    if (!isPlayerSlotId(id)) continue;
    const p = feet[id];
    if (!p) continue;
    el.style.left = `${p.x * 100}%`;
    // 名牌顶边紧贴脚底下方，贴近 Figma 脚下名牌
    el.style.top = `${p.y * 100 + 0.6}%`;
  }
}

function bindAvatarUi() {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.avatarHit')) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.slot;
      if (isPlayerSlotId(id)) pickAvatar(id);
    });
  }
  document.getElementById('avatarGo')!.addEventListener('click', () => {
    if (!pendingPlayer) return;
    confirmPlay(pendingDay, pendingPlayer);
  });
}

function bindArtSlots() {
  for (const img of document.querySelectorAll<HTMLImageElement>('.artSlot img')) {
    const slot = img.closest('.artSlot');
    const mark = () => slot?.classList.add('empty');
    const ok = () => slot?.classList.remove('empty');
    img.addEventListener('error', mark);
    img.addEventListener('load', ok);
    if (slot?.id === 'loadingBg') {
      ok();
      continue;
    }
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
    const state = !open ? 'locked' : beaten ? 'beaten' : 'open';
    const tag = state === 'locked' ? '锁定' : state === 'beaten' ? '已下班' : '可闯关';
    const bestSec = beaten ? p.bests?.[slot.id] : undefined;
    const best = bestSec != null ? formatBest(bestSec) : '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'levelCard' + (open ? '' : ' locked');
    btn.disabled = !open;
    btn.innerHTML =
      `<span class="levelDay">${escapeText(slot.title)}</span>` +
      `<span class="levelStatus">` +
      (best ? `<span class="levelBest">${escapeText(best)}</span>` : '') +
      `<span class="levelTag" data-state="${state}">${tag}</span>` +
      `</span>` +
      `<span class="levelThumb"><img alt="" src="${escapeText(assetUrl(`ui/levels-day-${slot.id}.png`))}" width="1250" height="328"></span>`;
    btn.addEventListener('click', () => askAvatar(slot.id, 'levels'));
    list.appendChild(btn);
  }
}

let resetLevelsScroll: (() => void) | null = null;
let resetRosterScroll: (() => void) | null = null;

function bindHeadScroll(rootId: string, scrollId: string): (() => void) | null {
  const root = document.getElementById(rootId);
  const scroller = document.getElementById(scrollId);
  if (!root || !scroller) return null;
  let scrolled = false;
  const sync = () => {
    const next = scrolled ? scroller.scrollTop > 4 : scroller.scrollTop > 12;
    if (next === scrolled) return;
    scrolled = next;
    root.classList.toggle('is-scrolled', scrolled);
  };
  const reset = () => {
    scrolled = false;
    root.classList.remove('is-scrolled');
    scroller.scrollTop = 0;
  };
  scroller.addEventListener('scroll', sync, { passive: true });
  sync();
  return reset;
}

function bindLevelsScroll() {
  resetLevelsScroll = bindHeadScroll('levels', 'levelsScroll');
}

function bindRosterScroll() {
  resetRosterScroll = bindHeadScroll('roster', 'rosterScroll');
}

function openLevels() {
  renderLevels();
  setMode('levels');
  // display:none 时改 scrollTop 会被忽略，显示后再复位，避免标题叠在半路列表上
  requestAnimationFrame(() => {
    resetLevelsScroll?.();
    requestAnimationFrame(() => resetLevelsScroll?.());
  });
}

function openRoster() {
  renderRoster();
  setMode('roster');
  requestAnimationFrame(() => {
    resetRosterScroll?.();
    requestAnimationFrame(() => resetRosterScroll?.());
  });
}

let rosterCatalog: ColleagueCatalog | null = null;

function escapeText(s: string) {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch
  );
}

async function ensureRosterCatalog() {
  if (!rosterCatalog) rosterCatalog = await loadCatalog();
  return rosterCatalog;
}

function renderRoster() {
  const hall = document.getElementById('rosterHall');
  const sub = document.getElementById('rosterSub');
  if (!hall) return;
  const cat = rosterCatalog;
  if (!cat) {
    hall.textContent = '名册加载中…';
    return;
  }
  const p = loadProgress();
  const total = WEEKDAYS.length * BATTLE_SLOT_IDS.length;
  let known = 0;
  hall.innerHTML = '';
  for (const day of WEEKDAYS) {
    const open = isUnlocked(day.id, p);
    for (const id of BATTLE_SLOT_IDS) {
      const look = lookForSlotOnDay(cat, day.id, id);
      const slot = rosterSlot(id);
      const card = document.createElement('div');
      card.className = 'rosterCard' + (open ? '' : ' locked');
      const name = open ? look?.label || slot?.label || id : '???';
      const thumb = look?.thumb ? assetUrl(look.thumb) : '';
      if (open) known += 1;
      card.innerHTML =
        `<div class="rosterThumb">${thumb ? `<img alt="" src="${escapeText(thumb)}">` : ''}</div>` +
        `<div class="rosterName">${escapeText(name)}</div>`;
      hall.appendChild(card);
    }
  }
  if (sub) sub.textContent = `已认识 ${known} / ${total} 个奇葩同事，通关解锁下一天的奇葩`;
}

function bindSettings() {
  const music = document.getElementById('optMusic') as HTMLInputElement;
  const sfxEl = document.getElementById('optSfx') as HTMLInputElement;
  const debug = document.getElementById('optDebug') as HTMLInputElement;
  const s = loadSettings();
  music.checked = s.music;
  sfxEl.checked = s.sfx;
  debug.checked = s.debug;
  applyDebug(s.debug);
  const persist = () => saveSettings({ music: music.checked, sfx: sfxEl.checked, debug: debug.checked });
  music.addEventListener('change', () => {
    persist();
    bgm.setEnabled(music.checked);
  });
  sfxEl.addEventListener('change', () => {
    persist();
    sfx.setEnabled(sfxEl.checked);
  });
  debug.addEventListener('change', () => {
    persist();
    applyDebug(debug.checked);
  });
  document.getElementById('optReset')!.addEventListener('click', () => {
    if (!confirm('重置后只保留周一，确定？')) return;
    resetProgress();
    renderLevels();
    renderRoster();
  });
}

function bindUiClicks() {
  const ids = new Set([
    'btnStart',
    'btnLevels',
    'btnRoster',
    'btnSettings',
    'btnLevelsBack',
    'btnRosterBack',
    'btnSettingsBack',
    'btnAvatarBack',
    'avatarGo',
    'resultNext',
    'resultRetry',
    'resultHome',
    'resetBtn',
    'optReset',
  ]);
  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement | null)?.closest('button');
    if (!btn) return;
    if (btn.classList.contains('locked')) return;
    if (ids.has(btn.id) || btn.classList.contains('avatarHit') || btn.classList.contains('levelCard')) {
      sfx.play('ui_click');
    }
  });
}

const LOSE_TAUNTS = [
  '以司为家，家没了。',
  '饼画完了，人留下了。',
  '你努力，老板改 KPI。',
  '自愿加班，自愿的是老板。',
  '不是 996，是热爱（被迫）。',
  '青春献给公司，公司写进周报。',
  '老板说我们是一家人。',
  '加班费是梦想，梦想免税。',
  '你卷赢了同事，卷输了电梯。',
  '准时下班？群里已 @你。',
  '今天也在为老板还房贷。',
  '狼性精神，羊的工时。',
  '优化不是裁员，是祝福。',
  '再改一页就能走（谎言）。',
  '努力会被看见：你还没走。',
  '公司记得工时，忘了你是人。',
];

const LOSE_TIPS = [
  '善于把同事引开，电梯更好挤哦',
  '善于墙钮亮了先离开，再靠近才开门哦',
  '善于把冲刺留给卡口，突围更快哦',
  '善于绕开主管，硬刚只会加班哦',
  '善于躲开水渍，冲刺才不滑哦',
  '善于把拦截的人遛走，路才通哦',
  '善于电梯到了先退再贴，门才开哦',
  '善于抽到技能再用，空按没有用哦',
  '善于把人群往反方向扯，侧面更好溜哦',
  '善于早点冲电梯，别磨到 24:00 哦',
  '善于在窄口挡人，自己从缝里钻哦',
  '善于冷却时先绕路，别硬撞哦',
];

/** 成功页第一行：嘲讽老板 */
const WIN_TAUNTS = [
  '老板还在改需求，人已经在路上。',
  'KPI 追不上脚步，电梯先到。',
  '加班群还在刷，我已刷卡出门。',
  '以司为家？今晚回家。',
  '饼可以留着，人必须走。',
  '你的「再改一页」到不了我这站。',
  '狼性留给明天，今晚准点溜。',
  '周报可以等，晚饭不等。',
  '老板说一家人，我先回自己家。',
  '志愿加班？志愿下班。',
  '房贷你还，我先下班。',
  '看见努力了吗：人已经走了。',
  '工时记得清楚，我也记得门禁。',
  '优化祝福留给你，准点留给自己。',
  '996 热爱结束，18:00 开溜。',
  '群里 @ 我？电梯里没信号。',
];

/** 成功页第二行：给打工人的温暖建议 */
const WIN_TIPS = [
  '好好吃饭，别用咖啡代替晚饭哦',
  '早点睡，明天的自己会谢谢你哦',
  '路上别急，安全到家最要紧哦',
  '周末留一点空白，给自己喘口气哦',
  '身体比周报重要，难受就休息哦',
  '下班后别刷消息，先放下手机哦',
  '记得喝水，别把嗓子留给开会哦',
  '和喜欢的人说说话，别一个人硬扛哦',
  '小确幸也要收着，生活不只工位哦',
  '准点走不是偷懒，是爱惜自己哦',
  '明天还会来，今晚先对自己好一点哦',
  '走慢一点也没关系，你已经很努力了哦',
];

const LOSE_TAUNT_STORE = 'loseTaunt.i';
const LOSE_TIP_STORE = 'loseTip.i';
const WIN_TAUNT_STORE = 'winTaunt.i';
const WIN_TIP_STORE = 'winTip.i';
const FINALE_TAUNT_STORE = 'finaleTaunt.i';
const FINALE_TIP_STORE = 'finaleTip.i';

/** 大结局副标题：周末祝福，带点打工人梗 */
const FINALE_TAUNTS = [
  '本周 KPI 已结案，周末只对枕头负责。',
  '群已免打扰，世界先自行闭环。',
  '老板的「很快」到不了周六。',
  '周一的我还没入职，先享受失业 48 小时。',
  '工位已下线，人设切换成沙发生物。',
  '加班申请已自动驳回：理由是周末。',
  '周报可以躺平，人也行。',
  '电梯到家了，需求还在排队。',
  '打工人下线，干饭人上线。',
  '公司放假，良心也放假。',
  '闹钟已批准年假：到周一。',
  '会议纪要：周末无事发生。',
];

/** 大结局建议：热爱生活，别把周末也交给工位 */
const FINALE_TIPS = [
  '出门晒会儿太阳，别把周末也交给屏幕哦',
  '吃顿热的，别用泡面给周五庆功哦',
  '约个人走走，沙发以外也有生活哦',
  '睡到自然醒，补回本周欠自己的觉哦',
  '未读消息先放着，先对自己好一点哦',
  '做点没用的事，周末不靠产出证明自己哦',
  '去吹吹风，工位外的空气也认识你哦',
  '把运动服找出来，哪怕只走两站路哦',
  '给喜欢的人发条消息，别只回已读哦',
  '收拾一角房间，生活会回你一点秩序哦',
  '周末留白，别把日历填得比工作日还满哦',
  '好好吃饭好好笑，热爱从准点下班开始哦',
];

function nextFromPool(pool: readonly string[], store: string) {
  let last = -1;
  try {
    last = Number(sessionStorage.getItem(store) ?? '-1');
    if (!Number.isFinite(last)) last = -1;
  } catch {
    last = -1;
  }
  let i = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && i === last) i = (i + 1) % pool.length;
  try {
    sessionStorage.setItem(store, String(i));
  } catch {
    /* ignore */
  }
  return pool[i]!;
}

function nextLoseTaunt() {
  return nextFromPool(LOSE_TAUNTS, LOSE_TAUNT_STORE);
}

function nextLoseTip() {
  return `建议：${nextFromPool(LOSE_TIPS, LOSE_TIP_STORE)}`;
}

function nextWinTaunt() {
  return nextFromPool(WIN_TAUNTS, WIN_TAUNT_STORE);
}

function nextWinTip() {
  return `建议：${nextFromPool(WIN_TIPS, WIN_TIP_STORE)}`;
}

function nextFinaleTaunt() {
  return nextFromPool(FINALE_TAUNTS, FINALE_TAUNT_STORE);
}

function nextFinaleTip() {
  return `建议：${nextFromPool(FINALE_TIPS, FINALE_TIP_STORE)}`;
}

function playResultIn() {
  const overlay = document.getElementById('overlay')!;
  overlay.classList.remove('is-play');
  void overlay.offsetWidth;
  overlay.classList.add('is-play');
}

function resultArtFile(kind: 'won' | 'lost' | 'finale', player: PlayerSlotId) {
  const female = player === 'player-f';
  if (kind === 'finale') return female ? 'result-finale-f.png' : 'result-finale.png';
  if (kind === 'won') return female ? 'result-win-f.png' : 'result-win.png';
  return female ? 'result-lose-f.png' : 'result-lose.png';
}

const prefetchedResultArt = new Set<string>();

/** 进关时把这一角色会用到的结算图先下好，结算音就能和画面同一帧出来。 */
export function prefetchResultArt(player: PlayerSlotId, day: WeekdayId) {
  const kinds: Array<'won' | 'lost' | 'finale'> = ['won', 'lost'];
  if (day === 'friday') kinds.push('finale');
  for (const kind of kinds) {
    const url = assetUrl(`ui/${resultArtFile(kind, player)}`);
    if (prefetchedResultArt.has(url)) continue;
    prefetchedResultArt.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  }
}

export function showResult(
  kind: 'won' | 'lost',
  day: WeekdayId,
  sub: string,
  player: PlayerSlotId = loadPlayerSlot(),
  clockMin?: number
) {
  const overlay = document.getElementById('overlay')!;
  const stamp = overlay.querySelector('.resultStampMark')!;
  const title = overlay.querySelector('.otitle')!;
  const taunt = overlay.querySelector('.resultTaunt')!;
  const tip = overlay.querySelector('.resultTip')!;
  const body = overlay.querySelector('.osub')!;
  const art = overlay.querySelector<HTMLImageElement>('.resultArt');
  const nextBtn = document.getElementById('resultNext') as HTMLButtonElement;
  const retryBtn = document.getElementById('resultRetry') as HTMLButtonElement;

  const finale = kind === 'won' && !nextWeekday(day);
  const view = finale ? 'finale' : kind;

  // 先写好 kind / 文案，但等结算图就绪再露出来，避免默认失败图闪一下
  overlay.dataset.kind = view;
  overlay.dataset.player = player;
  stamp.textContent = finale ? '周末快乐' : kind === 'won' ? '成功下班' : '下班失败';
  title.textContent = finale ? '周末快乐！' : kind === 'won' ? '成功下班！' : '今晚走不了了…';
  if (kind === 'lost') {
    taunt.textContent = nextLoseTaunt();
    tip.textContent = nextLoseTip();
  } else if (finale) {
    taunt.textContent = nextFinaleTaunt();
    tip.textContent = nextFinaleTip();
  } else {
    taunt.textContent = nextWinTaunt();
    tip.textContent = nextWinTip();
  }
  body.innerHTML = sub;
  retryBtn.style.display = '';
  nextBtn.style.display = '';

  if (kind === 'won') {
    const nxt = clockMin != null ? recordBest(day, clockMin) : markBeaten(day);
    if (finale || !nxt) {
      nextBtn.style.display = 'none';
    } else {
      nextBtn.setAttribute('aria-label', `下一关 · ${weekdaySlot(nxt)?.label ?? ''}`);
      nextBtn.onclick = () => confirmPlay(nxt, player);
    }
  } else {
    retryBtn.onclick = () => confirmPlay(day, player);
  }

  const reveal = () => {
    sfx.playResult(kind);
    setMode('result');
    playResultIn();
  };

  if (!art) {
    reveal();
    return;
  }

  const file = resultArtFile(view, player);
  const next = assetUrl(`ui/${file}`);
  const already =
    art.complete &&
    art.naturalWidth > 0 &&
    (art.currentSrc.endsWith(file) || art.getAttribute('src') === next);

  if (already) {
    art.style.opacity = '1';
    reveal();
    return;
  }

  art.style.opacity = '0';
  const done = () => {
    art.onload = null;
    art.onerror = null;
    art.style.opacity = '1';
    reveal();
  };
  art.onload = done;
  art.onerror = done;
  art.src = next;
  if (art.complete && art.naturalWidth > 0) done();
}

export function initShell() {
  applyDebug(loadSettings().debug);
  bindArtSlots();
  bindAvatarUi();
  bindLevelsScroll();
  bindRosterScroll();
  renderLevels();
  bindSettings();
  bindUiClicks();

  document.getElementById('btnStart')!.addEventListener('click', () => askAvatar(continueDay(), 'home'));
  document.getElementById('btnLevels')!.addEventListener('click', () => openLevels());
  document.getElementById('btnRoster')!.addEventListener('click', () => openRoster());
  document.getElementById('btnSettings')!.addEventListener('click', () => setMode('settings'));
  document.getElementById('btnLevelsBack')!.addEventListener('click', () => {
    resetLevelsScroll?.();
    setMode('home');
  });
  document.getElementById('btnRosterBack')!.addEventListener('click', () => {
    resetRosterScroll?.();
    setMode('home');
  });
  document.getElementById('btnSettingsBack')!.addEventListener('click', () => setMode('home'));
  void ensureRosterCatalog().then(renderRoster);
  document.getElementById('btnAvatarBack')!.addEventListener('click', () => setMode(pendingBack));
  document.getElementById('resultHome')!.addEventListener('click', () => goHome());
  document.getElementById('resetBtn')!.addEventListener('click', () => goHome());
}

export function wantsAutoPlay(): { day: WeekdayId; player: PlayerSlotId } | null {
  const q = new URLSearchParams(location.search);
  if (q.get('play') === '1') {
    const day = weekdaySlot(q.get('day') ?? '')?.id ?? continueDay();
    const qPlayer = q.get('player');
    const player = isPlayerSlotId(qPlayer) ? qPlayer : loadPlayerSlot();
    if (!isUnlocked(day)) return { day: continueDay(), player };
    return { day, player };
  }
  return null;
}

export { homeBackdropDay, lastPlayedDay } from './progress';
