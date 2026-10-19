import { describe, expect, it } from 'vitest';
import { createState, type CiRun, type GithubFeed } from '../sim/state';
import { defaultSettings } from '../sim/settings';
import { mulberry32, PARITY_SEED } from '../sim/rng';
import { autoFocus } from './focus';
import { ciAlert, ciHide, ciRun, ciTick, ciWantsFocus, STUB_RUNS } from './ci';

const red: CiRun = { ...STUB_RUNS.fail, key: 'app#1', repo: 'app' };

function make(fail: CiRun | null = red) {
  const s = createState(defaultSettings(), mulberry32(PARITY_SEED), 0);
  s.t = 100;
  const g: GithubFeed = {
    auth: 'ok',
    ci: fail ? 'fail' : 'ok',
    ciText: '',
    short: '',
    prs: 0,
    prText: '',
    commits: [0, 0, 0, 0, 0, 0, 0],
    hint: ['', ''],
    runs: fail ? [fail] : [],
    fail,
  };
  s.github = g;
  return s;
}

describe('CI alert (island/ci.ts)', () => {
  it('a red head takes the open island once, then only the dot remembers it', () => {
    const s = make();
    expect(ciAlert(s)?.key).toBe('app#1');
    expect(autoFocus(s)).toBe('github');
    // shown in the open island, then the island closes: seen
    ciTick(s, true, true);
    ciTick(s, false, false);
    expect(ciWantsFocus(s)).toBe(false);
    expect(autoFocus(s)).not.toBe('github');
    expect(ciAlert(s)).not.toBeNull();
  });

  it('"Скрыть" sets it aside until another failure; green clears it', () => {
    const s = make();
    ciHide(s);
    expect(ciAlert(s)).toBeNull();
    s.github = make({ ...red, key: 'app#2' }).github;
    expect(ciAlert(s)?.key).toBe('app#2');
    expect(ciWantsFocus(s)).toBe(true);
    s.github = make(null).github;
    expect(ciAlert(s)).toBeNull();
  });

  it('settings: "off" never alerts, "dot" still does; a prompt keeps its focus', () => {
    const s = make();
    s.ciNotify.fail = 'off';
    expect(ciAlert(s)).toBeNull();
    s.ciNotify.fail = 'dot';
    expect(ciAlert(s)).not.toBeNull();
    s.event = { type: 'attention', start: 99, until: 200, nextHop: 0 };
    expect(autoFocus(s)).not.toBe('github');
  });

  it('an event shows its own run; the harness gets the stub', () => {
    const s = make();
    s.event = { type: 'success', start: 99, until: 200, nextHop: 0, ci: 'app#1' };
    expect(ciRun(s)?.key).toBe('app#1');
    s.github = null;
    expect(ciRun(s)?.state).toBe('ok');
    s.event = { type: 'error', start: 99, until: 200, nextHop: 0 };
    expect(ciRun(s)?.check).toBe('test');
  });
});
