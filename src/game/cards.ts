import type { LineId, SkillKey } from '../fx/catalog';
import { lineName, skillGlyphOnDay, skillNameOnDay } from '../fx/days';
import type { WeekdayId } from '../levels';
import { sfx } from '../audio';

/**
 * 不暂停抽卡：一套三选一同时混入冲撞属性和主动技能。
 * 卡片出现在顶部「预计下班」正下方；倒计时为预计下班面板描边环（真实 8 秒墙钟），
 * 从 12 点逆时针收完一圈就替玩家随机一张（toast 带「随机 ·」前缀），牌面必须能自己关掉，
 * 否则它会一直挂着，工牌在背后越攒越多，玩家点一下就连着弹好几轮。
 * 被塞任务会冲掉一张候选，保底留一张，两次之间隔 KNOCK_CD，并在原卡位飘字说明。
 * 游戏不暂停，卡片带就压在操作区上，所以选卡判定要严：只有卡片本身吃输入，
 * 且必须按下和抬手落在同一张卡、位移不超过 TAP_SLOP 才算选中。
 * 不用浏览器补发的 click——摇杆 preventDefault 之后触屏根本不会补。
 * 发牌那一刻已经按下的键 / 指针一律不算，松开重按才作数。
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
const PICK_KEYS: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2 };
/** 按下到抬手的位移上限（px）：超过就当成推摇杆划过去的，不算选卡 */
const TAP_SLOP = 12;
/** 两次「任务冲掉一张」之间的最短间隔（ms）。被围时任务会连着落地，不挡就会瞬间只剩一张 */
const KNOCK_CD = 1500;
/** 只剩一张时的缓冲（ms）：让玩家看清是哪张，然后直接替他装上 */
const LAST_CARD_MS = 1200;

export class Cards {
  line: LineId | null = null;
  lineLv = 0;
  skill: SkillId | null = null;
  skillLv = 0;
  private dashBest: Partial<Record<LineId, number>> = {};
  private skillBest: Partial<Record<SkillId, number>> = {};

  private badges = 0;
  private quota = FIRST_QUOTA;

  private open = false;
  private offered: Card[] = [];
  private cardEls: HTMLElement[] = [];
  /** 抽卡截止墙钟时间（ms）；≤0 表示尚未开始计时 */
  private pickUntil = 0;
  /** 本段计时的总长度（ms），描边环按它换算比例 */
  private pickSpan = PICK_TIME * 1000;
  /** 上次被任务冲掉卡的时刻，用来隔开连续销毁 */
  private lastKnockAt = 0;
  /** 发牌序号，过期点击不算 */
  private offerGen = 0;
  /** 发牌时已经按下的指针 / 数字键：松开前不算选卡 */
  private staleIds = new Set<number>();
  private downIds = new Set<number>();
  private staleKeys = new Set<string>();
  private downKeys = new Set<string>();
  /** 当前压在某张卡上的指针；抬手时要落回同一张卡且几乎没位移才算选中 */
  private press: { el: HTMLElement; id: number; x: number; y: number } | null = null;
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
      this.downKeys.add(e.code);
      if (e.code === 'Space' || e.code === 'Enter') {
        if (this.open) e.preventDefault();
        return;
      }
      if (!this.open || e.repeat) return;
      const n = PICK_KEYS[e.code];
      if (n === undefined || n >= this.offered.length) return;
      if (this.staleKeys.has(e.code)) return;
      this.select(n);
    });
    window.addEventListener('keyup', (e) => {
      this.downKeys.delete(e.code);
      this.staleKeys.delete(e.code);
    });
    window.addEventListener('pointerdown', (e) => {
      this.downIds.add(e.pointerId);
    }, true);
    const releasePtr = (e: PointerEvent) => {
      this.downIds.delete(e.pointerId);
      this.staleIds.delete(e.pointerId);
    };
    window.addEventListener('pointerup', releasePtr, true);
    window.addEventListener('pointercancel', (e) => {
      releasePtr(e);
      if (this.press?.id === e.pointerId) this.press = null;
    }, true);
    // 冒泡阶段兜底：卡片自己的 pointerup 先跑过了，这里只负责清掉按压态
    window.addEventListener('pointerup', (e) => {
      if (this.press?.id === e.pointerId) this.press = null;
    });
    new ResizeObserver(() => {
      if (!this.open) return;
      this.layoutRing();
      this.setRing(this.ringRatio);
    }).observe(this.shellEl);
    this.dashBtn.tabIndex = -1;
    this.skillBtn.tabIndex = -1;
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) resetBtn.tabIndex = -1;
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
    this.dashBest = {};
    this.skillBest = {};
    this.badges = 0;
    this.quota = FIRST_QUOTA;
    this.open = false;
    this.offered = [];
    this.pickUntil = 0;
    this.staleIds.clear();
    this.staleKeys.clear();
    this.press = null;
    this.offerGen += 1;
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
    if (left <= 0) {
      // 收完一圈就替玩家随机一张。牌面必须能自己关掉，
      // 否则它会一直挂着，工牌在后面越攒越多，等玩家点一下就连着弹好几轮。
      this.autoPick();
      return;
    }
    this.setRing(Math.max(0, Math.min(1, left / this.pickSpan)));
  }

  private autoPick() {
    if (!this.open || !this.offered.length) return;
    this.select((Math.random() * this.offered.length) | 0, true);
  }

  /** 把剩下的唯一一张改成短计时，到点直接装上，不让玩家对着单选项干等 */
  private armLastCard() {
    if (this.pickUntil <= 0) return;
    this.pickSpan = LAST_CARD_MS;
    this.pickUntil = Math.min(this.pickUntil, performance.now() + LAST_CARD_MS);
    this.setRing(1);
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
    const now = performance.now();
    if (now - this.lastKnockAt < KNOCK_CD) return false;
    this.lastKnockAt = now;
    const i = (Math.random() * this.offered.length) | 0;
    this.offered.splice(i, 1);
    const el = this.cardEls.splice(i, 1)[0];
    this.puff(el);
    this.burnNote(el);
    sfx.play('card_burn');
    el.style.visibility = 'hidden';
    el.style.pointerEvents = 'none';
    setTimeout(() => el.remove(), 400);
    if (this.press?.el === el) this.press = null;
    this.cardEls.forEach((c, j) => {
      const k = c.querySelector('.ckey');
      if (k) k.textContent = String(j + 1);
    });
    if (this.offered.length === 1) this.armLastCard();
    return true;
  }

  /** 原卡藏掉，原地喷一股微粒烟。一块复用 canvas，不进战场 WebGPU。 */
  private puff(el: HTMLElement) {
    puffSmoke(el.getBoundingClientRect());
  }

  /** 在被冲掉那张卡的位置飘一句，区分「被任务打掉」和「自己选中」 */
  private burnNote(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const note = document.createElement('div');
    note.className = 'cardBurn';
    note.textContent = '任务冲掉一张！';
    note.style.left = `${r.left + r.width / 2}px`;
    note.style.top = `${r.top + r.height / 2}px`;
    document.body.appendChild(note);
    setTimeout(() => note.remove(), 900);
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
        const owned = this.dashBest[id] ?? 0;
        dash.push({ track: 'dash', id, toLevel: Math.max(1, owned), isSwitch: this.line !== null });
      }
    }
    const skill: Card[] = [];
    for (const id of this.skillIds) {
      if (id === this.skill) {
        if (this.skillLv < 3) skill.push({ track: 'skill', id, toLevel: this.skillLv + 1, isSwitch: false });
      } else {
        const owned = this.skillBest[id] ?? 0;
        skill.push({ track: 'skill', id, toLevel: Math.max(1, owned), isSwitch: this.skill !== null });
      }
    }
    return { dash, skill };
  }

  private offer() {
    const { dash, skill } = this.buildPool();
    const upgrades = [...dash, ...skill].filter((c) => c.toLevel > 1);
    const fresh = [...dash, ...skill].filter((c) => c.toLevel === 1);
    shuffle(upgrades);
    shuffle(fresh);
    const picks: Card[] = [];
    const take = (src: Card[], n: number) => {
      for (let k = 0; k < n && src.length; k++) picks.push(src.pop()!);
    };
    // 已有的冲刺/技能优先出下一档，避免只看见同名 LV1 换系
    take(upgrades, 2);
    take(fresh, 3 - picks.length);
    // 一边抽空了就拿另一边补满，别让牌面缩到两张
    take(upgrades, 3 - picks.length);
    if (!picks.length) return;
    shuffle(picks);
    this.offered = picks;
    this.open = true;
    this.pickUntil = 0;
    // 每次发牌重置销毁冷却，保证新的三张至少能完整看 KNOCK_CD 这么久
    this.lastKnockAt = performance.now();
    this.staleIds = new Set(this.downIds);
    this.staleKeys = new Set(this.downKeys);
    this.press = null;
    this.offerGen += 1;
    this.renderCards();
    sfx.play('card_deal');
  }

  private renderCards() {
    this.listEl.innerHTML = '';
    this.cardEls = [];
    this.offered.forEach((c, i) => {
      const m = this.metaOf(c);
      const btn = document.createElement('div');
      btn.className = 'card' + (c.track === 'dash' ? ' cardDash' : '');
      btn.style.borderColor = m.color;
      btn.setAttribute('role', 'button');
      btn.tabIndex = -1;
      const tag = !c.isSwitch && c.toLevel > 1
        ? `升级 LV${c.toLevel}`
        : c.isSwitch
          ? `换系 LV${c.toLevel}`
          : '新 LV1';
      btn.innerHTML =
        `<div class="cglyph">${m.glyph}</div>` +
        `<div class="cname" style="color:${m.color}">${m.name}</div>` +
        `<div class="ctag">${tag}</div>` +
        `<div class="cdesc">${m.descs[c.toLevel - 1]}</div>` +
        `<div class="ckey">${i + 1}</div>`;
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (this.staleIds.has(e.pointerId)) {
          this.press = null;
          return;
        }
        this.press = { el: btn, id: e.pointerId, x: e.clientX, y: e.clientY };
      });
      // 只认自己判定的轻点。浏览器在触屏上补发的 click 目标和时机都不受控，
      // 而且摇杆一旦 preventDefault 就根本不会补，统一走 pointerup 两边行为才一致。
      btn.addEventListener('pointerup', (e) => {
        const p = this.press;
        this.press = null;
        if (!p || p.el !== btn || p.id !== e.pointerId) return;
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP) return;
        // 现查位置：knockOneOut 抽掉前面的卡后，发牌时的序号已经不作数
        const at = this.cardEls.indexOf(btn);
        if (at < 0) return;
        this.select(at);
      });
      this.listEl.appendChild(btn);
      this.cardEls.push(btn);
    });
    this.rowEl.style.display = 'block';
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.setPicking(true);
    const gen = this.offerGen;
    // 等布局完成再开表，避免环还没画就开始扣时间
    requestAnimationFrame(() => {
      if (this.offerGen !== gen || !this.open) return;
      this.layoutRing();
      // 只发出一张时没什么可挑的，短暂亮一下就替玩家装上
      this.pickSpan = this.offered.length === 1 ? LAST_CARD_MS : PICK_TIME * 1000;
      this.pickUntil = performance.now() + this.pickSpan;
      this.setRing(1);
    });
  }

  private select(i: number, auto = false) {
    if (!this.open) return;
    if (i < 0 || i >= this.offered.length) {
      // 牌面和数据对不上时收掉这一轮，别让 open 永远为真把后面的发牌全挡住
      this.dismiss();
      return;
    }
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
    this.dismiss();
    this.apply(c, auto);
  }

  /** 收起牌面并停表，不改卡组 */
  private dismiss() {
    this.open = false;
    this.press = null;
    this.rowEl.style.display = 'none';
    this.pickUntil = 0;
    this.staleIds.clear();
    this.staleKeys.clear();
    this.setPicking(false);
    if (document.activeElement instanceof HTMLElement && this.rowEl.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    this.renderBadge();
  }

  private apply(c: Card, auto = false) {
    if (c.track === 'dash') {
      const id = c.id as LineId;
      if (id === this.line) this.lineLv = Math.max(this.lineLv, c.toLevel);
      else {
        this.line = id;
        this.lineLv = Math.max(this.dashBest[id] ?? 1, c.toLevel);
      }
      this.dashBest[id] = Math.max(this.dashBest[id] ?? 0, this.lineLv);
    } else {
      const id = c.id as SkillId;
      if (id === this.skill) this.skillLv = Math.max(this.skillLv, c.toLevel);
      else {
        this.skill = id;
        this.skillLv = Math.max(this.skillBest[id] ?? 1, c.toLevel);
      }
      this.skillBest[id] = Math.max(this.skillBest[id] ?? 0, this.skillLv);
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

const PUFF_N = 44;
const PUFF_PX = 168;

type SmokeBit = { x: number; y: number; vx: number; vy: number; r: number; a: number; life: number; max: number };

let puffCanvas: HTMLCanvasElement | null = null;
let puffCtx: CanvasRenderingContext2D | null = null;
let puffRaf = 0;

/** 复用一块小画布喷微粒。冷却保证同时最多一股，不和 3D 渲染抢 GPU。 */
function puffSmoke(rect: DOMRect) {
  if (!puffCanvas) {
    puffCanvas = document.createElement('canvas');
    puffCanvas.className = 'cardPuff';
    puffCanvas.width = PUFF_PX;
    puffCanvas.height = PUFF_PX;
    puffCtx = puffCanvas.getContext('2d', { alpha: true });
    document.body.appendChild(puffCanvas);
  }
  const canvas = puffCanvas;
  const ctx = puffCtx;
  if (!ctx) return;
  canvas.style.left = `${rect.left + rect.width / 2 - PUFF_PX / 2}px`;
  canvas.style.top = `${rect.top + rect.height / 2 - PUFF_PX / 2}px`;
  canvas.style.display = 'block';

  const cx = PUFF_PX / 2;
  const cy = PUFF_PX / 2;
  const bits: SmokeBit[] = [];
  for (let i = 0; i < PUFF_N; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 24 + Math.random() * 86;
    bits.push({
      x: cx + (Math.random() - 0.5) * 16,
      y: cy + (Math.random() - 0.5) * 12,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd * 0.62 - 28,
      r: 1.1 + Math.random() * 2.6,
      a: 0.5 + Math.random() * 0.45,
      life: 0,
      max: 0.26 + Math.random() * 0.24,
    });
  }

  let last = performance.now();
  const stop = last + 520;
  cancelAnimationFrame(puffRaf);
  const tick = (now: number) => {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, PUFF_PX, PUFF_PX);
    let alive = false;
    for (const p of bits) {
      p.life += dt;
      if (p.life >= p.max) continue;
      alive = true;
      const u = p.life / p.max;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.9;
      p.vy = p.vy * 0.9 - 22 * dt;
      const fade = u < 0.1 ? u / 0.1 : 1 - (u - 0.1) / 0.9;
      ctx.beginPath();
      ctx.fillStyle = `rgba(236,232,224,${(p.a * fade).toFixed(3)})`;
      ctx.arc(p.x, p.y, p.r * (1 + u * 1.8), 0, Math.PI * 2);
      ctx.fill();
    }
    if (alive && now < stop) puffRaf = requestAnimationFrame(tick);
    else canvas.style.display = 'none';
  };
  puffRaf = requestAnimationFrame(tick);
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
