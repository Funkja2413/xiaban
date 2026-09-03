import * as THREE from 'three/webgpu';

/** 程序贴图 + Phong：手机端一份材质吃所有实例，不跑 GI。 */
function seed(n: number) {
  return () => {
    n = (n + 0x6d2b79f5) | 0;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!, w, h);
  return c;
}

function toTex(
  c: HTMLCanvasElement,
  opts: { repeat?: number; color?: boolean; wrap?: boolean; bump?: boolean } = {}
) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = opts.wrap === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = opts.bump ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat) tex.repeat.set(opts.repeat, opts.repeat);
  tex.needsUpdate = true;
  return tex;
}

/** 衬衫：领口 + 口袋 + 扣，底色发白好让 instanceColor 染色 */
export function makeShirtTex() {
  return toTex(
    canvas(64, 64, (ctx, w, h) => {
      ctx.fillStyle = '#e8edf3';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#c5ced8';
      ctx.fillRect(0, 0, w, 10);
      ctx.fillStyle = '#d4dbe3';
      ctx.fillRect(26, 14, 12, 22);
      ctx.strokeStyle = '#9aa7b5';
      ctx.lineWidth = 1;
      ctx.strokeRect(26.5, 14.5, 11, 21);
      ctx.fillStyle = '#8b97a6';
      for (let y = 16; y < 56; y += 10) {
        ctx.beginPath();
        ctx.arc(32, y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(0, h - 8, w, 8);
    })
  );
}

export function makeSkinTex() {
  const rnd = seed(11);
  return toTex(
    canvas(64, 64, (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (rnd() - 0.5) * 14;
        img.data[i] = 232 + n;
        img.data[i + 1] = 186 + n * 0.7;
        img.data[i + 2] = 150 + n * 0.5;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      ctx.fillStyle = 'rgba(210,90,90,0.12)';
      ctx.beginPath();
      ctx.ellipse(20, 40, 8, 6, 0, 0, Math.PI * 2);
      ctx.ellipse(44, 40, 8, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    })
  );
}

export function makeHairTex() {
  const rnd = seed(23);
  return toTex(
    canvas(64, 64, (ctx, w, h) => {
      ctx.fillStyle = '#6a4a32';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) {
        ctx.strokeStyle = `rgba(30,18,10,${0.15 + rnd() * 0.25})`;
        ctx.lineWidth = 1 + rnd();
        ctx.beginPath();
        const x = rnd() * w;
        ctx.moveTo(x, 0);
        ctx.quadraticCurveTo(x + (rnd() - 0.5) * 8, h * 0.5, x + (rnd() - 0.5) * 6, h);
        ctx.stroke();
      }
    })
  );
}

export function makePantsTex() {
  const rnd = seed(41);
  return toTex(
    canvas(64, 64, (ctx, w, h) => {
      ctx.fillStyle = '#3a414c';
      ctx.fillRect(0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (rnd() - 0.5) * 16;
        img.data[i] += n;
        img.data[i + 1] += n;
        img.data[i + 2] += n;
      }
      ctx.putImageData(img, 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, h - 12, w, 12);
    })
  );
}

export function makeWoodTex() {
  const rnd = seed(77);
  return toTex(
    canvas(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#a56a32';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y++) {
        const n = Math.sin(y * 0.11 + Math.sin(y * 0.03) * 2) * 18 + (rnd() - 0.5) * 12;
        ctx.fillStyle = `rgba(${70 + n},${38 + n * 0.55},${16 + n * 0.25},${0.28 + rnd() * 0.18})`;
        ctx.fillRect(0, y, w, 1);
      }
      ctx.fillStyle = 'rgba(50,28,10,0.28)';
      for (let i = 0; i < 9; i++) ctx.fillRect(18 + i * 28, 0, 3, h);
    }),
    { repeat: 1 }
  );
}

export function makeWoodBump() {
  const rnd = seed(78);
  return toTex(
    canvas(256, 256, (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const g = 128 + Math.sin(y * 0.2) * 18 + (rnd() - 0.5) * 20;
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const v = Math.max(0, Math.min(255, g + (rnd() - 0.5) * 10));
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }),
    { bump: true, repeat: 1 }
  );
}

export function makePlasterTex() {
  const rnd = seed(91);
  return toTex(
    canvas(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#f6f4f1';
      ctx.fillRect(0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (rnd() - 0.5) * 14;
        img.data[i] += n;
        img.data[i + 1] += n * 0.95;
        img.data[i + 2] += n * 0.85;
      }
      ctx.putImageData(img, 0, 0);
      ctx.fillStyle = 'rgba(180,170,160,0.25)';
      for (let y = 0; y < h; y += 32) ctx.fillRect(0, y, w, 1);
    }),
    { repeat: 2 }
  );
}

export function makeFabricTex() {
  const rnd = seed(53);
  return toTex(
    canvas(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#2a5fa0';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2) {
        ctx.fillStyle = `rgba(255,255,255,${0.03 + rnd() * 0.04})`;
        ctx.fillRect(0, y, w, 1);
      }
    })
  );
}

export function makeMetalTex() {
  const rnd = seed(17);
  return toTex(
    canvas(64, 64, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#d5d8de');
      g.addColorStop(0.5, '#9aa1aa');
      g.addColorStop(1, '#c8ccd2');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.08})`;
        ctx.fillRect(0, rnd() * h, w, 1);
      }
    })
  );
}

export function makeScreenTex() {
  return toTex(
    canvas(64, 40, (ctx, w, h) => {
      ctx.fillStyle = '#14304a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#3d8ec9';
      ctx.fillRect(4, 4, 28, 6);
      ctx.fillStyle = '#8fd4ff';
      ctx.fillRect(4, 13, 56, 3);
      ctx.fillStyle = '#2a6a94';
      ctx.fillRect(4, 18, 40, 3);
      ctx.fillRect(4, 23, 48, 3);
      ctx.fillStyle = '#5ee0a0';
      ctx.fillRect(4, 30, 18, 6);
    }),
    { wrap: false }
  );
}

/** 整张办公室地毯（世界 UV）：织纹 + 走道磨损 + 桌下 AO + 墙根压暗 */
export function makeWorldCarpet(
  map: { minX: number; minZ: number; maxX: number; maxZ: number },
  desks: { minX: number; minZ: number; maxX: number; maxZ: number }[]
) {
  const W = 512;
  const H = 1024;
  const rnd = seed(3);
  const worldW = map.maxX - map.minX;
  const worldH = map.maxZ - map.minZ;
  const c = canvas(W, H, (ctx) => {
    ctx.fillStyle = '#b88958';
    ctx.fillRect(0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const tile = (((x / 40) | 0) + ((y / 40) | 0)) & 1;
        const n = (rnd() - 0.5) * 18;
        if (tile) {
          d[i] = 186 + n;
          d[i + 1] = 142 + n * 0.8;
          d[i + 2] = 92 + n * 0.45;
        } else {
          d[i] = 164 + n;
          d[i + 1] = 118 + n * 0.75;
          d[i + 2] = 72 + n * 0.4;
        }
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    ctx.strokeStyle = 'rgba(80,50,22,0.22)';
    ctx.lineWidth = 2;
    for (let x = 0; x < W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y < H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    const xz = (wx: number, wz: number) => [
      ((wx - map.minX) / worldW) * W,
      ((wz - map.minZ) / worldH) * H,
    ];

    // 中央走道稍亮
    ctx.fillStyle = 'rgba(255,240,210,0.08)';
    const [x0] = xz(-1.8, 0);
    const [x1] = xz(1.8, 0);
    ctx.fillRect(x0, 0, x1 - x0, H);

    for (const desk of desks) {
      const [u0, v0] = xz(desk.minX - 0.25, desk.minZ - 0.25);
      const [u1, v1] = xz(desk.maxX + 0.25, desk.maxZ + 0.25);
      ctx.fillStyle = 'rgba(40,28,16,0.42)';
      ctx.fillRect(u0, v0, u1 - u0, v1 - v0);
    }

    // 墙根 AO
    ctx.fillStyle = 'rgba(30,22,16,0.28)';
    ctx.fillRect(0, 0, W, 18);
    ctx.fillRect(0, H - 18, W, 18);
    ctx.fillRect(0, 0, 14, H);
    ctx.fillRect(W - 14, 0, 14, H);

    for (let i = 0; i < 50; i++) {
      ctx.fillStyle = `rgba(70,50,30,${0.05 + rnd() * 0.1})`;
      ctx.beginPath();
      ctx.ellipse(rnd() * W, rnd() * H, 6 + rnd() * 16, 3 + rnd() * 8, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const tex = toTex(c, { wrap: false });
  tex.repeat.set(1, 1);
  return tex;
}

export function makeTileTex() {
  return toTex(
    canvas(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#d8d2c6';
      ctx.fillRect(0, 0, w, h);
      const tile = 64;
      const grout = 3;
      for (let y = 0; y < h; y += tile) {
        for (let x = 0; x < w; x += tile) {
          const n = ((x + y) / tile) % 2 === 0 ? 8 : -6;
          ctx.fillStyle = `rgb(${210 + n},${204 + n},${192 + n})`;
          ctx.fillRect(x + grout, y + grout, tile - grout * 2, tile - grout * 2);
        }
      }
      ctx.fillStyle = 'rgba(90,82,72,0.35)';
      for (let x = 0; x <= w; x += tile) ctx.fillRect(x, 0, grout, h);
      for (let y = 0; y <= h; y += tile) ctx.fillRect(0, y, w, grout);
    }),
    { repeat: 8 }
  );
}

export function makeCarpetBump() {
  const rnd = seed(4);
  return toTex(
    canvas(256, 256, (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
      const v = 128 + Math.sin(x * 0.4) * 6 + Math.sin(y * 0.35) * 6 + (rnd() - 0.5) * 18;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }),
    { bump: true, repeat: 18 }
  );
}

const cache = new Map<string, THREE.MeshPhongMaterial>();

export function phong(opts: {
  color?: number;
  map?: THREE.Texture;
  bumpMap?: THREE.Texture;
  bumpScale?: number;
  shininess?: number;
  specular?: number;
  transparent?: boolean;
  opacity?: number;
  emissive?: number;
}): THREE.MeshPhongMaterial {
  const key = `${opts.color ?? 0}|${opts.shininess ?? 18}|${opts.specular ?? 0}|${opts.map ? 1 : 0}|${opts.bumpMap ? 1 : 0}|${opts.transparent ? 1 : 0}|${opts.emissive ?? 0}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshPhongMaterial({
      color: opts.color ?? 0xffffff,
      map: opts.map ?? null,
      bumpMap: opts.bumpMap ?? null,
      bumpScale: opts.bumpScale ?? 0.4,
      shininess: opts.shininess ?? 18,
      specular: new THREE.Color(opts.specular ?? 0x333333),
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      ...(opts.emissive
        ? { emissive: new THREE.Color(opts.emissive), emissiveIntensity: 0.35 }
        : {}),
    });
    cache.set(key, m);
  }
  return m;
}

let shirtT: THREE.CanvasTexture | undefined;
let skinT: THREE.CanvasTexture | undefined;
let hairT: THREE.CanvasTexture | undefined;
let pantsT: THREE.CanvasTexture | undefined;
let woodT: THREE.CanvasTexture | undefined;
let woodB: THREE.CanvasTexture | undefined;
let plasterT: THREE.CanvasTexture | undefined;
let fabricT: THREE.CanvasTexture | undefined;
let metalT: THREE.CanvasTexture | undefined;
let screenT: THREE.CanvasTexture | undefined;
let tileT: THREE.CanvasTexture | undefined;

const colorMaps = new Map<string, Promise<THREE.Texture>>();

export function loadColorMap(url: string): Promise<THREE.Texture> {
  let p = colorMaps.get(url);
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(url).then((tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      return tex;
    });
    colorMaps.set(url, p);
  }
  return p;
}

export const tex = {
  shirt: () => (shirtT ??= makeShirtTex()),
  skin: () => (skinT ??= makeSkinTex()),
  hair: () => (hairT ??= makeHairTex()),
  pants: () => (pantsT ??= makePantsTex()),
  wood: () => (woodT ??= makeWoodTex()),
  woodBump: () => (woodB ??= makeWoodBump()),
  plaster: () => (plasterT ??= makePlasterTex()),
  fabric: () => (fabricT ??= makeFabricTex()),
  metal: () => (metalT ??= makeMetalTex()),
  screen: () => (screenT ??= makeScreenTex()),
  tile: () => (tileT ??= makeTileTex()),
};

/** 需要改透明度的角色材质不要走 cache */
export function phongFresh(opts: Parameters<typeof phong>[0]): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    color: opts.color ?? 0xffffff,
    map: opts.map ?? null,
    bumpMap: opts.bumpMap ?? null,
    bumpScale: opts.bumpScale ?? 0.4,
    shininess: opts.shininess ?? 18,
    specular: new THREE.Color(opts.specular ?? 0x333333),
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    ...(opts.emissive
      ? { emissive: new THREE.Color(opts.emissive), emissiveIntensity: 0.35 }
      : {}),
  });
}

export const mats = {
  wall: () => phong({ color: 0xffffff, map: tex.plaster(), shininess: 8, specular: 0x222222 }),
  wood: () => phong({ color: 0xffffff, map: tex.wood(), bumpMap: tex.woodBump(), bumpScale: 0.9, shininess: 36, specular: 0x665544 }),
  metal: () => phong({ color: 0xffffff, map: tex.metal(), shininess: 80, specular: 0xaaaaaa }),
  fabric: () => phong({ color: 0xffffff, map: tex.fabric(), shininess: 12, specular: 0x222222 }),
  pants: () => phong({ color: 0xffffff, map: tex.pants(), shininess: 10, specular: 0x222222 }),
  skin: () => phong({ color: 0xffffff, map: tex.skin(), shininess: 36, specular: 0x553322 }),
  hair: () => phong({ color: 0xffffff, map: tex.hair(), shininess: 18, specular: 0x221100 }),
  shirt: () => phong({ color: 0xffffff, map: tex.shirt(), shininess: 14, specular: 0x444444 }),
};
