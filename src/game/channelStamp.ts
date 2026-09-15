import * as THREE from 'three/webgpu';
import { isChannelStampId, type ChannelStampId } from '../fx/catalog';

/** 原创色块图标（透明底、无文字），不是各软件官方商标。 */
const cache = new Map<string, THREE.CanvasTexture>();

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function letter(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, size: number, color = '#fff') {
  ctx.fillStyle = color;
  ctx.font = `800 ${size}px ui-sans-serif, "PingFang SC", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t, x, y);
}

function iconOnly(bg: string, mark: (ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) => void) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = bg;
  round(ctx, 12, 12, 232, 232, 52);
  ctx.fill();
  mark(ctx, 128, 128, 232);
  return c;
}

function paperLines() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 320;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 320);
  ctx.fillStyle = 'rgba(80,64,48,0.16)';
  ctx.fillRect(0, 0, 256, 28);
  ctx.fillRect(18, 10, 70, 9);
  for (let y = 52; y < 302; y += 16) ctx.fillRect(18, y, 220, 4);
  return c;
}

function toTex(c: HTMLCanvasElement) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.premultiplyAlpha = true;
  tex.needsUpdate = true;
  return tex;
}

function drawStamp(id: ChannelStampId): HTMLCanvasElement {
  if (id === 'paper') return paperLines();
  if (id === 'word') return iconOnly('#2b579a', (ctx, cx, cy) => letter(ctx, 'W', cx, cy + 4, 118));
  if (id === 'excel') {
    return iconOnly('#217346', (ctx, cx, cy) => {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 5;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - 58, cy + i * 34);
        ctx.lineTo(cx + 58, cy + i * 34);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + i * 38, cy - 56);
        ctx.lineTo(cx + i * 38, cy + 56);
        ctx.stroke();
      }
      letter(ctx, 'X', cx, cy + 2, 100);
    });
  }
  if (id === 'ppt') {
    return iconOnly('#d24726', (ctx, cx, cy) => {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.moveTo(cx + 10, cy);
      ctx.arc(cx + 10, cy, 58, -0.9, 1.4);
      ctx.closePath();
      ctx.fill();
      letter(ctx, 'P', cx - 8, cy + 2, 112);
    });
  }
  if (id === 'outlook') {
    return iconOnly('#0f6cbd', (ctx, cx, cy) => {
      ctx.fillStyle = '#fff';
      round(ctx, cx - 62, cy - 40, 124, 84, 10);
      ctx.fill();
      ctx.strokeStyle = '#0f6cbd';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(cx - 56, cy - 32);
      ctx.lineTo(cx, cy + 12);
      ctx.lineTo(cx + 56, cy - 32);
      ctx.stroke();
    });
  }
  if (id === 'keynote') {
    return iconOnly('#e57c00', (ctx, cx, cy) => {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(cx - 64, cy + 46);
      ctx.lineTo(cx, cy - 58);
      ctx.lineTo(cx + 64, cy + 46);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e57c00';
      ctx.fillRect(cx - 10, cy + 22, 20, 34);
    });
  }
  if (id === 'pages') {
    return iconOnly('#e4a11b', (ctx, cx, cy) => {
      ctx.fillStyle = '#fff';
      round(ctx, cx - 44, cy - 58, 88, 116, 10);
      ctx.fill();
      ctx.fillStyle = 'rgba(228,161,27,0.4)';
      for (let y = cy - 34; y < cy + 44; y += 14) ctx.fillRect(cx - 30, y, 60, 6);
    });
  }
  if (id === 'numbers') {
    return iconOnly('#34a853', (ctx, cx, cy) => {
      ctx.fillStyle = '#fff';
      for (let r = 0; r < 3; r++) {
        for (let col = 0; col < 3; col++) {
          ctx.fillRect(cx - 50 + col * 36, cy - 50 + r * 36, 28, 28);
        }
      }
    });
  }
  if (id === 'docs') {
    return iconOnly('#4285f4', (ctx, cx, cy) => {
      ctx.fillStyle = '#fff';
      round(ctx, cx - 42, cy - 56, 84, 112, 8);
      ctx.fill();
      ctx.fillStyle = '#4285f4';
      for (let y = cy - 30; y < cy + 40; y += 16) ctx.fillRect(cx - 26, y, 52, 7);
    });
  }
  if (id === 'sheets') {
    return iconOnly('#0f9d58', (ctx, cx, cy) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx - 54, cy - 48, 108, 96);
      ctx.fillStyle = '#0f9d58';
      ctx.fillRect(cx - 54, cy - 48, 108, 20);
      ctx.fillRect(cx - 54, cy - 8, 108, 5);
      ctx.fillRect(cx - 6, cy - 48, 5, 96);
    });
  }
  if (id === 'slides') {
    return iconOnly('#f4b400', (ctx, cx, cy) => {
      ctx.fillStyle = '#fff';
      round(ctx, cx - 62, cy - 42, 124, 84, 10);
      ctx.fill();
      ctx.fillStyle = '#f4b400';
      ctx.fillRect(cx - 34, cy - 10, 68, 12);
    });
  }
  if (id === 'figma') {
    return iconOnly('#1e1e1e', (ctx, cx, cy) => {
      const dots: [number, number, string][] = [
        [-26, -22, '#f24e1e'],
        [26, -22, '#a259ff'],
        [-26, 26, '#ff7262'],
        [26, 26, '#1abcfe'],
      ];
      for (const [dx, dy, col] of dots) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(cx + dx, cy + dy, 22, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  if (id === 'notion') return iconOnly('#191919', (ctx, cx, cy) => letter(ctx, 'N', cx, cy + 2, 120));
  if (id === 'feishu') return iconOnly('#3370ff', (ctx, cx, cy) => letter(ctx, '飞', cx, cy + 2, 108));
  if (id === 'slack') {
    return iconOnly('#4a154b', (ctx, cx, cy) => {
      ctx.fillStyle = '#e01e5a';
      ctx.fillRect(cx - 10, cy - 50, 20, 44);
      ctx.fillStyle = '#36c5f0';
      ctx.fillRect(cx + 10, cy - 10, 44, 20);
      ctx.fillStyle = '#2eb67d';
      ctx.fillRect(cx - 10, cy + 10, 20, 44);
      ctx.fillStyle = '#ecb22e';
      ctx.fillRect(cx - 54, cy - 10, 44, 20);
    });
  }
  if (id === 'teams') {
    return iconOnly('#5b5fc7', (ctx, cx, cy) => {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx - 12, cy - 20, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 26, cy - 12, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx - 12, cy + 32, 34, 22, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  if (id === 'vscode') {
    return iconOnly('#0078d4', (ctx, cx, cy) => {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(cx - 44, cy - 10);
      ctx.lineTo(cx + 10, cy - 52);
      ctx.lineTo(cx + 50, cy);
      ctx.lineTo(cx + 10, cy + 52);
      ctx.lineTo(cx - 44, cy + 10);
      ctx.lineTo(cx - 10, cy);
      ctx.closePath();
      ctx.fill();
    });
  }
  return iconOnly('#fdb300', (ctx, cx, cy) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 58);
    ctx.lineTo(cx + 54, cy);
    ctx.lineTo(cx, cy + 58);
    ctx.lineTo(cx - 54, cy);
    ctx.closePath();
    ctx.fill();
  });
}

export function channelStampMap(id: string | undefined): THREE.CanvasTexture {
  const stamp: ChannelStampId = isChannelStampId(id) ? id : 'paper';
  const hit = cache.get(stamp);
  if (hit) return hit;
  const tex = toTex(drawStamp(stamp));
  cache.set(stamp, tex);
  return tex;
}
