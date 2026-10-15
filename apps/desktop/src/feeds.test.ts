import { describe, expect, it } from 'vitest';
import { createMascot, defaultSettings } from '@almanac-notch/island';
import {
  CalDriver,
  GithubDriver,
  MediaDriver,
  artSeed,
  calFeed,
  commitDays,
  githubFeed,
  whenText,
  type Calendar,
  type GhRepo,
  type GhState,
} from './feeds';

const T0 = new Date(2026, 9, 14, 14, 30).getTime(); // local 14:30
const min = 60_000;
const ev = (title: string, from: number, len = 30) => ({ title, start: T0 + from * min, end: T0 + (from + len) * min });

describe('calendar feed', () => {
  it('no access and no calls say why, and never count minutes', () => {
    expect(calFeed(null, T0).mins).toBeNull();
    expect(calFeed({ access: 'denied', events: [] }, T0).title).toBe('Нет доступа к календарю');
    expect(calFeed({ access: 'ok', events: [] }, T0).title).toBe('Встреч нет');
  });
  it('picks the next call, rounds minutes up, names the one after', () => {
    const c: Calendar = { access: 'ok', events: [ev('Past', -90), ev('Sync', 14), ev('Lecture', 160)] };
    expect(calFeed(c, T0)).toEqual({ mins: 14, at: '14:44', title: 'Sync', after: 'дальше: Lecture в 17:10' });
    expect(calFeed(c, T0 + 30_000).mins).toBe(14);
  });
  it('a started call stays 10 minutes, then the next takes over', () => {
    const c: Calendar = { access: 'ok', events: [ev('Sync', -5, 60), ev('Lecture', 160)] };
    expect(calFeed(c, T0).mins).toBe(0);
    expect(calFeed(c, T0 + 6 * min).title).toBe('Lecture');
  });
  it('long titles are cut, other days are named', () => {
    const c: Calendar = { access: 'ok', events: [ev('A very long meeting title that goes on and on', 24 * 60)] };
    const f = calFeed(c, T0);
    expect(f.title.length).toBeLessThanOrEqual(30);
    expect(f.title.endsWith('…')).toBe(true);
    expect(f.at).toBe('завтра 14:30');
    expect(whenText(T0 + 3 * 24 * 60 * min, T0)).toBe('сб 14:30');
  });
  it('the driver recomputes once a minute', () => {
    const m = createMascot({ settings: defaultSettings(), now: 0, greetAfter: null });
    let now = T0;
    const d = new CalDriver(m.state, () => now);
    d.onCalendar({ access: 'ok', events: [ev('Sync', 14)] });
    expect(m.state.cal?.mins).toBe(14);
    now += 5 * min;
    d.tick();
    expect(m.state.cal?.mins).toBe(9);
  });
});

describe('media driver', () => {
  function make() {
    const m = createMascot({ settings: defaultSettings(), now: 0, greetAfter: null });
    const sent: string[] = [],
      vols: number[] = [];
    let now = 1_000_000;
    const d = new MediaDriver(m.state, {
      send: (c) => sent.push(c),
      setVolume: (v) => vols.push(v),
      decode: (b64) => Promise.resolve({ width: 1, height: 1, b64 } as unknown as CanvasImageSource),
      now: () => now,
    });
    return { s: m.state, d, sent, vols, step: (ms: number) => (now += ms), now: () => now };
  }
  it('starts empty, then shows the track and runs its clock', () => {
    const { s, d, step, now } = make();
    expect(s.media?.idle).toBe(true);
    expect(s.musicPlaying).toBe(false);
    d.onMessage({
      title: 'Song',
      artist: 'Artist',
      album: '',
      app: 'Zen',
      duration: 200,
      elapsed: 10,
      ts: now(),
      rate: 1,
      playing: true,
    });
    expect(s.media).toMatchObject({ idle: false, title: 'Song', sub: 'Artist · Zen', len: 200 });
    expect(s.media?.artSeed).toBe(artSeed('Song'));
    step(5000);
    d.tick();
    expect(s.musicPos).toBeCloseTo(15);
    step(500_000);
    d.tick();
    expect(s.musicPos).toBe(200);
    // a blink of "nothing" between tracks does not empty the card; a longer silence does
    d.onMessage({ none: true });
    step(1000);
    d.tick();
    expect(s.media?.idle).toBe(false);
    step(1000);
    d.tick();
    expect(s.media?.idle).toBe(true);
    expect(s.musicPlaying).toBe(false);
  });
  it('sends island commands, maps shuffle and repeat, freezes the clock on pause', () => {
    const { s, d, sent, vols, step, now } = make();
    d.onMessage({ title: 'Song', duration: 200, elapsed: 10, ts: now(), rate: 1, playing: true });
    s.musicPlaying = false;
    s.media?.out.push('toggle', 'shuffle 1', 'repeat 0', 'vol 0.300', 'seek 50.0');
    d.tick();
    expect(sent).toEqual(['toggle', 'shuffle 3', 'repeat 1', 'seek 50.0']);
    expect(vols).toEqual([0.3]);
    step(3000);
    d.tick();
    expect(s.musicPos).toBe(50);
  });
  it('a track change shows the loading tile, never a stale or blinking generated cover', async () => {
    const { s, d, step, now } = make();
    const msg = (title: string, artId: number, art?: string) =>
      d.onMessage({
        title,
        duration: 200,
        elapsed: 0,
        ts: now(),
        playing: true,
        artId,
        ...(art !== undefined ? { art } : {}),
      });
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const shown = () => (s.media?.art as unknown as { b64: string } | null)?.b64 ?? null;
    msg('A', 1, 'aaa');
    expect(s.media?.artPending).toBe(true);
    await flush();
    expect(shown()).toBe('aaa');
    expect(s.media?.artPending).toBe(false);
    expect(s.media?.artA).toBe(0);
    step(100);
    d.tick();
    expect(s.media?.artA).toBeGreaterThan(0);
    step(200);
    d.tick();
    expect(s.media?.artA).toBe(1);
    // the same track loses its cover for an update: keep it
    msg('A', 0, '');
    expect(shown()).toBe('aaa');
    // next track: title first, cover later -> loading tile, then the cover
    msg('B', 0, '');
    expect(s.media?.art).toBeNull();
    expect(s.media?.artPending).toBe(true);
    step(1000);
    d.tick();
    expect(s.media?.artPending).toBe(true);
    msg('B', 2, 'bbb');
    await flush();
    expect(shown()).toBe('bbb');
    // a track without any cover: the generated one after the wait
    msg('C', 0, '');
    step(2600);
    d.tick();
    expect(s.media?.artPending).toBe(false);
    expect(s.media?.art).toBeNull();
  });
  it("no cover: the player's icon after the wait, kept across tracks until a real cover comes", async () => {
    const { s, d, step, now } = make();
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const shown = () => (s.media?.art as unknown as { b64: string } | null)?.b64 ?? null;
    d.onMessage({ title: 'Video', duration: 600, ts: now(), playing: true, artId: 0, icon: 'iVBORzen' });
    await flush();
    expect(s.media?.artPending).toBe(true);
    expect(shown()).toBeNull();
    step(2600);
    d.tick();
    expect(shown()).toBe('iVBORzen');
    d.onMessage({ title: 'Next video', duration: 600, ts: now(), playing: true, artId: 0 });
    expect(shown()).toBe('iVBORzen');
    expect(s.media?.artPending).toBe(false);
    d.onMessage({ title: 'Next video', duration: 600, ts: now(), playing: true, artId: 7, art: 'thumb' });
    await flush();
    expect(shown()).toBe('thumb');
  });
});

describe('github feed', () => {
  const repo = (o: Partial<GhRepo> = {}): GhRepo => ({
    name: 'almanac-notch',
    state: 'ok',
    at: T0 - 60 * min,
    done: 5,
    total: 5,
    failed: null,
    ...o,
  });
  const gh = (o: Partial<GhState> = {}): GhState => ({
    auth: 'ok',
    login: 'sora',
    repos: [repo()],
    repo_count: 4,
    prs: 2,
    commits: [],
    ...o,
  });
  it('no token or a refused one: a hint, no numbers', () => {
    const off = githubFeed({ ...gh(), auth: 'off', login: null }, T0);
    expect(off.auth).toBe('off');
    expect(off.hint[1]).toBe('Настройки → GitHub');
    expect(off.row).toBe('GitHub · не подключён');
    expect(githubFeed({ ...gh(), auth: 'bad', login: null }, T0).auth).toBe('bad');
    expect(githubFeed(null, T0).auth).toBe('off');
  });
  it('shows the newest repository, PR count with the right verb', () => {
    const f = githubFeed(gh({ repos: [repo({ name: 'old', at: 1 }), repo({ state: 'run', done: 2, total: 5 })] }), T0);
    expect(f.ci).toBe('run');
    expect(f.ciText).toBe('almanac-notch · CI идёт · 2 из 5');
    expect(f.short).toBe('CI идёт');
    expect(githubFeed(gh({ prs: 1 }), T0).prText).toBe('1 PR ждёт ревью');
    expect(f.prText).toBe('2 PR ждут ревью');
    expect(githubFeed(gh({ prs: 0 }), T0).prText).toBe('ревью не ждут');
  });
  it('a failure names the failed check; text stays short', () => {
    const f = githubFeed(gh({ repos: [repo({ state: 'fail', failed: 'build-and-deploy-production' })] }), T0);
    expect(f.ci).toBe('fail');
    expect(f.ciText.length).toBeLessThanOrEqual(34);
    expect(f.ciText.startsWith('almanac-notch · упал на build')).toBe(true);
  });
  it('commits fall into the last seven days, today last', () => {
    const day = 24 * 60 * min;
    expect(commitDays([T0, T0 - 60_000, T0 - day, T0 - 6 * day, T0 - 7 * day], T0)).toEqual([1, 0, 0, 0, 0, 1, 2]);
  });
  it('no repository with checks: says so, still shows PRs', () => {
    const f = githubFeed(gh({ repos: [] }), T0);
    expect(f.ci).toBe('none');
    expect(f.auth).toBe('ok');
    expect(f.ciText).toBe('CI не настроен · 4 репо');
  });
  it('driver: no event on the first read, an event on a change to ok or fail', () => {
    const m = createMascot({ settings: defaultSettings(), now: 0, greetAfter: null });
    const d = new GithubDriver(m.state, { trigger: (t) => m.trigger(t) }, () => T0);
    d.onState(gh({ repos: [repo({ state: 'run' })] }));
    expect(m.state.event).toBeNull();
    d.onState(gh({ repos: [repo({ state: 'ok' })] }));
    expect(m.state.event?.type).toBe('success');
    expect(m.state.event?.label).toBe('CI прошёл · almanac-n…');
    expect(m.state.event?.src).toBeUndefined();
    d.onState(gh({ repos: [repo({ state: 'fail' })] }));
    expect(m.state.event?.type).toBe('error');
    expect(m.state.github?.ci).toBe('fail');
  });
  it('driver: a new repository or a start of a run is not an event; a prompt holds the result back', () => {
    const m = createMascot({ settings: defaultSettings(), now: 0, greetAfter: null });
    const d = new GithubDriver(m.state, { trigger: (t) => m.trigger(t) }, () => T0);
    d.onState(gh({ repos: [] }));
    d.onState(gh({ repos: [repo({ state: 'fail' })] }));
    expect(m.state.event).toBeNull();
    d.onState(gh({ repos: [repo({ state: 'run' })] }));
    expect(m.state.event).toBeNull();
    m.trigger('attention');
    d.onState(gh({ repos: [repo({ state: 'ok' })] }));
    expect(m.state.event?.type).toBe('attention');
    m.state.event = null;
    d.tick();
    expect((m.state.event as { type: string } | null)?.type).toBe('success');
  });
});
