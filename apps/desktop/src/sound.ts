// The island's sounds (stage 9a, docs/CHANGES.md): our own samples (tools/sounds.mjs) on the
// island's events. The island package never plays anything - the harness stays the silent
// prototype; the app watches the state and plays here. No click is needed first: wry turns
// autoplay on by default (WKWebView: no media needs a user action; WebView2:
// --autoplay-policy=no-user-gesture-required) and Tauri keeps that default.
import type { IslandState } from '@almanac-notch/island';
import attention from './sounds/attention.wav?url';
import dance from './sounds/dance.wav?url';
import error from './sounds/error.wav?url';
import nudge from './sounds/nudge.wav?url';
import question from './sounds/question.wav?url';
import ratelimit from './sounds/ratelimit.wav?url';
import success from './sounds/success.wav?url';
import tap from './sounds/tap.wav?url';

const FILES = { attention, question, success, error, ratelimit, dance, nudge, tap } as const;
export type SoundName = keyof typeof FILES;

/** Events that sound. Working, thinking and searching repeat all the time, the greeting has its
 *  own moment - silence keeps a sound meaning "look". */
const BY_EVENT: Partial<Record<string, SoundName>> = {
  attention: 'attention',
  question: 'question',
  success: 'success',
  error: 'error',
  ratelimit: 'ratelimit',
  dance: 'dance',
  nudge: 'nudge',
};

/** the same sound no more often than this, s (a burst of events is one call) */
export const REPEAT_GAP = 1.5;
/** gain at full volume: our samples are louder than coucou's, this matches its 0.2 ceiling */
const MAX_GAIN = 0.08;
/** default slider position: quiet (coucou's 0.12 of 0.2) */
export const DEFAULT_VOLUME = 0.6;
/** the context sleeps this long after the last sound: a running one costs CPU even when silent */
const IDLE_AFTER = 1500;

/** What the island just did that should sound: a new event, or an answer sent from it. */
export class SoundWatch {
  private key = '';
  private answered = '';
  private last = new Map<SoundName, number>();

  /** The sounds due this frame (normally zero or one); t - the island clock, s. */
  step(s: IslandState): SoundName[] {
    const ev = s.event,
      out: SoundName[] = [];
    const key = ev ? ev.type + '@' + ev.start : '';
    if (key !== this.key) {
      this.key = key;
      const name = ev && BY_EVENT[ev.type];
      if (name) out.push(name);
    }
    const ans = ev?.answer ? key + ':' + ev.answer : '';
    if (ans && ans !== this.answered) out.push('tap');
    this.answered = ans;
    return out.filter((n) => {
      const prev = this.last.get(n);
      if (prev !== undefined && s.t - prev < REPEAT_GAP && s.t >= prev) return false;
      this.last.set(n, s.t);
      return true;
    });
  }
}

/** WebAudio player: decoded buffers, one master gain, the context suspended when idle. */
export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<SoundName, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private idleTimer: number | null = null;
  private volume = DEFAULT_VOLUME;

  private load(): Promise<void> {
    this.loading ??= (async () => {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume * MAX_GAIN;
      this.master.connect(ctx.destination);
      await Promise.all(
        (Object.keys(FILES) as SoundName[]).map(async (n) => {
          try {
            const res = await fetch(FILES[n]);
            this.buffers.set(n, await ctx.decodeAudioData(await res.arrayBuffer()));
          } catch {
            // a missing sound must never break the island
          }
        }),
      );
      this.sleepSoon();
    })();
    return this.loading;
  }

  /** decode up front so the first event sounds on time */
  preload(): void {
    void this.load();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume * MAX_GAIN;
  }

  play(name: SoundName): void {
    void this.load().then(() => {
      const ctx = this.ctx,
        buf = this.buffers.get(name);
      if (!ctx || !this.master || !buf || this.volume === 0) return;
      if (this.idleTimer !== null) clearTimeout(this.idleTimer);
      this.idleTimer = null;
      void ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.master);
      src.onended = () => {
        src.disconnect();
        this.sleepSoon();
      };
      src.start();
    });
  }

  private sleepSoon(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      void this.ctx?.suspend();
    }, IDLE_AFTER);
  }
}
