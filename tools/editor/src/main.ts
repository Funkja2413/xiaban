import { CharacterPreview, STUDIO_PRESETS, type StudioLights } from './preview';
import { drawSkinPreview, imageFromUrl, loadSkinMap, pngBytesFromUrl, skinFromFile } from './skin';
import { HairRig, countTris, loadHairFile, loadPropFile } from './hair';
import {
  BUDGET,
  IDENTITY_TRANSFORM,
  OFFICIAL_SKINS,
  budgetReport,
  downloadJson,
  loadCatalog,
  saveAsset,
  saveCatalog,
  slug,
  upsertProp,
  upsertSkin,
  upsertVariant,
  ensureRosterLooks,
  lookForSlot,
  officialSkinForGender,
  propFitOf,
  slotSkinId,
  isOfficialSkinId,
  selectCatalogDay,
  serializeCatalog,
  type ColleagueCatalog,
} from './variants';
import { PROP_PRESETS } from './props';
import { KIT_HAIR_ALBEDO, KIT_HAIR_MAPS, KIT_HAIR_UV_ISLANDS, KIT_SKIRT_ALBEDO, KIT_SKIRT_MAPS, KIT_SKIRT_UV_ISLANDS, KIT_SKINS, KIT_UV_ISLANDS, isKitHairId, isKitSkinId, isKitSkirtId, type KitHairId, type KitSkirtId } from './kit';
import { ROSTER as ROSTER_INIT, type RosterSlot } from '../../../src/roster';
import {
  clampBodyScale,
  defaultBodyScale,
  migrateEnemySkill,
  type AttachAnchor,
  type HairTransform,
  type PropUse,
} from '../../../src/catalog';
import { isPlayerSlotId } from '../../../src/roster';
import { WEEKDAYS, type WeekdayId } from '../../../src/levels';
import { LINE_IDS, type LineId } from '../../../src/fx/catalog';
import { LINE_NAMES } from '../../../src/fx/days';
import type { DashMountSlot } from '../../../src/catalog';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function toast(msg: string) {
  const el = $('toast');
  el.textContent = msg;
  el.style.display = 'block';
  window.clearTimeout((el as HTMLElement & { t?: number }).t);
  (el as HTMLElement & { t?: number }).t = window.setTimeout(() => {
    el.style.display = 'none';
  }, 2400);
}

function num(id: string, v: number) {
  const el = $(id) as HTMLInputElement;
  const min = Number(el.min);
  const max = Number(el.max);
  const n = Number.isFinite(v) ? v : 0;
  if (Number.isFinite(min) && Number.isFinite(max)) el.value = String(Math.min(max, Math.max(min, n)));
  else el.value = String(n);
  const lab = document.querySelector(`[data-for="${id}"]`);
  if (lab) lab.textContent = n.toFixed(2);
}

function readNum(id: string): number {
  return Number(($(id) as HTMLInputElement).value) || 0;
}

function bindDrop(zone: HTMLElement, input: HTMLInputElement, onFile: (f: File) => void) {
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) onFile(f);
    input.value = '';
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const f = e.dataTransfer?.files[0];
    if (f) onFile(f);
  });
}

async function boot() {
  const preview = new CharacterPreview($('viewport'));
  await preview.load();
  $('loading').remove();
  $('status').textContent = preview.statusLine();

  const hat = new HairRig();
  const held = new HairRig();
  const back = new HairRig();
  type EditTarget = 'hat' | 'held' | 'back';
  const SLOT_OF: Record<AttachAnchor, EditTarget> = { head: 'hat', hand: 'held', back: 'back' };
  const ANCHOR_OF: Record<EditTarget, AttachAnchor> = { hat: 'head', held: 'hand', back: 'back' };
  const SLOT_LABEL: Record<EditTarget, string> = { hat: '头顶', held: '右手', back: '后背' };
  const BONE_LABEL: Record<EditTarget, string> = { hat: 'Head', held: 'RightHand', back: 'Chest' };
  const ANCHOR_LABEL: Record<AttachAnchor, string> = { head: '头顶', hand: '右手', back: '后背' };
  let editTarget: EditTarget = 'hat';
  let propAnchor: AttachAnchor = 'head';
  let catalog = await loadCatalog();
  let currentDay: WeekdayId = selectCatalogDay(catalog);
  let roster = ROSTER_INIT;
  let selectedSlot = roster[0]?.id ?? '';
  let officialSkin = OFFICIAL_SKINS[0];
  let customSkin: { id: string; file: string; map: import('three').Texture; bytes?: ArrayBuffer; name?: string } | null = null;
  let customPreviewUrl = officialSkin.file;
  let customHair: { file: string; map: import('three').Texture; bytes?: ArrayBuffer } | null = null;
  let customSkirtTex: { file: string; map: import('three').Texture; bytes?: ArrayBuffer } | null = null;
  let hairPreviewUrl = KIT_HAIR_ALBEDO;
  let skirtPreviewUrl = KIT_SKIRT_ALBEDO;
  let atlasTab: 'body' | 'hair' | 'skirt' = 'body';
  let islands = false;
  let hatBytes: ArrayBuffer | null = null;
  let hatFileName = '';
  let heldBytes: ArrayBuffer | null = null;
  let heldFileName = '';
  let backBytes: ArrayBuffer | null = null;
  let backFileName = '';
  let dashLine: LineId | null = null;
  let dashSlot: 'hand' | 'head' = 'hand';
  const mountRigs = { hand: new HairRig(), head: new HairRig() };
  const dashPropIds = { hand: '', head: '' };
  let dashToken = 0;
  let syncingInputs = false;
  let thumbNonce = 0;

  function atlasIslands() {
    if (atlasTab === 'hair') return KIT_HAIR_UV_ISLANDS;
    if (atlasTab === 'skirt') return KIT_SKIRT_UV_ISLANDS;
    return KIT_UV_ISLANDS;
  }

  function atlasPreviewUrl() {
    if (atlasTab === 'hair') return hairPreviewUrl;
    if (atlasTab === 'skirt') return skirtPreviewUrl;
    return customPreviewUrl;
  }

  async function redrawSkinView() {
    const canvas = $('skinView') as HTMLCanvasElement;
    let warn = '';
    const url = atlasPreviewUrl();
    try {
      const img = await imageFromUrl(url);
      if (img.width !== img.height) warn = `非正方形 ${img.width}×${img.height}，保存会被拒绝`;
      drawSkinPreview(canvas, img, { islands, warn: warn || undefined, islandList: atlasIslands() });
      const kind = atlasTab === 'body' ? '身体' : atlasTab === 'hair' ? '头发' : '裙子';
      $('skinInfo').textContent = `${kind} ${img.width}×${img.height}${warn ? ' · ' + warn : ''}`;
    } catch {
      drawSkinPreview(canvas, null, { islands, islandList: atlasIslands() });
      $('skinInfo').textContent = atlasTab === 'body' ? '尚未上传身体图集。' : atlasTab === 'hair' ? '头发默认棕点平铺贴图。' : '裙子默认黑裙布。';
    }
  }

  function highlightAtlasTab() {
    $('atlasTabBody').classList.toggle('active', atlasTab === 'body');
    $('atlasTabHair').classList.toggle('active', atlasTab === 'hair');
    $('atlasTabSkirt').classList.toggle('active', atlasTab === 'skirt');
    const box = $('atlasPresets');
    box.replaceChildren();
    if (atlasTab === 'hair') {
      for (const def of KIT_HAIR_MAPS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = def.label;
        btn.classList.toggle('active', (customHair?.file ?? preview.hairMapFile) === def.file);
        btn.addEventListener('click', () => void pickHairMap(def.file));
        box.appendChild(btn);
      }
    } else if (atlasTab === 'skirt') {
      for (const def of KIT_SKIRT_MAPS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = def.label;
        btn.classList.toggle('active', (customSkirtTex?.file ?? preview.skirtMapFile) === def.file);
        btn.addEventListener('click', () => void pickSkirtMap(def.file));
        box.appendChild(btn);
      }
    }
  }

  async function pickHairMap(file: string, silent = false) {
    const map = await loadSkinMap(file, false);
    customHair = { file, map };
    hairPreviewUrl = file;
    preview.setKitHairMap(map, file);
    if (atlasTab === 'hair') highlightAtlasTab();
    await redrawSkinView();
    if (!silent) toast('已换头发贴图');
  }

  async function pickSkirtMap(file: string, silent = false) {
    const map = await loadSkinMap(file, false);
    customSkirtTex = { file, map };
    skirtPreviewUrl = file;
    preview.setKitSkirtMap(map, file);
    if (atlasTab === 'skirt') highlightAtlasTab();
    await redrawSkinView();
    if (!silent) {
      if (!preview.kitSkirt) pickKitSkirt('skirt_pencil');
      toast('已换裙布');
    }
  }

  function readTransform(): HairTransform {
    return {
      position: [readNum('px'), readNum('py'), readNum('pz')],
      rotation: [readNum('rx'), readNum('ry'), readNum('rz')],
      scale: [readNum('sx') || 1, readNum('sy') || 1, readNum('sz') || 1],
    };
  }

  function writeTransform(t: HairTransform) {
    syncingInputs = true;
    num('px', t.position[0]);
    num('py', t.position[1]);
    num('pz', t.position[2]);
    num('rx', t.rotation[0]);
    num('ry', t.rotation[1]);
    num('rz', t.rotation[2]);
    num('sx', t.scale[0]);
    num('sy', t.scale[1]);
    num('sz', t.scale[2]);
    syncingInputs = false;
  }

  function writePre(e: [number, number, number]) {
    syncingInputs = true;
    num('prx', e[0]);
    num('pry', e[1]);
    num('prz', e[2]);
    syncingInputs = false;
  }

  function slotOf(id: string): RosterSlot | undefined {
    return roster.find((s) => s.id === id);
  }

  function destAssetId(slotId: string) {
    return isPlayerSlotId(slotId) ? slotSkinId(slotId) : `skin-${slotId}-${currentDay}`;
  }

  function lookMapUsedByOther(field: 'kitHairMap' | 'kitSkirtMap', file: string, slotId: string) {
    if (!file || file.startsWith('/models/kit/')) return false;
    return (catalog.days ?? []).some((d) =>
      (d.variants ?? []).some((v) => (d.id !== currentDay || v.id !== slotId) && v[field] === file)
    );
  }

  function bindSlotFields(slot: RosterSlot) {
    ($('varId') as HTMLInputElement).value = slot.id;
    ($('varGender') as HTMLInputElement).value = slot.gender;
    $('nickField').hidden = isPlayerSlotId(slot.id);
    if (!isPlayerSlotId(slot.id)) {
      const look = lookForSlot(catalog, slot.id);
      ($('varLabel') as HTMLInputElement).value = look?.label ?? slot.label;
    }
    officialSkin = slot.gender === 'female' ? OFFICIAL_SKINS[1] : OFFICIAL_SKINS[0];
    $('btnMale').classList.toggle('active', slot.gender === 'male');
    $('btnFemale').classList.toggle('active', slot.gender === 'female');
    preview.setOfficialSkin(officialSkin.id);
    $('slotInfo').textContent = `${slot.label} · ${slot.blurb}`;
  }

  function refreshBudget() {
    const b = budgetReport(catalog);
    const el = $('budget');
    el.classList.toggle('over', b.over);
    el.textContent =
      `${WEEKDAYS.find((d) => d.id === currentDay)?.label ?? currentDay}  ·  规划 ${b.assigned}/${b.slots} 已指定  ·  皮 ${b.skins}/${BUDGET.skins}  ·  道具 ${b.props}/${BUDGET.props}` +
      (b.over ? '  超预算，合批会变重' : '');
    $('rosterHint').textContent = `玩家五关同一套。同事每关换花名和皮；开局只能带一个玩家进关。`;
  }

  function renderDays() {
    $('dayList').innerHTML = WEEKDAYS.map((s) => {
      const on = currentDay === s.id ? 'on' : '';
      const tag = catalog.active === s.id ? '<span class="tag ok">当前</span>' : '<span class="tag">备份</span>';
      return `<button type="button" class="item ${on}" data-id="${s.id}"><div><div>${s.label}</div><div class="meta">${s.blurb}</div></div>${tag}</button>`;
    }).join('');
    $('dayList').querySelectorAll<HTMLButtonElement>('.item').forEach((el) => {
      el.addEventListener('click', () => void switchDay(el.dataset.id as WeekdayId));
    });
  }

  async function switchDay(id: WeekdayId) {
    if (!id || id === currentDay) return;
    currentDay = selectCatalogDay(catalog, id);
    renderDays();
    refreshBudget();
    renderRoster();
    await openSlot(selectedSlot);
    toast(`正在编 ${WEEKDAYS.find((d) => d.id === currentDay)?.label}`);
  }

  function renderRoster() {
    const box = $('varList');
    box.innerHTML = '';
    for (const slot of roster) {
      const look = lookForSlot(catalog, slot.id);
      const officialOnly =
        !!look &&
        isOfficialSkinId(look.skin) &&
        !look.kitHair &&
        !look.kitSkirt &&
        !(look.props?.length) &&
        !look.bodyMorph &&
        (look.bodyScale == null || Math.abs(look.bodyScale - defaultBodyScale(slot.id)) < 1e-3) &&
        (!look.kitHairMap || look.kitHairMap === KIT_HAIR_ALBEDO) &&
        (!look.kitSkirtMap || look.kitSkirtMap === KIT_SKIRT_ALBEDO);
      const extras = look?.props.map((p) => p.id).join(' · ');
      const row = document.createElement('div');
      row.className = `item${slot.id === selectedSlot ? ' on' : ''}${look ? '' : ' missing'}`;
      const detail = look
        ? `${look.skin}${look.kitHair ? ' · ' + look.kitHair : ''}${extras ? ' · ' + extras : ''}${officialOnly ? ' · 游戏默认' : ''}${slot.kind === 'player' ? ' · 进关二选一' : ''}`
        : slot.kind === 'player' ? '还没有形象 · 进关二选一' : '还没有形象';
      const title = slot.kind === 'player' ? slot.label : look?.label || slot.label;
      const tag = !look ? '未指定' : officialOnly ? '游戏默认' : '已指定';
      const thumb = look?.thumb
        ? `<img class="thumb" alt="" src="${look.thumb}?v=${thumbNonce}">`
        : `<span class="thumb ph"></span>`;
      row.innerHTML =
        `${thumb}<div><div>${title}</div><div class="meta">${slot.label} · ${slot.id} · ${detail}</div></div>` +
        `<span class="tag ${look ? 'ok' : 'wait'}">${tag}</span>`;
      row.addEventListener('click', () => void openSlot(slot.id));
      box.appendChild(row);
    }
  }

  async function openSlot(id: string) {
    const slot = slotOf(id);
    if (!slot) return;
    selectedSlot = id;
    bindSlotFields(slot);
    const look = lookForSlot(catalog, id);
    if (look) await loadVariant(look.id);
    else {
      setMorphUi(0);
      setScaleUi(defaultBodyScale(id));
      pickKitHair(null);
      pickKitSkirt(null);
      void pickHairMap(KIT_HAIR_ALBEDO, true);
      void pickSkirtMap(KIT_SKIRT_ALBEDO, true);
      preview.resetCamera();
      toast(`「${slot.label}」未指定，调完点保存到该角色`);
    }
    renderRoster();
  }

  async function persist(okMsg: string) {
    const r = await saveCatalog(catalog);
    if (!r.ok) {
      toast(`落盘失败：${r.error}。已改为本地下载。`);
      downloadJson('catalog.json', catalog);
      return;
    }
    toast(okMsg);
    $('packPaths').textContent = `${WEEKDAYS.find((d) => d.id === currentDay)?.label} · ${budgetReport(catalog).assigned}/${roster.length} 已指定 · 游戏当前 ${WEEKDAYS.find((d) => d.id === catalog.active)?.label}`;
  }

  function rigOf(kind: EditTarget) {
    return kind === 'hat' ? hat : kind === 'held' ? held : back;
  }

  function boneOf(kind: EditTarget) {
    return kind === 'hat' ? preview.head : kind === 'held' ? preview.hand : preview.back;
  }

  function idInput(kind: EditTarget) {
    return $(kind === 'hat' ? 'hatId' : kind === 'held' ? 'heldId' : 'backId') as HTMLInputElement;
  }

  function setSlotBytes(kind: EditTarget, bytes: ArrayBuffer | null, fileName = '') {
    if (kind === 'hat') {
      hatBytes = bytes;
      if (fileName) hatFileName = fileName;
    } else if (kind === 'held') {
      heldBytes = bytes;
      if (fileName) heldFileName = fileName;
    } else {
      backBytes = bytes;
      if (fileName) backFileName = fileName;
    }
  }

  function slotBytes(kind: EditTarget) {
    return kind === 'hat' ? hatBytes : kind === 'held' ? heldBytes : backBytes;
  }

  function slotFileName(kind: EditTarget) {
    return kind === 'hat' ? hatFileName : kind === 'held' ? heldFileName : backFileName;
  }

  function activeRig() {
    if (dashLine) return mountRigs[dashSlot];
    return rigOf(editTarget);
  }

  function paintDash() {
    for (const id of LINE_IDS) {
      const btn = document.getElementById(`dashLine-${id}`);
      btn?.classList.toggle('active', id === dashLine);
      const mounted = catalog.dashMounts?.[id];
      const has = !!(mounted?.hand || mounted?.head);
      if (btn) btn.textContent = has ? `${LINE_NAMES[id]} · 已挂` : LINE_NAMES[id];
    }
    $('btnDashHand').classList.toggle('active', !!dashLine && dashSlot === 'hand');
    $('btnDashHead').classList.toggle('active', !!dashLine && dashSlot === 'head');
  }

  function dashWhere() {
    return dashSlot === 'hand' ? '自己手上' : '打中的人头上';
  }

  function focusDashGizmo() {
    if (!dashLine) return;
    paintDash();
    const rig = mountRigs[dashSlot];
    const where = dashWhere();
    $('xformHint').textContent = `正在调${LINE_NAMES[dashLine]} · ${where}。拖滑杆即可。`;
    if (rig.visual) {
      preview.attachGizmo(rig.root);
      writeTransform(rig.getTransform());
      writePre(rig.preRotation);
      const preset = PROP_PRESETS.find((p) => p.id === dashPropIds[dashSlot]);
      $('dashMountInfo').textContent = `${LINE_NAMES[dashLine]} · ${where} · ${preset?.label ?? dashPropIds[dashSlot]}`;
    } else {
      preview.attachGizmo(null);
      writeTransform(IDENTITY_TRANSFORM);
      writePre([0, 0, 0]);
      $('dashMountInfo').textContent = `${LINE_NAMES[dashLine]} · ${where} · 还没挂。点上面的物品。`;
    }
  }

  function captureDashSlot(slot: 'hand' | 'head'): DashMountSlot | null {
    const rig = mountRigs[slot];
    const propId = dashPropIds[slot];
    if (!rig.visual || !propId) return null;
    return {
      propId,
      transform: rig.getTransform(),
      preRotation: [rig.preRotation[0], rig.preRotation[1], rig.preRotation[2]],
    };
  }

  async function restoreDashSlot(slot: 'hand' | 'head', token: number) {
    const saved = dashLine ? catalog.dashMounts?.[dashLine]?.[slot] ?? null : null;
    const rig = mountRigs[slot];
    if (!saved) {
      rig.unmount();
      dashPropIds[slot] = '';
      return;
    }
    if (dashPropIds[slot] === saved.propId && rig.visual) {
      rig.setPreRotation(saved.preRotation);
      rig.setTransform(saved.transform);
      return;
    }
    const bone = slot === 'hand' ? preview.hand : preview.head;
    const prop = catalog.props.find((p) => p.id === saved.propId);
    if (!bone || !prop) {
      rig.unmount();
      dashPropIds[slot] = '';
      return;
    }
    const preset = PROP_PRESETS.find((p) => p.id === saved.propId);
    const visual = await loadPropFile(preset?.file ?? prop.file, preset?.fit ?? propFitOf(saved.propId, prop.fit));
    if (token !== dashToken || dashLine == null) return;
    rig.mount(bone, visual);
    rig.source = prop.file;
    rig.setPreRotation(saved.preRotation);
    rig.setTransform(saved.transform);
    dashPropIds[slot] = saved.propId;
  }

  async function selectDash(line: LineId) {
    const token = ++dashToken;
    dashLine = line;
    $('btnEditHat').classList.remove('active');
    $('btnEditHeld').classList.remove('active');
    $('btnEditBack').classList.remove('active');
    paintDash();
    await restoreDashSlot('hand', token);
    await restoreDashSlot('head', token);
    if (token !== dashToken) return;
    focusDashGizmo();
  }

  async function mountDashPreset(preset: (typeof PROP_PRESETS)[number]) {
    if (!dashLine) return;
    const bone = dashSlot === 'hand' ? preview.hand : preview.head;
    if (!bone) {
      toast(dashSlot === 'hand' ? '没有右手骨' : '没有头骨');
      return;
    }
    const rig = mountRigs[dashSlot];
    rig.resetTransform();
    const existing = catalog.props.find((p) => p.id === preset.id);
    rig.setPreRotation(existing?.preRotation ?? [0, 0, 0]);
    const visual = preset.file
      ? await loadPropFile(preset.file, preset.fit ?? propFitOf(preset.id))
      : preset.make
        ? preset.make()
        : null;
    if (!visual) {
      toast(`${preset.label} 没有模型`);
      return;
    }
    if (!dashLine) return;
    rig.mount(bone, visual);
    rig.source = preset.file ?? preset.label;
    dashPropIds[dashSlot] = preset.id;
    rig.snapToAttach('bottom');
    focusDashGizmo();
  }

  function setEditTarget(next: EditTarget) {
    dashLine = null;
    paintDash();
    $('dashMountInfo').textContent = '先点一条冲刺。摆好的挂件还在这条冲刺上，点名字可以再调。';
    editTarget = next;
    $('btnEditHat').classList.toggle('active', next === 'hat');
    $('btnEditHeld').classList.toggle('active', next === 'held');
    $('btnEditBack').classList.toggle('active', next === 'back');
    const rig = activeRig();
    const label = `${SLOT_LABEL[next]}（${BONE_LABEL[next]}）`;
    $('xformHint').textContent = `正在调${label}。拖滑杆即可。`;
    if (rig.visual) {
      preview.attachGizmo(rig.root);
      writeTransform(rig.getTransform());
      writePre(rig.preRotation);
    } else {
      preview.attachGizmo(null);
      writeTransform(IDENTITY_TRANSFORM);
      writePre([0, 0, 0]);
    }
  }

  async function attachProp(kind: EditTarget, visual: import('three').Group, source: string, snap: boolean) {
    const bone = boneOf(kind);
    if (!bone) {
      toast(`没有 ${BONE_LABEL[kind]} 骨，无法挂${SLOT_LABEL[kind]}`);
      return;
    }
    const rig = rigOf(kind);
    rig.mount(bone, visual);
    rig.source = source;
    const tris = countTris(visual);
    $('propInfo').textContent = `${SLOT_LABEL[kind]} · ${source} · ${tris} 三角 · 已挂 ${BONE_LABEL[kind]}`;
    if (snap) rig.snapToAttach(kind === 'back' ? 'back' : 'bottom');
    setEditTarget(kind);
    $('status').textContent = preview.statusLine();
  }

  async function loadVariant(id: string) {
    const v = catalog.variants.find((x) => x.id === id);
    if (!v) return;
    selectedSlot = v.id;
    ($('varId') as HTMLInputElement).value = v.id;
    ($('varLabel') as HTMLInputElement).value = v.label;
    ($('varGender') as HTMLInputElement).value = v.gender;
    ($('skinId') as HTMLInputElement).value = v.skin;
    const hatUse = (v.props ?? []).find((p) => p.anchor === 'head');
    const heldUse = (v.props ?? []).find((p) => p.anchor === 'hand');
    const backUse = (v.props ?? []).find((p) => p.anchor === 'back');
    idInput('hat').value = hatUse?.id ?? '';
    idInput('held').value = heldUse?.id ?? '';
    idInput('back').value = backUse?.id ?? '';
    const skillEl = $('enemySkill') as HTMLSelectElement;
    skillEl.value = v.enemySkill ?? '';
    $('enemySkillField').hidden = isPlayerSlotId(v.id);

    const skin = catalog.skins.find((s) => s.id === v.skin) ?? OFFICIAL_SKINS.find((s) => s.id === v.skin);
    if (skin && preview.skinned) {
      const map = await loadSkinMap(skin.file, false);
      customSkin = { id: skin.id, file: skin.file, map };
      customPreviewUrl = skin.file;
      preview.setCustomSkin(map);
      await redrawSkinView();
    }

    hat.unmount();
    held.unmount();
    back.unmount();
    const restoreProp = async (use: PropUse | undefined, kind: EditTarget) => {
      if (!use) return;
      const def = catalog.props.find((p) => p.id === use.id);
      if (!def) return;
      const visual = await loadPropFile(def.file, propFitOf(def.id, def.fit));
      const rig = rigOf(kind);
      rig.setPreRotation(def.preRotation);
      await attachProp(kind, visual, def.file, false);
      rig.setTransform(use.transform);
    };
    await restoreProp(hatUse, 'hat');
    await restoreProp(heldUse, 'held');
    await restoreProp(backUse, 'back');
    setMorphUi(v.bodyMorph ?? 0);
    setScaleUi(v.bodyScale ?? defaultBodyScale(v.id));
    const kh = v.kitHair;
    pickKitHair(isKitHairId(kh) ? kh : null);
    pickKitSkirt(isKitSkirtId(v.kitSkirt) ? v.kitSkirt : null);
    if (v.kitHairMap) await pickHairMap(v.kitHairMap, true);
    else await pickHairMap(KIT_HAIR_ALBEDO, true);
    if (v.kitSkirtMap) await pickSkirtMap(v.kitSkirtMap, true);
    else await pickSkirtMap(KIT_SKIRT_ALBEDO, true);
    setEditTarget(hatUse ? 'hat' : heldUse ? 'held' : backUse ? 'back' : 'hat');
    // 先落体型再还原封面机位；多等一帧避开 OrbitControls 阻尼残留
    const cam = v.thumbCam ?? null;
    preview.setCameraPose(cam);
    requestAnimationFrame(() => preview.setCameraPose(cam));
    toast(cam ? `已还原 ${v.label} · 封面机位` : `已还原 ${v.label}`);
  }

  // —— 官方皮 / 对照 ——
  $('btnMale').addEventListener('click', () => {
    void pickOfficialBody(OFFICIAL_SKINS[0]);
  });
  $('btnFemale').addEventListener('click', () => {
    void pickOfficialBody(OFFICIAL_SKINS[1]);
  });

  async function pickOfficialBody(def: (typeof OFFICIAL_SKINS)[number]) {
    officialSkin = def;
    const map = await loadSkinMap(def.file, false);
    customSkin = { id: def.id, file: def.file, map };
    customPreviewUrl = def.file;
    preview.setCustomSkin(map);
    preview.setCompareOfficial(false);
    preview.setOfficialSkin(def.id);
    $('btnMale').classList.toggle('active', def.id === OFFICIAL_SKINS[0].id);
    $('btnFemale').classList.toggle('active', def.id === OFFICIAL_SKINS[1].id);
    $('btnMine').classList.add('active');
    $('btnOfficial').classList.remove('active');
    ($('skinId') as HTMLInputElement).value = def.id;
    await redrawSkinView();
  }
  $('btnMine').addEventListener('click', () => {
    preview.setCompareOfficial(false);
    $('btnMine').classList.add('active');
    $('btnOfficial').classList.remove('active');
  });
  $('btnOfficial').addEventListener('click', () => {
    preview.setCompareOfficial(true);
    $('btnOfficial').classList.add('active');
    $('btnMine').classList.remove('active');
  });
  $('islandToggle').addEventListener('change', () => {
    islands = ($('islandToggle') as HTMLInputElement).checked;
    void redrawSkinView();
  });

  function highlightKitHair(id: KitHairId | null) {
    $('kitHairNone').classList.toggle('active', id === null);
    $('kitHairOdango').classList.toggle('active', id === 'hair_odango');
    $('kitHairTail').classList.toggle('active', id === 'hair_tail');
    $('kitHairBob').classList.toggle('active', id === 'hair_bob');
  }
  function pickKitHair(id: KitHairId | null) {
    preview.setKitHairStyle(id);
    highlightKitHair(id);
    $('status').textContent = preview.statusLine();
  }
  $('kitHairNone').addEventListener('click', () => pickKitHair(null));
  $('kitHairOdango').addEventListener('click', () => pickKitHair('hair_odango'));
  $('kitHairTail').addEventListener('click', () => pickKitHair('hair_tail'));
  $('kitHairBob').addEventListener('click', () => pickKitHair('hair_bob'));

  function highlightKitSkirt(id: KitSkirtId | null) {
    $('kitSkirtNone').classList.toggle('active', id === null);
    $('kitSkirtPencil').classList.toggle('active', id === 'skirt_pencil');
  }
  function pickKitSkirt(id: KitSkirtId | null) {
    preview.setKitSkirtStyle(id);
    highlightKitSkirt(id);
    $('status').textContent = preview.statusLine();
  }
  $('kitSkirtNone').addEventListener('click', () => pickKitSkirt(null));
  $('kitSkirtPencil').addEventListener('click', () => pickKitSkirt('skirt_pencil'));

  function setMorphUi(t: number) {
    const v = Math.max(-1, Math.min(1, t));
    for (const el of document.querySelectorAll<HTMLInputElement>('.bodyMorphRange')) el.value = String(v);
    for (const el of document.querySelectorAll('.morphVal')) {
      el.textContent = v === 0 ? '中' : v > 0 ? `胖 ${v.toFixed(2)}` : `瘦 ${(-v).toFixed(2)}`;
    }
    preview.setMorph(v);
    $('status').textContent = preview.statusLine();
  }
  for (const el of document.querySelectorAll('.bodyMorphRange')) {
    el.addEventListener('input', () => setMorphUi(Number((el as HTMLInputElement).value)));
  }

  function setScaleUi(t: number) {
    const v = clampBodyScale(t);
    for (const el of document.querySelectorAll<HTMLInputElement>('.bodyScaleRange')) el.value = String(v);
    for (const el of document.querySelectorAll('.bodyScaleVal')) el.textContent = v.toFixed(2);
    preview.setBodyScale(v);
    $('status').textContent = preview.statusLine();
  }
  for (const el of document.querySelectorAll('.bodyScaleRange')) {
    el.addEventListener('input', () => setScaleUi(Number((el as HTMLInputElement).value)));
  }

  function syncLightUi(L: StudioLights) {
    const setNum = (id: string, v: number) => {
      const el = $(id) as HTMLInputElement;
      el.value = String(v);
      const label = document.querySelector(`.v[data-for="${id}"]`);
      if (label) label.textContent = v.toFixed(2);
    };
    setNum('lightHemi', L.hemi);
    setNum('lightKey', L.key);
    setNum('lightFill', L.fill);
    setNum('lightRim', L.rim);
    setNum('lightChin', L.chin);
    ($('lightKeyColor') as HTMLInputElement).value = L.keyColor;
    ($('lightFillColor') as HTMLInputElement).value = L.fillColor;
    ($('lightRimColor') as HTMLInputElement).value = L.rimColor;
    ($('lightChinColor') as HTMLInputElement).value = L.chinColor;
    ($('lightBg') as HTMLInputElement).value = L.bg;
  }
  function readLightUi(): StudioLights {
    return {
      hemi: Number(($('lightHemi') as HTMLInputElement).value),
      key: Number(($('lightKey') as HTMLInputElement).value),
      fill: Number(($('lightFill') as HTMLInputElement).value),
      rim: Number(($('lightRim') as HTMLInputElement).value),
      chin: Number(($('lightChin') as HTMLInputElement).value),
      keyColor: ($('lightKeyColor') as HTMLInputElement).value,
      fillColor: ($('lightFillColor') as HTMLInputElement).value,
      rimColor: ($('lightRimColor') as HTMLInputElement).value,
      chinColor: ($('lightChinColor') as HTMLInputElement).value,
      bg: ($('lightBg') as HTMLInputElement).value,
    };
  }
  function applyLightUi() {
    const L = readLightUi();
    preview.applyStudioLights(L);
    syncLightUi(L);
  }
  function pickLightPreset(id: keyof typeof STUDIO_PRESETS) {
    preview.applyStudioPreset(id);
    syncLightUi(preview.getStudioLights());
    $('lightPresetStudio').classList.toggle('active', id === 'studio');
    $('lightPresetWarm').classList.toggle('active', id === 'warm');
    $('lightPresetCool').classList.toggle('active', id === 'cool');
    $('lightPresetFlat').classList.toggle('active', id === 'flat');
    toast(`封面光：${id === 'studio' ? '棚拍' : id === 'warm' ? '暖轮廓' : id === 'cool' ? '冷霓虹' : '平光'}`);
  }
  for (const id of ['lightHemi', 'lightKey', 'lightFill', 'lightRim', 'lightChin']) {
    $(id).addEventListener('input', () => applyLightUi());
  }
  for (const id of ['lightKeyColor', 'lightFillColor', 'lightRimColor', 'lightChinColor', 'lightBg']) {
    $(id).addEventListener('input', () => applyLightUi());
  }
  $('lightPresetStudio').addEventListener('click', () => pickLightPreset('studio'));
  $('lightPresetWarm').addEventListener('click', () => pickLightPreset('warm'));
  $('lightPresetCool').addEventListener('click', () => pickLightPreset('cool'));
  $('lightPresetFlat').addEventListener('click', () => pickLightPreset('flat'));
  syncLightUi(preview.getStudioLights());

  const kitSkinBox = $('kitSkinBtns');
  for (const def of KIT_SKINS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = def.label.replace('survivor', '').replace('zombie', 'z');
    btn.title = def.label;
    btn.dataset.kitSkin = def.id;
    btn.addEventListener('click', () => {
      void (async () => {
        const map = await loadSkinMap(def.file, false);
        customSkin = { id: def.id, file: def.file, map };
        customPreviewUrl = def.file;
        preview.setCustomSkin(map);
        preview.setCompareOfficial(false);
        preview.setOfficialSkin(def.id);
        $('btnMine').classList.add('active');
        $('btnOfficial').classList.remove('active');
        ($('skinId') as HTMLInputElement).value = def.id;
        await redrawSkinView();
        for (const b of kitSkinBox.querySelectorAll('button')) {
          b.classList.toggle('active', b === btn);
        }
        toast(`${def.label} · 保存后会复制到本角色独立皮`);
      })();
    });
    kitSkinBox.appendChild(btn);
  }
  kitSkinBox.querySelector('button')?.classList.add('active');

  $('atlasTabBody').addEventListener('click', () => {
    atlasTab = 'body';
    highlightAtlasTab();
    void redrawSkinView();
  });
  $('atlasTabHair').addEventListener('click', () => {
    atlasTab = 'hair';
    highlightAtlasTab();
    void redrawSkinView();
  });
  $('atlasTabSkirt').addEventListener('click', () => {
    atlasTab = 'skirt';
    highlightAtlasTab();
    void redrawSkinView();
  });

  bindDrop($('skinDrop'), $('skinFile') as HTMLInputElement, async (file) => {
    try {
      const { map, square, width, height } = await skinFromFile(file, false);
      const bytes = await file.arrayBuffer();
      if (atlasTab === 'hair') {
        const id = `${destAssetId(selectedSlot || slug(file.name, 'custom'))}-hair`;
        customHair = { file: `/models/colleagues/skins/${id}.png`, map, bytes };
        hairPreviewUrl = URL.createObjectURL(file);
        preview.setKitHairMap(map, customHair.file);
        highlightAtlasTab();
        await redrawSkinView();
        toast(square ? '已换头发贴图（会写入战场）' : `贴图 ${width}×${height} 不是正方形`);
        return;
      }
      if (atlasTab === 'skirt') {
        const id = `${destAssetId(selectedSlot || slug(file.name, 'custom'))}-skirt`;
        customSkirtTex = { file: `/models/colleagues/skins/${id}.png`, map, bytes };
        skirtPreviewUrl = URL.createObjectURL(file);
        preview.setKitSkirtMap(map, customSkirtTex.file);
        pickKitSkirt('skirt_pencil');
        highlightAtlasTab();
        await redrawSkinView();
        toast(square ? '已换裙布（会写入战场）' : `贴图 ${width}×${height} 不是正方形`);
        return;
      }
      const id = slotSkinId(selectedSlot || slug(file.name, 'custom'));
      ($('skinId') as HTMLInputElement).value = id;
      customSkin = { id, file: `/models/colleagues/skins/${id}.png`, map, bytes, name: `${id}.png` };
      customPreviewUrl = URL.createObjectURL(file);
      preview.setCustomSkin(map);
      preview.setCompareOfficial(false);
      $('btnMine').classList.add('active');
      $('btnOfficial').classList.remove('active');
      await redrawSkinView();
      if (!square) toast(`贴图 ${width}×${height} 不是正方形，预览可用但不要保存`);
      else toast('已换皮（glTF · flipY=false，会写入战场）');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  });

  function setPropAnchor(next: AttachAnchor) {
    propAnchor = next;
    $('btnAnchorHead').classList.toggle('active', next === 'head');
    $('btnAnchorHand').classList.toggle('active', next === 'hand');
    $('btnAnchorBack').classList.toggle('active', next === 'back');
    setEditTarget(SLOT_OF[next]);
  }
  $('btnAnchorHead').addEventListener('click', () => setPropAnchor('head'));
  $('btnAnchorHand').addEventListener('click', () => setPropAnchor('hand'));
  $('btnAnchorBack').addEventListener('click', () => setPropAnchor('back'));
  $('btnEditHat').addEventListener('click', () => {
    setPropAnchor('head');
  });
  $('btnEditHeld').addEventListener('click', () => {
    setPropAnchor('hand');
  });
  $('btnEditBack').addEventListener('click', () => {
    setPropAnchor('back');
  });

  bindDrop($('propDrop'), $('propFile') as HTMLInputElement, async (file) => {
    if (dashLine) {
      toast('冲刺挂件先点上面已有的物品');
      return;
    }
    try {
      const bytes = await file.arrayBuffer();
      const kind = SLOT_OF[propAnchor];
      const fileName = file.name.replace(/\s+/g, '-');
      setSlotBytes(kind, bytes, fileName);
      const id = slug(idInput(kind).value || file.name, `prop-${kind}`);
      idInput(kind).value = id;
      const visual = await loadPropFile(new File([bytes], file.name));
      await attachProp(kind, visual, file.name, true);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  });

  for (const preset of PROP_PRESETS) {
    const btn = $(preset.btn);
    btn.addEventListener('click', async () => {
      if (dashLine) {
        try {
          await mountDashPreset(preset);
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      const kind = SLOT_OF[propAnchor];
      idInput(kind).value = preset.id;
      setSlotBytes(kind, null, `${preset.id}.glb`);
      const rig = rigOf(kind);
      rig.resetTransform();
      const existing = catalog.props.find((p) => p.id === preset.id);
      rig.setPreRotation(existing?.preRotation ?? [0, 0, 0]);
      const visual = preset.file
        ? await loadPropFile(preset.file, preset.fit)
        : preset.make
          ? preset.make()
          : null;
      if (!visual) {
        toast(`${preset.label} 没有模型`);
        return;
      }
      await attachProp(kind, visual, preset.file ?? preset.label, true);
      toast(`${preset.label} 已挂 ${ANCHOR_LABEL[propAnchor]}`);
    });
  }

  const dashList = $('dashMountList');
  for (const id of LINE_IDS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = `dashLine-${id}`;
    btn.textContent = LINE_NAMES[id];
    btn.addEventListener('click', () => {
      void selectDash(id);
    });
    dashList.appendChild(btn);
  }
  paintDash();
  $('btnDashHand').addEventListener('click', () => {
    if (!dashLine) {
      toast('先点一条冲刺');
      return;
    }
    dashSlot = 'hand';
    focusDashGizmo();
  });
  $('btnDashHead').addEventListener('click', () => {
    if (!dashLine) {
      toast('先点一条冲刺');
      return;
    }
    dashSlot = 'head';
    focusDashGizmo();
  });
  $('btnSaveDashMount').addEventListener('click', async () => {
    if (!dashLine) {
      toast('先点一条冲刺');
      return;
    }
    const line = dashLine;
    const hand = captureDashSlot('hand');
    const head = captureDashSlot('head');
    catalog.dashMounts ??= {};
    if (!hand && !head) delete catalog.dashMounts[line];
    else catalog.dashMounts[line] = { hand, head };
    paintDash();
    focusDashGizmo();
    await persist(`${LINE_NAMES[line]} 挂件已保存`);
  });
  $('btnClearDashMount').addEventListener('click', async () => {
    if (!dashLine) {
      toast('先点一条冲刺');
      return;
    }
    mountRigs[dashSlot].unmount();
    dashPropIds[dashSlot] = '';
    const line = dashLine;
    const hand = captureDashSlot('hand');
    const head = captureDashSlot('head');
    catalog.dashMounts ??= {};
    if (!hand && !head) delete catalog.dashMounts[line];
    else catalog.dashMounts[line] = { hand, head };
    paintDash();
    focusDashGizmo();
    await persist(`已卸下${LINE_NAMES[line]}的${dashWhere()}`);
  });

  $('btnClearProp').addEventListener('click', () => {
    if (dashLine) {
      toast('冲刺挂件用下面的「卸下这一处」');
      return;
    }
    const kind = SLOT_OF[propAnchor];
    rigOf(kind).unmount();
    setSlotBytes(kind, null);
    idInput(kind).value = '';
    $('propInfo').textContent = `已卸下${SLOT_LABEL[kind]}`;
    if (editTarget === kind) setEditTarget(kind);
  });

  const setAnimBtn = (active: 'idle' | 'run' | 'jump') => {
    $('btnIdle').classList.toggle('active', active === 'idle');
    $('btnRun').classList.toggle('active', active === 'run');
    $('btnJump').classList.toggle('active', active === 'jump');
  };
  $('btnIdle').addEventListener('click', () => {
    preview.play('idle');
    setAnimBtn('idle');
    $('status').textContent = preview.statusLine();
  });
  $('btnRun').addEventListener('click', () => {
    preview.play('run');
    setAnimBtn('run');
    $('status').textContent = preview.statusLine();
  });
  $('btnJump').addEventListener('click', () => {
    if (!preview.clips.jump) {
      toast('包内 jump 是静止 rest pose，预览先用 idle/run（Kenney FBX 旋转）');
      return;
    }
    preview.play('jump');
    setAnimBtn('jump');
    $('status').textContent = preview.statusLine();
  });
  $('btnCam').addEventListener('click', () => preview.resetCamera());
  $('gizmoT').addEventListener('click', () => {
    preview.gizmo.setMode('translate');
    $('gizmoT').classList.add('active');
    $('gizmoR').classList.remove('active');
    $('gizmoS').classList.remove('active');
  });
  $('gizmoR').addEventListener('click', () => {
    preview.gizmo.setMode('rotate');
    $('gizmoR').classList.add('active');
    $('gizmoT').classList.remove('active');
    $('gizmoS').classList.remove('active');
  });
  $('gizmoS').addEventListener('click', () => {
    preview.gizmo.setMode('scale');
    $('gizmoS').classList.add('active');
    $('gizmoT').classList.remove('active');
    $('gizmoR').classList.remove('active');
  });
  $('btnSnap').addEventListener('click', () => {
    const rig = activeRig();
    rig.snapToAttach(!dashLine && editTarget === 'back' ? 'back' : 'bottom');
    writeTransform(rig.getTransform());
  });
  $('btnResetXform').addEventListener('click', () => {
    const rig = activeRig();
    rig.resetTransform();
    writeTransform(rig.getTransform());
  });

  preview.gizmo.addEventListener('objectChange', () => {
    const rig = activeRig();
    if (preview.gizmo.object === rig.root) writeTransform(rig.getTransform());
  });

  for (const id of ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz']) {
    $(id).addEventListener('input', () => {
      if (syncingInputs) return;
      num(id, readNum(id));
      activeRig().setTransform(readTransform());
    });
  }
  for (const id of ['prx', 'pry', 'prz']) {
    $(id).addEventListener('input', () => {
      if (syncingInputs) return;
      num(id, readNum(id));
      activeRig().setPreRotation([readNum('prx'), readNum('pry'), readNum('prz')]);
    });
  }

  $('btnSave').addEventListener('click', async () => {
    const slot = slotOf(selectedSlot);
    if (!slot) {
      toast('先点右侧一个游戏角色');
      return;
    }
    const id = slot.id;
    const gender = slot.gender;
    const nick = ($('varLabel') as HTMLInputElement).value.trim();
    const label = isPlayerSlotId(id) ? slot.label : nick || slot.label;
    ($('varId') as HTMLInputElement).value = id;
    ($('varLabel') as HTMLInputElement).value = label;
    ($('varGender') as HTMLInputElement).value = gender;

    const ownSkinId = slotSkinId(slot.id);
    const destSkinId = isPlayerSlotId(id) ? ownSkinId : `skin-${id}-${currentDay}`;
    const existing = lookForSlot(catalog, slot.id);
    const fallback = officialSkinForGender(gender);
    const picked = customSkin
      ? { id: customSkin.id, file: customSkin.file }
      : existing?.skin === ownSkinId
        ? catalog.skins.find((s) => s.id === ownSkinId) ?? fallback
        : catalog.skins.find((s) => s.id === existing?.skin) ?? fallback;

    const writeOwnSkin = async (bytes: ArrayBuffer, destId: string) => {
      const put = await saveAsset('skins', `${destId}.png`, bytes);
      if (!put.ok || !put.file) {
        toast(`皮肤未写入：${put.error}`);
        return null;
      }
      if (customSkin) {
        customSkin = { ...customSkin, id: destId, file: put.file, bytes: undefined };
      }
      ($('skinId') as HTMLInputElement).value = destId;
      return { id: destId, file: put.file, flipY: false as const };
    };

    let skinDef = fallback;
    const shared = picked.id !== ownSkinId && picked.id !== destSkinId;
    if (customSkin?.bytes) {
      const written = await writeOwnSkin(customSkin.bytes, destSkinId);
      if (!written) return;
      skinDef = written;
    } else if (shared) {
      const copyId = destSkinId;
      try {
        const written = await writeOwnSkin(await pngBytesFromUrl(picked.file), copyId);
        if (!written) return;
        skinDef = written;
        if (!customSkin) {
          customSkin = { id: copyId, file: written.file, map: await loadSkinMap(written.file, false) };
          preview.setCustomSkin(customSkin.map);
        }
      } catch (err) {
        toast(`无法把贴图写成「${copyId}」：${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    } else {
      skinDef = { id: picked.id, file: picked.file, flipY: false };
    }

    const uses: PropUse[] = [];
    const persistProp = async (kind: EditTarget): Promise<boolean> => {
      const rig = rigOf(kind);
      if (!rig.visual) return true;
      const anchor = ANCHOR_OF[kind];
      const input = idInput(kind);
      const ownId = `prop-${kind}-${id}`;
      let propId = input.value.trim() || ownId;
      const usedByOther = catalog.variants.some(
        (v) => v.id !== id && v.props.some((p) => p.id === propId)
      );
      const prevProp = catalog.props.find((p) => p.id === propId);
      let file = prevProp?.file;
      const prevFit = prevProp?.fit;
      if (rig.source.startsWith('/models/colleagues/')) file = rig.source;
      const bytes = slotBytes(kind);
      const fileName = slotFileName(kind);
      const willWrite = !!bytes || !file;
      if (willWrite && usedByOther) {
        propId = ownId;
        file = undefined;
      }
      input.value = propId;
      if (bytes && fileName) {
        const ext = fileName.toLowerCase().endsWith('.fbx') ? 'fbx' : 'glb';
        const put = await saveAsset('props', `${propId}.${ext}`, bytes);
        if (!put.ok || !put.file) {
          toast(`道具未写入：${put.error}`);
          return false;
        }
        file = put.file;
      } else if (!file) {
        const glb = await rig.exportGlb();
        const put = await saveAsset('props', `${propId}.glb`, glb);
        if (!put.ok || !put.file) {
          toast(`占位道具未写入：${put.error}`);
          return false;
        }
        file = put.file;
      }
      upsertProp(catalog, {
        id: propId,
        file: file!,
        preRotation: rig.preRotation,
        fit: propFitOf(propId, prevFit),
      });
      uses.push({ id: propId, anchor, transform: rig.getTransform() });
      return true;
    };
    if (!(await persistProp('hat')) || !(await persistProp('held')) || !(await persistProp('back'))) return;

    let thumb: string | null = lookForSlot(catalog, id)?.thumb ?? null;
    const thumbCam = preview.getCameraPose();
    try {
      const dataUrl = preview.captureThumb();
      const buf = await (await fetch(dataUrl)).arrayBuffer();
      const put = await saveAsset('thumbs', `${currentDay}-${id}.png`, buf);
      if (put.ok && put.file) thumb = put.file;
    } catch (err) {
      console.warn('缩略图未写入', err);
    }

    const persistLookMap = async (
      kind: 'hair' | 'skirt',
      current: { file: string; bytes?: ArrayBuffer } | null,
      previewFile: string,
      fallback: string
    ): Promise<string | null> => {
      let file = current?.file ?? previewFile ?? fallback;
      const destName = `${destSkinId}-${kind}.png`;
      const destFile = `/models/colleagues/skins/${destName}`;
      const field = kind === 'hair' ? 'kitHairMap' : 'kitSkirtMap';
      const needWrite = !!current?.bytes || (lookMapUsedByOther(field, file, id) && file !== destFile);
      if (!needWrite) return file;
      try {
        const bytes = current?.bytes ?? (await pngBytesFromUrl(file));
        const put = await saveAsset('skins', destName, bytes);
        if (!put.ok || !put.file) {
          toast(`${kind === 'hair' ? '头发贴图' : '裙布'}未写入：${put.error}`);
          return null;
        }
        return put.file;
      } catch (err) {
        toast(`${kind === 'hair' ? '头发贴图' : '裙布'}未写入：${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    };
    const hairMapFile = await persistLookMap('hair', customHair, preview.hairMapFile, KIT_HAIR_ALBEDO);
    if (!hairMapFile) return;
    if (customHair) {
      customHair = { ...customHair, file: hairMapFile, bytes: undefined };
      hairPreviewUrl = hairMapFile;
    }
    const skirtMapFile = await persistLookMap('skirt', customSkirtTex, preview.skirtMapFile, KIT_SKIRT_ALBEDO);
    if (!skirtMapFile) return;
    if (customSkirtTex) {
      customSkirtTex = { ...customSkirtTex, file: skirtMapFile, bytes: undefined };
      skirtPreviewUrl = skirtMapFile;
    }

    upsertSkin(catalog, skinDef);
    upsertVariant(catalog, {
      id,
      label,
      gender,
      skin: skinDef.id,
      hair: null,
      hairTransform: { ...IDENTITY_TRANSFORM },
      props: uses,
      bodyMorph: preview.bodyMorph,
      bodyScale: clampBodyScale(preview.bodyScale),
      kitHair: preview.kitHair,
      kitHairMap: hairMapFile,
      kitSkirt: preview.kitSkirt,
      kitSkirtMap: skirtMapFile,
      thumb,
      thumbCam,
      enemySkill: isPlayerSlotId(id) ? null : migrateEnemySkill(($('enemySkill') as HTMLSelectElement).value),
    });

    const b = budgetReport(catalog);
    if (b.over) toast('已保存，但皮肤/道具超预算');
    await persist(
      `已保存到「${label}」· ${WEEKDAYS.find((d) => d.id === currentDay)?.label} · 封面机位已记`
    );
    thumbNonce += 1;
    refreshBudget();
    renderDays();
    renderRoster();
  });

  $('btnActive').addEventListener('click', () => {
    catalog.active = currentDay;
    void persist(`游戏当前关 = ${WEEKDAYS.find((d) => d.id === currentDay)?.label}。打开 :5173 即用。`).then(() => renderDays());
  });

  $('btnFromMon').addEventListener('click', () => {
    if (currentDay === 'monday') {
      toast('已经是周一');
      return;
    }
    const mon = catalog.days.find((d) => d.id === 'monday');
    const cur = catalog.days.find((d) => d.id === currentDay);
    if (!mon || !cur) return;
    cur.variants = mon.variants.map((src) => {
      const had = cur.variants.find((v) => v.id === src.id);
      const next = structuredClone(src);
      if (had) {
        next.label = had.label;
        next.enemySkill = had.enemySkill ?? null;
      }
      return next;
    });
    catalog.variants = cur.variants;
    void persist('已带入周一皮和身形，花名和技能保留').then(() => {
      renderRoster();
      void openSlot(selectedSlot);
    });
  });

  $('btnRefreshRoster').addEventListener('click', async () => {
    catalog = await loadCatalog();
    currentDay = selectCatalogDay(catalog, currentDay);
    if (!roster.some((s) => s.id === selectedSlot)) selectedSlot = roster[0]?.id ?? '';
    renderDays();
    refreshBudget();
    renderRoster();
    const slot = slotOf(selectedSlot);
    if (slot) bindSlotFields(slot);
    toast(`规划 ${roster.length} 个角色 · ${budgetReport(catalog).assigned} 已指定`);
  });

  $('btnPack').addEventListener('click', () => {
    downloadJson('catalog.json', serializeCatalog(catalog));
    toast('已下载 catalog.json（备份用；发布走 npm run build）');
  });

  if (import.meta.hot) {
    import.meta.hot.accept('../../../src/roster.ts', (mod) => {
      if (!mod?.ROSTER) return;
      roster = mod.ROSTER;
      if (!roster.some((s) => s.id === selectedSlot)) selectedSlot = roster[0]?.id ?? '';
      refreshBudget();
      renderRoster();
      toast(`规划已更新 · ${roster.length} 个角色`);
    });
  }

  if (ensureRosterLooks(catalog)) {
    await persist('已把游戏默认形象写入 catalog，和游戏同一份数据');
  }

  writeTransform(IDENTITY_TRANSFORM);
  writePre([0, 0, 0]);
  renderDays();
  refreshBudget();
  renderRoster();
  const first = slotOf(selectedSlot);
  if (first) {
    bindSlotFields(first);
    const look = lookForSlot(catalog, first.id);
    if (look) await loadVariant(look.id);
  }
  highlightAtlasTab();
  await redrawSkinView();
  setInterval(() => {
    $('status').textContent = preview.statusLine();
  }, 500);
}

boot().catch((err) => {
  const el = document.querySelector('#loading')!;
  el.innerHTML = `<div>加载失败</div><div class="hint">${err instanceof Error ? err.message : String(err)}</div>`;
  console.error(err);
});
