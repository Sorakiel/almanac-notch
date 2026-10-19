// Renders the island's own sounds (stage 9a, docs/CHANGES.md) into apps/desktop/src/sounds/*.wav
// and a listening page into .parity/sounds.html. Every sample is synthesized here - no third-party
// recordings - so the set can be re-rendered and tuned: `node tools/sounds.mjs`. 48 kHz, 16-bit,
// mono (stereo where a sound moves: search, overload, the greeting). Deterministic.
//
// Palette: soft mallets and bells (sine partials, exponential decay) in C major pentatonic, a
// little room so nothing sounds dry. Three loudness tiers, after coucou's measured levels:
// events that need you (loudest), the mascot's own life, and the interface (barely there) -
// a click must never sound like a call.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 48000;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'apps/desktop/src/sounds');

/** note name → Hz */
const hz = (note) => {
  const m = /^([A-G])(#?)(\d)$/.exec(note);
  const st = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * 2 ** (st / 12);
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
};

/** deterministic noise, -1..1 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 31 - 1;
  };
}

/** value at time t along [[t, v], …] (linear, held at the ends) */
function curve(points, t) {
  if (!points) return 0;
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++)
    if (t <= points[i][0]) {
      const [t0, a] = points[i - 1],
        [t1, b] = points[i];
      return a + ((b - a) * (t - t0)) / (t1 - t0);
    }
  return points[points.length - 1][1];
}

/** equal-power pan, -1 left … 1 right */
const panGains = (p) => [Math.cos(((p + 1) * Math.PI) / 4), Math.sin(((p + 1) * Math.PI) / 4)];

/**
 * One note into [L, R]. decay - the fundamental's time constant, s; pitch - a semitone curve
 * [[t, st]…]; vib - [rate Hz, depth st]; hold - sustain before the decay (pads); pan - fixed or
 * [[t, pan]…]; am - [rate Hz, depth] amplitude wobble (a purr).
 */
function note(out, o) {
  const { at, f, decay, gain = 1, timbre = 'mallet', attack = 0.004, pitch, vib, hold = 0, pan = 0, am } = o;
  const [L, R] = out,
    parts = TIMBRES[timbre],
    i0 = Math.round(at * SR),
    n = Math.min(L.length - i0, Math.round((hold + decay * 7 + attack) * SR)),
    ph = parts.map(() => 0);
  for (let i = 0; i < n; i++) {
    const t = i / SR,
      st = curve(pitch, t) + (vib ? vib[1] * Math.sin(2 * Math.PI * vib[0] * t) : 0),
      k = 2 ** (st / 12),
      env = Math.min(1, t / attack) * (am ? 1 - am[1] * (0.5 + 0.5 * Math.sin(2 * Math.PI * am[0] * t)) : 1),
      td = Math.max(0, t - attack - hold);
    let v = 0;
    parts.forEach(([r, g, d], j) => {
      ph[j] += (2 * Math.PI * f * r * k) / SR;
      v += g * Math.sin(ph[j]) * Math.exp(-td / (decay * d));
    });
    const [gl, gr] = panGains(Array.isArray(pan) ? curve(pan, t) : pan);
    L[i0 + i] += v * env * gain * gl;
    R[i0 + i] += v * env * gain * gr;
  }
}

/** Filtered noise: a breath or a swoosh of air. band - [[t, cutoff Hz]…]: a one-pole lowpass
 *  over noise highpassed at half the cutoff. */
function noise(out, { at, dur, gain = 1, attack = 0.05, band, pan = 0, seed = 1 }) {
  const [L, R] = out,
    r = rng(seed),
    i0 = Math.round(at * SR),
    n = Math.min(L.length - i0, Math.round(dur * SR));
  let lp = 0,
    hp = 0,
    prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR,
      fc = curve(band, t),
      a = 1 - Math.exp((-2 * Math.PI * fc) / SR),
      b = Math.exp((-2 * Math.PI * fc * 0.5) / SR),
      xv = r();
    hp = b * (hp + xv - prev);
    prev = xv;
    lp += a * (hp - lp);
    const env = Math.min(1, t / attack) * Math.min(1, (dur - t) / (dur * 0.6)),
      [gl, gr] = panGains(Array.isArray(pan) ? curve(pan, t) : pan);
    L[i0 + i] += lp * env * gain * gl;
    R[i0 + i] += lp * env * gain * gr;
  }
}

/** A small room: four damped feedback combs (Schroeder), mixed low. */
function room(ch, mix) {
  const out = Float32Array.from(ch);
  for (const [ms, fb] of [
    [29.7, 0.62],
    [37.1, 0.58],
    [41.1, 0.55],
    [43.7, 0.52],
  ]) {
    const d = Math.round((ms / 1000) * SR),
      line = new Float32Array(ch.length);
    let lp = 0;
    for (let i = 0; i < ch.length; i++) {
      lp = lp * 0.4 + (i >= d ? line[i - d] : 0) * 0.6; // damping: the tail darkens
      line[i] = ch[i] + lp * fb;
      out[i] += line[i] * (mix / 4);
    }
  }
  return out;
}

/**
 * Renders the parts and sets the loudness: RMS `level` over the whole file (the measure used to
 * match coucou's tiers), the peak never above 0.95. Fades the last 40 ms.
 */
function render(len, parts, { level, reverb = 0.14, stereo = false }) {
  const n = Math.round(len * SR),
    out = [new Float32Array(n), new Float32Array(n)];
  for (const p of parts) (p.band ? noise : note)(out, p);
  let [L, R] = out.map((c) => room(c, reverb));
  if (!stereo) L = R = L.map((v, i) => v + R[i]);
  let sum = 0,
    peak = 0;
  for (let i = 0; i < n; i++) {
    sum += (L[i] * L[i] + R[i] * R[i]) / 2;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const k = Math.min(level / Math.sqrt(sum / n), 0.95 / peak),
    fade = Math.round(0.04 * SR);
  return (stereo ? [L, R] : [L]).map((c) => c.map((v, i) => v * k * Math.min(1, (n - i) / fade)));
}

/** RMS level: coucou's measured level of the matching sound x 2.5 - our master gain is 2.5x
 *  lower than its 0.2 (apps/desktop/src/sound.ts), so the tiers come out the same. */
const lvl = (coucouRms) => coucouRms * 2.5;

// Each sound's shape says what happened before its meaning is learned: up - "look here",
// down - "something went wrong" or "winding down", a chord - "done".
export const SOUNDS = {
  // ---- events: something needs you or finished (loudest tier)
  /** needs a permission: two warm notes up a fourth, a polite "excuse me" */
  attention: () =>
    render(
      0.75,
      [
        { at: 0, f: hz('E5'), decay: 0.16 },
        { at: 0.11, f: hz('A5'), decay: 0.22 },
      ],
      { level: lvl(0.066) },
    ),
  /** a question: a short note, then a higher one bending up into place - the rise of "hm?" */
  question: () =>
    render(
      0.7,
      [
        { at: 0, f: hz('G5'), decay: 0.12, gain: 0.8 },
        {
          at: 0.1,
          f: hz('D6'),
          decay: 0.2,
          pitch: [
            [0, -3],
            [0.09, 0],
          ],
        },
      ],
      { level: lvl(0.053) },
    ),
  /** done: a quick rolled major triad on a bell, the brightest sound of the set */
  success: () =>
    render(
      1.15,
      [
        { at: 0, f: hz('C6'), decay: 0.3, timbre: 'bell', gain: 0.8 },
        { at: 0.045, f: hz('E6'), decay: 0.32, timbre: 'bell', gain: 0.7 },
        { at: 0.09, f: hz('G6'), decay: 0.38, timbre: 'bell', gain: 0.65 },
      ],
      { level: lvl(0.09) },
    ),
  /** an error: two soft low notes falling a minor third, felt, no harshness */
  error: () =>
    render(
      0.8,
      [
        { at: 0, f: hz('E4'), decay: 0.13, timbre: 'pluck' },
        { at: 0.13, f: hz('C#4'), decay: 0.22, timbre: 'pluck' },
      ],
      { level: lvl(0.07) },
    ),
  /** the limit: one muted low thud sagging a tone - "stop", without alarm */
  ratelimit: () =>
    render(
      0.6,
      [
        {
          at: 0,
          f: hz('A3'),
          decay: 0.16,
          timbre: 'thud',
          pitch: [
            [0, 2],
            [0.05, 0],
          ],
        },
      ],
      { level: lvl(0.04) },
    ),
  /** a celebration (every habit done): a rising pentatonic run, a sparkle on top */
  dance: () =>
    render(
      1.4,
      [
        { at: 0, f: hz('C5'), decay: 0.16, timbre: 'bell', gain: 0.75 },
        { at: 0.075, f: hz('E5'), decay: 0.16, timbre: 'bell', gain: 0.75 },
        { at: 0.15, f: hz('G5'), decay: 0.18, timbre: 'bell', gain: 0.75 },
        { at: 0.225, f: hz('C6'), decay: 0.4, timbre: 'bell', gain: 0.85 },
        { at: 0.36, f: hz('E7'), decay: 0.12, timbre: 'bell', gain: 0.14 },
        { at: 0.42, f: hz('G7'), decay: 0.14, timbre: 'bell', gain: 0.12 },
      ],
      { level: lvl(0.062) },
    ),
  /** a reminder: one soft pluck - present, but the quietest call */
  nudge: () => render(0.6, [{ at: 0, f: hz('G5'), decay: 0.2, timbre: 'pluck' }], { level: lvl(0.04) }),

  // ---- the agent's work: only when a busy phase begins, never on every tool call
  /** starts working: two quick wooden knocks, rolling up sleeves */
  work: () =>
    render(
      0.4,
      [
        { at: 0, f: hz('G4'), decay: 0.035, timbre: 'click' },
        { at: 0.075, f: hz('C5'), decay: 0.05, timbre: 'click' },
      ],
      { level: lvl(0.017), reverb: 0.1 },
    ),
  /** starts thinking: a hollow "hmm" leaning up a semitone with a slow waver */
  think: () =>
    render(
      0.5,
      [
        {
          at: 0,
          f: hz('E5'),
          decay: 0.14,
          timbre: 'sine',
          attack: 0.04,
          pitch: [
            [0, 0],
            [0.25, 1],
          ],
          vib: [5, 0.12],
        },
      ],
      { level: lvl(0.028) },
    ),
  /** starts searching: three quick notes scanning from left to right */
  search: () =>
    render(
      0.5,
      [
        { at: 0, f: hz('A5'), decay: 0.04, timbre: 'pluck', pan: -0.6 },
        { at: 0.045, f: hz('C6'), decay: 0.04, timbre: 'pluck', pan: 0 },
        { at: 0.09, f: hz('E6'), decay: 0.07, timbre: 'pluck', pan: 0.6 },
      ],
      { level: lvl(0.026), stereo: true },
    ),

  // ---- the mascot's own life
  /** a click on the mascot: a rubbery boop, the pitch dropping like a squashed ball (the app
   *  shifts it a little on every poke, apps/desktop/src/sound.ts) */
  poke: () =>
    render(
      0.35,
      [
        {
          at: 0,
          f: hz('E4'),
          decay: 0.07,
          timbre: 'thud',
          pitch: [
            [0, 9],
            [0.05, 0],
          ],
        },
      ],
      { level: lvl(0.025), reverb: 0.08 },
    ),
  /** grumpy after three pokes: a low "hmph" - two short sagging notes and a puff of air */
  grumpy: () =>
    render(
      0.6,
      [
        {
          at: 0.06,
          f: hz('D4'),
          decay: 0.06,
          timbre: 'pluck',
          pitch: [
            [0, 0],
            [0.08, -2],
          ],
        },
        {
          at: 0.16,
          f: hz('A3'),
          decay: 0.12,
          timbre: 'pluck',
          pitch: [
            [0, 0],
            [0.15, -1.5],
          ],
        },
        {
          at: 0.06,
          dur: 0.22,
          band: [
            [0, 900],
            [0.2, 500],
          ],
          gain: 0.25,
          seed: 7,
        },
      ],
      { level: lvl(0.028) },
    ),
  /** overloaded after six: a wobbly fall swaying between the ears - dizzy */
  overload: () =>
    render(
      1.0,
      [
        {
          at: 0,
          f: hz('G5'),
          decay: 0.35,
          timbre: 'sine',
          attack: 0.01,
          hold: 0.4,
          pitch: [
            [0, 0],
            [0.75, -9],
          ],
          vib: [9, 0.9],
          pan: [
            [0, -0.7],
            [0.2, 0.7],
            [0.4, -0.7],
            [0.6, 0.7],
            [0.8, 0],
          ],
        },
        {
          at: 0,
          f: hz('C5'),
          decay: 0.25,
          timbre: 'sine',
          gain: 0.4,
          hold: 0.3,
          pitch: [
            [0, 0],
            [0.7, -7],
          ],
          vib: [7, 0.6],
        },
      ],
      { level: lvl(0.056), stereo: true },
    ),
  /** a double click - a happy hop: a springy rise and two sparkles */
  joy: () =>
    render(
      0.8,
      [
        {
          at: 0,
          f: hz('C6'),
          decay: 0.12,
          timbre: 'sine',
          pitch: [
            [0, -5],
            [0.1, 2],
            [0.16, 0],
          ],
        },
        { at: 0.14, f: hz('E7'), decay: 0.1, timbre: 'bell', gain: 0.25 },
        { at: 0.21, f: hz('G7'), decay: 0.13, timbre: 'bell', gain: 0.2 },
      ],
      { level: lvl(0.045) },
    ),
  /** being stroked: a warm low purr under a contented "mm" */
  pet: () =>
    render(
      0.9,
      [
        { at: 0, f: 110, decay: 0.22, timbre: 'sine', attack: 0.08, hold: 0.3, am: [24, 0.7], gain: 1.2 },
        {
          at: 0.05,
          f: hz('E5'),
          decay: 0.2,
          timbre: 'sine',
          attack: 0.06,
          gain: 0.25,
          pitch: [
            [0, 0],
            [0.3, -2],
          ],
        },
      ],
      { level: lvl(0.045) },
    ),
  /** falling asleep: a yawn - a breathy tone sinking and fading */
  sleep: () =>
    render(
      0.8,
      [
        {
          at: 0,
          f: hz('A4'),
          decay: 0.18,
          timbre: 'sine',
          attack: 0.09,
          hold: 0.15,
          pitch: [
            [0, 3],
            [0.55, -5],
          ],
        },
        {
          at: 0,
          dur: 0.55,
          band: [
            [0, 1400],
            [0.5, 500],
          ],
          gain: 0.35,
          attack: 0.12,
          seed: 3,
        },
      ],
      { level: lvl(0.021) },
    ),
  /** waking up: a quick chirp up and a soft pluck - eyes open */
  wake: () =>
    render(
      0.5,
      [
        {
          at: 0,
          f: hz('C5'),
          decay: 0.05,
          timbre: 'sine',
          pitch: [
            [0, 0],
            [0.07, 7],
          ],
        },
        { at: 0.09, f: hz('G5'), decay: 0.1, timbre: 'pluck', gain: 0.8 },
      ],
      { level: lvl(0.03) },
    ),
  /**
   * The launch greeting, scored to its animation (docs/SPEC.md, 3): the warp swells (0-1.0),
   * the glow pad rises (0.6), the mascot bobs up (1.35), opens its eyes (1.95 - a bell), looks
   * left and right (2.3, 2.6 - panned ticks), hops twice (2.95, 3.40) with sparks (3.02), and
   * everything settles by 4.6. The app fades it out if the greeting ends early.
   */
  greeting: () =>
    render(
      4.7,
      [
        // warp: rising air from the middle out, and a low tone climbing an octave under it
        {
          at: 0,
          dur: 1.05,
          band: [
            [0, 300],
            [0.95, 5000],
          ],
          gain: 0.5,
          attack: 0.5,
          seed: 11,
        },
        {
          at: 0,
          f: hz('C4'),
          decay: 0.25,
          timbre: 'sine',
          attack: 0.7,
          hold: 0.25,
          gain: 0.25,
          pitch: [
            [0, -12],
            [1, 0],
          ],
        },
        // glow: a soft C major add9 pad
        ...['C4', 'G4', 'D5', 'E5'].map((n, i) => ({
          at: 0.6 + i * 0.05,
          f: hz(n),
          decay: 0.9,
          timbre: 'sine',
          attack: 0.6,
          hold: 1.6,
          gain: 0.16,
        })),
        // rises from the ground: a bloop up
        {
          at: 1.35,
          f: hz('G4'),
          decay: 0.09,
          timbre: 'sine',
          gain: 0.7,
          pitch: [
            [0, -7],
            [0.08, 0],
          ],
        },
        // eyes open: a bell
        { at: 1.95, f: hz('E6'), decay: 0.35, timbre: 'bell', gain: 0.75 },
        // looks left, then right
        { at: 2.3, f: hz('A5'), decay: 0.03, timbre: 'click', gain: 0.3, pan: -0.7 },
        { at: 2.6, f: hz('C6'), decay: 0.03, timbre: 'click', gain: 0.3, pan: 0.7 },
        // two happy hops and the sparks
        ...[
          [2.95, 'G5', 0.14],
          [3.4, 'C6', 0.22],
        ].map(([at, n, decay]) => ({
          at,
          f: hz(n),
          decay,
          pitch: [
            [0, -3],
            [0.06, 0],
          ],
        })),
        { at: 3.02, f: hz('G7'), decay: 0.1, timbre: 'bell', gain: 0.18, pan: -0.4 },
        { at: 3.09, f: hz('C7'), decay: 0.1, timbre: 'bell', gain: 0.16, pan: 0.4 },
        { at: 3.16, f: hz('E7'), decay: 0.12, timbre: 'bell', gain: 0.14 },
        // settles: the root under it all
        { at: 3.4, f: hz('C4'), decay: 0.45, timbre: 'sine', attack: 0.1, gain: 0.25 },
      ],
      { level: lvl(0.049), reverb: 0.2, stereo: true },
    ),

  // ---- the island and its controls (quietest tier)
  /** the island opens: a short airy rise */
  open: () =>
    render(
      0.4,
      [
        {
          at: 0,
          dur: 0.26,
          band: [
            [0, 600],
            [0.22, 3200],
          ],
          attack: 0.06,
          seed: 5,
        },
      ],
      { level: lvl(0.018), reverb: 0.06 },
    ),
  /** it folds: the same air, falling */
  close: () =>
    render(
      0.35,
      [
        {
          at: 0,
          dur: 0.22,
          band: [
            [0, 2800],
            [0.2, 500],
          ],
          attack: 0.03,
          seed: 6,
        },
      ],
      { level: lvl(0.014), reverb: 0.06 },
    ),
  /** it peeks out of the notch: a tiny "pip" up */
  peek: () =>
    render(
      0.35,
      [
        {
          at: 0,
          f: hz('G5'),
          decay: 0.06,
          timbre: 'sine',
          pitch: [
            [0, -5],
            [0.05, 0],
          ],
        },
      ],
      { level: lvl(0.012) },
    ),
  /** a tab, a link, a player button: a tiny wooden tick */
  tap: () =>
    render(0.2, [{ at: 0, f: hz('E6'), decay: 0.025, timbre: 'click', attack: 0.001 }], {
      level: lvl(0.009),
      reverb: 0.06,
    }),
  /** a switch or a choice: a two-part clack, drier than a tap */
  toggle: () =>
    render(
      0.15,
      [
        { at: 0, f: hz('A6'), decay: 0.012, timbre: 'click', attack: 0.001 },
        { at: 0.018, f: hz('E6'), decay: 0.015, timbre: 'click', attack: 0.001, gain: 0.7 },
      ],
      { level: lvl(0.006), reverb: 0.03 },
    ),
  /** "Allow" from the island: up a major third - yes */
  approve: () =>
    render(
      0.6,
      [
        { at: 0, f: hz('C6'), decay: 0.09 },
        { at: 0.07, f: hz('E6'), decay: 0.16 },
      ],
      { level: lvl(0.038) },
    ),
  /** a habit ticked: a bright pluck with a glint */
  check: () =>
    render(
      0.5,
      [
        { at: 0, f: hz('G6'), decay: 0.07, timbre: 'pluck' },
        { at: 0.05, f: hz('C7'), decay: 0.09, timbre: 'bell', gain: 0.3 },
      ],
      { level: lvl(0.03) },
    ),
};

/** What each sound means, for the listening page. */
const LABELS = {
  attention: 'Разрешение',
  question: 'Вопрос',
  success: 'Готово: агент закончил, деплой прошёл, алерт снят',
  error: 'Ошибка',
  ratelimit: 'Лимит',
  dance: 'Праздник: все привычки отмечены',
  nudge: 'Напоминание',
  work: 'Агент начал работать',
  think: 'Агент начал думать',
  search: 'Агент начал искать',
  greeting: 'Приветствие при первом запуске (под анимацию)',
  poke: 'Клик по маскоту',
  grumpy: 'Три клика: ворчит',
  overload: 'Шесть кликов: голова кругом',
  joy: 'Двойной клик: радость',
  pet: 'Поглаживание',
  sleep: 'Засыпает',
  wake: 'Просыпается',
  open: 'Остров открылся',
  close: 'Остров закрылся',
  peek: 'Остров выглянул (полуоткрыт)',
  tap: 'Вкладка, ссылка, кнопка плеера',
  toggle: 'Переключатель, выбор',
  approve: 'Ответ «Разрешить»',
  check: 'Привычка отмечена',
};
const GROUPS = [
  ['События', ['attention', 'question', 'success', 'error', 'ratelimit', 'dance', 'nudge']],
  ['Работа агента', ['work', 'think', 'search']],
  ['Маскот', ['greeting', 'poke', 'grumpy', 'overload', 'joy', 'pet', 'sleep', 'wake']],
  ['Остров и кнопки', ['open', 'close', 'peek', 'tap', 'toggle', 'approve', 'check']],
];

function wav(ch) {
  const n = ch[0].length,
    nc = ch.length,
    data = Buffer.alloc(n * nc * 2);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < nc; c++)
      data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, ch[c][i])) * 32767), (i * nc + c) * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(nc, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2 * nc, 28);
  h.writeUInt16LE(2 * nc, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

mkdirSync(OUT, { recursive: true });
const files = {};
for (const [name, make] of Object.entries(SOUNDS)) {
  const ch = make();
  files[name] = wav(ch);
  writeFileSync(resolve(OUT, name + '.wav'), files[name]);
  console.log(name.padEnd(10), (ch[0].length / SR).toFixed(2) + ' s', ch.length === 2 ? 'stereo' : '');
}

// The listening page: every sound with its moment, at the app's volume curve (src/sound.ts).
const buttons = GROUPS.map(
  ([title, names]) =>
    `<h3>${title}</h3>` +
    names
      .map(
        (n) =>
          `<button data-src="data:audio/wav;base64,${files[n].toString('base64')}"><b>${LABELS[n]}</b><small>${n}</small></button>`,
      )
      .join('\n'),
).join('\n');
const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Звуки острова</title>
<style>body{background:#000;color:#eee;font:15px system-ui;max-width:560px;margin:32px auto;padding:0 16px}
h3{color:#888;font-size:13px;font-weight:600;margin:22px 0 6px}
button{display:flex;justify-content:space-between;gap:12px;width:100%;margin:6px 0;padding:13px 16px;border-radius:14px;border:1px solid #2a2a2a;background:#141414;color:#eee;font:inherit;cursor:pointer;text-align:left}
button:hover{background:#1e1e1e}small{color:#777}label{display:flex;gap:12px;align-items:center;margin:16px 0}</style>
<h2>Звуки острова (этап 9a)</h2>
<label>Громкость <input id="v" type="range" min="0" max="1" step="0.01" value="0.6"> <span id="o"></span></label>
<p style="color:#888">60% - громкость по умолчанию. Три уровня: события громче всего, жизнь маскота тише, остров и кнопки еле слышны.</p>
${buttons}
<script>
const ctx = new AudioContext(), g = ctx.createGain(); g.connect(ctx.destination);
const v = document.getElementById('v'), o = document.getElementById('o');
const set = () => { g.gain.value = v.value * 0.08; o.textContent = Math.round(v.value * 100) + '%'; };
v.oninput = set; set();
for (const b of document.querySelectorAll('button')) b.onclick = async () => {
  await ctx.resume();
  const buf = await ctx.decodeAudioData(await (await fetch(b.dataset.src)).arrayBuffer());
  const s = ctx.createBufferSource(); s.buffer = buf; s.connect(g); s.start();
};
</script>`;
mkdirSync(resolve(ROOT, '.parity'), { recursive: true });
writeFileSync(resolve(ROOT, '.parity/sounds.html'), page);
