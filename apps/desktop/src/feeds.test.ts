import { describe, expect, it } from 'vitest';
import { createMascot, defaultSettings } from '@almanac-notch/island';
import { CalDriver, MediaDriver, artSeed, calFeed, whenText, type Calendar } from './feeds';

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
      decode: () => Promise.resolve(null),
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
    d.onMessage({ none: true });
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
});
