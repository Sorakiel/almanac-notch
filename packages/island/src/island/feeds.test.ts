import { describe, expect, it } from 'vitest';
import { createState, type MediaFeed } from '../sim/state';
import { defaultSettings } from '../sim/settings';
import { mulberry32, PARITY_SEED } from '../sim/rng';
import { stepMusic } from '../sim/music';
import { autoFocus, minsText } from './focus';
import { focusTint, idleShort, modules } from './modules';
import { islandPointerDown } from './input';

function make() {
  const s = createState(defaultSettings(), mulberry32(PARITY_SEED), 0);
  s.t = 100;
  s.musicPlaying = false;
  return s;
}
const media = (o: Partial<MediaFeed> = {}): MediaFeed => ({
  idle: false,
  title: 'Song',
  short: 'Song',
  sub: 'Artist · Zen',
  len: 200,
  art: null,
  artPending: false,
  artA: 1,
  artSeed: 0,
  out: [],
  ...o,
});

describe('live calendar (s.cal)', () => {
  it('no call ahead: no cal focus, "встреч нет"', () => {
    const s = make();
    s.cal = { mins: null, at: '', title: 'Встреч нет', after: '' };
    expect(autoFocus(s)).toBe('almanac');
    const cal = modules(s)[2];
    expect(cal?.short).toBe('встреч нет');
    expect(cal && idleShort(cal)).toBe('нет');
  });
  it('a call in 25 min takes focus, amber at 5 min and after the start', () => {
    const s = make();
    s.cal = { mins: 25, at: '15:00', title: 'Sync', after: '' };
    expect(autoFocus(s)).toBe('cal');
    expect(focusTint(s, 'cal')).toBeNull();
    s.cal.mins = 5;
    expect(focusTint(s, 'cal')).toEqual({ c: '#F5A524', a: 0.35 });
    s.cal.mins = 0;
    expect(modules(s)[2]?.short).toBe('созвон сейчас');
  });
  it('hours away read as hours', () => {
    expect(minsText(14)).toBe('14 мин');
    expect(minsText(120)).toBe('2 ч');
    expect(minsText(125)).toBe('2 ч 5 мин');
    const s = make();
    s.cal = { mins: 125, at: '17:00', title: 'X', after: '' };
    expect(autoFocus(s)).toBe('almanac');
    expect(modules(s)[2]?.short).toBe('созвон через 2 ч 5 мин');
  });
});

describe('live player (s.media)', () => {
  it('module text: track, pause, nothing', () => {
    const s = make();
    s.media = media();
    s.cal = { mins: null, at: '', title: '', after: '' };
    s.musicPlaying = true;
    expect(modules(s)[3]?.short).toBe('Song');
    expect(autoFocus(s)).toBe('music');
    s.musicPlaying = false;
    expect(modules(s)[3]?.short).toBe('пауза');
    s.media.idle = true;
    expect(modules(s)[3]?.short).toBe('не играет');
  });
  it('the stub clock does not run or skip tracks', () => {
    const s = make();
    s.media = media();
    s.musicPlaying = true;
    s.musicPos = 199.9;
    const idx = s.trackIdx;
    stepMusic(s, 1);
    expect(s.musicPos).toBe(199.9);
    expect(s.trackIdx).toBe(idx);
  });
  it('player buttons queue commands instead of changing the stub playlist', () => {
    const s = make();
    const md = media();
    s.media = md;
    s.musicPlaying = true;
    const click = (act: string, x = 5) => {
      s.hits = [{ x: 0, y: 0, w: 100, h: 10, act, bx0: 0, bx1: 100 }];
      islandPointerDown(s, { x, y: 5 });
    };
    const idx = s.trackIdx;
    click('m:toggle');
    expect(s.musicPlaying).toBe(false);
    click('m:next');
    s.musicPos = 10;
    click('m:prev');
    click('m:prev');
    click('m:seek', 50);
    expect(s.musicPos).toBe(100);
    click('m:vol', 25);
    expect(s.volume).toBe(0.25);
    click('m:shuffle');
    expect(md.out).toEqual([
      'toggle',
      'next',
      'seek 0',
      'prev',
      'seek 100.0',
      'vol 0.250',
      'shuffle ' + (s.shuffle ? 1 : 0),
    ]);
    expect(s.trackIdx).toBe(idx);
  });
});

describe('a busy Claude next to another card', () => {
  it('music keeps its dance and headphones while Claude works; the claude card keeps the work', async () => {
    const { busyAside } = await import('./focus');
    const { propFor } = await import('../mascot/props');
    const s = make();
    s.S.nstate = 'open';
    s.musicPlaying = true;
    s.event = { type: 'working', start: 99, until: 1e9, nextHop: 0 };
    s.focusId = 'music';
    expect(busyAside(s)).toBe(true);
    expect(propFor(s, 'music')).not.toBeNull();
    s.focusId = 'claude';
    expect(busyAside(s)).toBe(false);
    expect(propFor(s, 'claude')).toBeNull();
    s.focusId = 'music';
    s.event = { type: 'attention', start: 99, until: 1e9, nextHop: 0 };
    expect(busyAside(s)).toBe(false);
  });
});
