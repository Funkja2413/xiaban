import * as THREE from 'three/webgpu';
import { ShapeUtils } from 'three/src/extras/ShapeUtils.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { FlowField } from '../sim/flowfield';
import { assetUrl } from '../catalog';
import type { ChairStyle, DeskDef, FurnitureTone, LevelDef, MapBounds, MapRect, MapVoid, SolidDef } from '../levels';
import {
  clipVoidToMap,
  collectFaceMaps,
  deskBox,
  deskYaw,
  containFaceSize,
  hexToInt,
  isInVoid,
  isRectVoid,
  outlineSkirts,
  perimeterSolids,
  plantKitBounds,
  playableRects,
  pointInVoid,
  propSpec,
  punchWallForDoors,
  resolveTone,
  elevatorPoseOf,
  shapedVoidSkirts,
  shapedVoidWalls,
  voidPolygon,
  voidPrism,
  WALL_FACES,
  wallFaceSize,
  yawedAabb,
  type WallFace,
} from '../levels';
import { buildDesk, placeOfficeProp, buildElevator, type ElevatorRig } from './look';
import type { LoosePropBody } from './chairs';
import { loadColorMap, makeWorldCarpet, makeCarpetBump, mats, phong, phongFresh, prepareFacePosterMap, tex, textureImageSize } from './style';
import { layoutSpawns } from './spawns';

export type { MapBounds };

const POSTER_LIFT = 0.012;

/** 只要不是正对坐标轴，就用转向后的盒子。差一点也会把外接矩形撑出空气墙。 */
function offAxis(yaw: number) {
  return Math.abs(Math.sin(yaw * 2)) > 0.02;
}

function placeFacePoster(plane: THREE.Mesh, face: WallFace, sx: number, sy: number, sz: number) {
  const e = POSTER_LIFT;
  switch (face) {
    case 'px':
      plane.position.set(sx / 2 + e, 0, 0);
      plane.rotation.set(0, -Math.PI / 2, 0);
      break;
    case 'nx':
      plane.position.set(-(sx / 2 + e), 0, 0);
      plane.rotation.set(0, Math.PI / 2, 0);
      break;
    case 'py':
      plane.position.set(0, sy / 2 + e, 0);
      plane.rotation.set(-Math.PI / 2, 0, 0);
      break;
    case 'ny':
      plane.position.set(0, -(sy / 2 + e), 0);
      plane.rotation.set(Math.PI / 2, 0, 0);
      break;
    case 'pz':
      plane.position.set(0, 0, sz / 2 + e);
      break;
    case 'nz':
      plane.position.set(0, 0, -(sz / 2 + e));
      plane.rotation.set(0, Math.PI, 0);
      plane.scale.x = -1;
      break;
  }
}

function rectsOverlap(a: MapRect, b: MapRect) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

function lerp2(a: { x: number; z: number }, b: { x: number; z: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

function clipPolygonToRect(poly: { x: number; z: number }[], r: MapRect): { x: number; z: number }[] {
  const clip = (
    pts: { x: number; z: number }[],
    inside: (p: { x: number; z: number }) => boolean,
    hit: (a: { x: number; z: number }, b: { x: number; z: number }) => { x: number; z: number }
  ) => {
    const out: { x: number; z: number }[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const ain = inside(a);
      const bin = inside(b);
      if (ain && bin) out.push(b);
      else if (ain && !bin) out.push(hit(a, b));
      else if (!ain && bin) {
        out.push(hit(a, b));
        out.push(b);
      }
    }
    return out;
  };
  let pts = poly;
  pts = clip(pts, (p) => p.x >= r.minX - 1e-4, (a, b) => lerp2(a, b, (r.minX - a.x) / (b.x - a.x || 1e-9)));
  pts = clip(pts, (p) => p.x <= r.maxX + 1e-4, (a, b) => lerp2(a, b, (r.maxX - a.x) / (b.x - a.x || 1e-9)));
  pts = clip(pts, (p) => p.z >= r.minZ - 1e-4, (a, b) => lerp2(a, b, (r.minZ - a.z) / (b.z - a.z || 1e-9)));
  pts = clip(pts, (p) => p.z <= r.maxZ + 1e-4, (a, b) => lerp2(a, b, (r.maxZ - a.z) / (b.z - a.z || 1e-9)));
  return pts;
}

function polyArea(pts: THREE.Vector2[]) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j]!.x * pts[i]!.y - pts[i]!.x * pts[j]!.y;
  }
  return a;
}

function rewind(pts: THREE.Vector2[], clockwise: boolean) {
  if (ShapeUtils.isClockWise(pts) !== clockwise) pts.reverse();
  return pts;
}

/** 楼板在世界 XZ 上建，UV 按整张地图铺，挖洞块和旁边地砖对齐。 */
function floorTileGeometry(tile: MapRect, voids: MapVoid[], map: MapBounds): THREE.BufferGeometry | null {
  const tw = tile.maxX - tile.minX;
  const th = tile.maxZ - tile.minZ;
  if (tw < 0.05 || th < 0.05) return null;
  const mapW = Math.max(0.01, map.maxX - map.minX);
  const mapH = Math.max(0.01, map.maxZ - map.minZ);

  const outer = rewind(
    [
      new THREE.Vector2(tile.minX, tile.minZ),
      new THREE.Vector2(tile.maxX, tile.minZ),
      new THREE.Vector2(tile.maxX, tile.maxZ),
      new THREE.Vector2(tile.minX, tile.maxZ),
    ],
    true
  );
  const holes: THREE.Vector2[][] = [];
  for (const v of voids) {
    if (isRectVoid(v) || !rectsOverlap(tile, v)) continue;
    const clipped = clipPolygonToRect(voidPolygon(v), tile);
    if (clipped.length >= 3) {
      holes.push(rewind(clipped.map((p) => new THREE.Vector2(p.x, p.z)), false));
    }
  }

  let faces: number[][] = [];
  try {
    faces = ShapeUtils.triangulateShape(outer, holes);
  } catch {
    faces = [];
  }
  const verts = holes.length && faces.length ? outer.concat(...holes) : outer;
  if (!faces.length) {
    faces = polyArea(outer) < 0 ? [[0, 1, 2], [0, 2, 3]] : [[0, 2, 1], [0, 3, 2]];
  }

  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  for (const p of verts) {
    pos.push(p.x, 0, p.y);
    nrm.push(0, 1, 0);
    uv.push((p.x - map.minX) / mapW, (p.y - map.minZ) / mapH);
  }
  const idx: number[] = [];
  for (const f of faces) {
    idx.push(f[0]!, f[2]!, f[1]!);
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

export class Level {
  group = new THREE.Group();
  chairSpawns: { x: number; z: number; style?: ChairStyle; rotY?: number; tone?: FurnitureTone; color?: string }[] = [];
  pushables: LoosePropBody[] = [];
  enemySpawns: { x: number; z: number }[] = [];
  heavyAnchors: { x: number; z: number }[] = [];
  interceptorSpawns: { x: number; z: number }[] = [];
  menuChase: { x: number; z: number }[] = [];

  readonly def: LevelDef;
  readonly map: MapBounds;
  readonly playerStart: { x: number; z: number };
  readonly elevatorZone: { minX: number; maxX: number; minZ: number; maxZ: number };
  readonly elevatorPoint: { x: number; z: number };
  elevator!: ElevatorRig;

  private obstacles: {
    minX: number; minZ: number; maxX: number; maxZ: number;
    h: number; tall?: boolean; nav?: boolean;
    /** 斜放时物理和寻路用这块本地盒；min/max 只是外接矩形，给刷怪用 */
    yaw?: number; hx?: number; hz?: number;
  }[] = [];
  private deskRects: { minX: number; minZ: number; maxX: number; maxZ: number }[] = [];
  private woodMat!: THREE.Material;
  private wallMap!: THREE.Texture;
  private faceMaps = new Map<string, THREE.Texture>();
  private wallMats = new Map<string, THREE.MeshPhongMaterial>();
  private posterMats = new Map<string, THREE.MeshPhongMaterial>();
  private physicsBodies: RAPIER.RigidBody[] = [];

  private constructor(def: LevelDef) {
    this.def = def;
    this.map = def.map;
    this.playerStart = def.playerStart;
    this.elevatorZone = {
      minX: def.elevator.minX,
      maxX: def.elevator.maxX,
      minZ: def.elevator.minZ,
      maxZ: def.elevator.maxZ,
    };
    this.elevatorPoint = def.elevator.point;
    this.chairSpawns = def.chairSpawns.map((s) => ({
      x: s.x,
      z: s.z,
      style: s.style,
      rotY: s.rotY,
      tone: resolveTone(s, def.atmosphere),
      color: s.color,
    }));
    this.enemySpawns = [];
    this.heavyAnchors = [];
    this.interceptorSpawns = [];
    this.menuChase = def.menuChase ? def.menuChase.map((p) => ({ x: p.x, z: p.z })) : [];
  }

  static async create(def: LevelDef): Promise<Level> {
    const level = new Level(def);
    await level.build();
    return level;
  }

  private tag(obj: THREE.Object3D, id: string, kind: string) {
    obj.userData.editId = id;
    obj.userData.editKind = kind;
  }

  private async build() {
    const wallMap = this.def.atmosphere.wall.map
      ? await loadColorMap(assetUrl(this.def.atmosphere.wall.map))
      : tex.plaster();
    this.wallMap = wallMap;
    this.faceMaps.clear();
    const facePaths = collectFaceMaps(this.def);
    const faceLoaded = await Promise.all(facePaths.map(async (p) => {
      const map = prepareFacePosterMap(await loadColorMap(assetUrl(p)));
      return [p, map] as const;
    }));
    for (const [p, map] of faceLoaded) this.faceMaps.set(p, map);
    this.woodMat = mats.wood();

    this.buildPerimeter();
    for (const w of this.def.walls) this.addSolid(w);
    for (const d of this.def.desks) this.addDesk(d);
    this.buildElevator();
    await this.buildFloor();
    this.dressProps();
    const auto = layoutSpawns(this.map, this.obstacles, this.playerStart, this.elevatorPoint, this.def.voids);
    const onFloor = (x: number, z: number) =>
      x > this.map.minX + 0.4 && x < this.map.maxX - 0.4 &&
      z > this.map.minZ + 0.4 && z < this.map.maxZ - 0.4 &&
      !isInVoid(x, z, this.def.voids, 0.5);
    const authored = this.def.enemySpawns.filter((s) => onFloor(s.x, s.z));
    this.enemySpawns = (authored.length ? authored : auto.enemySpawns.filter((s) => onFloor(s.x, s.z)))
      .map((s) => ({ x: s.x, z: s.z }));
    this.heavyAnchors = this.def.heavyAnchors.length
      ? this.def.heavyAnchors.map((s) => ({ x: s.x, z: s.z }))
      : auto.heavyAnchors;
    this.interceptorSpawns = this.def.interceptorSpawns.length
      ? this.def.interceptorSpawns.map((s) => ({ x: s.x, z: s.z }))
      : auto.interceptorSpawns;
  }

  private async buildFloor() {
    const { map } = this;
    const atmo = this.def.atmosphere.floor;
    const kind = atmo.map ? 'image' : (atmo.kind ?? 'carpet');
    const repeat = atmo.repeat ?? 8;
    let floorMap: THREE.Texture;
    let bump: THREE.Texture | null = null;
    if (kind === 'image' && atmo.map) {
      floorMap = (await loadColorMap(assetUrl(atmo.map))).clone();
      floorMap.needsUpdate = true;
      floorMap.repeat.set(repeat, repeat * 2);
    } else if (kind === 'wood') {
      floorMap = tex.wood().clone();
      bump = tex.woodBump().clone();
      floorMap.needsUpdate = true;
      bump.needsUpdate = true;
      floorMap.repeat.set(repeat, repeat * 2);
      bump.repeat.set(repeat, repeat * 2);
    } else if (kind === 'tile') {
      floorMap = tex.tile().clone();
      floorMap.needsUpdate = true;
      floorMap.repeat.set(repeat, repeat * 2);
    } else {
      floorMap = makeWorldCarpet(map, this.deskRects);
      bump = makeCarpetBump();
    }
    floorMap.wrapS = floorMap.wrapT = THREE.RepeatWrapping;
    floorMap.offset.set(0, 0);
    if (kind !== 'carpet') floorMap.repeat.set(repeat, repeat * 2);
    if (bump) {
      bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
      bump.offset.set(0, 0);
    }
    const mat = phongFresh({
      color: hexToInt(atmo.color),
      map: floorMap,
      bumpMap: bump ?? undefined,
      bumpScale: atmo.bumpScale ?? (kind === 'wood' ? 0.9 : 1.2),
      shininess: atmo.shininess,
      specular: kind === 'tile' || kind === 'wood' ? 0x554433 : 0x222015,
    });
    const tiles = playableRects(map, this.def.voids);
    tiles.forEach((tile, i) => {
      const geo = floorTileGeometry(tile, this.def.voids ?? [], map);
      if (!geo) return;
      const floor = new THREE.Mesh(geo, mat);
      floor.receiveShadow = true;
      this.tag(floor, i === 0 ? 'floor' : `floor-${i}`, 'floor');
      this.group.add(floor);
    });
  }

  private addObstacle(
    minX: number, minZ: number, maxX: number, maxZ: number,
    h: number, opts: { tall?: boolean; nav?: boolean; yaw?: number; hx?: number; hz?: number } = {}
  ) {
    const turned = opts.yaw != null && opts.hx != null && opts.hz != null && offAxis(opts.yaw);
    this.obstacles.push({
      minX, minZ, maxX, maxZ, h,
      tall: opts.tall,
      nav: opts.nav,
      yaw: turned ? opts.yaw : undefined,
      hx: turned ? opts.hx : undefined,
      hz: turned ? opts.hz : undefined,
    });
  }

  private wallMaterial(hex: string, mapPath?: string) {
    const key = `${hex.toLowerCase()}|${mapPath ?? ''}`;
    let m = this.wallMats.get(key);
    if (!m) {
      m = phongFresh({
        color: hexToInt(hex),
        map: (mapPath ? this.faceMaps.get(mapPath) : undefined) ?? this.wallMap,
        shininess: this.def.atmosphere.wall.shininess,
        specular: 0x222222,
      });
      this.wallMats.set(key, m);
    }
    return m;
  }

  private posterMaterial(mapPath: string) {
    let m = this.posterMats.get(mapPath);
    if (!m) {
      m = phongFresh({
        color: 0xffffff,
        map: this.faceMaps.get(mapPath),
        shininess: 10,
        specular: 0x111111,
        transparent: true,
        alphaTest: 0.08,
      });
      m.premultipliedAlpha = true;
      m.side = THREE.DoubleSide;
      m.depthWrite = true;
      m.polygonOffset = true;
      m.polygonOffsetFactor = -1;
      m.polygonOffsetUnits = -1;
      this.posterMats.set(mapPath, m);
    }
    return m;
  }

  private faceMaterials(s: SolidDef): THREE.Material | THREE.Material[] {
    if (s.kind === 'wood') return this.woodMat;
    const fallback = s.color ?? this.def.atmosphere.wall.color;
    const mats = WALL_FACES.map((f) => {
      const paint = s.faces?.[f];
      return this.wallMaterial(paint?.color ?? fallback);
    });
    const first = mats[0];
    if (mats.every((m) => m === first)) return first;
    return mats;
  }

  private addFacePosters(mesh: THREE.Mesh, s: SolidDef, sx: number, sy: number, sz: number) {
    if (s.kind === 'wood' || !s.faces) return;
    for (const face of WALL_FACES) {
      const paint = s.faces[face];
      const path = paint?.map;
      if (!path) continue;
      const src = this.faceMaps.get(path);
      if (!src) continue;
      const img = textureImageSize(src);
      if (!img) continue;
      const faceWH = wallFaceSize(sx, sy, sz, face);
      const fit = containFaceSize(faceWH.w, faceWH.h, img.w, img.h);
      if (fit.w < 0.02 || fit.h < 0.02) continue;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(fit.w, fit.h), this.posterMaterial(path));
      placeFacePoster(plane, face, sx, sy, sz);
      this.tag(plane, s.id, s.kind);
      plane.userData.editFace = face;
      mesh.add(plane);
    }
  }

  private addSolid(s: SolidDef) {
    const mat = this.faceMaterials(s);
    const pieces = punchWallForDoors(s, this.def.props);
    for (const piece of pieces) {
      const w = piece.maxX - piece.minX;
      const d = piece.maxZ - piece.minZ;
      const h = piece.y1 - piece.y0;
      if (w < 0.03 || d < 0.03 || h < 0.03) continue;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set((piece.minX + piece.maxX) / 2, (piece.y0 + piece.y1) / 2, (piece.minZ + piece.maxZ) / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.tag(mesh, s.id, s.kind);
      this.addFacePosters(mesh, s, w, h, d);
      this.group.add(mesh);
      if (piece.block) this.addObstacle(piece.minX, piece.minZ, piece.maxX, piece.maxZ, s.h, { tall: s.tall });
    }
  }

  private addDesk(d: DeskDef) {
    const box = deskBox(d);
    const yaw = deskYaw(d);
    this.addObstacle(box.minX, box.minZ, box.maxX, box.maxZ, 0.78, {
      yaw,
      hx: (d.maxX - d.minX) / 2,
      hz: (d.maxZ - d.minZ) / 2,
    });
    this.deskRects.push(box);
    const g = new THREE.Group();
    this.tag(g, d.id, 'desk');
    buildDesk(g, d, resolveTone(d, this.def.atmosphere));
    this.group.add(g);
  }

  private makeStrip(minX: number, minZ: number, maxX: number, maxZ: number, h: number, mat: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, h, maxZ - minZ), mat);
    mesh.position.set((minX + maxX) / 2, h / 2, (minZ + maxZ) / 2);
    return mesh;
  }

  private buildPerimeter() {
    const { map } = this;
    const voids = this.def.voids;
    const bounds = perimeterSolids(map, voids).map((b) => ({
      ...b,
      faces: this.def.boundFaces?.[b.id],
    }));
    for (const b of bounds) this.addSolid(b);
    for (const raw of voids ?? []) {
      if (!isRectVoid(raw)) continue;
      const v = clipVoidToMap(raw, map);
      if (v) this.addObstacle(v.minX, v.minZ, v.maxX, v.maxZ, 4, { tall: true });
    }

    const base = phong({ color: 0x4a3728, shininess: 12, specular: 0x221100 });
    const bh = 0.12;
    for (const s of outlineSkirts(map, voids)) {
      this.group.add(this.makeStrip(s.minX, s.minZ, s.maxX, s.maxZ, bh, base));
    }
    const wallMat = this.wallMaterial(this.def.atmosphere.wall.color);
    for (const w of shapedVoidWalls(map, voids)) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.thick, w.h, w.len), wallMat);
      mesh.position.set(w.x, w.y, w.z);
      mesh.rotation.y = w.rotY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    for (const s of shapedVoidSkirts(map, voids)) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.thick, s.h, s.len), base);
      mesh.position.set(s.x, s.y, s.z);
      mesh.rotation.y = s.rotY;
      this.group.add(mesh);
    }
  }

  private buildElevator() {
    this.elevator = buildElevator(elevatorPoseOf(this.def.elevator), hexToInt(this.def.atmosphere.elevatorGlow));
    this.tag(this.elevator.group, 'elevator', 'elevator');
    this.group.add(this.elevator.group);
  }

  private dressProps() {
    this.pushables = [];
    for (const p of this.def.props) {
      if (p.kind === 'ceilingLight') continue;
      const g = new THREE.Group();
      this.tag(g, p.id, p.kind);
      const spec = propSpec(p.kind);
      const tone = resolveTone(p, this.def.atmosphere);
      const yaw = p.rotY ?? 0;
      if (spec?.move === 'push' && spec.block) {
        const box = p.kind === 'plant' ? plantKitBounds(p.plantKit) : { ...spec.block, mass: spec.mass ?? 10 };
        const mass = box.mass;
        const hy = box.h / 2;
        const inner = new THREE.Group();
        placeOfficeProp(inner, p.kind, tone, p, this.def.atmosphere.sky ?? 'day');
        inner.position.y = -hy;
        g.add(inner);
        g.position.set(p.x, hy, p.z);
        g.rotation.y = yaw;
        this.pushables.push({
          group: g,
          hx: box.hx,
          hz: box.hz,
          hy,
          mass,
          yaw,
        });
      } else {
        g.position.set(p.x, 0, p.z);
        g.rotation.y = yaw;
        placeOfficeProp(g, p.kind, tone, p, this.def.atmosphere.sky ?? 'day');
        if (spec?.block) {
          const box = yawedAabb(p.x, p.z, spec.block.hx, spec.block.hz, yaw);
          // 危险物可被清掉：只留物理，不挖寻路洞，避免空气墙
          this.addObstacle(box.minX, box.minZ, box.maxX, box.maxZ, spec.block.h, {
            nav: spec.move !== 'hazard',
            yaw,
            hx: spec.block.hx,
            hz: spec.block.hz,
          });
        }
      }
      this.group.add(g);
    }
  }

  buildPhysics(world: RAPIER.World) {
    const hx = Math.max(40, (this.map.maxX - this.map.minX) / 2 + 10);
    const hz = Math.max(40, (this.map.maxZ - this.map.minZ) / 2 + 10);
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 0.1, hz).setFriction(0.9), ground);
    this.physicsBodies.push(ground);

    for (const o of this.obstacles) {
      const cx = (o.minX + o.maxX) / 2;
      const cz = (o.minZ + o.maxZ) / 2;
      const collH = (o.tall ? 4 : o.h) / 2;
      let hx = (o.maxX - o.minX) / 2;
      let hz = (o.maxZ - o.minZ) / 2;
      const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(cx, collH, cz);
      if (o.yaw != null && o.hx != null && o.hz != null) {
        hx = o.hx;
        hz = o.hz;
        desc.setRotation({ x: 0, y: Math.sin(o.yaw / 2), z: 0, w: Math.cos(o.yaw / 2) });
      }
      const body = world.createRigidBody(desc);
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, collH, hz).setFriction(0.2), body);
      this.physicsBodies.push(body);
    }
    for (const raw of this.def.voids ?? []) {
      if (isRectVoid(raw)) continue;
      const poly = voidPolygon(raw);
      if (poly.length < 3) continue;
      const mesh = voidPrism(poly, 4);
      const desc = RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices);
      if (!desc) continue;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
      world.createCollider(desc.setFriction(0.2), body);
      this.physicsBodies.push(body);
    }
  }

  /** 换关时拆掉这一关的静态碰撞和网格。 */
  dispose(world: RAPIER.World) {
    for (const body of this.physicsBodies) world.removeRigidBody(body);
    this.physicsBodies.length = 0;
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
    });
    this.group.clear();
  }

  applyToFlow(flow: FlowField) {
    // 寻路 = 地图 − 不可移动实体。可推/椅子/危险区不挖洞。
    for (const o of this.obstacles) {
      if (o.nav === false) continue;
      if (o.yaw != null && o.hx != null && o.hz != null) {
        flow.blockYawed((o.minX + o.maxX) / 2, (o.minZ + o.maxZ) / 2, o.hx, o.hz, o.yaw, 0.28);
      } else {
        flow.blockRect(o.minX, o.minZ, o.maxX, o.maxZ, 0.28);
      }
    }
    const shaped = (this.def.voids ?? []).filter((v) => !isRectVoid(v));
    if (shaped.length) flow.blockIf((x, z) => shaped.some((v) => pointInVoid(x, z, v, 0.1)));
  }
}
