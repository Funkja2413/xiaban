/** 关卡清单。游戏只读；写入走场景编辑器。周一～周五各一槽。 */

export type WeekdayId = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';

export interface WeekdaySlot {
  id: WeekdayId;
  label: string;
  /** 关卡选择页标题 */
  title: string;
  blurb: string;
}

export const WEEKDAYS: WeekdaySlot[] = [
  { id: 'monday', label: '周一', title: '黑色星期一', blurb: '白光窗 · 原型关' },
  { id: 'tuesday', label: '周二', title: '周二窒息尽头', blurb: 'L 形办公区 · 拖地未干' },
  { id: 'wednesday', label: '周三', title: '周三摸鱼黄金点', blurb: 'T 形加班层 · 报纸文件' },
  { id: 'thursday', label: '周四', title: '周四前的黎明', blurb: 'U 形夜班 · 弹簧门' },
  { id: 'friday', label: '周五', title: '周五冲刺夜', blurb: '十字楼层 · 隐藏地板' },
];

export interface MapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** 从包围盒切掉的室外缺口。矩形 / 圆形 / 三角都会改外轮廓并沿切口长出外墙。 */
export type VoidShape = 'rect' | 'circle' | 'tri';

export const VOID_SHAPES: { id: VoidShape; label: string }[] = [
  { id: 'rect', label: '矩形' },
  { id: 'circle', label: '圆形' },
  { id: 'tri', label: '三角' },
];

export interface MapVoid {
  id: string;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** 没有则矩形。 */
  shape?: VoidShape;
  /** 三角 / 椭圆相对包围盒中心的朝向。 */
  rotY?: number;
}

export type MapRect = { minX: number; minZ: number; maxX: number; maxZ: number };

export function normalizeRect(r: MapRect): MapRect {
  return {
    minX: Math.min(r.minX, r.maxX),
    maxX: Math.max(r.minX, r.maxX),
    minZ: Math.min(r.minZ, r.maxZ),
    maxZ: Math.max(r.minZ, r.maxZ),
  };
}

export function clipVoidToMap(v: MapVoid, map: MapBounds): MapVoid | null {
  const r = normalizeRect(v);
  const minX = Math.max(r.minX, map.minX);
  const maxX = Math.min(r.maxX, map.maxX);
  const minZ = Math.max(r.minZ, map.minZ);
  const maxZ = Math.min(r.maxZ, map.maxZ);
  if (maxX - minX < 0.4 || maxZ - minZ < 0.4) return null;
  return { ...v, minX, minZ, maxX, maxZ };
}

export function pointInRect(x: number, z: number, r: MapRect, pad = 0) {
  return x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
}

export function voidShapeOf(v: MapVoid): VoidShape {
  return v.shape === 'circle' || v.shape === 'tri' ? v.shape : 'rect';
}

export function isRectVoid(v: MapVoid) {
  return voidShapeOf(v) === 'rect';
}

function voidLocal(v: MapVoid, x: number, z: number): { lx: number; lz: number } {
  const cx = (v.minX + v.maxX) / 2;
  const cz = (v.minZ + v.maxZ) / 2;
  const hx = Math.max(0.05, (v.maxX - v.minX) / 2);
  const hz = Math.max(0.05, (v.maxZ - v.minZ) / 2);
  const dx = x - cx;
  const dz = z - cz;
  const yaw = v.rotY ?? 0;
  const c = Math.cos(-yaw);
  const s = Math.sin(-yaw);
  return { lx: (dx * c - dz * s) / hx, lz: (dx * s + dz * c) / hz };
}

function voidWorld(v: MapVoid, lx: number, lz: number): Xz {
  const cx = (v.minX + v.maxX) / 2;
  const cz = (v.minZ + v.maxZ) / 2;
  const hx = Math.max(0.05, (v.maxX - v.minX) / 2);
  const hz = Math.max(0.05, (v.maxZ - v.minZ) / 2);
  const x = lx * hx;
  const z = lz * hz;
  const yaw = v.rotY ?? 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: cx + x * c - z * s, z: cz + x * s + z * c };
}

function distToSeg(px: number, pz: number, a: Xz, b: Xz) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-12) return Math.hypot(px - a.x, pz - a.z);
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2));
  return Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz));
}

function distToPoly(x: number, z: number, poly: Xz[]) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    best = Math.min(best, distToSeg(x, z, poly[j]!, poly[i]!));
  }
  return best;
}

function pointInPoly(x: number, z: number, poly: Xz[], pad = 0) {
  if (pad > 0 && distToPoly(x, z, poly) <= pad) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const hit = a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z + 1e-9) + a.x;
    if (hit) inside = !inside;
  }
  return inside;
}

export function voidPolygon(v: MapVoid): Xz[] {
  const shape = voidShapeOf(v);
  if (shape === 'rect') {
    return [
      { x: v.minX, z: v.minZ },
      { x: v.maxX, z: v.minZ },
      { x: v.maxX, z: v.maxZ },
      { x: v.minX, z: v.maxZ },
    ];
  }
  if (shape === 'circle') {
    const n = 48;
    const pts: Xz[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push(voidWorld(v, Math.cos(a), Math.sin(a)));
    }
    return pts;
  }
  return [voidWorld(v, 0, 1), voidWorld(v, 1, -1), voidWorld(v, -1, -1)];
}

export function pointInVoid(x: number, z: number, v: MapVoid, pad = 0) {
  if (!pointInRect(x, z, v, pad + 0.05)) return false;
  const shape = voidShapeOf(v);
  if (shape === 'rect') return pointInRect(x, z, v, pad);
  if (shape === 'circle') {
    const p = voidLocal(v, x, z);
    const hx = Math.max(0.05, (v.maxX - v.minX) / 2);
    const hz = Math.max(0.05, (v.maxZ - v.minZ) / 2);
    const px = pad / hx;
    const pz = pad / hz;
    return p.lx * p.lx / ((1 + px) * (1 + px)) + p.lz * p.lz / ((1 + pz) * (1 + pz)) <= 1;
  }
  return pointInPoly(x, z, voidPolygon(v), pad);
}

export function isInVoid(x: number, z: number, voids?: MapVoid[], pad = 0) {
  return (voids ?? []).some((v) => pointInVoid(x, z, v, pad));
}

export function voidPrism(poly: Xz[], h = 4): { vertices: Float32Array; indices: Uint32Array } {
  const n = poly.length;
  const vertices = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    vertices[i * 3] = p.x;
    vertices[i * 3 + 1] = 0;
    vertices[i * 3 + 2] = p.z;
    vertices[(n + i) * 3] = p.x;
    vertices[(n + i) * 3 + 1] = h;
    vertices[(n + i) * 3 + 2] = p.z;
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i, j, n + j, i, n + j, n + i);
  }
  for (let i = 1; i < n - 1; i++) {
    idx.push(0, i + 1, i);
    idx.push(n, n + i, n + i + 1);
  }
  return { vertices, indices: new Uint32Array(idx) };
}

export function isPlayableXZ(x: number, z: number, map: MapBounds, voids?: MapVoid[]) {
  return pointInRect(x, z, map) && !isInVoid(x, z, voids);
}

function subtractRect(a: MapRect, hole: MapRect): MapRect[] {
  const minX = Math.max(a.minX, hole.minX);
  const maxX = Math.min(a.maxX, hole.maxX);
  const minZ = Math.max(a.minZ, hole.minZ);
  const maxZ = Math.min(a.maxZ, hole.maxZ);
  if (minX >= maxX - 1e-6 || minZ >= maxZ - 1e-6) return [a];
  const out: MapRect[] = [];
  if (a.minX < minX - 1e-6) out.push({ minX: a.minX, maxX: minX, minZ: a.minZ, maxZ: a.maxZ });
  if (maxX < a.maxX - 1e-6) out.push({ minX: maxX, maxX: a.maxX, minZ: a.minZ, maxZ: a.maxZ });
  if (a.minZ < minZ - 1e-6) out.push({ minX, maxX, minZ: a.minZ, maxZ: minZ });
  if (maxZ < a.maxZ - 1e-6) out.push({ minX, maxX, minZ: maxZ, maxZ: a.maxZ });
  return out.filter((r) => r.maxX - r.minX > 0.08 && r.maxZ - r.minZ > 0.08);
}

export function playableRects(map: MapBounds, voids?: MapVoid[]): MapRect[] {
  let rects: MapRect[] = [{ minX: map.minX, maxX: map.maxX, minZ: map.minZ, maxZ: map.maxZ }];
  for (const raw of voids ?? []) {
    if (!isRectVoid(raw)) continue;
    const v = clipVoidToMap(raw, map);
    if (!v) continue;
    rects = rects.flatMap((r) => subtractRect(r, v));
  }
  return rects;
}

interface OutlineEdge {
  axis: 'x' | 'z';
  at: number;
  t0: number;
  t1: number;
  dir: 1 | -1;
}

function addOutlineEdge(list: OutlineEdge[], axis: 'x' | 'z', at: number, t0: number, t1: number, dir: 1 | -1) {
  const a = Math.min(t0, t1);
  const b = Math.max(t0, t1);
  if (b - a < 0.08) return;
  list.push({ axis, at, t0: a, t1: b, dir });
}

function punchEdge(host: OutlineEdge, punch: OutlineEdge): OutlineEdge[] {
  if (host.axis !== punch.axis || Math.abs(host.at - punch.at) > 0.02 || host.dir === punch.dir) return [host];
  const a = Math.max(host.t0, punch.t0);
  const b = Math.min(host.t1, punch.t1);
  if (b <= a + 0.05) return [host];
  const out: OutlineEdge[] = [];
  if (host.t0 < a - 0.02) out.push({ ...host, t1: a });
  if (host.t1 > b + 0.02) out.push({ ...host, t0: b });
  return out;
}

function mergeColinear(edges: OutlineEdge[]): OutlineEdge[] {
  const groups = new Map<string, OutlineEdge[]>();
  for (const e of edges) {
    const k = `${e.axis}:${e.at.toFixed(2)}:${e.dir}`;
    const arr = groups.get(k) ?? [];
    arr.push(e);
    groups.set(k, arr);
  }
  const out: OutlineEdge[] = [];
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.t0 - b.t0);
    let cur = { ...arr[0]! };
    for (let i = 1; i < arr.length; i++) {
      const n = arr[i]!;
      if (n.t0 <= cur.t1 + 0.06) cur.t1 = Math.max(cur.t1, n.t1);
      else {
        out.push(cur);
        cur = { ...n };
      }
    }
    out.push(cur);
  }
  return out;
}

function outlineEdges(map: MapBounds, voids?: MapVoid[]): OutlineEdge[] {
  const rects = playableRects(map, voids);
  const edges: OutlineEdge[] = [];
  for (const r of rects) {
    addOutlineEdge(edges, 'x', r.minX, r.minZ, r.maxZ, -1);
    addOutlineEdge(edges, 'x', r.maxX, r.minZ, r.maxZ, 1);
    addOutlineEdge(edges, 'z', r.minZ, r.minX, r.maxX, -1);
    addOutlineEdge(edges, 'z', r.maxZ, r.minX, r.maxX, 1);
  }
  let cur = edges;
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < cur.length; i++) {
      for (let j = i + 1; j < cur.length; j++) {
        const a = cur[i]!;
        const b = cur[j]!;
        if (a.axis !== b.axis || Math.abs(a.at - b.at) > 0.02 || a.dir === b.dir) continue;
        const lo = Math.max(a.t0, b.t0);
        const hi = Math.min(a.t1, b.t1);
        if (hi - lo < 0.08) continue;
        cur = [...cur.filter((_, k) => k !== i && k !== j), ...punchEdge(a, b), ...punchEdge(b, a)];
        changed = true;
        break outer;
      }
    }
  }
  return mergeColinear(carveOutlineForShapedVoids(mergeColinear(cur), map, voids));
}

function sampleEdgePlayable(e: OutlineEdge, t: number, map: MapBounds, voids?: MapVoid[]) {
  const inward = e.at - e.dir * 0.2;
  const x = e.axis === 'x' ? inward : t;
  const z = e.axis === 'x' ? t : inward;
  return isPlayableXZ(x, z, map, voids);
}

/** 圆形/三角挖空后，把贴着空洞的那段轴对齐外墙拆掉，开口交给沿形状走的墙。 */
function carveOutlineForShapedVoids(edges: OutlineEdge[], map: MapBounds, voids?: MapVoid[]): OutlineEdge[] {
  if (!(voids ?? []).some((v) => !isRectVoid(v))) return edges;
  const out: OutlineEdge[] = [];
  const step = 0.05;
  for (const e of edges) {
    let run: OutlineEdge | null = null;
    const flush = () => {
      if (run && run.t1 - run.t0 > 0.12) out.push(run);
      run = null;
    };
    for (let t = e.t0; t < e.t1 - 1e-6; t += step) {
      const a = t;
      const b = Math.min(e.t1, t + step);
      const keep = sampleEdgePlayable(e, (a + b) / 2, map, voids);
      if (!keep) {
        flush();
        continue;
      }
      if (!run) run = { ...e, t0: a, t1: b };
      else run.t1 = b;
    }
    flush();
  }
  return out;
}

function clipSegToMap(a: Xz, b: Xz, map: MapBounds): { a: Xz; b: Xz } | null {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-9) return q >= -1e-6;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, a.x - map.minX)) return null;
  if (!clip(dx, map.maxX - a.x)) return null;
  if (!clip(-dz, a.z - map.minZ)) return null;
  if (!clip(dz, map.maxZ - a.z)) return null;
  if (t1 - t0 < 1e-4) return null;
  return {
    a: { x: a.x + dx * t0, z: a.z + dz * t0 },
    b: { x: a.x + dx * t1, z: a.z + dz * t1 },
  };
}

function inflateMap(map: MapBounds, p: number): MapBounds {
  return {
    minX: map.minX - p,
    maxX: map.maxX + p,
    minZ: map.minZ - p,
    maxZ: map.maxZ + p,
  };
}

function chordFacesPlayable(
  mx: number,
  mz: number,
  nx: number,
  nz: number,
  map: MapBounds,
  voids?: MapVoid[]
) {
  for (const d of [0.04, 0.1, 0.2, 0.32]) {
    if (isPlayableXZ(mx - nx * d, mz - nz * d, map, voids)) return true;
  }
  return false;
}

/** 一条挖空边往往一半贴地、一半伸进别的缺口。只给贴地的那段砌墙。 */
function wallRunsOnChord(
  a: Xz,
  b: Xz,
  nx: number,
  nz: number,
  map: MapBounds,
  voids?: MapVoid[]
): { a: Xz; b: Xz }[] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.06) return [];
  const n = Math.max(2, Math.ceil(len / 0.08));
  const keep: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    keep.push(chordFacesPlayable(a.x + dx * t, a.z + dz * t, nx, nz, map, voids));
  }
  const at = (t: number): Xz => ({ x: a.x + dx * t, z: a.z + dz * t });
  const runs: { a: Xz; b: Xz }[] = [];
  let start = -1;
  const flush = (end: number) => {
    if (start < 0) return;
    const t0 = Math.max(0, start / n - 0.12 / len);
    const t1 = Math.min(1, end / n + 0.12 / len);
    const pa = at(t0);
    const pb = at(t1);
    if (Math.hypot(pb.x - pa.x, pb.z - pa.z) >= 0.06) runs.push({ a: pa, b: pb });
    start = -1;
  };
  for (let i = 0; i < n; i++) {
    if (keep[i]) {
      if (start < 0) start = i;
    } else flush(i);
  }
  flush(n);
  return runs;
}

/** 沿圆形/三角挖空边长出的墙段。厚朝空洞里，和矩形外墙一样挡路。 */
export interface OrientedWall {
  x: number;
  y: number;
  z: number;
  rotY: number;
  len: number;
  thick: number;
  h: number;
}

function shapedVoidEdgeWalls(
  map: MapBounds,
  voids: MapVoid[] | undefined,
  thick: number,
  h: number,
  y: number,
  toward: 'void' | 'floor'
): OrientedWall[] {
  const out: OrientedWall[] = [];
  const side = toward === 'void' ? 1 : -1;
  const clipBox = inflateMap(map, 0.55);
  for (const raw of voids ?? []) {
    if (isRectVoid(raw)) continue;
    const poly = voidPolygon(raw);
    const n = poly.length;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const p0 = poly[i]!;
      const p1 = poly[(i + 1) % n]!;
      const clipped = clipSegToMap(p0, p1, clipBox);
      if (!clipped) continue;
      const dx = clipped.b.x - clipped.a.x;
      const dz = clipped.b.z - clipped.a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.06) continue;
      const mx = (clipped.a.x + clipped.b.x) / 2;
      const mz = (clipped.a.z + clipped.b.z) / 2;
      const tx = dx / len;
      const tz = dz / len;
      let nx = tz;
      let nz = -tx;
      if (!pointInVoid(mx + nx * 0.08, mz + nz * 0.08, raw)) {
        nx = -nx;
        nz = -nz;
      }
      for (const run of wallRunsOnChord(clipped.a, clipped.b, nx, nz, map, voids)) {
        const rdx = run.b.x - run.a.x;
        const rdz = run.b.z - run.a.z;
        const rlen = Math.hypot(rdx, rdz);
        if (rlen < 0.06) continue;
        const rx = (run.a.x + run.b.x) / 2;
        const rz = (run.a.z + run.b.z) / 2;
        out.push({
          x: rx + nx * side * (thick / 2),
          y,
          z: rz + nz * side * (thick / 2),
          rotY: Math.atan2(rdx, rdz),
          len: rlen,
          thick,
          h,
        });
      }
    }
  }
  return out;
}

export function shapedVoidWalls(map: MapBounds, voids?: MapVoid[]): OrientedWall[] {
  return shapedVoidEdgeWalls(map, voids, 0.5, 1.7, 1.7 / 2, 'void');
}

export function shapedVoidSkirts(map: MapBounds, voids?: MapVoid[]): OrientedWall[] {
  return shapedVoidEdgeWalls(map, voids, 0.08, 0.12, 0.06, 'floor');
}

export interface Xz {
  x: number;
  z: number;
}

export type SolidKind = 'wall' | 'wood' | 'pillar';

export interface SolidDef {
  id: string;
  kind: SolidKind;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  h: number;
  tall?: boolean;
  /** 整块墙的底色。没有则跟场景墙底色。 */
  color?: string;
  /** 六个面各自的颜色 / 贴图。有值的面覆盖 color / 场景底色。 */
  faces?: FaceColors;
}

export type DeskTop = 'oak' | 'walnut' | 'dark' | 'white' | 'steel' | 'bench';
/** 桌上复杂度：单屏 → 双屏 → 杂物 → 堆满 */
export type DeskKit = 'simple' | 'dual' | 'clutter' | 'packed';
export type ChairStyle = 'task' | 'mesh' | 'guest' | 'stool' | 'exec';
/** 绿植组合：一盆 → 树丛 */
export type PlantKit = 'pot' | 'pair' | 'trio' | 'cluster' | 'grove';

export const DESK_TOPS: { id: DeskTop; label: string }[] = [
  { id: 'oak', label: '橡木' },
  { id: 'walnut', label: '胡桃' },
  { id: 'dark', label: '深色' },
  { id: 'white', label: '白桌' },
  { id: 'steel', label: '钢桌' },
  { id: 'bench', label: '长台' },
];

export const DESK_KITS: { id: DeskKit; label: string }[] = [
  { id: 'simple', label: '单屏' },
  { id: 'dual', label: '双屏' },
  { id: 'clutter', label: '杂物' },
  { id: 'packed', label: '堆满' },
];

export const CHAIR_STYLES: { id: ChairStyle; label: string }[] = [
  { id: 'task', label: '转椅' },
  { id: 'mesh', label: '网椅' },
  { id: 'guest', label: '客椅' },
  { id: 'stool', label: '圆凳' },
  { id: 'exec', label: '高背' },
];

export const PLANT_KITS: { id: PlantKit; label: string }[] = [
  { id: 'pot', label: '单盆' },
  { id: 'pair', label: '双盆' },
  { id: 'trio', label: '三盆' },
  { id: 'cluster', label: '多盆' },
  { id: 'grove', label: '树丛' },
];

export function migratePlantKit(k?: string): PlantKit {
  if (k === 'pair' || k === 'trio' || k === 'cluster' || k === 'grove' || k === 'pot') return k;
  return 'pot';
}

/** 绿植碰撞盒随组合变大。 */
export function plantKitBounds(kit?: PlantKit): { hx: number; hz: number; h: number; mass: number } {
  if (kit === 'pair') return { hx: 0.32, hz: 0.24, h: 0.92, mass: 12 };
  if (kit === 'trio') return { hx: 0.4, hz: 0.36, h: 1.02, mass: 16 };
  if (kit === 'cluster') return { hx: 0.5, hz: 0.44, h: 1.12, mass: 22 };
  if (kit === 'grove') return { hx: 0.54, hz: 0.5, h: 1.55, mass: 28 };
  return { hx: 0.2, hz: 0.2, h: 0.82, mass: 8 };
}

export type DeskFace = 'pz' | 'nz' | 'px' | 'nx';

/** 家具/椅/桌上用品的成套配色：亮色配深地板，暗色配浅地毯。 */
export type FurnitureTone = 'light' | 'dark';

export const FURNITURE_TONES: { id: FurnitureTone; label: string }[] = [
  { id: 'light', label: '亮色' },
  { id: 'dark', label: '暗色' },
];

/** 墙面亮/暗成套色。自定义仍走 atmosphere.wall.color / 单面 color。 */
export const WALL_TONE_COLORS: Record<FurnitureTone, string> = {
  light: '#f3f1ec',
  dark: '#3e4349',
};

export function wallToneHex(tone: FurnitureTone) {
  return WALL_TONE_COLORS[tone];
}

export function toneFromWallHex(hex?: string): FurnitureTone | undefined {
  if (!hex) return undefined;
  const h = hex.trim().toLowerCase();
  if (h === WALL_TONE_COLORS.light || h === '#d8d0c4' || h === '#efeae2' || h === '#f4f1ea' || h === '#f2f0ea') return 'light';
  if (h === WALL_TONE_COLORS.dark || h === '#3a3e44' || h === '#4a4e54' || h === '#3d4248') return 'dark';
  return undefined;
}

export function migrateHexColor(c?: string): string | undefined {
  if (typeof c !== 'string') return undefined;
  const h = c.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(h)) return h.toLowerCase();
  return undefined;
}

/** BoxGeometry 六个面，和 three 材质数组顺序一致：+X −X +Y −Y +Z −Z */
export type WallFace = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
export interface FacePaint {
  color?: string;
  /** catalog 里的贴图路径。按原比例齐高或齐宽贴上，不拉伸。 */
  map?: string | null;
}
export type FaceColors = Partial<Record<WallFace, FacePaint>>;
export const WALL_FACES: WallFace[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

export function wallFaceFromIndex(faceIndex: number): WallFace {
  return WALL_FACES[Math.min(5, Math.max(0, Math.floor(faceIndex / 2)))]!;
}

export function wallFaceLabel(face: WallFace): string {
  return { px: '+X', nx: '−X', py: '顶', ny: '底', pz: '+Z', nz: '−Z' }[face];
}

/** 这一面在墙体上的宽、高（世界单位）。 */
export function wallFaceSize(sx: number, sy: number, sz: number, face: WallFace): { w: number; h: number } {
  if (face === 'px' || face === 'nx') return { w: sz, h: sy };
  if (face === 'py' || face === 'ny') return { w: sx, h: sz };
  return { w: sx, h: sy };
}

/**
 * 贴图按原比例放进这一面：比墙面更宽就齐宽，更高就齐高，不拉伸、不裁切。
 */
export function containFaceSize(faceW: number, faceH: number, imgW: number, imgH: number): { w: number; h: number } {
  const imgA = imgW / Math.max(1e-6, imgH);
  const faceA = faceW / Math.max(1e-6, faceH);
  if (imgA >= faceA) return { w: faceW, h: faceW / imgA };
  return { w: faceH * imgA, h: faceH };
}

function parseFacePaint(raw: unknown): FacePaint | undefined {
  if (typeof raw === 'string') {
    const color = migrateHexColor(raw);
    return color ? { color } : undefined;
  }
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as FacePaint;
  const color = migrateHexColor(o.color);
  const map = typeof o.map === 'string' && o.map.trim() ? o.map.trim() : undefined;
  if (!color && !map) return undefined;
  return { ...(color ? { color } : {}), ...(map ? { map } : {}) };
}

export function normalizeFaceColors(raw?: Partial<Record<WallFace, FacePaint | string>> | FaceColors): FaceColors | undefined {
  if (!raw) return undefined;
  const out: FaceColors = {};
  let n = 0;
  for (const f of WALL_FACES) {
    const p = parseFacePaint(raw[f]);
    if (p) {
      out[f] = p;
      n++;
    }
  }
  return n ? out : undefined;
}

export function patchFaceLook(
  faces: FaceColors,
  face: WallFace,
  patch: { color?: string | null; map?: string | null }
): FaceColors | undefined {
  const next: FacePaint = { ...(faces[face] ?? {}) };
  if (patch.color === null) delete next.color;
  else if (typeof patch.color === 'string') {
    const c = migrateHexColor(patch.color);
    if (c) next.color = c;
  }
  if (patch.map === null) delete next.map;
  else if (typeof patch.map === 'string' && patch.map.trim()) next.map = patch.map.trim();
  if (!next.color && !next.map) delete faces[face];
  else faces[face] = next;
  return WALL_FACES.some((f) => faces[f]) ? faces : undefined;
}

export function collectFaceMaps(def: { walls?: SolidDef[]; boundFaces?: Record<string, FaceColors> }): string[] {
  const out = new Set<string>();
  const eat = (faces?: FaceColors) => {
    if (!faces) return;
    for (const f of WALL_FACES) {
      const m = faces[f]?.map;
      if (m) out.add(m);
    }
  };
  for (const w of def.walls ?? []) eat(w.faces);
  if (def.boundFaces) for (const faces of Object.values(def.boundFaces)) eat(faces);
  return [...out];
}

/** 外角补一块墙厚，内角收到顶点；被圆形/三角切开的端头不要再往开口里伸。 */
function outlineEndPad(e: OutlineEdge, which: 't0' | 't1', t: number, map: MapBounds, voids?: MapVoid[]) {
  const endT = which === 't0' ? e.t0 : e.t1;
  const ex = e.axis === 'x' ? e.at : endT;
  const ez = e.axis === 'x' ? endT : e.at;
  if ((voids ?? []).some((v) => !isRectVoid(v) && pointInVoid(ex, ez, v, 0.45))) return 0;
  const along = which === 't0' ? e.t0 - t * 0.5 : e.t1 + t * 0.5;
  const out = e.at + e.dir * t * 0.5;
  const x = e.axis === 'x' ? out : along;
  const z = e.axis === 'x' ? along : out;
  return isPlayableXZ(x, z, map, voids) ? 0 : t;
}

export function perimeterSolids(map: MapBounds, voids?: MapVoid[]): SolidDef[] {
  const t = 0.5;
  const h = 1.7;
  if (!voids?.length) {
    return [
      { id: 'bound-w', kind: 'wall', minX: map.minX - t, minZ: map.minZ - t, maxX: map.minX, maxZ: map.maxZ + t, h, tall: true },
      { id: 'bound-e', kind: 'wall', minX: map.maxX, minZ: map.minZ - t, maxX: map.maxX + t, maxZ: map.maxZ + t, h, tall: true },
      { id: 'bound-n', kind: 'wall', minX: map.minX - t, minZ: map.minZ - t, maxX: map.maxX + t, maxZ: map.minZ, h, tall: true },
      { id: 'bound-s', kind: 'wall', minX: map.minX - t, minZ: map.maxZ, maxX: map.maxX + t, maxZ: map.maxZ + t, h, tall: true },
    ];
  }
  return outlineEdges(map, voids).map((e, i) => {
    const pad0 = outlineEndPad(e, 't0', t, map, voids);
    const pad1 = outlineEndPad(e, 't1', t, map, voids);
    if (e.axis === 'x') {
      const x0 = e.dir < 0 ? e.at - t : e.at;
      const x1 = e.dir < 0 ? e.at : e.at + t;
      return { id: `bound-${i}`, kind: 'wall' as const, minX: x0, maxX: x1, minZ: e.t0 - pad0, maxZ: e.t1 + pad1, h, tall: true };
    }
    const z0 = e.dir < 0 ? e.at - t : e.at;
    const z1 = e.dir < 0 ? e.at : e.at + t;
    return { id: `bound-${i}`, kind: 'wall' as const, minX: e.t0 - pad0, maxX: e.t1 + pad1, minZ: z0, maxZ: z1, h, tall: true };
  });
}

export function outlineSkirts(map: MapBounds, voids?: MapVoid[]): MapRect[] {
  const s = 0.08;
  return outlineEdges(map, voids).map((e) => {
    if (e.axis === 'x') {
      const x0 = e.dir < 0 ? e.at : e.at - s;
      const x1 = e.dir < 0 ? e.at + s : e.at;
      return { minX: x0, maxX: x1, minZ: e.t0, maxZ: e.t1 };
    }
    const z0 = e.dir < 0 ? e.at : e.at - s;
    const z1 = e.dir < 0 ? e.at + s : e.at;
    return { minX: e.t0, maxX: e.t1, minZ: z0, maxZ: z1 };
  });
}

export function migrateTone(t?: string): FurnitureTone | undefined {
  if (t === 'light' || t === 'dark') return t;
  return undefined;
}

export function resolveTone(item?: { tone?: FurnitureTone }, atmo?: { furnitureTone?: FurnitureTone }): FurnitureTone {
  return item?.tone ?? atmo?.furnitureTone ?? 'dark';
}

/** 单件家具的自定义色。没有则走亮色/暗色成套。 */
export function resolveItemColor(item?: { color?: string }): string | undefined {
  return migrateHexColor(item?.color);
}

/** 点「自定义」且还没选过色时的默认：懒人沙发那种橙。 */
export const DEFAULT_CUSTOM_COLOR = '#e07a3a';

export interface DeskDef {
  id: string;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** 桌面材质 */
  top?: DeskTop;
  /** 桌上摆设 */
  kit?: DeskKit;
  /** 人坐的一侧（正交）。任意朝向用 rotY。 */
  face?: DeskFace;
  /** 整张桌子的朝向（弧度）。有值时优先于 face。桌面、腿、桌上物品一起转。 */
  rotY?: number;
  /** 腿、挡板、桌上键鼠等成套色。没有则跟场景默认。 */
  tone?: FurnitureTone;
  /** 这一件的自定义主色。有值时盖过亮色/暗色。 */
  color?: string;
}

export type PropKind =
  | 'plant'
  | 'cooler'
  | 'ceilingLight'
  | 'window'
  | 'tv'
  | 'table'
  | 'coffee'
  | 'fridge'
  | 'sofa'
  | 'sink'
  | 'bar'
  | 'cabinet'
  | 'printer'
  | 'bin'
  | 'shelf'
  | 'whiteboard'
  | 'locker'
  | 'wet'
  | 'pit'
  | 'crate'
  | 'launch'
  | 'alarm';

export const HAZARD_KINDS = ['wet', 'pit', 'crate', 'launch', 'alarm'] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

export function isHazardKind(kind: string): kind is HazardKind {
  return (HAZARD_KINDS as readonly string[]).includes(kind);
}

/** 游戏里碰到这件东西会怎样 */
export type MoveHint = 'push' | 'block' | 'decor' | 'meta' | 'hazard';

export interface PropSpec {
  id: PropKind;
  label: string;
  /** 本地半宽；没有则穿行。push 也用它做动态碰撞盒。 */
  block?: { hx: number; hz: number; h: number };
  /** 可冲倒时的质量（kg 量级）。 */
  mass?: number;
  move: MoveHint;
  rotatable: boolean;
}

export const PROP_SPECS: PropSpec[] = [
  { id: 'plant', label: '绿植', block: { hx: 0.18, hz: 0.18, h: 0.72 }, mass: 8, move: 'push', rotatable: true },
  { id: 'cooler', label: '饮水机', block: { hx: 0.22, hz: 0.22, h: 1.1 }, move: 'block', rotatable: true },
  { id: 'coffee', label: '咖啡机', block: { hx: 0.2, hz: 0.18, h: 0.62 }, mass: 12, move: 'push', rotatable: true },
  { id: 'fridge', label: '冰箱', block: { hx: 0.32, hz: 0.3, h: 1.55 }, move: 'block', rotatable: true },
  { id: 'sofa', label: '懒人沙发', block: { hx: 0.6, hz: 0.5, h: 0.55 }, move: 'block', rotatable: true },
  { id: 'sink', label: '洗手台', block: { hx: 0.62, hz: 0.28, h: 0.9 }, move: 'block', rotatable: true },
  { id: 'bar', label: '咖啡吧台', block: { hx: 0.85, hz: 0.32, h: 1.05 }, move: 'block', rotatable: true },
  { id: 'cabinet', label: '文件柜', block: { hx: 0.24, hz: 0.22, h: 1.25 }, move: 'block', rotatable: true },
  { id: 'printer', label: '打印机', block: { hx: 0.26, hz: 0.22, h: 0.82 }, mass: 16, move: 'push', rotatable: true },
  { id: 'bin', label: '垃圾桶', block: { hx: 0.16, hz: 0.16, h: 0.45 }, mass: 5, move: 'push', rotatable: true },
  { id: 'shelf', label: '置物架', block: { hx: 0.48, hz: 0.16, h: 1.4 }, move: 'block', rotatable: true },
  { id: 'whiteboard', label: '白板', block: { hx: 0.85, hz: 0.08, h: 1.2 }, move: 'block', rotatable: true },
  { id: 'locker', label: '储物柜', block: { hx: 0.22, hz: 0.24, h: 1.6 }, move: 'block', rotatable: true },
  { id: 'table', label: '会议桌', block: { hx: 1.18, hz: 0.62, h: 0.76 }, move: 'block', rotatable: true },
  { id: 'window', label: '侧窗', move: 'decor', rotatable: false },
  { id: 'tv', label: '挂壁电视', move: 'decor', rotatable: false },
  { id: 'wet', label: '拖地未干', move: 'hazard', rotatable: true },
  { id: 'pit', label: '报纸', move: 'hazard', rotatable: true },
  { id: 'crate', label: '文件箱', block: { hx: 0.22, hz: 0.18, h: 0.34 }, move: 'hazard', rotatable: true },
  { id: 'launch', label: '弹簧门', move: 'hazard', rotatable: false },
  { id: 'alarm', label: '隐藏地板', move: 'hazard', rotatable: true },
];

export function isPushProp(kind: string) {
  return propSpec(kind)?.move === 'push';
}

export function isWallMount(kind: string) {
  return kind === 'window' || kind === 'tv' || kind === 'launch';
}

/** 侧窗 / 电视 / 弹簧门 / 电梯：点墙放置，朝向跟着墙。 */
export function isWallSnap(kind: string) {
  return isWallMount(kind) || kind === 'elevator';
}

/** 侧窗 / 挂壁电视可贴的墙：外墙（含镂空轮廓）+ 内墙/柱，不含木台。 */
export function mountSolids(map: MapBounds, walls: SolidDef[], voids?: MapVoid[]) {
  return [...perimeterSolids(map, voids), ...walls.filter((w) => w.kind !== 'wood')];
}

/** 弹簧门只贴实墙，不贴柱和木台。 */
export function mountSolidsFor(kind: string, map: MapBounds, walls: SolidDef[], voids?: MapVoid[]) {
  if (kind === 'launch') return [...perimeterSolids(map, voids), ...walls.filter((w) => w.kind === 'wall')];
  return mountSolids(map, walls, voids);
}

export function mountSnapOpts(kind: string) {
  if (kind === 'window') return { pad: 1.15, inset: 0.04 };
  if (kind === 'launch') return { pad: 0.58, inset: 0.02 };
  if (kind === 'elevator') return { pad: 1.35, inset: 0.06 };
  return { pad: 0.62, inset: 0.08 };
}

/** 一面可贴墙：中心在墙面上，tangent 沿墙，rotY 是物件朝屋里的偏航。 */
export interface MountSeg {
  x: number;
  z: number;
  tx: number;
  tz: number;
  half: number;
  rotY: number;
}

const MOUNT_MIN_HALF = 0.28;

function pushMountFace(
  out: MountSeg[],
  cx: number,
  cz: number,
  tx: number,
  tz: number,
  half: number,
  rotY: number,
  map: MapBounds,
  voids?: MapVoid[]
) {
  if (half < MOUNT_MIN_HALF) return;
  const fx = Math.sin(rotY);
  const fz = Math.cos(rotY);
  if (!isPlayableXZ(cx + fx * 0.18, cz + fz * 0.18, map, voids)) return;
  out.push({ x: cx, z: cz, tx, tz, half, rotY });
}

function aabbMountSegs(
  solids: { minX: number; maxX: number; minZ: number; maxZ: number }[],
  map: MapBounds,
  voids?: MapVoid[]
): MountSeg[] {
  const out: MountSeg[] = [];
  for (const s of solids) {
    const hx = (s.maxX - s.minX) / 2;
    const hz = (s.maxZ - s.minZ) / 2;
    const mx = (s.minX + s.maxX) / 2;
    const mz = (s.minZ + s.maxZ) / 2;
    pushMountFace(out, mx, s.maxZ, 1, 0, hx, 0, map, voids);
    pushMountFace(out, mx, s.minZ, 1, 0, hx, Math.PI, map, voids);
    pushMountFace(out, s.maxX, mz, 0, 1, hz, Math.PI / 2, map, voids);
    pushMountFace(out, s.minX, mz, 0, 1, hz, -Math.PI / 2, map, voids);
  }
  return out;
}

function orientedMountSegs(map: MapBounds, voids?: MapVoid[]): MountSeg[] {
  const out: MountSeg[] = [];
  for (const w of shapedVoidWalls(map, voids)) {
    const alongX = Math.sin(w.rotY);
    const alongZ = Math.cos(w.rotY);
    const lx = Math.cos(w.rotY);
    const lz = -Math.sin(w.rotY);
    const half = w.len / 2;
    for (const sign of [1, -1] as const) {
      const fx = lx * sign;
      const fz = lz * sign;
      const cx = w.x + fx * (w.thick / 2);
      const cz = w.z + fz * (w.thick / 2);
      pushMountFace(out, cx, cz, alongX, alongZ, half, Math.atan2(fx, fz), map, voids);
    }
  }
  return out;
}

/** 可贴的墙段。弹簧门只走轴对齐墙（要挖门洞）；电梯/窗/电视含三角、圆切口斜墙。 */
export function mountSegsFor(kind: string, map: MapBounds, walls: SolidDef[], voids?: MapVoid[]): MountSeg[] {
  const solids = kind === 'elevator' || kind === 'launch'
    ? mountSolidsFor('launch', map, walls, voids)
    : mountSolidsFor(kind, map, walls, voids);
  const segs = aabbMountSegs(solids, map, voids);
  if (kind === 'launch') return segs;
  return [...segs, ...orientedMountSegs(map, voids)];
}

/**
 * 点在哪面墙附近，就把物件贴到那一面，朝向房间。
 * pad 是沿墙留白，避免电视/窗/电梯探出墙头。
 */
export function snapMountToWall(
  x: number,
  z: number,
  segs: MountSeg[],
  inset = 0.05,
  pad = 0.45
): { x: number; z: number; rotY: number } {
  let bestX = x;
  let bestZ = z;
  let bestYaw = 0;
  let best = Infinity;
  for (const s of segs) {
    const facePad = Math.min(pad, Math.max(0.02, s.half * 0.85));
    const along = (x - s.x) * s.tx + (z - s.z) * s.tz;
    const span = Math.max(0, s.half - facePad);
    const t = Math.max(-span, Math.min(span, along));
    const fx = s.x + s.tx * t;
    const fz = s.z + s.tz * t;
    const facingX = Math.sin(s.rotY);
    const facingZ = Math.cos(s.rotY);
    const dx = x - fx;
    const dz = z - fz;
    const behind = dx * facingX + dz * facingZ < -0.05 ? 0.4 : 0;
    const score = Math.hypot(dx, dz) + behind;
    if (score >= best) continue;
    best = score;
    bestX = fx + facingX * inset;
    bestZ = fz + facingZ * inset;
    bestYaw = s.rotY;
  }
  return { x: bestX, z: bestZ, rotY: bestYaw };
}

/** 电梯触发垫：局部 X 半宽、门口近沿、门口远沿。 */
export const ELEVATOR_PAD_ALONG = 1.5;
export const ELEVATOR_PAD_NEAR = 0.12;
export const ELEVATOR_PAD_FAR = 1.65;

function elevatorYawFromMap(map: MapBounds, zone: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  const cx = (zone.minX + zone.maxX) / 2;
  const cz = (zone.minZ + zone.maxZ) / 2;
  const edges = [
    { yaw: 0, dist: cz - map.minZ, x: cx, z: map.minZ + 0.42 },
    { yaw: Math.PI, dist: map.maxZ - cz, x: cx, z: map.maxZ - 0.42 },
    { yaw: Math.PI / 2, dist: cx - map.minX, x: map.minX + 0.42, z: cz },
    { yaw: -Math.PI / 2, dist: map.maxX - cx, x: map.maxX - 0.42, z: cz },
  ];
  edges.sort((a, b) => a.dist - b.dist);
  return edges[0]!;
}

export function elevatorTriggerBox(x: number, z: number, rotY: number) {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [lx, lz] of [
    [-ELEVATOR_PAD_ALONG, ELEVATOR_PAD_NEAR],
    [ELEVATOR_PAD_ALONG, ELEVATOR_PAD_NEAR],
    [-ELEVATOR_PAD_ALONG, ELEVATOR_PAD_FAR],
    [ELEVATOR_PAD_ALONG, ELEVATOR_PAD_FAR],
  ] as const) {
    const wx = x + lx * c + lz * s;
    const wz = z - lx * s + lz * c;
    minX = Math.min(minX, wx);
    maxX = Math.max(maxX, wx);
    minZ = Math.min(minZ, wz);
    maxZ = Math.max(maxZ, wz);
  }
  return { minX, maxX, minZ, maxZ };
}

export function applyElevatorMount(
  elev: ElevatorDef,
  x: number,
  z: number,
  segs: MountSeg[],
  inset: number,
  pad: number
) {
  const m = snapMountToWall(x, z, segs, inset, pad);
  const box = elevatorTriggerBox(m.x, m.z, m.rotY);
  elev.point = { x: m.x, z: m.z };
  elev.rotY = m.rotY;
  elev.minX = box.minX;
  elev.maxX = box.maxX;
  elev.minZ = box.minZ;
  elev.maxZ = box.maxZ;
}

export function snapElevator(def: {
  map: MapBounds;
  walls: SolidDef[];
  voids?: MapVoid[];
  elevator: ElevatorDef;
}) {
  const segs = mountSegsFor('elevator', def.map, def.walls, def.voids);
  const { pad, inset } = mountSnapOpts('elevator');
  const e = def.elevator;
  if (typeof e.rotY === 'number' && Number.isFinite(e.rotY)) {
    applyElevatorMount(e, e.point.x, e.point.z, segs, inset, pad);
    return;
  }
  const pose = elevatorYawFromMap(def.map, e);
  applyElevatorMount(e, pose.x, pose.z, segs, inset, pad);
}

export function pointInElevatorPad(px: number, pz: number, elev: ElevatorDef) {
  const yaw = elev.rotY;
  if (typeof yaw !== 'number' || !Number.isFinite(yaw)) {
    return px >= elev.minX && px <= elev.maxX && pz >= elev.minZ && pz <= elev.maxZ;
  }
  const dx = px - elev.point.x;
  const dz = pz - elev.point.z;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return lx >= -ELEVATOR_PAD_ALONG && lx <= ELEVATOR_PAD_ALONG && lz >= ELEVATOR_PAD_NEAR && lz <= ELEVATOR_PAD_FAR;
}

export function elevatorPoseOf(e: ElevatorDef) {
  return { x: e.point.x, z: e.point.z, rotY: e.rotY ?? 0 };
}

/** 弹簧门洞：宽、高。墙体按这个矩形做布尔挖空。 */
export const LAUNCH_OPEN_W = 0.96;
export const LAUNCH_OPEN_H = 1.56;

export interface WallPiece {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y0: number;
  y1: number;
  /** 计入挡路/流场。过梁不算，人可以从门洞走过。 */
  block: boolean;
}

function mergeSpans(spans: { a: number; b: number }[]) {
  const sorted = spans
    .map((s) => ({ a: Math.min(s.a, s.b), b: Math.max(s.a, s.b) }))
    .sort((u, v) => u.a - v.a);
  const out: { a: number; b: number }[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (!last || s.a > last.b + 0.02) out.push({ ...s });
    else last.b = Math.max(last.b, s.b);
  }
  return out;
}

function remainSpans(lo: number, hi: number, holes: { a: number; b: number }[]) {
  const pieces: { a: number; b: number }[] = [];
  let cursor = lo;
  for (const h of holes) {
    const a = Math.max(lo, h.a);
    const b = Math.min(hi, h.b);
    if (b - a < 0.08) continue;
    if (a - cursor > 0.04) pieces.push({ a: cursor, b: a });
    cursor = Math.max(cursor, b);
  }
  if (hi - cursor > 0.04) pieces.push({ a: cursor, b: hi });
  return pieces;
}

/** 这扇弹簧门是否贴在这面墙上；是则返回沿墙长边的挖空区间。 */
export function launchHoleOnSolid(
  p: { x: number; z: number; rotY?: number },
  s: SolidDef
): { along: 'x' | 'z'; a0: number; a1: number } | null {
  if (s.kind !== 'wall') return null;
  const yaw = wrapYaw(p.rotY ?? 0);
  const facesZ = s.maxZ - s.minZ <= s.maxX - s.minX + 0.001;
  const hw = LAUNCH_OPEN_W / 2;
  const near = 0.42;
  if (facesZ) {
    const onPos = Math.abs(yaw) < 0.55 && p.z >= s.maxZ - 0.12 && p.z <= s.maxZ + near && p.x >= s.minX && p.x <= s.maxX;
    const onNeg = Math.abs(wrapYaw(yaw - Math.PI)) < 0.55 && p.z <= s.minZ + 0.12 && p.z >= s.minZ - near && p.x >= s.minX && p.x <= s.maxX;
    if (!onPos && !onNeg) return null;
    return { along: 'x', a0: p.x - hw, a1: p.x + hw };
  }
  const onPos = Math.abs(wrapYaw(yaw - Math.PI / 2)) < 0.55 && p.x >= s.maxX - 0.12 && p.x <= s.maxX + near && p.z >= s.minZ && p.z <= s.maxZ;
  const onNeg = Math.abs(wrapYaw(yaw + Math.PI / 2)) < 0.55 && p.x <= s.minX + 0.12 && p.x >= s.minX - near && p.z >= s.minZ && p.z <= s.maxZ;
  if (!onPos && !onNeg) return null;
  return { along: 'z', a0: p.z - hw, a1: p.z + hw };
}

/** 墙体减去贴在上面的弹簧门洞：左右墙垛挡路，过梁只出网格。 */
export function punchWallForDoors(
  s: SolidDef,
  props: { kind: string; x: number; z: number; rotY?: number }[]
): WallPiece[] {
  const full: WallPiece = { minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ, y0: 0, y1: s.h, block: true };
  if (s.kind !== 'wall') return [full];
  const holes = [];
  for (const p of props) {
    if (p.kind !== 'launch') continue;
    const h = launchHoleOnSolid(p, s);
    if (h) holes.push(h);
  }
  if (!holes.length) return [full];
  const along = holes[0]!.along;
  const merged = mergeSpans(holes.filter((h) => h.along === along).map((h) => ({ a: h.a0, b: h.a1 })));
  const lo = along === 'x' ? s.minX : s.minZ;
  const hi = along === 'x' ? s.maxX : s.maxZ;
  const sides = remainSpans(lo, hi, merged);
  const openH = Math.min(LAUNCH_OPEN_H, Math.max(0.8, s.h - 0.12));
  const pieces: WallPiece[] = [];
  const slab = (a: number, b: number, y0: number, y1: number, block: boolean): WallPiece =>
    along === 'x'
      ? { minX: a, maxX: b, minZ: s.minZ, maxZ: s.maxZ, y0, y1, block }
      : { minX: s.minX, maxX: s.maxX, minZ: a, maxZ: b, y0, y1, block };
  for (const side of sides) pieces.push(slab(side.a, side.b, 0, s.h, true));
  if (s.h - openH > 0.05) {
    for (const h of merged) {
      const a = Math.max(lo, h.a);
      const b = Math.min(hi, h.b);
      if (b - a > 0.08) pieces.push(slab(a, b, openH, s.h, false));
    }
  }
  return pieces.length ? pieces : [full];
}

export function snapLaunchDoors(def: { map: MapBounds; walls: SolidDef[]; voids?: MapVoid[]; props: { kind: string; x: number; z: number; rotY?: number }[] }) {
  const segs = mountSegsFor('launch', def.map, def.walls, def.voids);
  const { pad, inset } = mountSnapOpts('launch');
  for (const p of def.props) {
    if (p.kind !== 'launch') continue;
    const m = snapMountToWall(p.x, p.z, segs, inset, pad);
    p.x = m.x;
    p.z = m.z;
    p.rotY = m.rotY;
  }
}

export const MOVE_HINT: Record<MoveHint, string> = {
  push: '游戏里可推动，能撞人',
  block: '固定，挡路，推不动',
  decor: '仅装饰，可以穿过去',
  meta: '标记点，不是家具',
  hazard: '陷阱：正式开玩才生效，主页不触发',
};

export function propSpec(kind: string): PropSpec | undefined {
  return PROP_SPECS.find((s) => s.id === kind);
}

export function wrapYaw(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function faceYaw(face?: DeskFace): number {
  if (face === 'nz') return Math.PI;
  if (face === 'px') return -Math.PI / 2;
  if (face === 'nx') return Math.PI / 2;
  return 0;
}

export function yawToFace(yaw: number): DeskFace {
  const a = wrapYaw(yaw);
  const opts: [DeskFace, number][] = [
    ['pz', 0],
    ['px', -Math.PI / 2],
    ['nz', Math.PI],
    ['nx', Math.PI / 2],
  ];
  let best: DeskFace = 'pz';
  let bestD = 99;
  for (const [f, y] of opts) {
    const d = Math.abs(wrapYaw(a - y));
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

export function deskYaw(desk: DeskDef): number {
  return typeof desk.rotY === 'number' && Number.isFinite(desk.rotY) ? desk.rotY : faceYaw(desk.face);
}

/** 工位桌转过之后的挡路盒。min/max 是未转时拖出的矩形。 */
export function deskBox(desk: DeskDef) {
  const cx = (desk.minX + desk.maxX) / 2;
  const cz = (desk.minZ + desk.maxZ) / 2;
  return yawedAabb(cx, cz, (desk.maxX - desk.minX) / 2, (desk.maxZ - desk.minZ) / 2, deskYaw(desk));
}

/** 旋转后的轴对齐包围盒，给挡路用。 */
export function yawedAabb(x: number, z: number, hx: number, hz: number, yaw: number) {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const ax = hx * c + hz * s;
  const az = hx * s + hz * c;
  return { minX: x - ax, maxX: x + ax, minZ: z - az, maxZ: z + az };
}

/** 可互动道具：只改这一件的判定，没写的项跟特效目录默认值。 */
export interface HazardTune {
  radius?: number;
  duration?: number;
  factor?: number;
  impulse?: number;
  /** 竖直冲量：弹簧门摔倒时略抬，隐藏地板弹飞时抬得更高 */
  lift?: number;
}

export interface PropDef {
  id: string;
  kind: PropKind;
  x: number;
  z: number;
  y?: number;
  rotY?: number;
  w?: number;
  h?: number;
  tone?: FurnitureTone;
  /** 这一件的自定义主色。有值时盖过亮色/暗色。 */
  color?: string;
  /** 仅绿植：一盆到树丛 */
  plantKit?: PlantKit;
  /** 仅陷阱：这一件的减速 / 弹开 / 半径 */
  hazard?: HazardTune;
}

export interface SpawnDef extends Xz {
  id: string;
  style?: ChairStyle;
  rotY?: number;
  tone?: FurnitureTone;
  color?: string;
}

/** 手机预算：动态点光上限。再多 Phong 逐灯计算会掉帧。 */
export const MAX_POINT_LIGHTS = 6;
export const MAX_LIGHT_INTENSITY = 80;
export const MAX_LIGHT_DISTANCE = 20;
export const MIN_LIGHT_DISTANCE = 2;
export const MAX_AMBIENT = 0.85;
export const MAX_HEMISPHERE = 1.2;

/** 看不见的点光：只记位置和衰减，不建灯具。 */
export interface PointLightDef {
  id: string;
  x: number;
  z: number;
  y: number;
  intensity: number;
  /** 照亮半径，越小亮暗对比越强 */
  distance: number;
  color: string;
}

export interface LightChan {
  color: string;
  intensity: number;
}

export interface DirLightChan extends LightChan {
  position: [number, number, number];
}

export type FloorKind = 'carpet' | 'wood' | 'tile' | 'image';
export type SkyKind = 'day' | 'dusk' | 'night';

export const SKY_KINDS: { id: SkyKind; label: string }[] = [
  { id: 'day', label: '白光' },
  { id: 'dusk', label: '晚霞' },
  { id: 'night', label: '夜晚' },
];

/** 改窗外天气：玻璃自发光、雾/环境光色、地光冷暖。不改强度。 */
export function applySky(atmo: Atmosphere, kind: SkyKind) {
  atmo.sky = kind;
  if (kind === 'day') {
    atmo.background = '#3d4a58';
    atmo.fogColor = '#3d4a58';
    atmo.ambient.color = '#d8e6f4';
    atmo.hemisphere.sky = '#e8f2ff';
    atmo.hemisphere.ground = '#9a8a78';
  } else if (kind === 'dusk') {
    atmo.background = '#4a2818';
    atmo.fogColor = '#4a2818';
    atmo.ambient.color = '#ffb070';
    atmo.hemisphere.sky = '#ffb070';
    atmo.hemisphere.ground = '#6a3a28';
  } else {
    atmo.background = '#0c1018';
    atmo.fogColor = '#0c1018';
    atmo.ambient.color = '#8aa0c8';
    atmo.hemisphere.sky = '#6a88b0';
    atmo.hemisphere.ground = '#1a2230';
  }
}

export interface SurfaceLook {
  color: string;
  shininess: number;
  bumpScale?: number;
  /** 相对站点根路径，如 /levels/textures/monday-floor.png */
  map?: string | null;
  kind?: FloorKind;
  /** 自定义/木纹/地砖的 UV 重复 */
  repeat?: number;
}

export interface Atmosphere {
  background: string;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  exposure: number;
  /** 环境光：整屋均匀垫一层，暗处能看清轮廓。拧太大点光斑会变平。 */
  ambient: LightChan;
  /** 地光：头顶天空色、脚下地面反弹色。比环境光更能保住体积。 */
  hemisphere: { sky: string; ground: string; intensity: number };
  sun: DirLightChan & { castShadow: boolean };
  fill: DirLightChan;
  /** 新放点光的默认色 / 强度 / 高度 / 半径。真正照亮靠 LevelDef.pointLights。 */
  lampColor: string;
  lampIntensity: number;
  overheadHeight: number;
  lampDistance: number;
  /** 旧字段，均匀铺光已去掉，保留以免旧 catalog 读失败 */
  overheadSpacing: number;
  /** 旧字段：追光+阴影已砍，加载时强制关掉 */
  followEnabled: boolean;
  followColor: string;
  followIntensity: number;
  followHeight: number;
  floor: SurfaceLook;
  wall: SurfaceLook;
  elevatorGlow: string;
  /** 窗外天气：侧窗发光 + 朝屋里打光 */
  sky: SkyKind;
  /** 未单独指定 tone 的家具/椅/桌上用品用这套。 */
  furnitureTone: FurnitureTone;
}

export interface ElevatorDef {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  point: Xz;
  /** 轿厢朝屋里的偏航。没有则加载时按最近外墙补。 */
  rotY?: number;
}

export interface LevelDef {
  id: WeekdayId;
  label: string;
  map: MapBounds;
  playerStart: Xz;
  elevator: ElevatorDef;
  atmosphere: Atmosphere;
  walls: SolidDef[];
  desks: DeskDef[];
  props: PropDef[];
  pointLights: PointLightDef[];
  chairSpawns: SpawnDef[];
  enemySpawns: SpawnDef[];
  heavyAnchors: SpawnDef[];
  interceptorSpawns: SpawnDef[];
  /** 主页隐形追逐点。该关当背景时用；没有则出生点→电梯圈。每关自己写。 */
  menuChase?: Xz[];
  /** 从 map 矩形切掉的室外。没有则整张仍是矩形。 */
  voids?: MapVoid[];
  /** 外墙（bound-*）各面的颜色 / 贴图。外墙不进 walls 列表。 */
  boundFaces?: Record<string, FaceColors>;
}

export interface LevelCatalog {
  version: 1;
  active: WeekdayId;
  levels: LevelDef[];
}

export function weekdaySlot(id: string): WeekdaySlot | undefined {
  return WEEKDAYS.find((s) => s.id === id);
}

export function weekdayIndex(id: WeekdayId) {
  return WEEKDAYS.findIndex((s) => s.id === id);
}

export function nextWeekday(id: WeekdayId): WeekdayId | null {
  const i = weekdayIndex(id);
  if (i < 0 || i >= WEEKDAYS.length - 1) return null;
  return WEEKDAYS[i + 1].id;
}

export function hexToInt(hex: string): number {
  const s = hex.trim().replace('#', '');
  const n = Number.parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return Number.isFinite(n) ? n : 0xffffff;
}

export function clampLightParams(l: PointLightDef): PointLightDef {
  return {
    ...l,
    intensity: Math.min(MAX_LIGHT_INTENSITY, Math.max(8, l.intensity)),
    distance: Math.min(MAX_LIGHT_DISTANCE, Math.max(MIN_LIGHT_DISTANCE, l.distance)),
    y: Math.min(3.2, Math.max(1.4, l.y)),
  };
}

/** 超出预算时按强度优先、再尽量铺开，避免 6 盏全挤在同一角。 */
export function clampPointLights(lights: PointLightDef[]): PointLightDef[] {
  const capped = lights.map(clampLightParams);
  if (capped.length <= MAX_POINT_LIGHTS) return capped;
  const rest = [...capped].sort((a, b) => b.intensity - a.intensity);
  const picked: PointLightDef[] = [rest.shift()!];
  while (picked.length < MAX_POINT_LIGHTS && rest.length) {
    let bestI = 0;
    let bestD = -1;
    for (let i = 0; i < rest.length; i++) {
      const d = Math.min(...picked.map((p) => {
        const dx = p.x - rest[i].x;
        const dz = p.z - rest[i].z;
        return dx * dx + dz * dz;
      }));
      if (d > bestD) {
        bestD = d;
        bestI = i;
      }
    }
    picked.push(rest.splice(bestI, 1)[0]);
  }
  return picked;
}

export function cloneLevel(src: LevelDef, id: WeekdayId, label: string, atmosphere: Atmosphere): LevelDef {
  const copy = structuredClone(src);
  copy.id = id;
  copy.label = label;
  copy.atmosphere = structuredClone(atmosphere);
  return copy;
}

const MONDAY_MAP: MapBounds = { minX: -12, maxX: 12, minZ: -28, maxZ: 28 };

export function mondayAtmosphere(): Atmosphere {
  const atmo: Atmosphere = {
    background: '#3a322b',
    fogColor: '#3a322b',
    fogNear: 16,
    fogFar: 46,
    exposure: 1.0,
    ambient: { color: '#ffd4a8', intensity: 0.1 },
    hemisphere: { sky: '#e8f2ff', ground: '#9a8a78', intensity: 0.38 },
    sun: { color: '#fff2dc', intensity: 0, position: [11, 26, 8], castShadow: false },
    fill: { color: '#b8d4f0', intensity: 0, position: [-12, 12, -8] },
    lampColor: '#fff1b8',
    lampIntensity: 56,
    overheadHeight: 2.3,
    lampDistance: 4.5,
    overheadSpacing: 8,
    followEnabled: false,
    followColor: '#fff2dc',
    followIntensity: 1.2,
    followHeight: 7.2,
    floor: { color: '#c4b8a8', shininess: 22, bumpScale: 1.2, map: null, kind: 'carpet', repeat: 8 },
    wall: { color: '#d8d0c4', shininess: 8, map: null },
    elevatorGlow: '#7ef0a0',
    sky: 'day',
    furnitureTone: 'dark',
  };
  applySky(atmo, 'day');
  return atmo;
}

export function atmospherePreset(id: WeekdayId): Atmosphere {
  if (id === 'tuesday') {
    const a = mondayAtmosphere();
    applySky(a, 'day');
    a.lampColor = '#e8f2ff';
    return a;
  }
  if (id === 'wednesday') {
    const a = mondayAtmosphere();
    applySky(a, 'dusk');
    a.lampColor = '#ffd089';
    a.lampIntensity = 70;
    return a;
  }
  if (id === 'thursday') {
    const a = mondayAtmosphere();
    applySky(a, 'night');
    a.fogNear = 12;
    a.fogFar = 38;
    a.lampColor = '#dce8f2';
    return a;
  }
  if (id === 'friday') {
    const a = mondayAtmosphere();
    applySky(a, 'dusk');
    a.lampColor = '#ffe7c4';
    a.lampIntensity = 68;
    return a;
  }
  return mondayAtmosphere();
}

function wall(id: string, minX: number, minZ: number, maxX: number, maxZ: number, h = 1.7, kind: SolidKind = 'wall'): SolidDef {
  return { id, kind, minX, minZ, maxX, maxZ, h };
}

function normalizeSolid(s: SolidDef): SolidDef {
  const color = migrateHexColor(s.color);
  const faces = normalizeFaceColors(s.faces);
  return { ...s, color, faces };
}

function normalizeBoundFaces(raw?: Record<string, FaceColors>): Record<string, FaceColors> | undefined {
  if (!raw) return undefined;
  const out: Record<string, FaceColors> = {};
  let n = 0;
  for (const [id, faces] of Object.entries(raw)) {
    const next = normalizeFaceColors(faces);
    if (next) {
      out[id] = next;
      n++;
    }
  }
  return n ? out : undefined;
}

function desk(id: string, minX: number, minZ: number, maxX: number, maxZ: number, extra: Partial<DeskDef> = {}): DeskDef {
  return { id, minX, minZ, maxX, maxZ, top: 'oak', kit: 'simple', face: 'pz', ...extra };
}

const TOPS: DeskTop[] = ['oak', 'walnut', 'dark', 'white', 'steel', 'bench'];
const KITS: DeskKit[] = ['simple', 'dual', 'clutter', 'packed'];
const CHAIRS: ChairStyle[] = ['task', 'mesh', 'guest', 'stool', 'exec'];

function migrateKit(kit?: string): DeskKit {
  if (kit === 'dual') return 'dual';
  if (kit === 'clutter' || kit === 'laptop') return 'clutter';
  if (kit === 'packed' || kit === 'messy') return 'packed';
  if (kit === 'simple' || kit === 'monitor' || kit === 'empty') return 'simple';
  return KITS[0];
}

function migrateTop(top?: string): DeskTop {
  if (top === 'walnut' || top === 'dark' || top === 'white' || top === 'steel' || top === 'bench' || top === 'oak') return top;
  return 'oak';
}

function migrateChair(style?: string): ChairStyle {
  if (style === 'mesh' || style === 'guest' || style === 'stool' || style === 'exec' || style === 'task') return style;
  return 'task';
}

function migrateFace(face: unknown): DeskFace {
  if (face === -1 || face === '-1' || face === 'nz') return 'nz';
  if (face === 'px') return 'px';
  if (face === 'nx') return 'nx';
  return 'pz';
}

function normalizeDesk(d: DeskDef, i: number): DeskDef {
  return {
    ...d,
    top: d.top ? migrateTop(d.top) : TOPS[i % TOPS.length],
    kit: d.kit ? migrateKit(d.kit) : KITS[i % KITS.length],
    face: migrateFace(d.face),
    tone: migrateTone(d.tone),
    color: migrateHexColor(d.color),
  };
}

function spawn(id: string, x: number, z: number, style?: ChairStyle): SpawnDef {
  return { id, x, z, style };
}

function normalizeChair(s: SpawnDef, i: number): SpawnDef {
  return {
    ...s,
    style: s.style ? migrateChair(s.style) : CHAIRS[i % CHAIRS.length],
    tone: migrateTone(s.tone),
    color: migrateHexColor(s.color),
  };
}

function clampTune(n: unknown, min: number, max: number): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

export function normalizeHazardTune(h?: HazardTune): HazardTune | undefined {
  if (!h || typeof h !== 'object') return undefined;
  const out: HazardTune = {};
  const radius = clampTune(h.radius, 0.25, 2.4);
  const duration = clampTune(h.duration, 0.2, 8);
  const factor = clampTune(h.factor, 0.15, 0.95);
  const impulse = clampTune(h.impulse, 80, 1200);
  const lift = clampTune(h.lift, 4, 220);
  if (radius !== undefined) out.radius = radius;
  if (duration !== undefined) out.duration = duration;
  if (factor !== undefined) out.factor = factor;
  if (impulse !== undefined) out.impulse = impulse;
  if (lift !== undefined) out.lift = lift;
  return Object.keys(out).length ? out : undefined;
}

function normalizeProp(p: PropDef): PropDef {
  return {
    ...p,
    tone: migrateTone(p.tone),
    color: migrateHexColor(p.color),
    plantKit: p.kind === 'plant' ? migratePlantKit(p.plantKit) : undefined,
    hazard: isHazardKind(p.kind) ? normalizeHazardTune(p.hazard) : undefined,
  };
}

function pool(id: string, x: number, z: number, extra: Partial<PointLightDef> = {}): PointLightDef {
  return clampLightParams({ id, x, z, y: 2.3, intensity: 56, distance: 4.5, color: '#fff1b8', ...extra });
}

function boostOldLight(l: PointLightDef): PointLightDef {
  if (l.intensity >= 12) return l;
  return {
    ...l,
    intensity: Math.max(64, l.intensity * 16),
    distance: Math.min(l.distance || 6, 5.4),
    y: l.y > 2.8 ? 2.3 : l.y,
  };
}

function prop(id: string, kind: PropKind, x: number, z: number, extra: Partial<PropDef> = {}): PropDef {
  return { id, kind, x, z, ...extra };
}

function officeWindows(map: MapBounds = MONDAY_MAP, voids?: MapVoid[]): PropDef[] {
  const windows: PropDef[] = [];
  let wi = 0;
  for (const e of outlineEdges(map, voids)) {
    if (e.axis !== 'x' || e.t1 - e.t0 < 3.2) continue;
    const mid = (e.t0 + e.t1) / 2;
    const zs = e.t1 - e.t0 > 14 ? [mid - (e.t1 - e.t0) * 0.28, mid + (e.t1 - e.t0) * 0.28] : [mid];
    for (const z of zs) {
      windows.push(
        prop(`win-${e.dir < 0 ? 'w' : 'e'}-${wi}`, 'window', e.at + (e.dir < 0 ? 0.02 : -0.02), z, {
          y: 1.15,
          rotY: e.dir < 0 ? Math.PI / 2 : -Math.PI / 2,
          w: 2.4,
          h: 1.05,
        })
      );
      wi++;
    }
  }
  return windows;
}

function cut(id: string, minX: number, minZ: number, maxX: number, maxZ: number): MapVoid {
  return { id, minX, minZ, maxX, maxZ };
}

function officeBase(
  id: WeekdayId,
  label: string,
  extra: Partial<Pick<LevelDef, 'map' | 'playerStart' | 'elevator' | 'pointLights' | 'voids'>> = {}
): Omit<LevelDef, 'walls' | 'desks' | 'props' | 'chairSpawns' | 'menuChase' | 'heavyAnchors' | 'interceptorSpawns'> {
  const map = extra.map ?? { ...MONDAY_MAP };
  return {
    id,
    label,
    map,
    playerStart: extra.playerStart ?? { x: 0, z: 25.5 },
    elevator: extra.elevator ?? { minX: -2, maxX: 2, minZ: map.minZ, maxZ: map.minZ + 2, point: { x: 0, z: map.minZ + 1 } },
    atmosphere: atmospherePreset(id),
    pointLights: extra.pointLights ?? [
      pool('pl-start', 0, 24.8, { intensity: 64, distance: 5.0 }),
      pool('pl-desks', 0, 19.2, { intensity: 70, distance: 5.5, color: '#ffe7a0' }),
      pool('pl-mid', 0, 6.5, { intensity: 52, distance: 5.0 }),
      pool('pl-meet', 0, -8.6, { intensity: 64, distance: 5.2, color: '#ffe0a8' }),
      pool('pl-hall', 0, -16.8, { intensity: 52, distance: 5.0, color: '#fff4d0' }),
      pool('pl-elev', 0, map.minZ + 4, { color: '#c8ffd8', intensity: 70, distance: 5.0, y: 2.5 }),
    ],
    voids: extra.voids ?? [],
    enemySpawns: [],
  };
}

/** 当前硬编码办公室，作为周一原型与其它天的默认布局。 */
export function seedMonday(): LevelDef {
  const windows: PropDef[] = [];
  let wi = 0;
  for (const z of [-20, -8, 4, 16]) {
    windows.push(prop(`win-w-${wi}`, 'window', MONDAY_MAP.minX + 0.02, z, { y: 1.15, rotY: Math.PI / 2, w: 2.4, h: 1.05 }));
    windows.push(prop(`win-e-${wi}`, 'window', MONDAY_MAP.maxX - 0.02, z, { y: 1.15, rotY: -Math.PI / 2, w: 2.4, h: 1.05 }));
    wi++;
  }

  return {
    id: 'monday',
    label: '周一',
    map: { ...MONDAY_MAP },
    playerStart: { x: 0, z: 25.5 },
    elevator: { minX: -2, maxX: 2, minZ: -28, maxZ: -26, point: { x: 0, z: -27 } },
    atmosphere: mondayAtmosphere(),
    walls: [
      wall('maze-1', -7, 11.6, 5, 12.1),
      wall('maze-2', -7, 8.1, -6.5, 11.6),
      wall('maze-3', -9.5, 7.6, -3, 8.1),
      wall('maze-4', 0, 7.6, 9, 8.1),
      wall('maze-5', -9, 3.6, 1, 4.1),
      wall('maze-6', 4.5, 3.6, 12, 4.1),
      wall('meet-1', -12, -4.4, -8.5, -3.9),
      wall('meet-2', -6.5, -4.4, -1, -3.9),
      wall('meet-3', 1, -4.4, 8.5, -3.9),
      wall('hall-desk', -3, -15.8, 3, -14.6, 1.0, 'wood'),
      wall('pillar-1', -6.9, -18.4, -6.1, -17.6, 1.7, 'pillar'),
      wall('pillar-2', 6.1, -18.4, 6.9, -17.6, 1.7, 'pillar'),
      wall('pillar-3', -6.9, -24.4, -6.1, -23.6, 1.7, 'pillar'),
      wall('pillar-4', 6.1, -24.4, 6.9, -23.6, 1.7, 'pillar'),
    ],
    desks: [
      desk('d1', -11, 20.8, -6.5, 22.4, { top: 'oak', kit: 'clutter' }),
      desk('d2', -4, 20.8, 0.5, 22.4, { top: 'walnut', kit: 'dual' }),
      desk('d3', 3, 20.8, 7.5, 22.4, { top: 'white', kit: 'packed' }),
      desk('d4', -9, 16.2, -4.5, 17.8, { top: 'steel', kit: 'simple' }),
      desk('d5', -2, 16.2, 2.5, 17.8, { top: 'bench', kit: 'packed' }),
      desk('d6', 5, 16.2, 9.5, 17.8, { top: 'dark', kit: 'packed' }),
      desk('d7', -7, -9.6, -2, -7.6, { top: 'white', kit: 'clutter' }),
      desk('d8', 2, -9.6, 7, -7.6, { top: 'walnut', kit: 'packed' }),
    ],
    props: [
      prop('plant-1', 'plant', -10.8, 25.5, { plantKit: 'grove' }),
      prop('plant-2', 'plant', 10.8, 25.5, { plantKit: 'cluster' }),
      prop('plant-3', 'plant', -10.6, -25.5, { plantKit: 'trio' }),
      prop('plant-4', 'plant', 10.6, -25.5, { plantKit: 'pair' }),
      prop('plant-5', 'plant', -10.8, -6.5, { plantKit: 'pot' }),
      prop('cooler-1', 'cooler', 10.6, 13.5),
      prop('cooler-2', 'cooler', -10.6, -12.2),
      ...windows,
    ],
    pointLights: [
      pool('pl-start', 0, 24.8, { intensity: 64, distance: 5.0 }),
      pool('pl-desks', 0, 19.2, { intensity: 70, distance: 5.5, color: '#ffe7a0' }),
      pool('pl-maze', 0, 6.5, { intensity: 52, distance: 5.0 }),
      pool('pl-meet', 0, -8.6, { intensity: 64, distance: 5.2, color: '#ffe0a8' }),
      pool('pl-hall', 0, -16.8, { intensity: 52, distance: 5.0, color: '#fff4d0' }),
      pool('pl-elev', 0, -24.2, { color: '#c8ffd8', intensity: 70, distance: 5.0, y: 2.5 }),
    ],
    chairSpawns: [
      spawn('ch1', -5.2, 19.5, 'task'), spawn('ch2', 1.5, 19.5, 'mesh'), spawn('ch3', 8, 19.3, 'exec'),
      spawn('ch4', -3, 15, 'guest'), spawn('ch5', 4, 15.2, 'task'), spawn('ch6', -10, 14.5, 'stool'),
      spawn('ch7', -4.5, -6.5, 'mesh'), spawn('ch8', 4.5, -6.5, 'guest'), spawn('ch9', 0, -10.8, 'exec'),
      spawn('ch10', 5, -16.5, 'stool'), spawn('ch11', -5, -19, 'task'),
    ],
    enemySpawns: [],
    heavyAnchors: [],
    interceptorSpawns: [],
    // 沿真实走廊绕一圈：东过道 → maze 缺口 → 电梯厅 → 西过道。勿穿墙。
    menuChase: [
      { x: 1.4, z: 24.0 },
      { x: 8.6, z: 23.6 },
      { x: 10.2, z: 18.8 },
      { x: 10.0, z: 13.2 },
      { x: 10.2, z: 9.0 },
      { x: 10.2, z: 6.2 },
      { x: 3.1, z: 5.6 },
      { x: 2.9, z: 1.8 },
      { x: 0.2, z: -2.0 },
      { x: 0.2, z: -6.4 },
      { x: 0.2, z: -11.6 },
      { x: 5.2, z: -13.4 },
      { x: 4.8, z: -18.6 },
      { x: 0.0, z: -22.2 },
      { x: -4.8, z: -18.6 },
      { x: -5.2, z: -13.0 },
      { x: -7.4, z: -6.6 },
      { x: -7.4, z: -1.8 },
      { x: -10.4, z: 0.6 },
      { x: -10.5, z: 6.4 },
      { x: -10.5, z: 10.4 },
      { x: -10.3, z: 14.4 },
      { x: -10.3, z: 18.6 },
      { x: -4.8, z: 19.0 },
      { x: 0.2, z: 19.4 },
      { x: 0.4, z: 23.6 },
    ],
  };
}

export function seedTuesday(): LevelDef {
  const slot = weekdaySlot('tuesday')!;
  const map: MapBounds = { minX: -12, maxX: 16, minZ: -28, maxZ: 28 };
  const voids = [cut('cut-se', 4, 4, 16, 28)];
  return {
    ...officeBase('tuesday', slot.label, {
      map,
      voids,
      playerStart: { x: -2, z: 26.4 },
      elevator: { minX: -2, maxX: 2, minZ: -28, maxZ: -26, point: { x: 0, z: -27 } },
      pointLights: [
        pool('pl-start', -2, 23.8, { intensity: 64, distance: 5.0 }),
        pool('pl-desks', -2, 16.5, { intensity: 70, distance: 5.5, color: '#ffe7a0' }),
        pool('pl-elbow', 2.2, 2.4, { intensity: 56, distance: 5.0 }),
        pool('pl-wing', 10.2, -8.4, { intensity: 60, distance: 5.2, color: '#ffe0a8' }),
        pool('pl-hall', 0, -16.8, { intensity: 52, distance: 5.0, color: '#fff4d0' }),
        pool('pl-elev', 0, -24.2, { color: '#c8ffd8', intensity: 70, distance: 5.0, y: 2.5 }),
      ],
    }),
    walls: [
      wall('baffle-c', -3.4, 8.0, 2.4, 8.5),
      wall('meet-w', -12, -5.2, -3.8, -4.7),
      wall('hall-desk', -3, -16.2, 3, -15.0, 1.0, 'wood'),
      wall('pillar-1', -6.9, -19.2, -6.1, -18.4, 1.7, 'pillar'),
      wall('pillar-2', 6.1, -19.2, 6.9, -18.4, 1.7, 'pillar'),
    ],
    desks: [
      desk('d1', -11.0, 20.4, -6.4, 22.0, { top: 'oak', kit: 'clutter' }),
      desk('d2', -4.4, 20.4, 0.4, 22.0, { top: 'walnut', kit: 'dual' }),
      desk('d3', -10.6, 14.8, -5.6, 16.4, { top: 'steel', kit: 'simple' }),
      desk('d4', 6.2, -6.4, 11.2, -4.6, { top: 'white', kit: 'packed' }),
      desk('d5', 6.2, -12.2, 11.2, -10.4, { top: 'walnut', kit: 'clutter' }),
    ],
    props: [
      prop('plant-1', 'plant', -10.8, 25.6, { plantKit: 'grove' }),
      prop('plant-2', 'plant', 2.2, 25.6, { plantKit: 'cluster' }),
      prop('plant-3', 'plant', 14.4, -25.6, { plantKit: 'trio' }),
      prop('cooler-1', 'cooler', -10.8, 11.6),
      prop('wet-1', 'wet', -1.2, 6.0),
      prop('wet-2', 'wet', -1.0, -2.4),
      prop('wet-3', 'wet', 8.8, -8.2),
      prop('pit-1', 'pit', 0.2, -10.4),
      prop('crate-1', 'crate', -6.2, -12.0),
      ...officeWindows(map, voids),
    ],
    chairSpawns: [
      spawn('ch1', -8.4, 19.0, 'task'),
      spawn('ch2', -1.8, 19.0, 'mesh'),
      spawn('ch3', -7.8, 13.6, 'guest'),
      spawn('ch4', 8.6, -3.4, 'mesh'),
      spawn('ch5', 8.6, -9.2, 'guest'),
      spawn('ch6', 0, -17.2, 'exec'),
    ],
    heavyAnchors: [],
    interceptorSpawns: [],
    menuChase: [
      { x: -9.6, z: 23.0 },
      { x: -9.8, z: 12.0 },
      { x: -9.6, z: 2.0 },
      { x: -8.8, z: -8.0 },
      { x: -4.0, z: -16.5 },
      { x: 0.0, z: -24.0 },
      { x: 8.8, z: -16.0 },
      { x: 10.4, z: -6.0 },
      { x: 2.4, z: 1.6 },
      { x: -2.0, z: 12.0 },
      { x: -2.2, z: 22.0 },
    ],
  };
}

export function seedWednesday(): LevelDef {
  const slot = weekdaySlot('wednesday')!;
  const map: MapBounds = { minX: -16, maxX: 16, minZ: -28, maxZ: 28 };
  const voids = [cut('cut-sw', -16, 6, -6, 28), cut('cut-se', 6, 6, 16, 28)];
  return {
    ...officeBase('wednesday', slot.label, {
      map,
      voids,
      playerStart: { x: 0, z: 24.8 },
      elevator: { minX: -2, maxX: 2, minZ: -28, maxZ: -26, point: { x: 0, z: -27 } },
      pointLights: [
        pool('pl-start', 0, 22.5, { intensity: 64, distance: 5.0 }),
        pool('pl-stem', 0, 12.0, { intensity: 56, distance: 5.0 }),
        pool('pl-bar-w', -11.0, -4.0, { intensity: 62, distance: 5.4, color: '#ffe0a8' }),
        pool('pl-bar-e', 11.0, -4.0, { intensity: 62, distance: 5.4, color: '#ffe0a8' }),
        pool('pl-hall', 0, -16.4, { intensity: 52, distance: 5.0, color: '#fff4d0' }),
        pool('pl-elev', 0, -24.2, { color: '#c8ffd8', intensity: 70, distance: 5.0, y: 2.5 }),
      ],
    }),
    walls: [
      wall('baffle-c', -2.6, 10.2, 2.6, 10.7),
      wall('store-n', -15.2, 1.4, -8.4, 1.9),
      wall('store-s', -15.2, -8.6, -8.4, -8.1),
      wall('store-e', -8.6, -8.1, -8.1, -2.2),
      wall('meet-e', 7.4, -10.8, 16, -10.3),
      wall('hall-desk', -2.6, -17.4, 2.6, -16.2, 1.0, 'wood'),
      wall('pillar-1', -5.2, -21.0, -4.4, -20.2, 1.7, 'pillar'),
      wall('pillar-2', 4.4, -21.0, 5.2, -20.2, 1.7, 'pillar'),
    ],
    desks: [
      desk('d1', -5.2, 20.6, -0.6, 22.2, { top: 'dark', kit: 'packed' }),
      desk('d2', 1.0, 20.6, 5.4, 22.2, { top: 'walnut', kit: 'dual' }),
      desk('d3', -14.6, -4.8, -9.6, -3.0, { top: 'oak', kit: 'clutter' }),
      desk('d4', 8.4, -6.8, 13.4, -5.0, { top: 'white', kit: 'clutter' }),
      desk('d5', -3.2, -8.2, 1.6, -6.4, { top: 'bench', kit: 'packed' }),
    ],
    props: [
      prop('plant-1', 'plant', -4.8, 25.6, { plantKit: 'grove' }),
      prop('plant-2', 'plant', 4.8, 25.6, { plantKit: 'cluster' }),
      prop('plant-3', 'plant', -14.6, -25.6, { plantKit: 'trio' }),
      prop('cabinet-1', 'cabinet', -14.2, -0.4),
      prop('cabinet-2', 'cabinet', -14.2, -6.6),
      prop('cooler-1', 'cooler', 14.4, 2.8),
      prop('wet-1', 'wet', 0, 7.2),
      prop('wet-2', 'wet', 0.2, -13.6),
      prop('pit-1', 'pit', -12.4, -0.6),
      prop('pit-2', 'pit', -12.4, -5.8),
      prop('crate-1', 'crate', -10.8, -3.2),
      ...officeWindows(map, voids),
    ],
    chairSpawns: [
      spawn('ch1', -2.6, 19.2, 'task'),
      spawn('ch2', 3.0, 19.2, 'mesh'),
      spawn('ch3', -11.8, -2.0, 'guest'),
      spawn('ch4', 10.6, -3.8, 'stool'),
      spawn('ch5', 0, -18.4, 'exec'),
    ],
    heavyAnchors: [spawn('hv-1', 0, -16.8)],
    interceptorSpawns: [spawn('ic-1', 0.2, -22.6)],
    menuChase: [
      { x: 0.0, z: 23.0 },
      { x: 0.2, z: 12.0 },
      { x: -10.4, z: 2.4 },
      { x: -12.6, z: -6.0 },
      { x: 0.0, z: -14.0 },
      { x: 0.0, z: -24.0 },
      { x: 11.6, z: -6.0 },
      { x: 10.8, z: 2.0 },
      { x: 0.2, z: 8.0 },
    ],
  };
}

export function seedThursday(): LevelDef {
  const slot = weekdaySlot('thursday')!;
  const map: MapBounds = { minX: -16, maxX: 16, minZ: -30, maxZ: 28 };
  const voids = [cut('cut-mouth', -5.5, 0, 5.5, 28)];
  return {
    ...officeBase('thursday', slot.label, {
      map,
      voids,
      playerStart: { x: 10.4, z: 24.6 },
      elevator: { minX: -2, maxX: 2, minZ: -30, maxZ: -28, point: { x: 0, z: -29 } },
      pointLights: [
        pool('pl-start', 10.4, 22.0, { intensity: 64, distance: 5.0 }),
        pool('pl-east', 11.0, 8.0, { intensity: 56, distance: 5.0 }),
        pool('pl-west', -11.0, 8.0, { intensity: 56, distance: 5.0 }),
        pool('pl-base', 0, -8.0, { intensity: 64, distance: 5.4, color: '#ffe0a8' }),
        pool('pl-hall', 0, -18.4, { intensity: 52, distance: 5.0, color: '#fff4d0' }),
        pool('pl-elev', 0, -26.4, { color: '#c8ffd8', intensity: 70, distance: 5.0, y: 2.5 }),
      ],
    }),
    walls: [
      wall('gate-e', 6.2, 8.6, 12.8, 9.1),
      wall('baffle-w', -13.2, 7.2, -7.0, 7.7),
      wall('store-e', -8.8, -8.4, -8.3, 0.4),
      wall('store-n', -16, 0.4, -8.3, 0.9),
      wall('meet-e', 6.4, -11.2, 16, -10.7),
      wall('hall-desk', -3, -18.0, 3, -16.8, 1.0, 'wood'),
      wall('pinch', -1.6, -21.4, 1.6, -21.0),
      wall('pillar-1', -6.4, -24.2, -5.6, -23.4, 1.7, 'pillar'),
      wall('pillar-2', 5.6, -24.2, 6.4, -23.4, 1.7, 'pillar'),
    ],
    desks: [
      desk('d1', 7.2, 20.2, 12.2, 21.8, { top: 'dark', kit: 'packed' }),
      desk('d2', -14.4, 20.2, -9.2, 21.8, { top: 'oak', kit: 'dual' }),
      desk('d3', -3.2, -4.8, 2.0, -3.0, { top: 'walnut', kit: 'packed' }),
      desk('d4', 7.4, -7.6, 12.6, -5.8, { top: 'white', kit: 'simple' }),
      desk('d5', -14.6, -6.8, -9.6, -5.0, { top: 'bench', kit: 'clutter' }),
    ],
    props: [
      prop('plant-1', 'plant', 14.4, 25.6, { plantKit: 'cluster' }),
      prop('plant-2', 'plant', -14.4, 25.6, { plantKit: 'trio' }),
      prop('plant-3', 'plant', 14.4, -27.6, { plantKit: 'pair' }),
      prop('cooler-1', 'cooler', 14.4, 12.4),
      prop('wet-1', 'wet', 10.2, 12.6),
      prop('wet-2', 'wet', 0.2, -13.4),
      prop('pit-1', 'pit', -12.8, -2.2),
      prop('pit-2', 'pit', -12.8, -7.4),
      prop('crate-1', 'crate', -11.0, -4.8),
      prop('launch-1', 'launch', 9.6, 6.2, { rotY: Math.PI }),
      prop('launch-2', 'launch', -8.0, -2.8, { rotY: Math.PI / 2 }),
      ...officeWindows(map, voids),
    ],
    chairSpawns: [
      spawn('ch1', 9.4, 18.8, 'task'),
      spawn('ch2', -11.6, 18.8, 'mesh'),
      spawn('ch3', 0, -1.8, 'exec'),
      spawn('ch4', 9.8, -4.6, 'guest'),
      spawn('ch5', 0, -19.2, 'stool'),
    ],
    heavyAnchors: [
      spawn('hv-1', 10.75, 21.75),
      spawn('hv-2', 13.25, 16.25),
      spawn('hv-3', 0, -20),
      spawn('hv-4', 6.75, 2.25),
    ],
    interceptorSpawns: [spawn('ic-1', 0.2, -25.4)],
    menuChase: [
      { x: 11.2, z: 22.0 },
      { x: 11.4, z: 8.0 },
      { x: 10.6, z: -6.0 },
      { x: 0.0, z: -14.0 },
      { x: 0.0, z: -26.0 },
      { x: -11.2, z: -6.0 },
      { x: -11.4, z: 10.0 },
      { x: -11.0, z: 22.0 },
    ],
  };
}

export function seedFriday(): LevelDef {
  const slot = weekdaySlot('friday')!;
  const map: MapBounds = { minX: -18, maxX: 18, minZ: -30, maxZ: 30 };
  const voids = [
    cut('cut-nw', -18, -30, -7, -6),
    cut('cut-ne', 7, -30, 18, -6),
    cut('cut-sw', -18, 8, -7, 30),
    cut('cut-se', 7, 8, 18, 30),
  ];
  return {
    ...officeBase('friday', slot.label, {
      map,
      voids,
      playerStart: { x: 0, z: 26.8 },
      elevator: { minX: -2, maxX: 2, minZ: -30, maxZ: -28, point: { x: 0, z: -29 } },
      pointLights: [
        pool('pl-start', 0, 24.0, { intensity: 64, distance: 5.0 }),
        pool('pl-cross', 0, 1.0, { intensity: 70, distance: 5.8, color: '#ffe7a0' }),
        pool('pl-west', -12.4, 1.0, { intensity: 58, distance: 5.2 }),
        pool('pl-east', 12.4, 1.0, { intensity: 58, distance: 5.2 }),
        pool('pl-hall', 0, -16.8, { intensity: 52, distance: 5.0, color: '#fff4d0' }),
        pool('pl-elev', 0, -26.4, { color: '#c8ffd8', intensity: 70, distance: 5.0, y: 2.5 }),
      ],
    }),
    walls: [
      wall('ring-n', -3.4, 5.8, 3.4, 6.3),
      wall('ring-s', -3.4, -5.8, 3.4, -5.3),
      wall('store-e', -8.4, -3.6, -7.9, 3.6),
      wall('store-n', -18, 3.6, -7.9, 4.1),
      wall('gate-e', 8.0, 2.0, 14.6, 2.5),
      wall('hall-desk', -3, -18.2, 3, -17.0, 1.0, 'wood'),
      wall('pinch-a', -1.4, -22.0, 1.4, -21.6),
      wall('pillar-1', -5.2, -24.6, -4.4, -23.8, 1.7, 'pillar'),
      wall('pillar-2', 4.4, -24.6, 5.2, -23.8, 1.7, 'pillar'),
    ],
    desks: [
      desk('d1', -5.6, 22.4, -0.8, 24.0, { top: 'oak', kit: 'packed' }),
      desk('d2', 1.2, 22.4, 6.0, 24.0, { top: 'walnut', kit: 'dual' }),
      desk('d3', -3.0, 2.2, 1.8, 4.0, { top: 'dark', kit: 'packed' }),
      desk('d4', -3.0, -4.2, 1.8, -2.4, { top: 'steel', kit: 'clutter' }),
      desk('d5', 9.0, -2.8, 14.2, -1.0, { top: 'bench', kit: 'simple' }),
      desk('d6', -16.4, -2.4, -11.2, -0.6, { top: 'oak', kit: 'simple' }),
    ],
    props: [
      prop('plant-1', 'plant', -5.6, 28.2, { plantKit: 'grove' }),
      prop('plant-2', 'plant', 5.6, 28.2, { plantKit: 'cluster' }),
      prop('plant-3', 'plant', -5.4, -27.6, { plantKit: 'trio' }),
      prop('plant-4', 'plant', 5.4, -27.6, { plantKit: 'pair' }),
      prop('cooler-1', 'cooler', 16.2, 4.6),
      prop('wet-1', 'wet', 0, 10.4),
      prop('wet-2', 'wet', 12.4, 4.2),
      prop('wet-3', 'wet', 0.2, -14.8),
      prop('pit-1', 'pit', -13.6, 1.0),
      prop('pit-2', 'pit', -13.6, -2.2),
      prop('crate-1', 'crate', -12.0, -0.6),
      prop('launch-1', 'launch', 10.8, 0.4, { rotY: Math.PI }),
      prop('launch-2', 'launch', -8.8, 0.2, { rotY: Math.PI / 2 }),
      prop('alarm-1', 'alarm', 0, 0),
      prop('alarm-2', 'alarm', 0.2, -9.6),
      ...officeWindows(map, voids),
    ],
    chairSpawns: [
      spawn('ch1', -3.0, 21.0, 'task'),
      spawn('ch2', 3.4, 21.0, 'mesh'),
      spawn('ch3', 0, 0.6, 'guest'),
      spawn('ch4', 11.4, 0.2, 'stool'),
      spawn('ch5', -13.6, 0.6, 'exec'),
      spawn('ch6', 0, -19.6, 'task'),
    ],
    heavyAnchors: [spawn('hv-1', 0, -20.8), spawn('hv-2', 0, 4.2)],
    interceptorSpawns: [spawn('ic-1', 0.2, -25.8), spawn('ic-2', 12.6, -4.4)],
    menuChase: [
      { x: 0.0, z: 24.0 },
      { x: 0.2, z: 10.0 },
      { x: -12.8, z: 2.0 },
      { x: 0.0, z: -12.0 },
      { x: 0.0, z: -26.0 },
      { x: 12.8, z: 2.0 },
      { x: 0.2, z: 6.0 },
    ],
  };
}

export function seedLevel(id: WeekdayId): LevelDef {
  if (id === 'monday') return seedMonday();
  if (id === 'tuesday') return seedTuesday();
  if (id === 'wednesday') return seedWednesday();
  if (id === 'thursday') return seedThursday();
  return seedFriday();
}

export function emptyCatalog(): LevelCatalog {
  return { version: 1, active: 'monday', levels: WEEKDAYS.map((s) => seedLevel(s.id)) };
}

export function ensureWeekdays(cat: LevelCatalog): boolean {
  let added = false;
  if (cat.version !== 1) cat.version = 1;
  if (!weekdaySlot(cat.active)) cat.active = 'monday';
  cat.levels ??= [];
  for (const slot of WEEKDAYS) {
    if (cat.levels.some((l) => l.id === slot.id)) continue;
    cat.levels.push(seedLevel(slot.id));
    added = true;
  }
  return added;
}

export function levelById(cat: LevelCatalog, id: string | null | undefined): LevelDef {
  const want = (id && weekdaySlot(id)?.id) || cat.active;
  return cat.levels.find((l) => l.id === want) ?? cat.levels[0] ?? seedMonday();
}

function normalizeSpawnMark(s: SpawnDef, i: number, prefix: string): SpawnDef {
  return { id: s.id || `${prefix}-${i}`, x: s.x, z: s.z };
}

function isMondayBox(map?: MapBounds) {
  if (!map) return true;
  return (
    map.minX === MONDAY_MAP.minX &&
    map.maxX === MONDAY_MAP.maxX &&
    map.minZ === MONDAY_MAP.minZ &&
    map.maxZ === MONDAY_MAP.maxZ
  );
}

function normalizeVoid(v: MapVoid, i: number): MapVoid {
  const r = normalizeRect(v);
  const shape = voidShapeOf(v);
  return {
    id: v.id || `cut-${i}`,
    minX: r.minX,
    minZ: r.minZ,
    maxX: r.maxX,
    maxZ: r.maxZ,
    ...(shape !== 'rect' ? { shape } : {}),
    ...(typeof v.rotY === 'number' && Number.isFinite(v.rotY) ? { rotY: v.rotY } : {}),
  };
}

function shouldReseedWeekday(raw: LevelDef, seed: LevelDef) {
  if (raw.id === 'monday') return false;
  const hasHaz = (raw.props ?? []).some((p) => isHazardKind(p.kind));
  const outlineStale = !(raw.voids?.length) && (seed.voids?.length ?? 0) > 0 && isMondayBox(raw.map);
  return (!hasHaz && seed.props.some((p) => isHazardKind(p.kind))) || outlineStale;
}

function normalizeLevel(raw: LevelDef): LevelDef {
  const seed = seedLevel(raw.id);
  if (shouldReseedWeekday(raw, seed)) raw = seed;
  const rawAtmo = raw.atmosphere;
  const wasWashed = (rawAtmo?.sun?.intensity ?? 0) > 0.05;
  const hemi = { ...seed.atmosphere.hemisphere, ...rawAtmo?.hemisphere };
  hemi.intensity = Math.min(MAX_HEMISPHERE, Math.max(0, hemi.intensity ?? 0));
  const ambient = wasWashed
    ? { ...seed.atmosphere.ambient }
    : { ...seed.atmosphere.ambient, ...rawAtmo?.ambient };
  ambient.intensity = Math.min(MAX_AMBIENT, Math.max(0, ambient.intensity ?? 0));
  const fogNear = rawAtmo?.fogNear ?? seed.atmosphere.fogNear;
  let fogFar = rawAtmo?.fogFar ?? seed.atmosphere.fogFar;
  if (fogFar <= fogNear) fogFar = fogNear + 16;
  const out: LevelDef = {
    ...seed,
    ...raw,
    map: { ...seed.map, ...raw.map },
    playerStart: { ...seed.playerStart, ...raw.playerStart },
    elevator: { ...seed.elevator, ...raw.elevator, point: { ...seed.elevator.point, ...raw.elevator?.point } },
    atmosphere: {
      ...seed.atmosphere,
      ...(wasWashed ? {} : rawAtmo),
      ambient,
      hemisphere: hemi,
      sun: { ...seed.atmosphere.sun, intensity: 0, castShadow: false },
      fill: { ...seed.atmosphere.fill, intensity: 0 },
      fogNear,
      fogFar,
      lampDistance: Math.min(MAX_LIGHT_DISTANCE, rawAtmo?.lampDistance ?? seed.atmosphere.lampDistance),
      lampIntensity: Math.min(MAX_LIGHT_INTENSITY, rawAtmo?.lampIntensity ?? seed.atmosphere.lampIntensity),
      followEnabled: false,
      sky: rawAtmo?.sky ?? seed.atmosphere.sky,
      furnitureTone: migrateTone(rawAtmo?.furnitureTone) ?? seed.atmosphere.furnitureTone ?? 'dark',
      floor: { ...seed.atmosphere.floor, ...rawAtmo?.floor },
      wall: { ...seed.atmosphere.wall, ...rawAtmo?.wall },
    },
    walls: (raw.walls ?? seed.walls).map(normalizeSolid),
    desks: (raw.desks ?? seed.desks).map(normalizeDesk),
    props: (raw.props ?? seed.props).filter((p) => p.kind !== 'ceilingLight').map(normalizeProp),
    pointLights: clampPointLights((raw.pointLights ?? seed.pointLights).map(boostOldLight)),
    chairSpawns: (raw.chairSpawns ?? seed.chairSpawns).map(normalizeChair),
    enemySpawns: (raw.enemySpawns ?? []).map((s, i) => normalizeSpawnMark(s, i, 'en')),
    heavyAnchors: (raw.heavyAnchors ?? seed.heavyAnchors ?? []).map((s, i) => normalizeSpawnMark(s, i, 'hv')),
    interceptorSpawns: (raw.interceptorSpawns ?? seed.interceptorSpawns ?? []).map((s, i) =>
      normalizeSpawnMark(s, i, 'ic')
    ),
    boundFaces: normalizeBoundFaces(raw.boundFaces),
    menuChase: (raw.menuChase?.length ? raw.menuChase : seed.menuChase) ?? [],
    voids: (raw.voids ?? seed.voids ?? []).map(normalizeVoid),
  };
  openTuesdayElevatorHall(out);
  snapLaunchDoors(out);
  snapElevator(out);
  return out;
}

/** 周二电梯西侧门垛伸进西廊时，会和末排桌子夹成只有对角能过的缝，追人流场在南北断开。 */
function openTuesdayElevatorHall(level: LevelDef) {
  if (level.id !== 'tuesday') return;
  const wall = level.walls.find((w) => w.id === 'wall-pyq1b0');
  if (wall && wall.maxZ > -25.2) wall.maxZ = -25.35;
}

export async function loadLevelCatalog(): Promise<LevelCatalog> {
  const rel = 'levels/catalog.json';
  const url = `${import.meta.env.BASE_URL}${rel}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const fallback = emptyCatalog();
      ensureWeekdays(fallback);
      return fallback;
    }
    const data = (await res.json()) as LevelCatalog;
    if (!data || data.version !== 1) {
      const fallback = emptyCatalog();
      ensureWeekdays(fallback);
      return fallback;
    }
    data.levels = (data.levels ?? []).map((l) => normalizeLevel(l));
    ensureWeekdays(data);
    return data;
  } catch {
    const fallback = emptyCatalog();
    ensureWeekdays(fallback);
    return fallback;
  }
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
