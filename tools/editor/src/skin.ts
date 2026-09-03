import * as THREE from 'three';

/** 与 humanoid.ts 一致：游戏加载 PNG 也是 flipY + sRGB */
export async function loadSkinMap(url: string, flipY = true): Promise<THREE.Texture> {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = flipY;
  tex.needsUpdate = true;
  return tex;
}

export function applySkin(mesh: THREE.Mesh, map: THREE.Texture) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    const mat = m as THREE.MeshPhongMaterial;
    if (!('map' in mat)) continue;
    mat.map = map;
    mat.needsUpdate = true;
  }
}

export async function skinFromFile(
  file: File,
  flipY = true
): Promise<{ map: THREE.Texture; width: number; height: number; square: boolean; url: string }> {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('无法读取 PNG'));
    el.src = url;
  });
  const square = img.width === img.height && img.width > 0;
  const map = await loadSkinMap(url, flipY);
  return { map, width: img.width, height: img.height, square, url };
}

export const UV_ISLANDS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: '头/脸/短发壳', x: 0.02, y: 0.02, w: 0.46, h: 0.50 },
  { name: '上衣+袖', x: 0.02, y: 0.54, w: 0.46, h: 0.44 },
  { name: '鞋', x: 0.50, y: 0.10, w: 0.22, h: 0.22 },
  { name: '头皮/配件', x: 0.74, y: 0.02, w: 0.24, h: 0.28 },
  { name: '裤', x: 0.50, y: 0.55, w: 0.48, h: 0.43 },
];

export function drawSkinPreview(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource | null,
  opts: { islands: boolean; warn?: string; islandList?: { name: string; x: number; y: number; w: number; h: number }[] }
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = '#1a1b20';
  ctx.fillRect(0, 0, w, h);
  if (image) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, w, h);
  } else {
    ctx.fillStyle = '#6e7180';
    ctx.font = '12px ui-sans-serif';
    ctx.fillText('无贴图', 12, 22);
  }
  if (opts.islands) {
    ctx.lineWidth = 1.5;
    ctx.font = '11px ui-sans-serif';
    for (const island of opts.islandList ?? UV_ISLANDS) {
      const x = island.x * w;
      const y = island.y * h;
      const iw = island.w * w;
      const ih = island.h * h;
      ctx.strokeStyle = 'rgba(110, 168, 255, 0.9)';
      ctx.strokeRect(x + 0.5, y + 0.5, iw - 1, ih - 1);
      ctx.fillStyle = 'rgba(20, 22, 28, 0.7)';
      const tw = ctx.measureText(island.name).width + 8;
      ctx.fillRect(x + 2, y + 2, tw, 16);
      ctx.fillStyle = '#d7e7ff';
      ctx.fillText(island.name, x + 6, y + 14);
    }
  }
  if (opts.warn) {
    ctx.fillStyle = 'rgba(80, 40, 20, 0.82)';
    ctx.fillRect(0, h - 28, w, 28);
    ctx.fillStyle = '#ffd29a';
    ctx.font = '12px ui-sans-serif';
    ctx.fillText(opts.warn, 8, h - 10);
  }
}

export async function imageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('贴图加载失败'));
    el.src = url;
  });
}
