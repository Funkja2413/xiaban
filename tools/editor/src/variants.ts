import {
  BUDGET,
  lookForSlot,
  serializeCatalog,
  type ColleagueCatalog,
  type PropDef,
  type SkinDef,
  type VariantDef,
} from '../../../src/catalog';
import { ROSTER } from '../../../src/roster';

export {
  BUDGET,
  IDENTITY_TRANSFORM,
  OFFICIAL_SKINS,
  PROP_PRESET_FIT,
  propFitOf,
  emptyCatalog,
  ensureRosterLooks,
  loadCatalog,
  lookForSlot,
  officialSkinForGender,
  serializeCatalog,
  selectCatalogDay,
  slotSkinId,
  isOfficialSkinId,
  type ColleagueCatalog,
  type Gender,
  type AttachAnchor,
  type HairDef,
  type HairTransform,
  type PropDef,
  type PropUse,
  type SkinDef,
  type VariantDef,
} from '../../../src/catalog';

export function slug(text: string, fallback: string): string {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || fallback;
}

export function budgetReport(cat: ColleagueCatalog) {
  const assigned = ROSTER.filter((s) => lookForSlot(cat, s.id)).length;
  return {
    skins: cat.skins.length,
    props: cat.props.length,
    assigned,
    slots: ROSTER.length,
    over: cat.skins.length > BUDGET.skins || cat.props.length > BUDGET.props,
  };
}

export async function saveCatalog(cat: ColleagueCatalog): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/__editor/catalog', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serializeCatalog(cat)),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? res.statusText };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function saveAsset(dir: 'skins' | 'props' | 'thumbs', name: string, bytes: ArrayBuffer): Promise<{ ok: boolean; file?: string; error?: string }> {
  try {
    const res = await fetch(`/__editor/asset?dir=${dir}&name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? res.statusText };
    return { ok: true, file: data.file };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function upsertSkin(cat: ColleagueCatalog, skin: SkinDef) {
  const i = cat.skins.findIndex((s) => s.id === skin.id);
  if (i >= 0) cat.skins[i] = skin;
  else cat.skins.push(skin);
}

export function upsertProp(cat: ColleagueCatalog, prop: PropDef) {
  const i = cat.props.findIndex((p) => p.id === prop.id);
  if (i >= 0) cat.props[i] = prop;
  else cat.props.push(prop);
}

export function upsertVariant(cat: ColleagueCatalog, variant: VariantDef) {
  const i = cat.variants.findIndex((v) => v.id === variant.id);
  if (i >= 0) cat.variants[i] = variant;
  else cat.variants.push(variant);
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
