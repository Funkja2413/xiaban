import * as THREE from 'three/webgpu';
import { Level } from '../../../src/game/level';
import { addLightsToScene, applyAtmosphere, createLights, type SceneLights } from '../../../src/game/atmosphere';
import { addOfficeChair } from '../../../src/game/look';
import {
  MAX_POINT_LIGHTS,
  clampLightParams,
  deskYaw,
  newId,
  perimeterSolids,
  plantKitBounds,
  propSpec,
  resolveTone,
  wallFaceFromIndex,
  yawToFace,
  type ChairStyle,
  type DeskDef,
  type DeskFace,
  type DeskKit,
  type DeskTop,
  type FurnitureTone,
  type LevelDef,
  type PlantKit,
  type PointLightDef,
  type PropKind,
  type SolidDef,
  type SolidKind,
  type SpawnDef,
  type WallFace,
} from '../../../src/levels';

export type Tool =
  | 'select'
  | 'wall'
  | 'wood'
  | 'pillar'
  | 'desk'
  | 'player'
  | 'chair'
  | 'pointLight'
  | 'elevator'
  | PropKind;

export type CamMode = 'orbit' | 'top' | 'play';

export type EditKind =
  | SolidKind
  | 'desk'
  | PropKind
  | 'player'
  | 'chair'
  | 'pointLight'
  | 'elevator'
  | 'floor';

export interface Selection {
  id: string;
  kind: EditKind;
  /** 点到的墙面（只给这一面取色） */
  face?: WallFace;
}

const SNAP = 0.5;
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function snap(v: number, step = SNAP) {
  return Math.round(v / step) * step;
}

function hitEdit(obj: THREE.Object3D | null): Selection | null {
  let o: THREE.Object3D | null = obj;
  while (o) {
    if (o.userData.editId && o.userData.editKind && o.userData.editKind !== 'floor') {
      return { id: o.userData.editId, kind: o.userData.editKind };
    }
    o = o.parent;
  }
  return null;
}

const MARK: Record<string, number> = {
  player: 0x7ef0a0,
  chair: 0xb88958,
  pointLight: 0xffe08a,
};

export class ScenePreview {
  def!: LevelDef;
  tool: Tool = 'select';
  cam: CamMode = 'orbit';
  selected: Selection | null = null;
  lastDeskTop: DeskTop = 'oak';
  lastDeskKit: DeskKit = 'clutter';
  lastDeskFace: DeskFace = 'pz';
  lastChairStyle: ChairStyle = 'task';
  lastTone: FurnitureTone = 'dark';
  lastPlantKit: PlantKit = 'trio';
  lastYaw = 0;
  onSelect: () => void = () => {};
  onChange: (rebuild: boolean) => void = () => {};
  onWarn: (msg: string) => void = () => {};
  status = '';

  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.2, 200);
  private renderer!: THREE.WebGPURenderer;
  private lights!: SceneLights;
  private levelGroup: THREE.Group | null = null;
  private markers = new THREE.Group();
  private ghost = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x6ea8ff, transparent: true, opacity: 0.35, depthWrite: false })
  );
  private ring = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffe08a, wireframe: true })
  );
  private faceMark = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffc14d, transparent: true, opacity: 0.38, depthTest: false, side: THREE.DoubleSide })
  );

  private ray = new THREE.Raycaster();
  private ptr = new THREE.Vector2();
  private hit = new THREE.Vector3();
  private target = new THREE.Vector3();
  private azimuth = 0.35;
  private polar = 0.95;
  private radius = 42;
  private dragging = false;
  private drawing = false;
  private moved = false;
  private drawStart = new THREE.Vector3();
  private lastGround = new THREE.Vector3();
  private orbiting = false;
  private panning = false;
  private lastPx = 0;
  private lastPy = 0;
  private buildGen = 0;
  private host!: HTMLElement;

  async init(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGPURenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    await this.renderer.init();
    host.appendChild(this.renderer.domElement);
    this.ghost.visible = false;
    this.ring.visible = false;
    this.faceMark.visible = false;
    this.faceMark.renderOrder = 4;
    this.scene.add(this.ghost, this.ring, this.faceMark, this.markers);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.resize();
    this.bind();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  async setLevel(def: LevelDef) {
    this.def = def;
    this.selected = null;
    this.centerOnMap();
    if (!this.lights) {
      this.lights = createLights(def.atmosphere, def.pointLights ?? []);
      addLightsToScene(this.scene, this.lights);
    }
    await this.rebuild();
    this.applyLook();
    this.lastTone = def.atmosphere.furnitureTone ?? 'dark';
  }

  applyLook() {
    if (!this.lights || !this.def) return;
    applyAtmosphere(this.scene, this.renderer, this.lights, this.def.atmosphere, this.def.pointLights ?? []);
  }

  async rebuild() {
    const gen = ++this.buildGen;
    const next = await Level.create(this.def);
    if (gen !== this.buildGen) return;
    if (this.levelGroup) this.scene.remove(this.levelGroup);
    this.levelGroup = next.group;
    this.scene.add(next.group);
    this.refreshMarkers();
    this.syncRing();
    this.applyLook();
  }

  private centerOnMap() {
    const { map } = this.def;
    this.target.set((map.minX + map.maxX) / 2, 0, (map.minZ + map.maxZ) / 2);
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private groundAt(ev: PointerEvent): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ptr, this.camera);
    if (this.ray.ray.intersectPlane(GROUND, this.hit)) return this.hit;
    return null;
  }

  private pick(ev: PointerEvent): Selection | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ptr, this.camera);
    const objs: THREE.Object3D[] = [];
    if (this.levelGroup) objs.push(this.levelGroup);
    objs.push(this.markers);
    const hits = this.ray.intersectObjects(objs, true);
    for (const h of hits) {
      const sel = hitEdit(h.object);
      if (!sel) continue;
      if ((sel.kind === 'wall' || sel.kind === 'pillar') && h.faceIndex != null) {
        return { ...sel, face: wallFaceFromIndex(h.faceIndex) };
      }
      return sel;
    }
    return null;
  }

  private bind() {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (ev) => this.onDown(ev));
    el.addEventListener('pointermove', (ev) => this.onMove(ev));
    el.addEventListener('pointerup', (ev) => this.onUp(ev));
    el.addEventListener('pointerleave', (ev) => this.onUp(ev));
    el.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.radius = Math.min(90, Math.max(10, this.radius * (ev.deltaY > 0 ? 1.08 : 0.92)));
    }, { passive: false });
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Delete' || ev.key === 'Backspace') this.deleteSelected();
      if (ev.key === 'Escape') {
        this.selected = null;
        this.syncRing();
        this.onSelect();
      }
    });
  }

  private onDown(ev: PointerEvent) {
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    this.dragging = true;
    this.moved = false;
    this.lastPx = ev.clientX;
    this.lastPy = ev.clientY;
    const g = this.groundAt(ev);
    if (g) this.lastGround.copy(g);

    const orbitBtn = ev.button === 2 || ev.button === 1 || ev.altKey;
    if (orbitBtn) {
      this.orbiting = ev.button !== 1 && !ev.shiftKey;
      this.panning = ev.button === 1 || ev.shiftKey;
      return;
    }
    if (ev.button !== 0) return;

    if (this.tool === 'select') {
      const hit = this.pick(ev);
      this.selected = hit;
      this.syncRing();
      this.onSelect();
      return;
    }
    if (!g) return;
    if (this.isPointTool()) {
      this.placePoint(g.x, g.z);
      return;
    }
    this.drawing = true;
    this.drawStart.set(snap(g.x), 0, snap(g.z));
    this.ghost.visible = true;
  }

  private onMove(ev: PointerEvent) {
    const g = this.groundAt(ev);
    if (g && this.isPointTool() && !this.dragging) this.status = `${g.x.toFixed(1)}, ${g.z.toFixed(1)}`;

    if (!this.dragging) {
      if (g && this.tool === 'plant') {
        const box = plantKitBounds(this.lastPlantKit);
        this.ghost.visible = true;
        this.ghost.position.set(snap(g.x), box.h / 2, snap(g.z));
        this.ghost.scale.set(box.hx * 2, box.h, box.hz * 2);
      } else if (g && (this.tool === 'wall' || this.tool === 'desk' || this.tool === 'wood' || this.tool === 'pillar' || this.tool === 'elevator')) {
        this.ghost.visible = true;
        this.ghost.position.set(snap(g.x), 0.85, snap(g.z));
        this.ghost.scale.set(this.tool === 'desk' ? 4 : 2, this.tool === 'elevator' ? 0.1 : 1.7, this.tool === 'desk' ? 1.6 : 0.5);
      } else if (!this.drawing) this.ghost.visible = false;
      return;
    }

    const dx = ev.clientX - this.lastPx;
    const dy = ev.clientY - this.lastPy;
    if (Math.abs(dx) + Math.abs(dy) > 2) this.moved = true;
    this.lastPx = ev.clientX;
    this.lastPy = ev.clientY;

    if (this.orbiting) {
      this.azimuth -= dx * 0.008;
      this.polar = Math.min(1.45, Math.max(0.12, this.polar + dy * 0.008));
      return;
    }
    if (this.panning && g) {
      this.target.x -= (g.x - this.lastGround.x);
      this.target.z -= (g.z - this.lastGround.z);
      this.lastGround.copy(g);
      return;
    }
    if (this.drawing && g) {
      this.updateGhostRect(this.drawStart.x, this.drawStart.z, snap(g.x), snap(g.z));
      return;
    }
    if (this.tool === 'select' && this.selected && g && this.moved) {
      const mx = g.x - this.lastGround.x;
      const mz = g.z - this.lastGround.z;
      this.lastGround.copy(g);
      this.nudgeSelected(mx, mz);
    }
  }

  private onUp(ev: PointerEvent) {
    if (!this.dragging) return;
    this.dragging = false;
    const wasOrbit = this.orbiting || this.panning;
    this.orbiting = false;
    this.panning = false;
    if (this.drawing) {
      this.drawing = false;
      this.ghost.visible = false;
      const g = this.groundAt(ev);
      if (g && this.moved) this.commitRect(this.drawStart.x, this.drawStart.z, snap(g.x), snap(g.z));
    }
    if (this.tool === 'select' && this.selected && this.moved && !wasOrbit) {
      this.onChange(this.selected.kind !== 'pointLight' && this.selected.kind !== 'chair');
    }
  }

  private isPointTool() {
    if (this.tool === 'player' || this.tool === 'chair' || this.tool === 'pointLight') return true;
    return !!propSpec(this.tool);
  }

  private updateGhostRect(x0: number, z0: number, x1: number, z1: number) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minZ = Math.min(z0, z1);
    const maxZ = Math.max(z0, z1);
    const h = this.tool === 'elevator' ? 0.08 : this.tool === 'desk' ? 0.78 : this.tool === 'wood' ? 1 : 1.7;
    this.ghost.scale.set(Math.max(0.2, maxX - minX), h, Math.max(0.2, maxZ - minZ));
    this.ghost.position.set((minX + maxX) / 2, h / 2, (minZ + maxZ) / 2);
    this.ghost.visible = true;
  }

  private commitRect(x0: number, z0: number, x1: number, z1: number) {
    let minX = Math.min(x0, x1);
    let maxX = Math.max(x0, x1);
    let minZ = Math.min(z0, z1);
    let maxZ = Math.max(z0, z1);
    if (maxX - minX < 0.35) {
      maxX = minX + 0.5;
    }
    if (maxZ - minZ < 0.35) {
      maxZ = minZ + 0.5;
    }
    if (this.tool === 'elevator') {
      this.def.elevator.minX = minX;
      this.def.elevator.maxX = maxX;
      this.def.elevator.minZ = minZ;
      this.def.elevator.maxZ = maxZ;
      this.def.elevator.point = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
      this.selected = { id: 'elevator', kind: 'elevator' };
    } else if (this.tool === 'desk') {
      const d: DeskDef = {
        id: newId('desk'),
        minX, minZ, maxX, maxZ,
        top: this.lastDeskTop,
        kit: this.lastDeskKit,
        face: yawToFace(this.lastYaw),
        rotY: this.lastYaw,
        tone: this.lastTone,
      };
      this.def.desks.push(d);
      this.selected = { id: d.id, kind: 'desk' };
    } else {
      const kind: SolidKind = this.tool === 'wood' ? 'wood' : this.tool === 'pillar' ? 'pillar' : 'wall';
      const h = kind === 'wood' ? 1 : 1.7;
      const s = { id: newId(kind), kind, minX, minZ, maxX, maxZ, h };
      this.def.walls.push(s);
      this.selected = { id: s.id, kind };
    }
    this.onSelect();
    this.onChange(true);
  }

  private placePoint(x: number, z: number) {
    const sx = snap(x);
    const sz = snap(z);
    const { map } = this.def;
    if (this.tool === 'player') {
      this.def.playerStart = { x: sx, z: sz };
      this.selected = { id: 'player', kind: 'player' };
    } else if (this.tool === 'window') {
      const toW = Math.abs(sx - map.minX);
      const toE = Math.abs(sx - map.maxX);
      const west = toW <= toE;
      const p = {
        id: newId('win'),
        kind: 'window' as const,
        x: west ? map.minX + 0.02 : map.maxX - 0.02,
        z: sz,
        y: 1.15,
        rotY: west ? Math.PI / 2 : -Math.PI / 2,
        w: 2.4,
        h: 1.05,
      };
      this.lastYaw = p.rotY;
      this.def.props.push(p);
      this.selected = { id: p.id, kind: 'window' };
    } else if (propSpec(this.tool) && this.tool !== 'ceilingLight') {
      const kind = this.tool as PropKind;
      const p = {
        id: newId(kind),
        kind,
        x: sx,
        z: sz,
        rotY: this.lastYaw,
        tone: this.lastTone,
        ...(kind === 'plant' ? { plantKit: this.lastPlantKit } : {}),
      };
      this.def.props.push(p);
      this.selected = { id: p.id, kind };
    } else if (this.tool === 'chair') {
      const s: SpawnDef = { id: newId('chair'), x: sx, z: sz, style: this.lastChairStyle, rotY: this.lastYaw, tone: this.lastTone };
      this.def.chairSpawns.push(s);
      this.selected = { id: s.id, kind: 'chair' };
      this.refreshMarkers();
      this.syncRing();
      this.onSelect();
      this.onChange(false);
      return;
    } else if (this.tool === 'pointLight') {
      this.def.pointLights ??= [];
      if (this.def.pointLights.length >= MAX_POINT_LIGHTS) {
        this.status = `点光最多 ${MAX_POINT_LIGHTS} 盏`;
        this.onWarn(`点光最多 ${MAX_POINT_LIGHTS} 盏（手机预算）。删一盏再放。`);
        return;
      }
      const atmo = this.def.atmosphere;
      const L = clampLightParams({
        id: newId('pl'),
        x: sx,
        z: sz,
        y: atmo.overheadHeight || 2.3,
        intensity: atmo.lampIntensity || 56,
        distance: atmo.lampDistance || 4.5,
        color: atmo.lampColor || '#fff1b8',
      });
      this.def.pointLights.push(L);
      this.selected = { id: L.id, kind: 'pointLight' };
      this.applyLook();
      this.refreshMarkers();
      this.syncRing();
      this.onSelect();
      this.onChange(false);
      return;
    }
    this.onSelect();
    this.onChange(true);
  }

  findSolid(id: string) {
    return this.def.walls.find((w) => w.id === id);
  }
  findDesk(id: string) {
    return this.def.desks.find((d) => d.id === id);
  }
  findProp(id: string) {
    return this.def.props.find((p) => p.id === id);
  }
  findLight(id: string): PointLightDef | undefined {
    return this.def.pointLights?.find((l) => l.id === id);
  }

  findChair(id: string) {
    return this.def.chairSpawns.find((s) => s.id === id);
  }

  applyChairStyle(style: ChairStyle) {
    const sel = this.selected;
    if (!sel || sel.kind !== 'chair') return;
    const chair = this.findChair(sel.id);
    if (!chair) return;
    chair.style = style;
    this.lastChairStyle = style;
    this.refreshMarkers();
    this.syncRing();
  }

  applyPlantKit(kit: PlantKit) {
    const sel = this.selected;
    if (!sel || sel.kind !== 'plant') return;
    const p = this.findProp(sel.id);
    if (!p) return;
    p.plantKit = kit;
    this.lastPlantKit = kit;
    this.onChange(true);
  }

  canTone() {
    const sel = this.selected;
    if (!sel) return false;
    if (sel.kind === 'desk' || sel.kind === 'chair') return true;
    const spec = propSpec(sel.kind);
    return !!spec && sel.kind !== 'window';
  }

  itemTone(): FurnitureTone {
    const sel = this.selected;
    if (!sel) return resolveTone(undefined, this.def.atmosphere);
    if (sel.kind === 'desk') return resolveTone(this.findDesk(sel.id), this.def.atmosphere);
    if (sel.kind === 'chair') return resolveTone(this.findChair(sel.id), this.def.atmosphere);
    return resolveTone(this.findProp(sel.id), this.def.atmosphere);
  }

  applyTone(tone: FurnitureTone) {
    const sel = this.selected;
    if (!sel || !this.canTone()) return;
    this.lastTone = tone;
    if (sel.kind === 'desk') {
      const d = this.findDesk(sel.id);
      if (!d) return;
      d.tone = tone;
      this.onChange(true);
      return;
    }
    if (sel.kind === 'chair') {
      const c = this.findChair(sel.id);
      if (!c) return;
      c.tone = tone;
      this.refreshMarkers();
      this.syncRing();
      this.onChange(false);
      return;
    }
    const p = this.findProp(sel.id);
    if (!p) return;
    p.tone = tone;
    this.onChange(true);
  }

  canWallColor() {
    const sel = this.selected;
    if (!sel?.face) return false;
    if (sel.kind !== 'wall' && sel.kind !== 'pillar') return false;
    return !!this.wallBox(sel.id);
  }

  wallBox(id: string): SolidDef | undefined {
    return this.findSolid(id) ?? perimeterSolids(this.def.map).find((s) => s.id === id);
  }

  paintedFaceColor(): string | undefined {
    const sel = this.selected;
    if (!sel?.face) return undefined;
    if (sel.id.startsWith('bound-')) return this.def.boundFaces?.[sel.id]?.[sel.face];
    return this.findSolid(sel.id)?.faces?.[sel.face];
  }

  wallItemColor(): string {
    const sel = this.selected;
    const own = this.paintedFaceColor();
    if (own) return own;
    const solid = sel ? this.findSolid(sel.id) : undefined;
    return solid?.color ?? this.def.atmosphere.wall.color;
  }

  applyWallColor(hex: string | null) {
    const sel = this.selected;
    if (!sel?.face || !this.canWallColor()) return;
    const face = sel.face;
    if (sel.id.startsWith('bound-')) {
      this.def.boundFaces ??= {};
      const cur = { ...(this.def.boundFaces[sel.id] ?? {}) };
      if (!hex) delete cur[face];
      else cur[face] = hex;
      if (Object.keys(cur).length) this.def.boundFaces[sel.id] = cur;
      else delete this.def.boundFaces[sel.id];
      this.onChange(true);
      return;
    }
    const solid = this.findSolid(sel.id);
    if (!solid) return;
    const cur = { ...(solid.faces ?? {}) };
    if (!hex) delete cur[face];
    else cur[face] = hex;
    solid.faces = Object.keys(cur).length ? cur : undefined;
    this.onChange(true);
  }

  canYaw() {
    const sel = this.selected;
    if (!sel) return false;
    if (sel.kind === 'desk' || sel.kind === 'chair') return true;
    return !!propSpec(sel.kind)?.rotatable;
  }

  getYaw(): number {
    const sel = this.selected;
    if (!sel) return this.lastYaw;
    if (sel.kind === 'desk') {
      const d = this.findDesk(sel.id);
      return d ? deskYaw(d) : this.lastYaw;
    }
    if (sel.kind === 'chair') {
      const c = this.findChair(sel.id);
      return c?.rotY ?? this.lastYaw;
    }
    const p = this.findProp(sel.id);
    return p?.rotY ?? this.lastYaw;
  }

  applyYaw(rad: number) {
    const sel = this.selected;
    if (!sel || !this.canYaw()) return;
    this.lastYaw = rad;
    if (sel.kind === 'desk') {
      const d = this.findDesk(sel.id);
      if (!d) return;
      d.rotY = rad;
      d.face = yawToFace(rad);
      this.lastDeskFace = d.face;
      this.onChange(true);
      return;
    }
    if (sel.kind === 'chair') {
      const c = this.findChair(sel.id);
      if (!c) return;
      c.rotY = rad;
      this.refreshMarkers();
      this.syncRing();
      this.onChange(false);
      return;
    }
    const p = this.findProp(sel.id);
    if (!p) return;
    p.rotY = rad;
    this.onChange(true);
  }

  private findSpawn(id: string): { list: SpawnDef[]; item: SpawnDef } | null {
    const item = this.def.chairSpawns.find((s) => s.id === id);
    if (item) return { list: this.def.chairSpawns, item };
    return null;
  }

  private nudgeSelected(dx: number, dz: number) {
    const sel = this.selected;
    if (!sel) return;
    if (sel.kind === 'player') {
      this.def.playerStart.x += dx;
      this.def.playerStart.z += dz;
    } else if (sel.kind === 'elevator') {
      this.def.elevator.minX += dx;
      this.def.elevator.maxX += dx;
      this.def.elevator.minZ += dz;
      this.def.elevator.maxZ += dz;
      this.def.elevator.point.x += dx;
      this.def.elevator.point.z += dz;
    } else if (sel.kind === 'wall' || sel.kind === 'wood' || sel.kind === 'pillar') {
      const s = this.findSolid(sel.id);
      if (!s) return;
      s.minX += dx; s.maxX += dx; s.minZ += dz; s.maxZ += dz;
    } else if (sel.kind === 'desk') {
      const d = this.findDesk(sel.id);
      if (!d) return;
      d.minX += dx; d.maxX += dx; d.minZ += dz; d.maxZ += dz;
    } else if (propSpec(sel.kind)) {
      const p = this.findProp(sel.id);
      if (!p) return;
      p.x += dx; p.z += dz;
    } else if (sel.kind === 'pointLight') {
      const l = this.findLight(sel.id);
      if (!l) return;
      l.x += dx;
      l.z += dz;
      this.applyLook();
    } else {
      const found = this.findSpawn(sel.id);
      if (!found) return;
      found.item.x += dx;
      found.item.z += dz;
    }
    this.refreshMarkers();
    this.syncRing();
  }

  deleteSelected() {
    const sel = this.selected;
    if (!sel) return;
    if (sel.kind === 'player' || sel.kind === 'elevator' || sel.id.startsWith('bound-')) return;
    this.def.walls = this.def.walls.filter((w) => w.id !== sel.id);
    this.def.desks = this.def.desks.filter((d) => d.id !== sel.id);
    this.def.props = this.def.props.filter((p) => p.id !== sel.id);
    this.def.chairSpawns = this.def.chairSpawns.filter((s) => s.id !== sel.id);
    this.def.pointLights = (this.def.pointLights ?? []).filter((l) => l.id !== sel.id);
    const skipRebuild = sel.kind === 'pointLight' || sel.kind === 'chair';
    this.selected = null;
    this.onSelect();
    if (skipRebuild) {
      if (sel.kind === 'pointLight') this.applyLook();
      this.refreshMarkers();
      this.syncRing();
      this.onChange(false);
      return;
    }
    this.onChange(true);
  }

  private refreshMarkers() {
    this.markers.clear();
    const add = (id: string, kind: EditKind, x: number, z: number, y: number, scale: number) => {
      const color = MARK[kind] ?? 0x88aadd;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.22 * scale, 10, 8),
        new THREE.MeshBasicMaterial({ color, depthTest: false })
      );
      mesh.position.set(x, y, z);
      mesh.renderOrder = 3;
      mesh.userData.editId = id;
      mesh.userData.editKind = kind;
      this.markers.add(mesh);
    };
    add('player', 'player', this.def.playerStart.x, this.def.playerStart.z, 0.35, 1.3);
    for (const s of this.def.chairSpawns) {
      const chair = addOfficeChair(this.markers, s.rotY ?? 0, s.style ?? 'task', resolveTone(s, this.def.atmosphere));
      chair.position.set(s.x, 0.5, s.z);
      chair.userData.editId = s.id;
      chair.userData.editKind = 'chair';
      chair.traverse((o) => {
        o.userData.editId = s.id;
        o.userData.editKind = 'chair';
      });
    }
    for (const l of this.def.pointLights ?? []) add(l.id, 'pointLight', l.x, l.z, 0.22, 0.95);
  }

  private syncRing() {
    const sel = this.selected;
    if (!sel) {
      this.ring.visible = false;
      this.faceMark.visible = false;
      return;
    }
    this.faceMark.visible = false;
    let minX = 0, maxX = 0, minZ = 0, maxZ = 0, h = 0.4, y = 0.2;
    if (sel.kind === 'player') {
      minX = this.def.playerStart.x - 0.4; maxX = this.def.playerStart.x + 0.4;
      minZ = this.def.playerStart.z - 0.4; maxZ = this.def.playerStart.z + 0.4;
    } else if (sel.kind === 'elevator') {
      minX = this.def.elevator.minX; maxX = this.def.elevator.maxX;
      minZ = this.def.elevator.minZ; maxZ = this.def.elevator.maxZ;
      h = 0.2;
    } else if (sel.kind === 'wall' || sel.kind === 'wood' || sel.kind === 'pillar') {
      const s = this.wallBox(sel.id);
      if (!s) { this.ring.visible = false; this.faceMark.visible = false; return; }
      minX = s.minX; maxX = s.maxX; minZ = s.minZ; maxZ = s.maxZ; h = s.h; y = s.h / 2;
    } else if (sel.kind === 'desk') {
      const d = this.findDesk(sel.id);
      if (!d) { this.ring.visible = false; return; }
      minX = d.minX; maxX = d.maxX; minZ = d.minZ; maxZ = d.maxZ; h = 0.8; y = 0.4;
    } else if (propSpec(sel.kind)) {
      const p = this.findProp(sel.id);
      if (!p) { this.ring.visible = false; return; }
      const spec = propSpec(sel.kind);
      const plantBox = sel.kind === 'plant' && p ? plantKitBounds(p.plantKit) : undefined;
      const r = plantBox
        ? Math.max(plantBox.hx, plantBox.hz) + 0.15
        : spec?.block
          ? Math.max(spec.block.hx, spec.block.hz) + 0.15
          : sel.kind === 'window'
            ? 1.2
            : 0.45;
      minX = p.x - r; maxX = p.x + r; minZ = p.z - r; maxZ = p.z + r;
      h = plantBox?.h ?? spec?.block?.h ?? (sel.kind === 'window' ? 1.2 : 1.2);
      y = h / 2;
    } else if (sel.kind === 'pointLight') {
      const l = this.findLight(sel.id);
      if (!l) { this.ring.visible = false; return; }
      minX = l.x - 0.45; maxX = l.x + 0.45;
      minZ = l.z - 0.45; maxZ = l.z + 0.45;
      h = 0.55;
      y = 0.45;
    } else {
      const found = this.findSpawn(sel.id);
      if (!found) { this.ring.visible = false; return; }
      minX = found.item.x - 0.35; maxX = found.item.x + 0.35;
      minZ = found.item.z - 0.35; maxZ = found.item.z + 0.35;
    }
    this.ring.scale.set(Math.max(0.2, maxX - minX), Math.max(0.1, h), Math.max(0.2, maxZ - minZ));
    this.ring.position.set((minX + maxX) / 2, y, (minZ + maxZ) / 2);
    this.ring.visible = true;
    this.placeFaceMark(sel.face, minX, maxX, minZ, maxZ, h);
  }

  private placeFaceMark(face: WallFace | undefined, minX: number, maxX: number, minZ: number, maxZ: number, h: number) {
    if (!face) {
      this.faceMark.visible = false;
      return;
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const y = h / 2;
    const e = 0.03;
    const w = Math.max(0.2, maxX - minX);
    const d = Math.max(0.2, maxZ - minZ);
    if (face === 'px') {
      this.faceMark.position.set(maxX + e, y, cz);
      this.faceMark.rotation.set(0, Math.PI / 2, 0);
      this.faceMark.scale.set(d, h, 1);
    } else if (face === 'nx') {
      this.faceMark.position.set(minX - e, y, cz);
      this.faceMark.rotation.set(0, -Math.PI / 2, 0);
      this.faceMark.scale.set(d, h, 1);
    } else if (face === 'pz') {
      this.faceMark.position.set(cx, y, maxZ + e);
      this.faceMark.rotation.set(0, 0, 0);
      this.faceMark.scale.set(w, h, 1);
    } else if (face === 'nz') {
      this.faceMark.position.set(cx, y, minZ - e);
      this.faceMark.rotation.set(0, Math.PI, 0);
      this.faceMark.scale.set(w, h, 1);
    } else if (face === 'py') {
      this.faceMark.position.set(cx, h + e, cz);
      this.faceMark.rotation.set(-Math.PI / 2, 0, 0);
      this.faceMark.scale.set(w, d, 1);
    } else {
      this.faceMark.position.set(cx, -e, cz);
      this.faceMark.rotation.set(Math.PI / 2, 0, 0);
      this.faceMark.scale.set(w, d, 1);
    }
    this.faceMark.visible = true;
  }

  private tick() {
    if (!this.def) return;
    const { playerStart } = this.def;
    if (this.cam === 'play') {
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(playerStart.x * 0.7, 17.5, playerStart.z + 6.5);
      this.camera.lookAt(playerStart.x * 0.7, 0, playerStart.z - 3);
    } else if (this.cam === 'top') {
      this.camera.position.set(this.target.x, this.radius * 1.15, this.target.z + 0.05);
      this.camera.up.set(0, 0, -1);
      this.camera.lookAt(this.target.x, 0, this.target.z);
    } else {
      this.camera.up.set(0, 1, 0);
      const sp = Math.sin(this.polar);
      this.camera.position.set(
        this.target.x + this.radius * sp * Math.sin(this.azimuth),
        this.target.y + this.radius * Math.cos(this.polar),
        this.target.z + this.radius * sp * Math.cos(this.azimuth)
      );
      this.camera.lookAt(this.target);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
