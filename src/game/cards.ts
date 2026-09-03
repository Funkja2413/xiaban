import type { LineId, SkillKey } from '../fx/catalog';

/**
 * 不暂停抽卡：一套三选一同时混入冲撞属性和主动技能。
 * 卡片出现在顶部「预计下班」正下方，8 秒倒计时；
 * 玩家点选，或超时自动随机一张，再飞入右下角对应按钮。
 */
export type { LineId };
export type SkillId = SkillKey;

interface Meta {
  name: string;
  glyph: string;
  color: string;
  /** 各等级效果描述（索引 = level-1） */
  descs: [string, string, string];
}

export const LINES: Record<LineId, Meta> = {
  brute: {
    name: '蛮力', glyph: '💪', color: '#ff6b57',
    descs: ['撞飞更猛，飞人变炮弹', '冲撞范围大增', '连主管也能推开'],
  },
  slump: {
    name: '倦怠', glyph: '😩', color: '#8aa0b8',
    descs: ['撞到人，周围提不起劲', '减速范围更大更久', '主管也会被拖慢'],
  },
  phantom: {
    name: '幻影', glyph: '👻', color: '#8ea2ff',
    descs: ['冲刺穿人，穿过即晕', '每穿一人冲刺回充', '冲刺后短暂虚化'],
  },
};

export const SKILLS: Record<SkillId, Meta> = {
  decoy: {
    name: '摸鱼分身', glyph: '🪧', color: '#57d98f',
    descs: ['纸板替身吸走仇恨 4 秒', '替身坚持 6 秒', '替身到期爆炸放倒周围'],
  },
  keyboard: {
    name: '回旋键盘', glyph: '⌨️', color: '#ffd257',
    descs: ['掷出键盘，去程放倒', '往返轨迹更宽', '去返双程全部放倒'],
  },
  coffee: {
    name: '咖啡', glyph: '☕', color: '#c98a4b',
    descs: ['朝前泼一滩，踩到滑倒', '渍更大更持久', '连泼三滩再溅一大摊'],
  },
};

interface Card {
  track: 'dash' | 'skill';
  id: LineId | SkillId;
  toLevel: number;
  isSwitch: boolean;
}

const PICK_TIME = 8;
const FIRST_QUOTA = 3;
const QUOTA_STEP = 3;

export class Cards {
  line: LineId | null = null;
  lineLv = 0;
  skill: SkillId | null = null;
  skillLv = 0;

  private badges = 0;
  private quota = FIRST_QUOTA;

  private open = false;
  private offered: Card[] = [];
  private cardEls: HTMLElement[] = [];
  private timer = 0;

  private rowEl = document.getElementById('cardRow')!;
  private listEl = document.getElementById('cardList')!;
  private barEl = document.getElementById('cardTimerBar')!;
  private secsEl = document.getElementById('cardSecs')!;
  private badgeEl = document.getElementById('badgeInfo')!;
  private dashBtn = document.getElementById('dashBtn')!;
  private skillBtn = document.getElementById('skillBtn')!;
  private cdNumEl: HTMLElement | null = null;
  private lastCdTxt = '';

  onApplied: ((label: string) => void) | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      const map: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2 };
      const n = map[e.code];
      if (n !== undefined && n < this.offered.length) this.select(n);
    });
    this.renderBadge();
    this.renderButtons();
  }

  get isOpen() {
    return this.open;
  }

  /** 击倒同事获得工牌，攒满配额触发抽卡 */
  addBadges(n: number) {
    this.badges += n;
    this.tryOffer();
    this.renderBadge();
  }

  update(dt: number) {
    if (!this.open) {
      this.tryOffer();
      return;
    }
    this.timer -= dt;
    const ratio = Math.max(0, this.timer / PICK_TIME);
    this.barEl.style.width = `${ratio * 100}%`;
    this.secsEl.textContent = `${Math.max(0, Math.ceil(this.timer))}s`;
    if (this.timer <= 0) this.select((Math.random() * this.offered.length) | 0, true);
  }

  /** 被塞任务时随机打掉一张候选卡；返回是否打掉 */
  knockOneOut(): boolean {
    if (!this.open || this.offered.length <= 1) return false;
    const i = (Math.random() * this.offered.length) | 0;
    this.offered.splice(i, 1);
    const el = this.cardEls.splice(i, 1)[0];
    el.style.pointerEvents = 'none';
    el.style.transition = 'transform 0.3s ease-in, opacity 0.3s';
    el.style.transform = 'translateY(30px) rotate(14deg)';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
    this.cardEls.forEach((c, j) => {
      const k = c.querySelector('.ckey');
      if (k) k.textContent = String(j + 1);
    });
    return true;
  }

  private tryOffer() {
    if (this.open || this.badges < this.quota) return;
    this.badges -= this.quota;
    this.quota += QUOTA_STEP;
    this.offer();
    this.renderBadge();
  }

  private metaOf(c: Card): Meta {
    return c.track === 'dash' ? LINES[c.id as LineId] : SKILLS[c.id as SkillId];
  }

  private buildPool() {
    const dash: Card[] = [];
    for (const id of Object.keys(LINES) as LineId[]) {
      if (id === this.line) {
        if (this.lineLv < 3) dash.push({ track: 'dash', id, toLevel: this.lineLv + 1, isSwitch: false });
      } else {
        dash.push({ track: 'dash', id, toLevel: 1, isSwitch: this.line !== null });
      }
    }
    const skill: Card[] = [];
    for (const id of Object.keys(SKILLS) as SkillId[]) {
      if (id === this.skill) {
        if (this.skillLv < 3) skill.push({ track: 'skill', id, toLevel: this.skillLv + 1, isSwitch: false });
      } else {
        skill.push({ track: 'skill', id, toLevel: 1, isSwitch: this.skill !== null });
      }
    }
    return { dash, skill };
  }

  private offer() {
    const { dash, skill } = this.buildPool();
    shuffle(dash);
    shuffle(skill);
    const picks: Card[] = [];
    const twoDash = Math.random() < 0.5;
    const take = (src: Card[], n: number) => {
      for (let k = 0; k < n && src.length; k++) picks.push(src.pop()!);
    };
    if (twoDash) {
      take(dash, 2);
      take(skill, 1);
    } else {
      take(skill, 2);
      take(dash, 1);
    }
    const rest = [...dash, ...skill];
    shuffle(rest);
    while (picks.length < 3 && rest.length) picks.push(rest.pop()!);
    if (!picks.length) return;
    shuffle(picks);
    this.offered = picks;
    this.open = true;
    this.timer = PICK_TIME;
    this.renderCards();
  }

  private renderCards() {
    this.listEl.innerHTML = '';
    this.cardEls = [];
    this.offered.forEach((c, i) => {
      const m = this.metaOf(c);
      const btn = document.createElement('button');
      btn.className = 'card' + (c.track === 'dash' ? ' cardDash' : '');
      btn.style.borderColor = m.color;
      const tag = c.toLevel > 1 ? `升级 LV${c.toLevel}` : c.isSwitch ? '换系 LV1' : '新 LV1';
      btn.innerHTML =
        `<div class="cglyph">${m.glyph}</div>` +
        `<div class="cname" style="color:${m.color}">${m.name}</div>` +
        `<div class="ctag">${tag}</div>` +
        `<div class="cdesc">${m.descs[c.toLevel - 1]}</div>` +
        `<div class="ckey">${i + 1}</div>`;
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.select(this.cardEls.indexOf(btn));
      }, { passive: false });
      btn.addEventListener('click', () => this.select(this.cardEls.indexOf(btn)));
      this.listEl.appendChild(btn);
      this.cardEls.push(btn);
    });
    this.barEl.style.width = '100%';
    this.secsEl.textContent = `${PICK_TIME}s`;
    this.rowEl.style.display = 'block';
  }

  private select(i: number, auto = false) {
    if (!this.open || i < 0 || i >= this.offered.length) return;
    this.open = false;
    const c = this.offered[i];
    const el = this.cardEls[i];
    el.classList.add('picked');
    this.cardEls.forEach((other, j) => {
      if (j === i) return;
      other.style.pointerEvents = 'none';
      other.style.transition = 'opacity 0.2s, transform 0.2s';
      other.style.opacity = '0';
      other.style.transform = 'scale(0.85)';
    });
    this.fly(el, c);
    this.rowEl.style.display = 'none';
    this.apply(c, auto);
    this.renderBadge();
  }

  private apply(c: Card, auto = false) {
    if (c.track === 'dash') {
      if (c.id === this.line) this.lineLv = c.toLevel;
      else {
        this.line = c.id as LineId;
        this.lineLv = 1;
      }
    } else {
      if (c.id === this.skill) this.skillLv = c.toLevel;
      else {
        this.skill = c.id as SkillId;
        this.skillLv = 1;
      }
    }
    this.renderButtons();
    const m = this.metaOf(c);
    const lv = c.track === 'dash' ? this.lineLv : this.skillLv;
    this.onApplied?.(`${auto ? '随机 · ' : ''}${m.glyph}${m.name} LV${lv}`);
  }

  /** 选中卡片飞入右下角按钮的动画 */
  private fly(el: HTMLElement, c: Card) {
    const from = el.getBoundingClientRect();
    const target = c.track === 'dash' ? this.dashBtn : this.skillBtn;
    const to = target.getBoundingClientRect();
    const m = this.metaOf(c);
    const chip = document.createElement('div');
    chip.className = 'flyChip';
    chip.textContent = m.glyph;
    chip.style.background = m.color;
    chip.style.left = `${from.left + from.width / 2 - 22}px`;
    chip.style.top = `${from.top + from.height / 2 - 22}px`;
    document.body.appendChild(chip);
    chip.getBoundingClientRect(); // 强制 reflow 以启用过渡
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    chip.style.transform = `translate(${dx}px, ${dy}px) scale(0.55)`;
    chip.style.opacity = '0.15';
    setTimeout(() => chip.remove(), 520);
  }

  private renderBadge() {
    this.badgeEl.textContent = this.open ? '选一张卡！' : `工牌 ${this.badges}/${this.quota}`;
  }

  private renderButtons() {
    const pips = (lv: number) =>
      `<div class="pips">${[1, 2, 3].map((k) => `<div class="pip${k <= lv ? ' on' : ''}"></div>`).join('')}</div>`;

    if (this.line) {
      const m = LINES[this.line];
      this.dashBtn.style.borderColor = m.color;
      this.dashBtn.style.background = m.color + '38';
      this.dashBtn.innerHTML = `<div class="blab">${m.glyph}<br>冲刺</div>${pips(this.lineLv)}`;
    } else {
      this.dashBtn.innerHTML = '冲刺';
    }

    if (this.skill) {
      const m = SKILLS[this.skill];
      this.skillBtn.classList.remove('empty');
      this.skillBtn.style.borderColor = m.color;
      this.skillBtn.style.background = m.color + '38';
      this.skillBtn.innerHTML =
        `<div class="blab">${m.glyph}<br>${m.name.slice(0, 2)}</div>${pips(this.skillLv)}<div class="cdnum"></div>`;
      this.cdNumEl = this.skillBtn.querySelector('.cdnum');
      this.lastCdTxt = '';
    } else {
      this.skillBtn.classList.add('empty');
      this.skillBtn.innerHTML = '技能<br><span class="hint">抽卡获得</span>';
      this.cdNumEl = null;
    }
  }

  /** 技能冷却展示（由 Game 每帧调用） */
  setSkillCd(cd: number) {
    if (!this.skill) return;
    const active = cd > 0.05;
    this.skillBtn.classList.toggle('cd', active);
    const txt = active ? String(Math.ceil(cd)) : '';
    if (txt !== this.lastCdTxt) {
      this.lastCdTxt = txt;
      if (this.cdNumEl) this.cdNumEl.textContent = txt;
    }
  }
}

function shuffle<T>(a: T[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
}
