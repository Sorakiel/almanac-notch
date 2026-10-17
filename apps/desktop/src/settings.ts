// Settings window (stage 6): the GitHub token and its status; stage 7: the calendar source. A regular window with the
// keyboard; the token goes straight to Rust (`github_connect`) and the system keychain, never
// through the island page. Outside Tauri (plain Vite) the page just renders its "off" state.
import '@fontsource/onest/400.css';
import '@fontsource/onest/500.css';
import '@fontsource/onest/600.css';
import '@fontsource/jetbrains-mono/400.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Calendar, GhState } from './feeds';

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
      g.repos.filter((r) => r.state !== 'none').length +
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

// ---------- sections ----------
const sections = [...document.querySelectorAll<HTMLElement>('main')];
for (const b of document.querySelectorAll<HTMLButtonElement>('nav .item'))
  b.addEventListener('click', () => {
    for (const x of document.querySelectorAll('nav .item')) x.classList.toggle('on', x === b);
    for (const m of sections) m.hidden = m.id !== b.dataset.section;
  });

// ---------- calendar ----------
interface CalConfig {
  platform: 'macos' | 'windows' | 'other';
  source: string;
  ical: boolean;
  outlook: boolean;
}
const calDot = $('cal-dot'),
  calStatus = $('cal-status'),
  calPick = $('cal-pick'),
  calMac = $('cal-mac'),
  calIcal = $('cal-ical'),
  calUrl = $<HTMLInputElement>('cal-url'),
  calGo = $<HTMLButtonElement>('cal-go'),
  calErr = $('cal-error'),
  radios = [...document.querySelectorAll<HTMLInputElement>('input[name=cal]')];
let calCfg: CalConfig | null = null;

const SOURCE_NAME: Record<string, string> = { outlook: 'Outlook', ical: 'ссылка iCal', system: 'системный Календарь' };

function renderCal(c: Calendar | null): void {
  const ok = !!c && c.access === 'ok';
  calDot.className = 'dot' + (ok ? ' ok' : c && c.access === 'denied' ? ' bad' : '');
  if (!c || (c.access === 'off' && c.source === 'none')) calStatus.textContent = 'Не подключён';
  else if (ok)
    calStatus.textContent =
      (SOURCE_NAME[c.source ?? ''] ?? 'календарь') +
      ' · ' +
      plural(c.events.length, 'встреча', 'встречи', 'встреч') +
      ' за 48 ч';
  else if (c.access === 'unknown')
    calStatus.textContent = c.source === 'system' ? 'Доступ ещё не выдан' : 'Календарь пока не ответил';
  else if (c.source === 'outlook') calStatus.textContent = 'Outlook не найден';
  else if (c.source === 'ical') calStatus.textContent = 'Ссылка не открывается';
  else if (c.access === 'denied') calStatus.textContent = 'Нет доступа к календарю';
  else calStatus.textContent = 'Недоступен на этой системе';
}

function renderPick(): void {
  if (!calCfg) return;
  const mac = calCfg.platform === 'macos';
  calMac.hidden = !mac;
  calPick.hidden = mac;
  const outlook = radios.find((r) => r.value === 'outlook');
  if (outlook) outlook.disabled = !calCfg.outlook;
  $('cal-outlook-note').textContent = calCfg.outlook
    ? 'классический Outlook на этом компьютере'
    : 'классический Outlook не установлен (новый Outlook - через ссылку iCal)';
  const picked = radios.find((r) => r.checked)?.value ?? calCfg.source;
  for (const r of radios) r.checked = r.value === picked;
  calIcal.hidden = picked !== 'ical';
  calGo.textContent = calCfg.ical && picked === 'ical' ? 'Заменить' : 'Подключить';
}

async function choose(source: string, url?: string): Promise<void> {
  calErr.textContent = '';
  calErr.classList.remove('ok-note');
  calGo.disabled = true;
  try {
    const n = await invoke<number | null>('calendar_choose', { source, url: url ?? null });
    calUrl.value = '';
    if (n !== null) {
      calErr.classList.add('ok-note');
      calErr.textContent = 'Подключено: ' + plural(n, 'встреча', 'встречи', 'встреч') + ' за 48 ч';
    }
  } catch (e) {
    calErr.textContent = String(e);
  } finally {
    calGo.disabled = false;
    calCfg = await invoke<CalConfig>('calendar_config');
    renderPick();
  }
}

for (const r of radios)
  r.addEventListener('change', () => {
    renderPick();
    calErr.textContent = '';
    // an iCal choice waits for a link unless one is stored
    if (r.value !== 'ical' || calCfg?.ical) void choose(r.value);
    else calUrl.focus();
  });
calGo.addEventListener('click', () => {
  if (calUrl.value.trim()) void choose('ical', calUrl.value.trim());
});
calUrl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && calUrl.value.trim()) void choose('ical', calUrl.value.trim());
});
$('cal-access').addEventListener('click', () => void invoke('calendar_access'));

render(null);
renderCal(null);
if (inTauri) {
  await listen<Calendar>('island://calendar', (e) => renderCal(e.payload));
  await listen<GhState>('island://github', (e) => render(e.payload));
  const f = await invoke<{ github: GhState | null; calendar: Calendar | null }>('feeds_state');
  render(f.github);
  renderCal(f.calendar);
  calCfg = await invoke<CalConfig>('calendar_config');
  renderPick();
  // the island's rows open the window on their section
  const show = (sec: string): void => document.querySelector<HTMLButtonElement>(`[data-section="${sec}"]`)?.click();
  if (location.hash) show(location.hash.slice(1));
  await listen<string>('settings://section', (e) => show(e.payload));
  input.focus();
}
