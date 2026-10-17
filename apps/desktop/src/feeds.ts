// Calendar and now-playing -> s.cal and s.media (stage 5). Rust sends the raw data
// (`island://calendar`, `island://media`, `island://volume`); these drivers pick the next call,
// keep the player clock running between updates and send the island's player buttons back.
// Pure logic over the island state, so it runs in vitest without Tauri.
import {
  tr,
  type CalFeed,
  type EventType,
  type GithubFeed,
  type IslandState,
  type Lang,
  type MediaFeed,
  type NotionFeed,
  type VercelFeed,
} from '@almanac-notch/island';
import { clip } from './agent';

export interface CalEvent {
  title: string;
  /** epoch ms */
  start: number;
  end: number;
}

export interface Calendar {
  access: 'ok' | 'denied' | 'unknown' | 'off';
  /** Mac: 'system'; Windows: the source picked in settings ('none' = not picked) */
  source?: 'system' | 'outlook' | 'ical' | 'none';
  events: CalEvent[];
}

/** A call that started this long ago is still the "current" one; then the next takes over. */
const STARTED_MS = 10 * 60 * 1000;
/** Meeting titles share the card line with nothing; longer ones squeeze unreadably. */
const TITLE_MAX = 30;
const AFTER_MAX = 34;
/** Windows: the source is picked in the settings window. */
const CAL_HINT_RU = 'Настройки → Календарь';

const hhmm = (t: number): string => {
  const d = new Date(t);
  return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
};

const DAYS: Record<Lang, readonly string[]> = {
  ru: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

/** "15:00", "завтра 10:00", "пт 10:00" */
export function whenText(t: number, now: number, lang: Lang = 'ru'): string {
  const day = (x: number): number => {
    const d = new Date(x);
    return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);
  };
  const diff = day(t) - day(now);
  if (diff === 0) return hhmm(t);
  if (diff === 1) return tr({ lang }, 'завтра {0}', hhmm(t));
  return (DAYS[lang][new Date(t).getDay()] as string) + ' ' + hhmm(t);
}

/** proto: calMins + the card's three lines, from the system calendar. */
export function calFeed(cal: Calendar | null, now: number, lang: Lang = 'ru'): CalFeed {
  const L = { lang },
    CAL_HINT = tr(L, CAL_HINT_RU);
  const empty = (title: string, after: string): CalFeed => ({
    mins: null,
    at: '',
    title: tr(L, title),
    after: tr(L, after),
  });
  const picked = cal && (cal.source === 'outlook' || cal.source === 'ical');
  if (cal && cal.access === 'off' && cal.source === 'none') return empty('Календарь не подключён', CAL_HINT);
  if (!cal || cal.access === 'off') return empty('Календарь недоступен', 'на этой системе');
  if (picked && cal.access === 'unknown') return empty('Календарь не отвечает', 'попробую ещё раз позже');
  if (cal.access !== 'ok' && cal.source === 'outlook') return empty('Outlook не найден', CAL_HINT);
  if (cal.access !== 'ok' && cal.source === 'ical') return empty('Ссылка не открывается', CAL_HINT);
  if (cal.access !== 'ok') return empty('Нет доступа к календарю', 'меню острова → Доступ к календарю');
  const ahead = cal.events.filter((e) => e.end > now && e.start > now - STARTED_MS);
  const next = ahead[0];
  if (!next) return empty('Встреч нет', 'ни сегодня, ни завтра');
  const after = ahead.find((e) => e.start >= next.end) ?? ahead[1];
  return {
    mins: Math.max(0, Math.ceil((next.start - now) / 60_000)),
    at: whenText(next.start, now, lang),
    title: clip(next.title || tr(L, 'Без названия'), TITLE_MAX),
    after: after
      ? tr(
          L,
          '{0} в {1}',
          clip(tr(L, 'дальше: {0}', after.title || tr(L, 'встреча')), AFTER_MAX - 6),
          whenText(after.start, now, lang),
        )
      : '',
  };
}

export class CalDriver {
  private cal: Calendar | null = null;
  private lastMin = -1;
  private lang: Lang = 'ru';
  constructor(
    private s: IslandState,
    private now: () => number,
  ) {
    s.cal = calFeed(null, now());
  }
  onCalendar(c: Calendar): void {
    this.cal = c;
    this.lastMin = -1;
    this.tick();
  }
  /** Per frame; the feed only changes once a minute. */
  tick(): void {
    const now = this.now(),
      min = Math.floor(now / 60_000);
    if (min === this.lastMin && this.s.lang === this.lang) return;
    this.lastMin = min;
    this.lang = this.s.lang;
    this.s.cal = calFeed(this.cal, now, this.lang);
  }
}

// ---------- music ----------
/** One line of the helper (media/mediaremote.m). */
export interface MediaMsg {
  none?: boolean;
  off?: boolean;
  title?: string;
  artist?: string;
  album?: string;
  app?: string;
  duration?: number;
  elapsed?: number;
  /** epoch ms of `elapsed` */
  ts?: number;
  rate?: number;
  playing?: boolean;
  /** MediaRemote: 1 off, 2 albums, 3 songs */
  shuffle?: number;
  /** MediaRemote: 1 off, 2 one, 3 all */
  repeat?: number;
  /** identity of the player's cover; 0 = none right now */
  artId?: number;
  /** base64 JPEG; "" = no cover; absent = unchanged */
  art?: string;
  /** base64 PNG of the player's app icon, the fallback cover; absent = same player */
  icon?: string;
}

export interface MediaHost {
  send: (cmd: string) => void;
  setVolume: (v: number) => void;
  /** base64 JPEG or PNG -> something drawImage takes; async, may fail */
  decode: (b64: string) => Promise<CanvasImageSource | null>;
  now: () => number;
}

/** After a track change the cover may come later; until then the loading tile, then the generated cover. */
const ART_WAIT_MS = 2500;
/** Fade of a cover over the loading tile. */
const ART_FADE_MS = 180;
/** Players report "nothing" for a moment between tracks; only a longer silence empties the card. */
const NONE_GRACE_MS = 1500;
const MEDIA_TITLE_MAX = 34;
const MEDIA_SHORT_MAX = 18;
const MEDIA_SUB_MAX = 40;

/** djb2 over the title: the same track keeps the same generated cover. */
export function artSeed(t: string): number {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
  return h;
}

export class MediaDriver {
  private elapsed = 0;
  private ts = 0;
  private rate = 0;
  private artGen = 0;
  /** title|artist of the shown track */
  private track = '';
  /** artId of md.art; 0 = none shown, -1 = the player's icon */
  private shownArt = 0;
  /** the player's app icon: shown when a track brings no cover (as Boring Notch does) */
  private icon: CanvasImageSource | null = null;
  private iconGen = 0;
  private artUntil = 0;
  private artAt = 0;
  private noneAt = 0;
  constructor(
    private s: IslandState,
    private host: MediaHost,
  ) {
    s.media = this.empty('Ничего не играет', 'включи музыку в любом плеере');
    s.musicPlaying = false;
    s.musicPos = 0;
    s.shuffle = false;
    s.repeat = false;
  }

  private empty(title: string, sub: string): MediaFeed {
    return { idle: true, title, short: title, sub, len: 0, art: null, artPending: false, artA: 1, artSeed: 0, out: [] };
  }

  private setEmpty(off: boolean): void {
    const s = this.s;
    s.media = off
      ? this.empty('Музыка недоступна', 'нет доступа к системному плееру')
      : this.empty('Ничего не играет', 'включи музыку в любом плеере');
    s.musicPlaying = false;
    s.musicPos = 0;
    this.rate = 0;
    this.artGen++;
    this.track = '';
    this.shownArt = 0;
    this.icon = null;
    this.iconGen++;
  }

  private showIcon(md: MediaFeed): void {
    if (!this.icon) return;
    md.art = this.icon;
    md.artPending = false;
    this.shownArt = -1;
    this.artAt = this.host.now();
    md.artA = 0;
  }

  /** The cover: keep what fits this track, wait a little for a missing one, fade a late one in. */
  private onArt(m: MediaMsg, md: MediaFeed, newTrack: boolean): void {
    const now = this.host.now(),
      id = m.artId ?? 0;
    if (id && id === this.shownArt) return;
    if (m.icon !== undefined) {
      const gen = ++this.iconGen;
      this.icon = null;
      if (m.icon)
        void this.host.decode(m.icon).then((img) => {
          if (gen !== this.iconGen) return;
          this.icon = img;
          // the wait for a cover is already over: the icon instead of the generated cover
          if (this.s.media === md && !md.art && !md.artPending) this.showIcon(md);
        });
    }
    if (newTrack) {
      this.artUntil = now + ART_WAIT_MS;
      // the icon stays while the next track's cover may still come; a real cover is wrong for it
      if (this.shownArt !== -1) {
        this.artGen++;
        this.shownArt = 0;
        md.art = null;
        md.artPending = true;
      }
    }
    // no cover in this update: for the same track it is a blink of the player, keep ours
    if (!id || !m.art) return;
    const gen = ++this.artGen,
      fromTile = !md.art;
    void this.host.decode(m.art).then((img) => {
      if (gen !== this.artGen || this.s.media !== md) return;
      if (!img) {
        md.artPending = false;
        return;
      }
      md.art = img;
      md.artPending = false;
      this.shownArt = id;
      this.artAt = fromTile ? this.host.now() : 0;
      md.artA = fromTile ? 0 : 1;
    });
  }

  onMessage(m: MediaMsg): void {
    const s = this.s;
    if (m.off || m.none || !m.title) {
      if (m.off) this.setEmpty(true);
      else if (!this.noneAt) this.noneAt = this.host.now() + NONE_GRACE_MS;
      return;
    }
    this.noneAt = 0;
    const md = s.media as MediaFeed,
      key = m.title + '|' + (m.artist ?? ''),
      newTrack = key !== this.track;
    this.track = key;
    const sub = [m.artist, m.album || m.app].filter(Boolean).join(' · ');
    md.idle = false;
    md.title = clip(m.title, MEDIA_TITLE_MAX);
    md.short = clip(m.title, MEDIA_SHORT_MAX);
    md.sub = clip(sub || m.app || '', MEDIA_SUB_MAX);
    md.len = m.duration && m.duration > 0 ? m.duration : 0;
    md.artSeed = artSeed(m.title);
    s.musicPlaying = !!m.playing;
    s.shuffle = (m.shuffle ?? 1) > 1;
    s.repeat = (m.repeat ?? 1) > 1;
    this.elapsed = m.elapsed ?? 0;
    this.ts = m.ts ?? this.host.now();
    this.rate = m.playing ? (m.rate ?? 1) || 1 : 0;
    this.onArt(m, md, newTrack);
    this.tick();
  }

  onVolume(v: number | null): void {
    if (v !== null) this.s.volume = v;
  }

  /** Per frame: the island's buttons -> the player, then the player clock -> musicPos. */
  tick(): void {
    const s = this.s,
      md = s.media;
    if (!md) return;
    const now = this.host.now();
    if (this.noneAt && now >= this.noneAt) {
      this.noneAt = 0;
      this.setEmpty(false);
      return;
    }
    if (md.artPending && !md.art && now >= this.artUntil) {
      md.artPending = false;
      this.showIcon(md);
    }
    if (md.artA < 1) md.artA = Math.min(1, (now - this.artAt) / ART_FADE_MS);
    for (const cmd of md.out.splice(0)) {
      const [name = '', arg = ''] = cmd.split(' ');
      if (name === 'vol') {
        this.host.setVolume(+arg);
        continue;
      }
      // the island already shows the result; keep the clock in step until the player confirms
      const pos = this.pos(now);
      if (name === 'toggle') {
        this.elapsed = pos;
        this.ts = now;
        this.rate = s.musicPlaying ? 1 : 0;
      } else if (name === 'seek' || name === 'next' || name === 'prev') {
        this.elapsed = name === 'seek' ? +arg : 0;
        this.ts = now;
      }
      if (name === 'shuffle') this.host.send('shuffle ' + (arg === '1' ? 3 : 1));
      else if (name === 'repeat') this.host.send('repeat ' + (arg === '1' ? 3 : 1));
      else this.host.send(cmd);
    }
    if (!md.idle) s.musicPos = this.pos(now);
  }

  private pos(now: number): number {
    const p = this.elapsed + (Math.max(0, now - this.ts) / 1000) * this.rate;
    const len = this.s.media?.len ?? 0;
    return Math.max(0, len > 0 ? Math.min(p, len) : p);
  }
}

// ---------- github ----------
/** `island://github` (src-tauri/src/github.rs). */
export interface GhRepo {
  name: string;
  branch: string;
  state: 'run' | 'fail' | 'ok' | 'none';
  /** when the checks ran (else the commit), epoch ms */
  at: number;
  /** last push, epoch ms */
  pushed: number;
  done: number;
  total: number;
  failed: string | null;
}

export interface GhState {
  auth: 'off' | 'ok' | 'bad' | 'net';
  login: string | null;
  repos: GhRepo[];
  repo_count: number;
  prs: number;
  /** my commits of 7 days, epoch ms */
  commits: number[];
}

/** characters of the CI line that stay readable next to the glyph (the prototype's longest is 20) */
const GH_LINE = 23;
const SETTINGS_HINT = 'Настройки → GitHub';

function dayIndex(t: number): number {
  const d = new Date(t);
  return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);
}

/** Commit times -> 7 per-day counts, today last. */
const isMain = (b: string): boolean => b === 'main' || b === 'master';

/** "almanac-app" on the main branch, "almanac-a/feat-x" (cut) on any other. */
export function repoLabel(r: { name: string; branch: string }, max = 16): string {
  if (isMain(r.branch)) return clip(r.name, max);
  const half = Math.floor((max - 1) / 2);
  return clip(r.name, max - 1 - Math.min(r.branch.length, half)) + '/' + clip(r.branch, half);
}

export function commitDays(times: number[], now: number): number[] {
  const today = dayIndex(now),
    out = [0, 0, 0, 0, 0, 0, 0];
  for (const t of times) {
    const i = 6 - (today - dayIndex(t));
    if (i >= 0 && i <= 6) out[i] = (out[i] as number) + 1;
  }
  return out;
}

function prText(n: number, L: { lang: Lang }): string {
  if (n === 0) return tr(L, 'ревью не ждут');
  return n === 1 ? tr(L, '1 PR ждёт ревью') : tr(L, '{0} PR ждут ревью', n);
}

/** proto: the github card's three lines, from the account's real repositories. */
export function githubFeed(g: GhState | null, now: number, lang: Lang = 'ru'): GithubFeed {
  const L = { lang };
  const empty = (hint: [string, string], short: string): GithubFeed => ({
    auth: g && g.auth === 'bad' ? 'bad' : 'off',
    ci: 'none',
    ciText: '',
    short: tr(L, short),
    prs: 0,
    prText: '',
    commits: [0, 0, 0, 0, 0, 0, 0],
    hint: [tr(L, hint[0]), tr(L, hint[1])],
  });
  if (!g || g.auth === 'off') return empty(['GitHub не подключён', SETTINGS_HINT], 'нет токена');
  if (g.auth === 'bad') return empty(['GitHub не принял токен', SETTINGS_HINT], 'токен не принят');
  if (!g.login) return empty(['Нет связи с GitHub', 'попробую снова через минуту'], 'нет связи');
  const withCi = g.repos.filter((r): r is GhRepo & { state: 'run' | 'fail' | 'ok' } => r.state !== 'none'),
    latest = withCi.reduce<(typeof withCi)[number] | null>((a, r) => (!a || r.at > a.at ? r : a), null);
  const commits = commitDays(g.commits, now);
  if (!latest)
    return {
      auth: 'ok',
      ci: 'none',
      ciText: tr(L, 'CI не настроен'),
      short: tr(L, 'нет CI'),
      prs: g.prs,
      prText: prText(g.prs, L),
      commits,
      hint: ['', ''],
    };
  // the card line is narrow: the status is short, the repository gets what is left
  const st =
      latest.state === 'ok'
        ? tr(L, 'зелёный')
        : latest.state === 'run'
          ? tr(L, 'идёт {0}/{1}', latest.done, latest.total)
          : latest.failed
            ? tr(L, 'упал: {0}', clip(latest.failed, 6))
            : tr(L, 'упал'),
    repo = clip(latest.name, Math.max(9, GH_LINE - 3 - st.length)),
    parts: [string, string] = [tr(L, { ok: 'CI зелёный', run: 'CI идёт', fail: 'CI упал' }[latest.state]), st];
  return {
    auth: 'ok',
    ci: latest.state,
    ciText: repo + ' · ' + parts[1],
    short: parts[0],
    prs: g.prs,
    prText: prText(g.prs, L),
    commits,
    hint: ['', ''],
  };
}

/** Prompts keep the island; a CI result waits until they are answered. */
const PROMPTS: readonly string[] = ['attention', 'question'];

export class GithubDriver {
  private g: GhState | null = null;
  private lastMin = -1;
  private lang: Lang = 'ru';
  /** last CI state per repository; a change to ok or fail is an event */
  private seen = new Map<string, GhRepo['state']>();
  private pending: { type: EventType; label: string } | null = null;
  constructor(
    private s: IslandState,
    private m: { trigger: (t: EventType) => void },
    private now: () => number,
  ) {
    s.github = githubFeed(null, now());
  }

  onState(g: GhState): void {
    // the first read after start only seeds the states: no event for what was already so
    const first = this.seen.size === 0 && this.g === null;
    let hit: { type: EventType; label: string } | null = null;
    if (g.login) {
      for (const r of g.repos) {
        const key = r.name + '#' + r.branch,
          was = this.seen.get(key);
        this.seen.set(key, r.state);
        if (first || was === undefined || was === r.state || r.state === 'run' || r.state === 'none') continue;
        const type: EventType = r.state === 'ok' ? 'success' : 'error';
        // a failure outranks a success from another repository in the same read
        if (!hit || type === 'error')
          hit = { type, label: tr(this.s, type === 'success' ? 'CI прошёл' : 'CI упал') + ' · ' + clip(r.name, 12) };
      }
    } else if (g.auth === 'off' || g.auth === 'bad') this.seen.clear();
    this.g = g;
    this.lastMin = -1;
    if (hit) this.pending = hit;
    this.tick();
  }

  /** Per frame: the feed's relative day, a waiting CI event. */
  tick(): void {
    const now = this.now(),
      min = Math.floor(now / 60_000);
    if (min !== this.lastMin || this.s.lang !== this.lang) {
      this.lastMin = min;
      this.lang = this.s.lang;
      this.s.github = githubFeed(this.g, now, this.lang);
    }
    const p = this.pending,
      ev = this.s.event;
    if (p && !(ev && PROMPTS.includes(ev.type))) {
      this.pending = null;
      this.m.trigger(p.type);
      if (this.s.event) this.s.event.label = p.label;
    }
  }
}

// ---------- vercel ----------
/** `island://vercel` (src-tauri/src/vercel.rs). */
export interface VcDeploy {
  id: string;
  project: string;
  state: 'building' | 'ready' | 'error' | 'canceled';
  /** epoch ms */
  created: number;
  /** finished, epoch ms; null while building */
  done: number | null;
  target: 'production' | 'preview';
  branch: string | null;
}

export interface VcState {
  auth: 'off' | 'ok' | 'bad' | 'net';
  user: string | null;
  /** one per project, newest first */
  deploys: VcDeploy[];
}

/** "сейчас", "5 мин", "2 ч", "6 дн" - the card's compact age, as coucou's "2h" */
export function agoText(t: number, now: number, lang: Lang = 'ru'): string {
  const L = { lang },
    min = Math.floor(Math.max(0, now - t) / 60_000);
  if (min < 1) return tr(L, 'сейчас');
  if (min < 60) return tr(L, '{0} мин', min);
  const h = Math.floor(min / 60);
  return h < 24 ? tr(L, '{0} ч', h) : tr(L, '{0} дн', Math.floor(h / 24));
}

const VC_HINT = 'Настройки → Vercel';
const VC_STATE = { building: 'run', ready: 'ok', error: 'fail', canceled: 'off' } as const;

/** Not in the prototype (docs/CHANGES.md): the Vercel card - the three newest deployments, as in coucou. */
export function vercelFeed(v: VcState | null, now: number, lang: Lang = 'ru'): VercelFeed {
  const L = { lang };
  const empty = (hint: [string, string], short: string): VercelFeed => ({
    auth: v && v.auth === 'bad' ? 'bad' : 'off',
    state: 'none',
    rows: [],
    short: tr(L, short),
    hint: [tr(L, hint[0]), tr(L, hint[1])],
  });
  if (!v || v.auth === 'off') return empty(['Vercel не подключён', VC_HINT], 'нет токена');
  if (v.auth === 'bad') return empty(['Vercel не принял токен', VC_HINT], 'токен не принят');
  if (!v.user) return empty(['Нет связи с Vercel', 'попробую снова через минуту'], 'нет связи');
  const d = v.deploys[0];
  const st = d ? VC_STATE[d.state] : 'off';
  return {
    auth: 'ok',
    state: st === 'off' ? 'none' : st,
    rows: v.deploys.slice(0, 3).map((x) => ({
      id: x.id,
      name: clip(x.project, 22),
      state: VC_STATE[x.state],
      ago: agoText(x.state === 'building' ? x.created : (x.done ?? x.created), now, lang),
    })),
    short: d
      ? tr(
          L,
          { building: 'деплой идёт', ready: 'деплой готов', error: 'деплой упал', canceled: 'деплой отменён' }[d.state],
        )
      : tr(L, 'нет деплоев'),
    hint: [tr(L, d ? '' : 'деплоев пока нет'), ''],
  };
}

/**
 * Not in the prototype (docs/CHANGES.md): a deployment turning ready or failed is the island's
 * success or error, on the Vercel card. The first read after start only seeds what was already so.
 */
export class VercelDriver {
  private v: VcState | null = null;
  private lastMin = -1;
  private lang: Lang = 'ru';
  /** deployment id -> last state; null until the first read */
  private seen: Map<string, VcDeploy['state']> | null = null;
  /** when the first read came: a project deployed for the first time after it still counts */
  private since = 0;
  private pending: { type: EventType; label: string } | null = null;
  constructor(
    private s: IslandState,
    private m: { trigger: (t: EventType) => void },
    private now: () => number,
  ) {
    s.vercel = vercelFeed(null, now());
  }

  onState(v: VcState): void {
    let hit: { type: EventType; label: string } | null = null;
    if (v.user) {
      const first = this.seen === null,
        seen = this.seen ?? new Map<string, VcDeploy['state']>();
      if (first) this.since = this.now();
      for (const d of v.deploys) {
        const was = seen.get(d.id);
        seen.set(d.id, d.state);
        if (first || was === d.state || (d.state !== 'ready' && d.state !== 'error')) continue;
        // a deployment we never saw building: only if it was made after we started watching
        if (was === undefined && d.created < this.since) continue;
        const type: EventType = d.state === 'ready' ? 'success' : 'error';
        if (!hit || type === 'error')
          hit = {
            type,
            label: tr(this.s, type === 'success' ? 'Деплой готов' : 'Деплой упал') + ' · ' + clip(d.project, 12),
          };
      }
      this.seen = seen;
    } else if (v.auth === 'off' || v.auth === 'bad') this.seen = null;
    this.v = v;
    this.lastMin = -1;
    if (hit) this.pending = hit;
    this.tick();
  }

  /** Per frame: the relative times, a waiting deploy event. */
  tick(): void {
    const now = this.now(),
      min = Math.floor(now / 60_000);
    if (min !== this.lastMin || this.s.lang !== this.lang) {
      this.lastMin = min;
      this.lang = this.s.lang;
      this.s.vercel = vercelFeed(this.v, now, this.lang);
    }
    const p = this.pending,
      ev = this.s.event;
    if (p && !(ev && PROMPTS.includes(ev.type))) {
      this.pending = null;
      this.m.trigger(p.type);
      if (this.s.event) {
        this.s.event.label = p.label;
        this.s.event.src = 'vercel';
      }
    }
  }
}

// ---------- notion ----------
/** `island://notion` (src-tauri/src/notion.rs). */
export interface NoPage {
  id: string;
  /** null = untitled */
  title: string | null;
  emoji: string | null;
  /** last edited, epoch ms */
  edited: number;
  kind: 'page' | 'database';
  /** who edited last (a Notion user id) */
  by: string | null;
}

export interface NoState {
  auth: 'off' | 'ok' | 'bad' | 'net';
  workspace: string | null;
  /** newest first */
  pages: NoPage[];
  people: { id: string; name: string }[];
  /** my user id; null = unknown, no edit events */
  me: string | null;
}

const NO_HINT = 'Настройки → Notion';

/** Not in the prototype (docs/CHANGES.md): the Notion card - the three pages edited last, as in coucou. */
export function notionFeed(n: NoState | null, now: number, lang: Lang = 'ru'): NotionFeed {
  const L = { lang };
  const empty = (hint: [string, string], short: string): NotionFeed => ({
    auth: n && n.auth === 'bad' ? 'bad' : 'off',
    rows: [],
    short: tr(L, short),
    hint: [tr(L, hint[0]), tr(L, hint[1])],
  });
  if (!n || n.auth === 'off') return empty(['Notion не подключён', NO_HINT], 'нет токена');
  if (n.auth === 'bad') return empty(['Notion не принял токен', NO_HINT], 'токен не принят');
  if (!n.workspace) return empty(['Нет связи с Notion', 'попробую снова через минуту'], 'нет связи');
  const title = (p: NoPage): string => p.title ?? tr(L, 'Без названия');
  const p = n.pages[0];
  return {
    auth: 'ok',
    rows: n.pages.slice(0, 3).map((x) => ({
      id: x.id,
      title: clip(title(x), 20),
      emoji: x.emoji,
      ago: agoText(x.edited, now, lang),
    })),
    short: p ? clip(title(p), 16) : tr(L, 'нет страниц'),
    hint: p ? ['', ''] : [tr(L, 'страниц пока нет'), tr(L, 'дайте интеграции доступ к странице')],
  };
}

/**
 * Not in the prototype (docs/CHANGES.md): keeps s.notion current; a page someone else edited
 * (not me, owner's pick 2026-10-18) is the island's success on the Notion card. My own edits,
 * the first read after start and an unknown "me" give no event.
 */
export class NotionDriver {
  private n: NoState | null = null;
  private lastMin = -1;
  private lang: Lang = 'ru';
  /** page id -> last edit time; null until the first read */
  private seen: Map<string, number> | null = null;
  private since = 0;
  private pending: string | null = null;
  constructor(
    private s: IslandState,
    private m: { trigger: (t: EventType) => void },
    private now: () => number,
  ) {
    s.notion = notionFeed(null, now());
  }

  onState(n: NoState): void {
    if (n.workspace) {
      const first = this.seen === null,
        seen = this.seen ?? new Map<string, number>();
      if (first) this.since = this.now();
      for (const p of n.pages) {
        const was = seen.get(p.id);
        seen.set(p.id, p.edited);
        if (first || !n.me || !p.by || p.by === n.me) continue;
        // a page newly in the list counts only when edited after we started watching
        if (was === undefined ? p.edited < this.since : p.edited <= was) continue;
        this.pending ??= tr(this.s, 'Правка') + ' · ' + clip(p.title ?? tr(this.s, 'Без названия'), 12);
      }
      this.seen = seen;
    } else if (n.auth === 'off' || n.auth === 'bad') this.seen = null;
    this.n = n;
    this.lastMin = -1;
    this.tick();
  }

  /** Per frame: the relative times, the language, a waiting edit event. */
  tick(): void {
    const now = this.now(),
      min = Math.floor(now / 60_000);
    if (min !== this.lastMin || this.s.lang !== this.lang) {
      this.lastMin = min;
      this.lang = this.s.lang;
      this.s.notion = notionFeed(this.n, now, this.lang);
    }
    const p = this.pending,
      ev = this.s.event;
    if (p && !(ev && PROMPTS.includes(ev.type))) {
      this.pending = null;
      this.m.trigger('success');
      if (this.s.event) {
        this.s.event.label = p;
        this.s.event.src = 'notion';
      }
    }
  }
}
