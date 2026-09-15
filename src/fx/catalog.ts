/** 特效目录：按冲刺属性 / 主动技能 × 等级管理。游戏和编辑器读同一份。 */

import type { EnemySkillId } from '../catalog';
import type { HazardKind, HazardTune } from '../levels';

export type { EnemySkillId, HazardKind };

export const LINE_IDS = ['brute', 'slump', 'phantom', 'rebound', 'reclock', 'blame'] as const;
export type LineId = (typeof LINE_IDS)[number];
export type DashKey = 'none' | LineId;
export const DASH_KEYS = ['none', ...LINE_IDS] as const;
export type SkillKey = 'decoy' | 'keyboard' | 'coffee';
export type Lv = 1 | 2 | 3;

export interface ShockRingFx {
  color: number;
  opacity: number;
  duration: number;
  startScale: number;
  grow: number;
  y: number;
  yStep: number;
  recycle: boolean;
  additive: boolean;
  fillOpacity: number;
}

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

/** @deprecated 用 OvertimeFx */
export type HeadFx = OvertimeFx;

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

/** 补卡冲：一段结束后窗口内再按第二段 */
export interface ReclockLevel {
  window: number;
  /** 第二段时长相对 hit.time 的倍率 */
  segmentScale: number;
  /** 第二段命中退冷却 */
  hitRefund: number;
  /** 两段都命中后是否再自动滑一步 */
  autoThird: boolean;
}

/** 甩锅冲：命中第一个人，周围改追他 */
export interface BlameLevel {
  duration: number;
  radius: number;
  count: number;
  /** 空挥时脚下随机甩锅半径，0 = 必须撞到人 */
  groundRadius: number;
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
}

export const THROW_GLOW_STYLE_IDS = ['off', 'soft', 'ring', 'core', 'flare'] as const;
export type ThrowGlowStyle = (typeof THROW_GLOW_STYLE_IDS)[number];

export const THROW_GLOW_STYLE_META: { id: ThrowGlowStyle; name: string; blurb: string }[] = [
  { id: 'off', name: '无', blurb: '不要光晕' },
  { id: 'soft', name: '柔光', blurb: '淡淡外壳' },
  { id: 'ring', name: '光环', blurb: '腰间一圈' },
  { id: 'core', name: '内核', blurb: '亮心+淡晕' },
  { id: 'flare', name: '十字闪', blurb: '交叉光片' },
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
  ring: number;
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

const RING: ShockRingFx = {
  color: 0xffe7a0,
  opacity: 0.7,
  duration: 0.28,
  startScale: 0.4,
  grow: 2.4,
  y: 0.06,
  yStep: 0,
  recycle: true,
  additive: true,
  fillOpacity: 0.22,
};

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

function hitOf(over: Partial<{ paper: Partial<PaperBurstFx>; mist: Partial<ImpactMistFx> }> = {}): HitFx {
  return {
    paper: mergeDeep(clone(PAPER), over.paper),
    mist: mergeDeep(clone(MIST), over.mist),
  };
}

const HIT_OBJECT = hitOf({
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
  return {
    'colleague-a-m': clone(normal),
    'colleague-a-f': clone(normal),
    interceptor: clone(normal),
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
  if (r?.kind) return { ...dashReactDefaults(r.kind), ...r };
  if (pack.phantom) {
    return reactOf('stun', { stun: id === 'heavy' ? pack.phantom.heavyStun : pack.phantom.stun, bounce: false });
  }
  if (pack.slump) {
    if (id === 'heavy' && !pack.slump.heavy) return reactOf('none', { bounce: true });
    return reactOf('slow', {
      impulse: pack.hit.impulse,
      duration: pack.slump.duration,
      factor: pack.slump.factor,
      radius: pack.slump.radius,
      bounce: false,
    });
  }
  if (id === 'heavy') return reactOf('none', { bounce: true });
  return reactOf('knock', { impulse: pack.hit.impulse });
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

export const DEFAULT_FX: FxCatalog = {
  version: 3,
  common: {
    pools: { paper: 64, mist: 56, ring: 10, trail: 16 },
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
          reclock: { window: 0.35, segmentScale: 0.85, hitRefund: 0, autoThird: false },
          react: crowdReact(reactOf('knock'), reactOf('none', { bounce: true })),
        }
      ),
      {
        reclock: { window: 0.45, segmentScale: 0.9, hitRefund: 0.25, autoThird: false },
        hit: { time: 0.15, speed: 14.5 },
      },
      {
        reclock: { window: 0.5, segmentScale: 0.95, hitRefund: 0.25, autoThird: true },
        hit: { time: 0.16, speed: 15, impulse: 420 },
      }
    ),
    blame: levels(
      dash(
        { ...NONE_HIT, impulse: 320 },
        0xd4a017,
        {
          blame: { duration: 1.2, radius: 3.2, count: 2, groundRadius: 0 },
          react: crowdReact(reactOf('shove', { impulse: 320, stun: 0.2 }), reactOf('none', { bounce: true })),
        }
      ),
      {
        blame: { duration: 1.8, radius: 3.8, count: 3, groundRadius: 0 },
        hit: { impulse: 380 },
      },
      {
        blame: { duration: 2.2, radius: 4.2, count: 4, groundRadius: 2.4 },
        hit: { impulse: 420 },
      }
    ),
  },
  skills: {
    decoy: levels(
      { decoy: { cooldown: 9, duration: 4, blastRadius: 0, blastImpulse: 0 } },
      { decoy: { duration: 6 } },
      { decoy: { blastRadius: 2.6, blastImpulse: 340 } }
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
          scale: 1,
          color: 0xffffff,
          glowStyle: 'soft',
          glowColor: 0xffd257,
          glowOpacity: 0.3,
          glowSize: 1.45,
        },
      },
      {
        keyboard: {
          width: 1.05,
          scale: 1.25,
          glowStyle: 'ring',
          glowOpacity: 0.4,
          glowSize: 1.2,
        },
      },
      {
        keyboard: {
          knockImpulse: 300,
          scale: 1.55,
          glowStyle: 'core',
          glowOpacity: 0.38,
          glowSize: 1.35,
        },
      }
    ),
    coffee: levels(
      { coffee: { cooldown: 6.5, range: 1.7, count: 1, spacing: 0.7, color: 0x4a2d18, opacity: 0.55, radius: 0.85, life: 2.4, splashRadius: 0, splashLife: 0 } },
      { coffee: { radius: 1.2, life: 3.6, range: 2.1 } },
      { coffee: { count: 3, splashRadius: 1.8, splashLife: 3.2 } }
    ),
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
      pack.glowStyle = normalizeThrowGlowStyle(pack.glowStyle, pack.glow);
      delete pack.glow;
      if (pack.glowColor == null) pack.glowColor = fb.glowColor;
      if (pack.glowOpacity == null) pack.glowOpacity = fb.glowOpacity;
      if (pack.glowSize == null) pack.glowSize = fb.glowSize;
    }
  }
  return merged;
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
      if (fallback.reclock && !pack.reclock) pack.reclock = clone(fallback.reclock);
      if (fallback.blame && !pack.blame) pack.blame = clone(fallback.blame);
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
    ...extra,
  };
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

function hitFromLegacy(paper: Record<string, unknown>, mist: Record<string, unknown>): HitFx {
  return hitOf({
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
        ring: Number(isRec(common.pools) ? common.pools.ring : 10) || 10,
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
        { decoy: { cooldown: Number(decoy.cooldown) || 9, duration: Number(decoy.duration) || 4, blastRadius: 0, blastImpulse: 0 } },
        { decoy: { duration: Number(decoy.durationLv2) || 6 } },
        { decoy: { blastRadius: Number(decoy.blastRadius) || 2.6, blastImpulse: Number(decoy.blastImpulse) || 340 } }
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
    const res = await fetch(url, { cache: 'no-store' });
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
