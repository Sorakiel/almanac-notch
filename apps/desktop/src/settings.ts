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

// ---------- tabs and the module list (Raycast-like) ----------
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab')],
  mods = [...document.querySelectorAll<HTMLButtonElement>('.mod')];
function showTab(name: string): void {
  for (const t of tabs) t.classList.toggle('on', t.dataset.tab === name);
  for (const p of document.querySelectorAll<HTMLElement>('.pane')) p.hidden = p.id !== 'tab-' + name;
}
function showModule(name: string): void {
  showTab('modules');
  for (const m of mods) m.classList.toggle('on', m.dataset.module === name);
  for (const m of document.querySelectorAll<HTMLElement>('.detail > main')) m.hidden = m.id !== name;
}
for (const t of tabs) t.addEventListener('click', () => showTab(t.dataset.tab ?? 'general'));
for (const m of mods) m.addEventListener('click', () => showModule(m.dataset.module ?? 'claude'));
/** "island" and "general" open the general tab, module names open their page */
function showSection(sec: string): void {
  if (mods.some((m) => m.dataset.module === sec)) showModule(sec);
  else showTab('general');
}

// each module's status line and dot, repeated in the list
const STATUS: Record<string, [string, string]> = {
  almanac: ['almanac-status', 'almanac-dot'],
  claude: ['hooks-status', 'hooks-dot'],
  calendar: ['cal-status', 'cal-dot'],
  music: ['music-status', 'music-dot'],
  github: ['status-text', 'dot'],
};
for (const [k, [textId, dotId]] of Object.entries(STATUS)) {
  const copy = (): void => {
    $('li-' + k).textContent = $(textId).textContent;
    $('li-' + k + '-dot').className = $(dotId).className;
  };
  const o = new MutationObserver(copy);
  o.observe($(textId), { childList: true, characterData: true, subtree: true });
  o.observe($(dotId), { attributes: true });
  copy();
}

// ---------- switching modules and the chat on and off ----------
interface Modules {
  off: string[];
  chat: boolean;
}
const toggles = [...document.querySelectorAll<HTMLInputElement>('input[data-mod]')],
  chatOn = $<HTMLInputElement>('chat-on'),
  toast = $('toast');
/** settings page name -> the island's module id */
const MOD_OF: Record<string, string> = {
  claude: 'claude',
  calendar: 'cal',
  music: 'music',
  github: 'github',
  almanac: 'almanac',
};
let modCfg: Modules = { off: [], chat: true };
let toastTimer = 0;
function say(text: string): void {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 3500);
}
function renderModules(c: Modules): void {
  modCfg = c;
  for (const t of toggles) t.checked = !c.off.includes(t.dataset.mod ?? '');
  chatOn.checked = c.chat;
  for (const m of mods) m.classList.toggle('off', c.off.includes(MOD_OF[m.dataset.module ?? ''] ?? ''));
}
async function saveModules(next: Modules): Promise<void> {
  if (Object.values(MOD_OF).every((id) => next.off.includes(id))) {
    say('Хотя бы один модуль должен остаться включённым');
    renderModules(modCfg);
    return;
  }
  try {
    renderModules(await invoke<Modules>('modules_set', { off: next.off, chat: next.chat }));
  } catch (e) {
    say(String(e));
    renderModules(modCfg);
  }
}
for (const t of toggles)
  t.addEventListener('change', () => {
    const id = t.dataset.mod ?? '',
      off = modCfg.off.filter((x) => x !== id);
    void saveModules({ ...modCfg, off: t.checked ? off : [...off, id] });
  });
chatOn.addEventListener('change', () => void saveModules({ ...modCfg, chat: chatOn.checked }));

// ---------- music ----------
interface MediaNow {
  none?: boolean;
  off?: boolean;
  title?: string;
  artist?: string;
  app?: string;
  playing?: boolean;
}
function renderMusic(m: MediaNow | null): void {
  const on = !!m && !m.off && !m.none && !!m.title;
  $('music-dot').className = 'dot' + (on && m.playing ? ' ok' : m && m.off ? ' bad' : '');
  $('music-status').textContent = !m
    ? 'Ничего не играет'
    : m.off
      ? 'Музыка недоступна на этой системе'
      : on
        ? (m.playing ? '' : 'Пауза · ') + [m.title, m.artist, m.app].filter(Boolean).join(' · ')
        : 'Ничего не играет';
}

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
  const picked = radios.find((r) => r.checked)?.value ?? calCfg.source;
  $('cal-src-note').textContent =
    picked === 'outlook'
      ? 'Календарь по умолчанию из классического Outlook на этом компьютере, без сети.'
      : picked === 'ical'
        ? 'Google, Outlook.com, iCloud, Яндекс и другие: секретная ссылка на календарь в формате iCal.'
        : calCfg.outlook
          ? 'Карточка календаря пустая.'
          : 'Карточка календаря пустая. Классический Outlook не найден: новый Outlook подключается ссылкой iCal.';
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

// ---------- Claude Code, island ----------
interface IslandStatus {
  state: string;
  hooks: boolean;
}
const states = [...document.querySelectorAll<HTMLInputElement>('input[name=nstate]')];
function renderIsland(st: IslandStatus): void {
  $('hooks-dot').className = 'dot' + (st.hooks ? ' ok' : '');
  $('hooks-status').textContent = st.hooks ? 'Хуки установлены' : 'Хуки не установлены';
  for (const r of states) r.checked = r.value === st.state;
}
async function refreshIsland(): Promise<void> {
  if (inTauri) renderIsland(await invoke<IslandStatus>('island_status'));
}
const act = (id: string): void => void invoke('island_action', { id });
for (const r of states) r.addEventListener('change', () => act('nstate:' + r.value));
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-ev]'))
  b.addEventListener('click', () => act('ev:' + b.dataset.ev));
$('hooks-install').addEventListener('click', () => act('hooks:install'));
$('hooks-uninstall').addEventListener('click', () => act('hooks:uninstall'));
$('quit').addEventListener('click', () => act('quit'));
// the hook dialogs finish outside this window; read the status again when it is back in front
window.addEventListener('focus', () => void refreshIsland());

render(null);
renderCal(null);
renderIsland({ state: 'auto', hooks: false });
renderMusic(null);
renderModules(modCfg);
$('music-src').textContent = navigator.userAgent.includes('Windows')
  ? 'Windows: системный медиа-сеанс - любой плеер, который показывает себя в регуляторе громкости (Spotify, браузеры, Я.Музыка).'
  : 'Mac: любой плеер из «Исполняется» в Пункте управления, включая браузеры.';
if (inTauri) {
  await listen<Calendar>('island://calendar', (e) => renderCal(e.payload));
  await listen<GhState>('island://github', (e) => render(e.payload));
  const f = await invoke<{ github: GhState | null; calendar: Calendar | null; media: MediaNow | null }>('feeds_state');
  render(f.github);
  renderMusic(f.media);
  await listen<MediaNow>('island://media', (e) => renderMusic(e.payload));
  renderCal(f.calendar);
  calCfg = await invoke<CalConfig>('calendar_config');
  renderPick();
  await refreshIsland();
  renderModules(await invoke<Modules>('modules_get'));
  await listen<Modules>('island://modules', (e) => renderModules(e.payload));
  await listen<string>('island://state', (e) => {
    for (const r of states) r.checked = r.value === e.payload;
  });
  // the island's rows open the window on their section
  if (location.hash) showSection(location.hash.slice(1));
  await listen<string>('settings://section', (e) => showSection(e.payload));
  input.focus();
}
