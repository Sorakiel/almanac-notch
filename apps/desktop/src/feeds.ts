// Calendar and now-playing -> s.cal and s.media (stage 5). Rust sends the raw data
// (`island://calendar`, `island://media`, `island://volume`); these drivers pick the next call,
// keep the player clock running between updates and send the island's player buttons back.
// Pure logic over the island state, so it runs in vitest without Tauri.
import type { CalFeed, IslandState, MediaFeed } from '@almanac-notch/island';
import { clip } from './agent';

export interface CalEvent {
  title: string;
  /** epoch ms */
  start: number;
  end: number;
}

export interface Calendar {
  access: 'ok' | 'denied' | 'unknown' | 'off';
  events: CalEvent[];
}

/** A call that started this long ago is still the "current" one; then the next takes over. */
const STARTED_MS = 10 * 60 * 1000;
/** Meeting titles share the card line with nothing; longer ones squeeze unreadably. */
const TITLE_MAX = 30;
const AFTER_MAX = 34;

const hhmm = (t: number): string => {
  const d = new Date(t);
  return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
};

/** "15:00", "завтра 10:00", "пт 10:00" */
export function whenText(t: number, now: number): string {
  const day = (x: number): number => {
    const d = new Date(x);
    return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);
  };
  const diff = day(t) - day(now);
  if (diff === 0) return hhmm(t);
  if (diff === 1) return 'завтра ' + hhmm(t);
  return ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][new Date(t).getDay()] + ' ' + hhmm(t);
}

/** proto: calMins + the card's three lines, from the system calendar. */
export function calFeed(cal: Calendar | null, now: number): CalFeed {
  if (!cal || cal.access === 'off')
    return { mins: null, at: '', title: 'Календарь недоступен', after: 'на этой системе' };
  if (cal.access !== 'ok')
    return { mins: null, at: '', title: 'Нет доступа к календарю', after: 'меню острова → Доступ к календарю' };
  const ahead = cal.events.filter((e) => e.end > now && e.start > now - STARTED_MS);
  const next = ahead[0];
  if (!next) return { mins: null, at: '', title: 'Встреч нет', after: 'ни сегодня, ни завтра' };
  const after = ahead.find((e) => e.start >= next.end) ?? ahead[1];
  return {
    mins: Math.max(0, Math.ceil((next.start - now) / 60_000)),
    at: whenText(next.start, now),
    title: clip(next.title || 'Без названия', TITLE_MAX),
    after: after
      ? clip('дальше: ' + (after.title || 'встреча'), AFTER_MAX - 6) + ' в ' + whenText(after.start, now)
      : '',
  };
}

export class CalDriver {
  private cal: Calendar | null = null;
  private lastMin = -1;
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
    if (min === this.lastMin) return;
    this.lastMin = min;
    this.s.cal = calFeed(this.cal, now);
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
