// The island's sounds, synthesized in the app (stage 9a, docs/CHANGES.md): no sample files, no
// third-party recordings. tools/sounds.mjs renders the same code into the listening page.
// Plain erasable TypeScript only: Node runs this file directly (type stripping).
//
// Palette (second pass, after measuring coucou's set - docs/PROGRESS.md): a "drop" - a nearly
// pure tone with a short bright FM strike at the onset and a tiny pitch flick, like a kalimba or
// a water drop. Clean tones, short tails (most die within 0.3-0.5 s), a little stereo room. An
// event is a soft grace note and a louder main note, so it reads as one gesture. Key: G major.

type Curve = [number, number][];
export interface Note {
  at: number;
  /** Hz, or a note name ("G5") */
  f: number | string;
  decay: number;
  gain?: number;
  timbre?: Timbre;
  attack?: number;
  /** semitones over time; a drop gets a small flick by default */
  pitch?: Curve;
  /** [rate Hz, depth st], after `vibDelay` s */
  vib?: [number, number];
  vibDelay?: number;
  /** sustain before the decay, s (pads, held notes) */
  hold?: number;
  /** -1 left … 1 right, fixed or over time */
  pan?: number | Curve;
  /** [rate Hz, depth] amplitude wobble (a purr) */
  am?: [number, number];
  /** FM strike [ratio, index, decay s] - the drop's bright onset */
  fm?: [number, number, number];
}
export interface Air {
  at: number;
  dur: number;
  /** cutoff Hz over time */
  band: Curve;
  gain?: number;
  attack?: number;
  pan?: number | Curve;
  seed?: number;
}
type Part = Note | Air;
interface Spec {
  len: number;
  parts: Part[];
  /** RMS over the whole sound */
  level: number;
  /** room mix */
  reverb?: number;
  /** 0 - the same every time (events: recognized by ear); up to 1 - each play a little different */
  vary?: number;
}
export interface Rendered {
  channels: Float32Array[];
  sampleRate: number;
}

const NOTE_BASE: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
/** note name → Hz */
const hz = (note: number | string): number => {
  if (typeof note === 'number') return note;
  const m = /^([A-G])(#?)(\d)$/.exec(note) as RegExpExecArray;
  return 440 * 2 ** (((NOTE_BASE[m[1] as string] as number) + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12) / 12);
};

// Partials [ratio, gain, decay multiplier] on top of the FM strike.
const TIMBRES = {
  /** the main voice: a pure tone, its brightness all in the strike */
  drop: [[1, 1, 1]],
  /** a softer drop with a quiet octave - held melody notes */
  glass: [
    [1, 1, 1],
    [2, 0.12, 0.5],
  ],
  /** wood - work's knocks */
  click: [
    [1, 1, 1],
    [2.6, 0.4, 0.6],
  ],
  sine: [[1, 1, 1]],
} satisfies Record<string, [number, number, number][]>;
type Timbre = keyof typeof TIMBRES;
/** each timbre's strike unless a note sets its own */
const STRIKE: Partial<Record<Timbre, [number, number, number]>> = {
  drop: [2, 1.5, 0.018],
  glass: [3, 0.8, 0.025],
};

/** deterministic random, -1..1 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 31 - 1;
  };
}

/** value at time t along [[t, v], …] (linear, held at the ends) */
function curve(points: Curve | undefined, t: number): number {
  if (!points || !points.length) return 0;
  const first = points[0] as [number, number];
  if (t <= first[0]) return first[1];
  for (let i = 1; i < points.length; i++) {
    const [t1, b] = points[i] as [number, number];
    if (t <= t1) {
      const [t0, a] = points[i - 1] as [number, number];
      return a + ((b - a) * (t - t0)) / (t1 - t0);
    }
  }
  return (points[points.length - 1] as [number, number])[1];
}

const panAt = (pan: number | Curve | undefined, t: number): number => (Array.isArray(pan) ? curve(pan, t) : (pan ?? 0));
/** equal-power pan */
const panGains = (p: number): [number, number] => [
  Math.cos(((p + 1) * Math.PI) / 4),
  Math.sin(((p + 1) * Math.PI) / 4),
];
/** a drop's flick: a quarter tone sharp, settling in 25 ms - alive, not a test tone */
const FLICK: Curve = [
  [0, 0.25],
  [0.025, 0],
];

function note(L: Float32Array, R: Float32Array, sr: number, o: Note): void {
  const { at, decay, gain = 1, timbre = 'drop', attack = 0.004, vib, vibDelay = 0.15, hold = 0, pan, am } = o;
  const f = hz(o.f),
    pitch = o.pitch ?? (timbre === 'drop' || timbre === 'glass' ? FLICK : undefined),
    fm = o.fm ?? STRIKE[timbre],
    parts = TIMBRES[timbre] as [number, number, number][],
    i0 = Math.round(at * sr),
    n = Math.min(L.length - i0, Math.round((hold + decay * 7 + attack) * sr)),
    ph = parts.map(() => 0);
  let mph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr,
      vb = vib && t > vibDelay ? vib[1] * Math.min(1, (t - vibDelay) / 0.2) * Math.sin(2 * Math.PI * vib[0] * t) : 0,
      k = 2 ** ((curve(pitch, t) + vb) / 12),
      env = Math.min(1, t / attack) * (am ? 1 - am[1] * (0.5 + 0.5 * Math.sin(2 * Math.PI * am[0] * t)) : 1),
      td = Math.max(0, t - attack - hold);
    let mod = 0;
    if (fm) {
      mph += (2 * Math.PI * f * fm[0] * k) / sr;
      mod = fm[1] * Math.exp(-t / fm[2]) * Math.sin(mph);
    }
    let v = 0;
    for (let j = 0; j < parts.length; j++) {
      const [r, g, d] = parts[j] as [number, number, number];
      ph[j] = (ph[j] as number) + (2 * Math.PI * f * r * k) / sr;
      v += g * Math.sin((ph[j] as number) + mod) * Math.exp(-td / (decay * d));
    }
    const [gl, gr] = panGains(panAt(pan, t));
    L[i0 + i] = (L[i0 + i] as number) + v * env * gain * gl;
    R[i0 + i] = (R[i0 + i] as number) + v * env * gain * gr;
  }
}

/** filtered noise - a breath or a swoosh: a one-pole lowpass over noise highpassed at half the cutoff */
function air(L: Float32Array, R: Float32Array, sr: number, o: Air): void {
  const { at, dur, gain = 1, attack = 0.05, band, pan, seed = 1 } = o;
  const r = rng(seed),
    i0 = Math.round(at * sr),
    n = Math.min(L.length - i0, Math.round(dur * sr));
  let lp = 0,
    lp2 = 0,
    hp = 0,
    prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr,
      fc = curve(band, t),
      a = 1 - Math.exp((-2 * Math.PI * fc) / sr),
      b = Math.exp((-2 * Math.PI * fc * 0.5) / sr),
      x = r();
    hp = b * (hp + x - prev);
    prev = x;
    lp += a * (hp - lp);
    lp2 += a * (lp - lp2); // two poles: a rounder "whoosh", not hiss
    const env = Math.min(1, t / attack) * Math.min(1, (dur - t) / (dur * 0.6)),
      [gl, gr] = panGains(panAt(pan, t));
    L[i0 + i] = (L[i0 + i] as number) + lp2 * env * gain * gl;
    R[i0 + i] = (R[i0 + i] as number) + lp2 * env * gain * gr;
  }
}

/** a small stereo room: damped feedback combs with different lengths per ear, so the tail is
 *  wide while the note stays in the middle */
function room(ch: Float32Array, sr: number, mix: number, delays: readonly number[]): Float32Array {
  const out = Float32Array.from(ch);
  for (const ms of delays) {
    const d = Math.round((ms / 1000) * sr),
      line = new Float32Array(ch.length);
    let lp = 0;
    for (let i = 0; i < ch.length; i++) {
      lp = lp * 0.35 + (i >= d ? (line[i - d] as number) : 0) * 0.65; // damping: the tail darkens
      line[i] = (ch[i] as number) + lp * 0.5;
      out[i] = (out[i] as number) + (line[i] as number) * (mix / delays.length);
    }
  }
  return out;
}
const ROOM_L = [23.1, 29.7, 37.1, 43.7] as const,
  ROOM_R = [25.3, 31.9, 35.3, 41.9] as const;

/** a little difference for a sound that repeats: pitch ±15 cents x vary, level ±10 %, later
 *  notes shifted up to ±5 ms - a hand, not a machine */
function varied(parts: Part[], vary: number, r: () => number): Part[] {
  const cents = r() * 15 * vary;
  return parts.map((p, i) => {
    const at = i ? Math.max(0, p.at + r() * 0.005 * vary) : p.at,
      gain = (p.gain ?? 1) * (1 + r() * 0.1 * vary);
    return 'f' in p ? { ...p, at, gain, f: hz(p.f) * 2 ** (cents / 1200) } : { ...p, at, gain };
  });
}

/** Renders a spec at this sample rate; `seed` picks the variation (sounds with `vary`). Stereo. */
function render(spec: Spec, sr: number, seed: number): Rendered {
  const { len, level, reverb = 0.2, vary = 0 } = spec;
  const parts = vary && seed ? varied(spec.parts, vary, rng(seed)) : spec.parts;
  const n = Math.round(len * sr),
    L0 = new Float32Array(n),
    R0 = new Float32Array(n);
  for (const p of parts)
    if ('f' in p) note(L0, R0, sr, p);
    else air(L0, R0, sr, p);
  const L = room(L0, sr, reverb, ROOM_L),
    R = room(R0, sr, reverb, ROOM_R);
  let sum = 0,
    peak = 0;
  for (let i = 0; i < n; i++) {
    const l = L[i] as number,
      r = R[i] as number;
    sum += (l * l + r * r) / 2;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  const k = Math.min(level / Math.sqrt(sum / n), 0.95 / peak),
    fade = Math.round(0.04 * sr),
    scale = (c: Float32Array) => c.map((v, i) => v * k * Math.min(1, (n - i) / fade));
  return { channels: [scale(L), scale(R)], sampleRate: sr };
}

/** RMS level: coucou's measured level of the matching sound x 2.5 - our master gain is 2.5x
 *  lower than its 0.2 (src/sound.ts), so its three tiers come out the same. */
const lvl = (coucouRms: number): number => coucouRms * 2.5;
const st = (...p: [number, number][]): Curve => p;
/** a drop: at, note, decay, gain, more */
const d = (at: number, f: string, decay: number, gain = 1, more: Partial<Note> = {}): Note => ({
  at,
  f,
  decay,
  gain,
  ...more,
});

// ---------------------------------------------------------------- the greeting
//
// Scored like coucou's (measured, docs/PROGRESS.md): every note is struck on something that moves
// on screen, and nothing is struck where nothing happens. Four layers, as in coucou: the curtain
// (the island opening), the mascot appearing, its hello, and a melody with a quiet pad under it.
// The beats are measured from the app page frame by frame (.parity/greet-timeline.mjs), not taken
// from SPEC: a hop crouches 0.11 s before it leaves the ground, so the hello sits on the takeoff.

/** What happens on screen during the greeting, seconds from its start (measured). */
export const GREETING_BEATS = {
  /** the outline runs round the island 0-0.75, the warp streaks fly out until 1.0 */
  curtain: 0,
  /** the glow blooms in the middle, 0.6-1.4 */
  glow: 0.6,
  /** the mascot's top pops up out of the ground, eyes shut (drawn from this frame, no fade) */
  appear: 0.9,
  /** the mascot starts rising out of the ground (hide drops), tallest stretch at 1.456 */
  rise: 1.36,
  /** it settles: the squash, deepest at 1.856 */
  settle: 1.8,
  /** its eyes switch on with a blue flash (lid 0.19 → 0.65 by 1.984) */
  eyes: 1.952,
  /** looks left (furthest at 2.32), then right (furthest at 2.61) */
  lookLeft: 2.24,
  lookRight: 2.51,
  /** happy eyes and the waving hand from 2.91-2.96; the first hop crouches */
  wave: 2.96,
  /** the hops leave the ground (posY moves) - 3.056 and 3.504; land 3.344 and 3.68 */
  hop1: 3.056,
  hop2: 3.504,
  land2: 3.68,
  /** everything fades 3.8 → 4.6 */
  fade: 3.8,
  end: 4.6,
} as const;
const B = GREETING_BEATS;

/** the pad: one soft sine per chord note, spread left and right, a bed ~30 dB under the tune as
 *  in coucou; chords change on beats, never with a new strike. (Detuned pairs were tried: they
 *  beat about twice a second and are heard as pulses where nothing happens on screen.) */
function pad(at: number, notes: string[], until: number, gain: number, attack = 0.35): Note[] {
  return notes.map((n, i) => ({
    at: at + i * 0.02,
    f: n,
    decay: 0.3,
    timbre: 'sine' as const,
    attack,
    hold: Math.max(0, until - at - attack),
    gain: gain * 1.6,
    pan: i % 2 ? 0.3 : -0.3,
  }));
}

/** the hello, a voice-like held note: a little scoop up into pitch and a vibrato that grows */
const voice = (at: number, f: string, hold: number, gain: number): Note => ({
  at,
  f,
  decay: 0.16,
  gain,
  timbre: 'glass',
  attack: 0.012,
  hold,
  pitch: st([0, -1], [0.045, 0]),
  vib: [5.5, 0.14],
  vibDelay: 0.08,
});

/** Harmony G - Em - C - G: Gmaj9 with the glow, Em7 when the eyes open, Cmaj9 under the hello,
 *  home to G on the last landing. Every tune note is a chord tone (or the 9th) of its chord. */
const HARMONY: Note[] = [
  ...pad(B.glow, ['G3', 'D4', 'F#4', 'A4'], B.eyes, 0.012, 0.5),
  ...pad(B.eyes, ['E3', 'B3', 'D4', 'G4'], B.wave, 0.012),
  ...pad(B.wave, ['C3', 'G3', 'B3', 'E4'], B.land2, 0.012),
  ...pad(B.land2, ['G3', 'B3', 'D4'], B.fade + 0.2, 0.011),
];

function greeting(kind: 'a' | 'b' | 'c'): Spec {
  // 1. the curtain: air rising with the outline (0-0.75) and the warp (to 1.0), a low tone
  //    swelling under it - no strike, it opens
  const curtain: Part[] = [
    // peaks with the outline (0.3-0.6) and is nearly gone when the mascot pops up at 0.9
    { at: B.curtain, dur: 0.95, band: st([0, 250], [0.6, 1800], [0.95, 900]), gain: 0.55, attack: 0.3, seed: 11 },
    {
      at: B.curtain,
      f: 'G3',
      decay: 0.2,
      gain: 0.18,
      timbre: 'sine',
      attack: 0.6,
      hold: 0.3,
      pitch: st([0, -5], [0.75, 0]),
    },
  ];
  // 2. it appears: a soft low bubble as its top pops out of the ground, a bloop gliding up
  //    exactly as it rises (top at the tallest stretch, 1.456),
  //    a soft low plop when it settles, and the one bright moment - its eyes light up
  const appear: Note[] = [
    d(B.appear, 'D4', 0.08, 0.7, { timbre: 'sine', attack: 0.006, pitch: st([0, 5], [0.03, 0]) }),
    d(B.rise, 'G4', 0.09, 0.45, { timbre: 'sine', attack: 0.02, pitch: st([0, -7], [0.096, 0]) }),
    d(B.settle, 'G3', 0.06, 0.3, { timbre: 'sine', attack: 0.01, pitch: st([0, 2], [0.05, 0]) }),
    d(B.eyes, 'B5', 0.2, 0.55, { timbre: 'glass' }),
    d(B.eyes + 0.012, 'E6', 0.22, 0.4, { timbre: 'glass' }),
  ];
  // 3. the melody follows its gaze - left, right - quietly, in the middle of the range
  const gaze: Note[] =
    kind === 'c'
      ? []
      : [
          d(B.lookLeft, 'B4', 0.12, 0.28, { timbre: 'glass', pan: -0.35 }),
          d(B.lookRight, 'G4', 0.14, 0.26, { timbre: 'glass', pan: 0.35 }),
        ];
  // 4. the hello, on the two takeoffs - the loudest moment; the second note is held over the
  //    landing and lets go with the fade
  const hello: Note[] =
    kind === 'b'
      ? [voice(B.hop1, 'G5', 0.16, 0.8), voice(B.hop2, 'E5', 0.42, 0.85)]
      : [voice(B.hop1, 'D5', 0.16, 0.8), voice(B.hop2, 'G5', 0.42, 0.85)];
  return { len: B.end, parts: [...curtain, ...HARMONY, ...appear, ...gaze, ...hello], level: lvl(0.049), reverb: 0.22 };
}

/** When each greeting variant strikes a note (the pad and the air excluded) - for the test that
 *  every strike sits on a beat. */
export function greetingStrikes(kind: 'a' | 'b' | 'c'): number[] {
  const pads = new Set(HARMONY);
  return greeting(kind)
    .parts.filter((p): p is Note => 'f' in p && !pads.has(p as Note) && p.at > 0)
    .map((p) => p.at);
}

// ---------------------------------------------------------------- variants

/** Sounds with variants to choose by ear (the listening page), each in its own words. */
export const VARIANTS = {
  attention: {
    a: 'тихая нота и громкая на кварту выше, «простите»',
    b: 'две одинаковые капли, «тук-тук»',
    c: 'три капли вверх, «эй»',
  },
  question: {
    a: 'нота и вторая выше, подтягивается вверх, «хм?»',
    b: 'три ноты вверх, последняя тянется',
    c: 'плавный подъём голосом и капля',
  },
  success: {
    a: 'три капли вверх, звенят вместе',
    b: '«та-дам»: две ноты и искра',
    c: 'широкий аккорд с долгим хвостом',
  },
  greeting: {
    a: 'шторка, появление, глаза, взгляды, «при-вет» вверх на прыжках',
    b: 'то же, «при-вет» вниз - мягче',
    c: 'то же без нот на взглядах - тише в середине',
  },
} as const;
export type Variant = 'a' | 'b' | 'c';
/** the variants the app plays - the owner's pick (docs/CHANGES.md) */
export const CHOICE: Record<keyof typeof VARIANTS, Variant> = {
  attention: 'a',
  question: 'a',
  success: 'a',
  greeting: 'a',
};

const VARIANT_SPECS: Record<keyof typeof VARIANTS, Record<Variant, () => Spec>> = {
  attention: {
    a: () => ({ len: 0.6, parts: [d(0, 'D5', 0.07, 0.45), d(0.11, 'G5', 0.11)], level: lvl(0.066) }),
    b: () => ({ len: 0.6, parts: [d(0, 'G5', 0.08, 0.6), d(0.14, 'G5', 0.11)], level: lvl(0.066) }),
    c: () => ({
      len: 0.6,
      parts: [d(0, 'D5', 0.05, 0.4), d(0.06, 'G5', 0.06, 0.6), d(0.12, 'B5', 0.11)],
      level: lvl(0.066),
    }),
  },
  question: {
    a: () => ({
      len: 0.6,
      parts: [d(0, 'G5', 0.06, 0.5), d(0.1, 'D6', 0.12, 1, { pitch: st([0, -2], [0.07, 0]) })],
      level: lvl(0.053),
    }),
    b: () => ({
      len: 0.6,
      parts: [
        d(0, 'D5', 0.05, 0.45),
        d(0.08, 'E5', 0.05, 0.6),
        d(0.16, 'A5', 0.13, 1, { pitch: st([0, 0], [0.2, 1]) }),
      ],
      level: lvl(0.053),
    }),
    c: () => ({
      len: 0.6,
      parts: [
        d(0, 'D5', 0.06, 0.6, { timbre: 'glass', hold: 0.12, pitch: st([0, 0], [0.16, 5]) }),
        d(0.2, 'D6', 0.08, 0.5),
      ],
      level: lvl(0.053),
    }),
  },
  success: {
    a: () => ({
      len: 0.9,
      parts: [d(0, 'G5', 0.14, 0.7), d(0.06, 'B5', 0.16, 0.8), d(0.12, 'D6', 0.22), d(0.2, 'G6', 0.1, 0.22)],
      level: lvl(0.09),
    }),
    b: () => ({
      len: 0.8,
      parts: [d(0, 'D6', 0.07, 0.6), d(0.12, 'G6', 0.2), d(0.2, 'D7', 0.06, 0.15)],
      level: lvl(0.09),
    }),
    c: () => ({
      len: 1.2,
      parts: [d(0, 'G4', 0.3, 0.6), d(0.05, 'D5', 0.3, 0.7), d(0.1, 'B5', 0.32, 0.8), d(0.15, 'G6', 0.35, 0.5)],
      level: lvl(0.09),
      reverb: 0.22,
    }),
  },
  greeting: { a: () => greeting('a'), b: () => greeting('b'), c: () => greeting('c') },
};

// ---------------------------------------------------------------- every sound

const SPECS = {
  // ---- events: something needs you or finished (loudest tier)
  attention: () => VARIANT_SPECS.attention[CHOICE.attention](),
  question: () => VARIANT_SPECS.question[CHOICE.question](),
  success: () => VARIANT_SPECS.success[CHOICE.success](),
  /** an error: two low notes falling a minor third, the second softer - warm, no alarm */
  error: (): Spec => ({
    len: 0.6,
    parts: [d(0, 'E4', 0.09, 1, { fm: [1, 1.1, 0.03] }), d(0.13, 'C#4', 0.13, 0.8, { fm: [1, 0.9, 0.03] })],
    level: lvl(0.07),
  }),
  /** the limit: one low note sagging a semitone - "stop, for now" */
  ratelimit: (): Spec => ({
    len: 0.5,
    parts: [d(0, 'B3', 0.12, 1, { fm: [1, 1, 0.03], pitch: st([0, 0], [0.2, -1]) })],
    level: lvl(0.04),
  }),
  /** a celebration (every habit done): a run up the scale to a ringing top */
  dance: (): Spec => ({
    len: 1.0,
    parts: [
      d(0, 'G5', 0.06, 0.55),
      d(0.06, 'A5', 0.06, 0.6),
      d(0.12, 'B5', 0.06, 0.65),
      d(0.18, 'D6', 0.07, 0.75),
      d(0.24, 'G6', 0.22, 1),
      d(0.34, 'D7', 0.08, 0.18, { pan: 0.3 }),
    ],
    level: lvl(0.062),
  }),
  /** a reminder: one soft drop - present, but the quietest call */
  nudge: (): Spec => ({ len: 0.5, parts: [d(0, 'D5', 0.05, 0.4), d(0.09, 'B5', 0.1)], level: lvl(0.04) }),

  // ---- the agent's work: only when a busy phase begins
  /** starts working: two quick wooden knocks, rolling up sleeves */
  work: (): Spec => ({
    len: 0.35,
    parts: [
      { at: 0, f: 'G4', decay: 0.03, timbre: 'click' },
      { at: 0.075, f: 'C5', decay: 0.045, timbre: 'click' },
    ],
    level: lvl(0.017),
    reverb: 0.1,
    vary: 0.6,
  }),
  /** starts thinking: a hollow "hmm" leaning up a semitone with a slow waver */
  think: (): Spec => ({
    len: 0.45,
    parts: [
      d(0, 'E5', 0.1, 1, {
        timbre: 'glass',
        attack: 0.03,
        hold: 0.06,
        pitch: st([0, 0], [0.22, 1]),
        vib: [5, 0.12],
        vibDelay: 0.05,
      }),
    ],
    level: lvl(0.028),
    vary: 0.6,
  }),
  /** starts searching: three quick drops scanning from left to right */
  search: (): Spec => ({
    len: 0.45,
    parts: [d(0, 'A5', 0.035, 0.6, { pan: -0.6 }), d(0.045, 'B5', 0.035, 0.7), d(0.09, 'E6', 0.06, 1, { pan: 0.6 })],
    level: lvl(0.026),
    vary: 0.6,
  }),

  // ---- the mascot's own life
  greeting: () => VARIANT_SPECS.greeting[CHOICE.greeting](),
  /** a click on the mascot: a springy boop - the pitch drops like a squashed ball, a soft body under it */
  poke: (): Spec => ({
    len: 0.35,
    parts: [d(0, 'E5', 0.05, 1, { pitch: st([0, 5], [0.04, 0]) }), d(0, 'E3', 0.04, 0.45, { timbre: 'sine' })],
    level: lvl(0.025),
    reverb: 0.1,
    vary: 1,
  }),
  /** grumpy after three pokes: a low "hmph" - two sagging notes and a puff of air */
  grumpy: (): Spec => ({
    len: 0.5,
    parts: [
      d(0.06, 'A4', 0.05, 0.8, { fm: [1, 0.8, 0.03], pitch: st([0, 0], [0.08, -2]) }),
      d(0.15, 'E4', 0.09, 1, { fm: [1, 0.8, 0.03], pitch: st([0, 0], [0.14, -1.5]) }),
      { at: 0.06, dur: 0.2, band: st([0, 700], [0.2, 400]), gain: 0.5, seed: 7 },
    ],
    level: lvl(0.028),
    vary: 0.8,
  }),
  /** overloaded after six: a wobbly fall swaying between the ears - dizzy */
  overload: (): Spec => ({
    len: 0.9,
    parts: [
      d(0, 'D5', 0.25, 1, {
        timbre: 'glass',
        attack: 0.01,
        hold: 0.35,
        pitch: st([0, 0], [0.7, -7]),
        vib: [8, 0.8],
        vibDelay: 0,
        pan: st([0, -0.6], [0.2, 0.6], [0.4, -0.6], [0.6, 0.6], [0.8, 0]),
      }),
    ],
    level: lvl(0.056),
    vary: 0.5,
  }),
  /** a double click - joy: a grace note and a bright, held one */
  joy: (): Spec => ({
    len: 0.6,
    parts: [d(0, 'D6', 0.05, 0.5), d(0.1, 'G6', 0.14, 1, { timbre: 'glass', hold: 0.04 })],
    level: lvl(0.045),
    vary: 0.8,
  }),
  /** being stroked: a warm low purr under a contented "mm" */
  pet: (): Spec => ({
    len: 0.8,
    parts: [
      { at: 0, f: 110, decay: 0.2, timbre: 'sine', attack: 0.08, hold: 0.25, am: [24, 0.7], gain: 1.2 },
      d(0.05, 'B4', 0.15, 0.3, { timbre: 'sine', attack: 0.06, hold: 0.1, pitch: st([0, 0], [0.3, -2]) }),
    ],
    level: lvl(0.045),
    vary: 0.8,
  }),
  /** falling asleep: a yawn - a warm low tone sinking, a little breath */
  sleep: (): Spec => ({
    len: 0.75,
    parts: [
      d(0, 'B4', 0.15, 1, { timbre: 'sine', attack: 0.12, hold: 0.15, pitch: st([0, 2], [0.5, -5]) }),
      { at: 0.02, dur: 0.5, band: st([0, 700], [0.5, 300]), gain: 0.25, attack: 0.15, seed: 3 },
    ],
    level: lvl(0.021),
    vary: 0.6,
  }),
  /** waking up: a quick chirp up and a drop - eyes open */
  wake: (): Spec => ({
    len: 0.45,
    parts: [d(0, 'D5', 0.04, 0.6, { timbre: 'sine', pitch: st([0, 0], [0.07, 5]) }), d(0.09, 'B5', 0.09)],
    level: lvl(0.03),
    vary: 0.6,
  }),

  // ---- the island and its controls (quietest tier)
  /** the island opens: a soft rising whoosh with a tone inside it */
  open: (): Spec => ({
    len: 0.4,
    parts: [
      { at: 0, dur: 0.24, band: st([0, 300], [0.22, 1500]), attack: 0.06, seed: 5 },
      d(0.02, 'G4', 0.06, 0.25, { timbre: 'sine', attack: 0.05, pitch: st([0, -3], [0.16, 0]) }),
    ],
    level: lvl(0.018),
    reverb: 0.1,
  }),
  /** it folds: the same air and tone, falling */
  close: (): Spec => ({
    len: 0.35,
    parts: [
      { at: 0, dur: 0.2, band: st([0, 1300], [0.2, 300]), attack: 0.03, seed: 6 },
      d(0, 'D5', 0.05, 0.22, { timbre: 'sine', attack: 0.03, pitch: st([0, 0], [0.14, -3]) }),
    ],
    level: lvl(0.014),
    reverb: 0.1,
  }),
  /** it peeks out of the notch: a tiny drop */
  peek: (): Spec => ({ len: 0.3, parts: [d(0, 'B5', 0.04)], level: lvl(0.012), vary: 0.5 }),
  /** a tab, a link, a player button: the shortest drop */
  tap: (): Spec => ({ len: 0.15, parts: [d(0, 'E6', 0.018, 1, { fm: [2, 1, 0.01] })], level: lvl(0.009), vary: 1 }),
  /** a switch or a choice: two tiny drops, a click and its echo */
  toggle: (): Spec => ({
    len: 0.15,
    parts: [d(0, 'A6', 0.012, 1, { fm: [2, 1, 0.008] }), d(0.022, 'E6', 0.014, 0.6, { fm: [2, 1, 0.008] })],
    level: lvl(0.006),
    reverb: 0.06,
    vary: 1,
  }),
  /** "Allow" from the island: up a major third - yes */
  approve: (): Spec => ({ len: 0.45, parts: [d(0, 'G5', 0.05, 0.6), d(0.07, 'B5', 0.1)], level: lvl(0.038) }),
  /** a habit ticked: a bright drop with a glint */
  check: (): Spec => ({
    len: 0.4,
    parts: [d(0, 'D6', 0.05, 0.6), d(0.05, 'G6', 0.08), d(0.1, 'D7', 0.04, 0.15)],
    level: lvl(0.03),
    vary: 0.8,
  }),
};

export type SoundName = keyof typeof SPECS;
export const SOUND_NAMES = Object.keys(SPECS) as SoundName[];

/** Who a sound is for: events need you, the mascot lives, the island answers clicks. */
export type Tier = 'events' | 'mascot' | 'ui';
export const TIER: Record<SoundName, Tier> = {
  attention: 'events',
  question: 'events',
  success: 'events',
  error: 'events',
  ratelimit: 'events',
  dance: 'events',
  nudge: 'events',
  work: 'events',
  think: 'events',
  search: 'events',
  greeting: 'mascot',
  poke: 'mascot',
  grumpy: 'mascot',
  overload: 'mascot',
  joy: 'mascot',
  pet: 'mascot',
  sleep: 'mascot',
  wake: 'mascot',
  open: 'ui',
  close: 'ui',
  peek: 'ui',
  tap: 'ui',
  toggle: 'ui',
  approve: 'ui',
  check: 'ui',
};

/** does a sound differ from play to play */
export const varies = (name: SoundName): boolean => !!SPECS[name]().vary;

/** Renders a sound. seed 0 - its base form; any other seed - a variation (if it varies). */
export function synth(name: SoundName, sampleRate: number, seed = 0): Rendered {
  return render(SPECS[name](), sampleRate, seed);
}

/** Renders a variant for the listening page. */
export function synthVariant(name: keyof typeof VARIANTS, v: Variant, sampleRate: number): Rendered {
  return render(VARIANT_SPECS[name][v](), sampleRate, 0);
}
