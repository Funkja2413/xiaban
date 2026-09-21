import { isKitHairId, isKitSkirtId, KIT_URL, type KitHairId, type KitSkirtId } from './kit';
import { WEEKDAYS, weekdaySlot, type WeekdayId } from './levels';
import { isPlayerSlotId, ROSTER, rosterSlot, type PlayerSlotId } from './roster';

/** 同事形象清单。id 必须是 src/roster.ts 里的槽位。游戏只读；写入走编辑器。 */

export type Gender = 'male' | 'female';

export const ENEMY_SKILL_IDS = ['cut-in', 'desk-slam', 'rally'] as const;
export type EnemySkillId = (typeof ENEMY_SKILL_IDS)[number];

export const ENEMY_SKILL_META: Record<EnemySkillId, { name: string; hint: string }> = {
  'cut-in': { name: '截杀', hint: '拦截者' },
  'desk-slam': { name: '拍桌', hint: '主管' },
  rally: { name: '喊人', hint: '进圈站住减速' },
};

export function migrateEnemySkill(s?: string | null): EnemySkillId | null {
  if (s === 'cut-in' || s === 'desk-slam' || s === 'rally') return s;
  return null;
}

export interface HairTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface HairDef {
  id: string;
  file: string;
  preRotation: [number, number, number];
}

export interface PropDef {
  id: string;
  file: string;
  preRotation: [number, number, number];
  /**
   * 编辑器预设把模型最长边压到该尺寸（米）。
   * 点预设时写进网格；读档和游戏必须同样压，否则会按源文件单位（往往是 Blender 米）显示过大。
   */
  fit?: number;
}

/** 与编辑器 PROP_PRESETS 一致。catalog 未写 fit 时也按 id 回退，避免旧档读爆。 */
export const PROP_PRESET_FIT: Record<string, number> = {
  'prop-cup': 0.1,
  'prop-laptop': 0.22,
  'prop-mic': 0.26,
  'prop-lens': 0.2,
  'prop-radio': 0.12,
  'prop-award': 0.16,
  'prop-paper': 0.16,
  'prop-trophy': 0.14,
  'prop-papers': 0.2,
  'prop-pack': 0.32,
  'prop-toilet': 0.36,
  'prop-horn': 0.2,
  'prop-heart': 0.14,
  'prop-clock': 0.1,
  'prop-pot': 0.18,
  'prop-pizza': 0.22,
  'prop-detonator': 0.1,
  'prop-bell': 0.12,
  'prop-keys': 0.18,
  'prop-stop': 0.22,
  'prop-bible': 0.16,
  'prop-swatter': 0.34,
  'prop-oil': 0.14,
};

export function propFitOf(id: string, stored?: number): number | undefined {
  if (stored && stored > 0) return stored;
  const fallback = PROP_PRESET_FIT[id];
  return fallback && fallback > 0 ? fallback : undefined;
}

/** 头顶（帽子，与发型并存）、右手、后背（胸椎） */
export type AttachAnchor = 'head' | 'hand' | 'back';

export interface PropUse {
  id: string;
  anchor: AttachAnchor;
  transform: HairTransform;
}

export interface SkinDef {
  id: string;
  file: string;
  flipY: boolean;
}

export interface VariantDef {
  id: string;
  label: string;
  gender: Gender;
  skin: string;
  hair: string | null;
  hairTransform: HairTransform;
  props: PropUse[];
  /** kit fat/thin：-1 瘦 … 0 … +1 胖 */
  bodyMorph?: number;
  /** 相对 1.72m 标准身高的整体缩放。缺省：主管 1.38，其余 1 */
  bodyScale?: number;
  /** 包内蒙皮头发；null / 缺省 = 图集短发 */
  kitHair?: KitHairId | null;
  /** 头发贴图（独立 UV，默认 hair_albedo） */
  kitHairMap?: string | null;
  /** 外挂铅笔裙；null = 穿裤 */
  kitSkirt?: KitSkirtId | null;
  /** 裙布贴图（独立 UV，默认 skirt_black） */
  kitSkirtMap?: string | null;
  /** 角色规划缩略图，编辑器保存时写入 */
  thumb?: string | null;
  /**
   * 保存封面时的棚拍构图：相机位 + 注视点 + FOV。
   * 点选该角色时还原，方便接着调；不进战场。
   */
  thumbCam?: ThumbCam | null;
  /** 周三起个别同事的主动。玩家槽不要挂。 */
  enemySkill?: EnemySkillId | null;
}

/** 编辑器封面构图（只影响预览/缩略图） */
export type ThumbCam = {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
};

export interface ColleagueDay {
  id: WeekdayId;
  label: string;
  variants: VariantDef[];
}

export interface ColleagueCatalog {
  version: 1;
  active: WeekdayId;
  base: {
    mesh: string;
    idle: string;
    run: string;
    height: number;
  };
  hairs: HairDef[];
  props: PropDef[];
  skins: SkinDef[];
  days: ColleagueDay[];
  /** 当前选中关的形象；与 days[n].variants 同一份引用 */
  variants: VariantDef[];
}

export const BUDGET = { skins: 16, props: 6 };

/** 旧 catalog id → 规划槽位 */
const SLOT_ALIASES: Record<string, string> = {
  'colleague-f-01': 'colleague-a-f',
  'colleague-m-01': 'colleague-a-m',
};

export const IDENTITY_TRANSFORM: HairTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

export const OFFICIAL_SKINS: SkinDef[] = [
  { id: 'kenney-male-a', file: '/models/kit/textures/survivorMaleB.png', flipY: false },
  { id: 'kenney-female-a', file: '/models/kit/textures/lady_03_purple_vest_skirt.png', flipY: false },
];

export function slotSkinId(slotId: string) {
  return `skin-${slotId}`;
}

export function officialSkinForGender(gender: Gender): SkinDef {
  return OFFICIAL_SKINS.find((s) => s.id === `kenney-${gender}-a`) ?? OFFICIAL_SKINS[0];
}

export function isOfficialSkinId(id: string) {
  return id === 'kenney-male-a' || id === 'kenney-female-a';
}

/** 与 enemies InstancedMesh 套数对齐：普通男 / 普通女 / 重量级 / 拦截者 */
export const BATTLE_SLOT_IDS = ['colleague-a-m', 'colleague-a-f', 'heavy', 'interceptor'] as const;

export function lookForSlot(cat: ColleagueCatalog, id: string): VariantDef | undefined {
  const slotId = SLOT_ALIASES[id] ?? id;
  return cat.variants.find((v) => (SLOT_ALIASES[v.id] ?? v.id) === slotId);
}

/** 指定工作日的形象，不改 cat.variants 指针 */
export function lookForSlotOnDay(cat: ColleagueCatalog, day: WeekdayId, id: string): VariantDef | undefined {
  const variants = cat.days.find((d) => d.id === day)?.variants ?? cat.variants;
  return lookForSlot({ ...cat, variants }, id);
}

/**
 * 男女主角形象不跟当前关走。主页可能是上周打过的关，
 * 那天的 player 槽经常还是 Kenney 占位皮，选角棚就会长成同事。
 */
export function lookForProtagonist(cat: ColleagueCatalog, id: PlayerSlotId): VariantDef | undefined {
  const skinId = slotSkinId(id);
  for (const day of cat.days) {
    const hit = (day.variants ?? []).find((v) => v.id === id && v.skin === skinId);
    if (hit) return hit;
  }
  return lookForSlotOnDay(cat, 'monday', id) ?? lookForSlot(cat, id);
}

/** 解析主角槽时，把 catalog.variants 临时换成主角那套 */
export function catalogForPlayerSlot(cat: ColleagueCatalog, id: string): ColleagueCatalog {
  if (!isPlayerSlotId(id)) return cat;
  const look = lookForProtagonist(cat, id);
  if (!look) return cat;
  return { ...cat, variants: [look, ...cat.variants.filter((v) => v.id !== id)] };
}

export function hairForSlot(
  cat: ColleagueCatalog,
  id: string
): { def: HairDef; transform: HairTransform } | null {
  const look = lookForSlot(cat, id);
  if (!look?.hair) return null;
  const def = cat.hairs.find((h) => h.id === look.hair);
  if (!def) return null;
  return { def, transform: look.hairTransform };
}

export function propForSlot(
  cat: ColleagueCatalog,
  id: string,
  anchor: AttachAnchor
): { def: PropDef; transform: HairTransform } | null {
  const look = lookForSlot(cat, id);
  const use = look?.props.find((p) => p.anchor === anchor);
  if (!use) return null;
  const def = cat.props.find((p) => p.id === use.id);
  if (!def) return null;
  return { def, transform: use.transform };
}

export function skinForSlot(cat: ColleagueCatalog, id: string): SkinDef {
  const slot = rosterSlot(id);
  const official = officialSkinForGender(slot?.gender ?? 'male');
  const look = lookForSlot(cat, id);
  if (!look) return official;
  const found = cat.skins.find((s) => s.id === look.skin);
  if (!found) return official;
  return { ...found, flipY: false };
}

export function bodyMorphForSlot(cat: ColleagueCatalog, id: string) {
  const v = lookForSlot(cat, id)?.bodyMorph ?? 0;
  return Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0));
}

export const BODY_SCALE_MIN = 0.5;
export const BODY_SCALE_MAX = 2;
/** 未写 bodyScale 时主管仍用战场原来的大块头 */
export const HEAVY_BODY_SCALE = 1.38;

export function defaultBodyScale(id: string) {
  return rosterSlot(id)?.enemy === 'C' ? HEAVY_BODY_SCALE : 1;
}

export function clampBodyScale(v: number) {
  return Math.max(BODY_SCALE_MIN, Math.min(BODY_SCALE_MAX, v));
}

export function bodyScaleForSlot(cat: ColleagueCatalog, id: string) {
  const raw = lookForSlot(cat, id)?.bodyScale;
  const v = raw != null && Number.isFinite(raw) && raw > 0 ? raw : defaultBodyScale(id);
  return clampBodyScale(v);
}

export function kitHairForSlot(cat: ColleagueCatalog, id: string): KitHairId | null {
  const h = lookForSlot(cat, id)?.kitHair;
  return isKitHairId(h) ? h : null;
}

export function kitSkirtForSlot(cat: ColleagueCatalog, id: string): KitSkirtId | null {
  const s = lookForSlot(cat, id)?.kitSkirt;
  return isKitSkirtId(s) ? s : null;
}

export function kitHairMapForSlot(cat: ColleagueCatalog, id: string): string | null {
  const f = lookForSlot(cat, id)?.kitHairMap;
  return f && f.length ? f : null;
}

export function kitSkirtMapForSlot(cat: ColleagueCatalog, id: string): string | null {
  const f = lookForSlot(cat, id)?.kitSkirtMap;
  return f && f.length ? f : null;
}

/** 规划里还没有形象的槽，用游戏正在用的官方皮补上，两边同一份数据。 */
export function ensureRosterLooks(cat: ColleagueCatalog): boolean {
  let added = false;
  for (const slot of ROSTER) {
    if (lookForSlot(cat, slot.id)) continue;
    const skin = officialSkinForGender(slot.gender);
    if (!cat.skins.some((s) => s.id === skin.id)) cat.skins.push({ ...skin });
    cat.variants.push({
      id: slot.id,
      label: slot.label,
      gender: slot.gender,
      skin: skin.id,
      hair: null,
      hairTransform: { ...IDENTITY_TRANSFORM },
      props: [],
      bodyMorph: 0,
      bodyScale: defaultBodyScale(slot.id),
      kitHair: null,
      kitHairMap: null,
      kitSkirt: null,
      kitSkirtMap: null,
      thumb: null,
      thumbCam: null,
      enemySkill: null,
    });
    added = true;
  }
  return added;
}

/** GitHub Pages 用相对根路径；开发服务器 BASE_URL 为 `/` */
let assetBust = '';

export function bustCatalogAssets(token = String(Date.now())) {
  assetBust = token;
}

export function assetUrl(p: string) {
  const rel = p.replace(/^\//, '');
  const url = `${import.meta.env.BASE_URL}${rel}`;
  if (!assetBust) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${assetBust}`;
}

/** 形象相关字段；变了就该重烤 kit。 */
export function catalogLookStamp(cat: ColleagueCatalog): string {
  const variant = (v: VariantDef) => [
    v.id,
    v.skin,
    v.hair,
    v.hairTransform,
    v.props,
    v.bodyMorph,
    v.bodyScale,
    v.kitHair,
    v.kitHairMap,
    v.kitSkirt,
    v.kitSkirtMap,
    v.enemySkill,
  ];
  return JSON.stringify({
    active: cat.active,
    skins: cat.skins.map((s) => [s.id, s.file]),
    props: cat.props.map((p) => [p.id, p.file, p.fit]),
    hairs: cat.hairs.map((h) => [h.id, h.file]),
    variants: cat.variants.map(variant),
    days: cat.days.map((d) => ({ id: d.id, variants: d.variants.map(variant) })),
  });
}

export function emptyDay(id: WeekdayId): ColleagueDay {
  const slot = weekdaySlot(id);
  return { id, label: slot?.label ?? id, variants: [] };
}

export function emptyCatalog(): ColleagueCatalog {
  const days = WEEKDAYS.map((s) => emptyDay(s.id));
  return {
    version: 1,
    active: 'monday',
    base: {
      mesh: KIT_URL,
      idle: '/models/kenney/idle.fbx',
      run: '/models/kenney/run.fbx',
      height: 1.72,
    },
    hairs: [],
    props: [],
    skins: [],
    days,
    variants: days[0].variants,
  };
}

function stripOverlayHair(v: VariantDef) {
  v.hair = null;
  v.hairTransform ??= { ...IDENTITY_TRANSFORM };
  v.props ??= [];
  v.bodyMorph ??= 0;
  v.bodyScale ??= defaultBodyScale(v.id);
  v.kitHair ??= null;
  v.kitHairMap ??= null;
  v.kitSkirt ??= null;
  v.kitSkirtMap ??= null;
  v.thumb ??= null;
  v.thumbCam ??= null;
  v.enemySkill = migrateEnemySkill(v.enemySkill);
}

/** 旧 catalog 只有一份 variants：复制到周一～周五。缺槽会补上。 */
export function ensureLookDays(cat: ColleagueCatalog): boolean {
  if (!weekdaySlot(cat.active)) cat.active = 'monday';
  cat.days ??= [];
  const seed = Array.isArray(cat.variants) && cat.variants.length ? cat.variants : [];
  let added = false;
  for (const slot of WEEKDAYS) {
    let day = cat.days.find((d) => d.id === slot.id);
    if (!day) {
      day = {
        id: slot.id,
        label: slot.label,
        variants: structuredClone(seed),
      };
      cat.days.push(day);
      added = true;
    } else {
      day.label = slot.label;
      day.variants ??= [];
    }
    for (const v of day.variants) stripOverlayHair(v);
    const wrap: ColleagueCatalog = { ...cat, variants: day.variants };
    if (ensureRosterLooks(wrap)) added = true;
    day.variants = wrap.variants;
  }
  return added;
}

export function selectCatalogDay(cat: ColleagueCatalog, id?: string | null): WeekdayId {
  const want = (id && weekdaySlot(id)?.id) || cat.active || 'monday';
  const day = cat.days.find((d) => d.id === want) ?? cat.days[0] ?? emptyDay('monday');
  if (!cat.days.includes(day)) cat.days.push(day);
  cat.variants = day.variants;
  return day.id;
}

export function serializeCatalog(cat: ColleagueCatalog) {
  return {
    version: 1 as const,
    active: cat.active,
    base: cat.base,
    hairs: [] as ColleagueCatalog['hairs'],
    props: cat.props,
    skins: cat.skins,
    days: cat.days,
  };
}

let playDayHint: string | null = null;

/** 开局指定工作日，优先于 URL ?day= */
export function setPlayDayHint(id: string | null) {
  playDayHint = id;
}

export async function loadCatalog(): Promise<ColleagueCatalog> {
  const pickDay = () => {
    if (playDayHint) return playDayHint;
    try {
      return new URLSearchParams(location.search).get('day');
    } catch {
      return null;
    }
  };
  const finish = (cat: ColleagueCatalog) => {
    cat.hairs ??= [];
    cat.props ??= [];
    cat.skins ??= [];
    cat.variants ??= [];
    cat.days ??= [];
    cat.base ??= emptyCatalog().base;
    cat.base.mesh = KIT_URL;
    cat.active ??= 'monday';
    for (const s of cat.skins) s.flipY = false;
    const alias = (v: VariantDef) => {
      v.props ??= [];
      v.bodyMorph ??= 0;
      v.bodyScale ??= defaultBodyScale(v.id);
      v.kitHair ??= null;
      v.kitHairMap ??= null;
      v.kitSkirt ??= null;
      v.kitSkirtMap ??= null;
      const mapped = SLOT_ALIASES[v.id];
      if (mapped) {
        const slot = rosterSlot(mapped);
        v.id = mapped;
        if (slot) {
          v.label = slot.label;
          v.gender = slot.gender;
        }
      }
    };
    for (const v of cat.variants) alias(v);
    for (const day of cat.days) for (const v of day.variants ?? []) alias(v);
    ensureLookDays(cat);
    selectCatalogDay(cat, pickDay());
    return cat;
  };
  try {
    const res = await fetch(assetUrl('models/colleagues/catalog.json'));
    if (!res.ok) return finish(emptyCatalog());
    const data = (await res.json()) as ColleagueCatalog;
    if (data?.version !== 1) return finish(emptyCatalog());
    return finish(data);
  } catch {
    return finish(emptyCatalog());
  }
}

export function genderBitForSlot(cat: ColleagueCatalog, id: string): 0 | 1 {
  const look = lookForSlot(cat, id);
  const g = look?.gender ?? rosterSlot(id)?.gender ?? 'male';
  return g === 'female' ? 1 : 0;
}

export function skinFileForGender(cat: ColleagueCatalog, gender: Gender): SkinDef {
  const crowd = ROSTER.find((s) => s.kind === 'crowd' && s.gender === gender);
  if (crowd) return skinForSlot(cat, crowd.id);
  const official = OFFICIAL_SKINS.find((s) => s.id === `kenney-${gender}-a`) ?? OFFICIAL_SKINS[0];
  const variant = cat.variants.find((v) => v.gender === gender);
  if (!variant) return official;
  return cat.skins.find((s) => s.id === variant.skin) ?? official;
}
