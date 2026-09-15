import * as THREE from 'three/webgpu';
import { Level } from '../../../src/game/level';
import { addLightsToScene, applyAtmosphere, createLights, type SceneLights } from '../../../src/game/atmosphere';
import { addOfficeChair } from '../../../src/game/look';
import { mergeHazardFx } from '../../../src/fx/catalog';
import {
  MAX_POINT_LIGHTS,
  applyElevatorMount,
  clampLightParams,
  patchFaceLook,
  deskYaw,
  ELEVATOR_PAD_ALONG,
  ELEVATOR_PAD_FAR,
  ELEVATOR_PAD_NEAR,
  isHazardKind,
  isWallMount,
  isWallSnap,
  mountSegsFor,
  mountSnapOpts,
  newId,
  normalizeHazardTune,
  perimeterSolids,
  plantKitBounds,
  propSpec,
  resolveItemColor,
  resolveTone,
  snapMountToWall,
  voidPolygon,
  voidShapeOf,
  wallFaceFromIndex,
  yawToFace,
  type ChairStyle,
  type DeskDef,
  type DeskFace,
  type DeskKit,
  type DeskTop,
  type FurnitureTone,
  type HazardKind,
  type HazardTune,
  type LevelDef,
  type PlantKit,
  type MapVoid,
  type PointLightDef,
  type PropKind,
  type SolidDef,
  type SolidKind,
  type SpawnDef,
  type VoidShape,
  type WallFace,
} from '../../../src/levels';

export type Tool =
  | 'select'
  | 'wall'
  | 'wood'
  | 'pillar'
  | 'desk'
  | 'void'
  | 'player'
  | 'chair'
  | 'pointLight'
  | 'elevator'
  | 'heavy'
  | 'interceptor'
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
  | 'heavy'
  | 'interceptor'
  | 'void'
  | 'floor';

export type MaskHandle = 'minX' | 'maxX' | 'minZ' | 'maxZ' | 'minXminZ' | 'maxXminZ' | 'minXmaxZ' | 'maxXmaxZ';

export interface Selection {
  id: string;
  kind: EditKind;
  /** 点到的墙面（只给这一面取色） */
  face?: WallFace;
  /** 黑色遮罩的边/角，用来拖长宽 */
  handle?: MaskHandle;
}

const SNAP = 0.5;
const MIN_MASK = 0.5;
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const MASK_OVERLAY = new THREE.MeshBasicMaterial({
  color: 0x14161c,
  transparent: true,
  opacity: 0.42,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const MASK_OVERLAY_SEL = new THREE.MeshBasicMaterial({
  color: 0x2a3344,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  side: THREE.DoubleSide,
});

function xzShapeGeometry(poly: { x: number; z: number }[]) {
  const p0 = poly[0];
  if (!p0 || poly.length < 3) return new THREE.BufferGeometry();
  const s = new THREE.Shape();
  s.moveTo(p0.x, p0.z);
  for (let i = 1; i < poly.length; i++) s.lineTo(poly[i]!.x, poly[i]!.z);
  s.closePath();
  const src = new THREE.ShapeGeometry(s);
  const pos = src.attributes.position;
  if (!pos) {
    src.dispose();
    return new THREE.BufferGeometry();
  }
  const arr = new Float32Array(pos.count * 3);
  const nrm = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    arr[i * 3] = pos.getX(i);
    arr[i * 3 + 1] = 0;
    arr[i * 3 + 2] = pos.getY(i);
    nrm[i * 3 + 1] = 1;
  }
  const geo = new THREE.BufferGeometry();
  const idx = src.getIndex();
  if (idx) geo.setIndex(idx.clone());
  geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  src.dispose();
  return geo;
}

const MASK_HANDLE_MAT = new THREE.MeshBasicMaterial({
  color: 0x7ec8ff,
  depthTest: true,
  depthWrite: false,
  fog: false,
});
const MASK_EDGE = 0.5;

function maskHandleAt(x: number, z: number, v: MapVoid): MaskHandle | undefined {
  const w = v.maxX - v.minX;
  const d = v.maxZ - v.minZ;
  const pad = Math.min(MASK_EDGE, Math.max(0.22, 0.2 * Math.min(w, d)));
  const onMinX = Math.abs(x - v.minX) <= pad && z >= v.minZ - pad && z <= v.maxZ + pad;
  const onMaxX = Math.abs(x - v.maxX) <= pad && z >= v.minZ - pad && z <= v.maxZ + pad;
  const onMinZ = Math.abs(z - v.minZ) <= pad && x >= v.minX - pad && x <= v.maxX + pad;
  const onMaxZ = Math.abs(z - v.maxZ) <= pad && x >= v.minX - pad && x <= v.maxX + pad;
  if (onMinX && onMinZ) return 'minXminZ';
  if (onMaxX && onMinZ) return 'maxXminZ';
  if (onMinX && onMaxZ) return 'minXmaxZ';
  if (onMaxX && onMaxZ) return 'maxXmaxZ';
  if (onMinX) return 'minX';
  if (onMaxX) return 'maxX';
  if (onMinZ) return 'minZ';
  if (onMaxZ) return 'maxZ';
  return undefined;
}

function cursorForHandle(handle?: MaskHandle) {
  if (!handle) return 'move';
  if (handle === 'minX' || handle === 'maxX') return 'ew-resize';
  if (handle === 'minZ' || handle === 'maxZ') return 'ns-resize';
  if (handle === 'minXminZ' || handle === 'maxXmaxZ') return 'nwse-resize';
  return 'nesw-resize';
}

function snap(v: number, step = SNAP) {
  return Math.round(v / step) * step;
}

function hitEdit(obj: THREE.Object3D | null): Selection | null {
  let o: THREE.Object3D | null = obj;
  while (o) {
    if (o.userData.editId && o.userData.editKind && o.userData.editKind !== 'floor') {
      return {
        id: o.userData.editId,
        kind: o.userData.editKind,
        handle: o.userData.maskHandle as MaskHandle | undefined,
      };
    }
    o = o.parent;
  }
  return null;
}

const MARK: Record<string, number> = {
  player: 0x7ef0a0,
  chair: 0xb88958,
  pointLight: 0xffe08a,
  heavy: 0x37415c,
  interceptor: 0xe05252,
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
  lastColor?: string;
  lastPlantKit: PlantKit = 'trio';
  lastVoidShape: VoidShape = 'rect';
  lastYaw = 0;
  lastHazard: Partial<Record<HazardKind, HazardTune>> = {};
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
  private masks = new THREE.Group();
  private ghost = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x6ea8ff, transparent: true, opacity: 0.35, depthWrite: false })
  );
  private maskGhost = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: 0x14161c, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide })
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
  private dragHandle: MaskHandle | null = null;
  private dragStartVoid: MapVoid | null = null;
  private topFill = new THREE.AmbientLight(0xffffff, 0);

  async init(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGPURenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    await this.renderer.init();
    host.appendChild(this.renderer.domElement);
    this.ghost.visible = false;
    this.maskGhost.visible = false;
    this.maskGhost.renderOrder = 2;
    this.ring.visible = false;
    this.faceMark.visible = false;
    this.faceMark.renderOrder = 4;
    this.scene.add(this.ghost, this.maskGhost, this.ring, this.faceMark, this.markers, this.masks, this.topFill);

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
    this.refreshMasks();
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
    objs.push(this.masks, this.markers);
    const hits = this.ray.intersectObjects(objs, true);
    let voidHit: Selection | null = null;
    let voidDist = Infinity;
    for (const h of hits) {
      const sel = hitEdit(h.object);
      if (!sel) continue;
      if (sel.kind === 'void') {
        if (!voidHit) {
          const v = this.findVoid(sel.id);
          voidHit = { id: sel.id, kind: 'void', handle: v ? maskHandleAt(h.point.x, h.point.z, v) : sel.handle };
          voidDist = h.distance;
        }
        continue;
      }
      if (voidHit && h.distance > voidDist + 0.45) return voidHit;
      if (sel.kind === 'wall' || sel.kind === 'pillar') {
        const tagged = h.object.userData.editFace as WallFace | undefined;
        if (tagged) return { ...sel, face: tagged };
        if (h.faceIndex != null) return { ...sel, face: wallFaceFromIndex(h.faceIndex) };
      }
      return sel;
    }
    return voidHit;
  }

  private setCursor(value: string) {
    this.renderer.domElement.style.cursor = value;
  }

  private syncHoverCursor(ev: PointerEvent) {
    if (this.orbiting || this.panning) {
      this.setCursor(this.panning ? 'grab' : '');
      return;
    }
    if (this.tool === 'void') {
      this.setCursor('crosshair');
      return;
    }
    if (this.tool !== 'select') {
      this.setCursor('');
      return;
    }
    if (this.dragHandle) {
      this.setCursor(cursorForHandle(this.dragHandle));
      return;
    }
    const hit = this.pick(ev);
    if (hit?.kind === 'void') {
      this.setCursor(cursorForHandle(hit.handle));
      return;
    }
    this.setCursor('');
  }

  private bind() {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (ev) => this.onDown(ev));
    el.addEventListener('pointermove', (ev) => this.onMove(ev));
    el.addEventListener('pointerup', (ev) => this.onUp(ev));
    el.addEventListener('pointerleave', (ev) => {
      this.onUp(ev);
      this.setCursor('');
    });
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
      this.dragHandle = hit?.kind === 'void' ? hit.handle ?? null : null;
      const start = hit?.kind === 'void' ? this.findVoid(hit.id) : undefined;
      this.dragStartVoid = start ? { ...start } : null;
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
    this.syncHoverCursor(ev);

    if (!this.dragging) {
      if (this.tool !== 'void') this.maskGhost.visible = false;
      if (g && isWallSnap(this.tool)) {
        const m = this.wallMountAt(snap(g.x), snap(g.z), this.tool);
        const w = this.tool === 'window' ? 2.4 : this.tool === 'launch' ? 1.16 : this.tool === 'elevator' ? 3.16 : 1.32;
        const h = this.tool === 'window' ? 1.05 : this.tool === 'launch' ? 1.65 : this.tool === 'elevator' ? 2.5 : 0.78;
        const y = this.tool === 'window' ? 1.15 : this.tool === 'launch' ? 0.82 : this.tool === 'elevator' ? 1.25 : 1.38;
        const d = this.tool === 'window' ? 0.08 : this.tool === 'launch' ? 0.14 : this.tool === 'elevator' ? 0.22 : 0.1;
        this.ghost.visible = true;
        this.ghost.rotation.y = m.rotY;
        this.ghost.position.set(m.x, y, m.z);
        this.ghost.scale.set(w, h, d);
      } else if (g && this.tool === 'plant') {
        this.ghost.rotation.y = 0;
        const box = plantKitBounds(this.lastPlantKit);
        this.ghost.visible = true;
        this.ghost.position.set(snap(g.x), box.h / 2, snap(g.z));
        this.ghost.scale.set(box.hx * 2, box.h, box.hz * 2);
      } else if (g && this.tool === 'table') {
        this.ghost.rotation.y = this.lastYaw;
        this.ghost.visible = true;
        this.ghost.position.set(snap(g.x), 0.38, snap(g.z));
        this.ghost.scale.set(2.36, 0.76, 1.24);
      } else if (g && (this.tool === 'wall' || this.tool === 'desk' || this.tool === 'wood' || this.tool === 'pillar' || this.tool === 'void')) {
        this.ghost.rotation.y = this.tool === 'desk' ? this.lastYaw : 0;
        if (this.tool === 'void') {
          const x = snap(g.x);
          const z = snap(g.z);
          this.paintVoidGhost(x - 1, z - 1, x + 1, z + 1);
        } else {
          this.maskGhost.visible = false;
          this.ghost.visible = true;
          const mat = this.ghost.material as THREE.MeshBasicMaterial;
          mat.color.setHex(0x6ea8ff);
          this.ghost.position.set(snap(g.x), 0.85, snap(g.z));
          this.ghost.scale.set(this.tool === 'desk' ? 4 : 2, 1.7, this.tool === 'desk' ? 1.6 : 0.5);
        }
      } else if (g && isHazardKind(this.tool)) {
        this.ghost.rotation.y = 0;
        this.ghost.visible = true;
        const spec = propSpec(this.tool);
        const r = mergeHazardFx(this.tool, this.lastHazard[this.tool]).radius;
        if (spec?.block) {
          this.ghost.position.set(snap(g.x), spec.block.h / 2, snap(g.z));
          this.ghost.scale.set(spec.block.hx * 2, spec.block.h, spec.block.hz * 2);
        } else {
          this.ghost.position.set(snap(g.x), 0.04, snap(g.z));
          this.ghost.scale.set(r * 2, 0.08, r * 2);
        }
      } else if (!this.drawing) {
        this.ghost.visible = false;
        this.maskGhost.visible = false;
      }
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
    if (this.tool === 'select' && this.selected?.kind === 'void' && this.dragHandle && this.dragStartVoid && g && this.moved) {
      this.resizeMask(this.selected.id, this.dragHandle, this.dragStartVoid, snap(g.x), snap(g.z));
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
      this.maskGhost.visible = false;
      const g = this.groundAt(ev);
      if (g && this.moved) this.commitRect(this.drawStart.x, this.drawStart.z, snap(g.x), snap(g.z));
    }
    if (this.tool === 'select' && this.selected && this.moved && !wasOrbit) {
      this.onChange(this.selected.kind !== 'pointLight' && this.selected.kind !== 'chair');
    }
    this.dragHandle = null;
    this.dragStartVoid = null;
  }

  private isPointTool() {
    if (this.tool === 'player' || this.tool === 'chair' || this.tool === 'pointLight' || this.tool === 'elevator') return true;
    if (this.tool === 'heavy' || this.tool === 'interceptor') return true;
    return !!propSpec(this.tool);
  }

  private updateGhostRect(x0: number, z0: number, x1: number, z1: number) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minZ = Math.min(z0, z1);
    const maxZ = Math.max(z0, z1);
    const h = this.tool === 'void' ? 0.08 : this.tool === 'desk' ? 0.78 : this.tool === 'wood' ? 1 : 1.7;
    const mat = this.ghost.material as THREE.MeshBasicMaterial;
    mat.color.setHex(this.tool === 'void' ? 0x0a0a0a : 0x6ea8ff);
    this.ghost.rotation.y = 0;
    if (this.tool === 'void') {
      this.paintVoidGhost(minX, minZ, maxX, maxZ);
      return;
    }
    this.maskGhost.visible = false;
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
    if (this.tool === 'void') {
      this.def.voids ??= [];
      const v: MapVoid = {
        id: newId('cut'),
        minX,
        minZ,
        maxX,
        maxZ,
        shape: this.lastVoidShape,
        ...(this.lastVoidShape !== 'rect' ? { rotY: this.lastYaw } : {}),
      };
      this.def.voids.push(v);
      this.selected = { id: v.id, kind: 'void' };
    } else if (this.tool === 'desk') {
      const d: DeskDef = {
        id: newId('desk'),
        minX, minZ, maxX, maxZ,
        top: this.lastDeskTop,
        kit: this.lastDeskKit,
        face: yawToFace(this.lastYaw),
        rotY: this.lastYaw,
        tone: this.lastTone,
        ...this.colorStamp(),
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

  private wallMountAt(x: number, z: number, kind: string) {
    const { pad, inset } = mountSnapOpts(kind);
    return snapMountToWall(x, z, mountSegsFor(kind, this.def.map, this.def.walls, this.def.voids), inset, pad);
  }

  private placeElevator(x: number, z: number) {
    const { pad, inset } = mountSnapOpts('elevator');
    applyElevatorMount(
      this.def.elevator,
      x,
      z,
      mountSegsFor('elevator', this.def.map, this.def.walls, this.def.voids),
      inset,
      pad
    );
    this.selected = { id: 'elevator', kind: 'elevator' };
  }

  private placePoint(x: number, z: number) {
    const sx = snap(x);
    const sz = snap(z);
    if (this.tool === 'player') {
      this.def.playerStart = { x: sx, z: sz };
      this.selected = { id: 'player', kind: 'player' };
    } else if (this.tool === 'elevator') {
      this.placeElevator(sx, sz);
    } else if (isWallMount(this.tool)) {
      const kind = this.tool as PropKind;
      const m = this.wallMountAt(sx, sz, kind);
      const p = {
        id: newId(kind === 'window' ? 'win' : kind === 'launch' ? 'door' : 'tv'),
        kind,
        x: m.x,
        z: m.z,
        y: kind === 'window' ? 1.15 : kind === 'tv' ? 1.38 : undefined,
        rotY: m.rotY,
        ...(kind === 'window' ? { w: 2.4, h: 1.05 } : {}),
        ...(kind === 'tv' ? { tone: this.lastTone, ...this.colorStamp() } : {}),
        ...(kind === 'launch' && this.lastHazard.launch ? { hazard: { ...this.lastHazard.launch } } : {}),
      };
      this.lastYaw = m.rotY;
      this.def.props.push(p);
      this.selected = { id: p.id, kind };
    } else if (propSpec(this.tool) && this.tool !== 'ceilingLight') {
      const kind = this.tool as PropKind;
      const p = {
        id: newId(kind),
        kind,
        x: sx,
        z: sz,
        rotY: this.lastYaw,
        tone: this.lastTone,
        ...this.colorStamp(),
        ...(kind === 'plant' ? { plantKit: this.lastPlantKit } : {}),
        ...(isHazardKind(kind) && this.lastHazard[kind] ? { hazard: { ...this.lastHazard[kind] } } : {}),
      };
      this.def.props.push(p);
      this.selected = { id: p.id, kind };
    } else if (this.tool === 'heavy' || this.tool === 'interceptor') {
      this.def.heavyAnchors ??= [];
      this.def.interceptorSpawns ??= [];
      const list = this.tool === 'heavy' ? this.def.heavyAnchors : this.def.interceptorSpawns;
      const s: SpawnDef = { id: newId(this.tool === 'heavy' ? 'hv' : 'ic'), x: sx, z: sz };
      list.push(s);
      this.selected = { id: s.id, kind: this.tool };
      this.refreshMarkers();
      this.syncRing();
      this.onSelect();
      this.onChange(false);
      return;
    } else if (this.tool === 'chair') {
      const s: SpawnDef = { id: newId('chair'), x: sx, z: sz, style: this.lastChairStyle, rotY: this.lastYaw, tone: this.lastTone, ...this.colorStamp() };
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

  findVoid(id: string) {
    return this.def.voids?.find((v) => v.id === id);
  }

  private paintVoidGhost(minX: number, minZ: number, maxX: number, maxZ: number) {
    const v: MapVoid = {
      id: 'ghost',
      minX,
      minZ,
      maxX,
      maxZ,
      shape: this.lastVoidShape,
      ...(this.lastVoidShape !== 'rect' ? { rotY: this.lastYaw } : {}),
    };
    this.maskGhost.geometry.dispose();
    this.maskGhost.geometry = xzShapeGeometry(voidPolygon(v));
    this.maskGhost.position.y = 0.04;
    this.maskGhost.visible = true;
    this.ghost.visible = false;
  }

  applyVoidShape(shape: VoidShape) {
    const next = shape === 'circle' || shape === 'tri' ? shape : 'rect';
    this.lastVoidShape = next;
    const sel = this.selected;
    if (sel?.kind === 'void') {
      const v = this.findVoid(sel.id);
      if (v) {
        v.shape = next === 'rect' ? undefined : next;
        if (next === 'rect') delete v.rotY;
        else v.rotY = v.rotY ?? this.lastYaw;
        this.onChange(true);
      }
    }
    this.refreshMasks();
    this.syncRing();
    this.onSelect();
  }

  applyMaskSize(w: number, d: number) {
    const sel = this.selected;
    if (!sel || sel.kind !== 'void') return;
    const v = this.findVoid(sel.id);
    if (!v) return;
    const cx = (v.minX + v.maxX) / 2;
    const cz = (v.minZ + v.maxZ) / 2;
    const hw = Math.max(MIN_MASK, w) / 2;
    const hd = Math.max(MIN_MASK, d) / 2;
    v.minX = snap(cx - hw);
    v.maxX = snap(cx + hw);
    v.minZ = snap(cz - hd);
    v.maxZ = snap(cz + hd);
    if (v.maxX - v.minX < MIN_MASK) v.maxX = v.minX + MIN_MASK;
    if (v.maxZ - v.minZ < MIN_MASK) v.maxZ = v.minZ + MIN_MASK;
    this.refreshMasks();
    this.syncRing();
    this.onChange(true);
  }

  private resizeMask(id: string, handle: MaskHandle, start: MapVoid, x: number, z: number) {
    const v = this.findVoid(id);
    if (!v) return;
    let { minX, maxX, minZ, maxZ } = start;
    if (handle === 'minX' || handle === 'minXminZ' || handle === 'minXmaxZ') minX = x;
    if (handle === 'maxX' || handle === 'maxXminZ' || handle === 'maxXmaxZ') maxX = x;
    if (handle === 'minZ' || handle === 'minXminZ' || handle === 'maxXminZ') minZ = z;
    if (handle === 'maxZ' || handle === 'minXmaxZ' || handle === 'maxXmaxZ') maxZ = z;
    if (maxX - minX < MIN_MASK) {
      if (handle.includes('minX')) minX = maxX - MIN_MASK;
      else maxX = minX + MIN_MASK;
    }
    if (maxZ - minZ < MIN_MASK) {
      if (handle.includes('minZ')) minZ = maxZ - MIN_MASK;
      else maxZ = minZ + MIN_MASK;
    }
    v.minX = minX;
    v.maxX = maxX;
    v.minZ = minZ;
    v.maxZ = maxZ;
    this.refreshMasks();
    this.syncRing();
    this.onSelect();
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

  applyHazard(patch: HazardTune) {
    const sel = this.selected;
    if (!sel || !isHazardKind(sel.kind)) return;
    const p = this.findProp(sel.id);
    if (!p) return;
    const next = normalizeHazardTune({ ...p.hazard, ...patch });
    if (next) p.hazard = next;
    else delete p.hazard;
    this.lastHazard[sel.kind] = { ...(p.hazard ?? {}) };
    this.onChange(true);
  }

  canTone() {
    const sel = this.selected;
    if (!sel) return false;
    if (sel.kind === 'desk' || sel.kind === 'chair') return true;
    const spec = propSpec(sel.kind);
    return !!spec && sel.kind !== 'window' && spec.move !== 'hazard';
  }

  itemTone(): FurnitureTone {
    const sel = this.selected;
    if (!sel) return resolveTone(undefined, this.def.atmosphere);
    if (sel.kind === 'desk') return resolveTone(this.findDesk(sel.id), this.def.atmosphere);
    if (sel.kind === 'chair') return resolveTone(this.findChair(sel.id), this.def.atmosphere);
    return resolveTone(this.findProp(sel.id), this.def.atmosphere);
  }

  itemColor(): string | undefined {
    const sel = this.selected;
    if (!sel || !this.canTone()) return undefined;
    if (sel.kind === 'desk') return resolveItemColor(this.findDesk(sel.id));
    if (sel.kind === 'chair') return resolveItemColor(this.findChair(sel.id));
    return resolveItemColor(this.findProp(sel.id));
  }

  itemColorSwatch(): string {
    return this.itemColor() ?? this.lastColor ?? (this.itemTone() === 'light' ? '#e4ddd4' : '#3d6a8a');
  }

  private colorStamp(): { color?: string } {
    return this.lastColor ? { color: this.lastColor } : {};
  }

  private paintItem(patch: { tone?: FurnitureTone; color?: string | null }) {
    const sel = this.selected;
    if (!sel || !this.canTone()) return;
    const apply = (item: { tone?: FurnitureTone; color?: string }) => {
      if (patch.tone) item.tone = patch.tone;
      if (patch.color === null) delete item.color;
      else if (patch.color) item.color = patch.color;
    };
    if (sel.kind === 'desk') {
      const d = this.findDesk(sel.id);
      if (!d) return;
      apply(d);
      this.onChange(true);
      return;
    }
    if (sel.kind === 'chair') {
      const c = this.findChair(sel.id);
      if (!c) return;
      apply(c);
      this.refreshMarkers();
      this.syncRing();
      this.onChange(false);
      return;
    }
    const p = this.findProp(sel.id);
    if (!p) return;
    apply(p);
    this.onChange(true);
  }

  applyTone(tone: FurnitureTone) {
    this.lastTone = tone;
    this.lastColor = undefined;
    this.paintItem({ tone, color: null });
  }

  applyColor(hex: string) {
    const color = resolveItemColor({ color: hex });
    if (!color) return;
    this.lastColor = color;
    this.paintItem({ color });
  }

  canWallColor() {
    const sel = this.selected;
    if (!sel?.face) return false;
    if (sel.kind !== 'wall' && sel.kind !== 'pillar') return false;
    return !!this.wallBox(sel.id);
  }

  wallBox(id: string): SolidDef | undefined {
    return this.findSolid(id) ?? perimeterSolids(this.def.map, this.def.voids).find((s) => s.id === id);
  }

  private faceLooksOf(id: string) {
    if (id.startsWith('bound-')) return this.def.boundFaces?.[id];
    return this.findSolid(id)?.faces;
  }

  paintedFaceColor(): string | undefined {
    const sel = this.selected;
    if (!sel?.face) return undefined;
    return this.faceLooksOf(sel.id)?.[sel.face]?.color;
  }

  paintedFaceMap(): string | undefined {
    const sel = this.selected;
    if (!sel?.face) return undefined;
    return this.faceLooksOf(sel.id)?.[sel.face]?.map ?? undefined;
  }

  wallItemColor(): string {
    const sel = this.selected;
    const own = this.paintedFaceColor();
    if (own) return own;
    const solid = sel ? this.findSolid(sel.id) : undefined;
    return solid?.color ?? this.def.atmosphere.wall.color;
  }

  private writeFaceLook(patch: { color?: string | null; map?: string | null }) {
    const sel = this.selected;
    if (!sel?.face || !this.canWallColor()) return;
    const face = sel.face;
    if (sel.id.startsWith('bound-')) {
      this.def.boundFaces ??= {};
      const next = patchFaceLook({ ...(this.def.boundFaces[sel.id] ?? {}) }, face, patch);
      if (next) this.def.boundFaces[sel.id] = next;
      else delete this.def.boundFaces[sel.id];
      this.onChange(true);
      return;
    }
    const solid = this.findSolid(sel.id);
    if (!solid) return;
    solid.faces = patchFaceLook({ ...(solid.faces ?? {}) }, face, patch);
    this.onChange(true);
  }

  applyWallColor(hex: string | null) {
    this.writeFaceLook({ color: hex });
  }

  applyWallMap(file: string | null) {
    this.writeFaceLook({ map: file });
  }

  canYaw() {
    const sel = this.selected;
    if (!sel) return false;
    if (isWallSnap(sel.kind)) return false;
    if (sel.kind === 'void') {
      const v = this.findVoid(sel.id);
      return !!v && voidShapeOf(v) !== 'rect';
    }
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
    if (sel.kind === 'void') {
      const v = this.findVoid(sel.id);
      return v?.rotY ?? this.lastYaw;
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
    if (sel.kind === 'void') {
      const v = this.findVoid(sel.id);
      if (!v || voidShapeOf(v) === 'rect') return;
      v.rotY = rad;
      this.onChange(true);
      return;
    }
    const p = this.findProp(sel.id);
    if (!p) return;
    p.rotY = rad;
    this.onChange(true);
  }

  private findSpawn(id: string): { list: SpawnDef[]; item: SpawnDef; kind: EditKind } | null {
    const chair = this.def.chairSpawns.find((s) => s.id === id);
    if (chair) return { list: this.def.chairSpawns, item: chair, kind: 'chair' };
    const hv = this.def.heavyAnchors.find((s) => s.id === id);
    if (hv) return { list: this.def.heavyAnchors, item: hv, kind: 'heavy' };
    const ic = this.def.interceptorSpawns.find((s) => s.id === id);
    if (ic) return { list: this.def.interceptorSpawns, item: ic, kind: 'interceptor' };
    return null;
  }

  private nudgeSelected(dx: number, dz: number) {
    const sel = this.selected;
    if (!sel) return;
    if (sel.kind === 'player') {
      this.def.playerStart.x += dx;
      this.def.playerStart.z += dz;
    } else if (sel.kind === 'elevator') {
      this.placeElevator(this.def.elevator.point.x + dx, this.def.elevator.point.z + dz);
    } else if (sel.kind === 'wall' || sel.kind === 'wood' || sel.kind === 'pillar') {
      const s = this.findSolid(sel.id);
      if (!s) return;
      s.minX += dx; s.maxX += dx; s.minZ += dz; s.maxZ += dz;
    } else if (sel.kind === 'desk') {
      const d = this.findDesk(sel.id);
      if (!d) return;
      d.minX += dx; d.maxX += dx; d.minZ += dz; d.maxZ += dz;
    } else if (sel.kind === 'void') {
      const v = this.findVoid(sel.id);
      if (!v) return;
      v.minX += dx; v.maxX += dx; v.minZ += dz; v.maxZ += dz;
    } else if (propSpec(sel.kind)) {
      const p = this.findProp(sel.id);
      if (!p) return;
      p.x += dx; p.z += dz;
      if (isWallMount(p.kind)) {
        const m = this.wallMountAt(p.x, p.z, p.kind);
        p.x = m.x;
        p.z = m.z;
        p.rotY = m.rotY;
        this.lastYaw = m.rotY;
      }
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
    this.refreshMasks();
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
    this.def.heavyAnchors = this.def.heavyAnchors.filter((s) => s.id !== sel.id);
    this.def.interceptorSpawns = this.def.interceptorSpawns.filter((s) => s.id !== sel.id);
    this.def.voids = (this.def.voids ?? []).filter((v) => v.id !== sel.id);
    this.def.pointLights = (this.def.pointLights ?? []).filter((l) => l.id !== sel.id);
    const skipRebuild = sel.kind === 'pointLight' || sel.kind === 'chair' || sel.kind === 'heavy' || sel.kind === 'interceptor';
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
      const chair = addOfficeChair(this.markers, s.rotY ?? 0, s.style ?? 'task', resolveTone(s, this.def.atmosphere), s.color);
      chair.position.set(s.x, 0.5, s.z);
      chair.userData.editId = s.id;
      chair.userData.editKind = 'chair';
      chair.traverse((o) => {
        o.userData.editId = s.id;
        o.userData.editKind = 'chair';
      });
    }
    for (const l of this.def.pointLights ?? []) add(l.id, 'pointLight', l.x, l.z, 0.22, 0.95);
    for (const s of this.def.heavyAnchors ?? []) add(s.id, 'heavy', s.x, s.z, 0.55, 1.45);
    for (const s of this.def.interceptorSpawns ?? []) add(s.id, 'interceptor', s.x, s.z, 0.55, 1.25);
  }

  private refreshMasks() {
    this.masks.clear();
    if (!this.def) return;
    const selectedId = this.selected?.kind === 'void' ? this.selected.id : undefined;
    for (const v of this.def.voids ?? []) {
      const overlay = new THREE.Mesh(
        xzShapeGeometry(voidPolygon(v)),
        selectedId === v.id ? MASK_OVERLAY_SEL : MASK_OVERLAY
      );
      overlay.position.y = 0.02;
      overlay.renderOrder = 2;
      overlay.userData.editId = v.id;
      overlay.userData.editKind = 'void';
      this.masks.add(overlay);
    }
    const sel = selectedId ? this.findVoid(selectedId) : undefined;
    if (!sel) return;
    const w = Math.max(0.2, sel.maxX - sel.minX);
    const d = Math.max(0.2, sel.maxZ - sel.minZ);
    const t = 0.22;
    const y = 0.03;
    const cx = (sel.minX + sel.maxX) / 2;
    const cz = (sel.minZ + sel.maxZ) / 2;
    const addHandle = (handle: MaskHandle, x: number, z: number, sx: number, sz: number) => {
      const box = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.05, sz), MASK_HANDLE_MAT);
      box.position.set(x, y, z);
      box.userData.editId = sel.id;
      box.userData.editKind = 'void';
      box.userData.maskHandle = handle;
      this.masks.add(box);
    };
    addHandle('minX', sel.minX, cz, t, Math.max(0.4, d - t * 2));
    addHandle('maxX', sel.maxX, cz, t, Math.max(0.4, d - t * 2));
    addHandle('minZ', cx, sel.minZ, Math.max(0.4, w - t * 2), t);
    addHandle('maxZ', cx, sel.maxZ, Math.max(0.4, w - t * 2), t);
    addHandle('minXminZ', sel.minX, sel.minZ, t * 1.4, t * 1.4);
    addHandle('maxXminZ', sel.maxX, sel.minZ, t * 1.4, t * 1.4);
    addHandle('minXmaxZ', sel.minX, sel.maxZ, t * 1.4, t * 1.4);
    addHandle('maxXmaxZ', sel.maxX, sel.maxZ, t * 1.4, t * 1.4);
  }

  private syncRing() {
    this.refreshMasks();
    const sel = this.selected;
    if (!sel) {
      this.ring.visible = false;
      this.faceMark.visible = false;
      return;
    }
    this.ring.rotation.y = 0;
    this.faceMark.visible = false;
    if (sel.kind === 'elevator') {
      const e = this.def.elevator;
      const yaw = e.rotY ?? 0;
      const mid = (ELEVATOR_PAD_NEAR + ELEVATOR_PAD_FAR) / 2;
      this.ring.rotation.y = yaw;
      this.ring.scale.set(ELEVATOR_PAD_ALONG * 2, 0.2, ELEVATOR_PAD_FAR - ELEVATOR_PAD_NEAR);
      this.ring.position.set(e.point.x + Math.sin(yaw) * mid, 0.1, e.point.z + Math.cos(yaw) * mid);
      this.ring.visible = true;
      return;
    }
    let minX = 0, maxX = 0, minZ = 0, maxZ = 0, h = 0.4, y = 0.2;
    if (sel.kind === 'player') {
      minX = this.def.playerStart.x - 0.4; maxX = this.def.playerStart.x + 0.4;
      minZ = this.def.playerStart.z - 0.4; maxZ = this.def.playerStart.z + 0.4;
    } else if (sel.kind === 'wall' || sel.kind === 'wood' || sel.kind === 'pillar') {
      const s = this.wallBox(sel.id);
      if (!s) { this.ring.visible = false; this.faceMark.visible = false; return; }
      minX = s.minX; maxX = s.maxX; minZ = s.minZ; maxZ = s.maxZ; h = s.h; y = s.h / 2;
    } else if (sel.kind === 'desk') {
      const d = this.findDesk(sel.id);
      if (!d) { this.ring.visible = false; return; }
      minX = d.minX; maxX = d.maxX; minZ = d.minZ; maxZ = d.maxZ; h = 0.8; y = 0.4;
      this.ring.rotation.y = deskYaw(d);
    } else if (sel.kind === 'void') {
      const v = this.findVoid(sel.id);
      if (!v) { this.ring.visible = false; return; }
      minX = v.minX; maxX = v.maxX; minZ = v.minZ; maxZ = v.maxZ; h = 0.16; y = 0.08;
    } else if (propSpec(sel.kind)) {
      const p = this.findProp(sel.id);
      if (!p) { this.ring.visible = false; return; }
      const spec = propSpec(sel.kind);
      const plantBox = sel.kind === 'plant' && p ? plantKitBounds(p.plantKit) : undefined;
      const r = plantBox
        ? Math.max(plantBox.hx, plantBox.hz) + 0.15
        : spec?.block
          ? Math.max(spec.block.hx, spec.block.hz) + 0.15
          : sel.kind === 'window' || sel.kind === 'tv'
            ? 1.2
            : sel.kind === 'launch'
              ? 0.72
            : 0.45;
      minX = p.x - r; maxX = p.x + r; minZ = p.z - r; maxZ = p.z + r;
      h = plantBox?.h ?? spec?.block?.h ?? (sel.kind === 'window' || sel.kind === 'tv' ? 1.2 : sel.kind === 'launch' ? 1.65 : 1.2);
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
    const fog = this.scene.fog;
    if (this.cam === 'top') {
      this.scene.fog = null;
      this.topFill.intensity = 1.35;
    } else {
      this.topFill.intensity = 0;
    }
    this.renderer.render(this.scene, this.camera);
    if (this.cam === 'top') this.scene.fog = fog;
  }
}
