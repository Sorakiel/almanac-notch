// The island's sounds (stage 9a, docs/CHANGES.md): synthesized in the app (src/synth.ts) on the
// island's events, the mascot's life and the controls. The island package never plays anything -
// the harness stays the silent prototype; the app watches the state and plays here. No click is
// needed first: wry turns autoplay on by default (WKWebView: no media needs a user action;
// WebView2: --autoplay-policy=no-user-gesture-required) and Tauri keeps that default.
import { notchState, type IslandState, type NotchState } from '@almanac-notch/island';

import { SOUND_NAMES, TIER, varies, type SoundName, type Tier } from './synth';
export { SOUND_NAMES, TIER, type SoundName, type Tier };

/** Events that call: one sound at the start of each. */
const CALLS: Partial<Record<string, SoundName>> = {
  attention: 'attention',
  question: 'question',
  success: 'success',
  error: 'error',
  ratelimit: 'ratelimit',
  dance: 'dance',
  nudge: 'nudge',
};
/** The agent's busy moments: a sound only when a busy phase begins - Claude flips between them
 *  on every tool call, and a sound each time would be noise. */
const BUSY: Partial<Record<string, SoundName>> = { working: 'work', thinking: 'think', searching: 'search' };

/** The shortest time between two plays of one sound, s: calls are one sound per burst; a poke or
 *  a click answers every press; being stroked purrs once in a while, like coucou's "love". */
const GAP: Partial<Record<SoundName, number>> = { poke: 0.06, tap: 0.04, toggle: 0.04, check: 0.1, pet: 6, joy: 0.3 };
const DEFAULT_GAP = 1.2;
export const gapOf = (n: SoundName): number => GAP[n] ?? DEFAULT_GAP;

/** gain at full volume: our samples sit 2.5x above coucou's levels, this matches its 0.2 */
const MAX_GAIN = 0.08;
/** default slider position: quiet (coucou's 0.12 of 0.2) */
export const DEFAULT_VOLUME = 0.6;
/** the context sleeps this long after the last sound: a running one costs CPU even when silent */
const IDLE_AFTER = 1500;

export interface SoundStep {
  play: SoundName[];
  /** sounds to fade out now (the greeting, when it ends early) */
  stop: SoundName[];
}

/** What the island just did that should sound, from one frame to the next. */
export class SoundWatch {
  private key = '';
  private busy = false;
  private answered = '';
  private nstate: NotchState | null = null;
  private poke = 0;
  private grumpy = 0;
  private overload = 0;
  private sleeping = false;
  private petting = false;
  /** island sounds stay quiet until then (s): the launch settling, the greeting folding away */
  private quietUntil = -1;
  private last = new Map<SoundName, number>();

  /** The sounds due this frame. */
  step(s: IslandState): SoundStep {
    const ev = s.event,
      t = s.t,
      play: SoundName[] = [],
      stop: SoundName[] = [];
    // events
    const key = ev ? ev.type + '@' + ev.start : '';
    if (key !== this.key) {
      if (this.key.startsWith('greeting@')) {
        stop.push('greeting');
        this.quietUntil = t + 1;
      }
      const busy = !!ev && ev.type in BUSY;
      if (ev?.type === 'greeting') play.push('greeting');
      else if (ev && CALLS[ev.type]) play.push(CALLS[ev.type] as SoundName);
      else if (busy && !this.busy) play.push(BUSY[ev.type] as SoundName);
      this.busy = busy;
      this.key = key;
    }
    // an answer from the island or its keys: "Allow" sounds like a yes, the rest just tick
    const ans = ev?.answer ? key + ':' + ev.answer : '';
    if (ans && ans !== this.answered) play.push(ev?.answer === 'approve' ? 'approve' : 'tap');
    this.answered = ans;
    // the mascot: pokes, the grumpy and overloaded answers to many, sleep, being stroked
    const lastPoke = s.pokes[s.pokes.length - 1] ?? this.poke;
    if (s.overloadUntil > this.overload && s.overloadUntil > t) play.push('overload');
    else if (lastPoke > this.poke) play.push('poke');
    if (s.grumpyUntil > this.grumpy && s.grumpyUntil > t) play.push('grumpy');
    this.poke = Math.max(this.poke, lastPoke);
    this.overload = s.overloadUntil;
    this.grumpy = s.grumpyUntil;
    if (s.sleeping !== this.sleeping) play.push(s.sleeping ? 'sleep' : 'wake');
    this.sleeping = s.sleeping;
    if (s.petting && !this.petting) play.push('pet');
    this.petting = s.petting;
    // the island itself - quiet, and never on top of another sound or the greeting
    const ns = notchState(s);
    if (this.quietUntil < 0) this.quietUntil = t + 1.5;
    if (this.nstate && ns !== this.nstate && !play.length && ev?.type !== 'greeting' && t >= this.quietUntil) {
      if (ns === 'open') play.push('open');
      else if (this.nstate === 'open') play.push('close');
      else if (ns === 'half' && this.nstate === 'closed') play.push('peek');
    }
    this.nstate = ns;
    return { play: play.filter((n) => this.allow(n, t)), stop };
  }

  private queued: SoundName[] = [];
  /** a click on the island's controls, by its action, decided before the click lands */
  click(s: IslandState, act: string): void {
    const n = clickSound(s, act);
    if (n) this.queued.push(n);
  }
  /** a double click on the mascot: a happy hop */
  joy(): void {
    this.queued.push('joy');
  }
  /** clicks since the last call, rate-limited like the rest */
  takeClicks(t: number): SoundName[] {
    return this.queued.splice(0).filter((n) => this.allow(n, t));
  }

  private allow(n: SoundName, t: number): boolean {
    const prev = this.last.get(n);
    if (prev !== undefined && t >= prev && t - prev < gapOf(n)) return false;
    this.last.set(n, t);
    return true;
  }
}

/**
 * The sound of a click on a control. The mascot, answers, the speaker and the volume have their
 * own (state changes, a sample after the change), so they return null here.
 */
export function clickSound(s: IslandState, act: string): SoundName | null {
  if (act.startsWith('habit:')) return s.habits[+act.slice(6)]?.[1] ? 'toggle' : 'check';
  if (act.startsWith('almanac:')) return s.almanac?.rows.find((r) => r.id === act.slice(8))?.done ? 'toggle' : 'check';
  if (
    act === 'host:hover' ||
    act.startsWith('host:close:') ||
    act.startsWith('pref:') ||
    act === 'm:shuffle' ||
    act === 'm:repeat'
  )
    return 'toggle';
  if (
    act.startsWith('tab:') ||
    act.startsWith('focus:') ||
    act.startsWith('m:') ||
    act === 'open:settings' ||
    // levels inside a card and their links (stage 10)
    act.startsWith('depth:') ||
    /^(vercel|notion|grafana|alweb):/.test(act)
  )
    return 'tap';
  return null;
}

/** What decides how loud a sound plays, besides the volume. */
export interface SoundMood {
  muted: boolean;
  /** the settings window's three switches */
  tiers: Record<Tier, boolean>;
  /** a call: the microphone or camera is in use, or Windows' Do not disturb / presentation */
  quiet: boolean;
  /** music is playing in a real player */
  music: boolean;
  /** local hour, 0-23 */
  hour: number;
}
export const ALL_TIERS: Record<Tier, boolean> = { events: true, mascot: true, ui: true };

/**
 * A sound's gain on top of the volume, 0 - silent. A call silences everything (the island still
 * shows it); under music the clicks are silent and the rest half as loud, so the track isn't
 * cut; at night (22-8) a third quieter.
 */
export function moodGain(name: SoundName, m: SoundMood): number {
  const tier = TIER[name];
  if (m.muted || m.quiet || !m.tiers[tier]) return 0;
  let g = 1;
  if (m.music) {
    if (tier === 'ui') return 0;
    g *= 0.5;
  }
  if (m.hour >= 22 || m.hour < 8) g *= 2 / 3;
  return g;
}

/** WebAudio player: sounds rendered in a worker at the device rate (fixed ones once, ahead;
 *  varying ones fresh on every play), one master gain, the context suspended when idle. */
export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private worker: Worker | null = null;
  private asks = new Map<number, (ch: Float32Array[]) => void>();
  private nextAsk = 1;
  private buffers = new Map<SoundName, Promise<AudioBuffer>>();
  private idleTimer: number | null = null;
  private volume = DEFAULT_VOLUME;
  private voices = new Map<SoundName, Set<{ src: AudioBufferSourceNode; gain: GainNode }>>();

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume * MAX_GAIN;
      this.master.connect(this.ctx.destination);
      this.sleepSoon();
    }
    return this.ctx;
  }

  private render(name: SoundName, seed: number): Promise<AudioBuffer> {
    const ctx = this.context();
    if (!this.worker) {
      this.worker = new Worker(new URL('./synth-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; channels: Float32Array[] }>) => {
        this.asks.get(e.data.id)?.(e.data.channels);
        this.asks.delete(e.data.id);
      };
    }
    const id = this.nextAsk++;
    return new Promise((done) => {
      this.asks.set(id, (ch) => {
        const buf = ctx.createBuffer(ch.length, ch[0]?.length ?? 1, ctx.sampleRate);
        ch.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
        done(buf);
      });
      this.worker?.postMessage({ id, name, sampleRate: ctx.sampleRate, seed });
    });
  }

  /** a varying sound gets a new seed each time; seed 0 is a sound's base form */
  private buffer(name: SoundName): Promise<AudioBuffer> {
    if (varies(name)) return this.render(name, 1 + Math.floor(Math.random() * 1e9));
    let b = this.buffers.get(name);
    if (!b) this.buffers.set(name, (b = this.render(name, 0)));
    return b;
  }

  /** renders the fixed sounds ahead, so the first event sounds on time */
  preload(): void {
    for (const n of SOUND_NAMES) if (!varies(n)) void this.buffer(n);
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume * MAX_GAIN;
  }

  /** gain - this play's level on top of the volume (moodGain) */
  play(name: SoundName, gain = 1): void {
    if (this.volume === 0 || gain <= 0) return;
    const asked = performance.now();
    void this.buffer(name).then((buf) => {
      const ctx = this.context(),
        master = this.master as GainNode;
      if (this.idleTimer !== null) clearTimeout(this.idleTimer);
      this.idleTimer = null;
      void ctx.resume();
      const src = ctx.createBufferSource(),
        g = ctx.createGain();
      src.buffer = buf;
      g.gain.value = gain;
      src.connect(g);
      g.connect(master);
      const voice = { src, gain: g };
      let set = this.voices.get(name);
      if (!set) this.voices.set(name, (set = new Set()));
      set.add(voice);
      src.onended = () => {
        set.delete(voice);
        g.disconnect();
        this.sleepSoon();
      };
      // the greeting is scored to its animation: if it came late, it starts where the animation is
      src.start(0, name === 'greeting' ? Math.min((performance.now() - asked) / 1000, buf.duration) : 0);
    });
  }

  /** fades every playing copy of a sound out over `seconds` */
  fadeOut(name: SoundName, seconds = 0.25): void {
    const ctx = this.ctx,
      set = this.voices.get(name);
    if (!ctx || !set) return;
    const t = ctx.currentTime;
    for (const { src, gain } of set) {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + seconds);
      try {
        src.stop(t + seconds);
      } catch {
        // already stopped
      }
    }
  }

  private sleepSoon(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      // a voice still playing (the greeting is 4.7 s) keeps the context awake
      for (const set of this.voices.values()) if (set.size) return this.sleepSoon();
      void this.ctx?.suspend();
    }, IDLE_AFTER);
  }
}
