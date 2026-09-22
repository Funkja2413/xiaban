import * as THREE from 'three/webgpu';
import {
  applyHaloStyle,
  DEFAULT_FX,
  dashReactDefaults,
  dashReactOf,
  fx,
  getPath,
  HALO_STYLE_META,
  HIT_BURST_META,
  hexColor,
  loadFxCatalog,
  normalizeThrowGlowStyle,
  parseHex,
  playerRingFx,
  replaceFx,
  resetFx,
  setPath,
  THROW_GLOW_STYLE_META,
  type ActorId,
  type CrowdActorId,
  type DashKey,
  type DashReactKind,
  type HaloStyle,
  type Lv,
  type SkillKey,
  type ThrowGlowStyle,
} from '../../../src/fx/catalog';
import { bustCatalogAssets, catalogLookStamp, ENEMY_SKILL_META, loadCatalog, lookForSlotOnDay, type ColleagueCatalog, type EnemySkillId } from '../../../src/catalog';
import { loadLevelCatalog, WEEKDAYS, type LevelCatalog, type WeekdayId } from '../../../src/levels';
import { dayKitHint, dayKitMeta, dayPlayKit, type DayPlayKit } from '../../../src/fx/days';
import { loadHumanoidKit } from '../../../src/game/humanoid';
import { preloadThrowSkins } from '../../../src/game/skillProjectiles';
import { preloadDecoyScarecrow } from '../../../src/game/decoyGhost';
import { preloadSlickProps } from '../../../src/game/slicks';
import { initPhysics } from '../../../src/sim/physics';
import { FxPreview, type PlayKind } from './preview';
import { TRACKS, ACTORS, actorSections, dashReactFields, enemySkillSections, fieldSections, isCrowdActor, reactLookSections, skillReactLookSections, tracksForDay, type Field, type FieldSection, type TrackDef, type TrackId } from './schema';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function toast(msg: string) {
  const el = $('toast');
  el.textContent = msg;
  el.style.display = 'block';
  window.clearTimeout((el as HTMLElement & { t?: number }).t);
  (el as HTMLElement & { t?: number }).t = window.setTimeout(() => {
    el.style.display = 'none';
  }, 2200);
}

let selected: TrackId = 'common';
let selectedActor: ActorId | null = null;
let level: Lv = 1;
let panelTab: 'overall' | 'react' = 'overall';
let preview: FxPreview;
let currentDay: WeekdayId = 'monday';
let colleagueCat: ColleagueCatalog;
let levelCat: LevelCatalog;
let lookStamp = '';
let rosterBusy = false;
let bakedDay: WeekdayId | null = null;
let wantLooks: WeekdayId | null = null;

function kitOf(day = currentDay): DayPlayKit {
  return dayPlayKit(day, colleagueCat, levelCat);
}

function visibleTracks() {
  return tracksForDay(kitOf());
}

function trackOf(id: TrackId): TrackDef {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0]!;
}

function ensureSelection() {
  const tracks = visibleTracks();
  if (selectedActor) return;
  if (tracks.some((t) => t.id === selected)) return;
  selected = tracks[0]?.id ?? 'common';
  if (!trackOf(selected).hasLevel) level = 1;
}

function playKindOf(id: TrackId): PlayKind {
  if (id === 'common') return 'common';
  if (id === 'decoy') return 'decoy';
  if (id === 'keyboard') return 'keyboard';
  if (id === 'coffee') return 'coffee';
  if (id === 'hazards' || id === 'enemySkills') return 'common';
  return 'dash';
}

function syncPreview() {
  const t = trackOf(selected);
  preview.track = selected;
  preview.day = currentDay;
  preview.skillLv = t.hasLevel ? level : 1;
  preview.actorEdit = selectedActor !== null;
  preview.actorSkill = actorSkillOf(selectedActor);
  if (selectedActor) preview.actorId = selectedActor;
  preview.refreshOvertime();
  preview.applyActorLayout();
  if (selectedActor === null && selected === 'keyboard') preview.refreshThrowLook();
  if (selectedActor === null && selected === 'coffee') preview.refreshCoffeeLook();
  if (selectedActor === null && selected === 'decoy') preview.refreshDecoyLook();
}

function playCurrent() {
  syncPreview();
  if (selectedActor) {
    preview.start('actor');
    return;
  }
  preview.start(playKindOf(selected));
}

function actorsForDay() {
  return ACTORS.map((a) => {
    const look = lookForSlotOnDay(colleagueCat, currentDay, a.id);
    if (a.id === 'player') return a;
    const skill = look?.enemySkill ?? null;
    return {
      ...a,
      name: look?.label || a.name,
      tag: skill ? ENEMY_SKILL_META[skill].name : '无技能',
    };
  });
}

function actorSkillOf(id: ActorId | null): EnemySkillId | null {
  if (!id || id === 'player') return null;
  return lookForSlotOnDay(colleagueCat, currentDay, id)?.enemySkill ?? null;
}

function renderDays() {
  const box = $('dayList');
  box.innerHTML = WEEKDAYS.map((s) => {
    const kit = kitOf(s.id);
    const on = currentDay === s.id ? 'on' : '';
    const tag = kit.inherited
      ? '<span class="tag wait">沿用周一</span>'
      : '<span class="tag ok">本关</span>';
    return `<button type="button" class="item ${on}" data-id="${s.id}"><div><div>${s.label}</div><div class="meta">${dayKitMeta(kit)}</div></div>${tag}</button>`;
  }).join('');
  box.querySelectorAll<HTMLButtonElement>('.item').forEach((el) => {
    el.addEventListener('click', () => switchDay(el.dataset.id as WeekdayId));
  });
  $('dayKitHint').textContent = dayKitHint(kitOf());
}

function switchDay(id: WeekdayId) {
  if (!id || id === currentDay) return;
  currentDay = id;
  ensureSelection();
  renderDays();
  renderList();
  renderCast();
  renderLevel();
  renderFields();
  syncPreview();
  const label = WEEKDAYS.find((d) => d.id === currentDay)?.label ?? currentDay;
  toast(`正在编 ${label}`);
  void applyDayLooks();
}

function renderCast() {
  const box = $('castList');
  box.innerHTML = '';
  for (const a of actorsForDay()) {
    const btn = document.createElement('button');
    btn.className = `item${selectedActor === a.id ? ' on' : ''}`;
    btn.innerHTML = `<span>${a.name}</span><span class="tag">${a.tag}</span>`;
    btn.addEventListener('click', () => {
      selectedActor = a.id;
      renderList();
      renderCast();
      renderLevel();
      renderFields();
      syncPreview();
    });
    box.appendChild(btn);
  }
}

function renderList() {
  const box = $('fxList');
  box.innerHTML = '';
  let lastGroup = '';
  const groupLabel: Record<TrackDef['group'], string> = {
    common: '场景',
    dash: '冲刺属性',
    skill: '主动技能',
    hazard: '陷阱',
    enemy: '同事主动',
  };
  for (const e of visibleTracks()) {
    if (e.group !== lastGroup) {
      lastGroup = e.group;
      const h = document.createElement('div');
      h.className = 'group';
      h.textContent = groupLabel[e.group];
      box.appendChild(h);
    }
    const btn = document.createElement('button');
    btn.className = `item${selectedActor === null && e.id === selected ? ' on' : ''}`;
    btn.innerHTML = `<span>${e.name}</span><span class="tag">${e.tag}</span>`;
    btn.addEventListener('click', () => {
      selectedActor = null;
      selected = e.id;
      if (!e.hasLevel) level = 1;
      renderList();
      renderCast();
      renderLevel();
      renderFields();
      syncPreview();
    });
    box.appendChild(btn);
  }
}

function renderLevel() {
  const t = trackOf(selected);
  const show = selectedActor === null && t.hasLevel;
  $('lvHead').style.display = show ? '' : 'none';
  $('lvRow').style.display = show ? 'flex' : 'none';
  for (const n of [1, 2, 3] as const) {
    $(`btnLv${n}`).classList.toggle('active', n === level);
  }
}

function renderField(f: Field, box: HTMLElement) {
  const val = getPath(fx(), f.path);
  if (f.kind === 'color') {
    const lab = document.createElement('label');
    lab.className = 'field';
    lab.innerHTML = `${f.label}<input type="color" value="${hexColor(Number(val) || 0)}">`;
    lab.querySelector('input')!.addEventListener('input', (ev) => {
      setPath(fx() as unknown as Record<string, unknown>, f.path, parseHex((ev.target as HTMLInputElement).value));
      schedulePush();
    });
    box.appendChild(lab);
    return;
  }
  if (f.kind === 'select') {
    const lab = document.createElement('label');
    lab.className = 'field';
    const opts = (f.options ?? [])
      .map((o) => `<option value="${o.id}" ${String(val) === o.id ? 'selected' : ''}>${o.name}</option>`)
      .join('');
    lab.innerHTML = `${f.label}<select>${opts}</select>`;
    lab.querySelector('select')!.addEventListener('change', (ev) => {
      const next = (ev.target as HTMLSelectElement).value;
      if (f.path.endsWith('.kind') && f.path.includes('.react.')) {
        setPath(fx() as unknown as Record<string, unknown>, f.path.replace(/\.kind$/, ''), dashReactDefaults(next as DashReactKind));
      } else {
        setPath(fx() as unknown as Record<string, unknown>, f.path, next);
      }
      renderFields();
      schedulePush();
    });
    box.appendChild(lab);
    if (f.hint) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = f.hint;
      box.appendChild(hint);
    }
    return;
  }
  if (f.kind === 'bool') {
    const lab = document.createElement('label');
    lab.className = 'check';
    lab.innerHTML = `<input type="checkbox" ${val ? 'checked' : ''}> ${f.label}`;
    lab.querySelector('input')!.addEventListener('change', (ev) => {
      setPath(fx() as unknown as Record<string, unknown>, f.path, (ev.target as HTMLInputElement).checked);
      schedulePush();
    });
    box.appendChild(lab);
    if (f.hint) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = f.hint;
      box.appendChild(hint);
    }
    return;
  }
  const row = document.createElement('label');
  row.className = 'slider';
  const num = Number(val) || 0;
  const min = f.min ?? 0;
  const max = f.max ?? 1;
  const step = f.step ?? 0.01;
  row.innerHTML = `${f.label}<input type="range" min="${min}" max="${max}" step="${step}" value="${num}"><span class="v">${fmt(num, f.kind === 'int')}</span>`;
  const input = row.querySelector('input')!;
  const lab = row.querySelector('.v')!;
  input.addEventListener('input', () => {
    const n = f.kind === 'int' ? Math.round(Number(input.value)) : Number(input.value);
    setPath(fx() as unknown as Record<string, unknown>, f.path, n);
    lab.textContent = fmt(n, f.kind === 'int');
    schedulePush();
  });
  box.appendChild(row);
  if (f.hint) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = f.hint;
    box.appendChild(hint);
  }
}

function renderThrowGlowStyles(box: HTMLElement, path = `skills.keyboard.${level}.keyboard.glowStyle`) {
  const cur = normalizeThrowGlowStyle(getPath(fx(), path));
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = '光晕样式（只改当前 LV；软边贴图，几乎不占性能）。';
  box.appendChild(hint);
  const row = document.createElement('div');
  row.className = 'styleRow';
  for (const s of THROW_GLOW_STYLE_META) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cur === s.id ? 'active' : '';
    btn.innerHTML = `<b>${s.name}</b><span>${s.blurb}</span>`;
    btn.addEventListener('click', () => {
      setPath(fx() as unknown as Record<string, unknown>, path, s.id as ThrowGlowStyle);
      renderFields();
      schedulePush();
    });
    row.appendChild(btn);
  }
  box.appendChild(row);
}

function renderHaloStyles(box: HTMLElement) {
  const h = document.createElement('h3');
  h.className = 'sec';
  h.textContent = '基础样式';
  box.appendChild(h);
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = '先选一种圆环，再改内环 / 外环细节。换样式会重摆两圈的半径和模糊，颜色和闪烁会留着。';
  box.appendChild(hint);
  const row = document.createElement('div');
  row.className = 'styleRow';
  const cur = playerRingFx().style;
  for (const s of HALO_STYLE_META) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cur === s.id ? 'active' : '';
    btn.innerHTML = `<b>${s.name}</b><span>${s.blurb}</span>`;
    btn.addEventListener('click', () => {
      applyHaloStyle(s.id as HaloStyle);
      renderFields();
      schedulePush();
    });
    row.appendChild(btn);
  }
  box.appendChild(row);
}

function crowdActorsForDay() {
  return actorsForDay().filter((a): a is (typeof a & { id: CrowdActorId }) => isCrowdActor(a.id));
}

function renderPanelTabs(show: boolean) {
  const tabs = $('panelTabs');
  tabs.style.display = show ? 'flex' : 'none';
  $('tabOverall').classList.toggle('active', panelTab === 'overall');
  $('tabReact').classList.toggle('active', panelTab === 'react');
}

function appendSections(secs: FieldSection[], box: HTMLElement) {
  for (const sec of secs) {
    const h = document.createElement('h3');
    h.className = 'sec';
    h.textContent = sec.title;
    box.appendChild(h);
    for (const f of sec.fields) renderField(f, box);
  }
}

function renderDashReactTab(line: DashKey, lv: Lv, box: HTMLElement) {
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    '按本关战场角色分类：先选被撞后进入哪种状态、打多狠；下面直接编该状态的样子（纸雾 / 金星 / 雾圈）。角色通用栏只留文件卡和飘字。';
  box.appendChild(hint);
  const pack = fx().lines[line][lv];
  for (const a of crowdActorsForDay()) {
    const id = a.id;
    const card = document.createElement('div');
    card.className = 'reactCard';
    const h = document.createElement('h3');
    h.className = 'sec';
    h.innerHTML = `${a.name}<span class="tag">${a.tag}</span>`;
    card.appendChild(h);
    // 编辑用存档 kind；dashReactOf 会对拦路虎把倒地/推开收成「无+弹开」，不能拿来画表单
    const kind = (pack.react?.[id]?.kind ?? dashReactOf(pack, id).kind) as DashReactKind;
    for (const f of dashReactFields(line, lv, id, kind)) renderField(f, card);
    if (id === 'interceptor' && (kind === 'knock' || kind === 'shove')) {
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = '玩法：前台拦路虎撞不开，冲刺到他会当成「无 + 弹开玩家」。减速/眩晕仍按下面生效。';
      card.appendChild(note);
    }
    appendSections(reactLookSections(id, kind), card);
    box.appendChild(card);
  }
}

function skillHitBurstField(skill: 'keyboard' | 'decoy', lv: Lv): Field {
  return {
    path: `skills.${skill}.${lv}.${skill}.hitBurst`,
    label: `LV${lv} 倒地爆开`,
    kind: 'select',
    options: HIT_BURST_META.map((m) => ({ id: m.id, name: `${m.name} · ${m.blurb}` })),
    hint: `只影响本技能 LV${lv}。切上方 LV1/2/3 可分别设；游戏放倒时用当前技能等级这份，盖过角色默认爆开样式。下面各角色卡只编粒子颜色/数量/气雾。`,
  };
}

function renderSkillReactTab(skill: SkillKey, lv: Lv, box: HTMLElement) {
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    skill === 'coffee'
      ? '按本关角色编踩上污渍后的减速雾圈样子。判定半径/时长在「整体」。'
      : '上方按技能等级选倒地爆开样式（LV1/2/3 各自一份）。下面各角色只调粒子颜色、数量和气雾，不改爆开种类。';
  box.appendChild(hint);
  if (skill === 'keyboard' || skill === 'decoy') {
    renderField(skillHitBurstField(skill, lv), box);
  }
  for (const a of crowdActorsForDay()) {
    const card = document.createElement('div');
    card.className = 'reactCard';
    const h = document.createElement('h3');
    h.className = 'sec';
    h.innerHTML = `${a.name}<span class="tag">${a.tag}</span>`;
    card.appendChild(h);
    appendSections(skillReactLookSections(skill, a.id), card);
    box.appendChild(card);
  }
}

function renderFields() {
  const box = $('fields');
  box.innerHTML = '';
  if (selectedActor) {
    renderPanelTabs(false);
    const def = actorsForDay().find((a) => a.id === selectedActor) ?? ACTORS.find((a) => a.id === selectedActor)!;
    const skill = actorSkillOf(selectedActor);
    $('fxTitle').textContent = skill ? `${def.name} · ${ENEMY_SKILL_META[skill].name}` : def.name;
    $('fxBlurb').textContent = skill
      ? `这一关挂上的主动技能在下面。再往下是通用：头顶文件、交任务飘字。倒地/眩晕/减速改到左侧对应冲刺或技能的「角色反馈」。`
      : def.blurb;
    if (selectedActor === 'player') renderHaloStyles(box);
    if (skill) {
      const head = document.createElement('h3');
      head.className = 'sec';
      head.textContent = `主动技能 · ${ENEMY_SKILL_META[skill].name}`;
      box.appendChild(head);
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = `${ENEMY_SKILL_META[skill].hint}。身体仍是待机/跑步，特效在身外。`;
      box.appendChild(hint);
      for (const sec of enemySkillSections(skill)) {
        const h = document.createElement('h3');
        h.className = 'sec';
        h.textContent = sec.title;
        box.appendChild(h);
        for (const f of sec.fields) renderField(f, box);
      }
    }
    if (skill && selectedActor !== 'player') {
      const pass = document.createElement('h3');
      pass.className = 'sec';
      pass.textContent = '通用效果';
      box.appendChild(pass);
    }
    for (const sec of actorSections(selectedActor)) {
      const h = document.createElement('h3');
      h.className = 'sec';
      h.textContent = sec.title;
      box.appendChild(h);
      for (const f of sec.fields) renderField(f, box);
    }
    return;
  }
  const def = trackOf(selected);
  const lv = def.hasLevel ? level : 1;
  $('fxTitle').textContent = def.hasLevel ? `${def.name} · LV${lv}` : def.name;
  $('fxBlurb').textContent = def.blurb;
  const showReact = def.group === 'dash' || def.group === 'skill';
  renderPanelTabs(showReact);
  if (showReact && panelTab === 'react') {
    if (def.group === 'dash') renderDashReactTab(def.id as DashKey, lv, box);
    else renderSkillReactTab(def.id as SkillKey, lv, box);
    return;
  }
  for (const sec of fieldSections(def, lv, kitOf())) {
    const h = document.createElement('h3');
    h.className = 'sec';
    h.textContent = sec.title;
    box.appendChild(h);
    if (def.id === 'keyboard' && sec.title.startsWith('飞出物样子')) renderThrowGlowStyles(box);
    if (def.id === 'decoy' && sec.title.startsWith('分身样子')) {
      renderThrowGlowStyles(box, `skills.decoy.${lv}.decoy.glowStyle`);
    }
    for (const f of sec.fields) renderField(f, box);
  }
}

function fmt(n: number, asInt: boolean) {
  return asInt ? String(Math.round(n)) : Number.isInteger(n) ? String(n) : n.toFixed(2);
}

let pushTimer = 0;
let pushing = false;

function schedulePush() {
  preview.refreshOvertime();
  if (selected === 'keyboard') preview.refreshThrowLook();
  if (selected === 'coffee') preview.refreshCoffeeLook();
  if (selected === 'decoy') preview.refreshDecoyLook();
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    void pushToBattle(true);
  }, 180);
}

async function persistCatalog() {
  const res = await fetch('/__fx/catalog', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fx(), null, 2),
  });
  if (!res.ok) throw new Error('save failed');
}

async function pushLive() {
  try {
    const res = await fetch('http://localhost:5173/__fx/push', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fx()),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function pushToBattle(quiet: boolean) {
  if (pushing) {
    schedulePush();
    return;
  }
  pushing = true;
  try {
    await persistCatalog();
    const live = await pushLive();
    if (!quiet) toast(live ? '已送进战场' : '已写入 catalog，打开游戏页后立刻生效');
  } catch {
    toast('送进战场失败');
  } finally {
    pushing = false;
  }
}

async function save() {
  await pushToBattle(false);
}

function bindLevel() {
  for (const lv of [1, 2, 3] as const) {
    $(`btnLv${lv}`).addEventListener('click', () => {
      if (!trackOf(selected).hasLevel) return;
      level = lv;
      renderLevel();
      renderFields();
      syncPreview();
    });
  }
}

function bindPose() {
  $('btnIdle').addEventListener('click', () => {
    preview.castState = 'idle';
    $('btnIdle').classList.add('active');
    $('btnRunPose').classList.remove('active');
    if (selected === 'decoy') preview.refreshDecoyLook();
  });
  $('btnRunPose').addEventListener('click', () => {
    preview.castState = 'run';
    $('btnRunPose').classList.add('active');
    $('btnIdle').classList.remove('active');
    if (selected === 'decoy') preview.refreshDecoyLook();
  });
  const crowd = $('crowdCount') as HTMLInputElement;
  const crowdV = $('crowdCountV');
  const syncCrowd = () => {
    const n = Math.round(Number(crowd.value));
    crowdV.textContent = String(n);
    preview.setCrowdCount(n);
  };
  crowd.addEventListener('input', syncCrowd);
}

function setLoading(title: string, hint?: string) {
  const el = $('loading');
  const lines = el.querySelectorAll('div');
  if (lines[0]) lines[0].textContent = title;
  if (hint && lines[1]) lines[1].textContent = hint;
}

async function makePreviewRenderer() {
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  const ok = await Promise.race([
    renderer.init().then(() => true),
    new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 4000)),
  ]);
  if (!ok) throw new Error('预览画布初始化超时，请硬刷新或用 Chrome 打开本页');
  return renderer;
}

let bootGen = 0;

async function boot() {
  const gen = ++bootGen;
  const alive = () => gen === bootGen;
  setLoading('读取特效目录…');
  await loadFxCatalog('/fx/catalog.json');
  if (!alive()) return;
  setLoading('读取角色清单…');
  colleagueCat = await loadCatalog();
  if (!alive()) return;
  setLoading('读取关卡清单…');
  levelCat = await loadLevelCatalog();
  if (!alive()) return;
  currentDay = WEEKDAYS.some((d) => d.id === colleagueCat.active) ? colleagueCat.active : 'monday';
  ensureSelection();
  setLoading('加载战场角色…', 'kit / 皮肤 / idle·run 与游戏同一套，不进对外包体');
  const kit = await loadHumanoidKit('player', currentDay);
  if (!alive()) return;
  await preloadThrowSkins();
  if (!alive()) return;
  await preloadSlickProps();
  if (!alive()) return;
  await preloadDecoyScarecrow();
  if (!alive()) return;
  setLoading('初始化物理…');
  const world = await initPhysics();
  if (!alive()) return;
  const host = $('viewport');
  setLoading('创建预览画布…', '编辑器走 WebGL 后端，避免 WebGPU 适配器卡住');
  const renderer = await makePreviewRenderer();
  if (!alive()) return;
  preview = new FxPreview(host, renderer, kit, world);
  preview.setStatus((s) => {
    $('status').textContent = s;
  });
  renderDays();
  renderCast();
  bindPose();

  const fit = () => preview.resize(host.clientWidth, host.clientHeight);
  fit();
  window.addEventListener('resize', fit);

  renderList();
  renderLevel();
  renderFields();
  syncPreview();
  bindLevel();
  $('tabOverall').addEventListener('click', () => {
    panelTab = 'overall';
    renderFields();
  });
  $('tabReact').addEventListener('click', () => {
    panelTab = 'react';
    renderFields();
  });

  $('btnPlay').addEventListener('click', () => playCurrent());
  $('btnReset').addEventListener('click', () => {
    resetFx();
    renderFields();
    schedulePush();
    toast('已恢复默认值并送进战场');
  });
  $('btnRevert').addEventListener('click', async () => {
    await loadFxCatalog('/fx/catalog.json');
    renderFields();
    await pushLive();
    toast('已重新载入磁盘 catalog');
  });
  $('btnSave').addEventListener('click', () => void save());
  $('btnDefaults').addEventListener('click', () => {
    replaceFx(DEFAULT_FX);
    renderFields();
    schedulePush();
    toast('已套用代码默认值并送进战场');
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      playCurrent();
      return;
    }
    const i = Number(e.code.replace('Digit', ''));
    const tracks = visibleTracks();
    if (i < 1 || i > tracks.length) return;
    const t = tracks[i - 1];
    if (!t) return;
    selectedActor = null;
    selected = t.id;
    if (!t.hasLevel) level = 1;
    renderList();
    renderCast();
    renderLevel();
    renderFields();
    playCurrent();
  });

  lookStamp = catalogLookStamp(colleagueCat);
  bakedDay = currentDay;
  watchRoster();
  $('loading').style.display = 'none';
  renderer.setAnimationLoop((t: number) => preview.tick(t));
}

async function applyDayLooks() {
  if (!preview) return;
  if (rosterBusy) {
    wantLooks = currentDay;
    return;
  }
  if (bakedDay === currentDay) return;
  rosterBusy = true;
  const label = WEEKDAYS.find((d) => d.id === currentDay)?.label ?? currentDay;
  setLoading(`换上${label}角色…`, '皮肤和挂件按这一关重烤');
  $('loading').style.display = '';
  try {
    const day = currentDay;
    const kit = await loadHumanoidKit('player', day);
    if (currentDay !== day) {
      bakedDay = null;
      return;
    }
    preview.adoptKit(kit);
    bakedDay = day;
    syncPreview();
  } catch (err) {
    console.warn('[fx-editor] day looks failed', err);
    toast('换角色失败');
  } finally {
    rosterBusy = false;
    $('loading').style.display = 'none';
    if (wantLooks && wantLooks !== bakedDay) {
      wantLooks = null;
      void applyDayLooks();
    } else {
      wantLooks = null;
    }
  }
}

async function reloadRoster(force = false) {
  if (!preview || rosterBusy) return;
  const cat = await loadCatalog();
  const stamp = catalogLookStamp(cat);
  if (!force && stamp === lookStamp) return;
  rosterBusy = true;
  try {
    lookStamp = stamp;
    colleagueCat = cat;
    bustCatalogAssets();
    const kit = await loadHumanoidKit('player', currentDay);
    preview.adoptKit(kit);
    await preview.reloadDashMounts(cat);
    bakedDay = currentDay;
    renderDays();
    renderCast();
    renderFields();
    syncPreview();
    toast('角色形象已同步');
  } catch (err) {
    console.warn('[fx-editor] roster reload failed', err);
  } finally {
    rosterBusy = false;
  }
}

function watchRoster() {
  import.meta.hot?.on('roster-catalog', () => {
    void reloadRoster(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void reloadRoster(false);
  });
  window.addEventListener('focus', () => {
    void reloadRoster(false);
  });
  window.setInterval(() => {
    if (!document.hidden) void reloadRoster(false);
  }, 2500);
}

boot().catch((err) => {
  $('loading').innerHTML = `<div>启动失败</div><div class="hint">${err instanceof Error ? err.message : String(err)}</div>`;
});
