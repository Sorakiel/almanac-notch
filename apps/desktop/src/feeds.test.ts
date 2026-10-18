import { describe, expect, it } from 'vitest';
import { createMascot, defaultSettings } from '@almanac-notch/island';
import {
  CalDriver,
  GithubDriver,
  GrafanaDriver,
  MediaDriver,
  NotionDriver,
  VercelDriver,
  agoText,
  artSeed,
  calFeed,
  commitDays,
  githubFeed,
  grafanaFeed,
  unitText,
  notionFeed,
  whenText,
  type Calendar,
  type GhRepo,
  type GhState,
  type GfAlert,
  type GfState,
  type NoPage,
  type NoState,
  type VcDeploy,
  type VcState,
} from './feeds';
import { vercelFeed } from './feeds';
import { AlmanacDriver, almanacFeed, dayKey, leftText, tapHabit, type AlHabit, type AlState } from './feeds';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '@almanac-notch/island';

const T0 = new Date(2026, 9, 14, 14, 30).getTime(); // local 14:30
const min = 60_000;
const ev = (title: string, from: number, len = 30) => ({ title, start: T0 + from * min, end: T0 + (from + len) * min });

describe('calendar feed', () => {
  it('no access and no calls say why, and never count minutes', () => {
    expect(calFeed(null, T0).mins).toBeNull();
    expect(calFeed({ access: 'denied', events: [] }, T0).title).toBe('Нет доступа к календарю');
    expect(calFeed({ access: 'ok', events: [] }, T0).title).toBe('Встреч нет');
  });
  it('names the Windows source that failed', () => {
    const t = (c: Calendar): string => calFeed(c, T0).title + ' / ' + calFeed(c, T0).after;
    expect(t({ access: 'off', source: 'none', events: [] })).toBe('Календарь не подключён / Настройки → Календарь');
    expect(t({ access: 'denied', source: 'outlook', events: [] })).toBe('Outlook не найден / Настройки → Календарь');
    expect(t({ access: 'denied', source: 'ical', events: [] })).toBe('Ссылка не открывается / Настройки → Календарь');
    expect(t({ access: 'unknown', source: 'ical', events: [] })).toBe('Календарь не отвечает / попробую ещё раз позже');
    expect(t({ access: 'denied', source: 'system', events: [] })).toBe(
      'Нет доступа к календарю / меню острова → Доступ к календарю',
    );
    expect(t({ access: 'off', events: [] })).toBe('Календарь недоступен / на этой системе');
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
    branch: 'main',
    state: 'ok',
    at: T0 - 60 * min,
    pushed: T0 - 60 * min,
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
    expect(githubFeed({ ...gh(), auth: 'bad', login: null }, T0).auth).toBe('bad');
    expect(githubFeed(null, T0).auth).toBe('off');
  });
  it('shows the newest repository, PR count with the right verb', () => {
    const f = githubFeed(gh({ repos: [repo({ name: 'old', at: 1 }), repo({ state: 'run', done: 2, total: 5 })] }), T0);
    expect(f.ci).toBe('run');
    expect(f.ciText).toBe('almanac-not… · идёт 2/5');
    expect(f.short).toBe('CI идёт');
    expect(githubFeed(gh({ prs: 1 }), T0).prText).toBe('1 PR ждёт ревью');
    expect(f.prText).toBe('2 PR ждут ревью');
    expect(githubFeed(gh({ prs: 0 }), T0).prText).toBe('ревью не ждут');
  });
  it('a failure names the failed check; text stays short', () => {
    const f = githubFeed(gh({ repos: [repo({ state: 'fail', failed: 'build-and-deploy-production' })] }), T0);
    expect(f.ci).toBe('fail');
    expect(f.ciText.length).toBeLessThanOrEqual(24);
    expect(f.ciText).toBe('almanac-… · упал: build…');
  });
  it('commits fall into the last seven days, today last', () => {
    const day = 24 * 60 * min;
    expect(commitDays([T0, T0 - 60_000, T0 - day, T0 - 6 * day, T0 - 7 * day], T0)).toEqual([1, 0, 0, 0, 0, 1, 2]);
  });
  it('the card names the repository only; each branch is its own CI', () => {
    const f = githubFeed(gh({ repos: [repo({ branch: 'feat-x' })] }), T0);
    expect(f.ciText).toBe('almanac-notch · зелёный');
    const m = createMascot({ settings: defaultSettings(), now: 0, greetAfter: null });
    const d = new GithubDriver(m.state, { trigger: (t) => m.trigger(t) }, () => T0);
    d.onState(gh({ repos: [repo({ state: 'run' })] }));
    d.onState(gh({ repos: [repo({ state: 'run' }), repo({ branch: 'feat-x', state: 'ok' })] }));
    expect(m.state.event).toBeNull();
    d.onState(gh({ repos: [repo({ state: 'run' }), repo({ branch: 'feat-x', state: 'fail' })] }));
    expect(m.state.event?.type).toBe('error');
  });
  it('no repository with checks: says so, still shows PRs', () => {
    const f = githubFeed(gh({ repos: [] }), T0);
    expect(f.ci).toBe('none');
    expect(f.auth).toBe('ok');
    expect(f.ciText).toBe('CI не настроен');
  });
  it('driver: no event on the first read, an event on a change to ok or fail', () => {
    const m = createMascot({ settings: defaultSettings(), now: 0, greetAfter: null });
    const d = new GithubDriver(m.state, { trigger: (t) => m.trigger(t) }, () => T0);
    d.onState(gh({ repos: [repo({ state: 'run' })] }));
    expect(m.state.event).toBeNull();
    d.onState(gh({ repos: [repo({ state: 'ok' })] }));
    expect(m.state.event?.type).toBe('success');
    expect(m.state.event?.label).toBe('CI прошёл · almanac-not…');
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

describe('feeds in English', () => {
  it('calendar and GitHub texts follow the language', async () => {
    const { calFeed, githubFeed, whenText } = await import('./feeds');
    const now = new Date(2026, 9, 19, 12, 0).getTime();
    expect(whenText(now + 86_400_000, now, 'en')).toBe('tomorrow 12:00');
    expect(whenText(now + 3 * 86_400_000, now, 'en')).toBe('Thu 12:00');
    expect(calFeed(null, now, 'en').title).toBe('Calendar unavailable');
    expect(githubFeed(null, now, 'en').hint).toEqual(['GitHub not connected', 'Settings → GitHub']);
    expect(githubFeed(null, now).hint).toEqual(['GitHub не подключён', 'Настройки → GitHub']);
  });
});

describe('vercel feed', () => {
  const dep = (o: Partial<VcDeploy> = {}): VcDeploy => ({
    id: 'dpl_1',
    project: 'almanac-site',
    state: 'ready',
    created: T0 - 10 * min,
    done: T0 - 8 * min,
    target: 'production',
    branch: 'main',
    ...o,
  });
  const vc = (deploys: VcDeploy[], o: Partial<VcState> = {}): VcState => ({ auth: 'ok', user: 'sora', deploys, ...o });
  const mascot = () => createMascot({ settings: defaultSettings(), now: 0, greetAfter: null });

  it('no token, a refused one, no answer: say why and where to connect', () => {
    expect(vercelFeed(null, T0).hint).toEqual(['Vercel не подключён', 'Настройки → Vercel']);
    expect(vercelFeed(vc([], { auth: 'bad', user: null }), T0).auth).toBe('bad');
    expect(vercelFeed(vc([], { auth: 'net', user: null }), T0).hint[0]).toBe('Нет связи с Vercel');
    expect(vercelFeed(vc([]), T0)).toMatchObject({ short: 'нет деплоев', hint: ['деплоев пока нет', ''], rows: [] });
  });
  it('the three newest deployments: dot, project, compact age', () => {
    const f = vercelFeed(
      vc([
        dep({ id: 'a', state: 'building', created: T0 - 2 * min, done: null }),
        dep({ id: 'b', done: T0 - 2 * 3600_000 }),
        dep({ id: 'c', project: 'carcosa-guide', state: 'error', done: T0 - 6 * 86_400_000 }),
        dep({ id: 'd' }),
      ]),
      T0,
    );
    expect(f.state).toBe('run');
    expect(f.short).toBe('деплой идёт');
    expect(f.rows.map((r) => [r.name, r.state, r.ago])).toEqual([
      ['almanac-site', 'run', '2 мин'],
      ['almanac-site', 'ok', '2 ч'],
      ['carcosa-guide', 'fail', '6 дн'],
    ]);
    expect(vercelFeed(vc([dep()]), T0, 'en').rows[0]?.ago).toBe('8 min');
    expect(agoText(T0, T0, 'en')).toBe('now');
    expect(agoText(T0 - 3 * 86_400_000, T0, 'en')).toBe('3 d');
  });
  it('driver: no event on the first read; building to ready or error is one, on the Vercel card', () => {
    const m = mascot();
    const d = new VercelDriver(m.state, { trigger: (t) => m.trigger(t) }, () => T0);
    d.onState(vc([dep({ state: 'error' })]));
    expect(m.state.event).toBeNull();
    d.onState(vc([dep({ id: 'dpl_2', state: 'building', created: T0, done: null })]));
    expect(m.state.event).toBeNull();
    d.onState(vc([dep({ id: 'dpl_2', state: 'ready', created: T0, done: T0 })]));
    expect(m.state.event?.type).toBe('success');
    expect(m.state.event?.src).toBe('vercel');
    expect(m.state.event?.label).toBe('Деплой готов · almanac-site');
    m.state.event = null;
    // built entirely between two reads: still an event, since it was made after the first read
    d.onState(vc([dep({ id: 'dpl_3', state: 'error', created: T0 + min })]));
    expect((m.state.event as { type: string } | null)?.type).toBe('error');
  });
  it('driver: an old deployment seen for the first time, or canceled, is not an event', () => {
    const m = mascot();
    const d = new VercelDriver(m.state, { trigger: (t) => m.trigger(t) }, () => T0);
    d.onState(vc([]));
    d.onState(vc([dep({ id: 'old', created: T0 - 60 * min })]));
    d.onState(vc([dep({ id: 'x', state: 'canceled', created: T0 + min })]));
    expect(m.state.event).toBeNull();
  });
  it('every Russian string of feeds.ts has an English line', () => {
    const code = readFileSync(join(__dirname, 'feeds.ts'), 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    const missing = [...code.matchAll(/'([^'\n]*[А-Яа-яЁё][^'\n]*)'/g)]
      .map((x) => x[1] as string)
      .filter((x) => !(x in EN) && !/^(вс|пн|вт|ср|чт|пт|сб)$/.test(x));
    expect(missing).toEqual([]);
  });
});

describe('notion feed', () => {
  const page = (o: Partial<NoPage> = {}): NoPage => ({
    id: 'p1',
    title: 'План релиза',
    emoji: '📝',
    edited: T0 - 5 * min,
    kind: 'page',
    by: 'u-other',
    ...o,
  });
  const no = (pages: NoPage[], o: Partial<NoState> = {}): NoState => ({
    auth: 'ok',
    workspace: 'Sora',
    pages,
    people: [],
    me: 'u-me',
    ...o,
  });
  const mascot = () => createMascot({ settings: defaultSettings(), now: 0, greetAfter: null });

  it('no token, a refused one, no answer, nothing shared: say why', () => {
    expect(notionFeed(null, T0).hint).toEqual(['Notion не подключён', 'Настройки → Notion']);
    expect(notionFeed(null, T0, 'en').hint).toEqual(['Notion not connected', 'Settings → Notion']);
    expect(notionFeed(no([], { auth: 'bad', workspace: null }), T0).auth).toBe('bad');
    expect(notionFeed(no([], { auth: 'net', workspace: null }), T0).hint[0]).toBe('Нет связи с Notion');
    expect(notionFeed(no([]), T0)).toMatchObject({
      short: 'нет страниц',
      hint: ['страниц пока нет', 'дайте интеграции доступ к странице'],
      rows: [],
    });
  });
  it('the three pages edited last: icon, title, compact age; untitled is named', () => {
    const f = notionFeed(
      no([
        page(),
        page({ id: 'p2', title: null, emoji: null, edited: T0 - 2 * 3600_000 }),
        page({ id: 'p3', title: 'Заметки со встречи с дизайнером', edited: T0 - 3 * 86_400_000 }),
        page({ id: 'p4' }),
      ]),
      T0,
    );
    expect(f.short).toBe('План релиза');
    expect(f.rows.map((r) => [r.emoji, r.title, r.ago])).toEqual([
      ['📝', 'План релиза', '5 мин'],
      [null, 'Без названия', '2 ч'],
      ['📝', 'Заметки со встречи…', '3 дн'],
    ]);
    expect(notionFeed(no([page({ title: null })]), T0, 'en').rows[0]?.title).toBe('Untitled');
  });
  it('driver: an edit by someone else is a success on the Notion card; mine, the first read and an unknown me are not', () => {
    const m = mascot();
    const d = new NotionDriver(m.state, { trigger: (t) => m.trigger(t) }, () => T0);
    d.onState(no([page()]));
    expect(m.state.event).toBeNull();
    // my own edit
    d.onState(no([page({ edited: T0, by: 'u-me' })]));
    expect(m.state.event).toBeNull();
    // the same time again: nothing new
    d.onState(no([page({ edited: T0, by: 'u-other' })]));
    expect(m.state.event).toBeNull();
    d.onState(no([page({ edited: T0 + min })]));
    expect(m.state.event?.type).toBe('success');
    expect(m.state.event?.src).toBe('notion');
    expect(m.state.event?.label).toBe('Правка · План релиза');
    m.state.event = null;
    // nobody picked as "me": no events
    d.onState(no([page({ edited: T0 + 2 * min })], { me: null }));
    // an old page newly shared: not an event
    d.onState(no([page({ id: 'old', edited: T0 - 60 * min })]));
    expect(m.state.event).toBeNull();
  });
});

describe('grafana feed', () => {
  const al = (o: Partial<GfAlert> = {}): GfAlert => ({
    id: 'r-cpu',
    name: 'CPU > 90%',
    state: 'firing',
    since: T0 - 12 * min,
    ...o,
  });
  const gf = (alerts: GfAlert[], o: Partial<GfState> = {}): GfState => ({
    auth: 'ok',
    org: 'Main Org.',
    rules: 12,
    alerts,
    board: null,
    ...o,
  });
  const mascot = () => createMascot({ settings: defaultSettings(), now: 0, greetAfter: null });

  it('no address or token, a refused one, no answer, no rules, all calm: say so', () => {
    expect(grafanaFeed(null, T0).hint).toEqual(['Grafana не подключена', 'Настройки → Grafana']);
    expect(grafanaFeed(null, T0, 'en').hint).toEqual(['Grafana not connected', 'Settings → Grafana']);
    expect(grafanaFeed(gf([], { auth: 'bad', org: null }), T0).auth).toBe('bad');
    expect(grafanaFeed(gf([], { auth: 'net', org: null }), T0).hint[0]).toBe('Нет связи с Grafana');
    expect(grafanaFeed(gf([], { rules: 0 }), T0)).toMatchObject({ state: 'none', short: 'нет правил', rows: [] });
    expect(grafanaFeed(gf([]), T0)).toMatchObject({
      state: 'ok',
      short: 'спокойно',
      hint: ['Всё спокойно', 'правил: 12'],
    });
  });
  it('firing rows first, red; pending amber; at most three, the total kept', () => {
    const f = grafanaFeed(
      gf([
        al(),
        al({ id: 'r-5xx', name: 'Ошибки 5xx на шлюзе платежей', since: T0 - 3 * min }),
        al({ id: 'r-disk', name: 'Disk', state: 'pending', since: null }),
        al({ id: 'r-mem', name: 'Mem', state: 'pending' }),
      ]),
      T0,
    );
    expect(f.state).toBe('fail');
    expect(f.short).toBe('горит 2');
    expect(f.total).toBe(4);
    expect(f.rows.map((r) => [r.name, r.state, r.ago])).toEqual([
      ['CPU > 90%', 'fail', '12 мин'],
      ['Ошибки 5xx на ш…', 'fail', '3 мин'],
      ['Disk', 'run', ''],
    ]);
    expect(grafanaFeed(gf([al({ state: 'pending' })]), T0, 'en')).toMatchObject({ state: 'run', short: '1 pending' });
  });
  it('the picked dashboard: title with the panel, last value in its unit, no data said so', () => {
    const board = { uid: 'd', title: 'API', panel: 'RPS', unit: 'reqps', points: [800, 1234], firing: 1 };
    expect(grafanaFeed(gf([], { board }), T0).board).toEqual({
      title: 'API · RPS',
      value: '1.23k req/s',
      points: [800, 1234],
      firing: 1,
    });
    expect(grafanaFeed(gf([], { board: { ...board, points: [] } }), T0, 'en').board?.value).toBe('no data');
    expect(unitText(73.456, 'percent')).toBe('73.5%');
    expect(unitText(0.5, 'percentunit')).toBe('50%');
    expect(unitText(3 * 1024 ** 3, 'bytes')).toBe('3 GB');
    expect(unitText(1500, 'ms', 'en')).toBe('1.5 s');
    expect(unitText(0.12, 's')).toBe('120 мс');
    expect(unitText(4_200_000, null)).toBe('4.2M');
    expect(unitText(0.0421, null)).toBe('0.042');
    expect(unitText(-12, null)).toBe('-12');
  });
  it('driver: no event on the first read; a rule starting to fire is an error, resolving a success', () => {
    const m = mascot();
    const d = new GrafanaDriver(m.state, { trigger: (t) => m.trigger(t) }, () => T0);
    d.onState(gf([al()]));
    expect(m.state.event).toBeNull();
    // pending alone is no event
    d.onState(gf([al(), al({ id: 'r-disk', name: 'Disk', state: 'pending' })]));
    expect(m.state.event).toBeNull();
    d.onState(gf([al(), al({ id: 'r-disk', name: 'Disk' })]));
    expect(m.state.event?.type).toBe('error');
    expect(m.state.event?.src).toBe('grafana');
    expect(m.state.event?.label).toBe('Алерт · Disk');
    m.state.event = null;
    d.onState(gf([al({ id: 'r-disk', name: 'Disk' })]));
    expect((m.state.event as { type: string; label?: string } | null)?.label).toBe('Прошло · CPU > 90%');
    m.state.event = null;
    // no answer keeps what was firing: nothing resolved
    d.onState(gf([], { auth: 'net', org: null }));
    d.onState(gf([al({ id: 'r-disk', name: 'Disk' })]));
    expect(m.state.event).toBeNull();
  });
});

describe('almanac', () => {
  // 2026-10-18 14:00 local
  const T0 = new Date(2026, 9, 18, 14, 0).getTime();
  const DAY = dayKey(T0);
  const hb = (o: Partial<AlHabit> = {}): AlHabit => ({
    id: 'h1',
    name: 'Зарядка',
    icon: null,
    count: 0,
    goal: 1,
    done: false,
    ...o,
  });
  const al = (habits: AlHabit[], o: Partial<AlState> = {}): AlState => ({
    auth: 'ok',
    email: 'me@example.com',
    date: DAY,
    done: habits.filter((h) => h.done).length,
    total: habits.length,
    habits,
    ...o,
  });
  const mascot = () => createMascot({ settings: defaultSettings(), now: 0, greetAfter: null });
  const memo = () => {
    let day: string | null = null;
    return { get: () => day, set: (d: string) => (day = d) };
  };

  it('feed: hints without a sign-in, the day as the card shows it', () => {
    expect(almanacFeed(null).hint).toEqual(['Almanac не подключён', 'Настройки → Almanac']);
    expect(almanacFeed(null, 'en').hint).toEqual(['Almanac not connected', 'Settings → Almanac']);
    expect(almanacFeed(al([], { auth: 'bad' })).auth).toBe('bad');
    expect(almanacFeed(al([], { auth: 'net', date: null })).hint[0]).toBe('Нет связи с Almanac');
    expect(almanacFeed(al([])).hint[0]).toBe('На сегодня привычек нет');
    const f = almanacFeed(
      al([
        hb({ id: 'w', name: 'Вода', count: 3, goal: 8 }),
        hb(),
        hb({ id: 'b', name: 'Книга', done: true, count: 1 }),
      ]),
    );
    expect(f.short).toBe('привычки 1 из 3');
    expect(f.rows.map((r) => [r.name, r.done, r.progress])).toEqual([
      ['Вода', false, '3/8'],
      ['Зарядка', false, ''],
      ['Книга', true, ''],
    ]);
  });

  it('tap: a done habit clears, an open one gets one more', () => {
    const a = al([hb({ id: 'w', count: 7, goal: 8 }), hb({ done: true, count: 1 })]);
    const t1 = tapHabit(a, 'w');
    expect(t1?.habits[0]).toMatchObject({ count: 8, done: true });
    expect(t1?.done).toBe(2);
    const t2 = tapHabit(a, 'h1');
    expect(t2?.habits[1]).toMatchObject({ count: 0, done: false });
    expect(t2?.done).toBe(0);
    expect(tapHabit(a, 'nope')).toBeNull();
  });

  it('left text: Russian forms, English plural', () => {
    expect([1, 2, 5, 11, 21, 22].map((n) => leftText(n))).toEqual([
      'Осталась 1 привычка',
      'Осталось 2 привычки',
      'Осталось 5 привычек',
      'Осталось 11 привычек',
      'Осталась 21 привычка',
      'Осталось 22 привычки',
    ]);
    expect(leftText(1, 'en')).toBe('1 habit left');
    expect(leftText(3, 'en')).toBe('3 habits left');
  });

  it('driver: a tap ticks at once, sends it, and the day stays ticked while the answer is on its way', async () => {
    const m = mascot();
    const sent: string[] = [];
    let answer: () => void = () => undefined;
    const d = new AlmanacDriver(
      m.state,
      { trigger: (t) => m.trigger(t) },
      () => T0,
      (id) => {
        sent.push(id);
        return new Promise<void>((r) => (answer = r));
      },
      memo(),
    );
    d.onState(al([hb(), hb({ id: 'h2', name: 'Книга' })]));
    d.tap('h1');
    expect(sent).toEqual(['h1']);
    expect(m.state.almanac?.done).toBe(1);
    expect(m.state.happyUntil).toBeGreaterThan(m.state.t);
    // a minute's read from before the tap must not untick it
    d.onState(al([hb(), hb({ id: 'h2', name: 'Книга' })]));
    expect(m.state.almanac?.rows[0]?.done).toBe(true);
    // my own tick is no "marked elsewhere" event
    d.onState(al([hb({ done: true, count: 1 }), hb({ id: 'h2', name: 'Книга' })]));
    answer();
    await Promise.resolve();
    d.tick();
    expect(m.state.event).toBeNull();
    // the day's last one: the celebration at once, on the Almanac card
    d.tap('h2');
    expect(m.state.event?.type).toBe('dance');
    expect(m.state.event?.src).toBe('almanac');
    expect(m.state.event?.label).toBe('Все привычки выполнены');
  });

  it('driver: marked elsewhere is a success, the last one elsewhere the celebration; not on the first read', () => {
    const m = mascot();
    const d = new AlmanacDriver(
      m.state,
      { trigger: (t) => m.trigger(t) },
      () => T0,
      async () => undefined,
      memo(),
    );
    d.onState(al([hb({ done: true, count: 1 }), hb({ id: 'h2', name: 'Книга' }), hb({ id: 'h3', name: 'Вода' })]));
    d.tick();
    expect(m.state.event).toBeNull();
    d.onState(
      al([hb({ done: true, count: 1 }), hb({ id: 'h2', name: 'Книга', done: true }), hb({ id: 'h3', name: 'Вода' })]),
    );
    d.tick();
    expect(m.state.event?.type).toBe('success');
    expect(m.state.event?.src).toBe('almanac');
    expect(m.state.event?.label).toBe('Отмечено · Книга');
    m.state.event = null;
    d.onState(al([hb({ done: true }), hb({ id: 'h2', done: true }), hb({ id: 'h3', name: 'Вода', done: true })]));
    d.tick();
    expect((m.state.event as { type: string } | null)?.type).toBe('dance');
    m.state.event = null;
    // a new day starts quietly
    d.onState(al([hb()], { date: '2026-10-19' }));
    d.onState(al([hb({ done: true })], { date: '2026-10-19' }));
    d.tick();
    expect((m.state.event as { type: string } | null)?.type).toBe('dance');
  });

  it('driver: the evening reminder once a day, only with habits left', () => {
    const m = mascot();
    let now = T0;
    const mem = memo();
    const d = new AlmanacDriver(
      m.state,
      { trigger: (t) => m.trigger(t) },
      () => now,
      async () => undefined,
      mem,
    );
    d.onState(al([hb(), hb({ id: 'h2', done: true })]));
    d.tick();
    expect(m.state.event).toBeNull();
    now = new Date(2026, 9, 18, 20, 5).getTime();
    d.tick();
    expect(m.state.event?.type).toBe('nudge');
    expect(m.state.event?.label).toBe('Осталась 1 привычка');
    m.state.event = null;
    d.tick();
    expect(m.state.event).toBeNull();
    // all done: no reminder on another evening either
    const m2 = mascot();
    const d2 = new AlmanacDriver(
      m2.state,
      { trigger: (t) => m2.trigger(t) },
      () => now,
      async () => undefined,
      memo(),
    );
    d2.onState(al([hb({ done: true })]));
    d2.tick();
    expect(m2.state.event).toBeNull();
  });
});
