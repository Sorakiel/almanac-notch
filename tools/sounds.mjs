// Renders the island's own sounds (stage 9a, docs/CHANGES.md) into apps/desktop/src/sounds/*.wav.
// Every sample is synthesized here - no third-party recordings - so the set can be re-rendered
// and tuned: `node tools/sounds.mjs`. 48 kHz, mono, 16-bit.
//
// Palette: soft mallets (sine + a few inharmonic partials, fast attack, exponential decay) in
// one key (C major pentatonic), a touch of room so they don't sound dry and clicky. Every event
// sound is short (under a second) and peaks at the same level; the app sets the volume.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 48000;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/desktop/src/sounds');

/** semitones from A4 → Hz */
const hz = (note) => {
  const m = /^([A-G])(#?)(\d)$/.exec(note);
  const st = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * 2 ** (st / 12);
};

// Partials [ratio, gain, decay multiplier]: a marimba-like bar (the 4x and ~10x modes of a
// tuned bar die fast), a glassy bell, a felt-soft "pluck" and a muted low "thud".
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
};

/** One struck note into `buf`. glide: start this many semitones off and slide in over `glideT` s. */
function note(buf, { at, f, decay, gain = 1, timbre = 'mallet', attack = 0.004, glide = 0, glideT = 0.06 }) {
  const i0 = Math.round(at * SR),
    n = Math.min(buf.length - i0, Math.round(decay * 7 * SR));
  const phases = TIMBRES[timbre].map(() => 0);
  for (let i = 0; i < n; i++) {
    const t = i / SR,
      bend = glide ? 2 ** ((glide * Math.max(0, 1 - t / glideT) ** 2) / 12) : 1,
      env = Math.min(1, t / attack);
    let v = 0;
    TIMBRES[timbre].forEach(([r, g, d], k) => {
      phases[k] += (2 * Math.PI * f * r * bend) / SR;
      v += g * Math.sin(phases[k]) * Math.exp(-t / (decay * d));
    });
    buf[i0 + i] += v * env * gain;
  }
}

/** A small room: a few damped feedback combs (Schroeder), mixed low. */
function room(buf, mix = 0.14) {
  const out = Float32Array.from(buf);
  for (const [ms, fb] of [
    [29.7, 0.62],
    [37.1, 0.58],
    [41.1, 0.55],
    [43.7, 0.52],
  ]) {
    const d = Math.round((ms / 1000) * SR),
      line = new Float32Array(buf.length);
    let lp = 0;
    for (let i = 0; i < buf.length; i++) {
      const back = i >= d ? line[i - d] : 0;
      lp = lp * 0.4 + back * 0.6; // damping: the tail darkens
      line[i] = buf[i] + lp * fb;
      out[i] += line[i] * (mix / 4);
    }
  }
  return out;
}

/** Normalizes the peak, fades the last 30 ms, trims trailing silence. */
function finish(buf, peak = 0.8) {
  let end = buf.length;
  while (end > 1 && Math.abs(buf[end - 1]) < 1e-4) end--;
  const b = buf.subarray(0, end);
  let m = 0;
  for (const v of b) m = Math.max(m, Math.abs(v));
  const k = m ? peak / m : 0,
    fade = Math.round(0.03 * SR);
  for (let i = 0; i < b.length; i++) b[i] *= k * Math.min(1, (b.length - i) / fade);
  return b;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function render(len, notes, { reverb = 0.14, peak = 0.8 } = {}) {
  const buf = new Float32Array(Math.round(len * SR));
  for (const n of notes) note(buf, n);
  return finish(room(buf, reverb), peak);
}

// Each sound's shape says what happened, before its meaning is learned:
// up = "look here", down = "something went wrong", a chord = "done".
export const SOUNDS = {
  // needs a permission: two warm notes up a fourth - a polite "excuse me"
  attention: () =>
    render(0.7, [
      { at: 0, f: hz('E5'), decay: 0.16 },
      { at: 0.11, f: hz('A5'), decay: 0.22 },
    ]),
  // a question: a short note, then a higher one that bends up into place - the rise of "hm?"
  question: () =>
    render(0.7, [
      { at: 0, f: hz('G5'), decay: 0.12, gain: 0.8 },
      { at: 0.1, f: hz('D6'), decay: 0.2, glide: -3, glideT: 0.09 },
    ]),
  // done: a quick rolled major triad on a bell, the brightest sound of the set
  success: () =>
    render(1.1, [
      { at: 0, f: hz('C6'), decay: 0.3, timbre: 'bell', gain: 0.8 },
      { at: 0.045, f: hz('E6'), decay: 0.32, timbre: 'bell', gain: 0.7 },
      { at: 0.09, f: hz('G6'), decay: 0.38, timbre: 'bell', gain: 0.65 },
    ]),
  // an error: two soft low notes falling a minor third, felt mallet, no harshness
  error: () =>
    render(0.75, [
      { at: 0, f: hz('E4'), decay: 0.13, timbre: 'pluck' },
      { at: 0.13, f: hz('C#4'), decay: 0.22, timbre: 'pluck' },
    ]),
  // the limit: one muted low thud - "stop", without alarm
  ratelimit: () => render(0.6, [{ at: 0, f: hz('A2') * 2, decay: 0.16, timbre: 'thud', glide: 2, glideT: 0.05 }]),
  // a celebration (every habit done): a rising pentatonic run on the bell
  dance: () =>
    render(1.3, [
      { at: 0, f: hz('C5'), decay: 0.16, timbre: 'bell', gain: 0.75 },
      { at: 0.075, f: hz('E5'), decay: 0.16, timbre: 'bell', gain: 0.75 },
      { at: 0.15, f: hz('G5'), decay: 0.18, timbre: 'bell', gain: 0.75 },
      { at: 0.225, f: hz('C6'), decay: 0.4, timbre: 'bell', gain: 0.85 },
    ]),
  // a reminder: one soft pluck - present, but the quietest call for attention
  nudge: () => render(0.6, [{ at: 0, f: hz('G5'), decay: 0.2, timbre: 'pluck', gain: 0.9 }], { peak: 0.6 }),
  // an answer was sent ("Allow" / "Deny" / an option): a tiny wooden tick
  tap: () => render(0.2, [{ at: 0, f: hz('E6'), decay: 0.025, timbre: 'click', attack: 0.001 }], { reverb: 0.06, peak: 0.25 }),
};

mkdirSync(OUT, { recursive: true });
for (const [name, make] of Object.entries(SOUNDS)) {
  const s = make();
  writeFileSync(resolve(OUT, name + '.wav'), wav(s));
  console.log(name.padEnd(10), (s.length / SR).toFixed(2) + ' s');
}

// A listening page for the owner: every sound with its event, at the app's volume curve.
const LABELS = {
  attention: 'Разрешение',
  question: 'Вопрос',
  success: 'Готово: агент закончил, деплой прошёл, алерт снят',
  error: 'Ошибка',
  ratelimit: 'Лимит',
  dance: 'Праздник: все привычки отмечены',
  nudge: 'Напоминание',
  tap: 'Ответ: «Разрешить» / «Отклонить»',
};
const rows = Object.keys(SOUNDS)
  .map((n) => {
    const b64 = readFileSync(resolve(OUT, n + '.wav')).toString('base64');
    return `<button data-src="data:audio/wav;base64,${b64}"><b>${LABELS[n]}</b><small>${n}</small></button>`;
  })
  .join('\n');
const page = `<!doctype html><meta charset="utf-8"><title>Звуки острова</title>
<style>body{background:#000;color:#eee;font:15px system-ui;max-width:520px;margin:32px auto;padding:0 16px}
button{display:flex;justify-content:space-between;width:100%;margin:6px 0;padding:14px 16px;border-radius:14px;border:1px solid #333;background:#141414;color:#eee;font:inherit;cursor:pointer}
button:hover{background:#1e1e1e}small{color:#888}label{display:flex;gap:12px;align-items:center;margin:16px 0}</style>
<h2>Звуки острова (этап 9a)</h2>
<label>Громкость <input id="v" type="range" min="0" max="1" step="0.01" value="0.6"> <span id="o">60%</span></label>
<p style="color:#888">60% - громкость по умолчанию в приложении.</p>
${rows}
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
mkdirSync(resolve(OUT, '../../../../.parity'), { recursive: true });
writeFileSync(resolve(OUT, '../../../../.parity/sounds.html'), page);
