/** 关卡清单。游戏只读；写入走场景编辑器。周一～周五各一槽。 */

export type WeekdayId = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';

export interface WeekdaySlot {
  id: WeekdayId;
  label: string;
  blurb: string;
}

export const WEEKDAYS: WeekdaySlot[] = [
  { id: 'monday', label: '周一', blurb: '白光窗 · 原型关' },
  { id: 'tuesday', label: '周二', blurb: '冷白窗' },
  { id: 'wednesday', label: '周三', blurb: '加班，窗外晚霞' },
  { id: 'thursday', label: '周四', blurb: '夜里，玻璃发冷光' },
  { id: 'friday', label: '周五', blurb: '下班前晚霞' },
];

export interface MapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
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
  /** 六个面各自的颜色。有值的面覆盖 color / 场景底色。 */
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
export type FaceColors = Partial<Record<WallFace, string>>;
export const WALL_FACES: WallFace[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

export function wallFaceFromIndex(faceIndex: number): WallFace {
  return WALL_FACES[Math.min(5, Math.max(0, Math.floor(faceIndex / 2)))]!;
}

export function wallFaceLabel(face: WallFace): string {
  return { px: '+X', nx: '−X', py: '顶', ny: '底', pz: '+Z', nz: '−Z' }[face];
}

export function normalizeFaceColors(raw?: FaceColors): FaceColors | undefined {
  if (!raw) return undefined;
  const out: FaceColors = {};
  let n = 0;
  for (const f of WALL_FACES) {
    const c = migrateHexColor(raw[f]);
    if (c) {
      out[f] = c;
      n++;
    }
  }
  return n ? out : undefined;
}

export function perimeterSolids(map: MapBounds): SolidDef[] {
  const t = 0.5;
  const h = 1.7;
  return [
    { id: 'bound-w', kind: 'wall', minX: map.minX - t, minZ: map.minZ - t, maxX: map.minX, maxZ: map.maxZ + t, h, tall: true },
    { id: 'bound-e', kind: 'wall', minX: map.maxX, minZ: map.minZ - t, maxX: map.maxX + t, maxZ: map.maxZ + t, h, tall: true },
    { id: 'bound-n', kind: 'wall', minX: map.minX - t, minZ: map.minZ - t, maxX: map.maxX + t, maxZ: map.minZ, h, tall: true },
    { id: 'bound-s', kind: 'wall', minX: map.minX - t, minZ: map.maxZ, maxX: map.maxX + t, maxZ: map.maxZ + t, h, tall: true },
  ];
}

export function migrateTone(t?: string): FurnitureTone | undefined {
  if (t === 'light' || t === 'dark') return t;
  return undefined;
}

export function resolveTone(item?: { tone?: FurnitureTone }, atmo?: { furnitureTone?: FurnitureTone }): FurnitureTone {
  return item?.tone ?? atmo?.furnitureTone ?? 'dark';
}

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
  /** 桌上物品朝向（弧度）。有值时优先于 face。桌面仍贴拖出的矩形。 */
  rotY?: number;
  /** 腿、挡板、桌上键鼠等成套色。没有则跟场景默认。 */
  tone?: FurnitureTone;
}

export type PropKind =
  | 'plant'
  | 'cooler'
  | 'ceilingLight'
  | 'window'
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
  | 'locker';

/** 游戏里碰到这件东西会怎样 */
export type MoveHint = 'push' | 'block' | 'decor' | 'meta';

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
  { id: 'window', label: '侧窗', move: 'decor', rotatable: true },
];

export function isPushProp(kind: string) {
  return propSpec(kind)?.move === 'push';
}

export const MOVE_HINT: Record<MoveHint, string> = {
  push: '游戏里可推动，能撞人',
  block: '固定，挡路，推不动',
  decor: '仅装饰，可以穿过去',
  meta: '标记点，不是家具',
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

/** 旋转后的轴对齐包围盒，给挡路用。 */
export function yawedAabb(x: number, z: number, hx: number, hz: number, yaw: number) {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const ax = hx * c + hz * s;
  const az = hx * s + hz * c;
  return { minX: x - ax, maxX: x + ax, minZ: z - az, maxZ: z + az };
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
  /** 仅绿植：一盆到树丛 */
  plantKit?: PlantKit;
}

export interface SpawnDef extends Xz {
  id: string;
  style?: ChairStyle;
  rotY?: number;
  tone?: FurnitureTone;
}

/** 手机预算：动态点光上限。再多 Phong 逐灯计算会掉帧。 */
export const MAX_POINT_LIGHTS = 6;
export const MAX_LIGHT_INTENSITY = 80;
export const MAX_LIGHT_DISTANCE = 10;
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
  /** 外墙（bound-*）各面的上色。外墙不进 walls 列表。 */
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
  };
}

function spawn(id: string, x: number, z: number, style?: ChairStyle): SpawnDef {
  return { id, x, z, style };
}

function normalizeChair(s: SpawnDef, i: number): SpawnDef {
  return { ...s, style: s.style ? migrateChair(s.style) : CHAIRS[i % CHAIRS.length], tone: migrateTone(s.tone) };
}

function normalizeProp(p: PropDef): PropDef {
  return {
    ...p,
    tone: migrateTone(p.tone),
    plantKit: p.kind === 'plant' ? migratePlantKit(p.plantKit) : undefined,
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

export function seedLevel(id: WeekdayId): LevelDef {
  const slot = weekdaySlot(id)!;
  if (id === 'monday') return seedMonday();
  return cloneLevel(seedMonday(), id, slot.label, atmospherePreset(id));
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

function normalizeLevel(raw: LevelDef): LevelDef {
  const seed = seedLevel(raw.id);
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
  return {
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
    enemySpawns: [],
    heavyAnchors: [],
    interceptorSpawns: [],
    boundFaces: normalizeBoundFaces(raw.boundFaces),
    menuChase: (raw.menuChase?.length ? raw.menuChase : seed.menuChase) ?? [],
  };
}

export async function loadLevelCatalog(): Promise<LevelCatalog> {
  const rel = 'levels/catalog.json';
  const url = `${import.meta.env.BASE_URL}${rel}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
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

export function listedTextures(cat: LevelCatalog): string[] {
  const out: string[] = [];
  for (const l of cat.levels) {
    if (l.atmosphere.floor.map) out.push(l.atmosphere.floor.map);
    if (l.atmosphere.wall.map) out.push(l.atmosphere.wall.map);
  }
  return out;
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
