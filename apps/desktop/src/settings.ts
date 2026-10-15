// Settings window (stage 6): the GitHub token and its status. A regular window with the
// keyboard; the token goes straight to Rust (`github_connect`) and the system keychain, never
// through the island page. Outside Tauri (plain Vite) the page just renders its "off" state.
import '@fontsource/onest/400.css';
import '@fontsource/onest/500.css';
import '@fontsource/onest/600.css';
import '@fontsource/jetbrains-mono/400.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { GhState } from './feeds';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const input = $<HTMLInputElement>('token'),
  go = $<HTMLButtonElement>('go'),
  off = $<HTMLButtonElement>('off'),
  err = $('error'),
  dot = $('dot'),
  text = $('status-text'),
  connect = $('connect'),
  connected = $('connected');

const inTauri = '__TAURI_INTERNALS__' in window;

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10,
    m100 = n % 100;
  return n + ' ' + (m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many);
}

function render(g: GhState | null): void {
  const on = !!g && g.auth !== 'off' && g.auth !== 'bad' && !!g.login;
  connect.hidden = on;
  connected.hidden = !on;
  dot.className = 'dot' + (on ? ' ok' : g && g.auth === 'bad' ? ' bad' : '');
  if (on && g) {
    text.textContent =
      '@' +
      g.login +
      ' · ' +
      plural(g.repo_count, 'репозиторий', 'репозитория', 'репозиториев') +
      ' · CI в ' +
      g.repos.length +
      (g.auth === 'net' ? ' · нет связи' : '');
  } else if (g && g.auth === 'bad') text.textContent = 'GitHub не принял сохранённый токен';
  else text.textContent = 'Не подключён';
}

async function doConnect(): Promise<void> {
  const token = input.value.trim();
  if (!token) return;
  go.disabled = true;
  err.textContent = '';
  try {
    await invoke<string>('github_connect', { token });
    input.value = '';
  } catch (e) {
    err.textContent = String(e);
  } finally {
    go.disabled = false;
  }
}

go.addEventListener('click', () => void doConnect());
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void doConnect();
});
off.addEventListener('click', () => void invoke('github_disconnect'));

render(null);
if (inTauri) {
  await listen<GhState>('island://github', (e) => render(e.payload));
  const f = await invoke<{ github: GhState | null }>('feeds_state');
  render(f.github);
  input.focus();
}
