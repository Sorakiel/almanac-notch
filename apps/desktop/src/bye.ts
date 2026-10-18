// The uninstall window (stage 8g): "Remove Almanac Notch?" with the live mascot of the guide.
// Mac - opened from General in settings; Windows - from "Apps" and the Start menu (a temp copy of
// the app, src-tauri/src/uninstall.rs). Outside Tauri (plain Vite) it plays through for screenshots.
import '@fontsource/onest/400.css';
import '@fontsource/onest/500.css';
import '@fontsource/onest/600.css';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { setLang, t, translatePage } from './settings-i18n';
import { welcomeMascot } from './welcome-mascot';

const inTauri = '__TAURI_INTERNALS__' in window;
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const pane = $('bye');
const wipe = $<HTMLInputElement>('wipe');

interface Info {
  platform: 'mac' | 'windows';
  lang: 'ru' | 'en';
}
interface Outcome {
  warnings: string[];
}

const mascot = welcomeMascot($<HTMLCanvasElement>('stage'));
mascot.setRunning(true);
setTimeout(() => mascot.react('greeting'), 350);

/** the glow follows what is about to happen: calm, red over "Remove", green when it is done */
function glow(c: string): void {
  pane.style.setProperty('--glow', c);
}
glow(pane.dataset.glow ?? '#6f86ff');
$('go').addEventListener('pointerenter', () => glow('#ff5a4f'));
$('go').addEventListener('pointerleave', () => glow('#6f86ff'));

let windows = false;
function show(id: 'ask' | 'busy' | 'done'): void {
  for (const s of ['ask', 'busy', 'done']) $(s).hidden = s !== id;
  // nothing to cancel while files are going
  $('close').hidden = !windows || id === 'busy';
}

let done = false;
async function run(): Promise<void> {
  show('busy');
  glow('#ff5a4f');
  mascot.react('working');
  const out: Outcome = inTauri
    ? await invoke<Outcome>('bye_run', { wipe: wipe.checked })
    : await new Promise((r) => setTimeout(() => r({ warnings: [] }), 1600));
  done = true;
  $('done-kept').hidden = wipe.checked;
  $('done-wiped').hidden = !wipe.checked;
  $('warnings').textContent = out.warnings.join('\n');
  show('done');
  glow('#34c759');
}

function quit(): void {
  if (inTauri) void invoke('bye_quit', { done });
}
$('go').addEventListener('click', () => void run());
$('cancel').addEventListener('click', quit);
$('close').addEventListener('click', quit);
$('finish').addEventListener('click', quit);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('ask').hidden) quit();
});

async function init(): Promise<void> {
  const info: Info = inTauri
    ? await invoke<Info>('bye_info')
    : {
        platform: location.hash === '#mac' ? 'mac' : 'windows',
        lang: (new URLSearchParams(location.search).get('lang') ?? navigator.language).startsWith('en') ? 'en' : 'ru',
      };
  // texts that differ by platform; Windows has no frame, so the close button is ours
  for (const el of document.querySelectorAll<HTMLElement>('.mac-only')) el.hidden = info.platform !== 'mac';
  for (const el of document.querySelectorAll<HTMLElement>('.win-only')) el.hidden = info.platform !== 'windows';
  windows = info.platform === 'windows';
  setLang(info.lang);
  translatePage(document.body);
  document.title = t('Удалить Almanac Notch');
  // Mac: the window's own close button after removal quits too (the app is in the Trash by then)
  if (inTauri)
    void getCurrentWindow().onCloseRequested((e) => {
      if (!done) return;
      e.preventDefault();
      quit();
    });
}
void init();
