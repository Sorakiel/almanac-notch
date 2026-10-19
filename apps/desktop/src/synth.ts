// The island's sounds, synthesized in the app (stage 9a, docs/CHANGES.md): no sample files, no
// third-party recordings. tools/sounds.mjs renders the same code into the listening page.
// Plain erasable TypeScript only: Node runs this file directly (type stripping).
//
// Palette: soft mallets and bells (sine partials, exponential decay) in C major pentatonic, a
// little room so nothing sounds dry. Each sound's shape says what happened before its meaning is
// learned: up - "look here", down - "something went wrong" or "winding down", a chord - "done".

type Curve = [number, number][];
export interface Note {
  at: number;
  f: number;
  decay: number;
  gain?: number;
  timbre?: keyof typeof TIMBRES;
  attack?: number;
  /** semitones over time */
  pitch?: Curve;
  /** [rate Hz, depth st] */
  vib?: [number, number];
  /** sustain before the decay, s (pads) */
  hold?: number;
  /** -1 left … 1 right, fixed or over time */
  pan?: number | Curve;
  /** [rate Hz, depth] amplitude wobble (a purr) */
  am?: [number, number];
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
  reverb?: number;
  stereo?: boolean;
  /** 0 - the same every time (events: recognized by ear); up to 1 - each play a little different */
  vary?: number;
}
export interface Rendered {
  channels: Float32Array[];
  sampleRate: number;
}

/** note name → Hz */
const hz = (note: string): number => {
  const m = /^([A-G])(#?)(\d)$/.exec(note) as RegExpExecArray;
  const base = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1] as 'C'] as number;
  return 440 * 2 ** ((base + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12) / 12);
};

// Partials [ratio, gain, decay multiplier]: a marimba-like bar (its 4x and ~10x modes die fast),
// a glassy bell, a felt "pluck", a muted "thud", a wooden "click" and a pure sine.
const TIMBRES = {
  mallet: [
    [1, 1, 1],
    [3.99, 0.18, 0.35],
    [9.9, 0.05, 0.15],
  ],
  bell: [
    [1, 1, 1],
    [2.0, 0.22, 0.6],
    [2.76, 0.12, 0.45],
    [5.4, 0.04, 0.25],
  ],
  pluck: [
    [1, 1, 1],
    [2, 0.3, 0.5],
    [3, 0.08, 0.3],
  ],
  thud: [
    [1, 1, 1],
    [2.02, 0.15, 0.4],
  ],
  click: [
    [1, 1, 1],
    [2.6, 0.4, 0.6],
  ],
  sine: [[1, 1, 1]],
} satisfies Record<string, [number, number, number][]>;

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

function note(L: Float32Array, R: Float32Array, sr: number, o: Note): void {
  const { at, f, decay, gain = 1, timbre = 'mallet', attack = 0.004, pitch, vib, hold = 0, pan, am } = o;
  const parts = TIMBRES[timbre] as [number, number, number][],
    i0 = Math.round(at * sr),
    n = Math.min(L.length - i0, Math.round((hold + decay * 7 + attack) * sr)),
    ph = parts.map(() => 0);
  for (let i = 0; i < n; i++) {
    const t = i / sr,
      st = curve(pitch, t) + (vib ? vib[1] * Math.sin(2 * Math.PI * vib[0] * t) : 0),
      k = 2 ** (st / 12),
      env = Math.min(1, t / attack) * (am ? 1 - am[1] * (0.5 + 0.5 * Math.sin(2 * Math.PI * am[0] * t)) : 1),
      td = Math.max(0, t - attack - hold);
    let v = 0;
    for (let j = 0; j < parts.length; j++) {
      const [r, g, d] = parts[j] as [number, number, number];
      ph[j] = (ph[j] as number) + (2 * Math.PI * f * r * k) / sr;
      v += g * Math.sin(ph[j] as number) * Math.exp(-td / (decay * d));
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
    const env = Math.min(1, t / attack) * Math.min(1, (dur - t) / (dur * 0.6)),
      [gl, gr] = panGains(panAt(pan, t));
    L[i0 + i] = (L[i0 + i] as number) + lp * env * gain * gl;
    R[i0 + i] = (R[i0 + i] as number) + lp * env * gain * gr;
  }
}

/** a small room: four damped feedback combs (Schroeder), mixed low */
function room(ch: Float32Array, sr: number, mix: number): Float32Array {
  const out = Float32Array.from(ch);
  for (const [ms, fb] of [
    [29.7, 0.62],
    [37.1, 0.58],
    [41.1, 0.55],
    [43.7, 0.52],
  ] as const) {
    const d = Math.round((ms / 1000) * sr),
      line = new Float32Array(ch.length);
    let lp = 0;
    for (let i = 0; i < ch.length; i++) {
      lp = lp * 0.4 + (i >= d ? (line[i - d] as number) : 0) * 0.6; // damping: the tail darkens
      line[i] = (ch[i] as number) + lp * fb;
      out[i] = (out[i] as number) + (line[i] as number) * (mix / 4);
    }
  }
  return out;
}

/** a little difference for a sound that repeats: pitch ±15 cents x vary, level ±10 %, later
 *  notes shifted up to ±5 ms - a hand, not a machine */
function varied(parts: Part[], vary: number, r: () => number): Part[] {
  const cents = r() * 15 * vary;
  return parts.map((p, i) => {
    const at = i ? Math.max(0, p.at + r() * 0.005 * vary) : p.at,
      gain = (p.gain ?? 1) * (1 + r() * 0.1 * vary);
    return 'f' in p ? { ...p, at, gain, f: p.f * 2 ** (cents / 1200) } : { ...p, at, gain };
  });
}

/** Renders a spec at this sample rate; `seed` picks the variation (sounds with `vary`). */
function render(spec: Spec, sr: number, seed: number): Rendered {
  const { len, level, reverb = 0.14, stereo = false, vary = 0 } = spec;
  const parts = vary && seed ? varied(spec.parts, vary, rng(seed)) : spec.parts;
  const n = Math.round(len * sr),
    L0 = new Float32Array(n),
    R0 = new Float32Array(n);
  for (const p of parts)
    if ('f' in p) note(L0, R0, sr, p);
    else air(L0, R0, sr, p);
  let L = room(L0, sr, reverb),
    R = room(R0, sr, reverb);
  if (!stereo) {
    for (let i = 0; i < n; i++) L[i] = (L[i] as number) + (R[i] as number);
    R = L;
  }
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
  L = scale(L);
  return { channels: stereo ? [L, scale(R)] : [L], sampleRate: sr };
}

/** RMS level: coucou's measured level of the matching sound x 2.5 - our master gain is 2.5x
 *  lower than its 0.2 (src/sound.ts), so its three tiers come out the same. */
const lvl = (coucouRms: number): number => coucouRms * 2.5;
const st = (...p: [number, number][]): Curve => p;

// ---------------------------------------------------------------- the sounds

/** the launch greeting, scored to its animation (docs/SPEC.md, 3) - variants share the beats */
function greeting(kind: 'a' | 'b' | 'c'): Spec {
  const parts: Part[] = [];
  // warp 0-1.0: rising air and a low tone climbing an octave (a: full; c: calm, no air)
  if (kind === 'a')
    parts.push(
      { at: 0, dur: 1.05, band: st([0, 300], [0.95, 5000]), gain: 0.5, attack: 0.5, seed: 11 },
      {
        at: 0,
        f: hz('C4'),
        decay: 0.25,
        timbre: 'sine',
        attack: 0.7,
        hold: 0.25,
        gain: 0.25,
        pitch: st([0, -12], [1, 0]),
      },
    );
  if (kind === 'b')
    // a marimba climbing with the warp instead of the air
    ['C4', 'E4', 'G4', 'C5', 'E5'].forEach((n, i) =>
      parts.push({ at: i * 0.19, f: hz(n), decay: 0.12, gain: 0.35 + i * 0.08 }),
    );
  // glow from 0.6: a soft C major add9 pad
  if (kind !== 'b')
    ['C4', 'G4', 'D5', 'E5'].forEach((n, i) =>
      parts.push({ at: 0.6 + i * 0.05, f: hz(n), decay: 0.9, timbre: 'sine', attack: 0.6, hold: 1.6, gain: 0.16 }),
    );
  // 1.35 rises from the ground; 1.95 opens its eyes - a bell
  parts.push(
    { at: 1.35, f: hz('G4'), decay: 0.09, timbre: 'sine', gain: 0.7, pitch: st([0, -7], [0.08, 0]) },
    { at: 1.95, f: hz('E6'), decay: 0.35, timbre: 'bell', gain: 0.75 },
  );
  // 2.3 / 2.6 looks left, then right
  if (kind !== 'c')
    parts.push(
      { at: 2.3, f: hz('A5'), decay: 0.03, timbre: 'click', gain: 0.3, pan: -0.7 },
      { at: 2.6, f: hz('C6'), decay: 0.03, timbre: 'click', gain: 0.3, pan: 0.7 },
    );
  // 2.95 / 3.40 two happy hops, 3.02 the sparks; the root settles under it all
  parts.push(
    { at: 2.95, f: hz('G5'), decay: 0.14, pitch: st([0, -3], [0.06, 0]) },
    { at: 3.4, f: hz('C6'), decay: 0.22, pitch: st([0, -3], [0.06, 0]) },
    { at: 3.02, f: hz('G7'), decay: 0.1, timbre: 'bell', gain: 0.18, pan: -0.4 },
    { at: 3.09, f: hz('C7'), decay: 0.1, timbre: 'bell', gain: 0.16, pan: 0.4 },
    { at: 3.16, f: hz('E7'), decay: 0.12, timbre: 'bell', gain: 0.14 },
    { at: 3.4, f: hz('C4'), decay: 0.45, timbre: 'sine', attack: 0.1, gain: 0.25 },
  );
  return { len: 4.7, parts, level: lvl(0.049), reverb: 0.2, stereo: true };
}

/** Sounds with variants to choose by ear (the listening page), each in its own words. */
export const VARIANTS = {
  attention: {
    a: 'два тёплых тона вверх, вежливое «простите»',
    b: 'два одинаковых колокольчика, «тук-тук»',
    c: 'три быстрых ноты вверх, «эй»',
  },
  question: {
    a: 'нота и вторая выше, подтягивается вверх, «хм?»',
    b: 'три ноты вверх, последняя тянется',
    c: 'плавный подъём голосом и щипок',
  },
  success: {
    a: 'колокольчик, быстрый мажорный аккорд',
    b: '«та-дам»: две ноты и искра',
    c: 'широкий аккорд с долгим хвостом',
  },
  greeting: {
    a: 'полная: воздух варпа, свечение, глаза, взгляды, прыжки',
    b: 'маримба поднимается вместо воздуха, легче',
    c: 'спокойная: свечение, глаза и прыжки',
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
    a: () => ({
      len: 0.75,
      parts: [
        { at: 0, f: hz('E5'), decay: 0.16 },
        { at: 0.11, f: hz('A5'), decay: 0.22 },
      ],
      level: lvl(0.066),
    }),
    b: () => ({
      len: 0.8,
      parts: [
        { at: 0, f: hz('A5'), decay: 0.12, timbre: 'bell', gain: 0.75 },
        { at: 0.16, f: hz('A5'), decay: 0.22, timbre: 'bell' },
      ],
      level: lvl(0.066),
    }),
    c: () => ({
      len: 0.75,
      parts: [
        { at: 0, f: hz('C5'), decay: 0.07, gain: 0.7 },
        { at: 0.06, f: hz('G5'), decay: 0.08, gain: 0.8 },
        { at: 0.12, f: hz('C6'), decay: 0.2 },
      ],
      level: lvl(0.066),
    }),
  },
  question: {
    a: () => ({
      len: 0.7,
      parts: [
        { at: 0, f: hz('G5'), decay: 0.12, gain: 0.8 },
        { at: 0.1, f: hz('D6'), decay: 0.2, pitch: st([0, -3], [0.09, 0]) },
      ],
      level: lvl(0.053),
    }),
    b: () => ({
      len: 0.8,
      parts: [
        { at: 0, f: hz('D5'), decay: 0.07, timbre: 'pluck', gain: 0.8 },
        { at: 0.08, f: hz('E5'), decay: 0.07, timbre: 'pluck', gain: 0.85 },
        { at: 0.16, f: hz('A5'), decay: 0.22, timbre: 'pluck', pitch: st([0, 0], [0.25, 2]) },
      ],
      level: lvl(0.053),
    }),
    c: () => ({
      len: 0.75,
      parts: [
        { at: 0, f: hz('C5'), decay: 0.1, timbre: 'sine', attack: 0.03, hold: 0.15, pitch: st([0, 0], [0.22, 7]) },
        { at: 0.24, f: hz('G6'), decay: 0.06, timbre: 'pluck', gain: 0.4 },
      ],
      level: lvl(0.053),
    }),
  },
  success: {
    a: () => ({
      len: 1.15,
      parts: [
        { at: 0, f: hz('C6'), decay: 0.3, timbre: 'bell', gain: 0.8 },
        { at: 0.045, f: hz('E6'), decay: 0.32, timbre: 'bell', gain: 0.7 },
        { at: 0.09, f: hz('G6'), decay: 0.38, timbre: 'bell', gain: 0.65 },
      ],
      level: lvl(0.09),
    }),
    b: () => ({
      len: 1.0,
      parts: [
        { at: 0, f: hz('G5'), decay: 0.07 },
        { at: 0.1, f: hz('C6'), decay: 0.3 },
        { at: 0.18, f: hz('G7'), decay: 0.12, timbre: 'bell', gain: 0.2 },
      ],
      level: lvl(0.09),
    }),
    c: () => ({
      len: 1.6,
      parts: [
        { at: 0, f: hz('C5'), decay: 0.5, timbre: 'bell', gain: 0.7 },
        { at: 0.06, f: hz('G5'), decay: 0.5, timbre: 'bell', gain: 0.6 },
        { at: 0.12, f: hz('E6'), decay: 0.55, timbre: 'bell', gain: 0.55 },
      ],
      level: lvl(0.09),
      reverb: 0.2,
    }),
  },
  greeting: { a: () => greeting('a'), b: () => greeting('b'), c: () => greeting('c') },
};

const SPECS = {
  // ---- events: something needs you or finished (loudest tier)
  attention: () => VARIANT_SPECS.attention[CHOICE.attention](),
  question: () => VARIANT_SPECS.question[CHOICE.question](),
  success: () => VARIANT_SPECS.success[CHOICE.success](),
  /** an error: two soft low notes falling a minor third, felt, no harshness */
  error: (): Spec => ({
    len: 0.8,
    parts: [
      { at: 0, f: hz('E4'), decay: 0.13, timbre: 'pluck' },
      { at: 0.13, f: hz('C#4'), decay: 0.22, timbre: 'pluck' },
    ],
    level: lvl(0.07),
  }),
  /** the limit: one muted low thud sagging a tone - "stop", without alarm */
  ratelimit: (): Spec => ({
    len: 0.6,
    parts: [{ at: 0, f: hz('A3'), decay: 0.16, timbre: 'thud', pitch: st([0, 2], [0.05, 0]) }],
    level: lvl(0.04),
  }),
  /** a celebration (every habit done): a rising pentatonic run, a sparkle on top */
  dance: (): Spec => ({
    len: 1.4,
    parts: [
      { at: 0, f: hz('C5'), decay: 0.16, timbre: 'bell', gain: 0.75 },
      { at: 0.075, f: hz('E5'), decay: 0.16, timbre: 'bell', gain: 0.75 },
      { at: 0.15, f: hz('G5'), decay: 0.18, timbre: 'bell', gain: 0.75 },
      { at: 0.225, f: hz('C6'), decay: 0.4, timbre: 'bell', gain: 0.85 },
      { at: 0.36, f: hz('E7'), decay: 0.12, timbre: 'bell', gain: 0.14 },
      { at: 0.42, f: hz('G7'), decay: 0.14, timbre: 'bell', gain: 0.12 },
    ],
    level: lvl(0.062),
  }),
  /** a reminder: one soft pluck - present, but the quietest call */
  nudge: (): Spec => ({ len: 0.6, parts: [{ at: 0, f: hz('G5'), decay: 0.2, timbre: 'pluck' }], level: lvl(0.04) }),

  // ---- the agent's work: only when a busy phase begins
  /** starts working: two quick wooden knocks, rolling up sleeves */
  work: (): Spec => ({
    len: 0.4,
    parts: [
      { at: 0, f: hz('G4'), decay: 0.035, timbre: 'click' },
      { at: 0.075, f: hz('C5'), decay: 0.05, timbre: 'click' },
    ],
    level: lvl(0.017),
    reverb: 0.1,
    vary: 0.6,
  }),
  /** starts thinking: a hollow "hmm" leaning up a semitone with a slow waver */
  think: (): Spec => ({
    len: 0.5,
    parts: [
      { at: 0, f: hz('E5'), decay: 0.14, timbre: 'sine', attack: 0.04, pitch: st([0, 0], [0.25, 1]), vib: [5, 0.12] },
    ],
    level: lvl(0.028),
    vary: 0.6,
  }),
  /** starts searching: three quick notes scanning from left to right */
  search: (): Spec => ({
    len: 0.5,
    parts: [
      { at: 0, f: hz('A5'), decay: 0.04, timbre: 'pluck', pan: -0.6 },
      { at: 0.045, f: hz('C6'), decay: 0.04, timbre: 'pluck', pan: 0 },
      { at: 0.09, f: hz('E6'), decay: 0.07, timbre: 'pluck', pan: 0.6 },
    ],
    level: lvl(0.026),
    stereo: true,
    vary: 0.6,
  }),

  // ---- the mascot's own life
  greeting: () => VARIANT_SPECS.greeting[CHOICE.greeting](),
  /** a click on the mascot: a rubbery boop, the pitch dropping like a squashed ball */
  poke: (): Spec => ({
    len: 0.35,
    parts: [{ at: 0, f: hz('E4'), decay: 0.07, timbre: 'thud', pitch: st([0, 9], [0.05, 0]) }],
    level: lvl(0.025),
    reverb: 0.08,
    vary: 1,
  }),
  /** grumpy after three pokes: a low "hmph" - two short sagging notes and a puff of air */
  grumpy: (): Spec => ({
    len: 0.6,
    parts: [
      { at: 0.06, f: hz('D4'), decay: 0.06, timbre: 'pluck', pitch: st([0, 0], [0.08, -2]) },
      { at: 0.16, f: hz('A3'), decay: 0.12, timbre: 'pluck', pitch: st([0, 0], [0.15, -1.5]) },
      { at: 0.06, dur: 0.22, band: st([0, 900], [0.2, 500]), gain: 0.25, seed: 7 },
    ],
    level: lvl(0.028),
    vary: 0.8,
  }),
  /** overloaded after six: a wobbly fall swaying between the ears - dizzy */
  overload: (): Spec => ({
    len: 1.0,
    parts: [
      {
        at: 0,
        f: hz('G5'),
        decay: 0.35,
        timbre: 'sine',
        attack: 0.01,
        hold: 0.4,
        pitch: st([0, 0], [0.75, -9]),
        vib: [9, 0.9],
        pan: st([0, -0.7], [0.2, 0.7], [0.4, -0.7], [0.6, 0.7], [0.8, 0]),
      },
      {
        at: 0,
        f: hz('C5'),
        decay: 0.25,
        timbre: 'sine',
        gain: 0.4,
        hold: 0.3,
        pitch: st([0, 0], [0.7, -7]),
        vib: [7, 0.6],
      },
    ],
    level: lvl(0.056),
    stereo: true,
    vary: 0.5,
  }),
  /** a double click - a happy hop: a springy rise and two sparkles */
  joy: (): Spec => ({
    len: 0.8,
    parts: [
      { at: 0, f: hz('C6'), decay: 0.12, timbre: 'sine', pitch: st([0, -5], [0.1, 2], [0.16, 0]) },
      { at: 0.14, f: hz('E7'), decay: 0.1, timbre: 'bell', gain: 0.25 },
      { at: 0.21, f: hz('G7'), decay: 0.13, timbre: 'bell', gain: 0.2 },
    ],
    level: lvl(0.045),
    vary: 0.8,
  }),
  /** being stroked: a warm low purr under a contented "mm" */
  pet: (): Spec => ({
    len: 0.9,
    parts: [
      { at: 0, f: 110, decay: 0.22, timbre: 'sine', attack: 0.08, hold: 0.3, am: [24, 0.7], gain: 1.2 },
      { at: 0.05, f: hz('E5'), decay: 0.2, timbre: 'sine', attack: 0.06, gain: 0.25, pitch: st([0, 0], [0.3, -2]) },
    ],
    level: lvl(0.045),
    vary: 0.8,
  }),
  /** falling asleep: a yawn - a breathy tone sinking and fading */
  sleep: (): Spec => ({
    len: 0.8,
    parts: [
      { at: 0, f: hz('A4'), decay: 0.18, timbre: 'sine', attack: 0.09, hold: 0.15, pitch: st([0, 3], [0.55, -5]) },
      { at: 0, dur: 0.55, band: st([0, 1400], [0.5, 500]), gain: 0.35, attack: 0.12, seed: 3 },
    ],
    level: lvl(0.021),
    vary: 0.6,
  }),
  /** waking up: a quick chirp up and a soft pluck - eyes open */
  wake: (): Spec => ({
    len: 0.5,
    parts: [
      { at: 0, f: hz('C5'), decay: 0.05, timbre: 'sine', pitch: st([0, 0], [0.07, 7]) },
      { at: 0.09, f: hz('G5'), decay: 0.1, timbre: 'pluck', gain: 0.8 },
    ],
    level: lvl(0.03),
    vary: 0.6,
  }),

  // ---- the island and its controls (quietest tier)
  /** the island opens: a short airy rise */
  open: (): Spec => ({
    len: 0.4,
    parts: [{ at: 0, dur: 0.26, band: st([0, 600], [0.22, 3200]), attack: 0.06, seed: 5 }],
    level: lvl(0.018),
    reverb: 0.06,
  }),
  /** it folds: the same air, falling */
  close: (): Spec => ({
    len: 0.35,
    parts: [{ at: 0, dur: 0.22, band: st([0, 2800], [0.2, 500]), attack: 0.03, seed: 6 }],
    level: lvl(0.014),
    reverb: 0.06,
  }),
  /** it peeks out of the notch: a tiny "pip" up */
  peek: (): Spec => ({
    len: 0.35,
    parts: [{ at: 0, f: hz('G5'), decay: 0.06, timbre: 'sine', pitch: st([0, -5], [0.05, 0]) }],
    level: lvl(0.012),
    vary: 0.5,
  }),
  /** a tab, a link, a player button: a tiny wooden tick */
  tap: (): Spec => ({
    len: 0.2,
    parts: [{ at: 0, f: hz('E6'), decay: 0.025, timbre: 'click', attack: 0.001 }],
    level: lvl(0.009),
    reverb: 0.06,
    vary: 1,
  }),
  /** a switch or a choice: a two-part clack, drier than a tap */
  toggle: (): Spec => ({
    len: 0.15,
    parts: [
      { at: 0, f: hz('A6'), decay: 0.012, timbre: 'click', attack: 0.001 },
      { at: 0.018, f: hz('E6'), decay: 0.015, timbre: 'click', attack: 0.001, gain: 0.7 },
    ],
    level: lvl(0.006),
    reverb: 0.03,
    vary: 1,
  }),
  /** "Allow" from the island: up a major third - yes */
  approve: (): Spec => ({
    len: 0.6,
    parts: [
      { at: 0, f: hz('C6'), decay: 0.09 },
      { at: 0.07, f: hz('E6'), decay: 0.16 },
    ],
    level: lvl(0.038),
  }),
  /** a habit ticked: a bright pluck with a glint */
  check: (): Spec => ({
    len: 0.5,
    parts: [
      { at: 0, f: hz('G6'), decay: 0.07, timbre: 'pluck' },
      { at: 0.05, f: hz('C7'), decay: 0.09, timbre: 'bell', gain: 0.3 },
    ],
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
