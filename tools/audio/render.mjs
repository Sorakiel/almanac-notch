// Renders every sound of src/synth.ts to WAV: node tools/audio/render.mjs <path to synth.ts> <dir>
import { writeFileSync } from 'node:fs';
const { SOUND_NAMES, synth } = await import(process.argv[2]);
const out = process.argv[3];
for (const n of SOUND_NAMES) {
  const { channels: ch } = synth(n, 48000);
  const len = ch[0].length, nc = ch.length, d = Buffer.alloc(len * nc * 2);
  for (let i = 0; i < len; i++) for (let c = 0; c < nc; c++) d.writeInt16LE(Math.round(Math.max(-1, Math.min(1, ch[c][i])) * 32767), (i * nc + c) * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + d.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(nc, 22); h.writeUInt32LE(48000, 24); h.writeUInt32LE(96000 * nc, 28); h.writeUInt16LE(2 * nc, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(d.length, 40);
  writeFileSync(`${out}/${n}.wav`, Buffer.concat([h, d]));
}
