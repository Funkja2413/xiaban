/** HUD：下班时间（血量）、性能统计、加班提示 */
export class Hud {
  /** 加班分钟数（18:00 起算），360 分钟 = 24:00 = 失败 */
  overtimeMin = 0;

  private deadlineEl = document.getElementById('deadline')!;
  private statsEl = document.getElementById('stats')!;
  private toastEl = document.getElementById('toast')!;
  private dashBtn = document.getElementById('dashBtn')!;
  private elevEl = document.getElementById('elevTimer')!;
  private overlayEl = document.getElementById('overlay')!;

  private frames = 0;
  private fpsTimer = 0;
  private fps = 0;
  private toastTimer = 0;

  backend = '...';

  addOvertime(min: number) {
    this.overtimeMin += min;
    this.toast(`+${min} 分钟加班！`);
    this.renderDeadline();
  }

  reduceOvertime(min: number) {
    this.overtimeMin = Math.max(0, this.overtimeMin - min);
    this.renderDeadline();
  }

  private renderDeadline() {
    const total = 18 * 60 + this.overtimeMin;
    if (this.overtimeMin >= 360) {
      this.deadlineEl.textContent = '24:00 今晚走不了了…';
      this.deadlineEl.classList.add('hit');
      return;
    }
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    this.deadlineEl.textContent = `预计下班 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    this.deadlineEl.classList.toggle('hit', this.overtimeMin >= 240);
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = '1';
    this.toastTimer = 1.0;
  }

  /** 电梯倒计时横幅；sec < 0 隐藏 */
  setElevatorTimer(text: string | null) {
    if (text === null) {
      this.elevEl.style.display = 'none';
    } else {
      this.elevEl.style.display = 'block';
      this.elevEl.textContent = text;
    }
  }

  showOverlay(title: string, sub: string) {
    this.overlayEl.style.display = 'flex';
    this.overlayEl.querySelector('.otitle')!.textContent = title;
    this.overlayEl.querySelector('.osub')!.innerHTML = sub;
  }

  /** 当前预计下班时间文本（结算用） */
  get deadlineText() {
    const total = 18 * 60 + this.overtimeMin;
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  update(dt: number, info: { enemies: number; channeling: number; stepMs: number; dashCd: number }) {
    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
      this.statsEl.innerHTML =
        `${this.backend} · ${this.fps} fps<br>` +
        `敌人 ${info.enemies} · 读条中 ${info.channeling}<br>` +
        `物理 ${info.stepMs.toFixed(1)} ms`;
    }

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.style.opacity = '0';
    }

    this.dashBtn.classList.toggle('cd', info.dashCd > 0);
  }
}
