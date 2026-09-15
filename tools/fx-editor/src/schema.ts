import { BATTLE_SLOT_IDS, type EnemySkillId } from '../../../src/catalog';
import type { ActorId, CrowdActorId, DashKey, DashReactKind, LineId, SkillKey, Lv } from '../../../src/fx/catalog';
import { CHAIN_STYLE_META, CHANNEL_STAMP_META, CROWD_ACTOR_IDS, DASH_REACT_META, STUN_ELEM_META } from '../../../src/fx/catalog';
import type { DayPlayKit } from '../../../src/fx/days';
import type { HazardKind } from '../../../src/levels';
import { rosterSlot } from '../../../src/roster';

export type FieldKind = 'range' | 'int' | 'color' | 'bool' | 'select';

export interface Field {
  path: string;
  label: string;
  kind: FieldKind;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  options?: { id: string; name: string }[];
}

export type TrackId = 'common' | DashKey | SkillKey | 'hazards' | 'enemySkills';

export interface TrackDef {
  id: TrackId;
  name: string;
  tag: string;
  group: 'common' | 'dash' | 'skill' | 'hazard' | 'enemy';
  hasLevel: boolean;
  blurb: string;
}

export const TRACKS: TrackDef[] = [
  {
    id: 'common',
    name: '撞物',
    tag: '场景',
    group: 'common',
    hasLevel: false,
    blurb: '冲到家具/箱子上的碎片。人被撞后的倒地/减速/眩晕在对应冲刺的「角色反应」。',
  },
  {
    id: 'none',
    name: '无系冲刺',
    tag: '默认',
    group: 'dash',
    hasLevel: false,
    blurb: '没抽到属性时的冲刺判定和残影。各角色被撞后的状态在右侧「角色反应」。',
  },
  {
    id: 'brute',
    name: '蛮力',
    tag: '属性',
    group: 'dash',
    hasLevel: true,
    blurb: 'LV1 撞更猛 · LV2 时间/半径 · LV3 冲量再抬。主管推开/同事倒地在「角色反应」。',
  },
  {
    id: 'slump',
    name: '倦怠',
    tag: '属性',
    group: 'dash',
    hasLevel: true,
    blurb: 'LV1 撞人后周围减速 · LV2 圈更大更久 · LV3 主管也会被拖慢。谁减速、持续多久在「角色反应」。',
  },
  {
    id: 'phantom',
    name: '幻影',
    tag: '属性',
    group: 'dash',
    hasLevel: true,
    blurb: 'LV1 穿人晕 · LV2 穿人回充 · LV3 冲完虚化。各角色眩晕时长在「角色反应」。',
  },
  {
    id: 'decoy',
    name: '摸鱼分身',
    tag: '技能',
    group: 'skill',
    hasLevel: true,
    blurb: 'LV1 吸仇恨 · LV2 更久 · LV3 到期爆炸。爆炸倒地用被炸角色自己的被动。',
  },
  {
    id: 'keyboard',
    name: '回旋键盘',
    tag: '技能',
    group: 'skill',
    hasLevel: true,
    blurb: 'LV1 去程放倒 · LV2 更宽 · LV3 返程也倒。',
  },
  {
    id: 'coffee',
    name: '咖啡',
    tag: '技能',
    group: 'skill',
    hasLevel: true,
    blurb: 'LV1 朝前泼一滩 · LV2 渍更大更久 · LV3 连泼三滩再溅一大摊。',
  },
  {
    id: 'hazards',
    name: '陷阱',
    tag: '场景',
    group: 'hazard',
    hasLevel: false,
    blurb: '只显示本关场景里实际摆了的陷阱。数值五关共用，改一处全关生效。',
  },
  {
    id: 'enemySkills',
    name: '同事主动',
    tag: '敌人',
    group: 'enemy',
    hasLevel: false,
    blurb: '只显示本关角色规划里挂上的同事技能。冷却和前摇给玩法用，颜色给脉冲圈。',
  },
];

export function tracksForDay(kit: DayPlayKit): TrackDef[] {
  return TRACKS.filter((t) => {
    if (t.group === 'dash') return t.id === 'none' || kit.dashes.includes(t.id as LineId);
    if (t.group === 'skill') return kit.skills.includes(t.id as SkillKey);
    if (t.group === 'hazard') return kit.hazards.length > 0;
    if (t.group === 'enemy') return false;
    return true;
  });
}

export interface ActorDef {
  id: ActorId;
  name: string;
  tag: string;
  blurb: string;
}

/** 与 BATTLE_SLOT_IDS 对齐：玩家 / 普通男 / 普通女 / 主管 / 拦截者 */
const ACTOR_IDS: ActorId[] = ['player', ...BATTLE_SLOT_IDS];

export const ACTORS: ActorDef[] = ACTOR_IDS.map((id) => {
  const s = rosterSlot(id)!;
  return {
    id,
    name: s.label,
    tag: s.kind === 'player' ? '你' : s.enemy ?? 'A',
    blurb:
      s.kind === 'player'
        ? '先选圆环样式，再分别改内环和外环。冲刺残影仍在左侧构筑。男女主角共用这一套。'
        : `${s.blurb} 判定加时改为头顶飘 +N分钟（数字跟数值）。选中角色就会循环预览，不用贴近。读条文件夹仍在游戏里。`,
  };
});

export interface FieldSection {
  title: string;
  fields: Field[];
  /** 陷阱 kind / 同事技能 id，按关过滤用 */
  id?: HazardKind | EnemySkillId;
}

function mistFields(p: string): Field[] {
  return [
    { path: `${p}.enabled`, label: '启用气雾', kind: 'bool' },
    { path: `${p}.color`, label: '气雾颜色', kind: 'color' },
    { path: `${p}.opacity`, label: '气雾透明度', kind: 'range', min: 0.05, max: 0.9, step: 0.02 },
    { path: `${p}.additive`, label: '气雾加色', kind: 'bool' },
    { path: `${p}.count`, label: '团数', kind: 'int', min: 0, max: 16, step: 1 },
    { path: `${p}.life`, label: '寿命', kind: 'range', min: 0.1, max: 1.2, step: 0.02 },
    { path: `${p}.size`, label: '大小', kind: 'range', min: 0.08, max: 1.2, step: 0.02 },
    { path: `${p}.grow`, label: '胀开', kind: 'range', min: 0.2, max: 4, step: 0.05 },
    { path: `${p}.flatten`, label: '压扁', kind: 'range', min: 0.1, max: 1, step: 0.02 },
  ];
}

function paperFields(p: string, object: boolean): Field[] {
  return [
    { path: `${p}.color`, label: object ? '碎片颜色' : '纸颜色', kind: 'color' },
    { path: `${p}.count`, label: object ? '碎片数量' : '纸片数量', kind: 'int', min: 0, max: 24, step: 1 },
    { path: `${p}.spawnY`, label: '爆开高度', kind: 'range', min: 0.3, max: 2.2, step: 0.05 },
    { path: `${p}.speed`, label: '横飞', kind: 'range', min: 0.5, max: 12, step: 0.2 },
    { path: `${p}.upMin`, label: '上抛最小', kind: 'range', min: 0.5, max: 8, step: 0.1 },
    { path: `${p}.upMax`, label: '上抛最大', kind: 'range', min: 1, max: 12, step: 0.1 },
  ];
}

function dashSections(line: DashKey, lv: Lv): FieldSection[] {
  const p = `lines.${line}.${lv}`;
  const out: FieldSection[] = [
    {
      title: '冲刺判定',
      fields: [
        { path: `${p}.hit.time`, label: '时长', kind: 'range', min: 0.08, max: 0.6, step: 0.01 },
        { path: `${p}.hit.speed`, label: '速度', kind: 'range', min: 6, max: 22, step: 0.5 },
        { path: `${p}.hit.cooldown`, label: '冷却', kind: 'range', min: 0.3, max: 3, step: 0.05 },
        { path: `${p}.hit.radius`, label: '命中半径', kind: 'range', min: 0.4, max: 2.5, step: 0.05 },
        { path: `${p}.hit.impulse`, label: '默认击飞冲量', kind: 'range', min: 0, max: 1200, step: 10, hint: '倒地/减速冲量为 0 时用这个。改完播一次冲刺就能看出远近。' },
        { path: `${p}.hit.maxHits`, label: '单次上限', kind: 'int', min: 0, max: 20, step: 1, hint: '0 = 不限制' },
        { path: `${p}.hit.oncePerDash`, label: '每人只结算一次', kind: 'bool' },
      ],
    },
    {
      title: '无影残影',
      fields: [
        { path: `${p}.trail.color`, label: '颜色', kind: 'color' },
        { path: `${p}.trail.ghost`, label: '无影剪影', kind: 'bool' },
        { path: `${p}.trail.additive`, label: '加色发光', kind: 'bool' },
        { path: `${p}.trail.opacity`, label: '透明度', kind: 'range', min: 0.08, max: 0.9, step: 0.02 },
        { path: `${p}.trail.life`, label: '寿命', kind: 'range', min: 0.06, max: 0.6, step: 0.01 },
        { path: `${p}.trail.stretch`, label: '沿路径拉长', kind: 'range', min: 0.6, max: 4, step: 0.05 },
        { path: `${p}.trail.copies`, label: '叠层', kind: 'int', min: 1, max: 5, step: 1 },
        { path: `${p}.trail.interval`, label: '间隔', kind: 'range', min: 0.01, max: 0.12, step: 0.005 },
      ],
    },
  ];
  if (line === 'slump') {
    out.push({
      title: '倦怠圈样子',
      fields: [
        { path: `${p}.slump.color`, label: '圈颜色', kind: 'color' },
        { path: `${p}.slump.opacity`, label: '圈透明度', kind: 'range', min: 0.1, max: 0.9, step: 0.02 },
        { path: `${p}.slump.pulseLife`, label: '圈寿命', kind: 'range', min: 0.15, max: 1.2, step: 0.02 },
      ],
    });
  }
  if (line === 'phantom') {
    out.push({
      title: '穿人',
      fields: [
        { path: `${p}.phantom.cdRefund`, label: '穿人回充', kind: 'range', min: 0, max: 1.2, step: 0.05 },
        { path: `${p}.phantom.phaseTime`, label: '冲完虚化', kind: 'range', min: 0, max: 4, step: 0.1, hint: '0 = 不虚化' },
      ],
    });
  }
  return out;
}

export function dashReactFields(line: DashKey, lv: Lv, actor: CrowdActorId, kind: DashReactKind): Field[] {
  const p = `lines.${line}.${lv}.react.${actor}`;
  const kindField: Field = {
    path: `${p}.kind`,
    label: '状态',
    kind: 'select',
    options: DASH_REACT_META.map((m) => ({ id: m.id, name: m.name })),
  };
  if (kind === 'none') {
    return [kindField, { path: `${p}.bounce`, label: '弹开玩家', kind: 'bool', hint: '撞上后打断冲刺，玩家被弹回去' }];
  }
  if (kind === 'knock') {
    return [kindField, { path: `${p}.impulse`, label: '击飞冲量', kind: 'range', min: 0, max: 1200, step: 10, hint: '0 = 用整体默认击飞冲量' }];
  }
  if (kind === 'stun') {
    return [kindField, { path: `${p}.stun`, label: '眩晕时长', kind: 'range', min: 0.1, max: 2.5, step: 0.05 }];
  }
  if (kind === 'slow') {
    return [
      kindField,
      { path: `${p}.duration`, label: '减速持续', kind: 'range', min: 0.4, max: 8, step: 0.1 },
      { path: `${p}.factor`, label: '速度倍率', kind: 'range', min: 0.1, max: 0.9, step: 0.02, hint: '越小越慢' },
      { path: `${p}.radius`, label: '扩散半径', kind: 'range', min: 0.4, max: 5, step: 0.05 },
      { path: `${p}.impulse`, label: '倒地冲量', kind: 'range', min: 0, max: 1200, step: 10, hint: '0 = 只减速不倒' },
    ];
  }
  return [
    kindField,
    { path: `${p}.impulse`, label: '推开冲量', kind: 'range', min: 0, max: 1400, step: 10 },
    { path: `${p}.stun`, label: '眩晕时长', kind: 'range', min: 0, max: 2, step: 0.05, hint: '0 = 只推不晕' },
  ];
}

const LOOK_FIELDS: Field[] = [
  { path: 'color', label: '圈色', kind: 'color' },
  { path: 'opacity', label: '圈透明', kind: 'range', min: 0.1, max: 1, step: 0.02 },
  { path: 'squash', label: '前摇下蹲', kind: 'range', min: 0.55, max: 1, step: 0.01, hint: '1 = 不压扁。没有攻击动作，靠蹲一下表示前摇。' },
];

function withPrefix(prefix: string, fields: Field[]): Field[] {
  return fields.map((f) => ({ ...f, path: `${prefix}.${f.path}` }));
}

/** 某个同事主动技能的配置。角色面板和（若打开）构筑轨道共用。 */
export function enemySkillSections(id: EnemySkillId): FieldSection[] {
  const p = `enemySkills.${id}`;
  const look: FieldSection = { title: '样子', fields: withPrefix(p, LOOK_FIELDS) };
  if (id === 'cut-in') {
    return [
      {
        title: '截杀 · 判定',
        fields: [
          { path: `${p}.cooldown`, label: '冷却', kind: 'range', min: 3, max: 16, step: 0.5 },
          { path: `${p}.windup`, label: '前摇', kind: 'range', min: 0.1, max: 1.2, step: 0.05 },
          { path: `${p}.duration`, label: '冲刺时长', kind: 'range', min: 0.2, max: 1.2, step: 0.05 },
          { path: `${p}.radius`, label: '起手距离', kind: 'range', min: 3, max: 14, step: 0.2 },
          { path: `${p}.speed`, label: '冲刺速度', kind: 'range', min: 4, max: 12, step: 0.1 },
          { path: `${p}.lock`, label: '锁链秒', kind: 'range', min: 0.4, max: 4, step: 0.05, hint: '扣住玩家、打断冲刺。' },
        ],
      },
      {
        title: '样子',
        fields: [
          { path: `${p}.color`, label: '光色', kind: 'color' },
          { path: `${p}.opacity`, label: '光强', kind: 'range', min: 0.1, max: 1, step: 0.02, hint: '链条自发光 + 外发光；被栓住的玩家发光，释法的人不亮。' },
          { path: `${p}.squash`, label: '前摇下蹲', kind: 'range', min: 0.55, max: 1, step: 0.01, hint: '1 = 不压扁。没有攻击动作，靠蹲一下表示前摇。' },
        ],
      },
      {
        title: '锁链',
        fields: [
          {
            path: `${p}.chainStyle`,
            label: '样式',
            kind: 'select',
            options: CHAIN_STYLE_META.map((m) => ({ id: m.id, name: `${m.name} · ${m.blurb}` })),
            hint: '共享几何、对象池，不另载模型。',
          },
          { path: `${p}.chainWidth`, label: '链粗', kind: 'range', min: 0.04, max: 0.18, step: 0.005, hint: '从双手连到玩家脖子。' },
          { path: `${p}.chainSag`, label: '下垂', kind: 'range', min: 0, max: 1.2, step: 0.02 },
        ],
      },
    ];
  }
  if (id === 'desk-slam') {
    return [
      {
        title: '拍桌 · 判定',
        fields: [
          { path: `${p}.cooldown`, label: '冷却', kind: 'range', min: 4, max: 18, step: 0.5 },
          { path: `${p}.windup`, label: '前摇', kind: 'range', min: 0.1, max: 1.2, step: 0.05 },
          { path: `${p}.duration`, label: '减速持续', kind: 'range', min: 0.4, max: 3, step: 0.05 },
          { path: `${p}.radius`, label: '圈半径', kind: 'range', min: 1, max: 5, step: 0.05 },
          { path: `${p}.factor`, label: '速度倍率', kind: 'range', min: 0.2, max: 0.8, step: 0.02 },
        ],
      },
      look,
      {
        title: '周围道具',
        fields: [
          { path: `${p}.knockImpulse`, label: '弹飞冲量', kind: 'range', min: 80, max: 900, step: 10, hint: '圈里椅子/绿植/垃圾桶等向外弹。' },
          { path: `${p}.knockLift`, label: '抬起', kind: 'range', min: 0, max: 80, step: 2 },
          { path: `${p}.paper`, label: '纸片数量', kind: 'int', min: 0, max: 24, step: 1 },
        ],
      },
    ];
  }
  return [
    {
      title: '喊人 · 判定',
      fields: [
        { path: `${p}.cooldown`, label: '冷却', kind: 'range', min: 4, max: 18, step: 0.5 },
        { path: `${p}.windup`, label: '前摇', kind: 'range', min: 0.1, max: 1, step: 0.05 },
        { path: `${p}.duration`, label: '减速持续', kind: 'range', min: 0.6, max: 4, step: 0.05 },
        { path: `${p}.radius`, label: '喊人半径', kind: 'range', min: 2, max: 9, step: 0.1, hint: '玩家走进这圈就站住喊，不用贴身。' },
        { path: `${p}.factor`, label: '减速倍率', kind: 'range', min: 0.2, max: 0.9, step: 0.05, hint: '越小越慢。' },
      ],
    },
    look,
    {
      title: '喊人圈',
      fields: [
        { path: `${p}.waves`, label: '圈数', kind: 'int', min: 1, max: 5, step: 1, hint: '立着的光圈从胸口飞向玩家，不是铺在地上的圈。' },
        { path: `${p}.waveGap`, label: '圈间隔', kind: 'range', min: 0.04, max: 0.4, step: 0.01, hint: '每圈错开飞出的时间。' },
      ],
    },
  ];
}

export function fieldSections(track: TrackDef, lv: Lv, kit?: DayPlayKit): FieldSection[] {
  if (track.id === 'hazards') {
    const all: FieldSection[] = [
      {
        id: 'wet',
        title: '拖地未干',
        fields: [
          { path: 'hazards.wet.color', label: '水色', kind: 'color' },
          { path: 'hazards.wet.opacity', label: '透明度', kind: 'range', min: 0.1, max: 1, step: 0.02 },
          { path: 'hazards.wet.radius', label: '半径', kind: 'range', min: 0.4, max: 2, step: 0.05 },
          { path: 'hazards.wet.duration', label: '减速持续', kind: 'range', min: 0.3, max: 3, step: 0.05 },
          { path: 'hazards.wet.factor', label: '速度倍率', kind: 'range', min: 0.2, max: 0.9, step: 0.02 },
        ],
      },
      {
        id: 'pit',
        title: '报纸',
        fields: [
          { path: 'hazards.pit.color', label: '颜色', kind: 'color' },
          { path: 'hazards.pit.opacity', label: '透明度', kind: 'range', min: 0.1, max: 1, step: 0.02 },
          { path: 'hazards.pit.radius', label: '半径', kind: 'range', min: 0.3, max: 1.4, step: 0.05 },
          { path: 'hazards.pit.duration', label: '眩晕秒', kind: 'range', min: 0.6, max: 3, step: 0.05 },
        ],
      },
      {
        id: 'crate',
        title: '文件箱',
        fields: [
          { path: 'hazards.crate.color', label: '颜色', kind: 'color' },
          { path: 'hazards.crate.opacity', label: '透明度', kind: 'range', min: 0.1, max: 1, step: 0.02 },
          { path: 'hazards.crate.radius', label: '半径', kind: 'range', min: 0.3, max: 1.4, step: 0.05 },
          { path: 'hazards.crate.duration', label: '眩晕秒', kind: 'range', min: 0.6, max: 3, step: 0.05 },
        ],
      },
      {
        id: 'launch',
        title: '弹簧门',
        fields: [
          { path: 'hazards.launch.color', label: '颜色', kind: 'color' },
          { path: 'hazards.launch.opacity', label: '透明度', kind: 'range', min: 0.1, max: 1, step: 0.02 },
          { path: 'hazards.launch.radius', label: '感应距离', kind: 'range', min: 0.35, max: 1.8, step: 0.05 },
          { path: 'hazards.launch.impulse', label: '弹回冲量', kind: 'range', min: 200, max: 900, step: 10 },
          { path: 'hazards.launch.lift', label: '抬起', kind: 'range', min: 8, max: 80, step: 2 },
          { path: 'hazards.launch.duration', label: '摔倒秒', kind: 'range', min: 0.6, max: 2.2, step: 0.05 },
        ],
      },
      {
        id: 'alarm',
        title: '隐藏地板',
        fields: [
          { path: 'hazards.alarm.color', label: '颜色', kind: 'color' },
          { path: 'hazards.alarm.opacity', label: '透明度', kind: 'range', min: 0.04, max: 0.4, step: 0.02 },
          { path: 'hazards.alarm.radius', label: '地板半径', kind: 'range', min: 0.35, max: 1.8, step: 0.05 },
          { path: 'hazards.alarm.impulse', label: '弹飞冲量', kind: 'range', min: 200, max: 900, step: 10 },
          { path: 'hazards.alarm.lift', label: '弹飞高度', kind: 'range', min: 40, max: 220, step: 2 },
          { path: 'hazards.alarm.duration', label: '失控秒', kind: 'range', min: 0.5, max: 2.2, step: 0.05 },
        ],
      },
    ];
    return kit ? all.filter((s) => !s.id || kit.hazards.includes(s.id as HazardKind)) : all;
  }
  if (track.id === 'enemySkills') {
    const ids: EnemySkillId[] = kit?.enemySkills?.length ? kit.enemySkills : ['cut-in', 'desk-slam', 'rally'];
    return ids.flatMap((id) => enemySkillSections(id));
  }
  if (track.id === 'common') {
    return [
      { title: '撞物碎片', fields: paperFields('common.hitObject.paper', true) },
      { title: '撞物气雾', fields: mistFields('common.hitObject.mist') },
      {
        title: '对象池（改完需刷新游戏）',
        fields: [
          { path: 'common.pools.paper', label: '纸片/碎片池', kind: 'int', min: 8, max: 128, step: 4 },
          { path: 'common.pools.mist', label: '气雾池', kind: 'int', min: 8, max: 96, step: 4 },
          { path: 'common.pools.trail', label: '残影池', kind: 'int', min: 4, max: 48, step: 1 },
        ],
      },
    ];
  }
  if (track.group === 'dash') return dashSections(track.id as DashKey, track.hasLevel ? lv : 1);
  if (track.id === 'decoy') {
    const p = `skills.decoy.${lv}`;
    return [
      {
        title: '技能',
        fields: [
          { path: `${p}.decoy.cooldown`, label: '冷却', kind: 'range', min: 2, max: 16, step: 0.5 },
          { path: `${p}.decoy.duration`, label: '存活', kind: 'range', min: 1, max: 12, step: 0.2 },
          { path: `${p}.decoy.blastRadius`, label: '爆炸半径', kind: 'range', min: 0, max: 5, step: 0.1, hint: '0 = 不爆炸' },
          { path: `${p}.decoy.blastImpulse`, label: '爆炸冲量', kind: 'range', min: 0, max: 800, step: 10 },
        ],
      },
    ];
  }
  if (track.id === 'coffee') {
    const p = `skills.coffee.${lv}`;
    return [
      {
        title: '泼咖啡',
        fields: [
          { path: `${p}.coffee.cooldown`, label: '冷却', kind: 'range', min: 2, max: 16, step: 0.5 },
          { path: `${p}.coffee.range`, label: '泼出距离', kind: 'range', min: 0.6, max: 6, step: 0.1 },
          { path: `${p}.coffee.count`, label: '渍点数', kind: 'int', min: 1, max: 5, step: 1 },
          { path: `${p}.coffee.spacing`, label: '渍点间距', kind: 'range', min: 0.25, max: 1.8, step: 0.05 },
          { path: `${p}.coffee.color`, label: '颜色', kind: 'color' },
          { path: `${p}.coffee.opacity`, label: '透明度', kind: 'range', min: 0.1, max: 0.9, step: 0.02 },
          { path: `${p}.coffee.radius`, label: '半径', kind: 'range', min: 0.3, max: 2.8, step: 0.05 },
          { path: `${p}.coffee.life`, label: '持续', kind: 'range', min: 0.6, max: 8, step: 0.1 },
          { path: `${p}.coffee.splashRadius`, label: '溅摊半径', kind: 'range', min: 0, max: 4, step: 0.1, hint: '0 = 不溅' },
          { path: `${p}.coffee.splashLife`, label: '溅摊持续', kind: 'range', min: 0, max: 8, step: 0.1 },
        ],
      },
    ];
  }
  const p = `skills.keyboard.${lv}`;
  return [
    {
      title: '技能',
      fields: [
        { path: `${p}.keyboard.cooldown`, label: '冷却', kind: 'range', min: 2, max: 12, step: 0.5 },
        { path: `${p}.keyboard.speed`, label: '速度', kind: 'range', min: 6, max: 24, step: 0.5 },
        { path: `${p}.keyboard.range`, label: '去程距离', kind: 'range', min: 3, max: 16, step: 0.2 },
        { path: `${p}.keyboard.width`, label: '命中宽度', kind: 'range', min: 0.35, max: 2.4, step: 0.05 },
        { path: `${p}.keyboard.knockImpulse`, label: '放倒冲量', kind: 'range', min: 120, max: 700, step: 10 },
        { path: `${p}.keyboard.hitImpulse`, label: '击退冲量', kind: 'range', min: 120, max: 700, step: 10 },
      ],
    },
  ];
}

function bandFields(p: string): Field[] {
  return [
    { path: `${p}.on`, label: '启用这圈', kind: 'bool' },
    { path: `${p}.color`, label: '颜色', kind: 'color' },
    { path: `${p}.opacity`, label: '透明度', kind: 'range', min: 0.05, max: 1, step: 0.02 },
    { path: `${p}.additive`, label: '加色发光', kind: 'bool' },
    { path: `${p}.inner`, label: '内径', kind: 'range', min: 0.04, max: 1.2, step: 0.01 },
    { path: `${p}.outer`, label: '外径', kind: 'range', min: 0.08, max: 1.6, step: 0.01 },
    { path: `${p}.softness`, label: '模糊', kind: 'range', min: 0, max: 1, step: 0.02 },
  ];
}

export function actorSections(id: ActorId): FieldSection[] {
  if (id === 'player') {
    return [
      {
        title: '内环',
        fields: [
          ...bandFields('actors.player.ring.core'),
          { path: 'actors.player.ring.fill', label: '心亮', kind: 'range', min: 0, max: 1, step: 0.02, hint: '内环圆心淡底。' },
        ],
      },
      {
        title: '外环',
        fields: bandFields('actors.player.ring.rim'),
      },
      {
        title: '共用动态',
        fields: [
          { path: 'actors.player.ring.y', label: '离地', kind: 'range', min: 0.01, max: 0.18, step: 0.005 },
          { path: 'actors.player.ring.flicker', label: '闪烁', kind: 'range', min: 0, max: 1, step: 0.02 },
          { path: 'actors.player.ring.flickerSpeed', label: '闪速', kind: 'range', min: 1, max: 24, step: 0.5 },
          { path: 'actors.player.ring.pulse', label: '呼吸', kind: 'range', min: 0, max: 1, step: 0.02 },
          { path: 'actors.player.ring.pulseSpeed', label: '呼吸速', kind: 'range', min: 0.3, max: 6, step: 0.1 },
          { path: 'actors.player.ring.hotspot', label: '扫光', kind: 'range', min: 0, max: 1, step: 0.02, hint: '亮斑。旋转要靠它才看得见。' },
          { path: 'actors.player.ring.spin', label: '旋转', kind: 'range', min: -2.5, max: 2.5, step: 0.05 },
          { path: 'actors.player.ring.dashBoost', label: '冲刺加亮', kind: 'range', min: 0, max: 1.2, step: 0.05 },
        ],
      },
    ];
  }
  const p = `actors.${id}`;
  return [
    {
      title: '读条 · 头顶文件',
      fields: [
        { path: `${p}.channel.enabled`, label: '显示文件', kind: 'bool', hint: '贴身读条时头顶平躺转着的文件卡。Logo 只有图标、透明底，叠在纸色上。' },
        {
          path: `${p}.channel.stamp`,
          label: '贴图',
          kind: 'select',
          options: CHANNEL_STAMP_META.map((m) => ({ id: m.id, name: `${m.name} · ${m.blurb}` })),
        },
        { path: `${p}.channel.color`, label: '纸色', kind: 'color', hint: '卡片本体颜色。Logo 是透明底叠上去的，周围会露出这个颜色。' },
        { path: `${p}.channel.opacity`, label: '透明度', kind: 'range', min: 0.15, max: 1, step: 0.02 },
        { path: `${p}.channel.width`, label: '宽', kind: 'range', min: 0.08, max: 0.7, step: 0.01 },
        { path: `${p}.channel.height`, label: '高', kind: 'range', min: 0.08, max: 0.8, step: 0.01 },
        { path: `${p}.channel.thick`, label: '厚度', kind: 'range', min: 0.01, max: 0.18, step: 0.005 },
        { path: `${p}.channel.y`, label: '高度', kind: 'range', min: 1.4, max: 2.8, step: 0.02 },
        { path: `${p}.channel.spin`, label: '转速', kind: 'range', min: 0, max: 8, step: 0.05, hint: '绕竖轴水平转。上下晃、晃速还是原来那套。' },
        { path: `${p}.channel.bob`, label: '上下晃', kind: 'range', min: 0, max: 0.2, step: 0.005 },
        { path: `${p}.channel.bobSpeed`, label: '晃速', kind: 'range', min: 0, max: 20, step: 0.2 },
      ],
    },
    {
      title: '判定加时 · 飘字',
      fields: [
        { path: `${p}.overtime.enabled`, label: '启用飘字', kind: 'bool', hint: '交任务完成时头顶飘 +N分钟。读条转文件在上一栏单独编。' },
        { path: `${p}.overtime.color`, label: '字色', kind: 'color' },
        { path: `${p}.overtime.opacity`, label: '透明度', kind: 'range', min: 0.15, max: 1, step: 0.02 },
        { path: `${p}.overtime.outline`, label: '描边', kind: 'bool' },
        { path: `${p}.overtime.outlineColor`, label: '描边色', kind: 'color' },
        { path: `${p}.overtime.duration`, label: '持续', kind: 'range', min: 0.3, max: 2.4, step: 0.05 },
        { path: `${p}.overtime.size`, label: '字号', kind: 'range', min: 0.18, max: 1.1, step: 0.02 },
        { path: `${p}.overtime.rise`, label: '上飘', kind: 'range', min: 0.15, max: 2.2, step: 0.05 },
        { path: `${p}.overtime.y`, label: '起始高度', kind: 'range', min: 1.4, max: 2.8, step: 0.05 },
      ],
    },
    { title: '倒地 · 纸片', fields: paperFields(`${p}.hit.paper`, false) },
    { title: '倒地 · 气雾', fields: mistFields(`${p}.hit.mist`) },
    {
      title: '眩晕 · 元素',
      fields: [
        { path: `${p}.stun.enabled`, label: '启用眩晕样子', kind: 'bool' },
        {
          path: `${p}.stun.elem`,
          label: '元素',
          kind: 'select',
          options: STUN_ELEM_META.map((m) => ({ id: m.id, name: `${m.name} · ${m.blurb}` })),
        },
        { path: `${p}.stun.starColor`, label: '元素颜色', kind: 'color' },
        { path: `${p}.stun.starCount`, label: '数量', kind: 'int', min: 1, max: 8, step: 1 },
        { path: `${p}.stun.starSize`, label: '大小', kind: 'range', min: 0.08, max: 0.55, step: 0.01 },
        { path: `${p}.stun.starOpacity`, label: '透明度', kind: 'range', min: 0.15, max: 1, step: 0.02 },
        { path: `${p}.stun.orbit`, label: '绕头半径', kind: 'range', min: 0.12, max: 0.8, step: 0.02 },
        { path: `${p}.stun.spin`, label: '转速', kind: 'range', min: 0.4, max: 10, step: 0.1 },
        { path: `${p}.stun.bob`, label: '上下晃', kind: 'range', min: 0, max: 0.18, step: 0.01 },
        { path: `${p}.stun.tilt`, label: '轨道倾角', kind: 'range', min: 0, max: 1, step: 0.02, hint: '0 = 平躺转，越大越像椭圆' },
        { path: `${p}.stun.y`, label: '高度', kind: 'range', min: 1.2, max: 2.6, step: 0.05 },
      ],
    },
    {
      title: '眩晕 · 圆圈',
      fields: [
        { path: `${p}.stun.ringOn`, label: '显示圆圈', kind: 'bool' },
        { path: `${p}.stun.ringColor`, label: '圈颜色', kind: 'color' },
        { path: `${p}.stun.ringOpacity`, label: '圈透明度', kind: 'range', min: 0.05, max: 1, step: 0.02 },
        { path: `${p}.stun.ringSize`, label: '圈大小', kind: 'range', min: 0.12, max: 0.9, step: 0.02 },
        { path: `${p}.stun.ringWidth`, label: '圈粗细', kind: 'range', min: 0.06, max: 0.55, step: 0.02 },
        { path: `${p}.stun.ringAdditive`, label: '圈加色发光', kind: 'bool' },
      ],
    },
    {
      title: '眩晕 · 光晕',
      fields: [
        { path: `${p}.stun.glowOn`, label: '显示光晕', kind: 'bool' },
        { path: `${p}.stun.glowColor`, label: '光晕颜色', kind: 'color' },
        { path: `${p}.stun.glowOpacity`, label: '光晕透明度', kind: 'range', min: 0.05, max: 1, step: 0.02 },
        { path: `${p}.stun.glowSize`, label: '光晕大小', kind: 'range', min: 0.15, max: 1.2, step: 0.02 },
      ],
    },
    {
      title: '减速 · 脚底圆环',
      fields: [
        { path: `${p}.slow.enabled`, label: '启用雾圈', kind: 'bool' },
        { path: `${p}.slow.color`, label: '颜色', kind: 'color' },
        { path: `${p}.slow.opacity`, label: '透明度', kind: 'range', min: 0.08, max: 0.9, step: 0.02 },
        { path: `${p}.slow.additive`, label: '加色发光', kind: 'bool' },
        { path: `${p}.slow.size`, label: '大小', kind: 'range', min: 0.25, max: 1.4, step: 0.02 },
        { path: `${p}.slow.inner`, label: '内径', kind: 'range', min: 0, max: 0.82, step: 0.02, hint: '0 = 实心软盘，越大越像圆环' },
        { path: `${p}.slow.softness`, label: '模糊', kind: 'range', min: 0, max: 1, step: 0.02 },
        { path: `${p}.slow.fill`, label: '心雾', kind: 'range', min: 0, max: 1, step: 0.02, hint: '圆环中间淡一层' },
        { path: `${p}.slow.spin`, label: '转速', kind: 'range', min: 0.2, max: 4, step: 0.05 },
        { path: `${p}.slow.y`, label: '离地', kind: 'range', min: 0.02, max: 0.2, step: 0.005 },
      ],
    },
  ];
}

export function isCrowdActor(id: ActorId): id is CrowdActorId {
  return (CROWD_ACTOR_IDS as readonly string[]).includes(id);
}
