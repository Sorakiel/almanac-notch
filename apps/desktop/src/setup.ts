// The Windows installer window (stage 8g, apps/setup): "Install", the folder with
// "Change", progress, "Open". Tauri's NSIS installer does the work silently underneath.
// Outside Tauri (plain Vite) it plays through for screenshots: setup.html?lang=en&over=0.1.0
import '@fontsource/onest/400.css';
import '@fontsource/onest/500.css';
import '@fontsource/onest/600.css';
import '@fontsource/jetbrains-mono/400.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { setLang, t, translatePage } from './settings-i18n';
import { welcomeMascot } from './welcome-mascot';

const inTauri = '__TAURI_INTERNALS__' in window;
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const pane = $('setup');
const query = new URLSearchParams(location.search);

interface Info {
  /** this installer's version */
  version: string;
  /** the folder to install to: the current installation's, or the default */
  dir: string;
  /** the version already installed, if any; its folder stays (no "Change") */
  installed: string | null;
  /** whether the desktop shortcut is there now */
  desktop: boolean;
}

const mascot = welcomeMascot($<HTMLCanvasElement>('stage'));
mascot.setRunning(true);
setTimeout(() => mascot.react('greeting'), 350);
const glow = (c: string): void => pane.style.setProperty('--glow', c);
glow('#6f86ff');

let info: Info = { version: '0.1.1', dir: '', installed: null, desktop: false };
let dir = '';
function setDir(d: string): void {
  dir = d;
  // line breaks only after a backslash, so a folder name never splits in two
  const parts = d.split('\\');
  $('dir').replaceChildren(
    ...parts.flatMap((part, i) => (i < parts.length - 1 ? [part + '\\', document.createElement('wbr')] : [part])),
  );
  $('pick').title = d;
}

/** -1, 0, 1 for "1.2.3" style versions (pre-release tails ignored) */
function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).slice(0, 3).map(Number),
    pb = b.split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

function renderAsk(): void {
  const was = info.installed;
  $('pick').hidden = !!was;
  $<HTMLInputElement>('desktop').checked = info.desktop;
  $('lead-new').hidden = !!was;
  $('lead-over').hidden = !was;
  if (!was) {
    $('go').textContent = t('Установить');
    return;
  }
  const c = compareVersions(info.version, was);
  $('lead-over').textContent =
    c > 0
      ? t('Обновлю версию {0} до {1}. Настройки и подключения сохранятся.', was, info.version)
      : c === 0
        ? t('Версия {0} уже установлена - поставлю её заново. Настройки и подключения сохранятся.', was)
        : t('Установлена более новая версия {0}. Можно поставить {1} поверх, настройки сохранятся.', was, info.version);
  $('go').textContent = c > 0 ? t('Обновить') : t('Переустановить');
}

function show(id: 'ask' | 'busy' | 'done'): void {
  for (const s of ['ask', 'busy', 'done']) $(s).hidden = s !== id;
  $('close').hidden = id === 'busy';
}

// progress: NSIS reports nothing, Rust measures the files as they land; the bar eases toward it
let target = 0,
  shown = 0,
  raf = 0;
function tick(): void {
  shown += (target - shown) * 0.12;
  if (Math.abs(target - shown) < 0.002) shown = target;
  const fill = $('bar').firstElementChild as HTMLElement;
  fill.style.width = (shown * 100).toFixed(1) + '%';
  $('pct').textContent = Math.round(shown * 100) + '%';
  if (shown !== target) raf = requestAnimationFrame(tick);
  else raf = 0;
}
function progress(p: number): void {
  target = Math.max(target, Math.min(1, p));
  if (!raf) raf = requestAnimationFrame(tick);
}

async function install(): Promise<void> {
  $('error').textContent = '';
  show('busy');
  glow('#a78bfa');
  mascot.react('working');
  target = shown = 0;
  progress(0.02);
  try {
    if (inTauri)
      await invoke('setup_install', { dir, desktop: $<HTMLInputElement>('desktop').checked, en: ui === 'en' });
    else
      for (let i = 1; i <= 20; i++) {
        await new Promise((r) => setTimeout(r, 90));
        progress(i / 20);
      }
  } catch (e) {
    show('ask');
    glow('#ff5a4f');
    mascot.react('error');
    $('error').textContent = String(e);
    return;
  }
  progress(1);
  await new Promise((r) => setTimeout(r, 450));
  show('done');
  glow('#34c759');
  mascot.react('success');
}

$('go').addEventListener('click', () => void install());
$('pick').addEventListener('click', async () => {
  if (!inTauri) return;
  const d = await invoke<string | null>('setup_pick', { dir });
  if (d) {
    setDir(d);
    $('error').textContent = '';
  }
});
$('open').addEventListener('click', () => {
  if (inTauri) void invoke('setup_open', { dir });
});
$('close').addEventListener('click', () => {
  if (inTauri) void invoke('setup_quit');
});
addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !$('ask').hidden) void install();
  else if (e.key === 'Enter' && !$('done').hidden) $('open').click();
  else if (e.key === 'Escape' && $('busy').hidden) $('close').click();
});

const ui = (query.get('lang') ?? navigator.language).startsWith('ru') ? 'ru' : 'en';
async function init(): Promise<void> {
  setLang(ui);
  translatePage(document.body);
  document.title = t('Установка Almanac Notch');
  if (inTauri) {
    await listen<number>('setup://progress', (e) => progress(e.payload));
    info = await invoke<Info>('setup_info');
  } else {
    info = {
      version: '0.1.1',
      dir: 'C:\\Users\\nikita\\AppData\\Local\\Programs\\Almanac Notch',
      installed: query.get('over'),
      desktop: false,
    };
  }
  setDir(info.dir);
  renderAsk();
}
void init();
