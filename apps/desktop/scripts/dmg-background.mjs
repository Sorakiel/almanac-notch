// `node apps/desktop/scripts/dmg-background.mjs` - the .dmg window background (stage 8g).
// The look of the first-run guide: near-black, a soft glow, a white arrow from the app to
// Applications. The lower part is a lighter "floor": Finder draws the icon labels black in the
// light theme and white in the dark one, and both have to stay readable (Raycast does the same). Rendered with Playwright at 1x and 2x and joined by `tiffutil` into one
// multi-resolution TIFF, so Finder shows it sharp on Retina. Re-run only when the look changes.
// Positions match bundle.macOS.dmg in tauri.conf.json (window 640x400, icons at 170/470, y 214).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(desktop, 'src-tauri', 'dmg');
mkdirSync(outDir, { recursive: true });

const W = 640,
  H = 400,
  APP_X = 170,
  APPS_X = 470,
  ICON_Y = 214;

// fonts inline: a page from setContent may not load file:// URLs
const font = (name) =>
  'data:font/woff2;base64,' +
  readFileSync(join(desktop, '../../node_modules/@fontsource/onest/files', name)).toString('base64');
const html = `<!doctype html><html><head><style>
@font-face { font-family: Onest; font-weight: 600; src: url('${font('onest-cyrillic-600-normal.woff2')}'); unicode-range: U+0400-04FF; }
@font-face { font-family: Onest; font-weight: 600; src: url('${font('onest-latin-600-normal.woff2')}'); unicode-range: U+0000-00FF, U+2190-21FF; }
@font-face { font-family: Onest; font-weight: 400; src: url('${font('onest-cyrillic-400-normal.woff2')}'); unicode-range: U+0400-04FF; }
@font-face { font-family: Onest; font-weight: 400; src: url('${font('onest-latin-400-normal.woff2')}'); unicode-range: U+0000-00FF; }
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #070708; font-family: Onest, sans-serif; -webkit-font-smoothing: antialiased; }
.glow { position: absolute; inset: 0;
  background:
    radial-gradient(34% 40% at ${(APP_X / W) * 100}% ${(ICON_Y / H) * 100}%, rgba(111,134,255,0.22), transparent 70%),
    radial-gradient(30% 36% at ${(APPS_X / W) * 100}% ${(ICON_Y / H) * 100}%, rgba(111,134,255,0.10), transparent 70%),
    radial-gradient(70% 40% at 50% 118%, rgba(111,134,255,0.20), transparent 70%); }
h1 { position: absolute; top: 46px; width: 100%; margin: 0; text-align: center; color: #f2f2f4; font-size: 21px; font-weight: 600; letter-spacing: -0.01em; }
p { position: absolute; top: 80px; width: 100%; margin: 0; text-align: center; color: rgba(255,255,255,0.5); font-size: 13px; }
svg { position: absolute; inset: 0; }
.floor { position: absolute; inset: 0;
  background: linear-gradient(to bottom, transparent 0, transparent 140px, rgba(146,152,176,0.5) 262px, rgba(150,156,180,0.7) 330px, rgba(150,156,180,0.74) 400px); }
</style></head><body>
<div class="floor"></div>
<div class="glow"></div>
<h1>Перетащите в «Программы»</h1>
<p>Drag to Applications</p>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <path d="M ${APP_X + 92} ${ICON_Y} H ${APPS_X - 96}"
    fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0.1 9" />
  <path d="M ${APPS_X - 103} ${ICON_Y - 8} L ${APPS_X - 94} ${ICON_Y} L ${APPS_X - 103} ${ICON_Y + 8}"
    fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
</svg>
</body></html>`;

const browser = await chromium.launch();
for (const scale of [1, 2]) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(outDir, scale === 1 ? 'bg.png' : 'bg@2x.png') });
  await page.close();
}
await browser.close();

const tiff = join(outDir, 'background.tiff');
const r = spawnSync('tiffutil', ['-cathidpicheck', join(outDir, 'bg.png'), join(outDir, 'bg@2x.png'), '-out', tiff], {
  stdio: 'inherit',
});
if (r.status !== 0) process.exit(r.status ?? 1);
rmSync(join(outDir, 'bg.png'));
rmSync(join(outDir, 'bg@2x.png'));
console.log('[dmg] ' + tiff);
