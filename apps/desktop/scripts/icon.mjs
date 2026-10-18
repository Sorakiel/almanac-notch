// `node apps/desktop/scripts/icon.mjs` - app and tray icons from the mascot (stage 8f).
// The body is the prototype's egg (shape.ts: superellipse N_EXP 2.3, widthAt, b = 0.92 R),
// the eyes are the resting pose (pose.ts eyesOf: spacing, 0.19 R x 0.40 R, raised 0.04 b),
// colours are "Мел" (settings.ts CHALK). Writes SVGs, renders PNGs with Playwright, then
// `tauri icon` makes every size. Re-run only when the look changes.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const icons = join(desktop, 'src-tauri', 'icons');
const src = join(icons, 'source');
mkdirSync(src, { recursive: true });

const N_EXP = 2.3;
const widthAt = (yn) => (yn > 0 ? 1 + 0.05 * yn : 1 - 0.13 * yn * yn);
const BODY = Array.from({ length: 80 }, (_, i) => {
  const th = (i / 80) * Math.PI * 2,
    c = Math.cos(th),
    s = Math.sin(th);
  const y = Math.sign(s) * Math.pow(Math.abs(s), 2 / N_EXP);
  return [Math.sign(c) * Math.pow(Math.abs(c), 2 / N_EXP) * widthAt(y), y];
});

/** proto: bodyPath as an SVG path, centred on (cx, cy) */
function body(cx, cy, R) {
  const b = R * 0.92,
    p = (i) => BODY[i % 80],
    f = (n) => n.toFixed(2);
  const mid = (i) => [cx + ((p(i)[0] + p(i + 1)[0]) / 2) * R, cy + ((p(i)[1] + p(i + 1)[1]) / 2) * b];
  let m = mid(0),
    d = `M${f(m[0])} ${f(m[1])}`;
  for (let i = 1; i <= 80; i++) {
    const q = p(i);
    m = mid(i);
    d += ` Q${f(cx + q[0] * R)} ${f(cy + q[1] * b)} ${f(m[0])} ${f(m[1])}`;
  }
  return d + 'Z';
}

/** proto eyesOf at rest; boost = S.eyeSize (1.3), times S.notchEye (1.3) in the notch */
function eyes(cx, cy, R, fill, boost) {
  const b = R * 0.92,
    w = R * 0.19 * boost,
    h = R * 0.4 * boost,
    sp = R * 0.46 * (0.72 + 0.28 * boost);
  return [-1, 1]
    .map((side) => {
      const x = cx + (side * sp) / 2 - w / 2,
        y = cy - b * 0.04 - h / 2;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w / 2}" fill="${fill}"/>`;
    })
    .join('');
}

// app icon: the macOS grid - an 824 px rounded square on a 1024 canvas, dark like the island
const S = 1024,
  R = 250,
  cy = 530;
const app = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26272c"/><stop offset="1" stop-color="#0c0c0e"/></linearGradient>
  <linearGradient id="shade" x1="0" y1="${cy - R * 0.92}" x2="0" y2="${cy + R * 0.92}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#fff" stop-opacity="0.18"/><stop offset="0.45" stop-color="#B9B7AE" stop-opacity="0"/><stop offset="1" stop-color="#B9B7AE" stop-opacity="0.75"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.56" r="0.45"><stop offset="0" stop-color="#EEEDE8" stop-opacity="0.16"/><stop offset="1" stop-color="#EEEDE8" stop-opacity="0"/></radialGradient>
</defs>
<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)"/>
<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#glow)"/>
<rect x="100.5" y="100.5" width="823" height="823" rx="184.5" fill="none" stroke="#fff" stroke-opacity="0.08"/>
<path d="${body(512, cy, R)}" fill="#EEEDE8"/>
<path d="${body(512, cy, R)}" fill="url(#shade)"/>
${eyes(512, cy, R, '#16171A', 1.3)}
</svg>`;

// tray: a silhouette with the eyes cut out; macOS tints it (template image), Windows gets the
// light version for the dark taskbar
const T = 64,
  TR = 26,
  tcy = 33;
const tray = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="${T}" height="${T}" viewBox="0 0 ${T} ${T}">
<mask id="m"><rect width="${T}" height="${T}" fill="#fff"/>${eyes(32, tcy, TR, '#000', 1.69)}</mask>
<path d="${body(32, tcy, TR)}" fill="${fill}" mask="url(#m)"/>
</svg>`;

const files = { 'app.svg': app, 'tray-template.svg': tray('#000'), 'tray-light.svg': tray('#EEEDE8') };
for (const [name, svg] of Object.entries(files)) writeFileSync(join(src, name), svg);

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(svg, size, out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`,
  );
  await page.screenshot({ path: out, omitBackground: true });
}
await png(app, 1024, join(src, 'app.png'));
// 22 pt menu-bar icon at 2x; the light one at 32 px for Windows
await png(tray('#000'), 44, join(icons, 'tray-template.png'));
await png(tray('#EEEDE8'), 32, join(icons, 'tray-light.png'));
await browser.close();

const r = spawnSync('npx', ['tauri', 'icon', join(src, 'app.png'), '-o', icons], {
  cwd: desktop,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (r.status !== 0) process.exit(r.status ?? 1);
// tauri icon also writes mobile and Store sizes; the bundle uses only those in tauri.conf.json
for (const extra of readdirSync(icons))
  if (/^(android|ios|Square\d+x\d+Logo\.png|StoreLogo\.png|64x64\.png)$/.test(extra))
    rmSync(join(icons, extra), { recursive: true, force: true });
