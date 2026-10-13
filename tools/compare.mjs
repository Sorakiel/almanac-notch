#!/usr/bin/env node
// Compares the port's frames with the prototype's reference frames, scene by scene.
//
//   node tools/compare.mjs                     reference/screens vs .parity/port
//   node tools/compare.mjs --max 0.01          allowed share of differing pixels per frame (default 0.01)
//
// Writes diff images to .parity/diff and a report to .parity/report.md. Exit code 1 if any frame is over the
// limit or missing. A difference that is an intended improvement goes into docs/CHANGES.md and the owner
// approves it before the reference is regenerated; it is never "fixed" by loosening --max.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const refDir = resolve(root, opt('ref', 'reference/screens'));
const portDir = resolve(root, opt('port', '.parity/port'));
const diffDir = resolve(root, '.parity/diff');
const max = parseFloat(opt('max', '0.01'));
mkdirSync(diffDir, { recursive: true });

const rows = [];
let bad = 0;
for (const f of readdirSync(refDir).filter(f => f.endsWith('.png')).sort()) {
  const pf = join(portDir, f);
  if (!existsSync(pf)) { rows.push(`| ${f} | нет кадра | ✗ |`); bad++; continue; }
  const a = PNG.sync.read(readFileSync(join(refDir, f))), b = PNG.sync.read(readFileSync(pf));
  if (a.width !== b.width || a.height !== b.height) { rows.push(`| ${f} | размер ${b.width}×${b.height} вместо ${a.width}×${a.height} | ✗ |`); bad++; continue; }
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  const share = n / (a.width * a.height);
  writeFileSync(join(diffDir, f), PNG.sync.write(diff));
  const ok = share <= max;
  if (!ok) bad++;
  rows.push(`| ${f} | ${(share * 100).toFixed(2)}% | ${ok ? '✓' : '✗'} |`);
}
const report = `# Сверка с прототипом\n\nПорог: ${(max * 100).toFixed(2)}% пикселей на кадр. Не прошло: ${bad}.\n\n| кадр | отличие | итог |\n|---|---|---|\n${rows.join('\n')}\n`;
writeFileSync(resolve(root, '.parity/report.md'), report);
console.log(report);
process.exit(bad ? 1 : 0);
