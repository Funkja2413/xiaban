import { isKitHairId, isKitSkirtId, KIT_URL, type KitHairId, type KitSkirtId } from './kit';
import { WEEKDAYS, weekdaySlot, type WeekdayId } from './levels';
import { ROSTER, rosterSlot } from './roster';

/** 同事形象清单。id 必须是 src/roster.ts 里的槽位。游戏只读；写入走编辑器。 */

export type Gender = 'male' | 'female';

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

export type PropDef = HairDef;

/** 头顶（帽子，与发型并存）或右手 */
export type AttachAnchor = 'head' | 'hand';

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
}

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

export const BUDGET = { skins: 8, props: 6 };

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
      kitHair: null,
      kitHairMap: null,
      kitSkirt: null,
      kitSkirtMap: null,
      thumb: null,
    });
    added = true;
  }
  return added;
}

/** GitHub Pages 用相对根路径；开发服务器 BASE_URL 为 `/` */
export function assetUrl(p: string) {
  const rel = p.replace(/^\//, '');
  return `${import.meta.env.BASE_URL}${rel}`;
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
  v.kitHair ??= null;
  v.kitHairMap ??= null;
  v.kitSkirt ??= null;
  v.kitSkirtMap ??= null;
  v.thumb ??= null;
}

/** 旧 catalog 只有一份 variants：复制到周一～周五。 */
export function ensureLookDays(cat: ColleagueCatalog): void {
  if (!weekdaySlot(cat.active)) cat.active = 'monday';
  cat.days ??= [];
  const seed = Array.isArray(cat.variants) && cat.variants.length ? cat.variants : [];
  for (const slot of WEEKDAYS) {
    let day = cat.days.find((d) => d.id === slot.id);
    if (!day) {
      day = {
        id: slot.id,
        label: slot.label,
        variants: structuredClone(seed),
      };
      cat.days.push(day);
    } else {
      day.label = slot.label;
      day.variants ??= [];
    }
    for (const v of day.variants) stripOverlayHair(v);
    const wrap: ColleagueCatalog = { ...cat, variants: day.variants };
    ensureRosterLooks(wrap);
    day.variants = wrap.variants;
  }
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
    const res = await fetch(assetUrl('models/colleagues/catalog.json'), { cache: 'no-store' });
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
