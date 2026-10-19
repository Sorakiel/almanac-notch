import { describe, expect, it } from 'vitest';
import { createMascot, defaultSettings, type EventType } from '@almanac-notch/island';
import { REPEAT_GAP, SoundWatch } from './sound';

function make() {
  const s = createMascot({ settings: defaultSettings(), now: 0, greetAfter: null }).state;
  s.t = 100;
  s.event = null;
  return s;
}
const ev = (type: EventType, start: number) => ({ type, start, until: start + 10, nextHop: 0 });

describe('which island moments sound (stage 9a)', () => {
  it('each calling event once, at its start', () => {
    const s = make(),
      w = new SoundWatch();
    expect(w.step(s)).toEqual([]);
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
      expect(w.step(s)).toEqual([name]);
      s.t += 0.1;
      expect(w.step(s)).toEqual([]);
    }
  });

  it('busy and greeting moments stay silent', () => {
    const s = make(),
      w = new SoundWatch();
    for (const type of ['working', 'thinking', 'searching', 'greeting'] as const) {
      s.t += 5;
      s.event = ev(type, s.t);
      expect(w.step(s)).toEqual([]);
    }
  });

  it('an answer ticks once', () => {
    const s = make(),
      w = new SoundWatch();
    s.event = ev('attention', s.t);
    w.step(s);
    s.t += 3;
    s.event.answer = 'approve';
    expect(w.step(s)).toEqual(['tap']);
    expect(w.step(s)).toEqual([]);
  });

  it('the same sound repeats no more often than the gap', () => {
    const s = make(),
      w = new SoundWatch();
    s.event = ev('error', s.t);
    expect(w.step(s)).toEqual(['error']);
    s.t += REPEAT_GAP / 2;
    s.event = ev('error', s.t);
    expect(w.step(s)).toEqual([]);
    s.t += REPEAT_GAP;
    s.event = ev('error', s.t);
    expect(w.step(s)).toEqual(['error']);
  });
});
