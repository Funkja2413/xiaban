/** 循环 BGM + 办公室物件合成音效。设置里「音乐 / 音效」分开。 */
import type { WeekdayId } from './levels';
import { loadSettings } from './progress';

/**
 * Pixabay Content License（可商用，免署名）
 * home      Sneaky Piz - Quirky Eye / Sonican
 * monday    Sneaky Mystery - Agent Film Noir Loop / Sonican
 * tuesday   Sneaky Mystery Underscore / DesiFreeMusic
 * wednesday Spy Detective Robbery Music / MondaMusic
 * thursday  Hacker by Night / AspieDuck
 * friday    Secret Agent Loop 2 - Slick Spy / Sonican
 */
export type BgmId = WeekdayId | 'home';

export type SfxId =
  | 'channel'
  | 'stamp'
  | 'outlook'
  | 'clock_warn'
  | 'elev_call'
  | 'elev_tick'
  | 'elev_ding'
  | 'elev_open'
  | 'win'
  | 'lose'
  | 'dash'
  | 'dash_hit'
  | 'dash_bounce'
  | 'knockdown'
  | 'getup'
  | 'wet'
  | 'trip'
  | 'door_slam'
  | 'floor_clunk'
  | 'decoy'
  | 'keyboard'
  | 'keyboard_catch'
  | 'coffee'
  | 'card_deal'
  | 'card_pick'
  | 'card_burn'
  | 'ui_click'
  | 'ui_deny'
  | 'step'
  | 'spawn'
  | 'desk_slam'
  | 'intercept'
  | 'rally'
  | 'chair_roll'
  | 'slick_slip'
  | 'ready_tick'
  | 'ready_go';

type LoopId = 'channel' | 'decoy';

const FILES: Record<BgmId, string> = {
  home: 'audio/bgm/home.m4a',
  monday: 'audio/bgm/monday.m4a',
  tuesday: 'audio/bgm/tuesday.m4a',
  wednesday: 'audio/bgm/wednesday.m4a',
  thursday: 'audio/bgm/thursday.m4a',
  friday: 'audio/bgm/friday.m4a',
};

const VOICE_CAP: Partial<Record<SfxId, number>> = {
  dash_hit: 2,
  knockdown: 2,
  stamp: 2,
  outlook: 2,
  getup: 2,
  step: 2,
  chair_roll: 2,
  spawn: 2,
  slick_slip: 2,
};

const COOLDOWN: Partial<Record<SfxId, number>> = {
  channel: 0.45,
  elev_tick: 0.72,
  knockdown: 0.07,
  getup: 0.1,
  dash_hit: 0.05,
  ui_click: 0.04,
  ui_deny: 0.12,
  trip: 0.12,
  step: 0.14,
  spawn: 0.28,
  chair_roll: 0.18,
  slick_slip: 0.12,
  rally: 0.4,
  desk_slam: 0.25,
  intercept: 0.3,
};

const JITTER: Partial<Record<SfxId, number>> = {
  knockdown: 0.07,
  dash_hit: 0.06,
  getup: 0.05,
  trip: 0.06,
  stamp: 0.04,
  step: 0.08,
  chair_roll: 0.1,
  spawn: 0.06,
  slick_slip: 0.07,
};

function srcOf(id: BgmId) {
  return `${import.meta.env.BASE_URL}${FILES[id]}`;
}

function env(t: number, attack: number, decay: number) {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  const u = (t - attack) / decay;
  return u >= 1 ? 0 : (1 - u) * (1 - u);
}

function noise(i: number) {
  let x = (Math.imul(i, 374761393) + 17) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
  return (x / 4294967295) * 2 - 1;
}

function tone(t: number, hz: number, phase = 0) {
  return Math.sin(t * Math.PI * 2 * hz + phase);
}

class BgmPlayer {
  private el: HTMLAudioElement | null = null;
  private id: BgmId | null = null;
  private wanted: BgmId | null = null;
  private on = loadSettings().music;
  private volume = 0.336;
  private homeVolume = 0.266;
  private playKicks = 0;

  constructor() {
    const resume = () => {
      sfx.unlock();
      this.tryPlay();
    };
    window.addEventListener('pointerdown', resume, { passive: true });
    window.addEventListener('keydown', resume);
    window.addEventListener('touchend', resume, { passive: true });
    document.addEventListener('WeixinJSBridgeReady', resume, false);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') {
        this.el?.pause();
        return;
      }
      this.tryPlay();
    });
  }

  enabled() {
    return this.on;
  }

  setEnabled(on: boolean) {
    this.on = on;
    if (!on) {
      this.el?.pause();
      return;
    }
    if (this.wanted) this.play(this.wanted);
  }

  play(id: BgmId) {
    this.wanted = id;
    if (!this.enabled()) {
      this.el?.pause();
      return;
    }
    if (this.id === id && this.el) {
      this.el.volume = id === 'home' ? this.homeVolume : this.volume;
      this.tryPlay();
      return;
    }
    this.dispose();
    const el = new Audio(srcOf(id));
    el.loop = true;
    el.preload = 'auto';
    el.autoplay = true;
    el.volume = id === 'home' ? this.homeVolume : this.volume;
    el.setAttribute('playsinline', '');
    el.addEventListener('canplay', () => {
      if (this.el === el) this.tryPlay();
    });
    if (document.body) document.body.appendChild(el);
    this.el = el;
    this.id = id;
    this.tryPlay();
  }

  /** 结算时停 BGM；之后要再播需显式 play。 */
  stop() {
    this.wanted = null;
    if (this.el) {
      this.el.pause();
      this.el.currentTime = 0;
    }
  }

  halt() {
    this.wanted = null;
    this.dispose();
  }

  private tryPlay() {
    // wanted 被 stop() 清掉后不要因 pointerdown / 回前台误把旧轨续上
    if (!this.on || !this.el || !this.wanted) return;
    if (document.visibilityState !== 'visible') return;
    const el = this.el;
    if (!el.paused && el.currentTime > 0.05) return;
    const p = el.play();
    if (!p) return;
    void p.then(() => {
      this.playKicks = 0;
    }).catch(() => {
      if (this.el !== el || !this.wanted || this.playKicks >= 24) return;
      this.playKicks += 1;
      window.setTimeout(() => {
        if (this.el === el) this.tryPlay();
      }, 400);
    });
  }

  /** 进关倒计时里反复试播。手机换页会丢掉上一次点击的手势。 */
  kick() {
    this.tryPlay();
    const bridge = (window as unknown as { WeixinJSBridge?: { invoke: (n: string, p: object, cb: () => void) => void } }).WeixinJSBridge;
    if (bridge?.invoke && this.playKicks < 2) {
      try {
        bridge.invoke('getNetworkType', {}, () => this.tryPlay());
      } catch {
        /* ignore */
      }
    }
  }

  private dispose() {
    if (!this.el) return;
    this.el.pause();
    this.el.remove();
    this.el.removeAttribute('src');
    this.el.load();
    this.el = null;
    this.id = null;
  }
}

type Recipe = (t: number, i: number) => number;

class SfxPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<SfxId | `${LoopId}_loop`, AudioBuffer>();
  private voices = new Map<SfxId, number>();
  private lastAt = new Map<SfxId, number>();
  private loops = new Map<LoopId, { src: AudioBufferSourceNode; gain: GainNode }>();
  private loopOn = new Set<LoopId>();
  private on = loadSettings().sfx;
  private ready = false;
  private pending: SfxId[] = [];
  private resuming = false;

  enabled() {
    return this.on;
  }

  /** AudioContext 已跑起来（Safari / 换关刷新后要先点一下）。 */
  armed() {
    return !!this.ctx && this.ctx.state === 'running' && this.ready;
  }

  setEnabled(on: boolean) {
    this.on = on;
    if (!on) {
      this.pending.length = 0;
      this.stopAllLoops();
    }
  }

  unlock() {
    this.ensure();
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.ready) this.buildAll(ctx);
    // iOS：静音缓冲 + resume，确保手势后真的开声
    try {
      const bump = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = bump;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
    if (ctx.state === 'suspended' && !this.resuming) {
      this.resuming = true;
      void ctx.resume().finally(() => {
        this.resuming = false;
        this.flushPending();
      });
    } else if (ctx.state === 'running') {
      this.flushPending();
    }
  }

  play(id: SfxId) {
    if (!this.on) return;
    this.ensure();
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    if (!this.ready) this.buildAll(ctx);
    if (ctx.state === 'suspended') {
      if (this.pending.length < 12) this.pending.push(id);
      this.unlock();
      return;
    }
    this.start(id);
  }

  private flushPending() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const batch = this.pending.splice(0, this.pending.length);
    for (const id of batch) this.start(id);
  }

  /** 胜负结算：停 BGM，播更响的结束曲（音乐或音效任一开着就播）。 */
  playResult(kind: 'won' | 'lost') {
    bgm.stop();
    this.setChannel(false);
    this.setDecoy(false);
    const settings = loadSettings();
    if (!settings.music && !settings.sfx) return;
    const was = this.on;
    this.on = true;
    this.playLoud(kind === 'won' ? 'win' : 'lose', kind === 'won' ? 2.15 : 1.55);
    this.on = was;
  }

  /** 结算专用：在 master 上再抬一档，避免被环境音盖住 */
  private playLoud(id: SfxId, gain = 1.8) {
    if (!this.on) return;
    this.ensure();
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    if (!this.ready) this.buildAll(ctx);
    const kick = () => {
      if (!this.ctx || !this.master || this.ctx.state === 'suspended') return;
      const buf = this.buffers.get(id);
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      src.connect(g);
      g.connect(this.master);
      src.start();
    };
    if (ctx.state === 'suspended') {
      this.unlock();
      void ctx.resume().then(kick);
      return;
    }
    kick();
  }

  private start(id: SfxId) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || ctx.state === 'suspended') return;
    const now = ctx.currentTime;
    const cd = COOLDOWN[id] ?? 0;
    const prev = this.lastAt.get(id) ?? -99;
    if (now - prev < cd) return;
    const cap = VOICE_CAP[id] ?? 4;
    if ((this.voices.get(id) ?? 0) >= cap) return;
    const buf = this.buffers.get(id);
    if (!buf) return;
    this.lastAt.set(id, now);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const jitter = JITTER[id] ?? 0;
    if (jitter) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * jitter;
    const g = ctx.createGain();
    g.gain.value = 1;
    src.connect(g);
    g.connect(master);
    this.voices.set(id, (this.voices.get(id) ?? 0) + 1);
    src.onended = () => this.voices.set(id, Math.max(0, (this.voices.get(id) ?? 1) - 1));
    src.start();
  }

  setChannel(on: boolean) {
    this.setLoop('channel', on, 'channel');
  }

  setDecoy(on: boolean) {
    this.setLoop('decoy', on);
  }

  private setLoop(name: LoopId, on: boolean, startOneShot?: SfxId) {
    if (!this.on || !on) {
      this.stopNamedLoop(name);
      this.loopOn.delete(name);
      return;
    }
    this.unlock();
    if (this.loopOn.has(name)) return;
    this.loopOn.add(name);
    if (startOneShot) this.play(startOneShot);
    this.startNamedLoop(name);
  }

  private stopAllLoops() {
    this.stopNamedLoop('channel');
    this.stopNamedLoop('decoy');
    this.loopOn.clear();
  }

  private ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.36;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
  }

  private render(ctx: AudioContext, dur: number, fn: Recipe) {
    const rate = ctx.sampleRate;
    const n = Math.max(1, Math.floor(rate * dur));
    const buf = ctx.createBuffer(1, n, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const s = fn(i / rate, i);
      d[i] = s < -1 ? -1 : s > 1 ? 1 : s;
    }
    return buf;
  }

  private buildAll(ctx: AudioContext) {
    const put = (id: SfxId | `${LoopId}_loop`, dur: number, fn: Recipe) => {
      this.buffers.set(id, this.render(ctx, dur, fn));
    };

    put('channel', 0.22, (t, i) => env(t, 0.02, 0.2) * (noise(i) * 0.22 + noise(i + 19) * 0.08) * (0.55 + 0.45 * Math.sin(t * 38)));
    put('channel_loop', 1.8, (t, i) => {
      const n = noise(i) * 0.07 + noise(i + 31) * 0.04;
      const tick = ((i * 17) % 4800) < 70 ? noise(i + 3) * 0.05 * env((i % 4800) / ctx.sampleRate, 0.002, 0.03) : 0;
      return (n + tick) * (0.7 + 0.3 * Math.sin(t * 3.1));
    });
    put('stamp', 0.16, (t, i) => {
      const thud = tone(t, 90) * env(t, 0.004, 0.12) * 0.55;
      const paper = noise(i) * env(t, 0.002, 0.07) * 0.28;
      const click = tone(t, 920) * env(t, 0.001, 0.035) * 0.22;
      return thud + paper + click;
    });
    put('outlook', 0.28, (t) => {
      const a = tone(t, 880) * env(t, 0.006, 0.09) * 0.28;
      const b = t > 0.1 ? tone(t - 0.1, 1175) * env(t - 0.1, 0.006, 0.12) * 0.3 : 0;
      return a + b;
    });
    put('clock_warn', 0.42, (t) => {
      const step = t % 0.13;
      const n = Math.floor(t / 0.13);
      if (n > 2) return 0;
      return tone(t, 740 + n * 40) * env(step, 0.004, 0.09) * 0.32;
    });
    put('elev_call', 0.12, (t) => tone(t, 980) * env(t, 0.004, 0.1) * 0.28);
    put('elev_tick', 0.06, (t, i) => (tone(t, 1680) * 0.16 + noise(i) * 0.05) * env(t, 0.001, 0.05));
    put('elev_ding', 0.55, (t) => {
      const a = tone(t, 659) * env(t, 0.008, 0.28) * 0.3;
      const b = t > 0.12 ? tone(t - 0.12, 880) * env(t - 0.12, 0.008, 0.32) * 0.34 : 0;
      return a + b;
    });
    put('elev_open', 0.7, (t, i) => {
      const rumble = tone(t, 62) * env(t, 0.04, 0.62) * 0.28;
      const air = noise(i) * env(t, 0.05, 0.55) * 0.12;
      const ding = tone(t, 784) * env(t, 0.01, 0.22) * 0.16;
      return rumble + air + ding;
    });
    // 成功下班：响亮 ding + 上行旋律，约 4s
    put('win', 4.2, (t, i) => {
      const note = (at: number, hz: number, life: number, amp: number) => {
        const u = t - at;
        if (u < 0 || u > life) return 0;
        return (
          tone(u, hz) * env(u, 0.01, life - 0.01) * amp +
          tone(u, hz * 2) * env(u, 0.008, life * 0.65) * amp * 0.28 +
          tone(u, hz * 3) * env(u, 0.006, life * 0.4) * amp * 0.1
        );
      };
      const ding =
        tone(t, 988) * env(t, 0.006, 0.45) * 0.55 +
        tone(t, 1319) * env(t, 0.008, 0.55) * 0.42 +
        tone(t, 1976) * env(t, 0.01, 0.35) * 0.18;
      const melody =
        note(0.18, 523, 0.55, 0.42) +
        note(0.48, 659, 0.55, 0.46) +
        note(0.78, 784, 0.7, 0.5) +
        note(1.2, 880, 0.55, 0.42) +
        note(1.55, 784, 0.45, 0.38) +
        note(1.95, 988, 0.9, 0.55) +
        note(2.55, 1175, 1.2, 0.48) +
        note(3.1, 1568, 1.0, 0.4);
      const pad =
        t < 3.6
          ? (tone(t, 196) * 0.12 + tone(t, 262) * 0.1 + tone(t, 330) * 0.08) * env(t, 0.15, 3.4)
          : 0;
      const sparkle = t > 2.2 && t < 3.9 ? noise(i) * env(t - 2.2, 0.04, 1.4) * 0.1 : 0;
      return ding + melody + pad + sparkle;
    });
    // 走不了：打印机卡纸下行，闷、短促又拖一下，约 4s
    put('lose', 4.0, (t, i) => {
      const note = (at: number, hz: number, life: number, amp: number) => {
        const u = t - at;
        if (u < 0 || u > life) return 0;
        return tone(u, hz) * env(u, 0.02, life - 0.02) * amp;
      };
      const melody =
        note(0.0, 392, 0.7, 0.2) +
        note(0.45, 349, 0.7, 0.18) +
        note(0.95, 294, 0.85, 0.2) +
        note(1.55, 262, 1.0, 0.18) +
        note(2.3, 220, 1.4, 0.16);
      const grind = ((t * 95) % 1) * 2 - 1;
      const jam =
        t < 2.8
          ? (grind * 0.08 + noise(i) * 0.1 + tone(t, 160 - t * 28) * 0.1) * env(t, 0.05, 2.6)
          : 0;
      const thud = t > 2.6 ? tone(t - 2.6, 70) * env(t - 2.6, 0.01, 0.9) * 0.22 : 0;
      const paper = t > 2.7 ? noise(i) * env(t - 2.7, 0.02, 0.8) * 0.1 : 0;
      return melody + jam + thud + paper;
    });
    put('dash', 0.18, (t, i) => noise(i) * env(t, 0.008, 0.16) * (0.22 + 0.18 * (1 - t / 0.18)));
    put('dash_hit', 0.14, (t, i) => {
      const body = tone(t, 110) * env(t, 0.003, 0.11) * 0.42;
      const chair = noise(i) * env(t, 0.002, 0.06) * 0.2;
      return body + chair;
    });
    put('dash_bounce', 0.22, (t, i) => {
      const thud = tone(t, 72) * env(t, 0.004, 0.16) * 0.5;
      const spring = tone(t, 210) * env(t, 0.002, 0.1) * 0.18;
      return thud + spring + noise(i) * env(t, 0.002, 0.08) * 0.12;
    });
    put('knockdown', 0.28, (t, i) => {
      const chair = tone(t, 96) * env(t, 0.004, 0.14) * 0.36;
      const paper = noise(i) * env(t, 0.01, 0.22) * (0.16 + 0.1 * Math.sin(t * 70));
      const clack = tone(t, 640) * env(t, 0.002, 0.04) * 0.14;
      return chair + paper + clack;
    });
    put('getup', 0.2, (t, i) => noise(i) * env(t, 0.02, 0.16) * (0.14 + 0.08 * Math.sin(t * 42)));
    put('wet', 0.22, (t, i) => {
      const splash = noise(i) * env(t, 0.008, 0.18) * 0.28;
      const drip = tone(t, 320 - t * 180) * env(t, 0.01, 0.16) * 0.12;
      return splash + drip;
    });
    put('trip', 0.16, (t, i) => tone(t, 150) * env(t, 0.003, 0.12) * 0.4 + noise(i) * env(t, 0.002, 0.08) * 0.18);
    put('door_slam', 0.42, (t, i) => {
      const creak = tone(t, 180 + t * 90) * env(t, 0.02, 0.22) * 0.16;
      const slam = t > 0.16 ? tone(t - 0.16, 70) * env(t - 0.16, 0.004, 0.16) * 0.48 : 0;
      const wood = t > 0.16 ? noise(i) * env(t - 0.16, 0.003, 0.1) * 0.16 : 0;
      return creak + slam + wood;
    });
    put('floor_clunk', 0.2, (t, i) => tone(t, 78) * env(t, 0.004, 0.16) * 0.46 + noise(i) * env(t, 0.002, 0.08) * 0.12);
    put('decoy', 0.2, (t, i) => tone(t, 88) * env(t, 0.01, 0.16) * 0.32 + noise(i) * env(t, 0.008, 0.14) * 0.2);
    put('keyboard', 0.16, (t, i) => {
      const clack = (n: number, at: number, hz: number) =>
        t > at ? tone(t - at, hz) * env(t - at, 0.001, 0.03) * 0.22 + noise(i + n) * env(t - at, 0.001, 0.025) * 0.1 : 0;
      return clack(1, 0, 1420) + clack(4, 0.04, 1280) + clack(7, 0.09, 1560);
    });
    put('keyboard_catch', 0.08, (t, i) => tone(t, 1340) * env(t, 0.001, 0.06) * 0.24 + noise(i) * env(t, 0.001, 0.04) * 0.1);
    put('coffee', 0.32, (t, i) => noise(i) * env(t, 0.04, 0.26) * 0.2 * (0.7 + 0.3 * Math.sin(t * 55)));
    put('card_deal', 0.24, (t, i) => noise(i) * env(t, 0.01, 0.2) * (0.16 + 0.1 * Math.sin(t * 90)));
    put('card_pick', 0.16, (t, i) => {
      const ding = tone(t, 880) * env(t, 0.002, 0.11) * 0.24;
      const tick = tone(t, 1320) * env(t, 0.001, 0.06) * 0.14;
      return ding + tick + noise(i) * env(t, 0.001, 0.05) * 0.12;
    });
    put('card_burn', 0.32, (t, i) => {
      // 盖过同一帧的盖章 / 加班提示音：先闷响再喷气
      const thud = tone(t, 70) * env(t, 0.004, 0.14) * 0.58;
      const air = noise(i) * env(t, 0.01, 0.24) * 0.48 * (0.55 + 0.45 * Math.sin(t * 52));
      const pop = tone(t, 220 - t * 140) * env(t, 0.006, 0.16) * 0.26;
      return thud + air + pop;
    });
    put('ui_click', 0.05, (t) => tone(t, 1480) * env(t, 0.001, 0.04) * 0.18);
    put('ui_deny', 0.14, (t) => {
      const a = tone(t, 420) * env(t, 0.002, 0.05) * 0.2;
      const b = t > 0.05 ? tone(t - 0.05, 300) * env(t - 0.05, 0.002, 0.07) * 0.2 : 0;
      return a + b;
    });
    put('step', 0.07, (t, i) => {
      const sole = tone(t, 78) * env(t, 0.003, 0.05) * 0.14;
      const floor = noise(i) * env(t, 0.002, 0.055) * 0.1;
      return sole + floor;
    });
    put('spawn', 0.2, (t, i) => {
      const whoosh = noise(i) * env(t, 0.01, 0.16) * 0.18;
      const pop = tone(t, 420) * env(t, 0.004, 0.1) * 0.22;
      return whoosh + pop;
    });
    // 开局倒计时滴答
    put('ready_tick', 0.14, (t) => {
      const click = tone(t, 990) * env(t, 0.003, 0.08) * 0.42;
      const body = tone(t, 330) * env(t, 0.004, 0.1) * 0.18;
      return click + body;
    });
    // 下课闹铃：一串金属铃响
    put('ready_go', 1.85, (t, i) => {
      let s = 0;
      for (let n = 0; n < 7; n++) {
        const u = t - n * 0.2;
        if (u < 0 || u > 0.55) continue;
        const ring =
          tone(u, 1046) * env(u, 0.004, 0.48) * 0.48 +
          tone(u, 1568) * env(u, 0.006, 0.52) * 0.36 +
          tone(u, 2093) * env(u, 0.008, 0.38) * 0.16 +
          noise(i + n * 17) * env(u, 0.002, 0.12) * 0.06;
        s += ring;
      }
      return s;
    });
    put('desk_slam', 0.3, (t, i) => {
      const wood = tone(t, 68) * env(t, 0.004, 0.22) * 0.5;
      const slap = tone(t, 210) * env(t, 0.002, 0.08) * 0.18;
      const paper = noise(i) * env(t, 0.006, 0.2) * 0.16;
      return wood + slap + paper;
    });
    put('intercept', 0.22, (t) => {
      const clip = tone(t, 1560) * env(t, 0.002, 0.05) * 0.2;
      const taut = t > 0.05 ? tone(t - 0.05, 980) * env(t - 0.05, 0.004, 0.1) * 0.16 : 0;
      const lock = t > 0.1 ? tone(t - 0.1, 620) * env(t - 0.1, 0.003, 0.1) * 0.18 : 0;
      return clip + taut + lock;
    });
    put('rally', 0.24, (t, i) => {
      const call = tone(t, 240) * env(t, 0.01, 0.16) * 0.16;
      const over = tone(t, 360) * env(t, 0.012, 0.14) * 0.1;
      const rustle = noise(i) * env(t, 0.02, 0.18) * 0.1;
      return call + over + rustle;
    });
    put('chair_roll', 0.14, (t, i) => {
      const wheel = noise(i) * env(t, 0.01, 0.11) * (0.1 + 0.06 * Math.sin(t * 90));
      const plastic = tone(t, 420 + t * 80) * env(t, 0.006, 0.1) * 0.08;
      return wheel + plastic;
    });
    put('slick_slip', 0.18, (t, i) => {
      const squeak = tone(t, 380 - t * 140) * env(t, 0.008, 0.14) * 0.16;
      const wet = noise(i) * env(t, 0.006, 0.14) * 0.18;
      return squeak + wet;
    });
    put('decoy_loop', 2.0, (t, i) => {
      const card = noise(i) * 0.05 + noise(i + 51) * 0.03;
      const tick = ((i * 13) % 6200) < 90 ? tone(t, 1280) * env((i % 6200) / ctx.sampleRate, 0.001, 0.03) * 0.06 : 0;
      return (card + tick) * (0.65 + 0.35 * Math.sin(t * 2.4));
    });
    this.ready = true;
  }

  private startNamedLoop(name: LoopId) {
    const ctx = this.ctx;
    const master = this.master;
    const buf = this.buffers.get(`${name}_loop`);
    if (!ctx || !master || !buf || this.loops.has(name)) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    const level = name === 'decoy' ? 0.42 : 0.55;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(level, ctx.currentTime + 0.16);
    src.connect(gain);
    gain.connect(master);
    src.start();
    this.loops.set(name, { src, gain });
  }

  private stopNamedLoop(name: LoopId) {
    const ctx = this.ctx;
    const loop = this.loops.get(name);
    if (!loop) return;
    this.loops.delete(name);
    if (ctx) {
      loop.gain.gain.cancelScheduledValues(ctx.currentTime);
      loop.gain.gain.setValueAtTime(loop.gain.gain.value, ctx.currentTime);
      loop.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.18);
      window.setTimeout(() => {
        try {
          loop.src.stop();
        } catch {
          /* already stopped */
        }
      }, 200);
    } else {
      try {
        loop.src.stop();
      } catch {
        /* already stopped */
      }
    }
  }
}

export const bgm = new BgmPlayer();
export const sfx = new SfxPlayer();

if (import.meta.hot) {
  import.meta.hot.dispose(() => bgm.halt());
}
