/**
 * 网格流场寻路：以玩家为目标做一次 BFS，得到每个格子指向玩家的单位方向。
 * 所有敌人查表取方向，成本与敌人数量无关。
 */
export class FlowField {
  readonly nx: number;
  readonly nz: number;
  readonly cell: number;
  readonly ox: number;
  readonly oz: number;

  /** 1 = 障碍 */
  readonly blocked: Uint8Array;
  private cost: Int32Array;
  private dirX: Float32Array;
  private dirZ: Float32Array;
  private queue: Int32Array;

  private lastGoodCx = 0;
  private lastGoodCz = 0;
  private lastReach = 0;
  private hasLastGood = false;
  private scratchCost: Int32Array;
  private scratchDirX: Float32Array;
  private scratchDirZ: Float32Array;

  constructor(minX: number, minZ: number, maxX: number, maxZ: number, cell = 0.5) {
    this.cell = cell;
    this.ox = minX;
    this.oz = minZ;
    this.nx = Math.ceil((maxX - minX) / cell);
    this.nz = Math.ceil((maxZ - minZ) / cell);
    const n = this.nx * this.nz;
    this.blocked = new Uint8Array(n);
    this.cost = new Int32Array(n);
    this.dirX = new Float32Array(n);
    this.dirZ = new Float32Array(n);
    this.queue = new Int32Array(n);
    this.scratchCost = new Int32Array(n);
    this.scratchDirX = new Float32Array(n);
    this.scratchDirZ = new Float32Array(n);
  }

  private idx(cx: number, cz: number) {
    return cz * this.nx + cx;
  }

  cellOf(x: number, z: number): [number, number] {
    const cx = Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.ox) / this.cell)));
    const cz = Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.oz) / this.cell)));
    return [cx, cz];
  }

  /** 把世界坐标矩形标记为障碍（含 margin 膨胀，让敌人不贴墙） */
  blockRect(minX: number, minZ: number, maxX: number, maxZ: number, margin = 0.18) {
    const [ax, az] = this.cellOf(minX - margin, minZ - margin);
    const [bx, bz] = this.cellOf(maxX + margin, maxZ + margin);
    for (let cz = az; cz <= bz; cz++) {
      for (let cx = ax; cx <= bx; cx++) {
        this.blocked[this.idx(cx, cz)] = 1;
      }
    }
  }

  blockIf(test: (x: number, z: number) => boolean) {
    for (let cz = 0; cz < this.nz; cz++) {
      for (let cx = 0; cx < this.nx; cx++) {
        const x = this.ox + (cx + 0.5) * this.cell;
        const z = this.oz + (cz + 0.5) * this.cell;
        if (test(x, z)) this.blocked[this.idx(cx, cz)] = 1;
      }
    }
  }

  isBlockedAt(x: number, z: number): boolean {
    if (x < this.ox || z < this.oz || x >= this.ox + this.nx * this.cell || z >= this.oz + this.nz * this.cell) {
      return true;
    }
    const [cx, cz] = this.cellOf(x, z);
    return this.blocked[this.idx(cx, cz)] === 1;
  }

  /** 从目标位置（玩家）重建流场 */
  rebuild(targetX: number, targetZ: number) {
    const snap = this.snapWalkable(targetX, targetZ, 32);
    if (snap) {
      this.bfsFrom(snap.cx, snap.cz);
      const reach = this.countReached();
      const sameFloor = !this.hasLastGood || reach >= this.lastReach - 8;
      if (sameFloor) {
        this.lastGoodCx = snap.cx;
        this.lastGoodCz = snap.cz;
        this.lastReach = Math.max(this.lastReach, reach);
        this.hasLastGood = true;
        this.fillDirs();
        return;
      }
      this.fillDirs();
      this.scratchCost.set(this.cost);
      this.scratchDirX.set(this.dirX);
      this.scratchDirZ.set(this.dirZ);
      if (this.hasLastGood && !this.blocked[this.idx(this.lastGoodCx, this.lastGoodCz)]) {
        this.bfsFrom(this.lastGoodCx, this.lastGoodCz);
        this.fillDirs();
        for (let i = 0; i < this.cost.length; i++) {
          if (this.scratchCost[i] >= 0) {
            this.cost[i] = this.scratchCost[i];
            this.dirX[i] = this.scratchDirX[i];
            this.dirZ[i] = this.scratchDirZ[i];
          }
        }
        return;
      }
      return;
    }
    if (this.hasLastGood && !this.blocked[this.idx(this.lastGoodCx, this.lastGoodCz)]) {
      this.bfsFrom(this.lastGoodCx, this.lastGoodCz);
      this.fillDirs();
      return;
    }
    const any = this.snapWalkable(targetX, targetZ, Math.max(this.nx, this.nz));
    if (any) {
      this.bfsFrom(any.cx, any.cz);
      this.lastGoodCx = any.cx;
      this.lastGoodCz = any.cz;
      this.lastReach = this.countReached();
      this.hasLastGood = true;
    }
    this.fillDirs();
  }

  private snapWalkable(x: number, z: number, maxR: number): { cx: number; cz: number } | null {
    const { nx, nz, blocked } = this;
    let [tx, tz] = this.cellOf(x, z);
    if (!blocked[this.idx(tx, tz)]) return { cx: tx, cz: tz };
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const cx = tx + dx;
          const cz = tz + dz;
          if (cx < 0 || cz < 0 || cx >= nx || cz >= nz) continue;
          if (!blocked[this.idx(cx, cz)]) return { cx, cz };
        }
      }
    }
    return null;
  }

  private countReached() {
    let n = 0;
    for (let i = 0; i < this.cost.length; i++) if (this.cost[i] >= 0) n++;
    return n;
  }

  private bfsFrom(tx: number, tz: number) {
    const { nx, nz, blocked, cost, queue } = this;
    cost.fill(-1);
    let head = 0;
    let tail = 0;
    const start = tz * nx + tx;
    cost[start] = 0;
    queue[tail++] = start;

    while (head < tail) {
      const cur = queue[head++];
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
          if (dx !== 0 && dz !== 0) {
            if (blocked[cz * nx + nxx] || blocked[nzz * nx + cx]) continue;
          }
          cost[ni] = c + 1;
          queue[tail++] = ni;
        }
      }
    }
  }

  private fillDirs() {
    const { nx, nz, blocked, cost, dirX, dirZ } = this;
    for (let cz = 0; cz < nz; cz++) {
      for (let cx = 0; cx < nx; cx++) {
        const i = cz * nx + cx;
        if (blocked[i] || cost[i] <= 0) {
          dirX[i] = 0;
          dirZ[i] = 0;
          continue;
        }
        let best = cost[i];
        let bx = 0;
        let bz = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            const nxx = cx + dx;
            const nzz = cz + dz;
            if (nxx < 0 || nzz < 0 || nxx >= nx || nzz >= nz) continue;
            const ni = nzz * nx + nxx;
            if (blocked[ni] || cost[ni] === -1) continue;
            if (dx !== 0 && dz !== 0 && (blocked[cz * nx + nxx] || blocked[nzz * nx + cx])) continue;
            if (cost[ni] < best) {
              best = cost[ni];
              bx = dx;
              bz = dz;
            }
          }
        }
        const len = Math.hypot(bx, bz) || 1;
        dirX[i] = bx / len;
        dirZ[i] = bz / len;
      }
    }
  }

  /** 四邻可走数：3 ≈ 门口旁，≤2 ≈ 窄口 */
  openN4(x: number, z: number): number {
    const [cx, cz] = this.cellOf(x, z);
    let n = 0;
    if (cx > 0 && !this.blocked[this.idx(cx - 1, cz)]) n++;
    if (cx + 1 < this.nx && !this.blocked[this.idx(cx + 1, cz)]) n++;
    if (cz > 0 && !this.blocked[this.idx(cx, cz - 1)]) n++;
    if (cz + 1 < this.nz && !this.blocked[this.idx(cx, cz + 1)]) n++;
    return n;
  }

  costAt(x: number, z: number): number {
    const [cx, cz] = this.cellOf(x, z);
    return this.cost[this.idx(cx, cz)];
  }

  /** 沿流向的垂直可走宽度（米），用来认门口/窄廊 */
  corridorWidth(x: number, z: number, dx: number, dz: number): number {
    const len = Math.hypot(dx, dz) || 1;
    const px = -dz / len;
    const pz = dx / len;
    const step = this.cell;
    let a = 0;
    let b = 0;
    for (let t = step; t <= 4; t += step) {
      if (this.isBlockedAt(x + px * t, z + pz * t)) break;
      a = t;
    }
    for (let t = step; t <= 4; t += step) {
      if (this.isBlockedAt(x - px * t, z - pz * t)) break;
      b = t;
    }
    return a + b;
  }

  private cellCenter(x: number, z: number): { x: number; z: number } {
    const [cx, cz] = this.cellOf(x, z);
    return { x: this.ox + (cx + 0.5) * this.cell, z: this.oz + (cz + 0.5) * this.cell };
  }

  /**
   * 沿通往目标的最短路，找玩家前方下一处变窄的卡口（门口/窄廊）。
   * 不把电梯跟前当卡口，避免拦截者直接冲终点。
   */
  nextGateAlong(x: number, z: number): { x: number; z: number } | null {
    const dir = { x: 0, z: 0 };
    this.sample(x, z, dir);
    let prevW = this.corridorWidth(x, z, dir.x || 1, dir.z);
    let wx = x;
    let wz = z;
    let walked = 0;
    const step = this.cell;
    const playerCost = this.costAt(x, z);
    let lastCx = -1;
    let lastCz = -1;
    let stuck = 0;
    let fallback: { x: number; z: number } | null = null;

    for (let k = 0; k < 160; k++) {
      this.sample(wx, wz, dir);
      if (dir.x === 0 && dir.z === 0) break;
      wx += dir.x * step;
      wz += dir.z * step;
      walked += step;

      const [cx, cz] = this.cellOf(wx, wz);
      if (cx === lastCx && cz === lastCz) {
        if (++stuck > 3) break;
      } else {
        stuck = 0;
        lastCx = cx;
        lastCz = cz;
      }

      const cost = this.costAt(wx, wz);
      if (cost >= 0 && cost <= 3) break;

      const w = this.corridorWidth(wx, wz, dir.x, dir.z);
      const entered = prevW > 2.4 && w <= 2;
      prevW = w;

      const nearElev = cost >= 0 && cost * this.cell < 5.5;
      if (nearElev && playerCost * this.cell > 12) continue;
      if (cost >= 0 && cost <= 6 && playerCost > 18) continue;
      if (walked < 3.2) continue;
      if (w > 2) continue;

      const pt = this.cellCenter(wx, wz);
      if (!fallback) fallback = pt;
      if (entered || w <= 1.6) return pt;
    }
    return fallback;
  }

  /** 取某世界坐标的追踪方向（单位向量，写入 out）；落在阻挡格时回退到相邻可走格 */
  sample(x: number, z: number, out: { x: number; z: number }) {
    const [cx, cz] = this.cellOf(x, z);
    const i = cz * this.nx + cx;
    out.x = this.dirX[i];
    out.z = this.dirZ[i];
    if (out.x !== 0 || out.z !== 0) return;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nxx = cx + dx;
        const nzz = cz + dz;
        if (nxx < 0 || nzz < 0 || nxx >= this.nx || nzz >= this.nz) continue;
        const ni = nzz * this.nx + nxx;
        if (this.dirX[ni] !== 0 || this.dirZ[ni] !== 0) {
          out.x = this.dirX[ni];
          out.z = this.dirZ[ni];
          return;
        }
      }
    }
  }
}
