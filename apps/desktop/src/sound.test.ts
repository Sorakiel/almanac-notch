import { describe, expect, it } from 'vitest';
import { createMascot, defaultSettings, type EventType } from '@almanac-notch/island';
import { clickSound, gapOf, SOUND_NAMES, SoundWatch } from './sound';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

function make() {
  const s = createMascot({ settings: defaultSettings(), now: 0, greetAfter: null }).state;
  s.t = 100;
  s.event = null;
  s.S.nstate = 'closed';
  return s;
}
const ev = (type: EventType, start: number) => ({ type, start, until: start + 10, nextHop: 0 });

describe('which island moments sound (stage 9a)', () => {
  it('every sound has its file, and no file is unused', () => {
    const files = readdirSync(join(__dirname, 'sounds')).map((f) => f.replace('.wav', ''));
    expect(files.sort()).toEqual([...SOUND_NAMES].sort());
  });

  it('each calling event once, at its start', () => {
    const s = make(),
      w = new SoundWatch();
    expect(w.step(s).play).toEqual([]);
    for (const [type, name] of [
      ['attention', 'attention'],
      ['question', 'question'],
      ['success', 'success'],
      ['error', 'error'],
      ['ratelimit', 'ratelimit'],
      ['dance', 'dance'],
      ['nudge', 'nudge'],
    ] as const) {
      s.t += 5;
      s.event = ev(type, s.t);
      expect(w.step(s).play).toEqual([name]);
      s.t += 0.1;
      expect(w.step(s).play).toEqual([]);
    }
  });

  it('busy work sounds when a busy phase begins, not on every switch inside it', () => {
    const s = make(),
      w = new SoundWatch();
    w.step(s);
    s.event = ev('thinking', s.t);
    expect(w.step(s).play).toEqual(['think']);
    for (const type of ['working', 'searching', 'thinking'] as const) {
      s.t += 2;
      s.event = ev(type, s.t);
      expect(w.step(s).play).toEqual([]);
    }
    s.t += 2;
    s.event = null;
    w.step(s);
    s.t += 2;
    s.event = ev('searching', s.t);
    expect(w.step(s).play).toEqual(['search']);
  });

  it('the greeting plays at launch and fades if it ends early', () => {
    const s = make(),
      w = new SoundWatch();
    s.event = ev('greeting', s.t);
    expect(w.step(s)).toEqual({ play: ['greeting'], stop: [] });
    s.t += 1;
    s.event = null;
    s.S.nstate = 'half';
    expect(w.step(s)).toEqual({ play: [], stop: ['greeting'] });
  });

  it('answers: "Allow" says yes, the rest tick, once', () => {
    const s = make(),
      w = new SoundWatch();
    s.event = ev('attention', s.t);
    w.step(s);
    s.t += 3;
    s.event.answer = 'approve';
    expect(w.step(s).play).toEqual(['approve']);
    expect(w.step(s).play).toEqual([]);
    s.t += 3;
    s.event = ev('question', s.t);
    w.step(s);
    s.event.answer = 'opt';
    s.t += 1;
    expect(w.step(s).play).toEqual(['tap']);
  });

  it('the mascot: a poke, grumpy at three, overloaded at six; sleep and waking; stroking', () => {
    const s = make(),
      w = new SoundWatch();
    w.step(s);
    s.pokes = [s.t];
    expect(w.step(s).play).toEqual(['poke']);
    s.t += 0.3;
    s.pokes.push(s.t);
    s.grumpyUntil = s.t + 2.6;
    expect(w.step(s).play).toEqual(['poke', 'grumpy']);
    s.t += 0.3;
    s.pokes = [];
    s.overloadUntil = s.t + 3.2;
    s.grumpyUntil = 0;
    expect(w.step(s).play).toEqual(['overload']);
    s.t += 5;
    s.sleeping = true;
    expect(w.step(s).play).toEqual(['sleep']);
    s.t += 5;
    s.sleeping = false;
    expect(w.step(s).play).toEqual(['wake']);
    s.petting = true;
    expect(w.step(s).play).toEqual(['pet']);
    s.petting = false;
    w.step(s);
    s.t += 1;
    s.petting = true;
    // a purr now and then, not on every stroke
    expect(w.step(s).play).toEqual([]);
  });

  it('the island opens, folds and peeks - quietly, and not under an event', () => {
    const s = make(),
      w = new SoundWatch();
    w.step(s);
    // quiet while the island settles after launch
    s.S.nstate = 'half';
    s.t += 1;
    expect(w.step(s).play).toEqual([]);
    s.S.nstate = 'closed';
    w.step(s);
    s.S.nstate = 'half';
    s.t += 2;
    expect(w.step(s).play).toEqual(['peek']);
    s.S.nstate = 'open';
    s.t += 2;
    expect(w.step(s).play).toEqual(['open']);
    s.S.nstate = 'closed';
    s.t += 2;
    expect(w.step(s).play).toEqual(['close']);
    s.S.nstate = 'open';
    s.t += 2;
    s.event = ev('question', s.t);
    expect(w.step(s).play).toEqual(['question']);
  });

  it('the same sound repeats no more often than its gap', () => {
    const s = make(),
      w = new SoundWatch();
    s.event = ev('error', s.t);
    expect(w.step(s).play).toEqual(['error']);
    s.t += gapOf('error') / 2;
    s.event = ev('error', s.t);
    expect(w.step(s).play).toEqual([]);
    s.t += gapOf('error');
    s.event = ev('error', s.t);
    expect(w.step(s).play).toEqual(['error']);
  });

  it('controls: switches clack, the rest tick, a habit ticked sounds bright', () => {
    const s = make();
    expect(clickSound(s, 'tab:chat')).toBe('tap');
    expect(clickSound(s, 'focus:music')).toBe('tap');
    expect(clickSound(s, 'm:next')).toBe('tap');
    expect(clickSound(s, 'notion:abc')).toBe('tap');
    expect(clickSound(s, 'host:hover')).toBe('toggle');
    expect(clickSound(s, 'host:close:30')).toBe('toggle');
    expect(clickSound(s, 'm:shuffle')).toBe('toggle');
    s.habits = [
      ['a', false],
      ['b', true],
    ];
    expect(clickSound(s, 'habit:0')).toBe('check');
    expect(clickSound(s, 'habit:1')).toBe('toggle');
    // their own sounds come from the state or the host
    for (const act of ['mascot', 'approve', 'deny', 'opt:1', 'mute', 'host:sound', 'host:vol', 'host:quit'])
      expect(clickSound(s, act)).toBe(null);
  });

  it('clicks are queued and rate-limited', () => {
    const s = make(),
      w = new SoundWatch();
    w.click(s, 'tab:chat');
    w.click(s, 'tab:home');
    w.joy();
    expect(w.takeClicks(s.t)).toEqual(['tap', 'joy']);
    expect(w.takeClicks(s.t + 1)).toEqual([]);
  });
});
