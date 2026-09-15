import type { LineId, SkillKey } from '../fx/catalog';
import { lineName, skillGlyphOnDay, skillNameOnDay } from '../fx/days';
import type { WeekdayId } from '../levels';
import { sfx } from '../audio';

/**
 * 不暂停抽卡：一套三选一同时混入冲撞属性和主动技能。
 * 卡片出现在顶部「预计下班」正下方；倒计时为预计下班面板描边环（真实 8 秒墙钟），
 * 从 12 点逆时针收完一圈即超时自动随机一张，再飞入右下角对应按钮。
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
    name: '蛮力冲', glyph: '💪', color: '#ff6b57',
    descs: ['撞飞同事，飞人可当炮弹', '撞停更沉，人球连锁', '连主管也能推开'],
  },
  slump: {
    name: '倦怠冲', glyph: '😩', color: '#8aa0b8',
    descs: ['撞人后脚下困意圈', '冲刺路径拖减速带', '主管也会被拖慢'],
  },
  phantom: {
    name: '幻影冲', glyph: '👻', color: '#8ea2ff',
    descs: ['冲刺穿人，穿过即晕', '起冲留虚影骗咬一次', '短无敌，冲完可虚化'],
  },
  rebound: {
    name: '反弹冲', glyph: '↩️', color: '#ff9a4d',
    descs: ['撞墙折向再冲一段', '折向带小冲击波', '可碰主管折向，弹开截杀'],
  },
  reclock: {
    name: '补卡冲', glyph: '🪪', color: '#57d9c4',
    descs: ['冲完 0.35s 内可再按第二段', '窗口更长，二段命中退冷却', '两段都中再自动滑一步'],
  },
  blame: {
    name: '甩锅冲', glyph: '🍲', color: '#d4a017',
    descs: ['撞到的人背锅，附近改追他', '背锅更久，更多人上当', '空挥也能脚下甩一口锅'],
  },
};

export const SKILLS: Record<SkillId, Meta> = {
  decoy: {
    name: '工位马甲', glyph: '🪧', color: '#57d98f',
    descs: ['纸板替身吸走仇恨 4 秒', '替身坚持 6 秒', '替身到期爆炸放倒周围'],
  },
  keyboard: {
    name: '横飞鼠标', glyph: '🖱️', color: '#ffd257',
    descs: ['掷出去程放倒', '轨迹更宽', '去返双程全部放倒'],
  },
  coffee: {
    name: '喝咖啡', glyph: '☕', color: '#c98a4b',
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
  /** 抽卡截止墙钟时间（ms）；≤0 表示尚未开始计时 */
  private pickUntil = 0;
  private ringLen = 0;
  private ringRatio = 0;
  private readonly ringStroke = 1.5;
  private readonly ringRadius = 26;

  private rowEl = document.getElementById('cardRow')!;
  private listEl = document.getElementById('cardList')!;
  private shellEl = document.getElementById('deadlineShell')!;
  private ringSvg = document.getElementById('pickRing') as unknown as SVGSVGElement;
  private ringTrack = document.getElementById('pickRingTrack') as unknown as SVGPathElement;
  private ringProg = document.getElementById('pickRingProg') as unknown as SVGPathElement;
  private badgeEl = document.getElementById('badgeInfo')!;
  private dashBtn = document.getElementById('dashBtn')!;
  private skillBtn = document.getElementById('skillBtn')!;
  private cdNumEl: HTMLElement | null = null;
  private lastCdTxt = '';

  private dashIds: LineId[] = Object.keys(LINES) as LineId[];
  private skillIds: SkillId[] = Object.keys(SKILLS) as SkillId[];
  private day: WeekdayId = 'monday';

  onApplied: ((label: string) => void) | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      const map: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2 };
      const n = map[e.code];
      if (n !== undefined && n < this.offered.length) this.select(n);
    });
    new ResizeObserver(() => {
      if (!this.open) return;
      this.layoutRing();
      this.setRing(this.ringRatio);
    }).observe(this.shellEl);
    this.renderBadge();
    this.renderButtons();
  }

  get isOpen() {
    return this.open;
  }

  /** 这一关能抽到的冲刺和主动技能。没规划的关传入周一那套。 */
  setDayKit(day: WeekdayId, dashes: LineId[], skills: SkillId[]) {
    this.day = day;
    this.dashIds = dashes.length ? dashes : (Object.keys(LINES) as LineId[]);
    this.skillIds = skills.length ? skills : (Object.keys(SKILLS) as SkillId[]);
  }

  /** 再试一次：工牌、卡组和抽卡界面全部清掉 */
  resetRun() {
    this.line = null;
    this.lineLv = 0;
    this.skill = null;
    this.skillLv = 0;
    this.badges = 0;
    this.quota = FIRST_QUOTA;
    this.open = false;
    this.offered = [];
    this.pickUntil = 0;
    for (const el of this.cardEls) el.remove();
    this.cardEls = [];
    this.listEl.innerHTML = '';
    this.rowEl.style.display = 'none';
    this.setPicking(false);
    this.dashBtn.style.borderColor = '';
    this.dashBtn.style.background = '';
    this.skillBtn.style.borderColor = '';
    this.skillBtn.style.background = '';
    this.renderBadge();
    this.renderButtons();
  }

  /** 击倒同事获得工牌，攒满配额触发抽卡 */
  addBadges(n: number) {
    this.badges += n;
    this.tryOffer();
    this.renderBadge();
  }

  update(_dt: number) {
    if (!this.open) {
      this.tryOffer();
      return;
    }
    // 用墙钟对齐真实秒数：不受 fixedUpdate 掉帧/限步影响
    if (this.pickUntil <= 0) return;
    const left = this.pickUntil - performance.now();
    const ratio = Math.max(0, Math.min(1, left / (PICK_TIME * 1000)));
    this.setRing(ratio);
    if (left <= 0) this.select((Math.random() * this.offered.length) | 0, true);
  }

  /** 抽卡中：显示预计下班描边环 */
  private setPicking(on: boolean) {
    this.shellEl.classList.toggle('picking', on);
    if (!on) this.setRing(0);
  }

  /** 按面板描边位置铺环；路径从顶边中点（12 点）起逆时针一圈 */
  private layoutRing() {
    const w = this.shellEl.clientWidth;
    const h = this.shellEl.clientHeight;
    if (w < 4 || h < 4) return;
    const stroke = this.ringStroke;
    this.ringSvg.setAttribute('width', String(w));
    this.ringSvg.setAttribute('height', String(h));
    this.ringSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.ringSvg.style.left = '0';
    this.ringSvg.style.top = '0';

    // 描边中心线落在面板 border 中线上
    const x = stroke / 2;
    const y = stroke / 2;
    const rw = w - stroke;
    const rh = h - stroke;
    const r = Math.max(0.5, Math.min(this.ringRadius - stroke / 2, rw / 2, rh / 2));
    const d = roundedRectPathCCWFromTop(x, y, rw, rh, r);
    for (const p of [this.ringTrack, this.ringProg]) {
      p.setAttribute('d', d);
      p.setAttribute('stroke-width', String(stroke));
      p.removeAttribute('transform');
    }
    this.ringLen = this.ringProg.getTotalLength();
    this.ringTrack.style.strokeDasharray = '';
    this.ringTrack.style.strokeDashoffset = '';
  }

  private setRing(ratio: number) {
    this.ringRatio = Math.max(0, Math.min(1, ratio));
    const L = this.ringLen;
    if (!(L > 0)) return;
    // dash=周长、offset 线性：ratio 1→0 对应满环→空环，与真实剩余时间成正比
    this.ringProg.style.strokeDasharray = `${L}`;
    this.ringProg.style.strokeDashoffset = `${L * (1 - this.ringRatio)}`;
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
    if (c.track === 'dash') {
      const id = c.id as LineId;
      return { ...LINES[id], name: lineName(this.day, id) };
    }
    const id = c.id as SkillId;
    return { ...SKILLS[id], name: skillNameOnDay(this.day, id), glyph: skillGlyphOnDay(this.day, id) };
  }

  private buildPool() {
    const dash: Card[] = [];
    for (const id of this.dashIds) {
      if (id === this.line) {
        if (this.lineLv < 3) dash.push({ track: 'dash', id, toLevel: this.lineLv + 1, isSwitch: false });
      } else {
        dash.push({ track: 'dash', id, toLevel: 1, isSwitch: this.line !== null });
      }
    }
    const skill: Card[] = [];
    for (const id of this.skillIds) {
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
    this.pickUntil = 0;
    this.renderCards();
    sfx.play('card_deal');
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
    this.rowEl.style.display = 'block';
    this.setPicking(true);
    // 等布局完成再开表，避免环还没画就开始扣时间
    requestAnimationFrame(() => {
      this.layoutRing();
      this.pickUntil = performance.now() + PICK_TIME * 1000;
      this.setRing(1);
    });
  }

  private select(i: number, auto = false) {
    if (!this.open || i < 0 || i >= this.offered.length) return;
    this.open = false;
    sfx.play('card_pick');
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
    this.pickUntil = 0;
    this.setPicking(false);
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
      const m = { ...LINES[this.line], name: lineName(this.day, this.line) };
      this.dashBtn.style.borderColor = m.color;
      this.dashBtn.style.background = m.color + '38';
      this.dashBtn.innerHTML = `<div class="blab">${m.glyph}<br>冲刺</div>${pips(this.lineLv)}`;
    } else {
      this.dashBtn.innerHTML = '冲刺';
    }

    if (this.skill) {
      const m = { ...SKILLS[this.skill], name: skillNameOnDay(this.day, this.skill), glyph: skillGlyphOnDay(this.day, this.skill) };
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

/** 圆角矩形描边：从顶边中点出发，逆时针闭合（SVG sweep=0 为逆时针） */
function roundedRectPathCCWFromTop(x: number, y: number, w: number, h: number, r: number) {
  const cx = x + w / 2;
  const x1 = x + r;
  const x2 = x + w - r;
  const y1 = y + r;
  const y2 = y + h - r;
  return [
    `M ${cx} ${y}`,
    `L ${x1} ${y}`,
    `A ${r} ${r} 0 0 0 ${x} ${y1}`,
    `L ${x} ${y2}`,
    `A ${r} ${r} 0 0 0 ${x1} ${y + h}`,
    `L ${x2} ${y + h}`,
    `A ${r} ${r} 0 0 0 ${x + w} ${y2}`,
    `L ${x + w} ${y1}`,
    `A ${r} ${r} 0 0 0 ${x2} ${y}`,
    `L ${cx} ${y}`,
  ].join(' ');
}
