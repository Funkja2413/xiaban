import type { MapBounds, MapVoid, Xz } from '../levels';
import { isInVoid } from '../levels';

type Rect = { minX: number; minZ: number; maxX: number; maxZ: number };

export interface AutoSpawns {
  enemySpawns: Xz[];
  heavyAnchors: Xz[];
  interceptorSpawns: Xz[];
}

const CELL = 0.5;

function bfs(blocked: Uint8Array, nx: number, nz: number, sx: number, sz: number): Int32Array {
  const cost = new Int32Array(nx * nz).fill(-1);
  if (sx < 0 || sz < 0 || sx >= nx || sz >= nz) return cost;
  let start = sz * nx + sx;
  if (blocked[start]) {
    let found = false;
    outer: for (let r = 1; r < 10; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const cx = sx + dx;
          const cz = sz + dz;
          if (cx < 0 || cz < 0 || cx >= nx || cz >= nz) continue;
          const i = cz * nx + cx;
          if (!blocked[i]) {
            sx = cx;
            sz = cz;
            start = i;
            found = true;
            break outer;
          }
        }
      }
    }
    if (!found) return cost;
  }
  cost[start] = 0;
  const q = new Int32Array(nx * nz);
  let head = 0;
  let tail = 0;
  q[tail++] = start;
  while (head < tail) {
    const cur = q[head++];
    const cx = cur % nx;
    const cz = (cur / nx) | 0;
    const c = cost[cur];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nxx = cx + dx;
        const nzz = cz + dz;
        if (nxx < 0 || nzz < 0 || nxx >= nx || nzz >= nz) continue;
        const ni = nzz * nx + nxx;
        if (blocked[ni] || cost[ni] !== -1) continue;
        if (dx !== 0 && dz !== 0 && (blocked[cz * nx + nxx] || blocked[nzz * nx + cx])) continue;
        cost[ni] = c + 1;
        q[tail++] = ni;
      }
    }
  }
  return cost;
}

function n4(blocked: Uint8Array, nx: number, nz: number, cx: number, cz: number) {
  let n = 0;
  if (cx > 0 && !blocked[cz * nx + cx - 1]) n++;
  if (cx + 1 < nx && !blocked[cz * nx + cx + 1]) n++;
  if (cz > 0 && !blocked[(cz - 1) * nx + cx]) n++;
  if (cz + 1 < nz && !blocked[(cz + 1) * nx + cx]) n++;
  return n;
}

function pickSpaced(cands: { x: number; z: number; score: number }[], count: number, minDist: number): Xz[] {
  const out: Xz[] = [];
  const md = minDist * minDist;
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands) {
    if (out.length >= count) break;
    if (out.some((p) => (p.x - c.x) ** 2 + (p.z - c.z) ** 2 < md)) continue;
    out.push({ x: c.x, z: c.z });
  }
  return out;
}

function pathToElev(
  blocked: Uint8Array,
  nx: number,
  nz: number,
  distE: Int32Array,
  sx: number,
  sz: number
): { cx: number; cz: number }[] {
  const path: { cx: number; cz: number }[] = [];
  let cx = sx;
  let cz = sz;
  const seen = new Uint8Array(nx * nz);
  for (let step = 0; step < nx * nz; step++) {
    const i = cz * nx + cx;
    if (distE[i] < 0) break;
    if (seen[i]) break;
    seen[i] = 1;
    path.push({ cx, cz });
    if (distE[i] <= 0) break;
    let best = distE[i];
    let bx = cx;
    let bz = cz;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nxx = cx + dx;
        const nzz = cz + dz;
        if (nxx < 0 || nzz < 0 || nxx >= nx || nzz >= nz) continue;
        const ni = nzz * nx + nxx;
        if (blocked[ni] || distE[ni] < 0) continue;
        if (dx !== 0 && dz !== 0 && (blocked[cz * nx + nxx] || blocked[nzz * nx + cx])) continue;
        if (distE[ni] < best) {
          best = distE[ni];
          bx = nxx;
          bz = nzz;
        }
      }
    }
    if (bx === cx && bz === cz) break;
    cx = bx;
    cz = bz;
  }
  return path;
}

function corridorWidth(
  blocked: Uint8Array,
  nx: number,
  nz: number,
  ox: number,
  oz: number,
  x: number,
  z: number,
  dx: number,
  dz: number
): number {
  const len = Math.hypot(dx, dz) || 1;
  const px = -dz / len;
  const pz = dx / len;
  const inside = (wx: number, wz: number) => {
    const cx = Math.min(nx - 1, Math.max(0, Math.floor((wx - ox) / CELL)));
    const cz = Math.min(nz - 1, Math.max(0, Math.floor((wz - oz) / CELL)));
    return blocked[cz * nx + cx] === 0;
  };
  let a = 0;
  let b = 0;
  for (let t = CELL; t <= 4; t += CELL) {
    if (!inside(x + px * t, z + pz * t)) break;
    a = t;
  }
  for (let t = CELL; t <= 4; t += CELL) {
    if (!inside(x - px * t, z - pz * t)) break;
    b = t;
  }
  return a + b;
}

/**
 * 按当前墙/桌布局自动铺刷新点：
 * A 铺在可走区域、离玩家稍远；C 站必经窄口；F 蹲在通往电梯的后半段。
 */
export function layoutSpawns(
  map: MapBounds,
  obstacles: Rect[],
  player: Xz,
  elevator: Xz,
  voids?: MapVoid[]
): AutoSpawns {
  const ox = map.minX;
  const oz = map.minZ;
  const nx = Math.max(1, Math.ceil((map.maxX - map.minX) / CELL));
  const nz = Math.max(1, Math.ceil((map.maxZ - map.minZ) / CELL));
  const blocked = new Uint8Array(nx * nz);

  const mark = (minX: number, minZ: number, maxX: number, maxZ: number, pad = 0.2) => {
    const ax = Math.max(0, Math.floor((minX - pad - ox) / CELL));
    const az = Math.max(0, Math.floor((minZ - pad - oz) / CELL));
    const bx = Math.min(nx - 1, Math.floor((maxX + pad - ox) / CELL));
    const bz = Math.min(nz - 1, Math.floor((maxZ + pad - oz) / CELL));
    for (let cz = az; cz <= bz; cz++) {
      for (let cx = ax; cx <= bx; cx++) blocked[cz * nx + cx] = 1;
    }
  };
  const world = (cx: number, cz: number): Xz => ({
    x: ox + (cx + 0.5) * CELL,
    z: oz + (cz + 0.5) * CELL,
  });
  for (const o of obstacles) mark(o.minX, o.minZ, o.maxX, o.maxZ);
  if (voids?.length) {
    for (let cz = 0; cz < nz; cz++) {
      for (let cx = 0; cx < nx; cx++) {
        const p = world(cx, cz);
        if (isInVoid(p.x, p.z, voids, 0.2)) blocked[cz * nx + cx] = 1;
      }
    }
  }

  const cellOf = (x: number, z: number) => [
    Math.min(nx - 1, Math.max(0, Math.floor((x - ox) / CELL))),
    Math.min(nz - 1, Math.max(0, Math.floor((z - oz) / CELL))),
  ] as const;

  const [px, pz] = cellOf(player.x, player.z);
  const [ex, ez] = cellOf(elevator.x, elevator.z);
  const distE = bfs(blocked, nx, nz, ex, ez);
  const distP = bfs(blocked, nx, nz, px, pz);
  const shortest = distE[pz * nx + px];
  const pathSlack = Number.isFinite(shortest) && shortest >= 0 ? shortest + 6 : 1e9;

  const aCands: { x: number; z: number; score: number }[] = [];
  const cCands: { x: number; z: number; score: number }[] = [];
  const fCands: { x: number; z: number; score: number }[] = [];

  const route = pathToElev(blocked, nx, nz, distE, px, pz);
  let prevW = 8;
  for (let k = 1; k < route.length; k++) {
    const prev = route[k - 1];
    const cur = route[k];
    const { x, z } = world(cur.cx, cur.cz);
    const w = corridorWidth(
      blocked,
      nx,
      nz,
      ox,
      oz,
      x,
      z,
      cur.cx - prev.cx,
      cur.cz - prev.cz
    );
    const dPlayer = distP[cur.cz * nx + cur.cx] * CELL;
    const dElev = distE[cur.cz * nx + cur.cx] * CELL;
    const entered = prevW > 2.4 && w <= 2;
    prevW = w;
    if (dPlayer < 6 || dElev < 6) continue;
    if (w > 2.1) continue;
    if (!entered && w > 1.6) continue;

    let gx = cur.cx;
    let gz = cur.cz;
    let gw = w;
    // 缝太窄站不住：退到玩家一侧稍宽的一格，仍封住入口
    if (gw < 1.1 && k > 1) {
      gx = prev.cx;
      gz = prev.cz;
      const back = world(gx, gz);
      gw = corridorWidth(blocked, nx, nz, ox, oz, back.x, back.z, cur.cx - prev.cx, cur.cz - prev.cz);
    }
    const pos = world(gx, gz);
    cCands.push({
      x: pos.x,
      z: pos.z,
      score: 50 + (2.2 - Math.min(gw, 2.2)) * 14 + dPlayer * 0.08,
    });
  }

  for (let cz = 1; cz < nz - 1; cz++) {
    for (let cx = 1; cx < nx - 1; cx++) {
      const i = cz * nx + cx;
      if (blocked[i] || distE[i] < 0 || distP[i] < 0) continue;
      const { x, z } = world(cx, cz);
      const open = n4(blocked, nx, nz, cx, cz);
      const dPlayer = distP[i] * CELL;

      if (dPlayer > 7) {
        aCands.push({ x, z, score: dPlayer + (open === 4 ? 4 : 0) + Math.random() });
      }

      const onPath = distP[i] + distE[i] <= pathSlack;
      const along = shortest > 0 ? 1 - distE[i] / shortest : 0;
      if (onPath && along > 0.45 && along < 0.95 && dPlayer > 10) {
        fCands.push({ x, z, score: along * 10 + (open <= 3 ? 5 : 0) });
      }
    }
  }

  let heavyAnchors = pickSpaced(cCands, 5, 6.5);
  if (heavyAnchors.length < 3) {
    const extra = aCands
      .filter((c) => {
        const [cx, cz] = cellOf(c.x, c.z);
        const w = corridorWidth(blocked, nx, nz, ox, oz, c.x, c.z, 0, 1);
        return w <= 2.2 && distE[cz * nx + cx] > 8 && distP[cz * nx + cx] * CELL > 8;
      })
      .map((c) => ({ ...c, score: c.score * 0.4 }));
    heavyAnchors = pickSpaced([...cCands, ...extra], 5, 6.5);
  }

  let interceptorSpawns = pickSpaced(fCands, 3, 6);
  if (interceptorSpawns.length < 2) {
    interceptorSpawns = pickSpaced(
      aCands.filter((c) => {
        const [cx, cz] = cellOf(c.x, c.z);
        return distE[cz * nx + cx] < (shortest > 0 ? shortest * 0.45 : 20);
      }),
      3,
      6
    );
  }

  let enemySpawns = pickSpaced(aCands, 22, 3.2);
  if (enemySpawns.length < 8) {
    const loose: { x: number; z: number; score: number }[] = [];
    for (let cz = 1; cz < nz - 1; cz++) {
      for (let cx = 1; cx < nx - 1; cx++) {
        const i = cz * nx + cx;
        if (blocked[i] || distP[i] < 0) continue;
        const dPlayer = distP[i] * CELL;
        if (dPlayer < 4) continue;
        const { x, z } = world(cx, cz);
        loose.push({ x, z, score: dPlayer });
      }
    }
    enemySpawns = pickSpaced(loose, 22, 2.4);
  }

  return {
    enemySpawns,
    heavyAnchors,
    interceptorSpawns,
  };
}
