// Stage 9g: our synthesized sounds written as WAV next to coucou's files, with duration, peak,
// loudness and brightness for each pair. node tools/sounds-pair.mjs <coucou sounds dir> [out-dir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { synth } from '../apps/desktop/src/synth.ts';
const [cc, out = '.parity/9g/snd'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const SR = 44100;
// our sound -> coucou's closest by moment
const PAIRS = { open: 'open', close: 'close', peek: 'peek', question: 'question', attention: 'approval', success: 'finish', error: 'error',
  greeting: 'greeting', think: 'think', search: 'search', work: 'work', sleep: 'sleep', tap: 'tick', toggle: 'blip', shelve: 'attach', joy: 'proud', grumpy: 'annoyed', poke: 'slap', overload: 'dizzy', wake: 'yawn', pet: 'love' };
function wav(ch) {
  const n = ch[0].length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-1, Math.min(1, ch[0][i])) * 32767, 44 + i * 2);
  return b;
}
for (const [mine, theirs] of Object.entries(PAIRS)) {
  try { writeFileSync(`${out}/ours-${mine}.wav`, wav(synth(mine, SR).channels)); console.log(mine, theirs); } catch (e) { console.log('skip', mine, e.message); }
}
writeFileSync(`${out}/pairs.json`, JSON.stringify(PAIRS));
