/** 特效目录：按冲刺属性 / 主动技能 × 等级管理。游戏和编辑器读同一份。 */

import type { EnemySkillId } from '../catalog';
import type { HazardKind, HazardTune, WeekdayId } from '../levels';

export type { EnemySkillId, HazardKind };

export const LINE_IDS = ['brute', 'slump', 'phantom', 'rebound', 'reclock', 'blame'] as const;
export type LineId = (typeof LINE_IDS)[number];
export type DashKey = 'none' | LineId;
export const DASH_KEYS = ['none', ...LINE_IDS] as const;
export type SkillKey = 'decoy' | 'keyboard' | 'coffee';
export type Lv = 1 | 2 | 3;

export interface PaperBurstFx {
  count: number;
  heavyCount: number;
  color: number;
  spawnY: number;
  lifeMin: number;
  lifeMax: number;
  speed: number;
  upMin: number;
  upMax: number;
  gravity: number;
  width: number;
  height: number;
}

/** 倒地/撞物爆开样式：纸片是默认，道具攻击可另选 */
export const HIT_BURST_IDS = ['paper', 'shard', 'spark', 'note', 'badge', 'poof'] as const;
export type HitBurstKind = (typeof HIT_BURST_IDS)[number];

export const HIT_BURST_META: { id: HitBurstKind; name: string; blurb: string }[] = [
  { id: 'paper', name: '纸片', blurb: 'A4 横飞' },
  { id: 'shard', name: '裂光', blurb: '玻璃裂闪 + 冲击环' },
  { id: 'spark', name: '曳光', blurb: '拉长光迹闪过' },
  { id: 'note', name: '便利贴', blurb: '彩色便签飞散' },
  { id: 'badge', name: '闪签', blurb: '脉冲光环 + 软闪' },
  { id: 'poof', name: '烟散', blurb: '砰地化烟消失' },
];

export function normalizeHitBurst(id: unknown): HitBurstKind {
  if (typeof id === 'string' && (HIT_BURST_IDS as readonly string[]).includes(id)) return id as HitBurstKind;
  return 'paper';
}

export interface ImpactMistFx {
  enabled: boolean;
  color: number;
  opacity: number;
  count: number;
  life: number;
  size: number;
  grow: number;
  rise: number;
  spread: number;
  flatten: number;
  additive: boolean;
}

export interface HitFx {
  /** 爆开粒子样式 */
  burst: HitBurstKind;
  paper: PaperBurstFx;
  mist: ImpactMistFx;
}

export interface OvertimeFx {
  enabled: boolean;
  color: number;
  opacity: number;
  duration: number;
  size: number;
  rise: number;
  y: number;
  outline: boolean;
  outlineColor: number;
}

export const CROWD_ACTOR_IDS = ['colleague-a-m', 'colleague-a-f', 'heavy', 'interceptor'] as const;
export type CrowdActorId = (typeof CROWD_ACTOR_IDS)[number];
export type ActorId = 'player' | CrowdActorId;

/** 交任务加到下班钟上的分钟。普通同事 15 或 30，拦截者 30，重量级 45。 */
export function overtimeMinutesOf(id: CrowdActorId, rng = Math.random): number {
  if (id === 'heavy') return 45;
  if (id === 'interceptor') return 30;
  return rng() < 2 / 3 ? 15 : 30;
}

/** 编辑器预览用稳定值，不随机 */
export function overtimePreviewMin(id: CrowdActorId): number {
  if (id === 'heavy') return 45;
  if (id === 'interceptor') return 30;
  return 15;
}

export function overtimePopText(min: number): string {
  return `+${min}分钟`;
}

export const STUN_ELEM_IDS = ['spark', 'star', 'disc'] as const;
export type StunElem = (typeof STUN_ELEM_IDS)[number];

export const STUN_ELEM_META: { id: StunElem; name: string; blurb: string }[] = [
  { id: 'spark', name: '闪光', blurb: '十字亮点' },
  { id: 'star', name: '五角星', blurb: '卡通金星' },
  { id: 'disc', name: '光斑', blurb: '软圆点' },
];

export interface StunLookFx {
  enabled: boolean;
  elem: StunElem;
  starColor: number;
  starCount: number;
  starSize: number;
  starOpacity: number;
  orbit: number;
  spin: number;
  bob: number;
  tilt: number;
  y: number;
  ringOn: boolean;
  ringColor: number;
  ringOpacity: number;
  ringSize: number;
  ringWidth: number;
  ringAdditive: boolean;
  glowOn: boolean;
  glowColor: number;
  glowOpacity: number;
  glowSize: number;
}

export interface SlowLookFx {
  enabled: boolean;
  color: number;
  opacity: number;
  size: number;
  spin: number;
  y: number;
  /** 0 = 实心软盘，越大越像圆环 */
  inner: number;
  softness: number;
  /** 圆心雾，圆环中间淡一层 */
  fill: number;
  additive: boolean;
}

export const CHANNEL_STAMP_IDS = [
  'paper',
  'word',
  'excel',
  'ppt',
  'outlook',
  'keynote',
  'pages',
  'numbers',
  'docs',
  'sheets',
  'slides',
  'figma',
  'notion',
  'feishu',
  'slack',
  'teams',
  'vscode',
  'sketch',
] as const;
export type ChannelStampId = (typeof CHANNEL_STAMP_IDS)[number];

export const CHANNEL_STAMP_META: { id: ChannelStampId; name: string; blurb: string }[] = [
  { id: 'paper', name: '空白文稿', blurb: '横线纸' },
  { id: 'word', name: 'Word', blurb: '蓝 W' },
  { id: 'excel', name: 'Excel', blurb: '绿表' },
  { id: 'ppt', name: 'PowerPoint', blurb: '橙 P' },
  { id: 'outlook', name: 'Outlook', blurb: '信封' },
  { id: 'keynote', name: 'Keynote', blurb: '讲台' },
  { id: 'pages', name: 'Pages', blurb: '苹果文稿' },
  { id: 'numbers', name: 'Numbers', blurb: '苹果表' },
  { id: 'docs', name: 'Docs', blurb: '在线文档' },
  { id: 'sheets', name: 'Sheets', blurb: '在线表' },
  { id: 'slides', name: 'Slides', blurb: '在线片' },
  { id: 'figma', name: 'Figma', blurb: '四色点' },
  { id: 'notion', name: 'Notion', blurb: '黑 N' },
  { id: 'feishu', name: '飞书', blurb: '办公' },
  { id: 'slack', name: 'Slack', blurb: '井号' },
  { id: 'teams', name: 'Teams', blurb: '紫人' },
  { id: 'vscode', name: 'VS Code', blurb: '尖括号' },
  { id: 'sketch', name: 'Sketch', blurb: '钻石' },
];

export function isChannelStampId(id: string | null | undefined): id is ChannelStampId {
  return !!id && (CHANNEL_STAMP_IDS as readonly string[]).includes(id);
}

export interface ChannelLookFx {
  enabled: boolean;
  stamp: ChannelStampId;
  color: number;
  opacity: number;
  width: number;
  height: number;
  thick: number;
  y: number;
  spin: number;
  bob: number;
  bobSpeed: number;
}

export interface ActorPassiveFx {
  hit: HitFx;
  overtime: OvertimeFx;
  channel: ChannelLookFx;
  stun: StunLookFx;
  slow: SlowLookFx;
}

export interface TrailFx {
  color: number;
  interval: number;
  life: number;
  opacity: number;
  radius: number;
  height: number;
  ghost: boolean;
  additive: boolean;
  stretch: number;
  fadePow: number;
  copies: number;
}

export interface DashHitLevel {
  time: number;
  speed: number;
  cooldown: number;
  radius: number;
  impulse: number;
  maxHits: number;
  oncePerDash: boolean;
}

export interface SlickLevel {
  color: number;
  opacity: number;
  radius: number;
  life: number;
  spacing: number;
  endRadius: number;
  endLife: number;
}

export interface PhantomLevel {
  stun: number;
  heavyStun: number;
  cdRefund: number;
  phaseTime: number;
  /** 起冲留下虚影秒数，0 = 无 */
  ghostTime?: number;
  /** 虚影后再点平移的距离，0 = 不可再点 */
  hopDist?: number;
}

/** 倦怠：撞人后范围内同事减速。圈颜色在整体；持续/倍率/半径在角色反应。 */
export interface SlumpLevel {
  radius: number;
  duration: number;
  /** 速度倍率，越小越慢 */
  factor: number;
  heavy: boolean;
  color: number;
  opacity: number;
  pulseLife: number;
  /** 冲刺路径是否拖减速带 */
  trail?: boolean;
}

/** 反弹冲：玩家撞墙/柜子（或满级撞主管）折向续冲 */
export interface ReboundLevel {
  /** 单次冲刺最多折向几次 */
  maxBounces: number;
  /** 探墙距离 */
  probe: number;
  /** 撞主管是否也能折（不硬直弹开） */
  heavyOk: boolean;
  /** 折向瞬间清贴身半径，0 = 无 */
  shockRadius: number;
  shockImpulse: number;
}

/** 补卡冲：撞到后随机挂闹钟，全场改追；满级闹钟到期小范围炸飞 */
export interface ReclockLevel {
  /** 闹钟持续 / 全场改追时长 */
  duration: number;
  /** 到期爆炸半径，0 = 不炸（LV1/2） */
  blastRadius: number;
  /** 爆炸冲量 */
  blastImpulse: number;
}

/** 甩锅冲：命中挂锅减速；满级挂锅者依次小范围爆炸 */
export interface BlameLevel {
  /** 锅 / 减速持续 */
  duration: number;
  /** 速度倍率，越小越慢 */
  factor: number;
  /** 单次冲刺最多挂几口锅 */
  maxPots: number;
  /** 爆炸半径，0 = 不炸（LV1/2） */
  blastRadius: number;
  blastImpulse: number;
  /** 挂上后多久开始第一爆 */
  blastDelay: number;
  /** 两口锅爆炸间隔 */
  blastGap: number;
}

export const DASH_REACT_IDS = ['none', 'knock', 'stun', 'slow', 'shove'] as const;
export type DashReactKind = (typeof DASH_REACT_IDS)[number];

export const DASH_REACT_META: { id: DashReactKind; name: string; blurb: string }[] = [
  { id: 'none', name: '无', blurb: '撞到没效果；可弹开玩家' },
  { id: 'knock', name: '倒地', blurb: '击飞放倒' },
  { id: 'stun', name: '眩晕', blurb: '原地定住，不摔倒' },
  { id: 'slow', name: '减速', blurb: '范围内提不起劲；冲量大于 0 还会倒' },
  { id: 'shove', name: '推开', blurb: '推走但不倒' },
];

export interface DashReact {
  kind: DashReactKind;
  impulse: number;
  stun: number;
  duration: number;
  factor: number;
  radius: number;
  bounce: boolean;
}

export type CrowdReact = Record<CrowdActorId, DashReact>;

export interface DashLevelFx {
  hit: DashHitLevel;
  trail: TrailFx;
  phantom?: PhantomLevel;
  slump?: SlumpLevel;
  rebound?: ReboundLevel;
  reclock?: ReclockLevel;
  blame?: BlameLevel;
  react?: CrowdReact;
}

export interface DecoyLevel {
  cooldown: number;
  duration: number;
  blastRadius: number;
  blastImpulse: number;
  /** 爆炸放倒时的倒地反馈样式 */
  hitBurst: HitBurstKind;
  /** 玩家定格分身视觉 */
  opacity: number;
  color: number;
  glowStyle: ThrowGlowStyle;
  glowColor: number;
  glowOpacity: number;
  glowSize: number;
}

export const THROW_GLOW_STYLE_IDS = ['off', 'soft', 'ring', 'core', 'flare'] as const;
export type ThrowGlowStyle = (typeof THROW_GLOW_STYLE_IDS)[number];

export const THROW_GLOW_STYLE_META: { id: ThrowGlowStyle; name: string; blurb: string }[] = [
  { id: 'off', name: '无', blurb: '不要光晕' },
  { id: 'soft', name: '柔光', blurb: '软边光斑' },
  { id: 'ring', name: '光环', blurb: '脚下柔环' },
  { id: 'core', name: '内核', blurb: '亮心软晕' },
  { id: 'flare', name: '十字闪', blurb: '软边光带' },
];

export function normalizeThrowGlowStyle(id: unknown, legacyGlow?: boolean): ThrowGlowStyle {
  if (typeof id === 'string' && (THROW_GLOW_STYLE_IDS as readonly string[]).includes(id)) return id as ThrowGlowStyle;
  if (legacyGlow === false) return 'off';
  return 'soft';
}

export interface KeyboardLevel {
  cooldown: number;
  speed: number;
  range: number;
  width: number;
  hitImpulse: number;
  knockImpulse: number;
  /** 命中放倒时的倒地反馈样式 */
  hitBurst: HitBurstKind;
  /** 飞出物视觉：按技能等级各自一份（鼠标/键盘/电脑/回旋镖换皮共用这套） */
  scale: number;
  color: number;
  glowStyle: ThrowGlowStyle;
  glowColor: number;
  glowOpacity: number;
  glowSize: number;
}

export interface CoffeeLevel {
  cooldown: number;
  range: number;
  count: number;
  spacing: number;
  color: number;
  opacity: number;
  radius: number;
  life: number;
  splashRadius: number;
  splashLife: number;
  /** 这一泼最多放倒几人。渍还在，人数满了就只剩地面 */
  maxVictims: number;
}

export interface SkillLevelFx {
  decoy?: DecoyLevel;
  keyboard?: KeyboardLevel;
  coffee?: CoffeeLevel;
}

export const HALO_STYLE_IDS = ['single', 'double', 'soft', 'disc', 'dashed'] as const;
export type HaloStyle = (typeof HALO_STYLE_IDS)[number];

export const HALO_STYLE_META: { id: HaloStyle; name: string; blurb: string }[] = [
  { id: 'single', name: '单环', blurb: '一条实线' },
  { id: 'double', name: '双环', blurb: '内环 + 外环' },
  { id: 'soft', name: '软光', blurb: '糊开的一圈' },
  { id: 'disc', name: '光斑', blurb: '实心底盘' },
  { id: 'dashed', name: '虚线', blurb: '断开的环' },
];

export interface HaloBandFx {
  on: boolean;
  color: number;
  opacity: number;
  inner: number;
  outer: number;
  softness: number;
  additive: boolean;
}

export interface PlayerRingFx {
  style: HaloStyle;
  y: number;
  fill: number;
  flicker: number;
  flickerSpeed: number;
  pulse: number;
  pulseSpeed: number;
  spin: number;
  hotspot: number;
  dashBoost: number;
  core: HaloBandFx;
  rim: HaloBandFx;
}

export interface PoolsFx {
  paper: number;
  mist: number;
  trail: number;
}

export interface HazardFx {
  color: number;
  opacity: number;
  radius: number;
  duration: number;
  factor?: number;
  impulse?: number;
  lift?: number;
}

export const CHAIN_STYLE_IDS = ['links', 'rings', 'beam', 'rope'] as const;
export type ChainStyleId = (typeof CHAIN_STYLE_IDS)[number];

export const CHAIN_STYLE_META: { id: ChainStyleId; name: string; blurb: string }[] = [
  { id: 'links', name: '方节', blurb: '短盒铁链' },
  { id: 'rings', name: '环扣', blurb: '圆环相扣' },
  { id: 'beam', name: '光索', blurb: '发光管束' },
  { id: 'rope', name: '缆绳', blurb: '细软垂绳' },
];

export function chainStyleOf(id: unknown): ChainStyleId {
  return CHAIN_STYLE_IDS.includes(id as ChainStyleId) ? (id as ChainStyleId) : 'links';
}

export interface EnemySkillFx {
  cooldown: number;
  windup: number;
  duration: number;
  radius: number;
  speed?: number;
  factor?: number;
  color: number;
  opacity: number;
  /** 前摇时竖直压扁，1 = 不压 */
  squash: number;
  /** 截杀：锁链扣住玩家的秒数 */
  lock?: number;
  chainStyle?: ChainStyleId;
  chainWidth?: number;
  chainSag?: number;
  /** 拍桌：弹飞周围可碰飞道具 */
  knockImpulse?: number;
  knockLift?: number;
  paper?: number;
  /** 喊人：声波圈数 / 间隔 */
  waves?: number;
  waveGap?: number;
}

export type Levels<T> = { 1: T; 2: T; 3: T };

type DeepPartial<T> = {
  [K in keyof T]?: NonNullable<T[K]> extends object ? DeepPartial<NonNullable<T[K]>> : T[K];
};

/** 同一技能族按关各存一份颜色。喝咖啡 / 泼脏水 / 外卖汤 / 破罐破摔互不覆盖。 */
export type DayCoffeeColors = Record<Lv, number>;

/** 分身光晕按关各存一份。工位马甲 / 我是NPC / 假人下班互不覆盖。 */
export interface DayDecoyLook {
  glowColor: number;
}

export interface FxCatalog {
  version: 3;
  common: {
    pools: PoolsFx;
    hitObject: HitFx;
  };
  actors: {
    player: { ring: PlayerRingFx };
  } & Record<CrowdActorId, ActorPassiveFx>;
  lines: Record<DashKey, Levels<DashLevelFx>>;
  skills: Record<SkillKey, Levels<SkillLevelFx>>;
  /** 按关外观。玩法数值仍在 skills，颜色改这里。 */
  dayLooks: {
    coffee: Record<WeekdayId, DayCoffeeColors>;
    decoy: Record<WeekdayId, DayDecoyLook>;
  };
  hazards: Record<HazardKind, HazardFx>;
  enemySkills: Record<EnemySkillId, EnemySkillFx>;
}

function isRec(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function clone<T>(src: T): T {
  return JSON.parse(JSON.stringify(src)) as T;
}

function mergeDeep<T>(base: T, over: unknown): T {
  if (!isRec(base) || !isRec(over)) return ((over as T) ?? base) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = k in (base as object) && isRec((base as Record<string, unknown>)[k]) ? mergeDeep((base as Record<string, unknown>)[k], v) : v;
  }
  return out as T;
}

function levels<T>(lv1: T, lv2: DeepPartial<T> = {}, lv3: DeepPartial<T> = {}): Levels<T> {
  return {
    1: clone(lv1),
    2: mergeDeep(clone(lv1), lv2),
    3: mergeDeep(mergeDeep(clone(lv1), lv2), lv3),
  };
}

const PAPER: PaperBurstFx = {
  count: 8,
  heavyCount: 14,
  color: 0xf4f0e6,
  spawnY: 1.1,
  lifeMin: 0.7,
  lifeMax: 1.1,
  speed: 5,
  upMin: 2.5,
  upMax: 6,
  gravity: 14,
  width: 0.22,
  height: 0.3,
};

const MIST: ImpactMistFx = {
  enabled: true,
  color: 0xffe4b8,
  opacity: 0.42,
  count: 7,
  life: 0.4,
  size: 0.32,
  grow: 1.7,
  rise: 0.85,
  spread: 0.5,
  flatten: 0.32,
  additive: true,
};

function hitOf(
  over: Partial<{ burst: HitBurstKind; paper: Partial<PaperBurstFx>; mist: Partial<ImpactMistFx> }> = {}
): HitFx {
  return {
    burst: normalizeHitBurst(over.burst),
    paper: mergeDeep(clone(PAPER), over.paper),
    mist: mergeDeep(clone(MIST), over.mist),
  };
}

/** 倒地反馈：在受害者默认 hit 上叠攻击方选的爆开样式 */
export function mergeHitFx(base: HitFx, over?: Partial<HitFx> | null): HitFx {
  if (!over) return base;
  return {
    burst: over.burst != null ? normalizeHitBurst(over.burst) : base.burst,
    paper: over.paper ? mergeDeep(clone(base.paper), over.paper) : base.paper,
    mist: over.mist ? mergeDeep(clone(base.mist), over.mist) : base.mist,
  };
}

const HIT_OBJECT = hitOf({
  burst: 'shard',
  paper: { count: 4, heavyCount: 4, color: 0xc4b49a, width: 0.14, height: 0.16, speed: 3.2, upMin: 1.4, upMax: 3.2 },
  mist: { color: 0x8a7a66, opacity: 0.32, count: 5, flatten: 0.22, rise: 0.45 },
});

const HEAD: OvertimeFx = {
  enabled: true,
  color: 0xffe080,
  opacity: 1,
  duration: 1.15,
  size: 0.48,
  rise: 0.9,
  y: 2.08,
  outline: true,
  outlineColor: 0x3a2410,
};

const STUN_LOOK: StunLookFx = {
  enabled: true,
  elem: 'spark',
  starColor: 0xfff2a8,
  starCount: 4,
  starSize: 0.26,
  starOpacity: 0.95,
  orbit: 0.34,
  spin: 3.2,
  bob: 0.05,
  tilt: 0.42,
  y: 1.88,
  ringOn: true,
  ringColor: 0xffe08a,
  ringOpacity: 0.55,
  ringSize: 0.4,
  ringWidth: 0.2,
  ringAdditive: true,
  glowOn: true,
  glowColor: 0xffd56a,
  glowOpacity: 0.42,
  glowSize: 0.52,
};

const CHANNEL_LOOK: ChannelLookFx = {
  enabled: true,
  stamp: 'word',
  color: 0xf3ead2,
  opacity: 1,
  width: 0.22,
  height: 0.28,
  thick: 0.04,
  y: 2.05,
  spin: 1.8,
  bob: 0.04,
  bobSpeed: 10,
};

const SLOW_LOOK: SlowLookFx = {
  enabled: true,
  color: 0x7a90a8,
  opacity: 0.42,
  size: 0.62,
  spin: 1.15,
  y: 0.045,
  inner: 0.36,
  softness: 0.58,
  fill: 0.22,
  additive: false,
};

function crowdActor(over: DeepPartial<ActorPassiveFx> = {}): ActorPassiveFx {
  return mergeDeep(
    {
      hit: hitOf(),
      overtime: clone(HEAD),
      channel: clone(CHANNEL_LOOK),
      stun: clone(STUN_LOOK),
      slow: clone(SLOW_LOOK),
    } satisfies ActorPassiveFx,
    over
  );
}

function trail(color: number, over: Partial<TrailFx> = {}): TrailFx {
  return mergeDeep(
    {
      color,
      interval: 0.035,
      life: 0.22,
      opacity: 0.4,
      radius: 0.26,
      height: 0.5,
      ghost: true,
      additive: true,
      stretch: 1.85,
      fadePow: 1.35,
      copies: 2,
    },
    over
  );
}

export function dashReactDefaults(kind: DashReactKind): DashReact {
  switch (kind) {
    case 'none':
      return { kind, impulse: 0, stun: 0, duration: 0, factor: 0.42, radius: 1.9, bounce: true };
    case 'knock':
      return { kind, impulse: 0, stun: 0, duration: 0, factor: 0.42, radius: 1.9, bounce: false };
    case 'stun':
      return { kind, impulse: 0, stun: 0.9, duration: 0, factor: 0.42, radius: 1.9, bounce: false };
    case 'slow':
      return { kind, impulse: 0, stun: 0, duration: 2.2, factor: 0.42, radius: 1.9, bounce: false };
    case 'shove':
      return { kind, impulse: 950, stun: 0.5, duration: 0, factor: 0.42, radius: 1.9, bounce: false };
  }
}

function reactOf(kind: DashReactKind, over: Partial<DashReact> = {}): DashReact {
  return { ...dashReactDefaults(kind), ...over, kind };
}

function crowdReact(normal: DashReact, heavy: DashReact): CrowdReact {
  const block = normal.kind === 'knock' || normal.kind === 'shove';
  return {
    'colleague-a-m': clone(normal),
    'colleague-a-f': clone(normal),
    interceptor: clone(block ? reactOf('none', { bounce: true }) : normal),
    heavy: clone(heavy),
  };
}

/** 倒地冲量为 0 时跟整体「默认击飞冲量」；减速/推开的 0 就是 0。 */
export function dashImpulseOf(pack: DashLevelFx, react: DashReact): number {
  if (react.kind === 'knock') return react.impulse > 0 ? react.impulse : pack.hit.impulse;
  return react.impulse;
}

export function dashReactOf(pack: DashLevelFx, id: CrowdActorId): DashReact {
  const r = pack.react?.[id];
  let resolved: DashReact;
  if (r?.kind) {
    resolved = { ...dashReactDefaults(r.kind), ...r };
  } else if (pack.phantom) {
    resolved = reactOf('stun', { stun: id === 'heavy' ? pack.phantom.heavyStun : pack.phantom.stun, bounce: false });
  } else if (pack.slump) {
    if (id === 'heavy' && !pack.slump.heavy) resolved = reactOf('none', { bounce: true });
    else {
      resolved = reactOf('slow', {
        impulse: pack.hit.impulse,
        duration: pack.slump.duration,
        factor: pack.slump.factor,
        radius: pack.slump.radius,
        bounce: false,
      });
    }
  } else if (id === 'heavy') {
    resolved = reactOf('none', { bounce: true });
  } else {
    resolved = reactOf('knock', { impulse: pack.hit.impulse });
  }
  // 前台拦路虎：冲撞打不开，玩家弹开；减速/幻影晕仍生效
  if (id === 'interceptor' && (resolved.kind === 'knock' || resolved.kind === 'shove')) {
    return reactOf('none', { bounce: true });
  }
  return resolved;
}

function dash(hit: DashHitLevel, color: number, extra: DeepPartial<DashLevelFx> = {}): DashLevelFx {
  return mergeDeep(
    {
      hit,
      trail: trail(color),
    } satisfies DashLevelFx,
    extra
  );
}

const NONE_HIT: DashHitLevel = {
  time: 0.18,
  speed: 13,
  cooldown: 1.4,
  radius: 1,
  impulse: 460,
  maxHits: 0,
  oncePerDash: false,
};

function band(partial: Partial<HaloBandFx>): HaloBandFx {
  return {
    on: true,
    color: 0x7ef0a0,
    opacity: 0.9,
    inner: 0.38,
    outer: 0.5,
    softness: 0.16,
    additive: false,
    ...partial,
  };
}

export const HALO_STYLE_PRESETS: Record<HaloStyle, Pick<PlayerRingFx, 'style' | 'fill' | 'core' | 'rim'>> = {
  single: {
    style: 'single',
    fill: 0,
    core: band({ inner: 0.38, outer: 0.52, softness: 0.12, opacity: 0.92 }),
    rim: band({ on: false, inner: 0.62, outer: 0.82, softness: 0.4, opacity: 0.4, additive: true }),
  },
  double: {
    style: 'double',
    fill: 0,
    core: band({ inner: 0.34, outer: 0.46, softness: 0.1, opacity: 0.95 }),
    rim: band({ inner: 0.58, outer: 0.78, softness: 0.28, opacity: 0.5, additive: true }),
  },
  soft: {
    style: 'soft',
    fill: 0.1,
    core: band({ inner: 0.22, outer: 0.7, softness: 0.78, opacity: 0.7, additive: true }),
    rim: band({ on: false, inner: 0.78, outer: 1.05, softness: 0.6, opacity: 0.25, additive: true }),
  },
  disc: {
    style: 'disc',
    fill: 0.62,
    core: band({ inner: 0.04, outer: 0.56, softness: 0.55, opacity: 0.55, additive: true }),
    rim: band({ on: false, inner: 0.6, outer: 0.86, softness: 0.45, opacity: 0.3, additive: true }),
  },
  dashed: {
    style: 'dashed',
    fill: 0,
    core: band({ inner: 0.38, outer: 0.52, softness: 0.08, opacity: 0.95 }),
    rim: band({ on: false, inner: 0.62, outer: 0.82, softness: 0.2, opacity: 0.45, additive: true }),
  },
};

const PLAYER_RING: PlayerRingFx = {
  ...HALO_STYLE_PRESETS.double,
  y: 0.03,
  flicker: 0,
  flickerSpeed: 10,
  pulse: 0,
  pulseSpeed: 2.4,
  spin: 0,
  hotspot: 0,
  dashBoost: 0.35,
};

export function applyHaloStyle(style: HaloStyle) {
  const preset = HALO_STYLE_PRESETS[style];
  const cur = current.actors.player.ring;
  const color = cur.core.color;
  current.actors.player.ring = {
    ...cur,
    style,
    fill: preset.fill,
    core: { ...preset.core, color },
    rim: { ...preset.rim, color },
  };
}

function ringFromUnknown(raw: unknown): PlayerRingFx {
  if (!isRec(raw)) return clone(PLAYER_RING);
  if (isRec(raw.core)) return mergeDeep(clone(PLAYER_RING), raw);
  const inner = Math.max(0.02, Number(raw.inner) || PLAYER_RING.core.inner);
  const outer = Math.max(inner + 0.02, Number(raw.outer) || PLAYER_RING.core.outer);
  const glow = Number(raw.glow) || 0;
  const color = Number(raw.color) || 0x7ef0a0;
  const opacity = Number(raw.opacity) || 0.9;
  const softness = Number(raw.softness) || 0.16;
  return {
    style: glow > 0.08 ? 'double' : 'single',
    y: Number(raw.y) || 0.03,
    fill: Number(raw.fill) || 0,
    flicker: Number(raw.flicker) || 0,
    flickerSpeed: Number(raw.flickerSpeed) || 10,
    pulse: Number(raw.pulse) || 0,
    pulseSpeed: Number(raw.pulseSpeed) || 2.4,
    spin: Number(raw.spin) || 0,
    hotspot: Number(raw.hotspot) || 0,
    dashBoost: Number(raw.dashBoost) || 0.35,
    core: band({ on: true, color, opacity, inner, outer, softness, additive: !!raw.additive }),
    rim: band({
      on: glow > 0.08,
      color,
      opacity: Math.min(1, 0.25 + glow * 0.7),
      inner: outer + 0.06,
      outer: outer + 0.12 + glow * 0.55,
      softness: 0.32 + softness * 0.35,
      additive: true,
    }),
  };
}

const COFFEE_DAYS: WeekdayId[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
/** 误把破罐破摔涂绿时写进共用槽的颜色。迁移时只还给周五。 */
const COFFEE_GREEN = 1407260;
/** 涂绿之前，喝咖啡三档的渍色。 */
const COFFEE_SAVED: DayCoffeeColors = { 1: 3352618, 2: 4853016, 3: 4853016 };

function coffeeLooksFilled(color: number): Record<WeekdayId, DayCoffeeColors> {
  const row: DayCoffeeColors = { 1: color, 2: color, 3: color };
  return {
    monday: { ...row },
    tuesday: { ...row },
    wednesday: { ...row },
    thursday: { ...row },
    friday: { ...row },
  };
}

/** 工位马甲绿、我是NPC 稻草金、假人下班紫。共用槽里的紫不再铺到每一关。 */
const DECOY_GLOW_DEFAULT: Record<WeekdayId, number> = {
  monday: 0x57d98f,
  tuesday: 0x57d98f,
  wednesday: 0x57d98f,
  thursday: 0xe2b15a,
  friday: 0xa659d9,
};

function decoyLooksFilled(): Record<WeekdayId, DayDecoyLook> {
  const out = {} as Record<WeekdayId, DayDecoyLook>;
  for (const day of COFFEE_DAYS) out[day] = { glowColor: DECOY_GLOW_DEFAULT[day] };
  return out;
}

export const DEFAULT_FX: FxCatalog = {
  version: 3,
  common: {
    pools: { paper: 64, mist: 56, trail: 16 },
    hitObject: clone(HIT_OBJECT),
  },
  actors: {
    player: { ring: clone(PLAYER_RING) },
    'colleague-a-m': crowdActor({ channel: { stamp: 'word' } }),
    'colleague-a-f': crowdActor({
      hit: { mist: { color: 0xffd4e8, opacity: 0.4 } },
      overtime: { color: 0xffc8e0, size: 0.28 },
      channel: { stamp: 'ppt' },
      stun: { starColor: 0xffd0ea, ringColor: 0xff9ad4, glowColor: 0xffb0d4 },
      slow: { color: 0xc89ab0 },
    }),
    heavy: crowdActor({
      hit: {
        paper: { count: 14, heavyCount: 14, color: 0xf0e6c8 },
        mist: { color: 0xffb080, count: 9, size: 0.42 },
      },
      overtime: { color: 0xff6b57, size: 0.42, duration: 1.2, y: 2.05 },
      channel: { stamp: 'excel', y: 2.38, width: 0.28, height: 0.34 },
      stun: { y: 2.18, orbit: 0.42, starCount: 5, starSize: 0.3, ringSize: 0.48, glowSize: 0.7 },
      slow: { size: 0.88 },
    }),
    interceptor: crowdActor({
      hit: { paper: { count: 6 }, mist: { color: 0xe05252, opacity: 0.38 } },
      overtime: { color: 0xff5a5a, size: 0.3, rise: 1.4, duration: 0.8 },
      channel: { stamp: 'figma' },
      stun: { starColor: 0xff8a8a, ringColor: 0xff5050, glowColor: 0xff6a6a },
      slow: { color: 0xc06060 },
    }),
  },
  lines: {
    none: levels(
      dash(NONE_HIT, 0x6eb6ff, {
        react: crowdReact(reactOf('knock'), reactOf('none', { bounce: true })),
      })
    ),
    brute: levels(
      dash(
        { ...NONE_HIT, impulse: 520 },
        0xff6b57,
        { react: crowdReact(reactOf('knock'), reactOf('none', { bounce: true })) }
      ),
      { hit: { time: 0.24, radius: 1.5, impulse: 720 } },
      {
        hit: { impulse: 900, radius: 1.5 },
        react: { heavy: reactOf('shove', { impulse: 950, stun: 0.5, bounce: false }) },
      }
    ),
    slump: levels(
      dash(
        { ...NONE_HIT, impulse: 400 },
        0x8aa0b8,
        {
          slump: { radius: 1.9, duration: 2.2, factor: 0.42, heavy: false, color: 0x7a90a8, opacity: 0.45, pulseLife: 0.45 },
          react: crowdReact(
            reactOf('slow', { duration: 2.2, factor: 0.42, radius: 1.9 }),
            reactOf('none', { bounce: true })
          ),
        }
      ),
      {
        slump: { radius: 2.6, duration: 3.2, factor: 0.32 },
        react: {
          'colleague-a-m': { duration: 3.2, factor: 0.32, radius: 2.6 },
          'colleague-a-f': { duration: 3.2, factor: 0.32, radius: 2.6 },
          interceptor: { duration: 3.2, factor: 0.32, radius: 2.6 },
        },
      },
      {
        slump: { radius: 3.2, duration: 4.0, factor: 0.26, heavy: true },
        react: {
          'colleague-a-m': { duration: 4.0, factor: 0.26, radius: 3.2 },
          'colleague-a-f': { duration: 4.0, factor: 0.26, radius: 3.2 },
          interceptor: { duration: 4.0, factor: 0.26, radius: 3.2 },
          heavy: reactOf('slow', { impulse: 0, duration: 4.0, factor: 0.26, radius: 3.2, bounce: false }),
        },
      }
    ),
    phantom: levels(
      dash(
        { ...NONE_HIT, impulse: 0 },
        0x8ea2ff,
        {
          phantom: { stun: 0.9, heavyStun: 0.5, cdRefund: 0, phaseTime: 0, ghostTime: 0, hopDist: 0 },
          react: crowdReact(reactOf('stun', { stun: 0.9 }), reactOf('stun', { stun: 0.5 })),
        }
      ),
      { phantom: { cdRefund: 0.35, ghostTime: 0.4 } },
      { phantom: { phaseTime: 1.5, hopDist: 1.1 } }
    ),
    rebound: levels(
      dash(
        { ...NONE_HIT, impulse: 380, time: 0.2 },
        0xff9a4d,
        {
          rebound: { maxBounces: 1, probe: 0.62, heavyOk: false, shockRadius: 0, shockImpulse: 0 },
          react: crowdReact(reactOf('shove', { impulse: 420, stun: 0.25 }), reactOf('none', { bounce: true })),
        }
      ),
      {
        rebound: { maxBounces: 1, probe: 0.7, heavyOk: false, shockRadius: 1.2, shockImpulse: 280 },
        hit: { impulse: 480 },
      },
      {
        rebound: { maxBounces: 2, probe: 0.75, heavyOk: true, shockRadius: 1.5, shockImpulse: 360 },
        hit: { impulse: 560 },
        react: { heavy: reactOf('shove', { impulse: 720, stun: 0.35, bounce: false }) },
      }
    ),
    reclock: levels(
      dash(
        { ...NONE_HIT, time: 0.14, speed: 14, impulse: 360 },
        0x57d9c4,
        {
          reclock: { duration: 1, blastRadius: 0, blastImpulse: 0 },
          react: crowdReact(reactOf('knock'), reactOf('none', { bounce: true })),
        }
      ),
      {
        reclock: { duration: 1, blastRadius: 0, blastImpulse: 0 },
        hit: { time: 0.15, speed: 14.5 },
      },
      {
        reclock: { duration: 2, blastRadius: 2.4, blastImpulse: 520 },
        hit: { time: 0.16, speed: 15, impulse: 420 },
      }
    ),
    blame: levels(
      dash(
        { ...NONE_HIT, impulse: 0 },
        0xd4a017,
        {
          blame: {
            duration: 1.4,
            factor: 0.48,
            maxPots: 8,
            blastRadius: 0,
            blastImpulse: 0,
            blastDelay: 0.35,
            blastGap: 0.22,
          },
          react: crowdReact(
            reactOf('slow', { impulse: 0, duration: 1.4, factor: 0.48, radius: 0.01 }),
            reactOf('slow', { impulse: 0, duration: 1.4, factor: 0.55, radius: 0.01 })
          ),
        }
      ),
      {
        blame: {
          duration: 1.8,
          factor: 0.42,
          maxPots: 8,
          blastRadius: 0,
          blastImpulse: 0,
          blastDelay: 0.35,
          blastGap: 0.22,
        },
        hit: { impulse: 0 },
        react: crowdReact(
          reactOf('slow', { impulse: 0, duration: 1.8, factor: 0.42, radius: 0.01 }),
          reactOf('slow', { impulse: 0, duration: 1.8, factor: 0.5, radius: 0.01 })
        ),
      },
      {
        blame: {
          duration: 1.6,
          factor: 0.4,
          maxPots: 8,
          blastRadius: 1.35,
          blastImpulse: 480,
          blastDelay: 0.4,
          blastGap: 0.22,
        },
        hit: { impulse: 0 },
        react: crowdReact(
          reactOf('slow', { impulse: 0, duration: 1.6, factor: 0.4, radius: 0.01 }),
          reactOf('slow', { impulse: 0, duration: 1.6, factor: 0.48, radius: 0.01 })
        ),
      }
    ),
  },
  skills: {
    decoy: levels(
      {
        decoy: {
          cooldown: 9,
          duration: 4,
          blastRadius: 0,
          blastImpulse: 0,
          hitBurst: 'spark' as HitBurstKind,
          opacity: 0.48,
          color: 0xffffff,
          glowStyle: 'soft' as ThrowGlowStyle,
          glowColor: 0x57d98f,
          glowOpacity: 0.5,
          glowSize: 1.9,
        } satisfies DecoyLevel,
      },
      {
        decoy: {
          duration: 6,
          opacity: 0.52,
          glowStyle: 'ring',
          glowOpacity: 0.55,
          glowSize: 1.7,
        },
      },
      {
        decoy: {
          blastRadius: 2.6,
          blastImpulse: 340,
          opacity: 0.55,
          glowStyle: 'core',
          glowOpacity: 0.58,
          glowSize: 2.0,
        },
      }
    ),
    keyboard: levels(
      {
        keyboard: {
          cooldown: 5.5,
          speed: 14,
          range: 8,
          width: 0.75,
          hitImpulse: 340,
          knockImpulse: 300,
          hitBurst: 'note' as HitBurstKind,
          scale: 1,
          color: 0xffffff,
          glowStyle: 'soft' as ThrowGlowStyle,
          glowColor: 0xffd257,
          glowOpacity: 0.55,
          glowSize: 1.55,
        } satisfies KeyboardLevel,
      },
      {
        keyboard: {
          width: 1.05,
          scale: 1.25,
          glowStyle: 'ring',
          glowOpacity: 0.6,
          glowSize: 1.25,
        },
      },
      {
        keyboard: {
          knockImpulse: 300,
          scale: 1.55,
          glowStyle: 'core',
          glowOpacity: 0.58,
          glowSize: 1.4,
        },
      }
    ),
    coffee: levels(
      { coffee: { cooldown: 6.5, range: 1.7, count: 1, spacing: 0.7, color: 0x4a2d18, opacity: 0.55, radius: 0.85, life: 2.4, splashRadius: 0, splashLife: 0, maxVictims: 2 } },
      { coffee: { radius: 1.2, life: 3.6, range: 2.1, maxVictims: 3 } },
      { coffee: { count: 3, splashRadius: 1.8, splashLife: 3.2, maxVictims: 4 } }
    ),
  },
  dayLooks: {
    coffee: coffeeLooksFilled(0x4a2d18),
    decoy: decoyLooksFilled(),
  },
  hazards: {
    wet: { color: 0x7ec8e8, opacity: 0.5, radius: 0.85, duration: 1.2, factor: 0.55 },
    pit: { color: 0xc8b48a, opacity: 0.45, radius: 0.58, duration: 1.8 },
    crate: { color: 0x6b3d1f, opacity: 0.55, radius: 0.58, duration: 1.8 },
    launch: { color: 0xff8a3a, opacity: 0.55, radius: 0.85, duration: 1.15, impulse: 620, lift: 36 },
    alarm: { color: 0x5a564f, opacity: 0.12, radius: 0.9, duration: 1.05, impulse: 520, lift: 140 },
  },
  enemySkills: {
    'cut-in': {
      cooldown: 8,
      windup: 0.4,
      duration: 0.45,
      radius: 8,
      speed: 7.2,
      color: 0xff5050,
      opacity: 0.55,
      squash: 0.78,
      lock: 2,
      chainStyle: 'links',
      chainWidth: 0.08,
      chainSag: 0.42,
    },
    'desk-slam': {
      cooldown: 10,
      windup: 0.35,
      duration: 1.5,
      radius: 2.4,
      factor: 0.45,
      color: 0xffb080,
      opacity: 0.5,
      squash: 0.72,
      knockImpulse: 420,
      knockLift: 32,
      paper: 10,
    },
    rally: {
      cooldown: 12,
      windup: 0.3,
      duration: 2,
      radius: 5.5,
      factor: 0.5,
      color: 0xffc14d,
      opacity: 0.5,
      squash: 0.85,
      waves: 3,
      waveGap: 0.14,
    },
  },
};

let current: FxCatalog = clone(DEFAULT_FX);

export function fx(): FxCatalog {
  return current;
}

export function cloneFx(src: FxCatalog): FxCatalog {
  return clone(src);
}

export function resetFx() {
  current = clone(DEFAULT_FX);
}

export function replaceFx(next: FxCatalog) {
  current = mergeFx(DEFAULT_FX, next);
}

export function mergeFx(base: FxCatalog, over: unknown): FxCatalog {
  const merged = mergeDeep(clone(base), over);
  merged.version = 3;
  const o = isRec(over) ? over : {};
  const actors = isRec(o.actors) ? o.actors : {};
  const player = isRec(actors.player) ? actors.player : {};
  merged.actors.player.ring = ringFromUnknown(player.ring ?? merged.actors.player.ring);
  liftCoffeeAndSlump(merged, o);
  ensureDashReact(merged);
  liftSharedImpulse(merged);
  ensureActorStates(merged, o);
  ensureCoffeeCaps(merged);
  merged.hazards = mergeDeep(clone(DEFAULT_FX.hazards), merged.hazards);
  merged.enemySkills = mergeDeep(clone(DEFAULT_FX.enemySkills), merged.enemySkills);
  if (!merged.skills.keyboard) merged.skills.keyboard = clone(DEFAULT_FX.skills.keyboard);
  else {
    for (const lv of [1, 2, 3] as Lv[]) {
      const pack = merged.skills.keyboard[lv]?.keyboard as (KeyboardLevel & { glow?: boolean }) | undefined;
      const fb = DEFAULT_FX.skills.keyboard[lv].keyboard!;
      if (!pack) {
        merged.skills.keyboard[lv] = clone(DEFAULT_FX.skills.keyboard[lv]);
        continue;
      }
      if (pack.scale == null) pack.scale = fb.scale;
      if (pack.color == null) pack.color = fb.color;
      pack.hitBurst = normalizeHitBurst(pack.hitBurst ?? fb.hitBurst);
      pack.glowStyle = normalizeThrowGlowStyle(pack.glowStyle, pack.glow);
      delete pack.glow;
      if (pack.glowColor == null) pack.glowColor = fb.glowColor;
      if (pack.glowOpacity == null) pack.glowOpacity = fb.glowOpacity;
      if (pack.glowSize == null) pack.glowSize = fb.glowSize;
    }
  }
  ensureDayLooks(merged, o);
  if (!merged.skills.decoy) merged.skills.decoy = clone(DEFAULT_FX.skills.decoy);
  else {
    for (const lv of [1, 2, 3] as Lv[]) {
      const pack = merged.skills.decoy[lv]?.decoy as (DecoyLevel & { glow?: boolean }) | undefined;
      const fb = DEFAULT_FX.skills.decoy[lv].decoy!;
      if (!pack) {
        merged.skills.decoy[lv] = clone(DEFAULT_FX.skills.decoy[lv]);
        continue;
      }
      if (pack.opacity == null) pack.opacity = fb.opacity;
      if (pack.color == null) pack.color = fb.color;
      pack.hitBurst = normalizeHitBurst(pack.hitBurst ?? fb.hitBurst);
      pack.glowStyle = normalizeThrowGlowStyle(pack.glowStyle, pack.glow);
      delete pack.glow;
      if (pack.glowColor == null) pack.glowColor = fb.glowColor;
      if (pack.glowOpacity == null) pack.glowOpacity = fb.glowOpacity;
      if (pack.glowSize == null) pack.glowSize = fb.glowSize;
    }
  }
  ensureHitBursts(merged);
  return merged;
}

function ensureHitBursts(merged: FxCatalog) {
  for (const id of CROWD_ACTOR_IDS) {
    const hit = merged.actors[id]?.hit;
    if (!hit) continue;
    hit.burst = normalizeHitBurst(hit.burst);
  }
  const obj = merged.common?.hitObject;
  if (obj) obj.burst = normalizeHitBurst(obj.burst ?? 'shard');
}

function ensureDashReact(merged: FxCatalog) {
  for (const key of DASH_KEYS) {
    if (!merged.lines[key]) merged.lines[key] = clone(DEFAULT_FX.lines[key]);
    const line = merged.lines[key];
    if (!line) continue;
    for (const lv of [1, 2, 3] as Lv[]) {
      const pack = line[lv];
      if (!pack) {
        line[lv] = clone(DEFAULT_FX.lines[key][lv]);
        continue;
      }
      const fallback = DEFAULT_FX.lines[key][lv];
      if (!pack.react) pack.react = clone(fallback.react ?? crowdReact(reactOf('knock'), reactOf('none')));
      if (fallback.rebound && !pack.rebound) pack.rebound = clone(fallback.rebound);
      if (fallback.reclock) {
        const cur = pack.reclock as (ReclockLevel & { window?: number }) | undefined;
        // 旧档是二段窗口字段，整段换成闹钟改追
        if (!cur || cur.window != null || cur.duration == null) pack.reclock = clone(fallback.reclock);
        else {
          pack.reclock = {
            duration: cur.duration,
            blastRadius: cur.blastRadius ?? fallback.reclock.blastRadius,
            blastImpulse: cur.blastImpulse ?? fallback.reclock.blastImpulse,
          };
        }
      }
      if (fallback.blame) {
        const cur = pack.blame as (BlameLevel & { radius?: number; count?: number; groundRadius?: number }) | undefined;
        // 旧档是改追字段，整段换成挂锅减速
        if (!cur || cur.radius != null || cur.count != null || cur.factor == null || cur.maxPots == null) {
          pack.blame = clone(fallback.blame);
        } else {
          pack.blame = {
            duration: cur.duration,
            factor: cur.factor,
            maxPots: cur.maxPots,
            blastRadius: cur.blastRadius ?? fallback.blame.blastRadius,
            blastImpulse: cur.blastImpulse ?? fallback.blame.blastImpulse,
            blastDelay: cur.blastDelay ?? fallback.blame.blastDelay,
            blastGap: cur.blastGap ?? fallback.blame.blastGap,
          };
        }
      }
      for (const id of CROWD_ACTOR_IDS) {
        const base = fallback.react?.[id] ?? (id === 'heavy' ? reactOf('none') : reactOf('knock'));
        const cur = pack.react[id];
        if (!cur) {
          pack.react[id] = clone(base);
          continue;
        }
        const kind = cur.kind ?? base.kind;
        pack.react[id] = { ...dashReactDefaults(kind), ...cur, kind };
      }
    }
  }
}

/** 旧档把整体冲量抄进每个角色后，整体滑条会失效；相同值收成 0 = 跟整体。 */
function liftSharedImpulse(merged: FxCatalog) {
  for (const key of DASH_KEYS) {
    const line = merged.lines[key];
    if (!line) continue;
    for (const lv of [1, 2, 3] as Lv[]) {
      const pack = line[lv];
      if (!pack?.react) continue;
      const hit = pack.hit.impulse;
      const defHit = DEFAULT_FX.lines[key][lv].hit.impulse;
      for (const id of CROWD_ACTOR_IDS) {
        const r = pack.react[id];
        if (r.kind === 'knock' && (r.impulse === hit || r.impulse === defHit)) r.impulse = 0;
      }
    }
  }
}

function ensureActorStates(merged: FxCatalog, over: Record<string, unknown> = {}) {
  const actors = isRec(over.actors) ? over.actors : {};
  for (const id of CROWD_ACTOR_IDS) {
    const a = merged.actors[id];
    const fb = DEFAULT_FX.actors[id];
    const rawActor = isRec(actors[id]) ? actors[id] : {};
    const rawStun = isRec(rawActor.stun) ? rawActor.stun : undefined;
    const staleOcta = isRec(rawStun) && !('elem' in rawStun) && !('glowOn' in rawStun);
    a.stun = a.stun ? mergeDeep(clone(fb.stun), a.stun) : clone(fb.stun);
    a.slow = a.slow ? mergeDeep(clone(fb.slow), a.slow) : clone(fb.slow);
    a.overtime = a.overtime ? mergeDeep(clone(fb.overtime), a.overtime) : clone(fb.overtime);
    a.channel = a.channel ? mergeDeep(clone(fb.channel), a.channel) : clone(fb.channel);
    if (!staleOcta) continue;
    a.stun.elem = fb.stun.elem;
    a.stun.starSize = fb.stun.starSize;
    a.stun.starOpacity = fb.stun.starOpacity;
    a.stun.orbit = fb.stun.orbit;
    a.stun.bob = fb.stun.bob;
    a.stun.tilt = fb.stun.tilt;
    a.stun.ringOn = fb.stun.ringOn;
    a.stun.ringSize = fb.stun.ringSize;
    a.stun.ringWidth = fb.stun.ringWidth;
    a.stun.ringAdditive = fb.stun.ringAdditive;
    a.stun.glowOn = fb.stun.glowOn;
    a.stun.glowSize = fb.stun.glowSize;
    a.stun.glowOpacity = fb.stun.glowOpacity;
    if (!('glowColor' in rawStun)) a.stun.glowColor = fb.stun.glowColor;
  }
}

function slickToCoffee(slick: Record<string, unknown>, extra: Partial<CoffeeLevel> = {}): CoffeeLevel {
  return {
    cooldown: 6.5,
    range: 1.7,
    count: 1,
    spacing: Number(slick.spacing) || 0.7,
    color: Number(slick.color) || 0x4a2d18,
    opacity: Number(slick.opacity) || 0.55,
    radius: Number(slick.radius) || 0.85,
    life: Number(slick.life) || 2.4,
    splashRadius: Number(slick.endRadius) || 0,
    splashLife: Number(slick.endLife) || 0,
    maxVictims: Number(slick.maxVictims) || 2,
    ...extra,
  };
}

const COFFEE_VICTIM_CAP: Record<Lv, number> = { 1: 2, 2: 3, 3: 4 };

function ensureCoffeeCaps(merged: FxCatalog) {
  for (const lv of [1, 2, 3] as Lv[]) {
    const pack = merged.skills.coffee?.[lv]?.coffee;
    if (!pack) continue;
    if (!(pack.maxVictims > 0)) pack.maxVictims = COFFEE_VICTIM_CAP[lv];
  }
}

/** 旧版「咖啡冲刺」→ 主动技能咖啡 + 冲刺属性倦怠 */
function liftCoffeeAndSlump(merged: FxCatalog, over: Record<string, unknown>) {
  const overLines = isRec(over.lines) ? over.lines : {};
  const overSkills = isRec(over.skills) ? over.skills : {};
  const coffeeDash = isRec(overLines.coffee) ? overLines.coffee : isRec((merged.lines as Record<string, unknown>).coffee) ? ((merged.lines as Record<string, unknown>).coffee as Record<string, unknown>) : null;
  if (!isRec(overSkills.coffee) && coffeeDash && isRec(coffeeDash['1'])) {
    const l1 = isRec(coffeeDash['1']) ? coffeeDash['1'] : {};
    const l2 = isRec(coffeeDash['2']) ? coffeeDash['2'] : {};
    const l3 = isRec(coffeeDash['3']) ? coffeeDash['3'] : {};
    const s1 = isRec(l1.slick) ? l1.slick : {};
    const s2 = isRec(l2.slick) ? l2.slick : {};
    const s3 = isRec(l3.slick) ? l3.slick : {};
    merged.skills.coffee = levels(
      { coffee: slickToCoffee(s1) },
      { coffee: { radius: Number(s2.radius) || 1.2, life: Number(s2.life) || 3.6 } },
      { coffee: { count: 3, splashRadius: Number(s3.endRadius) || Number(s3.radius) || 1.8, splashLife: Number(s3.endLife) || Number(s3.life) || 3.2 } }
    );
  }
  if (!merged.skills.coffee) merged.skills.coffee = clone(DEFAULT_FX.skills.coffee);
  if (!merged.lines.slump) merged.lines.slump = clone(DEFAULT_FX.lines.slump);
  delete (merged.lines as Record<string, unknown>).coffee;
}

export function clampLv(lv: number): Lv {
  return (lv <= 1 ? 1 : lv >= 3 ? 3 : 2) as Lv;
}

export function dashFx(line: DashKey | null | undefined, lv = 1): DashLevelFx {
  return current.lines[line && line in current.lines ? line : 'none'][clampLv(lv)];
}

export function skillFx(id: SkillKey, lv = 1): SkillLevelFx {
  return current.skills[id][clampLv(lv)];
}

/** 这一关的咖啡族渍色。破罐破摔、喝咖啡、泼脏水、外卖汤各读各的。 */
export function coffeeColorOnDay(day: WeekdayId, lv = 1): number {
  const level = clampLv(lv);
  const own = current.dayLooks?.coffee?.[day]?.[level];
  if (typeof own === 'number') return own;
  return current.skills.coffee[level]?.coffee?.color ?? 0x4a2d18;
}

/** 这一关的分身光晕。工位马甲、我是NPC、假人下班各读各的。 */
export function decoyGlowOnDay(day: WeekdayId): number {
  const own = current.dayLooks?.decoy?.[day]?.glowColor;
  if (typeof own === 'number') return own;
  return DECOY_GLOW_DEFAULT[day] ?? 0x57d98f;
}

function ensureDayLooks(merged: FxCatalog, over: Record<string, unknown>) {
  const shared = (lv: Lv) => merged.skills.coffee[lv]?.coffee?.color ?? 0x4a2d18;
  const paintedAllGreen = ([1, 2, 3] as Lv[]).every((lv) => shared(lv) === COFFEE_GREEN);
  const fallback = (lv: Lv) => (paintedAllGreen ? COFFEE_SAVED[lv] : shared(lv));
  if (paintedAllGreen) {
    for (const lv of [1, 2, 3] as Lv[]) {
      const pack = merged.skills.coffee[lv]?.coffee;
      if (pack) pack.color = COFFEE_SAVED[lv];
    }
  }
  const overCoffee =
    isRec(over.dayLooks) && isRec(over.dayLooks.coffee) ? over.dayLooks.coffee : {};
  const coffee = {} as Record<WeekdayId, DayCoffeeColors>;
  for (const day of COFFEE_DAYS) {
    const row = isRec(overCoffee[day]) ? overCoffee[day] : {};
    const pick = (lv: Lv) => {
      const raw = row[lv] ?? row[String(lv)];
      if (typeof raw === 'number') return raw;
      if (day === 'friday' && paintedAllGreen) return COFFEE_GREEN;
      return fallback(lv);
    };
    coffee[day] = { 1: pick(1), 2: pick(2), 3: pick(3) };
  }
  const overDecoy = isRec(over.dayLooks) && isRec(over.dayLooks.decoy) ? over.dayLooks.decoy : {};
  const decoy = {} as Record<WeekdayId, DayDecoyLook>;
  for (const day of COFFEE_DAYS) {
    const row = isRec(overDecoy[day]) ? overDecoy[day] : {};
    const raw = row.glowColor;
    decoy[day] = { glowColor: typeof raw === 'number' ? raw : DECOY_GLOW_DEFAULT[day] };
  }
  merged.dayLooks = { coffee, decoy };
}

export function hazardFx(id: HazardKind): HazardFx {
  return current.hazards[id] ?? DEFAULT_FX.hazards[id];
}

/** 关卡里这一件的覆盖 + 特效目录默认值 */
export function mergeHazardFx(kind: HazardKind, tune?: HazardTune): HazardFx {
  const base = hazardFx(kind);
  return {
    color: base.color,
    opacity: base.opacity,
    radius: tune?.radius ?? base.radius,
    duration: tune?.duration ?? base.duration,
    factor: tune?.factor ?? base.factor,
    impulse: tune?.impulse ?? base.impulse,
    lift: tune?.lift ?? base.lift ?? 48,
  };
}

export function enemySkillFx(id: EnemySkillId): EnemySkillFx {
  return current.enemySkills[id] ?? DEFAULT_FX.enemySkills[id];
}

export function commonFx() {
  return current.common;
}

export function actorFx(id: ActorId): { ring?: PlayerRingFx } & Partial<ActorPassiveFx> {
  if (id === 'player') return current.actors.player;
  return current.actors[id];
}

export function crowdFx(id: CrowdActorId): ActorPassiveFx {
  return current.actors[id];
}

export function playerRingFx(): PlayerRingFx {
  return current.actors.player.ring;
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (isRec(o) ? o[k] : undefined), obj);
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const n = cur[keys[i]!];
    if (!isRec(n)) return;
    cur = n;
  }
  cur[keys[keys.length - 1]!] = value;
}

export function hexColor(n: number) {
  return `#${(n >>> 0).toString(16).padStart(6, '0')}`;
}

export function parseHex(s: string) {
  const n = parseInt(s.replace('#', ''), 16);
  return Number.isFinite(n) ? n >>> 0 : 0;
}

function hitFromLegacy(paper: Record<string, unknown>, mist: Record<string, unknown>, burst?: unknown): HitFx {
  return hitOf({
    burst: normalizeHitBurst(burst),
    paper: paper as Partial<PaperBurstFx>,
    mist: mist as Partial<ImpactMistFx>,
  });
}

function stripKnock(block: unknown): unknown {
  if (!isRec(block)) return block;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(block)) {
    if (!isRec(v)) {
      out[k] = v;
      continue;
    }
    const level: Record<string, unknown> = {};
    for (const [lv, pack] of Object.entries(v)) {
      if (!isRec(pack)) {
        level[lv] = pack;
        continue;
      }
      const { knock: _k, ...rest } = pack;
      level[lv] = rest;
    }
    out[k] = level;
  }
  return out;
}

function migrateV2(raw: Record<string, unknown>): Partial<FxCatalog> {
  const common = isRec(raw.common) ? raw.common : {};
  const hitPerson = isRec(common.hitPerson) ? common.hitPerson : {};
  const paper = isRec(hitPerson.paper) ? hitPerson.paper : {};
  const mist = isRec(hitPerson.mist) ? hitPerson.mist : {};
  const personHit = hitFromLegacy(paper, mist);
  const obj = isRec(common.hitObject) ? common.hitObject : {};
  const playerRing = isRec(common.playerRing) ? common.playerRing : {};
  return {
    version: 3,
    common: {
      pools: mergeDeep(clone(DEFAULT_FX.common.pools), common.pools),
      hitObject:
        isRec(obj.paper) || isRec(obj.mist)
          ? hitFromLegacy(isRec(obj.paper) ? obj.paper : {}, isRec(obj.mist) ? obj.mist : {})
          : clone(HIT_OBJECT),
    },
    actors: {
      player: { ring: ringFromUnknown(playerRing) },
      'colleague-a-m': crowdActor({ hit: personHit }),
      'colleague-a-f': crowdActor({ hit: personHit }),
      heavy: crowdActor({ hit: { paper: { ...personHit.paper, count: personHit.paper.heavyCount }, mist: personHit.mist } }),
      interceptor: crowdActor({ hit: personHit }),
    },
    lines: stripKnock(raw.lines) as FxCatalog['lines'],
    skills: stripKnock(raw.skills) as FxCatalog['skills'],
  };
}

function migrateLegacy(raw: Record<string, unknown>): Partial<FxCatalog> {
  const common = isRec(raw.common) ? raw.common : raw;
  const hitPerson = isRec(common.hitPerson) ? common.hitPerson : {};
  const paper = isRec(hitPerson.paper) ? hitPerson.paper : isRec(raw.paperBurst) ? raw.paperBurst : {};
  const mist = isRec(hitPerson.mist) ? hitPerson.mist : isRec(raw.impactMist) ? raw.impactMist : {};
  const trailSrc = isRec(raw.dashTrail) ? raw.dashTrail : {};
  const hit = isRec(raw.dashHit) ? raw.dashHit : {};
  const slick = isRec(raw.slick) ? raw.slick : {};
  const phantom = isRec(raw.phantom) ? raw.phantom : {};
  const decoy = isRec(raw.decoy) ? raw.decoy : {};
  const keyboard = isRec(raw.keyboard) ? raw.keyboard : {};
  const colors = isRec(trailSrc.colors) ? trailSrc.colors : {};
  const personHit = hitFromLegacy(paper, mist);
  const playerRing = isRec(common.playerRing) ? common.playerRing : {};
  const tBase = {
    interval: Number(trailSrc.interval) || 0.035,
    life: Number(trailSrc.life) || 0.22,
    opacity: Number(trailSrc.opacity) || 0.4,
    radius: Number(trailSrc.radius) || 0.26,
    height: Number(trailSrc.height) || 0.5,
    ghost: trailSrc.ghost !== false,
    additive: trailSrc.additive !== false,
    stretch: Number(trailSrc.stretch) || 1.85,
    fadePow: Number(trailSrc.fadePow) || 1.35,
    copies: Number(trailSrc.copies) || 2,
  };
  const noneHit: DashHitLevel = {
    time: Number(hit.time) || 0.18,
    speed: Number(hit.speed) || 13,
    cooldown: Number(hit.cooldown) || 1.4,
    radius: Number(hit.radius) || 1,
    impulse: Number(hit.impulse) || 460,
    maxHits: Number(hit.maxHits) || 0,
    oncePerDash: !!hit.oncePerDash,
  };
  const obj = isRec(common.hitObject) ? common.hitObject : {};
  return {
    version: 3,
    common: {
      pools: {
        paper: Number(paper.pool) || Number(isRec(common.pools) ? common.pools.paper : 64) || 64,
        mist: Number(mist.pool) || Number(isRec(common.pools) ? common.pools.mist : 56) || 56,
        trail: Number(trailSrc.pool) || Number(isRec(common.pools) ? common.pools.trail : 16) || 16,
      },
      hitObject: isRec(obj.paper) || isRec(obj.mist) ? hitFromLegacy(isRec(obj.paper) ? obj.paper : {}, isRec(obj.mist) ? obj.mist : {}) : clone(HIT_OBJECT),
    },
    actors: {
      player: { ring: ringFromUnknown(playerRing) },
      'colleague-a-m': crowdActor({ hit: personHit }),
      'colleague-a-f': crowdActor({ hit: personHit }),
      heavy: crowdActor({ hit: { paper: { ...personHit.paper, count: personHit.paper.heavyCount }, mist: personHit.mist } }),
      interceptor: crowdActor({ hit: personHit }),
    },
    lines: {
      none: levels(dash(noneHit, Number(colors.none) || 0x6eb6ff, { trail: trail(Number(colors.none) || 0x6eb6ff, tBase) })),
      brute: levels(
        dash({ ...noneHit, impulse: Number(hit.impulse) || 520 }, Number(colors.brute) || 0xff6b57, {
          trail: trail(Number(colors.brute) || 0xff6b57, tBase),
        }),
        { hit: { time: Number(hit.bruteTime) || 0.24, radius: Number(hit.bruteRadius) || 1.5 } },
        { hit: { impulse: Number(hit.bruteImpulse) || 900 } }
      ),
      slump: levels(
        dash({ ...noneHit, impulse: 400 }, Number(colors.coffee) || 0x8aa0b8, {
          trail: trail(Number(colors.coffee) || 0x8aa0b8, tBase),
          slump: { radius: 1.9, duration: 2.2, factor: 0.42, heavy: false, color: 0x7a90a8, opacity: 0.45, pulseLife: 0.45 },
        }),
        { slump: { radius: 2.6, duration: 3.2, factor: 0.32 } },
        { slump: { radius: 3.2, duration: 4.0, factor: 0.26, heavy: true } }
      ),
      phantom: levels(
        dash({ ...noneHit, impulse: 0 }, Number(colors.phantom) || 0x8ea2ff, {
          trail: trail(Number(colors.phantom) || 0x8ea2ff, tBase),
          phantom: {
            stun: Number(phantom.stun) || 0.9,
            heavyStun: Number(phantom.heavyStun) || 0.5,
            cdRefund: 0,
            phaseTime: 0,
          },
        }),
        { phantom: { cdRefund: Number(phantom.cdRefund) || 0.35 } },
        { phantom: { phaseTime: Number(phantom.phaseTime) || 1.5 } }
      ),
      rebound: clone(DEFAULT_FX.lines.rebound),
      reclock: clone(DEFAULT_FX.lines.reclock),
      blame: clone(DEFAULT_FX.lines.blame),
    },
    skills: {
      decoy: levels(
        {
          decoy: {
            cooldown: Number(decoy.cooldown) || 9,
            duration: Number(decoy.duration) || 4,
            blastRadius: 0,
            blastImpulse: 0,
            hitBurst: 'spark',
            opacity: Number(decoy.opacity) || 0.48,
            color: Number(decoy.color) || 0xffffff,
            glowStyle: normalizeThrowGlowStyle(decoy.glowStyle, decoy.glow !== false),
            glowColor: Number(decoy.glowColor) || 0x57d98f,
            glowOpacity: Number(decoy.glowOpacity) || 0.5,
            glowSize: Number(decoy.glowSize) || 1.9,
          },
        },
        {
          decoy: {
            duration: Number(decoy.durationLv2) || 6,
            opacity: 0.52,
            glowStyle: 'ring',
            glowOpacity: 0.55,
            glowSize: 1.7,
          },
        },
        {
          decoy: {
            blastRadius: Number(decoy.blastRadius) || 2.6,
            blastImpulse: Number(decoy.blastImpulse) || 340,
            opacity: 0.55,
            glowStyle: 'core',
            glowOpacity: 0.58,
            glowSize: 2.0,
          },
        }
      ),
      keyboard: levels(
        {
          keyboard: {
            cooldown: Number(keyboard.cooldown) || 5.5,
            speed: Number(keyboard.speed) || 14,
            range: Number(keyboard.range) || 8,
            width: Number(keyboard.width) || 0.75,
            hitImpulse: Number(keyboard.hitImpulse) || 340,
            knockImpulse: Number(keyboard.knockImpulse) || 300,
            hitBurst: 'note',
            scale: Number(keyboard.scale) || 1,
            color: Number(keyboard.color) || 0xffffff,
            glowStyle: normalizeThrowGlowStyle(keyboard.glowStyle, keyboard.glow !== false),
            glowColor: Number(keyboard.glowColor) || 0xffd257,
            glowOpacity: Number(keyboard.glowOpacity) || 0.3,
            glowSize: Number(keyboard.glowSize) || 1.45,
          },
        },
        {
          keyboard: {
            width: Number(keyboard.widthLv2) || 1.05,
            scale: 1.25,
            glowStyle: 'ring',
            glowOpacity: 0.4,
            glowSize: 1.2,
          },
        },
        {
          keyboard: {
            scale: 1.55,
            glowStyle: 'core',
            glowOpacity: 0.38,
            glowSize: 1.35,
          },
        }
      ),
      coffee: levels(
        {
          coffee: slickToCoffee(slick, {
            radius: Number(slick.radius) || 0.85,
            life: Number(slick.life) || 2.4,
          }),
        },
        { coffee: { radius: Number(slick.radiusLv2) || 1.2, life: Number(slick.lifeLv2) || 3.6 } },
        { coffee: { count: 3, splashRadius: Number(slick.endRadius) || 1.8, splashLife: Number(slick.endLife) || 3.2 } }
      ),
    },
  };
}

export async function loadFxCatalog(url = `${import.meta.env.BASE_URL}fx/catalog.json`) {
  try {
    const res = await fetch(url);
    if (!res.ok) return current;
    const data = (await res.json()) as { version?: number };
    if (data?.version === 3) replaceFx(data as FxCatalog);
    else if (data?.version === 2 && isRec(data)) current = mergeFx(DEFAULT_FX, migrateV2(data));
    else if (isRec(data)) current = mergeFx(DEFAULT_FX, migrateLegacy(data));
  } catch {
    /* 缺文件时用默认值 */
  }
  return current;
}

/** 游戏页监听编辑器推送：不整页刷新，只换 catalog */
export function watchFxCatalog() {
  const hot = import.meta.hot;
  if (!hot) return;
  hot.on('fx-catalog', (data: unknown) => {
    if (isRec(data) && isRec(data.actors) && isRec(data.lines)) replaceFx(data as unknown as FxCatalog);
    else void loadFxCatalog();
  });
}
