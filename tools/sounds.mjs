// The listening page for the island's sounds (stage 9a): `node tools/sounds.mjs` → .parity/sounds.html.
// The sounds themselves are synthesized by the app at run time (apps/desktop/src/synth.ts, run
// here directly by Node's type stripping); the page embeds renders of them as WAV, every sound
// with its moment, the variants to choose from, and several renders of the sounds that differ
// from play to play.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHOICE, SOUND_NAMES, synth, synthVariant, VARIANTS, varies } from '../apps/desktop/src/synth.ts';

// 32 kHz keeps the page small; the app renders at the device rate
const SR = 32000;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** What each sound means. */
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

function wav({ channels: ch }) {
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
  return 'data:audio/wav;base64,' + Buffer.concat([h, data]).toString('base64');
}

/** a button that plays its renders in turn: one for a fixed sound, three for one that varies */
const button = (label, small, srcs) =>
  `<button data-src='${JSON.stringify(srcs)}'><b>${label}</b><small>${small}</small></button>`;

const missing = SOUND_NAMES.filter((n) => !LABELS[n]);
if (missing.length) throw new Error('no label: ' + missing.join(', '));

const sections = GROUPS.map(
  ([title, names]) =>
    `<h3>${title}</h3>` +
    names
      .map((n) => {
        const srcs = varies(n) ? [1, 2, 3].map((seed) => wav(synth(n, SR, seed))) : [wav(synth(n, SR))];
        return button(LABELS[n], varies(n) ? n + ' · каждый раз чуть иначе' : n, srcs);
      })
      .join('\n'),
).join('\n');
const variants = Object.entries(VARIANTS)
  .map(
    ([name, vs]) =>
      `<h3>${LABELS[name]}: варианты</h3>` +
      Object.entries(vs)
        .map(([v, words]) =>
          button(
            `${v.toUpperCase()} - ${words}`,
            CHOICE[name] === v ? 'сейчас в приложении' : '',
            [wav(synthVariant(name, v, SR))],
          ),
        )
        .join('\n'),
  )
  .join('\n');

const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Звуки острова</title>
<style>body{background:#000;color:#eee;font:15px system-ui;max-width:600px;margin:32px auto;padding:0 16px}
h2{margin-top:36px}h3{color:#888;font-size:13px;font-weight:600;margin:22px 0 6px}
button{display:flex;justify-content:space-between;gap:12px;width:100%;margin:6px 0;padding:13px 16px;border-radius:14px;border:1px solid #2a2a2a;background:#141414;color:#eee;font:inherit;cursor:pointer;text-align:left}
button:hover{background:#1e1e1e}small{color:#777;white-space:nowrap}label{display:flex;gap:12px;align-items:center;margin:16px 0}p{color:#888}</style>
<h1 style="font-size:22px">Звуки острова (этап 9a)</h1>
<label>Громкость <input id="v" type="range" min="0" max="1" step="0.01" value="0.6"> <span id="o"></span></label>
<p>60% - громкость по умолчанию. Три уровня: события громче всего, маскот тише, остров и кнопки еле слышны. Ночью (22-8) приложение играет всё на треть тише, под музыку кнопки молчат, остальное вдвое тише.</p>
<h2>Выбрать вариант</h2>
<p>Напиши букву для каждого: например, «разрешение B, вопрос A, готово C, приветствие A».</p>
${variants}
<h2>Все звуки</h2>
<p>Звуки маскота и кнопок каждый раз чуть разные - нажми несколько раз.</p>
${sections}
<script>
const ctx = new AudioContext(), g = ctx.createGain(); g.connect(ctx.destination);
const v = document.getElementById('v'), o = document.getElementById('o');
const set = () => { g.gain.value = v.value * 0.08; o.textContent = Math.round(v.value * 100) + '%'; };
v.oninput = set; set();
for (const b of document.querySelectorAll('button')) {
  const srcs = JSON.parse(b.dataset.src);
  let i = 0;
  b.onclick = async () => {
    await ctx.resume();
    const buf = await ctx.decodeAudioData(await (await fetch(srcs[i++ % srcs.length])).arrayBuffer());
    const s = ctx.createBufferSource(); s.buffer = buf; s.connect(g); s.start();
  };
}
</script>`;
mkdirSync(resolve(ROOT, '.parity'), { recursive: true });
writeFileSync(resolve(ROOT, '.parity/sounds.html'), page);
console.log('.parity/sounds.html', (page.length / 1e6).toFixed(1) + ' MB');
