import type { CiRun, IslandState } from '../sim/state';

// A CI result, from what the person needs at that moment (docs/CHANGES.md 2026-10-19). A green
// run needs nothing: a short pop and done. A red one needs something done - what broke, where,
// open the run, re-run it - but it must not hold the island hostage: it pops up briefly, then
// only the mascot's dot remembers it; the next time the person opens the island it takes the
// focus card once, and the card's cross sets it aside (the dot goes, the GitHub pill keeps its red).
// It comes back only for another failure (another key), and goes by itself when CI turns green.

/** the harness has no live GitHub: the card's runs for ev:error and ev:success */
export const STUB_RUNS: Record<'fail' | 'ok', CiRun> = {
  fail: {
    key: 'almanac-notch#59cd936',
    state: 'fail',
    repo: 'almanac-notch',
    branch: 'main',
    check: 'test',
    sha: '59cd936',
    title: 'Fly mascots between pills and cards',
    done: 5,
    total: 5,
    at: 0,
    rerun: true,
  },
  ok: {
    key: 'almanac-notch#59cd936',
    state: 'ok',
    repo: 'almanac-notch',
    branch: 'main',
    check: '',
    sha: '59cd936',
    title: 'Fly mascots between pills and cards',
    done: 5,
    total: 5,
    at: 0,
    rerun: false,
  },
};

/** a failure the person has not set aside (and wants to hear about): the dot, the focus once */
export function ciAlert(s: IslandState): CiRun | null {
  const g = s.github,
    f = g && g.auth === 'ok' ? g.fail : null;
  if (!f || s.off.includes('github') || s.ciNotify.fail === 'off' || s.ciHidden === f.key) return null;
  return f;
}

/** the alert takes the open island's focus until it has been on screen once */
export function ciWantsFocus(s: IslandState): boolean {
  const a = ciAlert(s);
  return !!a && s.ciSeen !== a.key;
}

/** a GitHub success or error event (not one of an agent, Vercel, Grafana...) */
export function ciEvent(s: IslandState): boolean {
  const ev = s.event;
  return !!ev && (ev.type === 'success' || ev.type === 'error') && !ev.src;
}

/** the run the CI card shows: the one the event is about, else the alert */
export function ciRun(s: IslandState): CiRun | null {
  const ev = s.event;
  if (ev && ciEvent(s)) {
    const kind = ev.type === 'success' ? 'ok' : 'fail';
    if (!s.github) return { ...STUB_RUNS[kind], at: s.date().getTime() - 2 * 60000 };
    const r = ev.ci ? s.github.runs.find((x) => x.key === ev.ci) : null;
    if (r) return r;
    if (kind === 'fail' && s.github.fail) return s.github.fail;
  }
  return ciAlert(s);
}

/** per update, with the island's open state and the module in focus: an alert that was on the
 * open island counts as seen once the island closes */
export function ciTick(s: IslandState, open: boolean, focusIsGithub: boolean): void {
  const a = ciAlert(s);
  if (open && a && focusIsGithub) s.ciShown = a.key;
  else if (!open && s.ciShown) {
    s.ciSeen = s.ciShown;
    s.ciShown = '';
  }
  if (s.ciNote && s.t - s.ciNote.at > 6) s.ciNote = null;
}

/** the card's cross: the alert steps back, the event (if it is the one) ends */
export function ciHide(s: IslandState): void {
  const r = ciRun(s);
  if (!r) return;
  s.ciHidden = r.key;
  s.ciSeen = r.key;
  s.ciShown = '';
  if (s.focusId === 'github') s.focusId = null;
  if (ciEvent(s) && s.event) s.event.until = s.t;
}
