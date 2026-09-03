import * as THREE from 'three/webgpu';
import {
  applyHaloStyle,
  CROWD_ACTOR_IDS,
  DEFAULT_FX,
  dashReactDefaults,
  dashReactOf,
  fx,
  getPath,
  HALO_STYLE_META,
  hexColor,
  loadFxCatalog,
  parseHex,
  playerRingFx,
  replaceFx,
  resetFx,
  setPath,
  type CrowdActorId,
  type DashKey,
  type DashReactKind,
  type HaloStyle,
  type Lv,
} from '../../../src/fx/catalog';
import { loadCatalog } from '../../../src/catalog';
import { WEEKDAYS } from '../../../src/levels';
import { loadHumanoidKit } from '../../../src/game/humanoid';
import { initPhysics } from '../../../src/sim/physics';
import { FxPreview, type PlayKind } from './preview';
import { TRACKS, ACTORS, actorSections, dashReactFields, fieldSections, type Field, type TrackDef, type TrackId } from './schema';
import type { ActorId } from '../../../src/fx/catalog';

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

function trackOf(id: TrackId): TrackDef {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0]!;
}

function playKindOf(id: TrackId): PlayKind {
  if (id === 'common') return 'common';
  if (id === 'decoy') return 'decoy';
  if (id === 'keyboard') return 'keyboard';
  if (id === 'coffee') return 'coffee';
  return 'dash';
}

function syncPreview() {
  const t = trackOf(selected);
  preview.track = selected;
  preview.skillLv = t.hasLevel ? level : 1;
  preview.actorEdit = selectedActor !== null;
  if (selectedActor) preview.actorId = selectedActor;
  preview.refreshOvertime();
}

function playCurrent() {
  syncPreview();
  if (selectedActor) {
    preview.start('actor');
    return;
  }
  preview.start(playKindOf(selected));
}

function renderCast() {
  const box = $('castList');
  box.innerHTML = '';
  for (const a of ACTORS) {
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
  };
  for (const e of TRACKS) {
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

function renderDashTabs(show: boolean) {
  const tabs = $('panelTabs');
  tabs.style.display = show ? 'flex' : 'none';
  $('tabOverall').classList.toggle('active', panelTab === 'overall');
  $('tabReact').classList.toggle('active', panelTab === 'react');
}

function renderReactTab(line: DashKey, lv: Lv, box: HTMLElement) {
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = '这里只选调用哪种状态、打多狠、持续多久。金星/雾圈/纸雾在左侧点对应角色编。';
  box.appendChild(hint);
  const pack = fx().lines[line][lv];
  for (const id of CROWD_ACTOR_IDS) {
    const def = ACTORS.find((a) => a.id === id);
    const card = document.createElement('div');
    card.className = 'reactCard';
    const h = document.createElement('h3');
    h.className = 'sec';
    h.innerHTML = `${def?.name ?? id}<span class="tag">${def?.tag ?? ''}</span>`;
    card.appendChild(h);
    const kind = dashReactOf(pack, id).kind;
    for (const f of dashReactFields(line, lv, id as CrowdActorId, kind)) renderField(f, card);
    box.appendChild(card);
  }
}

function renderFields() {
  const box = $('fields');
  box.innerHTML = '';
  if (selectedActor) {
    renderDashTabs(false);
    const def = ACTORS.find((a) => a.id === selectedActor)!;
    $('fxTitle').textContent = def.name;
    $('fxBlurb').textContent = def.blurb;
    if (selectedActor === 'player') renderHaloStyles(box);
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
  const isDash = def.group === 'dash';
  renderDashTabs(isDash);
  if (isDash && panelTab === 'react') {
    renderReactTab(def.id as DashKey, lv, box);
    return;
  }
  for (const sec of fieldSections(def, lv)) {
    const h = document.createElement('h3');
    h.className = 'sec';
    h.textContent = sec.title;
    box.appendChild(h);
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
  });
  $('btnRunPose').addEventListener('click', () => {
    preview.castState = 'run';
    $('btnRunPose').classList.add('active');
    $('btnIdle').classList.remove('active');
  });
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
  const catalog = await loadCatalog();
  if (!alive()) return;
  const day = WEEKDAYS.find((d) => d.id === catalog.active);
  $('castDay').textContent = `当前关：${day?.label ?? catalog.active}`;
  setLoading('加载战场角色…', 'kit / 皮肤 / idle·run 与游戏同一套，不进对外包体');
  const kit = await loadHumanoidKit();
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
    if (i < 1 || i > TRACKS.length) return;
    const t = TRACKS[i - 1];
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

  $('loading').style.display = 'none';
  renderer.setAnimationLoop((t: number) => preview.tick(t));
}

boot().catch((err) => {
  $('loading').innerHTML = `<div>启动失败</div><div class="hint">${err instanceof Error ? err.message : String(err)}</div>`;
});
