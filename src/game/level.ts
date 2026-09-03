import * as THREE from 'three/webgpu';
import RAPIER from '@dimforge/rapier3d-compat';
import { FlowField } from '../sim/flowfield';
import { assetUrl } from '../catalog';
import type { ChairStyle, DeskDef, FurnitureTone, LevelDef, MapBounds, SolidDef } from '../levels';
import { hexToInt, perimeterSolids, plantKitBounds, propSpec, resolveTone, WALL_FACES, yawedAabb } from '../levels';
import { buildDesk, addWindow, placeOfficeProp, buildElevator, type ElevatorRig } from './look';
import type { LoosePropBody } from './chairs';
import { loadColorMap, makeWorldCarpet, makeCarpetBump, mats, phong, phongFresh, tex } from './style';
import { layoutSpawns } from './spawns';

export type { MapBounds };

export class Level {
  group = new THREE.Group();
  chairSpawns: { x: number; z: number; style?: ChairStyle; rotY?: number; tone?: FurnitureTone }[] = [];
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

  private obstacles: { minX: number; minZ: number; maxX: number; maxZ: number; h: number; tall?: boolean }[] = [];
  private deskRects: { minX: number; minZ: number; maxX: number; maxZ: number }[] = [];
  private woodMat!: THREE.Material;
  private wallMap!: THREE.Texture;
  private wallMats = new Map<string, THREE.MeshPhongMaterial>();

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
    this.woodMat = mats.wood();

    this.buildPerimeter();
    for (const w of this.def.walls) this.addSolid(w);
    for (const d of this.def.desks) this.addDesk(d);
    this.buildElevator();
    await this.buildFloor();
    this.dressProps();
    const auto = layoutSpawns(this.map, this.obstacles, this.playerStart, this.elevatorPoint);
    this.enemySpawns = auto.enemySpawns;
    this.heavyAnchors = auto.heavyAnchors;
    this.interceptorSpawns = auto.interceptorSpawns;
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
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(map.maxX - map.minX, map.maxZ - map.minZ),
      phongFresh({
        color: hexToInt(atmo.color),
        map: floorMap,
        bumpMap: bump ?? undefined,
        bumpScale: atmo.bumpScale ?? (kind === 'wood' ? 0.9 : 1.2),
        shininess: atmo.shininess,
        specular: kind === 'tile' || kind === 'wood' ? 0x554433 : 0x222015,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((map.minX + map.maxX) / 2, 0, (map.minZ + map.maxZ) / 2);
    floor.receiveShadow = true;
    this.tag(floor, 'floor', 'floor');
    this.group.add(floor);
  }

  private addObstacle(
    minX: number, minZ: number, maxX: number, maxZ: number,
    h: number, opts: { tall?: boolean } = {}
  ) {
    this.obstacles.push({ minX, minZ, maxX, maxZ, h, tall: opts.tall });
  }

  private wallMaterial(hex: string) {
    const key = hex.toLowerCase();
    let m = this.wallMats.get(key);
    if (!m) {
      m = phongFresh({
        color: hexToInt(key),
        map: this.wallMap,
        shininess: this.def.atmosphere.wall.shininess,
        specular: 0x222222,
      });
      this.wallMats.set(key, m);
    }
    return m;
  }

  private faceMaterials(s: SolidDef): THREE.Material | THREE.Material[] {
    if (s.kind === 'wood') return this.woodMat;
    const fallback = s.color ?? this.def.atmosphere.wall.color;
    const mats = WALL_FACES.map((f) => this.wallMaterial(s.faces?.[f] ?? fallback));
    const first = mats[0];
    if (mats.every((m) => m === first)) return first;
    return mats;
  }

  private addSolid(s: SolidDef) {
    const mat = this.faceMaterials(s);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.maxX - s.minX, s.h, s.maxZ - s.minZ), mat);
    mesh.position.set((s.minX + s.maxX) / 2, s.h / 2, (s.minZ + s.maxZ) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.tag(mesh, s.id, s.kind);
    this.group.add(mesh);
    this.addObstacle(s.minX, s.minZ, s.maxX, s.maxZ, s.h, { tall: s.tall });
  }

  private addDesk(d: DeskDef) {
    this.addObstacle(d.minX, d.minZ, d.maxX, d.maxZ, 0.78);
    this.deskRects.push({ minX: d.minX, minZ: d.minZ, maxX: d.maxX, maxZ: d.maxZ });
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
    const bounds = perimeterSolids(map).map((b) => ({
      ...b,
      faces: this.def.boundFaces?.[b.id],
    }));
    for (const b of bounds) this.addSolid(b);

    const base = phong({ color: 0x4a3728, shininess: 12, specular: 0x221100 });
    const bh = 0.12;
    this.group.add(this.makeStrip(map.minX, map.minZ, map.minX + 0.08, map.maxZ, bh, base));
    this.group.add(this.makeStrip(map.maxX - 0.08, map.minZ, map.maxX, map.maxZ, bh, base));
    this.group.add(this.makeStrip(map.minX, map.minZ, map.maxX, map.minZ + 0.08, bh, base));
    this.group.add(this.makeStrip(map.minX, map.maxZ - 0.08, map.maxX, map.maxZ, bh, base));
  }

  private buildElevator() {
    this.elevator = buildElevator(this.elevatorZone, this.map, hexToInt(this.def.atmosphere.elevatorGlow));
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
      if (p.kind === 'window') {
        g.position.set(p.x, 0, p.z);
        g.rotation.y = yaw;
        addWindow(g, 0, p.y ?? 1.15, 0, 0, p.w ?? 2.4, p.h ?? 1.05, this.def.atmosphere.sky ?? 'day');
      } else if (spec?.move === 'push' && spec.block) {
        const box = p.kind === 'plant' ? plantKitBounds(p.plantKit) : { ...spec.block, mass: spec.mass ?? 10 };
        const mass = box.mass;
        const hy = box.h / 2;
        const inner = new THREE.Group();
        placeOfficeProp(inner, p.kind, tone, p);
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
        placeOfficeProp(g, p.kind, tone, p);
        if (spec?.block) {
          const box = yawedAabb(p.x, p.z, spec.block.hx, spec.block.hz, yaw);
          this.addObstacle(box.minX, box.minZ, box.maxX, box.maxZ, spec.block.h);
        }
      }
      this.group.add(g);
    }
  }

  buildPhysics(world: RAPIER.World) {
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.1, 40).setFriction(0.9), ground);

    for (const o of this.obstacles) {
      const cx = (o.minX + o.maxX) / 2;
      const cz = (o.minZ + o.maxZ) / 2;
      const hx = (o.maxX - o.minX) / 2;
      const hz = (o.maxZ - o.minZ) / 2;
      const collH = (o.tall ? 4 : o.h) / 2;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, collH, cz));
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, collH, hz).setFriction(0.2), body);
    }
  }

  applyToFlow(flow: FlowField) {
    for (const o of this.obstacles) {
      flow.blockRect(o.minX, o.minZ, o.maxX, o.maxZ);
    }
  }

  get bulletBlockers() {
    return this.obstacles.filter((o) => o.h >= 1.0);
  }
}
