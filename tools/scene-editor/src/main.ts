import { ScenePreview, type Tool } from './preview';
import { downloadJson, saveLevelCatalog, saveLevelTexture } from './io';
import { loadFxCatalog, mergeHazardFx } from '../../../src/fx/catalog';
import {
  MAX_AMBIENT,
  MAX_HEMISPHERE,
  MAX_LIGHT_DISTANCE,
  MAX_LIGHT_INTENSITY,
  MAX_POINT_LIGHTS,
  MOVE_HINT,
  PROP_SPECS,
  WEEKDAYS,
  clampLightParams,
  DEFAULT_CUSTOM_COLOR,
  cloneLevel,
  ensureWeekdays,
  faceYaw,
  isHazardKind,
  isWallMount,
  isWallSnap,
  loadLevelCatalog,
  seedLevel,
  applySky,
  propSpec,
  toneFromWallHex,
  voidShapeOf,
  wallFaceLabel,
  wallToneHex,
  type Atmosphere,
  type ChairStyle,
  type DeskFace,
  type DeskKit,
  type DeskTop,
  type FloorKind,
  type FurnitureTone,
  type HazardKind,
  type HazardTune,
  type LevelCatalog,
  type LevelDef,
  type PlantKit,
  type SkyKind,
  type VoidShape,
  type WeekdayId,
} from '../../../src/levels';

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

const TOOL_GROUPS: { title: string; hint: string; tools: { id: Tool; label: string }[] }[] = [
  {
    title: '场景',
    hint: '点墙放置侧窗、电视、弹簧门和电梯；斜墙和三角/圆切口也能挂。',
    tools: [
      { id: 'select', label: '选择 / 移动' },
      { id: 'wall', label: '墙' },
      { id: 'void', label: '黑色遮罩' },
      { id: 'window', label: '侧窗' },
      { id: 'tv', label: '挂壁电视' },
      { id: 'launch', label: '弹簧门' },
      { id: 'elevator', label: '电梯区' },
      { id: 'player', label: '玩家出生' },
      { id: 'heavy', label: '主管锚点' },
      { id: 'interceptor', label: '拦截点' },
      { id: 'pointLight', label: '点光' },
    ],
  },
  {
    title: '硬道具',
    hint: '挡路，推不动。',
    tools: [
      { id: 'desk', label: '工位桌' },
      { id: 'wood', label: '木台' },
      { id: 'pillar', label: '柱' },
      ...PROP_SPECS.filter((s) => s.move === 'block').map((s) => ({ id: s.id as Tool, label: s.label })),
    ],
  },
  {
    title: '可互动',
    hint: '踩到或碰到触发。选中后右侧调减速、眩晕、弹开等。',
    tools: PROP_SPECS.filter((s) => s.move === 'hazard' && s.id !== 'launch').map((s) => ({ id: s.id as Tool, label: s.label })),
  },
  {
    title: '可碰飞',
    hint: '游戏里能撞走，还能撞人。',
    tools: [
      ...PROP_SPECS.filter((s) => s.move === 'push').map((s) => ({ id: s.id as Tool, label: s.label })),
      { id: 'chair', label: '椅子' },
    ],
  },
];

const HAZARD_UI: Record<HazardKind, { hint: string; fields: { row: string; key: keyof HazardTune; label: string; min: number; max: number; step: number }[] }> = {
  wet: {
    hint: '踩上去减速。半径是水渍大小，倍率越小越慢。',
    fields: [
      { row: 'hzRadiusRow', key: 'radius', label: '水渍半径', min: 0.4, max: 2, step: 0.05 },
      { row: 'hzDurationRow', key: 'duration', label: '减速持续', min: 0.3, max: 3, step: 0.05 },
      { row: 'hzFactorRow', key: 'factor', label: '速度倍率', min: 0.2, max: 0.9, step: 0.02 },
    ],
  },
  pit: {
    hint: '地上一张报纸。踩上去会眩晕。半径是触发范围。',
    fields: [
      { row: 'hzRadiusRow', key: 'radius', label: '触发半径', min: 0.3, max: 1.4, step: 0.05 },
      { row: 'hzDurationRow', key: 'duration', label: '眩晕秒', min: 0.6, max: 3, step: 0.05 },
    ],
  },
  crate: {
    hint: '棕色文件箱。碰到会眩晕，也会挡住路。',
    fields: [
      { row: 'hzRadiusRow', key: 'radius', label: '触发半径', min: 0.3, max: 1.4, step: 0.05 },
      { row: 'hzDurationRow', key: 'duration', label: '眩晕秒', min: 0.6, max: 3, step: 0.05 },
    ],
  },
  launch: {
    hint: '必须贴墙。点哪面墙就挖门洞，靠近正面会被拍开摔倒。',
    fields: [
      { row: 'hzRadiusRow', key: 'radius', label: '感应距离', min: 0.35, max: 1.8, step: 0.05 },
      { row: 'hzImpulseRow', key: 'impulse', label: '弹回冲量', min: 200, max: 900, step: 10 },
      { row: 'hzLiftRow', key: 'lift', label: '抬起', min: 8, max: 80, step: 2 },
      { row: 'hzDurationRow', key: 'duration', label: '摔倒秒', min: 0.6, max: 2.2, step: 0.05 },
    ],
  },
  alarm: {
    hint: '游戏里几乎看不见。谁踩上去都会被弹飞，触发时地面会闪一圈白边。',
    fields: [
      { row: 'hzRadiusRow', key: 'radius', label: '地板半径', min: 0.35, max: 1.8, step: 0.05 },
      { row: 'hzImpulseRow', key: 'impulse', label: '弹飞冲量', min: 200, max: 900, step: 10 },
      { row: 'hzLiftRow', key: 'lift', label: '弹飞高度', min: 40, max: 220, step: 2 },
      { row: 'hzDurationRow', key: 'duration', label: '失控秒', min: 0.5, max: 2.2, step: 0.05 },
    ],
  },
};

function moveLine(kind: string): string {
  if (kind === 'chair') return MOVE_HINT.push;
  if (kind === 'desk' || kind === 'wall' || kind === 'wood' || kind === 'pillar') return MOVE_HINT.block;
  if (kind === 'launch') return '必须贴墙。点哪面墙就挖出门洞，朝向跟着墙。靠近会被拍开摔倒。';
  if (kind === 'elevator') return '点哪面墙就贴哪面，朝向跟着墙。斜墙和三角、圆切口也能挂。';
  if (kind === 'pit') return '地上一张报纸。踩上去会眩晕。';
  if (kind === 'crate') return '棕色文件箱。碰到会眩晕，也会挡住路。';
  if (isWallMount(kind)) return '贴墙装饰，可从下面走过。点哪面墙就贴哪面，朝向跟着墙走。斜墙和三角、圆切口也能挂。';
  if (kind === 'player' || kind === 'pointLight' || kind === 'heavy' || kind === 'interceptor' || kind === 'void') {
    return kind === 'void'
      ? '从楼板挖掉。游戏里不铺遮罩色，能看见背景。矩形、圆形、三角都会改外轮廓并沿切口长出墙。'
      : MOVE_HINT.meta;
  }
  const spec = propSpec(kind);
  return spec ? MOVE_HINT[spec.move] : '';
}

function setLabel(id: string, v: number) {
  const lab = document.querySelector(`[data-for="${id}"]`);
  if (lab) lab.textContent = Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function readAtmo(def: LevelDef) {
  const a = def.atmosphere;
  const setC = (id: string, hex: string) => {
    ($(id) as HTMLInputElement).value = hex.length === 7 ? hex : '#ffffff';
  };
  const setN = (id: string, n: number) => {
    ($(id) as HTMLInputElement).value = String(n);
    setLabel(id, n);
  };
  setC('bg', a.background);
  setC('fog', a.fogColor);
  setN('fogNear', a.fogNear);
  setN('fogFar', a.fogFar);
  setN('exposure', a.exposure);
  setC('ambColor', a.ambient.color);
  setN('ambI', a.ambient.intensity);
  setC('hemiSky', a.hemisphere.sky);
  setC('hemiGround', a.hemisphere.ground);
  setN('hemiI', a.hemisphere.intensity);
  setC('lampColor', a.lampColor);
  setC('elevGlow', a.elevatorGlow);
  setN('lampI', a.lampIntensity);
  setN('ohY', a.overheadHeight);
  setN('lampDist', a.lampDistance ?? 4.5);
  setC('wallColor', a.wall.color);
  setC('floorColor', a.floor.color);
  setN('wallShine', a.wall.shininess);
  setN('floorShine', a.floor.shininess);
  setN('floorRepeat', a.floor.repeat ?? 8);
  $('skyKinds').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.sky === (a.sky ?? 'day')));
  $('furnTones').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tone === (a.furnitureTone ?? 'dark')));
  ($('minX') as HTMLInputElement).value = String(def.map.minX);
  ($('maxX') as HTMLInputElement).value = String(def.map.maxX);
  ($('minZ') as HTMLInputElement).value = String(def.map.minZ);
  ($('maxZ') as HTMLInputElement).value = String(def.map.maxZ);
}

function writeAtmo(def: LevelDef): { geom: boolean } {
  const a = def.atmosphere;
  const c = (id: string) => ($(id) as HTMLInputElement).value;
  const n = (id: string) => Number(($(id) as HTMLInputElement).value);
  const prevGeom = `${a.sky}|${a.elevatorGlow}|${a.wall.color}|${a.wall.shininess}|${a.wall.map}|${a.floor.color}|${a.floor.shininess}|${a.floor.map}|${a.floor.kind}|${a.floor.repeat}|${a.furnitureTone}`;
  a.background = c('bg');
  a.fogColor = c('fog');
  a.fogNear = n('fogNear');
  a.fogFar = n('fogFar');
  a.exposure = n('exposure');
  a.ambient.color = c('ambColor');
  a.ambient.intensity = Math.min(MAX_AMBIENT, Math.max(0, n('ambI')));
  a.hemisphere.sky = c('hemiSky');
  a.hemisphere.ground = c('hemiGround');
  a.hemisphere.intensity = Math.min(MAX_HEMISPHERE, Math.max(0, n('hemiI')));
  a.lampColor = c('lampColor');
  a.lampIntensity = Math.min(MAX_LIGHT_INTENSITY, n('lampI'));
  a.overheadHeight = n('ohY');
  a.lampDistance = Math.min(MAX_LIGHT_DISTANCE, n('lampDist'));
  a.followEnabled = false;
  a.elevatorGlow = c('elevGlow');
  a.wall.color = c('wallColor');
  a.wall.shininess = n('wallShine');
  a.floor.color = c('floorColor');
  a.floor.shininess = n('floorShine');
  a.floor.repeat = n('floorRepeat');
  const nextGeom = `${a.sky}|${a.elevatorGlow}|${a.wall.color}|${a.wall.shininess}|${a.wall.map}|${a.floor.color}|${a.floor.shininess}|${a.floor.map}|${a.floor.kind}|${a.floor.repeat}|${a.furnitureTone}`;
  for (const id of ['fogNear', 'fogFar', 'exposure', 'ambI', 'hemiI', 'lampI', 'ohY', 'lampDist', 'wallShine', 'floorShine', 'floorRepeat']) {
    setLabel(id, n(id));
  }
  return { geom: prevGeom !== nextGeom };
}

async function boot() {
  const preview = new ScenePreview();
  await preview.init($('viewport'));
  await loadFxCatalog();

  let cat: LevelCatalog = await loadLevelCatalog();
  ensureWeekdays(cat);
  let current = cat.levels.find((l) => l.id === cat.active) ?? cat.levels[0];
  let rebuildTimer = 0;

  const scheduleRebuild = () => {
    window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(() => {
      void preview.rebuild();
    }, 80);
  };

  const texInfo = () => {
    const fk = current.atmosphere.floor.map ? 'image' : (current.atmosphere.floor.kind ?? 'carpet');
    const names: Record<string, string> = { carpet: '程序地毯', wood: '程序木纹', tile: '程序地砖', image: current.atmosphere.floor.map ?? '自定义图' };
    $('texInfo').textContent = `地面 ${names[fk] ?? fk} · 墙 ${current.atmosphere.wall.map ?? '程序石膏'}`;
    $('floorKinds').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.kind === fk));
  };

  const syncBudget = () => {
    const n = current.pointLights?.length ?? 0;
    $('lightBudget').textContent = `点光 ${n}/${MAX_POINT_LIGHTS} · 超过手机就会卡，放满后要先删`;
  };

  const renderDays = () => {
    $('dayList').innerHTML = WEEKDAYS.map((s) => {
      const on = current.id === s.id ? 'on' : '';
      const tag = cat.active === s.id ? '<span class="tag ok">当前</span>' : '<span class="tag">备份</span>';
      return `<button type="button" class="item ${on}" data-id="${s.id}"><div><div>${s.label}</div><div class="hint" style="margin:0">${s.blurb}</div></div>${tag}</button>`;
    }).join('');
    $('dayList').querySelectorAll<HTMLElement>('.item').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.id as WeekdayId;
        const next = cat.levels.find((l) => l.id === id);
        if (!next) return;
        current = next;
        void preview.setLevel(current);
        readAtmo(current);
        texInfo();
        renderDays();
        syncBudget();
      });
    });
  };

  const toolsEl = $('toolGroups');
  toolsEl.innerHTML = TOOL_GROUPS.map(
    (g) =>
      `<div class="tool-sec"><h3>${g.title}</h3><p class="hint">${g.hint}</p><div class="tools">${g.tools
        .map((t) => `<button type="button" data-tool="${t.id}">${t.label}</button>`)
        .join('')}</div></div>`
  ).join('');
  const syncTool = () => {
    toolsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tool === preview.tool));
  };
    toolsEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.addEventListener('click', () => {
      preview.tool = b.dataset.tool as Tool;
      syncTool();
      syncMaskEdit();
    });
  });
  syncTool();

  const syncLightEdit = () => {
    const s = preview.selected;
    const box = $('lightEdit');
    const light = s?.kind === 'pointLight' ? preview.findLight(s.id) : undefined;
    box.hidden = !light;
    if (!light) return;
    ($('plColor') as HTMLInputElement).value = light.color.length === 7 ? light.color : '#fff6d8';
    ($('plY') as HTMLInputElement).value = String(light.y);
    ($('plI') as HTMLInputElement).value = String(light.intensity);
    ($('plDist') as HTMLInputElement).value = String(light.distance);
    setLabel('plY', light.y);
    setLabel('plI', light.intensity);
    setLabel('plDist', light.distance);
  };

  const syncDeskEdit = () => {
    const s = preview.selected;
    const box = $('deskEdit');
    const desk = s?.kind === 'desk' ? preview.findDesk(s.id) : undefined;
    box.hidden = !desk;
    if (!desk) return;
    $('deskTops').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.top === (desk.top ?? 'oak')));
    $('deskKits').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.kit === (desk.kit ?? 'simple')));
    $('deskFaces').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.face === (desk.face ?? 'pz')));
  };

  const syncChairEdit = () => {
    const s = preview.selected;
    const box = $('chairEdit');
    const chair = s?.kind === 'chair' ? preview.findChair(s.id) : undefined;
    box.hidden = !chair;
    if (!chair) return;
    $('chairStyles').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.style === (chair.style ?? 'task')));
  };

  const syncPlantEdit = () => {
    const s = preview.selected;
    const box = $('plantEdit');
    const plant = s?.kind === 'plant' ? preview.findProp(s.id) : undefined;
    box.hidden = !plant;
    if (!plant) return;
    $('plantKits').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.kit === (plant.plantKit ?? 'pot')));
  };

  const hzRows = ['hzRadiusRow', 'hzDurationRow', 'hzFactorRow', 'hzImpulseRow', 'hzLiftRow'] as const;
  const hzInputs: Record<keyof HazardTune, string> = {
    radius: 'hzRadius',
    duration: 'hzDuration',
    factor: 'hzFactor',
    impulse: 'hzImpulse',
    lift: 'hzLift',
  };
  const syncHazardEdit = () => {
    const s = preview.selected;
    const box = $('hazardEdit');
    const kind = s && isHazardKind(s.kind) ? s.kind : undefined;
    const prop = kind ? preview.findProp(s!.id) : undefined;
    box.hidden = !prop;
    if (!kind || !prop) return;
    const ui = HAZARD_UI[kind];
    $('hazardHint').textContent = ui.hint;
    const fx = mergeHazardFx(kind, prop.hazard);
    for (const row of hzRows) $(row).hidden = true;
    for (const f of ui.fields) {
      const row = $(f.row);
      row.hidden = false;
      const lab = row.querySelector('.hz-lab');
      if (lab) lab.textContent = f.label;
      const inp = $(hzInputs[f.key]) as HTMLInputElement;
      inp.min = String(f.min);
      inp.max = String(f.max);
      inp.step = String(f.step);
      const v = fx[f.key] ?? f.min;
      inp.value = String(v);
      setLabel(hzInputs[f.key], v);
    }
  };

  const syncToneEdit = () => {
    const box = $('toneEdit');
    const on = preview.canTone();
    box.hidden = !on;
    if (!on) return;
    const custom = !!preview.itemColor();
    const tone = preview.itemTone();
    $('itemTones').querySelectorAll('button').forEach((b) => {
      const t = (b as HTMLButtonElement).dataset.tone;
      b.classList.toggle('active', custom ? t === 'custom' : t === tone);
    });
    ($('itemColor') as HTMLInputElement).value = preview.itemColorSwatch();
  };

  const syncWallEdit = () => {
    const box = $('wallEdit');
    const on = preview.canWallColor();
    box.hidden = !on;
    if (!on) return;
    const s = preview.selected!;
    const own = preview.paintedFaceColor();
    const hex = preview.wallItemColor();
    ($('wallItemColor') as HTMLInputElement).value = hex.length === 7 ? hex : '#d8d0c4';
    const tone = own ? toneFromWallHex(own) : undefined;
    const faceMap = preview.paintedFaceMap();
    $('wallFaceHint').textContent = `这一面 ${wallFaceLabel(s.face!)}。贴图按原比例齐高或齐宽，不拉伸。`;
    $('faceTexInfo').textContent = faceMap ? `这一面 ${faceMap}` : '这一面没有贴图';
    $('wallItemTones').querySelectorAll('button').forEach((b) => {
      const t = (b as HTMLButtonElement).dataset.tone;
      b.classList.toggle('active', own ? t === tone : t === 'inherit');
    });
  };

  const syncMaskEdit = () => {
    const s = preview.selected;
    const box = $('maskEdit');
    const v = s?.kind === 'void' ? preview.findVoid(s.id) : undefined;
    const on = preview.tool === 'void' || !!v;
    box.hidden = !on;
    if (!on) return;
    const shape = v ? voidShapeOf(v) : preview.lastVoidShape;
    $('maskShapes').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.shape === shape));
    $('maskSizeRow').hidden = !v;
    if (!v) return;
    ($('maskW') as HTMLInputElement).value = String(Number((v.maxX - v.minX).toFixed(2)));
    ($('maskH') as HTMLInputElement).value = String(Number((v.maxZ - v.minZ).toFixed(2)));
  };

  const syncYaw = () => {
    const box = $('yawEdit');
    const on = preview.canYaw();
    box.hidden = !on;
    if (!on) return;
    const yaw = preview.getYaw();
    const deg = Math.round((yaw * 180) / Math.PI);
    $('yawDeg').textContent = `${deg}°`;
    const r = 33;
    $('yawKnob').style.transform = `translate(${Math.sin(yaw) * r}px, ${-Math.cos(yaw) * r}px)`;
    $('yawSnaps').querySelectorAll('button').forEach((b) => {
      const snap = Number((b as HTMLButtonElement).dataset.deg);
      b.classList.toggle('active', Math.abs(((deg - snap + 540) % 360) - 180) < 8 || Math.abs(deg - snap) < 8);
    });
  };

  preview.onSelect = () => {
    const s = preview.selected;
    $('selInfo').textContent = s
      ? s.kind === 'pointLight'
        ? `点光 · ${s.id}（拖位置，右侧改强度和半径）`
        : s.kind === 'chair'
          ? `椅子 · ${s.id}（右侧换款式、转朝向）`
          : s.kind === 'desk'
            ? `工位桌 · ${s.id}（右侧换桌面、物品和朝向）`
            : s.kind === 'plant'
              ? `绿植 · ${s.id}（右侧换组合，同款每盆也会不一样）`
              : isWallSnap(s.kind)
              ? `${s.kind === 'elevator' ? '电梯区' : propSpec(s.kind)?.label ?? s.kind} · ${s.id}（拖到别的墙会重新贴面）`
              : (s.kind === 'wall' || s.kind === 'pillar') && s.face
              ? `${s.kind === 'pillar' ? '柱' : '墙'} · ${s.id} · 面 ${wallFaceLabel(s.face)}（右侧给这一面取色或贴图）`
              : s.kind === 'heavy'
              ? `主管锚点 · ${s.id}`
              : s.kind === 'interceptor'
                ? `拦截点 · ${s.id}`
                : s.kind === 'void'
                ? `挖空 · ${s.id}（拖中间移动，拖边/角改长宽${preview.findVoid(s.id) && voidShapeOf(preview.findVoid(s.id)!) !== 'rect' ? '，右侧可转朝向' : ''}）`
              : `${propSpec(s.kind)?.label ?? s.kind} · ${s.id}`
      : `未选中。点物体，或用「点光」点在要亮的地方（最多 ${MAX_POINT_LIGHTS} 盏）。`;
    $('moveHint').textContent = s ? moveLine(s.kind) : '';
    syncLightEdit();
    syncDeskEdit();
    syncChairEdit();
    syncPlantEdit();
    syncHazardEdit();
    syncToneEdit();
    syncWallEdit();
    syncYaw();
    syncMaskEdit();
    syncBudget();
  };
  preview.onChange = (rebuild) => {
    syncBudget();
    if (rebuild) scheduleRebuild();
  };
  preview.onWarn = toast;

  await preview.setLevel(current);
  readAtmo(current);
  texInfo();
  renderDays();
  syncBudget();
  $('loading').remove();

  const lookInputs = [
    'bg', 'fog', 'fogNear', 'fogFar', 'exposure', 'ambColor', 'ambI', 'hemiSky', 'hemiGround', 'hemiI', 'lampColor', 'lampI', 'ohY', 'lampDist',
    'elevGlow', 'wallColor', 'floorColor', 'wallShine', 'floorShine', 'floorRepeat',
  ];
  for (const id of lookInputs) {
    $(id).addEventListener('input', () => {
      const { geom } = writeAtmo(current);
      preview.applyLook();
      if (geom) scheduleRebuild();
    });
  }

  $('skyKinds').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.addEventListener('click', () => {
      applySky(current.atmosphere, b.dataset.sky as SkyKind);
      readAtmo(current);
      preview.applyLook();
      scheduleRebuild();
    });
  });

  $('furnTones').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.addEventListener('click', () => {
      const tone = b.dataset.tone as FurnitureTone;
      current.atmosphere.furnitureTone = tone;
      preview.lastTone = tone;
      readAtmo(current);
      scheduleRebuild();
    });
  });

  const commitMap = () => {
    current.map.minX = Number(($('minX') as HTMLInputElement).value);
    current.map.maxX = Number(($('maxX') as HTMLInputElement).value);
    current.map.minZ = Number(($('minZ') as HTMLInputElement).value);
    current.map.maxZ = Number(($('maxZ') as HTMLInputElement).value);
    scheduleRebuild();
  };
  for (const id of ['minX', 'maxX', 'minZ', 'maxZ']) $(id).addEventListener('change', commitMap);

  $('btnDelete').addEventListener('click', () => preview.deleteSelected());

  const commitMaskSize = () => {
    const w = Number(($('maskW') as HTMLInputElement).value);
    const d = Number(($('maskH') as HTMLInputElement).value);
    if (!Number.isFinite(w) || !Number.isFinite(d)) return;
    preview.applyMaskSize(w, d);
    syncMaskEdit();
  };
  $('maskW').addEventListener('change', commitMaskSize);
  $('maskH').addEventListener('change', commitMaskSize);
  $('maskShapes').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.addEventListener('click', () => {
      preview.applyVoidShape(b.dataset.shape as VoidShape);
      syncMaskEdit();
      syncYaw();
    });
  });

  const applyDeskLook = (patch: { top?: DeskTop; kit?: DeskKit; face?: DeskFace }) => {
    const s = preview.selected;
    if (!s || s.kind !== 'desk') return;
    const desk = preview.findDesk(s.id);
    if (!desk) return;
    if (patch.top) {
      desk.top = patch.top;
      preview.lastDeskTop = patch.top;
    }
    if (patch.kit) {
      desk.kit = patch.kit;
      preview.lastDeskKit = patch.kit;
    }
    if (patch.face) {
      desk.face = patch.face;
      desk.rotY = faceYaw(patch.face);
      preview.lastDeskFace = patch.face;
      preview.lastYaw = desk.rotY;
    }
    syncDeskEdit();
    syncYaw();
    scheduleRebuild();
  };
  $('deskTops').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.addEventListener('click', () => applyDeskLook({ top: b.dataset.top as DeskTop }));
  });
  $('deskKits').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.addEventListener('click', () => applyDeskLook({ kit: b.dataset.kit as DeskKit }));
  });
  $('deskFaces').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.addEventListener('click', () => applyDeskLook({ face: b.dataset.face as DeskFace }));
  });
  $('chairStyles').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.addEventListener('click', () => {
      preview.applyChairStyle(b.dataset.style as ChairStyle);
      syncChairEdit();
    });
  });
  $('plantKits').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.addEventListener('click', () => {
      preview.applyPlantKit(b.dataset.kit as PlantKit);
      syncPlantEdit();
    });
  });
  const writeHazard = (key: keyof HazardTune, raw: number) => {
    preview.applyHazard({ [key]: raw });
    syncHazardEdit();
  };
  ($('hzRadius') as HTMLInputElement).addEventListener('input', () => writeHazard('radius', Number(($('hzRadius') as HTMLInputElement).value)));
  ($('hzDuration') as HTMLInputElement).addEventListener('input', () => writeHazard('duration', Number(($('hzDuration') as HTMLInputElement).value)));
  ($('hzFactor') as HTMLInputElement).addEventListener('input', () => writeHazard('factor', Number(($('hzFactor') as HTMLInputElement).value)));
  ($('hzImpulse') as HTMLInputElement).addEventListener('input', () => writeHazard('impulse', Number(($('hzImpulse') as HTMLInputElement).value)));
  ($('hzLift') as HTMLInputElement).addEventListener('input', () => writeHazard('lift', Number(($('hzLift') as HTMLInputElement).value)));
  $('itemTones').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.addEventListener('click', () => {
      const t = b.dataset.tone;
      if (t === 'custom') preview.applyColor(preview.itemColor() ?? preview.lastColor ?? DEFAULT_CUSTOM_COLOR);
      else preview.applyTone(t as FurnitureTone);
      syncToneEdit();
    });
  });
  $('itemColor').addEventListener('input', () => {
    preview.applyColor(($('itemColor') as HTMLInputElement).value);
    syncToneEdit();
  });
  $('wallItemTones').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.addEventListener('click', () => {
      const t = b.dataset.tone;
      if (t === 'inherit') preview.applyWallColor(null);
      else preview.applyWallColor(wallToneHex(t as FurnitureTone));
      syncWallEdit();
    });
  });
  $('wallItemColor').addEventListener('input', () => {
    preview.applyWallColor(($('wallItemColor') as HTMLInputElement).value);
    syncWallEdit();
  });

  const setYaw = (rad: number) => {
    preview.applyYaw(rad);
    syncYaw();
    syncDeskEdit();
  };
  const yawDial = $('yawDial');
  const yawFromPtr = (ev: PointerEvent) => {
    const r = yawDial.getBoundingClientRect();
    return Math.atan2(ev.clientX - (r.left + r.width / 2), -(ev.clientY - (r.top + r.height / 2)));
  };
  let yawDrag = false;
  yawDial.addEventListener('pointerdown', (ev) => {
    yawDrag = true;
    yawDial.setPointerCapture?.(ev.pointerId);
    setYaw(yawFromPtr(ev));
  });
  yawDial.addEventListener('pointermove', (ev) => {
    if (yawDrag) setYaw(yawFromPtr(ev));
  });
  yawDial.addEventListener('pointerup', () => { yawDrag = false; });
  yawDial.addEventListener('pointerleave', () => { yawDrag = false; });
  $('yawSnaps').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.addEventListener('click', () => setYaw((Number(b.dataset.deg) * Math.PI) / 180));
  });

  const writeSelectedLight = () => {
    const s = preview.selected;
    if (!s || s.kind !== 'pointLight') return;
    const light = preview.findLight(s.id);
    if (!light) return;
    light.color = ($('plColor') as HTMLInputElement).value;
    light.y = Number(($('plY') as HTMLInputElement).value);
    light.intensity = Number(($('plI') as HTMLInputElement).value);
    light.distance = Number(($('plDist') as HTMLInputElement).value);
    Object.assign(light, clampLightParams(light));
    ($('plY') as HTMLInputElement).value = String(light.y);
    ($('plI') as HTMLInputElement).value = String(light.intensity);
    ($('plDist') as HTMLInputElement).value = String(light.distance);
    setLabel('plY', light.y);
    setLabel('plI', light.intensity);
    setLabel('plDist', light.distance);
    preview.applyLook();
  };
  for (const id of ['plColor', 'plY', 'plI', 'plDist']) {
    $(id).addEventListener('input', writeSelectedLight);
  }

  const setCam = (mode: 'orbit' | 'top' | 'play') => {
    preview.cam = mode;
    $('camOrbit').classList.toggle('active', mode === 'orbit');
    $('camTop').classList.toggle('active', mode === 'top');
    $('camPlay').classList.toggle('active', mode === 'play');
  };
  $('camOrbit').addEventListener('click', () => setCam('orbit'));
  $('camTop').addEventListener('click', () => setCam('top'));
  $('camPlay').addEventListener('click', () => setCam('play'));

  const save = async (msg: string) => {
    current.pointLights = current.pointLights ?? [];
    const i = cat.levels.findIndex((l) => l.id === current.id);
    if (i >= 0) cat.levels[i] = current;
    const res = await saveLevelCatalog(cat);
    if (!res.ok) toast(`保存失败：${res.error}`);
    else toast(msg);
    renderDays();
  };

  $('btnSave').addEventListener('click', () => void save(`已写入 ${current.label} → /levels/catalog.json`));
  $('btnActive').addEventListener('click', () => {
    cat.active = current.id;
    void save(`游戏当前关 = ${current.label}。打开 :5173 即用。`);
  });
  $('btnFromMon').addEventListener('click', () => {
    const mon = cat.levels.find((l) => l.id === 'monday');
    if (!mon || current.id === 'monday') {
      toast('已经是周一，或找不到周一');
      return;
    }
    const atmo: Atmosphere = structuredClone(current.atmosphere);
    const next = cloneLevel(mon, current.id, current.label, atmo);
    const i = cat.levels.findIndex((l) => l.id === current.id);
    cat.levels[i] = next;
    current = next;
    void preview.setLevel(current);
    readAtmo(current);
    texInfo();
    syncBudget();
    toast('已带入周一布局，氛围未改');
  });
  $('btnReset').addEventListener('click', () => {
    const next = seedLevel(current.id);
    const i = cat.levels.findIndex((l) => l.id === current.id);
    cat.levels[i] = next;
    current = next;
    void preview.setLevel(current);
    readAtmo(current);
    texInfo();
    syncBudget();
    toast('已恢复该关原型');
  });
  $('btnPack').addEventListener('click', () => downloadJson('levels-catalog.json', cat));

  const upload = async (kind: 'floor' | 'wall', file: File) => {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const name = `${current.id}-${kind}.${ext}`;
    const res = await saveLevelTexture(name, await file.arrayBuffer());
    if (!res.ok || !res.file) {
      toast(`上传失败：${res.error}`);
      return;
    }
    if (kind === 'floor') {
      current.atmosphere.floor.map = res.file;
      current.atmosphere.floor.kind = 'image';
    }
    else current.atmosphere.wall.map = res.file;
    texInfo();
    scheduleRebuild();
    toast(`已引用 ${res.file}，记得保存本关`);
  };
  const uploadFace = async (file: File) => {
    if (!preview.canWallColor() || !preview.selected?.face) {
      toast('先用选择工具点到要贴的那一面');
      return;
    }
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const face = preview.selected.face;
    const name = `${current.id}-face-${preview.selected.id}-${face}.${ext}`;
    const res = await saveLevelTexture(name, await file.arrayBuffer());
    if (!res.ok || !res.file) {
      toast(`上传失败：${res.error}`);
      return;
    }
    preview.applyWallMap(res.file);
    syncWallEdit();
    toast(`已贴到这一面 ${res.file}，记得保存本关`);
  };
  bindDrop($('floorDrop'), $('floorFile') as HTMLInputElement, (f) => void upload('floor', f));
  bindDrop($('wallDrop'), $('wallFile') as HTMLInputElement, (f) => void upload('wall', f));
  bindDrop($('faceDrop'), $('faceFile') as HTMLInputElement, (f) => void uploadFace(f));
  $('btnClearFaceMap').addEventListener('click', () => {
    if (!preview.canWallColor()) return;
    preview.applyWallMap(null);
    syncWallEdit();
  });
  $('floorKinds').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.addEventListener('click', () => {
      const kind = b.dataset.kind as FloorKind;
      current.atmosphere.floor.kind = kind;
      if (kind !== 'image') current.atmosphere.floor.map = null;
      texInfo();
      scheduleRebuild();
    });
  });
  $('btnClearFloor').addEventListener('click', () => {
    current.atmosphere.floor.map = null;
    current.atmosphere.floor.kind = 'carpet';
    texInfo();
    scheduleRebuild();
  });
  $('btnClearWall').addEventListener('click', () => {
    current.atmosphere.wall.map = null;
    texInfo();
    scheduleRebuild();
  });

  const status = $('status');
  setInterval(() => {
    status.textContent = preview.status || (preview.selected ? `${preview.selected.kind}` : preview.tool);
  }, 200);
}

boot().catch((err) => {
  const el = document.querySelector('#loading .hint')!;
  el.textContent = '启动失败：' + (err?.message ?? err);
  console.error(err);
});
