// Settings window (stage 6): the GitHub token and its status; stage 7: the calendar source. A regular window with the
// keyboard; the token goes straight to Rust (`github_connect`) and the system keychain, never
// through the island page. Outside Tauri (plain Vite) the page just renders its "off" state.
import '@fontsource/onest/400.css';
import '@fontsource/onest/500.css';
import '@fontsource/onest/600.css';
import '@fontsource/jetbrains-mono/400.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Calendar, GhState, NoState, VcState } from './feeds';
import { count, setLang, t, translatePage } from './settings-i18n';

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

// the last data of each section: a language switch draws them again
let lastG: GhState | null = null,
  lastCal: Calendar | null = null,
  lastV: VcState | null = null,
  lastN: NoState | null = null;

function render(g: GhState | null): void {
  lastG = g;
  const on = !!g && g.auth !== 'off' && g.auth !== 'bad' && !!g.login;
  connect.hidden = on;
  connected.hidden = !on;
  dot.className = 'dot' + (on ? ' ok' : g && g.auth === 'bad' ? ' bad' : '');
  if (on && g) {
    text.textContent =
      t(
        '{0} · CI в {1}',
        '@' +
          g.login +
          ' · ' +
          count(g.repo_count, ['репозиторий', 'репозитория', 'репозиториев'], ['repository', 'repositories']),
        g.repos.filter((r) => r.state !== 'none').length,
      ) + (g.auth === 'net' ? t(' · нет связи') : '');
  } else if (g && g.auth === 'bad') text.textContent = t('GitHub не принял сохранённый токен');
  else text.textContent = t('Не подключён');
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

// ---------- Vercel (stage 8) ----------
const vcInput = $<HTMLInputElement>('vc-token'),
  vcGo = $<HTMLButtonElement>('vc-go'),
  vcErr = $('vc-error');
function renderVercel(v: VcState | null): void {
  lastV = v;
  const on = !!v && v.auth !== 'off' && v.auth !== 'bad' && !!v.user;
  $('vc-connect').hidden = on;
  $('vc-connected').hidden = !on;
  $('vc-dot').className = 'dot' + (on ? ' ok' : v && v.auth === 'bad' ? ' bad' : '');
  $('vc-status').textContent =
    on && v
      ? '@' +
        (v.user ?? '') +
        ' · ' +
        count(v.deploys.length, ['проект', 'проекта', 'проектов'], ['project', 'projects']) +
        (v.auth === 'net' ? t(' · нет связи') : '')
      : v && v.auth === 'bad'
        ? t('Vercel не принял сохранённый токен')
        : t('Не подключён');
}
async function vcConnect(): Promise<void> {
  const token = vcInput.value.trim();
  if (!token) return;
  vcGo.disabled = true;
  vcErr.textContent = '';
  try {
    await invoke<string>('vercel_connect', { token });
    vcInput.value = '';
  } catch (e) {
    vcErr.textContent = String(e);
  } finally {
    vcGo.disabled = false;
  }
}
vcGo.addEventListener('click', () => void vcConnect());
vcInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void vcConnect();
});
$('vc-off').addEventListener('click', () => void invoke('vercel_disconnect'));

// ---------- Notion (stage 8) ----------
const noInput = $<HTMLInputElement>('no-token'),
  noGo = $<HTMLButtonElement>('no-go'),
  noErr = $('no-error');
function renderNotion(n: NoState | null): void {
  lastN = n;
  const on = !!n && n.auth !== 'off' && n.auth !== 'bad' && !!n.workspace;
  $('no-connect').hidden = on;
  $('no-connected').hidden = !on;
  $('no-dot').className = 'dot' + (on ? ' ok' : n && n.auth === 'bad' ? ' bad' : '');
  $('no-status').textContent =
    on && n
      ? (n.workspace ?? '') +
        (n.pages.length ? '' : t(' · нет доступа к страницам')) +
        (n.auth === 'net' ? t(' · нет связи') : '')
      : n && n.auth === 'bad'
        ? t('Notion не принял сохранённый токен')
        : t('Не подключён');
  renderNotionMe(n);
}
const noMe = $<HTMLSelectElement>('no-me');
/** "Это вы": only when the workspace has more than one person; nobody to pick = a hint */
function renderNotionMe(n: NoState | null): void {
  const people = n && n.workspace ? n.people : [];
  $('no-me-row').hidden = people.length < 2;
  $('no-me-none').hidden = !n || !n.workspace || people.length > 0;
  if (people.length < 2) return;
  noMe.replaceChildren(
    new Option(t('Не выбрано'), '', false, !n?.me),
    ...people.map((p) => new Option(p.name, p.id, false, p.id === n?.me)),
  );
}
noMe.addEventListener('change', () => void invoke('notion_me', { id: noMe.value || null }));
async function noConnect(): Promise<void> {
  const token = noInput.value.trim();
  if (!token) return;
  noGo.disabled = true;
  noErr.textContent = '';
  try {
    await invoke<string>('notion_connect', { token });
    noInput.value = '';
  } catch (e) {
    noErr.textContent = String(e);
  } finally {
    noGo.disabled = false;
  }
}
noGo.addEventListener('click', () => void noConnect());
noInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void noConnect();
});
$('no-off').addEventListener('click', () => void invoke('notion_disconnect'));

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
  vercel: ['vc-status', 'vc-dot'],
  notion: ['no-status', 'no-dot'],
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
  vercel: 'vercel',
  notion: 'notion',
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
    say(t('Хотя бы один модуль должен остаться включённым'));
    renderModules(modCfg);
    return;
  }
  // like coucou: Claude Code is the main module, at most 4 others (modules.rs MAX_ON)
  if (Object.values(MOD_OF).filter((id) => id !== 'claude' && !next.off.includes(id)).length > 4) {
    say(t('Кроме Claude Code можно включить не больше 4 модулей - сначала выключите один'));
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
let lastMusic: MediaNow | null = null;
function renderMusic(m: MediaNow | null): void {
  lastMusic = m;
  const on = !!m && !m.off && !m.none && !!m.title;
  $('music-dot').className = 'dot' + (on && m.playing ? ' ok' : m && m.off ? ' bad' : '');
  $('music-status').textContent = !m
    ? t('Ничего не играет')
    : m.off
      ? t('Музыка недоступна на этой системе')
      : on
        ? (m.playing ? '' : t('Пауза · ')) + [m.title, m.artist, m.app].filter(Boolean).join(' · ')
        : t('Ничего не играет');
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
  lastCal = c;
  const ok = !!c && c.access === 'ok';
  calDot.className = 'dot' + (ok ? ' ok' : c && c.access === 'denied' ? ' bad' : '');
  if (!c || (c.access === 'off' && c.source === 'none')) calStatus.textContent = t('Не подключён');
  else if (ok)
    calStatus.textContent = t(
      '{0} · {1} за 48 ч',
      t(SOURCE_NAME[c.source ?? ''] ?? 'календарь'),
      count(c.events.length, ['встреча', 'встречи', 'встреч'], ['meeting', 'meetings']),
    );
  else if (c.access === 'unknown')
    calStatus.textContent = t(c.source === 'system' ? 'Доступ ещё не выдан' : 'Календарь пока не ответил');
  else if (c.source === 'outlook') calStatus.textContent = t('Outlook не найден');
  else if (c.source === 'ical') calStatus.textContent = t('Ссылка не открывается');
  else if (c.access === 'denied') calStatus.textContent = t('Нет доступа к календарю');
  else calStatus.textContent = t('Недоступен на этой системе');
}

function renderPick(): void {
  if (!calCfg) return;
  const mac = calCfg.platform === 'macos';
  calMac.hidden = !mac;
  calPick.hidden = mac;
  const outlook = radios.find((r) => r.value === 'outlook');
  if (outlook) outlook.disabled = !calCfg.outlook;
  const picked = radios.find((r) => r.checked)?.value ?? calCfg.source;
  $('cal-src-note').textContent = t(
    picked === 'outlook'
      ? 'Календарь по умолчанию из классического Outlook на этом компьютере, без сети.'
      : picked === 'ical'
        ? 'Google, Outlook.com, iCloud, Яндекс и другие: секретная ссылка на календарь в формате iCal.'
        : calCfg.outlook
          ? 'Карточка календаря пустая.'
          : 'Карточка календаря пустая. Классический Outlook не найден: новый Outlook подключается ссылкой iCal.',
  );
  for (const r of radios) r.checked = r.value === picked;
  calIcal.hidden = picked !== 'ical';
  calGo.textContent = t(calCfg.ical && picked === 'ical' ? 'Заменить' : 'Подключить');
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
      calErr.textContent = t(
        'Подключено: {0} за 48 ч',
        count(n, ['встреча', 'встречи', 'встреч'], ['meeting', 'meetings']),
      );
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
let lastIsland: IslandStatus = { state: 'auto', hooks: false };
function renderIsland(st: IslandStatus): void {
  lastIsland = st;
  $('hooks-dot').className = 'dot' + (st.hooks ? ' ok' : '');
  $('hooks-status').textContent = t(st.hooks ? 'Хуки установлены' : 'Хуки не установлены');
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
renderVercel(null);
renderNotion(null);
renderCal(null);
renderIsland({ state: 'auto', hooks: false });
renderMusic(null);
renderModules(modCfg);
// ---------- language (stage 8) ----------
interface LangCfg {
  pick: string;
  lang: string;
}
const langs = [...document.querySelectorAll<HTMLInputElement>('input[name=lang]')];
function renderLang(c: LangCfg): void {
  setLang(c.lang === 'en' ? 'en' : 'ru');
  for (const r of langs) r.checked = r.value === c.pick;
  translatePage(document.body);
  $('music-src').textContent = t(
    navigator.userAgent.includes('Windows')
      ? 'Windows: системный медиа-сеанс - любой плеер, который показывает себя в регуляторе громкости (Spotify, браузеры, Я.Музыка).'
      : 'Mac: любой плеер из «Исполняется» в Пункте управления, включая браузеры.',
  );
  render(lastG);
  renderVercel(lastV);
  renderNotion(lastN);
  renderCal(lastCal);
  renderMusic(lastMusic);
  renderIsland(lastIsland);
  renderPick();
}
for (const r of langs)
  r.addEventListener('change', () => {
    if (inTauri) void invoke<LangCfg>('lang_set', { pick: r.value }).then(renderLang);
  });
renderLang({ pick: 'auto', lang: 'ru' });
if (inTauri) {
  await listen<Calendar>('island://calendar', (e) => renderCal(e.payload));
  await listen<GhState>('island://github', (e) => render(e.payload));
  await listen<VcState>('island://vercel', (e) => renderVercel(e.payload));
  await listen<NoState>('island://notion', (e) => renderNotion(e.payload));
  const f = await invoke<{
    github: GhState | null;
    vercel: VcState | null;
    notion: NoState | null;
    calendar: Calendar | null;
    media: MediaNow | null;
  }>('feeds_state');
  render(f.github);
  renderVercel(f.vercel);
  renderNotion(f.notion);
  renderMusic(f.media);
  await listen<MediaNow>('island://media', (e) => renderMusic(e.payload));
  renderCal(f.calendar);
  calCfg = await invoke<CalConfig>('calendar_config');
  renderPick();
  await refreshIsland();
  renderModules(await invoke<Modules>('modules_get'));
  renderLang(await invoke<LangCfg>('lang_get'));
  await listen<LangCfg>('island://lang', (e) => renderLang(e.payload));
  await listen<Modules>('island://modules', (e) => renderModules(e.payload));
  await listen<string>('island://state', (e) => {
    for (const r of states) r.checked = r.value === e.payload;
  });
  // the island's rows open the window on their section
  if (location.hash) showSection(location.hash.slice(1));
  await listen<string>('settings://section', (e) => showSection(e.payload));
  input.focus();
}
