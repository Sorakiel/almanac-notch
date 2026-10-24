// Settings window (stage 6): the GitHub token and its status; stage 7: the calendar source. A regular window with the
// keyboard; the token goes straight to Rust (`github_connect`) and the system keychain, never
// through the island page. Outside Tauri (plain Vite) the page just renders its "off" state.
import '@fontsource/onest/400.css';
import '@fontsource/onest/500.css';
import '@fontsource/onest/600.css';
import '@fontsource/jetbrains-mono/400.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { AlState, Calendar, GfState, GhState, NoState, VcState } from './feeds';
import { count, setLang, t, translatePage } from './settings-i18n';
import { welcomeMascot, type WelcomeMascot } from './welcome-mascot';

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
const isWin = navigator.userAgent.includes('Windows');
if (import.meta.env.DEV) document.body.classList.add('dev');
/** the first-run guide's live mascot, made when the guide first opens */
let mascot: WelcomeMascot | null = null;

// the last data of each section: a language switch draws them again
let lastG: GhState | null = null,
  lastCal: Calendar | null = null,
  lastV: VcState | null = null,
  lastN: NoState | null = null,
  lastGf: GfState | null = null,
  lastAl: AlState | null = null,
  alBuilt = true;

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

// ---------- Grafana (stage 8) ----------
interface GfConfig {
  url: string | null;
  board: string | null;
  panel: number | null;
}
const gfUrl = $<HTMLInputElement>('gf-url'),
  gfInput = $<HTMLInputElement>('gf-token'),
  gfGo = $<HTMLButtonElement>('gf-go'),
  gfErr = $('gf-error'),
  gfBoard = $<HTMLSelectElement>('gf-board'),
  gfPanel = $<HTMLSelectElement>('gf-panel');
let gfCfg: GfConfig = { url: null, board: null, panel: null },
  /** the dashboard list, read once per connection */
  gfBoards: { uid: string; title: string; folder: string | null }[] | null = null,
  gfPanels: { id: number; title: string }[] = [];
function renderGrafana(g: GfState | null): void {
  lastGf = g;
  const on = !!g && g.auth !== 'off' && g.auth !== 'bad' && !!g.org;
  $('gf-connect').hidden = on;
  $('gf-connected').hidden = !on;
  $('gf-dot').className = 'dot' + (on ? ' ok' : g && g.auth === 'bad' ? ' bad' : '');
  const firing = g ? g.alerts.filter((a) => a.state === 'firing').length : 0;
  $('gf-status').textContent =
    on && g
      ? (g.org ?? '') +
        ' · ' +
        count(g.rules, ['правило', 'правила', 'правил'], ['rule', 'rules']) +
        (firing ? t(' · горит {0}', firing) : '') +
        (g.auth === 'net' ? t(' · нет связи') : '')
      : g && g.auth === 'bad'
        ? t('Grafana не приняла сохранённый токен')
        : t('Не подключена');
  $('gf-addr').textContent = gfCfg.url ? t('Адрес: {0}', gfCfg.url) : '';
  if (!on) gfBoards = null;
  else if (!gfBoards && inTauri) void loadBoards();
  renderGfPick();
}
function renderGfPick(): void {
  const boards = gfBoards ?? [];
  gfBoard.replaceChildren(
    new Option(t('Не выбран'), '', false, !gfCfg.board),
    ...boards.map(
      (b) => new Option(b.folder ? b.folder + ' / ' + b.title : b.title, b.uid, false, b.uid === gfCfg.board),
    ),
  );
  gfPanel.disabled = !gfCfg.board;
  gfPanel.replaceChildren(
    new Option(t('Без графика'), '', false, gfCfg.panel === null),
    ...gfPanels.map((p) => new Option(p.title || '#' + p.id, String(p.id), false, p.id === gfCfg.panel)),
  );
}
async function loadBoards(): Promise<void> {
  try {
    gfBoards = await invoke('grafana_dashboards');
    gfPanels = gfCfg.board ? await invoke('grafana_panels', { uid: gfCfg.board }) : [];
    $('gf-pick-error').textContent = '';
  } catch (e) {
    gfBoards = [];
    $('gf-pick-error').textContent = String(e);
  }
  renderGfPick();
}
async function gfPick(board: string | null, panel: number | null): Promise<void> {
  try {
    if (board !== gfCfg.board) gfPanels = board ? await invoke('grafana_panels', { uid: board }) : [];
    // one panel only: pick it right away
    if (board !== gfCfg.board) panel = gfPanels.length === 1 ? (gfPanels[0] as { id: number }).id : null;
    await invoke('grafana_pick', { board, panel });
    gfCfg = { ...gfCfg, board, panel };
    $('gf-pick-error').textContent = '';
  } catch (e) {
    $('gf-pick-error').textContent = String(e);
  }
  renderGfPick();
}
gfBoard.addEventListener('change', () => void gfPick(gfBoard.value || null, null));
gfPanel.addEventListener('change', () => void gfPick(gfCfg.board, gfPanel.value ? +gfPanel.value : null));
async function gfConnect(): Promise<void> {
  const url = gfUrl.value.trim(),
    token = gfInput.value.trim();
  if (!url || !token) return;
  gfGo.disabled = true;
  gfErr.textContent = '';
  try {
    await invoke<string>('grafana_connect', { url, token });
    gfInput.value = '';
    gfCfg = await invoke<GfConfig>('grafana_config');
    gfBoards = null;
  } catch (e) {
    gfErr.textContent = String(e);
  } finally {
    gfGo.disabled = false;
  }
}
gfGo.addEventListener('click', () => void gfConnect());
for (const el of [gfUrl, gfInput])
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void gfConnect();
  });
$('gf-off').addEventListener('click', () => {
  gfCfg = { url: null, board: null, panel: null };
  gfPanels = [];
  void invoke('grafana_disconnect');
});

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

// ---------- Almanac (stage 8e) ----------
const alEmail = $<HTMLInputElement>('al-email'),
  alPass = $<HTMLInputElement>('al-pass'),
  alCode = $<HTMLInputElement>('al-code'),
  alGo = $<HTMLButtonElement>('al-go'),
  alSend = $<HTMLButtonElement>('al-send'),
  alVerify = $<HTMLButtonElement>('al-verify'),
  alErr = $('al-error'),
  alModes = [...document.querySelectorAll<HTMLInputElement>('input[name="al-mode"]')];
function renderAlmanac(a: AlState | null): void {
  lastAl = a;
  const on = !!a && (a.auth === 'ok' || a.auth === 'net');
  $('al-connect').hidden = on;
  $('al-connected').hidden = !on;
  $('al-nobuild').hidden = alBuilt;
  $('al-browser').hidden = !alBuilt;
  $('al-form').hidden = !alBuilt || !alFallback;
  $('al-more').hidden = alFallback;
  $('almanac-dot').className = 'dot' + (on ? ' ok' : a && a.auth === 'bad' ? ' bad' : '');
  $('almanac-status').textContent = !alBuilt
    ? t('Пример из прототипа')
    : on && a
      ? (a.email ?? 'Almanac') +
        (a.date ? ' · ' + t('привычки {0} из {1}', a.done, a.total) : '') +
        (a.auth === 'net' ? t(' · нет связи') : '')
      : a && a.auth === 'bad'
        ? t('Вход истёк - войдите снова')
        : t('Не подключён');
  if (a && a.email && !alEmail.value) alEmail.value = a.email;
}
function alMode(): 'pass' | 'code' {
  return alModes.find((r) => r.checked)?.value === 'code' ? 'code' : 'pass';
}
function renderAlMode(): void {
  const code = alMode() === 'code';
  $('al-pass-row').hidden = code;
  $('al-code-row').hidden = !code;
  alSend.hidden = !code;
  alErr.textContent = '';
}
for (const r of alModes) r.addEventListener('change', renderAlMode);
async function alRun(btn: HTMLButtonElement, job: () => Promise<unknown>): Promise<void> {
  btn.disabled = true;
  alErr.textContent = '';
  alErr.classList.remove('ok-note');
  try {
    await job();
  } catch (e) {
    alErr.textContent = String(e);
  } finally {
    btn.disabled = false;
  }
}
async function alSignIn(): Promise<void> {
  if (!alEmail.value.trim() || !alPass.value) return;
  await alRun(alGo, async () => {
    await invoke<string>('almanac_sign_in', { email: alEmail.value, password: alPass.value });
    alPass.value = '';
  });
}
async function alSendCode(): Promise<void> {
  if (!alEmail.value.trim()) return;
  await alRun(alSend, async () => {
    await invoke('almanac_send_code', { email: alEmail.value });
    alErr.textContent = t('Код отправлен на почту');
    alErr.classList.add('ok-note');
    alCode.focus();
  });
}
async function alVerifyCode(): Promise<void> {
  if (!alCode.value.trim()) return;
  await alRun(alVerify, async () => {
    await invoke<string>('almanac_verify', { email: alEmail.value, code: alCode.value });
    alCode.value = '';
  });
}
alGo.addEventListener('click', () => void alSignIn());
alPass.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void alSignIn();
});
alSend.addEventListener('click', () => void alSendCode());
alVerify.addEventListener('click', () => void alVerifyCode());
alCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void alVerifyCode();
});
$('al-off').addEventListener('click', () => void invoke('almanac_sign_out'));
// "Sign in with Almanac": the browser shows Almanac's consent; Rust waits for the answer on 127.0.0.1
let alFallback = false;
async function alBrowser(): Promise<void> {
  const btn = $<HTMLButtonElement>('al-web');
  btn.disabled = true;
  $('al-wait').hidden = false;
  $('al-web-error').textContent = '';
  try {
    await invoke<string>('almanac_browser_sign_in');
  } catch (e) {
    $('al-web-error').textContent = String(e);
  } finally {
    btn.disabled = false;
    $('al-wait').hidden = true;
  }
}
$('al-web').addEventListener('click', () => void alBrowser());
$('al-cancel').addEventListener('click', () => void invoke('almanac_browser_cancel'));
$('al-more').addEventListener('click', () => {
  alFallback = true;
  renderAlmanac(lastAl);
  alEmail.focus();
});

// ---------- tabs and the module list (Raycast-like) ----------
const mods = [...document.querySelectorAll<HTMLButtonElement>('.mod')];
/** "welcome" covers the window with the first-run guide; anything else is a page of the sidebar */
// Windows: step 3 of the guide shows the calendar page's own source picker (one set of controls,
// and the guide never leaves for the calendar page with no way back)
const calPickEl = $('cal-pick'),
  calPickHome = calPickEl.parentElement as HTMLElement,
  calPickNext = calPickEl.nextSibling;
function calPickInGuide(on: boolean): void {
  if (on) $('w-cal-slot').append(calPickEl);
  else calPickHome.insertBefore(calPickEl, calPickNext);
}
function showTab(name: string): void {
  const welcome = name === 'welcome';
  if (isWin) calPickInGuide(welcome);
  $('tab-welcome').hidden = !welcome;
  $('tab-modules').hidden = welcome;
  if (!welcome) {
    mascot?.setRunning(false);
    if (name === 'general' || !document.querySelector('.detail > main:not([hidden])')) showModule('general');
  }
}
function showModule(name: string): void {
  $('tab-welcome').hidden = true;
  $('tab-modules').hidden = false;
  mascot?.setRunning(false);
  for (const m of mods) m.classList.toggle('on', m.dataset.module === name);
  for (const m of document.querySelectorAll<HTMLElement>('.detail > main')) {
    const show = m.id === name;
    if (show && m.hidden) {
      // a short fade-in, like a native settings pane
      m.style.animation = 'none';
      void m.offsetWidth;
      m.style.animation = '';
    }
    m.hidden = !show;
  }
}
for (const m of mods) m.addEventListener('click', () => showModule(m.dataset.module ?? 'general'));
// each module page's header shows the module's icon from the sidebar
for (const main of document.querySelectorAll<HTMLElement>('.detail > main')) {
  const ico = document.querySelector(`.mod[data-module="${main.id}"] .ico`);
  const headEl = main.querySelector('.page-head');
  if (ico && headEl) headEl.prepend(ico.cloneNode(true));
}
showModule('general');
/** "island" and "general" open the general tab, module names open their page */
function showSection(sec: string): void {
  if (sec === 'welcome') showWelcome();
  else if (mods.some((m) => m.dataset.module === sec)) showModule(sec);
  else showModule('general');
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
  grafana: ['gf-status', 'gf-dot'],
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
  grafana: 'grafana',
};
// until Rust answers: the shipped defaults (modules.rs - new modules start off)
let modCfg: Modules = { off: ['vercel', 'notion', 'grafana'], chat: true };
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
  renderModCount();
  chatOn.checked = c.chat;
  for (const m of mods) m.classList.toggle('off', c.off.includes(MOD_OF[m.dataset.module ?? ''] ?? ''));
}
async function saveModules(next: Modules): Promise<void> {
  if (Object.values(MOD_OF).every((id) => next.off.includes(id))) {
    say(t('Хотя бы один модуль должен остаться включённым'));
    renderModules(modCfg);
    return;
  }
  // the open island fits 5: Claude Code counts only while it is on (modules.rs MAX_ON)
  if (Object.values(MOD_OF).filter((id) => !next.off.includes(id)).length > 5) {
    say(t('Одновременно можно включить не больше 5 модулей - сначала выключите один'));
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

// sound tiers (stage 9a): kept in the storage this window shares with the island's, which hears
// the change through the "storage" event (src/main.ts)
const TIERS_KEY = 'almanac-notch.sound-tiers';
const tierBoxes = [...document.querySelectorAll<HTMLInputElement>('input[data-tier]')];
function readTiers(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(TIERS_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}
for (const box of tierBoxes) {
  box.checked = readTiers()[box.dataset.tier ?? ''] !== false;
  box.addEventListener('change', () => {
    const t = readTiers();
    for (const b of tierBoxes) t[b.dataset.tier ?? ''] = b.checked;
    try {
      localStorage.setItem(TIERS_KEY, JSON.stringify(t));
    } catch {
      // not saved: the island keeps its choice
    }
  });
}

// CI results (island/ci.ts): kept in the shared storage, as the sound tiers
const CI_KEY = 'almanac-notch.ci';
const ciRadios = [...document.querySelectorAll<HTMLInputElement>('input[name=ci-ok], input[name=ci-fail]')];
function readCi(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CI_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}
for (const r of ciRadios) {
  const key = r.name === 'ci-ok' ? 'ok' : 'fail';
  r.checked = (readCi()[key] ?? 'pop') === r.value;
  r.addEventListener('change', () => {
    if (!r.checked) return;
    try {
      localStorage.setItem(CI_KEY, JSON.stringify({ ...readCi(), [key]: r.value }));
    } catch {
      // not saved: the island keeps its choice
    }
  });
}

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

// ---------- app: version, launch at login, updates (stage 8f) ----------
interface UpdateState {
  state: 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'error';
  version: string | null;
  progress: number | null;
  error: string | null;
}
interface AppInfo {
  version: string;
  /** the commit of this build: test builds share a version number */
  build: string;
  onboarded: boolean;
  updates: boolean;
  fullscreen_hide: boolean;
  autostart: boolean;
  update: UpdateState;
}
let appInfo: AppInfo | null = null,
  lastUpd: UpdateState = { state: 'idle', version: null, progress: null, error: null };
function renderApp(a: AppInfo | null): void {
  appInfo = a;
  $('app-version').textContent = a ? t('Версия {0}', a.build ? a.version + ' · ' + a.build : a.version) : '';
  $<HTMLInputElement>('autostart').checked = !!a?.autostart;
  $<HTMLInputElement>('updates').checked = !!a?.updates;
  $<HTMLInputElement>('fullscreen').checked = a ? a.fullscreen_hide : true;
  if (a) renderUpdate(a.update);
}
function renderUpdate(u: UpdateState): void {
  lastUpd = u;
  const go = $<HTMLButtonElement>('upd-go');
  $('upd-status').textContent =
    u.state === 'checking'
      ? t('Проверка…')
      : u.state === 'latest'
        ? t('Установлена последняя версия')
        : u.state === 'available'
          ? t('Вышла версия {0}', u.version ?? '')
          : u.state === 'downloading'
            ? t('Загрузка обновления… {0}%', Math.round((u.progress ?? 0) * 100))
            : '';
  go.textContent = u.state === 'available' ? t('Обновить и перезапустить') : t('Проверить сейчас');
  go.classList.toggle('primary', u.state === 'available');
  go.disabled = u.state === 'checking' || u.state === 'downloading';
  $('upd-error').textContent = u.error ?? '';
}
$('upd-go').addEventListener('click', () => {
  if (!inTauri) return;
  if (lastUpd.state === 'available')
    void invoke('update_install').catch((e: unknown) => ($('upd-error').textContent = String(e)));
  else void invoke<UpdateState>('update_check').then(renderUpdate);
});
// stage 8g: the "Uninstall Almanac Notch?" window (Mac - in this app, Windows - the uninstaller)
$('uninstall').addEventListener('click', () => {
  if (inTauri) void invoke('open_bye').catch((e: unknown) => say(String(e)));
});
async function appSet(key: string, on: boolean): Promise<void> {
  try {
    renderApp(await invoke<AppInfo>('app_set', { key, on }));
  } catch (e) {
    say(String(e));
    renderApp(appInfo);
  }
}
$<HTMLInputElement>('autostart').addEventListener('change', (e) => {
  void appSet('autostart', (e.target as HTMLInputElement).checked);
});
$<HTMLInputElement>('updates').addEventListener('change', (e) => {
  void appSet('updates', (e.target as HTMLInputElement).checked);
});
$<HTMLInputElement>('fullscreen').addEventListener('change', (e) => {
  void appSet('fullscreen', (e.target as HTMLInputElement).checked);
});

// ---------- first-run guide (stage 8f): language, Claude Code, calendar, modules, launch at login ----------
const steps = [...document.querySelectorAll<HTMLElement>('.step')],
  welcomePane = $('tab-welcome'),
  dots = $('w-dots');
dots.replaceChildren(...steps.map(() => document.createElement('i')));
let step = 0;
function renderStep(back = false): void {
  steps.forEach((el, i) => {
    el.hidden = i !== step;
    // replay the entrance animation in the direction of travel
    if (i === step) {
      el.classList.toggle('back', back);
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    }
  });
  [...dots.children].forEach((d, i) => d.classList.toggle('on', i === step));
  welcomePane.style.setProperty('--glow', steps[step]?.dataset.glow ?? '#6f86ff');
  const last = step === steps.length - 1;
  $('w-back').style.visibility = step === 0 ? 'hidden' : '';
  // skipping means something only where a step asks for an action (Claude Code, calendar)
  $('w-skip').hidden = !steps[step]?.querySelector('.w-actions');
  $('w-next').textContent = t(last ? 'Начать' : 'Дальше');
  $('w-cal-mac').hidden = isWin;
  $('w-cal-win').hidden = !isWin;
  // Windows picks the source right in the step; the button is the Mac permission prompt
  $('w-cal').hidden = isWin;
  $('w-where').textContent = t(
    isWin
      ? 'Остров - у верхнего края экрана: наведите на него курсор. Меню - значок Almanac Notch в трее.'
      : 'Остров - у выреза камеры: наведите на него курсор. Меню - значок Almanac Notch в строке меню.',
  );
  renderModCount();
}
function renderModCount(): void {
  const n = toggles.filter((x) => x.closest('.w-tiles') && x.checked).length;
  $('w-mods-count').textContent = t('Выбрано {0} из 4', n);
}
function goStep(to: number): void {
  const back = to < step;
  step = Math.max(0, Math.min(steps.length - 1, to));
  renderStep(back);
  // the mascot follows the guide: hello, a nod on each step, a celebration at the end
  if (step === steps.length - 1) mascot?.react('dance');
  else if (!back && step > 0) mascot?.poke();
}
function showWelcome(): void {
  showTab('welcome');
  mascot ??= welcomeMascot($<HTMLCanvasElement>('w-stage'));
  mascot.setRunning(true);
  step = 0;
  renderStep();
  setTimeout(() => mascot?.react('greeting'), 350);
}
async function finishWelcome(): Promise<void> {
  $('w-error').textContent = '';
  if (inTauri)
    try {
      await invoke('app_set', { key: 'autostart', on: $<HTMLInputElement>('w-autostart').checked });
      await invoke('app_set', { key: 'updates', on: $<HTMLInputElement>('w-updates').checked });
      renderApp(await invoke<AppInfo>('app_set', { key: 'onboarded', on: true }));
    } catch (e) {
      $('w-error').textContent = String(e);
      return;
    }
  mascot?.setRunning(false);
  showModule('general');
  // the island is what comes next, not settings; reopening the window starts on General
  if (inTauri) void getCurrentWindow().close();
}
$('w-next').addEventListener('click', () => {
  if (step === steps.length - 1) void finishWelcome();
  else goStep(step + 1);
});
$('w-skip').addEventListener('click', () => goStep(step + 1));
$('w-back').addEventListener('click', () => goStep(step - 1));
$('w-hooks').addEventListener('click', () => act('hooks:install'));
$('w-cal').addEventListener('click', () => {
  // asking for access means the calendar is wanted: switch the module on too
  if (modCfg.off.includes('cal')) void saveModules({ ...modCfg, off: modCfg.off.filter((x) => x !== 'cal') });
  void invoke('calendar_access');
});
for (const x of toggles)
  if (x.closest('.w-tiles'))
    x.addEventListener('change', () => {
      renderModCount();
      if (x.checked) mascot?.poke();
    });
// the guide repeats the Claude Code and calendar status lines; hooks going in is worth a cheer
for (const [from, to] of [
  ['hooks', 'w-hooks'],
  ['cal', 'w-cal'],
] as const) {
  const copy = (): void => {
    const was = $(to + '-dot').className;
    $(to + '-status').textContent = $(from + '-status').textContent;
    $(to + '-dot').className = $(from + '-dot').className;
    const ok = $(to + '-dot').className.includes('ok');
    if (!was.includes('ok') && ok && !welcomePane.hidden) mascot?.react('success');
    // done: the step's button says so instead of offering the same action again
    const btn = $<HTMLButtonElement>(to);
    btn.disabled = ok;
    btn.textContent = t(
      to === 'w-hooks'
        ? ok
          ? 'Подключено'
          : 'Подключить'
        : ok
          ? 'Доступ есть'
          : isWin
            ? 'Выбрать источник'
            : 'Разрешить доступ',
    );
  };
  const o = new MutationObserver(copy);
  o.observe($(from + '-status'), { childList: true, characterData: true, subtree: true });
  o.observe($(from + '-dot'), { attributes: true });
  copy();
}

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
const langs = [...document.querySelectorAll<HTMLInputElement>('input[name=lang], input[name=lang-w]')];
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
  renderGrafana(lastGf);
  renderAlmanac(lastAl);
  renderCal(lastCal);
  renderMusic(lastMusic);
  renderIsland(lastIsland);
  renderPick();
  renderApp(appInfo);
  renderStep();
}
for (const r of langs)
  r.addEventListener('change', () => {
    if (inTauri) void invoke<LangCfg>('lang_set', { pick: r.value }).then(renderLang);
  });
renderLang({ pick: 'auto', lang: 'ru' });
renderAlmanac(null);
renderAlMode();
if (inTauri) {
  await listen<Calendar>('island://calendar', (e) => renderCal(e.payload));
  await listen<GhState>('island://github', (e) => render(e.payload));
  await listen<VcState>('island://vercel', (e) => renderVercel(e.payload));
  await listen<NoState>('island://notion', (e) => renderNotion(e.payload));
  await listen<GfState>('island://grafana', (e) => renderGrafana(e.payload));
  await listen<AlState>('island://almanac', (e) => renderAlmanac(e.payload));
  const f = await invoke<{
    github: GhState | null;
    vercel: VcState | null;
    notion: NoState | null;
    grafana: GfState | null;
    almanac: AlState | null;
    calendar: Calendar | null;
    media: MediaNow | null;
  }>('feeds_state');
  render(f.github);
  renderVercel(f.vercel);
  renderNotion(f.notion);
  gfCfg = await invoke<GfConfig>('grafana_config');
  renderGrafana(f.grafana);
  alBuilt = await invoke<boolean>('almanac_available');
  renderAlmanac(f.almanac);
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
  renderApp(await invoke<AppInfo>('app_info'));
  await listen<UpdateState>('app://update', (e) => renderUpdate(e.payload));
  input.focus();
}
// plain Vite (screenshots): the hash still picks the page
else if (location.hash) showSection(location.hash.slice(1));
