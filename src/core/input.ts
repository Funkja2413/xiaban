import { clientToStage, clientToStageNdc, isStageLeft } from './stage';

/**
 * 双摇杆触控 + 键鼠输入。坐标相对 9:16 舞台，不是浏览器窗口。
 * 左半屏拖动 = 移动摇杆；右半屏拖动 = 瞄准摇杆（按住即射击）。
 * 桌面端：WASD/方向键移动，鼠标瞄准，按住左键射击，Shift/空格冲刺。
 */
export class Input {
  /** 移动向量，屏幕坐标系（x 右，y 下），模长 <= 1 */
  moveX = 0;
  moveY = 0;
  /** 瞄准向量（摇杆模式），模长 <= 1；aiming 表示右摇杆激活中 */
  aimX = 0;
  aimY = 0;
  aiming = false;

  /** 鼠标模式 */
  mouseNdcX = 0;
  mouseNdcY = 0;
  mouseDown = false;
  mouseActive = false;

  private dashQueued = false;
  private skillQueued = false;

  private keys = new Set<string>();
  private moveTouchId: number | null = null;
  private aimTouchId: number | null = null;
  private moveOrigin = { x: 0, y: 0 };
  private aimOrigin = { x: 0, y: 0 };

  private stickMove: HTMLElement;
  private stickAim: HTMLElement;

  constructor(private canvas: HTMLElement) {
    this.stickMove = document.getElementById('stickMove')!;
    this.stickAim = document.getElementById('stickAim')!;

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.dashQueued = true;
        e.preventDefault();
      }
      if (e.code === 'KeyE') this.skillQueued = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    window.addEventListener('mousemove', (e) => {
      this.mouseActive = true;
      const ndc = clientToStageNdc(e.clientX, e.clientY);
      this.mouseNdcX = ndc.x;
      this.mouseNdcY = ndc.y;
    });
    window.addEventListener('mousedown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('button')) return;
      this.mouseDown = true;
    });
    window.addEventListener('mouseup', () => (this.mouseDown = false));

    const opts = { passive: false } as AddEventListenerOptions;
    canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), opts);
    canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), opts);
    canvas.addEventListener('touchend', (e) => this.onTouchEnd(e), opts);
    canvas.addEventListener('touchcancel', (e) => this.onTouchEnd(e), opts);

    const dashBtn = document.getElementById('dashBtn')!;
    dashBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.dashQueued = true;
    }, opts);
    dashBtn.addEventListener('click', () => (this.dashQueued = true));

    const skillBtn = document.getElementById('skillBtn')!;
    skillBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.skillQueued = true;
    }, opts);
    skillBtn.addEventListener('click', () => (this.skillQueued = true));
  }

  /** 取出一次冲刺请求（边沿触发） */
  consumeDash(): boolean {
    const d = this.dashQueued;
    this.dashQueued = false;
    return d;
  }

  /** 取出一次技能请求（边沿触发） */
  consumeSkill(): boolean {
    const s = this.skillQueued;
    this.skillQueued = false;
    return s;
  }

  private onTouchStart(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const isLeft = isStageLeft(t.clientX);
      if (isLeft && this.moveTouchId === null) {
        this.moveTouchId = t.identifier;
        this.moveOrigin = { x: t.clientX, y: t.clientY };
        this.showStick(this.stickMove, t.clientX, t.clientY, 0, 0);
      } else if (!isLeft && this.aimTouchId === null) {
        this.aimTouchId = t.identifier;
        this.aimOrigin = { x: t.clientX, y: t.clientY };
        this.aiming = true;
        this.showStick(this.stickAim, t.clientX, t.clientY, 0, 0);
      }
    }
  }

  private onTouchMove(e: TouchEvent) {
    e.preventDefault();
    const R = 55;
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.moveTouchId) {
        let dx = t.clientX - this.moveOrigin.x;
        let dy = t.clientY - this.moveOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > R) { dx *= R / len; dy *= R / len; }
        this.moveX = dx / R;
        this.moveY = dy / R;
        this.showStick(this.stickMove, this.moveOrigin.x, this.moveOrigin.y, dx, dy);
      } else if (t.identifier === this.aimTouchId) {
        let dx = t.clientX - this.aimOrigin.x;
        let dy = t.clientY - this.aimOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > R) { dx *= R / len; dy *= R / len; }
        this.aimX = dx / R;
        this.aimY = dy / R;
        this.showStick(this.stickAim, this.aimOrigin.x, this.aimOrigin.y, dx, dy);
      }
    }
  }

  private onTouchEnd(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.moveTouchId) {
        this.moveTouchId = null;
        this.moveX = 0;
        this.moveY = 0;
        this.stickMove.style.display = 'none';
      } else if (t.identifier === this.aimTouchId) {
        this.aimTouchId = null;
        this.aimX = 0;
        this.aimY = 0;
        this.aiming = false;
        this.stickAim.style.display = 'none';
      }
    }
  }

  private showStick(el: HTMLElement, ox: number, oy: number, dx: number, dy: number) {
    el.style.display = 'block';
    const local = clientToStage(ox, oy);
    const base = el.querySelector('.base') as HTMLElement;
    const knob = el.querySelector('.knob') as HTMLElement;
    base.style.left = `${local.x}px`;
    base.style.top = `${local.y}px`;
    knob.style.left = `${local.x + dx}px`;
    knob.style.top = `${local.y + dy}px`;
  }

  /** 汇总键盘方向到 move 向量（触摸优先） */
  pollKeyboard() {
    if (this.moveTouchId !== null) return;
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.moveX = x;
    this.moveY = y;
  }
}
