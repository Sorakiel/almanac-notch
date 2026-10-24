// Cards of the home tab: the focus card, approvals and questions, the overload alert, the launch warp.
import { plural, tr } from '../i18n';
import { clamp, hexA, mixHex, ss } from '../util/math';
import { rrect, textAt, type Ctx } from '../util/draw';
import type { CiRun, IslandState, ModuleId } from '../sim/state';
import { ciRun } from './ci';
import { EVENTS, limitText, statusOf, stepAt, stepFrac, stepIndex } from '../sim/events';
import { drawMascot } from '../mascot/body';
import { propFor } from '../mascot/props';
import { TRACKS, type ToolKind } from '../stub';
import type { WorkFx } from './fx';
import { addHit, hovering } from './hits';
import { hoverK, pressScale } from './hover';
import { backHead, drawDepth, scrollList } from './depth';
import { T_MUTED } from './half';
import { MODULE_COL, minsText } from './focus';
import { card, cardMascot, cardTint, kbdButton } from './card';
import { seq } from './eventIn';
import { cardFade } from './flight';
import { deployDot, modules, pageMark, prIcon, type ModuleItem } from './modules';

/** the muted word after the name in coucou's card head */
const HEAD_WORD: Partial<Record<ModuleId, string>> = {
  vercel: 'Деплои',
  notion: 'Недавние',
  grafana: 'Алерты',
  claude: 'агент',
  cal: 'сегодня',
  music: 'сейчас играет',
  almanac: 'привычки',
};

// One text system for every module card (2026-10-19), coucou's: three tones and two sizes. The
// name is ink, values are a soft light grey, labels and meta are dim; colour only marks a state
// (an icon, a dot, a late meeting), never a whole line.
const INK = '#F5F6F8',
  VAL = '#C5C8CD',
  DIM = '#8E939C',
  DIM3 = '#6B7079';
/** first content row and the step between rows, under the head */
const ROW0 = 42,
  ROW_STEP = 21;

/** a habit as a list row: the checkbox where the dot is, the name, its progress on the right;
 * the plate lights up under the pointer since the row is a button */
function habitRow(
  s: IslandState,
  c: Ctx,
  name: string,
  done: boolean,
  progress: string,
  act: string,
  tx: number,
  y: number,
  tmax: number,
): void {
  const hov = hovering(s, tx - 6, y - 10, tmax + 6, 20);
  c.fillStyle = hov ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)';
  rrect(c, tx - 6, y - 10, tmax + 6, 20, 6);
  c.fill();
  checkBox(c, tx, y, done);
  c.save();
  c.font = '400 11px Onest, system-ui, sans-serif';
  const pw = progress ? c.measureText(progress).width + 10 : 0;
  c.restore();
  textAt(c, name, tx + 16, y + 0.5, {
    size: 11.5,
    weight: 500,
    color: done ? DIM3 : hov ? INK : VAL,
    max: tmax - 16 - pw,
  });
  if (progress) textAt(c, progress, tx + tmax, y + 0.5, { size: 11, weight: 400, color: DIM3, align: 'right' });
  addHit(s, c, { x: tx - 6, y: y - 10, w: tmax + 6, h: 20, act });
}

// ---------- levels inside a card (stage 10) ----------
// One quiet system for every module's lists and items, coucou's mail card's (NotchBuddy
// MailViews.swift): rows of 11 / 10 px, a 5 px dot, the rows that want attention on a wash of the
// module's colour, the rest on nothing; an item is its head, one line in 11, a body in 10.5, and
// its actions as words - the first in the module's colour, the others grey. No filled buttons
// inside a card: a white pill shouted over everything around it (owner, 2026-10-25).

/** the tones of a level (coucou's mail): a lead line, the body, a quiet line, the quietest */
const L_LEAD = '#E8E9EC',
  L_SUBJ = '#C5C8CD',
  L_BODY = '#9398A1',
  L_SUB = '#8E939C',
  L_FAINT = '#4D5159';
/** an item's lines under its head */
const IT_SUBJ = 38,
  IT_BODY = 55,
  IT_BODY2 = 69,
  IT_ACT = 88;

/** "5 мин", "3 ч", "2 дн": an age in a row */
function shortAgo(s: IslandState, at: number): string {
  if (!at) return '';
  const min = Math.floor((s.date().getTime() - at) / 60000);
  if (min < 1) return tr(s, 'сейчас');
  if (min < 60) return tr(s, '{0} мин', min);
  const h = Math.floor(min / 60);
  return h < 24 ? tr(s, '{0} ч', h) : tr(s, '{0} дн', Math.floor(h / 24));
}

/** a chevron at (x, y): the row goes further */
function chevron(c: Ctx, x: number, y: number, col: string): void {
  c.save();
  c.strokeStyle = col;
  c.lineWidth = 1.4;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(x - 1.75, y - 3.5);
  c.lineTo(x + 1.75, y);
  c.lineTo(x - 1.75, y + 3.5);
  c.stroke();
  c.restore();
}

/** the plate of a row that is a button: lit on a spring under the pointer (white 5%), a row that
 * wants attention on a wash of `wash` (8%, 14% lit); returns the light 0..1 */
function rowPlate(
  s: IslandState,
  c: Ctx,
  id: string,
  tx: number,
  y: number,
  tmax: number,
  wash: string | null = null,
): number {
  const k = clamp(hoverK(s, 'row:' + id, hovering(s, tx - 6, y - 10, tmax + 6, 20), 0.16, 1), 0, 1);
  if (wash) c.fillStyle = hexA(wash, 0.08 + 0.06 * k);
  else c.fillStyle = `rgba(255,255,255,${(0.05 * k).toFixed(3)})`;
  if (wash || k > 0.01) {
    rrect(c, tx - 6, y - 9.5, tmax + 6, 19, 5);
    c.fill();
  }
  return k;
}

/** a small dot of a colour: the mark of a row; hollow (a grey ring) when it is quiet */
const dotMark =
  (c: Ctx, col: string | null, r = 2.5) =>
  (x: number, y: number): void => {
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    if (col) {
      c.fillStyle = col;
      c.fill();
    } else {
      c.strokeStyle = L_FAINT;
      c.lineWidth = 1;
      c.stroke();
    }
  };

interface Line {
  /** the hover spring's key and what a click does */
  id: string;
  act: string;
  /** draws the row's mark centred at (x, y) */
  mark: (x: number, y: number) => void;
  /** a mono lead before the name ("15:00"), the name, its age, then a quieter line cut to fit */
  lead?: string;
  name: string;
  meta?: string;
  sub?: string;
  /** wants attention: the name in semibold, the row on a wash of `wash` */
  strong?: boolean;
  wash?: string | null;
}

/** one row of a list inside a card, as coucou's mail row: mark, name, age, the rest quieter */
function listLine(s: IslandState, c: Ctx, L: Line, y: number, tx: number, tmax: number): void {
  const k = rowPlate(s, c, L.id, tx, y, tmax, L.strong ? (L.wash ?? null) : null);
  L.mark(tx + 2, y);
  let x = tx + 10;
  const right = tx + tmax - 10 * k;
  const put = (str: string, font: string, opts: Parameters<typeof textAt>[4], gap: number): void => {
    if (!str || x >= right - 8) return;
    textAt(c, str, x, y + 0.5, { ...opts, max: right - x });
    c.save();
    c.font = font;
    x += Math.min(c.measureText(str).width, right - x) + gap;
    c.restore();
  };
  put(
    L.lead ?? '',
    '500 10.5px "JetBrains Mono", monospace',
    { size: 10.5, weight: 500, mono: true, color: L.strong ? L_SUBJ : L_BODY },
    6,
  );
  // the name keeps at most two thirds of the row, so its age and the quiet line still show
  c.save();
  c.font = `${L.strong ? 600 : 400} 11px Onest, system-ui, sans-serif`;
  const nw = Math.min(c.measureText(L.name).width, (right - x) * (L.sub || L.meta ? 0.66 : 1));
  c.restore();
  textAt(c, L.name, x, y + 0.5, { size: 11, weight: L.strong ? 600 : 400, color: L.strong ? L_LEAD : L_BODY, max: nw });
  x += nw + 5;
  put(L.meta ?? '', '400 10px Onest, system-ui, sans-serif', { size: 10, weight: 400, color: '#6B7079' }, 5);
  put(
    L.sub ?? '',
    '400 10px Onest, system-ui, sans-serif',
    { size: 10, weight: 400, color: L.strong ? L_SUB : L_FAINT },
    0,
  );
  if (k > 0.01) {
    c.save();
    c.globalAlpha *= k;
    chevron(c, tx + tmax - 3, y, L_SUB);
    c.restore();
  }
  addHit(s, c, { x: tx - 6, y: y - 10, w: tmax + 6, h: 20, act: L.act });
}

/** a list window under a card's head: the next row peeks out through the fade at the bottom */
function levelList(
  s: IslandState,
  c: Ctx,
  key: string,
  n: number,
  tx: number,
  y0: number,
  y1: number,
  tmax: number,
  row: (i: number, cy: number) => void,
): void {
  const top = y0 + ROW0 - ROW_STEP / 2;
  scrollList(s, c, key, tx - 6, top, tmax + 6, y1 - top + 9, n, ROW_STEP, row);
}

/** an item's head: chevron, dot, title; a quiet note on the right (age, how soon, a streak) */
function itemHead(
  s: IslandState,
  c: Ctx,
  title: string,
  dot: string | null,
  note: string,
  noteCol: string,
  tx: number,
  y0: number,
  tmax: number,
): void {
  let nw = 0;
  if (note) {
    c.save();
    c.font = '400 10px Onest, system-ui, sans-serif';
    nw = c.measureText(note).width + 10;
    c.restore();
    textAt(c, note, tx + tmax, y0 + 18.5, { size: 10, weight: 400, color: noteCol, align: 'right' });
  }
  backHead(s, c, title, tx, y0 + 18, tmax - nw, dot);
}

/** an item's lines: the subject in 11 medium, the body in 10.5 */
function subjLine(c: Ctx, str: string, tx: number, y: number, tmax: number, color = L_SUBJ): void {
  textAt(c, str, tx, y + 0.5, { size: 11, weight: 500, color, max: tmax });
}
function bodyLine(c: Ctx, str: string, tx: number, y: number, tmax: number, color = L_BODY): void {
  textAt(c, str, tx, y + 0.5, { size: 10.5, weight: 400, color, max: tmax });
}

interface Act {
  label: string;
  act: string;
  /** 'lead' the module's colour, 'plain' light grey, 'quiet' grey */
  tone: 'lead' | 'plain' | 'quiet';
  /** an arrow after the word: it leaves for an app or a site */
  out?: boolean;
  /** a shorter word for a narrow card */
  short?: string;
}

/**
 * An item's actions as words in one row, 12 apart, as coucou's mail detail ("Open in Mail ·
 * Reply · Mark as read"): the first in the module's colour, the others grey; each lights a touch
 * under the pointer and dips when pressed. What does not fit is left out, from the end.
 */
function actionRow(s: IslandState, c: Ctx, acts: Act[], accent: string, tx: number, y: number, tmax: number): void {
  let x = tx;
  for (const a0 of acts) {
    c.save();
    c.font = '500 11px Onest, system-ui, sans-serif';
    const width = (l: string): number => c.measureText(l).width + (a0.out ? 11 : 0);
    const a = a0.short && x + width(a0.label) > tx + tmax + 2 ? { ...a0, label: a0.short } : a0;
    const w = width(a.label);
    c.restore();
    if (x + w > tx + tmax + 2) break;
    const hov = clamp(hoverK(s, 'act:' + a.act, hovering(s, x - 5, y - 9, w + 10, 18), 0.16, 1), 0, 1),
      sc = pressScale(s, a.act);
    const base = a.tone === 'lead' ? accent : a.tone === 'plain' ? L_SUBJ : L_SUB;
    const col = a.tone === 'lead' ? hexA(base, 0.9 + 0.1 * hov) : mixHex(base, '#F5F6F8', 0.6 * hov);
    c.save();
    c.translate(x + w / 2, y);
    c.scale(sc, sc);
    c.translate(-(x + w / 2), -y);
    textAt(c, a.label, x, y + 0.5, { size: 11, weight: 500, color: col });
    if (a.out) {
      const ax = x + w - 4;
      c.strokeStyle = col;
      c.lineWidth = 1.2;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(ax - 2.5, y + 2.5);
      c.lineTo(ax + 2.5, y - 2.5);
      c.moveTo(ax - 1.2, y - 2.5);
      c.lineTo(ax + 2.5, y - 2.5);
      c.lineTo(ax + 2.5, y + 1.2);
      c.stroke();
    }
    c.restore();
    addHit(s, c, { x: x - 5, y: y - 9, w: w + 10, h: 18, act: a.act });
    x += w + 12;
  }
}

/** a level's head with a count on the right, for a list */
function listHead(s: IslandState, c: Ctx, title: string, count: number, tx: number, y0: number, tmax: number): void {
  itemHead(s, c, title, null, String(count), '#6B7079', tx, y0, tmax);
}

// ----- GitHub -----

type GhFeed = NonNullable<IslandState['github']>;
type GhPr = NonNullable<GhFeed['review']>[number];
const CI_COL = { fail: '#F4505E', run: '#F5A524', ok: '#34C759' } as const;

/** GitHub's levels: '' the summary, 'ci' every repository's CI, 'run:<repo>' one of them,
 * 'prs' the PRs waiting for review, 'pr:<n>@<repo>' one of them */
function githubLevel(
  s: IslandState,
  c: Ctx,
  it: ModuleItem,
  gh: GhFeed,
  key: string,
  tx: number,
  y0: number,
  x1: number,
  y1: number,
  tmax: number,
): void {
  const review = gh.review ?? [];
  if (key === 'ci' && gh.runs.length) {
    listHead(s, c, tr(s, 'Проверки'), gh.runs.length, tx, y0, tmax);
    levelList(s, c, 'github:ci', gh.runs.length, tx, y0, y1, tmax, (i, cy) => {
      const r = gh.runs[i] as CiRun;
      listLine(
        s,
        c,
        {
          id: 'ci:' + r.repo,
          act: 'depth:github:run:' + r.repo,
          mark: dotMark(c, CI_COL[r.state]),
          name: r.repo,
          meta: shortAgo(s, r.at),
          sub: r.state === 'fail' && r.check ? r.check : r.branch,
          strong: r.state !== 'ok',
          wash: CI_COL[r.state],
        },
        cy,
        tx,
        tmax,
      );
    });
    return;
  }
  if (key.startsWith('run:')) {
    const r = gh.runs.find((x) => x.repo === key.slice(4));
    if (r) return ghRun(s, c, r, tx, y0, tmax);
  }
  if (key === 'prs' && review.length) {
    listHead(s, c, tr(s, 'Ждут ревью'), gh.prs, tx, y0, tmax);
    levelList(s, c, 'github:prs', review.length, tx, y0, y1, tmax, (i, cy) => {
      const p = review[i] as GhPr;
      listLine(
        s,
        c,
        {
          id: `pr:${p.num}@${p.repo}`,
          act: `depth:github:pr:${p.num}@${p.repo}`,
          mark: dotMark(c, p.draft ? null : '#8AB4F8'),
          name: p.title,
          meta: shortAgo(s, p.at),
          sub: `${p.repo}#${p.num}`,
          strong: !p.draft,
          wash: '#8AB4F8',
        },
        cy,
        tx,
        tmax,
      );
    });
    return;
  }
  if (key.startsWith('pr:')) {
    const p = review.find((x) => `pr:${x.num}@${x.repo}` === key);
    if (p) return ghPr(s, c, p, tx, y0, tmax);
  }
  // the summary: its first two rows lead further
  brandHead(s, c, 'github', it.name, tx, y0, x1);
  const ci = gh.ci,
    repo = gh.ciText.includes(' · ') ? (gh.ciText.split(' · ')[0] as string) : '';
  const ciWord =
    ci === 'ok'
      ? tr(s, 'зелёный')
      : ci === 'fail'
        ? tr(s, 'упал')
        : ci === 'run'
          ? tr(s, 'идёт')
          : tr(s, 'нет проверок');
  const nav = (id: string, act: string | null, y: number, draw: (tm: number) => void): void => {
    if (!act) return draw(tmax);
    const k = rowPlate(s, c, id, tx, y, tmax);
    draw(tmax - 12 * k);
    if (k > 0.01) {
      c.save();
      c.globalAlpha *= k;
      chevron(c, tx + tmax - 3, y, L_SUB);
      c.restore();
    }
    addHit(s, c, { x: tx - 6, y: y - 10, w: tmax + 6, h: 20, act });
  };
  nav('gh:ci', gh.runs.length ? 'depth:github:ci' : null, y0 + ROW0, (tm) =>
    statRow(
      c,
      (x, y) => stateDisc(c, x, y, ci),
      repo ? tr(s, 'CI · {0}', repo) : tr(s, 'CI основной ветки'),
      ciWord,
      tx,
      y0 + ROW0,
      tm,
      ci === 'fail' ? '#F4505E' : VAL,
    ),
  );
  nav('gh:prs', review.length ? 'depth:github:prs' : null, y0 + ROW0 + ROW_STEP, (tm) =>
    statRow(c, (x, y) => prIcon(c, x, y), tr(s, 'Ждут ревью'), String(gh.prs), tx, y0 + ROW0 + ROW_STEP, tm),
  );
  statRow(
    c,
    (x, y) => rowIcon(c, 'commits', x, y),
    tr(s, 'Коммиты за 7 дней'),
    String(gh.commits.reduce((a, b) => a + b, 0)),
    tx,
    y0 + ROW0 + ROW_STEP * 2,
    tmax,
  );
}

/** one repository's CI: what broke and where, re-run it, open the run */
function ghRun(s: IslandState, c: Ctx, r: CiRun, tx: number, y0: number, tmax: number): void {
  itemHead(s, c, r.repo, CI_COL[r.state], shortAgo(s, r.at), '#6B7079', tx, y0, tmax);
  const fail = r.state === 'fail',
    of = r.total ? ` · ${r.done}/${r.total}` : '';
  subjLine(
    c,
    fail
      ? r.check
        ? tr(s, 'Упала проверка {0}', r.check)
        : tr(s, 'CI упал')
      : r.state === 'ok'
        ? tr(s, 'Все проверки прошли') + of
        : tr(s, 'Проверки идут') + of,
    tx,
    y0 + IT_SUBJ,
    tmax,
  );
  // the commit, or how the re-run went
  const note = s.ciNote && s.ciNote.key === r.key ? s.ciNote : null;
  if (note) bodyLine(c, note.text, tx, y0 + IT_BODY, tmax, note.err ? '#F5B94A' : L_SUBJ);
  else {
    const ref = `${r.branch} ${r.sha}`;
    textAt(c, ref, tx, y0 + IT_BODY + 0.5, { size: 10, weight: 500, mono: true, color: '#6B7079' });
    c.save();
    c.font = '500 10px "JetBrains Mono", monospace';
    const rw = c.measureText(ref).width + 6;
    c.restore();
    bodyLine(c, r.title, tx + rw, y0 + IT_BODY, tmax - rw);
  }
  const acts: Act[] = [];
  if (fail && r.rerun) acts.push({ label: tr(s, 'Перезапустить'), act: 'gh:rerun:' + r.repo, tone: 'lead' });
  acts.push({
    label: tr(s, 'Открыть прогон'),
    short: tr(s, 'Открыть'),
    act: 'gh:open:' + r.repo,
    tone: acts.length ? 'plain' : 'lead',
    out: true,
  });
  actionRow(s, c, acts, fail ? '#F4505E' : MODULE_COL.github.body, tx, y0 + IT_ACT, tmax);
}

/** one PR waiting for review: whose and how old; it is read on GitHub */
function ghPr(s: IslandState, c: Ctx, p: GhPr, tx: number, y0: number, tmax: number): void {
  itemHead(s, c, `${p.repo} #${p.num}`, p.draft ? L_FAINT : '#8AB4F8', shortAgo(s, p.at), '#6B7079', tx, y0, tmax);
  subjLine(c, p.title, tx, y0 + IT_SUBJ, tmax);
  const who = [p.author ? '@' + p.author : '', p.draft ? tr(s, 'черновик') : ''].filter(Boolean).join(' · ');
  if (who) bodyLine(c, who, tx, y0 + IT_BODY, tmax);
  actionRow(
    s,
    c,
    [{ label: tr(s, 'Открыть на GitHub'), act: 'gh:url:' + p.url, tone: 'lead', out: true }],
    '#8AB4F8',
    tx,
    y0 + IT_ACT,
    tmax,
  );
}

// ----- Vercel -----

type VcFeed = NonNullable<IslandState['vercel']>;
type VcRow = VcFeed['rows'][number];
const VC_COL = { fail: '#F4505E', run: '#F5A524', ok: '#34C759', off: null } as const;

function vercelLevel(
  s: IslandState,
  c: Ctx,
  it: ModuleItem,
  vc: VcFeed,
  key: string,
  tx: number,
  y0: number,
  x1: number,
  y1: number,
  tmax: number,
): void {
  if (key.startsWith('dep:')) {
    const r = vc.rows.find((x) => x.id === key.slice(4));
    if (r) return vercelDeploy(s, c, vc, r, tx, y0, tmax);
  }
  brandHead(s, c, it.id, it.name, tx, y0, x1);
  levelList(s, c, 'vercel', vc.rows.length, tx, y0, y1, tmax, (i, cy) => {
    const r = vc.rows[i] as VcRow;
    listLine(
      s,
      c,
      {
        id: 'vc:' + r.id,
        act: 'depth:vercel:dep:' + r.id,
        mark: dotMark(c, VC_COL[r.state]),
        name: r.name,
        meta: r.ago,
        sub: r.branch || r.target || '',
        strong: r.state === 'fail' || r.state === 'run',
        wash: VC_COL[r.state],
      },
      cy,
      tx,
      tmax,
    );
  });
}

/** one deployment: how it went, from what, and the one thing to do next */
function vercelDeploy(s: IslandState, c: Ctx, vc: VcFeed, r: VcRow, tx: number, y0: number, tmax: number): void {
  itemHead(s, c, r.name, VC_COL[r.state] ?? L_FAINT, r.ago, '#6B7079', tx, y0, tmax);
  const word = tr(s, { ok: 'Готов', fail: 'Упал', run: 'Собирается', off: 'Отменён' }[r.state]);
  subjLine(c, r.target ? `${word} · ${r.target}` : word, tx, y0 + IT_SUBJ, tmax);
  const note = vc.note && vc.note.id === r.id ? vc.note : null;
  if (note) bodyLine(c, note.text, tx, y0 + IT_BODY, tmax, note.err ? '#F5B94A' : L_SUBJ);
  else if (r.branch || r.commit) {
    let x = tx;
    if (r.branch) {
      textAt(c, r.branch, x, y0 + IT_BODY + 0.5, {
        size: 10,
        weight: 500,
        mono: true,
        color: '#6B7079',
        max: tmax * 0.45,
      });
      c.save();
      c.font = '500 10px "JetBrains Mono", monospace';
      x += Math.min(c.measureText(r.branch).width, tmax * 0.45) + 6;
      c.restore();
    }
    if (r.commit) bodyLine(c, r.commit, x, y0 + IT_BODY, tx + tmax - x);
  }
  // a failed build is built again, a ready one is looked at
  const acts: Act[] =
    r.state === 'fail'
      ? [
          { label: tr(s, 'Повторить'), act: 'vcredo:' + r.id, tone: 'lead' },
          { label: tr(s, 'Логи'), act: 'vercel:' + r.id, tone: 'plain', out: true },
        ]
      : r.state === 'ok' && r.site
        ? [
            { label: tr(s, 'Открыть сайт'), act: 'vcsite:' + r.id, tone: 'lead', out: true },
            { label: 'Vercel', act: 'vercel:' + r.id, tone: 'quiet', out: true },
          ]
        : [{ label: 'Vercel', act: 'vercel:' + r.id, tone: 'lead', out: true }];
  actionRow(s, c, acts, r.state === 'fail' ? '#F4505E' : '#F5F6F8', tx, y0 + IT_ACT, tmax);
}

// ----- calendar -----

type CalFeed = NonNullable<IslandState['cal']>;
type CalEv = NonNullable<CalFeed['events']>[number];

/** "через 20 мин", "сейчас", "завтра 10:00": how soon */
function soonText(s: IslandState, e: CalEv): string {
  const min = Math.ceil((e.start - s.date().getTime()) / 60000);
  if (min <= 0) return tr(s, 'сейчас');
  if (min < 60 * 12) return tr(s, 'через {0}', minsText(s, min));
  return e.at;
}

/** a small camera: the mark of a meeting that is a call */
function camMark(c: Ctx, x: number, y: number, col: string): void {
  c.fillStyle = col;
  rrect(c, x - 3.5, y - 2.5, 5, 5, 1.2);
  c.fill();
  c.beginPath();
  c.moveTo(x + 1.5, y - 0.6);
  c.lineTo(x + 3.8, y - 2.2);
  c.lineTo(x + 3.8, y + 2.2);
  c.lineTo(x + 1.5, y + 0.6);
  c.closePath();
  c.fill();
}

/** the calendar's levels: '' the next meeting and what comes after, 'day' every meeting ahead,
 * 'ev:<id>' one meeting - when, where, join the call */
function calLevel(
  s: IslandState,
  c: Ctx,
  it: ModuleItem,
  cal: CalFeed,
  key: string,
  tx: number,
  y0: number,
  x1: number,
  y1: number,
  tmax: number,
): void {
  const events = cal.events ?? [],
    now = s.date().getTime(),
    col = MODULE_COL.cal.body;
  if (key === 'day' && events.length > 1) {
    listHead(s, c, tr(s, 'Встречи'), events.length, tx, y0, tmax);
    levelList(s, c, 'cal:day', events.length, tx, y0, y1, tmax, (i, cy) => {
      const e = events[i] as CalEv,
        live = e.start <= now,
        soon = !live && e.start - now <= 5 * 60000;
      // a call is marked by a small camera instead of the dot: which ones are calls, at a glance
      const tone = live || soon ? '#F5B94A' : col;
      listLine(
        s,
        c,
        {
          id: 'cal:' + e.id,
          act: 'depth:cal:ev:' + e.id,
          mark: e.link ? (x, y) => camMark(c, x, y, tone) : dotMark(c, tone),
          lead: e.at,
          name: e.title,
          sub: live ? tr(s, 'сейчас') : e.place,
          strong: live || soon,
          wash: '#F5B94A',
        },
        cy,
        tx,
        tmax,
      );
    });
    return;
  }
  if (key.startsWith('ev:')) {
    const e = events.find((x) => x.id === key.slice(3));
    if (e) return calEvent(s, c, e, tx, y0, tmax);
  }
  // the summary: as before, with its rows leading further
  const mins = cal.mins ?? 0;
  brandHead(
    s,
    c,
    it.id,
    it.name,
    tx,
    y0,
    x1,
    mins <= 0 ? tr(s, 'сейчас') : tr(s, 'через {0}', minsText(s, mins)),
    mins <= 5 ? '#F5B94A' : DIM,
  );
  const next = events[0] as CalEv;
  const row = (id: string, act: string, y: number, draw: () => void): void => {
    const k = rowPlate(s, c, id, tx, y, tmax);
    draw();
    if (k > 0.01) {
      c.save();
      c.globalAlpha *= k;
      chevron(c, tx + tmax - 3, y, L_SUB);
      c.restore();
    }
    addHit(s, c, { x: tx - 6, y: y - 10, w: tmax + 6, h: 20, act });
  };
  row('cal:next', 'depth:cal:ev:' + next.id, y0 + ROW0, () =>
    listRow(c, mins <= 5 ? '#F5B94A' : col, true, cal.title, '', tx, y0 + ROW0, tmax - 12, cal.at),
  );
  if (cal.after)
    row('cal:after', 'depth:cal:day', y0 + ROW0 + ROW_STEP, () =>
      listRow(c, DIM3, false, cal.after, '', tx, y0 + ROW0 + ROW_STEP, tmax - 12),
    );
}

/** one meeting: when, where, and the call one click away */
function calEvent(s: IslandState, c: Ctx, e: CalEv, tx: number, y0: number, tmax: number): void {
  const near = e.start - s.date().getTime() <= 5 * 60000;
  // the title takes the head whole; how soon goes with the time below
  itemHead(s, c, e.title, near ? '#F5B94A' : MODULE_COL.cal.body, '', '#6B7079', tx, y0, tmax);
  const hm = (t: number): string => {
    const d = new Date(t);
    return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  };
  const day = e.at.replace(/\d{1,2}:\d{2}$/, ''),
    range = `${day}${hm(e.start)}–${hm(e.end)}`;
  textAt(c, range, tx, y0 + IT_SUBJ + 0.5, { size: 11, weight: 500, mono: true, color: L_SUBJ });
  c.save();
  c.font = '500 11px "JetBrains Mono", monospace';
  const rw = c.measureText(range).width + 6;
  c.restore();
  textAt(c, '· ' + soonText(s, e), tx + rw, y0 + IT_SUBJ + 0.5, {
    size: 11,
    weight: 500,
    color: near ? '#F5B94A' : L_SUB,
    max: tmax - rw,
  });
  if (e.place) {
    // a pin: where
    const y = y0 + IT_BODY;
    c.save();
    c.strokeStyle = '#6B7079';
    c.lineWidth = 1.2;
    c.beginPath();
    c.arc(tx + 3.5, y - 1.5, 2.6, 0, Math.PI * 2);
    c.moveTo(tx + 3.5, y + 1.1);
    c.lineTo(tx + 3.5, y + 4.2);
    c.stroke();
    c.restore();
    bodyLine(c, e.place, tx + 12, y, tmax - 12);
  }
  if (e.link)
    actionRow(
      s,
      c,
      [{ label: tr(s, 'Подключиться'), act: 'caljoin:' + e.link, tone: 'lead', out: true }],
      '#F5B94A',
      tx,
      y0 + IT_ACT,
      tmax,
    );
}

// ----- Almanac -----

type AlFeed = NonNullable<IslandState['almanac']>;
type AlRow = AlFeed['rows'][number];

/** the habits of the day, as coucou's mail: what is left leads on a wash of Almanac's colour
 * with its count in the head ("3 осталось" for "3 unread"), what is done follows, quiet */
function habitList(
  s: IslandState,
  c: Ctx,
  it: ModuleItem,
  al: AlFeed,
  tx: number,
  y0: number,
  x1: number,
  y1: number,
  tmax: number,
): void {
  const left = al.total - al.done;
  // a tap that did not go through says so in the head, in place of the module's word
  brandHead(
    s,
    c,
    'almanac',
    it.name,
    tx,
    y0,
    x1,
    // the count is the head's word, as coucou's "3 unread": a narrow card has no room for both
    al.note || '',
    al.note ? '#F5B94A' : DIM,
    al.note ? undefined : left > 0 ? tr(s, '{0} осталось', left) : tr(s, 'всё сделано'),
  );
  levelList(s, c, 'almanac', al.rows.length, tx, y0, y1, tmax, (i, cy) =>
    habitListRow(s, c, al.rows[i] as AlRow, tx, cy, tmax),
  );
}

/** one habit: the box marks it, the rest of the row opens it; name, today's count, when, streak */
function habitListRow(s: IslandState, c: Ctx, r: AlRow, tx: number, y: number, tmax: number): void {
  const col = MODULE_COL.almanac.body,
    open = !r.done;
  const goal = r.goal ?? 1;
  const sub = [r.slot ?? '', r.streak ? tr(s, '{0} дн', r.streak) : ''].filter(Boolean).join(' · ');
  listLine(
    s,
    c,
    {
      id: 'al:' + r.id,
      act: 'depth:almanac:item:' + r.id,
      mark: () => undefined,
      name: r.name,
      meta: open && goal > 1 ? `${r.count ?? 0}/${goal}` : '',
      sub,
      strong: open,
      wash: col,
    },
    y,
    tx + 6,
    tmax - 6,
  );
  // the box where the dot is: open a ring of Almanac's colour, done filled with a tick
  const bk = clamp(hoverK(s, 'albox:' + r.id, hovering(s, tx - 6, y - 10, 20, 20), 0.16, 1), 0, 1);
  if (bk > 0.01) {
    c.fillStyle = `rgba(255,255,255,${(0.1 * bk).toFixed(3)})`;
    c.beginPath();
    c.arc(tx + 3, y, 7, 0, Math.PI * 2);
    c.fill();
  }
  c.beginPath();
  c.arc(tx + 3, y, 4, 0, Math.PI * 2);
  if (r.done) {
    c.fillStyle = hexA(col, 0.55);
    c.fill();
    c.strokeStyle = '#141416';
    c.lineWidth = 1.3;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(tx + 1.2, y);
    c.lineTo(tx + 2.6, y + 1.5);
    c.lineTo(tx + 5, y - 1.5);
    c.stroke();
  } else {
    c.strokeStyle = hexA(col, 0.75 + 0.25 * bk);
    c.lineWidth = 1.2;
    c.stroke();
  }
  addHit(s, c, { x: tx - 6, y: y - 10, w: 20, h: 20, act: 'almanac:' + r.id });
}

/** one habit inside the card, as a message: today, when, the streak and the week, and its actions */
function habitLevel(s: IslandState, c: Ctx, al: AlFeed, id: string, tx: number, y0: number, tmax: number): void {
  const r = al.rows.find((x) => x.id === id) as AlRow,
    col = MODULE_COL.almanac.body;
  const streak = r.streak ?? null;
  itemHead(
    s,
    c,
    r.name,
    r.done ? L_FAINT : col,
    streak === null ? '' : streak > 0 ? tr(s, '{0} дн подряд', streak) : tr(s, 'серии пока нет'),
    streak && streak > 0 ? '#F5B94A' : '#6B7079',
    tx,
    y0,
    tmax,
  );
  const goal = r.goal ?? 1,
    count = r.count ?? (r.done ? 1 : 0);
  const today = goal > 1 ? tr(s, '{0} из {1} сегодня', count, goal) : r.done ? tr(s, 'Сделано') : tr(s, 'Не сделано');
  subjLine(c, r.slot ? `${today} · ${r.slot}` : today, tx, y0 + IT_SUBJ, tmax);
  // the week: a dot a day with its letter under it, today last; done in Almanac's colour,
  // a frozen day a cool ring, a missed one faint; and how many of seven
  if (r.week) {
    const now = s.date(),
      letters = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    const step = 17;
    for (let i = 0; i < 7; i++) {
      const ch = r.week[i],
        x = tx + 4 + i * step,
        y = y0 + IT_BODY - 1,
        today6 = i === 6;
      c.beginPath();
      c.arc(x, y, 3.4, 0, Math.PI * 2);
      if (ch === '1') {
        c.fillStyle = col;
        c.fill();
      } else if (ch === 'f') {
        c.strokeStyle = '#8FB8FF';
        c.lineWidth = 1.2;
        c.stroke();
      } else if (today6) {
        c.strokeStyle = 'rgba(255,255,255,0.4)';
        c.lineWidth = 1.1;
        c.stroke();
      } else {
        c.fillStyle = 'rgba(255,255,255,0.1)';
        c.fill();
      }
      const wd = (now.getDay() - (6 - i) + 7) % 7;
      textAt(c, tr(s, letters[wd] as string), x, y0 + IT_BODY2 + 0.5, {
        size: 8.5,
        weight: today6 ? 600 : 400,
        color: today6 ? L_SUB : L_FAINT,
        align: 'center',
      });
    }
    const n = [...r.week].filter((ch) => ch === '1').length;
    bodyLine(c, `${n}/7`, tx + 4 + 6 * step + 14, y0 + IT_BODY, tmax - (6 * step + 18));
  }
  // its actions, as a message's: mark it (one more on the way to the goal), open it in Almanac;
  // a done habit can be unmarked, quietly
  const acts: Act[] = r.done
    ? [
        { label: tr(s, 'Открыть в Almanac'), short: tr(s, 'В Almanac'), act: 'alweb:' + r.id, tone: 'lead', out: true },
        { label: tr(s, 'Снять отметку'), short: tr(s, 'Снять'), act: 'almanac:' + r.id, tone: 'quiet' },
      ]
    : [
        { label: tr(s, goal > 1 && count > 0 ? 'Ещё раз' : 'Отметить'), act: 'almanac:' + r.id, tone: 'lead' },
        {
          label: tr(s, 'Открыть в Almanac'),
          short: tr(s, 'В Almanac'),
          act: 'alweb:' + r.id,
          tone: 'plain',
          out: true,
        },
      ];
  actionRow(s, c, acts, col, tx, y0 + IT_ACT, tmax);
}

/** a "label ... value" row with a small icon, as coucou's stats */
function statRow(
  c: Ctx,
  icon: (x: number, y: number) => void,
  label: string,
  value: string,
  tx: number,
  y: number,
  tmax: number,
  valueColor = VAL,
): void {
  // label and value stay together on a wide card (the event card is twice as wide as the home one)
  tmax = Math.min(tmax, 240);
  icon(tx + 6, y);
  c.save();
  c.font = '600 12px Onest, system-ui, sans-serif';
  const vw = c.measureText(value).width;
  c.restore();
  textAt(c, label, tx + 18, y + 0.5, { size: 11.5, weight: 400, color: DIM, max: Math.max(20, tmax - 30 - vw) });
  textAt(c, value, tx + tmax, y + 0.5, { size: 12, weight: 600, color: valueColor, align: 'right' });
}

/** a list row: a dot of its colour, the name, a quiet note on the right; the first one leads on a
 * faint wash of its colour, as coucou's lists */
function listRow(
  c: Ctx,
  accent: string,
  first: boolean,
  name: string,
  meta: string,
  tx: number,
  y: number,
  tmax: number,
  lead = '',
): void {
  // every row sits on a faint plate, the first on a wash of its colour (coucou's mail list)
  c.fillStyle = first ? hexA(accent, 0.08) : 'rgba(255,255,255,0.03)';
  rrect(c, tx - 6, y - 10, tmax + 6, 20, 6);
  c.fill();
  c.fillStyle = accent;
  c.beginPath();
  c.arc(tx + 3, y, 2.6, 0, Math.PI * 2);
  c.fill();
  let x = tx + 12;
  if (lead) {
    textAt(c, lead, x, y + 0.5, { size: 11, weight: 500, mono: true, color: '#C9956A' });
    c.save();
    c.font = '500 11px "JetBrains Mono", monospace';
    x += c.measureText(lead).width + 7;
    c.restore();
  }
  c.save();
  c.font = '400 11px Onest, system-ui, sans-serif';
  const mw = meta ? c.measureText(meta).width + 10 : 0;
  c.restore();
  textAt(c, name, x, y + 0.5, { size: 11.5, weight: 500, color: first ? VAL : DIM, max: tx + tmax - x - mw });
  if (meta) textAt(c, meta, tx + tmax, y + 0.5, { size: 11, weight: 400, color: DIM3, align: 'right' });
}

/** small row icons in one line style */
function rowIcon(c: Ctx, kind: 'review' | 'clock' | 'commits', x: number, y: number, col = DIM3): void {
  c.save();
  c.strokeStyle = col;
  c.lineWidth = 1.2;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  if (kind === 'review') {
    c.ellipse(x, y, 5.2, 3.4, 0, 0, Math.PI * 2);
    c.moveTo(x + 1.6, y);
    c.arc(x, y, 1.6, 0, Math.PI * 2);
  } else if (kind === 'clock') {
    c.arc(x, y, 4.8, 0, Math.PI * 2);
    c.moveTo(x, y - 2.6);
    c.lineTo(x, y);
    c.lineTo(x + 1.8, y + 1.2);
  } else {
    c.moveTo(x - 4.5, y);
    c.lineTo(x - 1.8, y);
    c.moveTo(x + 1.8, y);
    c.lineTo(x + 4.5, y);
    c.moveTo(x + 1.8, y);
    c.arc(x, y, 1.8, 0, Math.PI * 2);
  }
  c.stroke();
  c.restore();
}

/** a status disc: filled circle of the state's colour with a check, cross or dash */
function stateDisc(c: Ctx, x: number, y: number, st: 'ok' | 'fail' | 'run' | 'none'): void {
  const col = st === 'ok' ? '#22C55E' : st === 'fail' ? '#F4505E' : st === 'run' ? '#3D8BFF' : '#6B7079';
  c.save();
  c.fillStyle = col;
  c.beginPath();
  c.arc(x, y, 5, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#0B0B0D';
  c.lineWidth = 1.4;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  if (st === 'ok') {
    c.moveTo(x - 2.2, y);
    c.lineTo(x - 0.6, y + 1.6);
    c.lineTo(x + 2.3, y - 1.6);
  } else if (st === 'fail') {
    c.moveTo(x - 1.8, y - 1.8);
    c.lineTo(x + 1.8, y + 1.8);
    c.moveTo(x + 1.8, y - 1.8);
    c.lineTo(x - 1.8, y + 1.8);
  } else {
    c.moveTo(x - 2, y);
    c.lineTo(x + 2, y);
  }
  c.stroke();
  c.restore();
}

/** proto: QUESTION */
export const QUESTION: readonly [string, readonly string[]] = [
  'Какой раннер тестов взять?',
  ['Vitest', 'Jest', 'Playwright'],
];

/** proto: TOOL_TAG */
export const TOOL_TAG: Readonly<Record<ToolKind, readonly [string, string]>> = {
  read: ['R', 'rgba(255,255,255,0.55)'],
  edit: ['E', '#5FD27D'],
  bash: ['$', '#F5B94A'],
  grep: ['/', '#5FD6F0'],
};

/** a tool as a line glyph in a rounded square - one family, as Grok Bot's step icons (2026-10-19):
 * terminal prompt, page lines, pencil, magnifier */
function toolIcon(c: Ctx, kind: ToolKind, x: number, y: number, col: string, z = 1): void {
  c.save();
  c.translate(x, y);
  c.scale(z, z);
  c.strokeStyle = col;
  c.lineWidth = 1.15;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  rrect(c, -5.5, -5.5, 11, 11, 2.6);
  c.stroke();
  c.beginPath();
  if (kind === 'bash') {
    c.moveTo(-3, -1.8);
    c.lineTo(-1.2, 0);
    c.lineTo(-3, 1.8);
    c.moveTo(0.2, 2.2);
    c.lineTo(2.8, 2.2);
  } else if (kind === 'read') {
    c.moveTo(-2.6, -2);
    c.lineTo(2.6, -2);
    c.moveTo(-2.6, 0.2);
    c.lineTo(2.6, 0.2);
    c.moveTo(-2.6, 2.4);
    c.lineTo(0.6, 2.4);
  } else if (kind === 'edit') {
    c.moveTo(-2.6, 2.6);
    c.lineTo(-2.2, 1);
    c.lineTo(1.6, -2.8);
    c.lineTo(2.8, -1.6);
    c.lineTo(-1, 2.2);
    c.closePath();
  } else {
    c.arc(-0.6, -0.6, 2.2, 0, Math.PI * 2);
    c.moveTo(1.1, 1.1);
    c.lineTo(2.8, 2.8);
  }
  c.stroke();
  c.restore();
}

function ruCount(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10,
    m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}

/** the session so far, for the line under the current step: steps taken, files changed */
function sessionLine(s: IslandState, cur: number): string {
  // the demo cycles through its steps, so it counts the ones on screen and a few before
  const n = s.agent ? s.agent.steps.length : cur + 3,
    files = new Set<string>();
  for (let i = s.agent ? Math.max(0, cur - 60) : cur - 6; i <= cur; i++) {
    const st = stepAt(s, i);
    if (st && st[0] === 'edit') files.add(st[2]);
  }
  const f = files.size;
  if (s.lang === 'en') return `${n} ${plural(n, 'step', 'steps')} · ${f} ${plural(f, 'file', 'files')} changed`;
  return `${n} ${ruCount(n, 'шаг', 'шага', 'шагов')} · ${f} ${ruCount(f, 'файл изменён', 'файла изменено', 'файлов изменено')}`;
}

/** proto: drawSteps - Grok Bot's step list (2026-10-19): the previous step above, small and dim;
 * the current one in the middle, bigger, a little to the right, with a slow light sweeping over
 * it; under it the session so far (Claude Code's hooks only tell what was done, there is no "next
 * step" to show). A new step rises from below into the middle, the old one shrinks up and away */
export function drawSteps(s: IslandState, c: Ctx, tx: number, y0: number, tmax: number): void {
  const ev = s.event;
  if (!ev) return;
  const cur = stepIndex(s),
    frac = stepFrac(s),
    k = ss(0, 1, frac / 0.22);
  const Y_PREV = y0 + 44,
    Y_CUR = y0 + 68,
    Y_SUM = y0 + 92,
    S_PREV = 11.5,
    S_CUR = 14;
  const row = (
    st: NonNullable<ReturnType<typeof stepAt>>,
    y: number,
    size: number,
    a: number,
    dx: number,
    now: boolean,
  ) => {
    c.save();
    c.globalAlpha *= a;
    const z = size / S_CUR;
    toolIcon(c, st[0], tx + 6 + dx, y, 'rgba(255,255,255,0.75)', 0.82 + 0.3 * z);
    c.font = `${now ? 500 : 400} ${size}px Onest, system-ui, sans-serif`;
    const x = tx + 18 + dx * 1.6,
      label = st[1] + ' ' + st[2],
      diffW = now && st[3] ? 58 : 0;
    const max = Math.max(20, tmax - (x - tx) - diffW);
    if (now) {
      // the light sweep: a brighter band crossing the line every 2.4 s, as Grok Bot's working step
      const w = Math.min(max, c.measureText(label).width),
        ph = (s.t % 2.4) / 1.6,
        bx = x - 40 + (w + 80) * Math.min(1, ph);
      const g = c.createLinearGradient(bx - 40, 0, bx + 40, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.72)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0.72)');
      textAt(c, label, x, y + 0.5, { size, weight: 500, color: 'rgba(255,255,255,0.72)', max });
      if (ph < 1) {
        c.save();
        c.beginPath();
        c.rect(bx - 40, y - size, 80, size * 2);
        c.clip();
        c.fillStyle = g;
        c.textBaseline = 'middle';
        let t = label;
        if (c.measureText(t).width > max) {
          while (t.length > 1 && c.measureText(t + '…').width > max) t = t.slice(0, -1);
          t = t.trimEnd() + '…';
        }
        c.fillText(t, x, y + 0.5);
        c.restore();
      }
      if (st[3]) {
        textAt(c, st[3], tx + tmax - 30, y + 0.5, { size: 12, weight: 500, color: '#5FD27D', align: 'right' });
        textAt(c, st[4] as string, tx + tmax, y + 0.5, { size: 12, weight: 500, color: '#FF6B61', align: 'right' });
      }
    } else textAt(c, label, x, y + 0.5, { size, weight: 400, color: 'rgba(255,255,255,0.8)', max });
    c.restore();
  };
  const prev2 = stepAt(s, cur - 2),
    prev = stepAt(s, cur - 1),
    now = stepAt(s, cur);
  // the one leaving: up and out
  if (prev2 && k < 1) row(prev2, Y_PREV - 18 * k, S_PREV, 0.45 * (1 - k), 0, false);
  // the previous: from the middle up to the top row, shrinking and dimming
  if (prev)
    row(
      prev,
      Y_CUR + (Y_PREV - Y_CUR) * k,
      S_CUR + (S_PREV - S_CUR) * k,
      0.92 + (0.45 - 0.92) * k,
      4 * (1 - k),
      k > 0.99 ? false : k < 0.5,
    );
  // the current: rises from below into the middle
  if (now) row(now, Y_CUR + 12 * (1 - k), S_PREV + (S_CUR - S_PREV) * k, k, 4 * k, true);
  // the summary steps back while the new step passes over it
  textAt(c, sessionLine(s, cur), tx + 18, Y_SUM + 0.5, {
    size: 11,
    weight: 400,
    color: 'rgba(255,255,255,0.38)',
    max: tmax - 18,
  });
}

/** "12 мин назад" - the value of the "last session" row */
function agoText(s: IslandState, at: number | null): string {
  if (at === null) return tr(s, 'не было');
  const min = Math.floor((s.date().getTime() - at) / 60000);
  if (min < 1) return tr(s, 'только что');
  if (min < 60) return tr(s, '{0} мин назад', min);
  const h = Math.floor(min / 60);
  return h < 24 ? tr(s, '{0} ч назад', h) : tr(s, 'давно');
}

/**
 * Not in the prototype (docs/CHANGES.md): coucou's card head - a dot in the module colour, the
 * name, a muted word ("Деплои", "Недавние", "Алерты"), an optional arrow (Vercel: the newest
 * deployment, Grafana: the alert list).
 */
function brandHead(
  s: IslandState,
  c: Ctx,
  id: ModuleId,
  name: string,
  tx: number,
  y0: number,
  x1: number,
  wordIn?: string,
  wordCol = DIM,
  badge?: string,
): void {
  c.fillStyle = MODULE_COL[id].body;
  c.beginPath();
  c.arc(tx + 3.5, y0 + 18, 3.5, 0, Math.PI * 2);
  c.fill();
  textAt(c, name, tx + 13, y0 + 18.5, { size: 12.5, weight: 600, color: INK });
  c.save();
  c.font = '600 12.5px Onest, system-ui, sans-serif';
  const nw = c.measureText(name).width;
  c.restore();
  const word = wordIn ?? tr(s, HEAD_WORD[id] ?? '');
  if (word)
    textAt(c, word, tx + 19 + nw, y0 + 18.5, { size: 11.5, weight: wordCol === DIM ? 400 : 500, color: wordCol });
  // a count in a pill of the module's colour after the word, as coucou's "3 unread"
  if (badge) {
    c.save();
    c.font = '400 11.5px Onest, system-ui, sans-serif';
    const ww = word ? c.measureText(word).width + 8 : 0;
    c.font = '500 11px Onest, system-ui, sans-serif';
    const bw = c.measureText(badge).width + 14;
    c.restore();
    const bx = tx + 19 + nw + ww,
      col = MODULE_COL[id].body;
    c.fillStyle = hexA(col, 0.16);
    rrect(c, bx, y0 + 10, bw, 17, 8.5);
    c.fill();
    textAt(c, badge, bx + bw / 2, y0 + 18.5, { size: 11, weight: 500, color: col, align: 'center' });
  }
  // GitHub: the week of commits as small cells after the name, as coucou's head
  if (id === 'github') {
    const CM = s.github ? s.github.commits : [4, 0, 6, 9, 3, 7, 5],
      mx = Math.max(1, ...CM);
    CM.forEach((v, i) => {
      c.fillStyle = !v ? 'rgba(255,255,255,0.08)' : hexA('#22C55E', 0.25 + 0.75 * (v / mx));
      rrect(c, tx + 21 + nw + i * 9, y0 + 14.5, 7, 7, 1.5);
      c.fill();
    });
  }
  const top = id === 'vercel' && s.vercel && s.vercel.auth === 'ok' ? s.vercel.rows[0] : undefined;
  const act = top
    ? 'vercel:' + top.id
    : id === 'grafana' && s.grafana && s.grafana.auth === 'ok'
      ? 'grafana:alerts'
      : '';
  if (!act) return;
  const bx = x1 - 20,
    by = y0 + 17,
    hov = hovering(s, bx - 11, by - 11, 22, 22);
  c.fillStyle = hov ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.09)';
  c.beginPath();
  c.arc(bx, by, 11, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = hov ? '#FFFFFF' : 'rgba(255,255,255,0.6)';
  c.lineWidth = 1.4;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(bx - 3.5, by + 3.5);
  c.lineTo(bx + 3.5, by - 3.5);
  c.moveTo(bx - 2, by - 3.5);
  c.lineTo(bx + 3.5, by - 3.5);
  c.lineTo(bx + 3.5, by + 2);
  c.stroke();
  addHit(s, c, { x: bx - 11, y: by - 11, w: 22, h: 22, act });
}

/** Cut a string to a width with "…" instead of squeezing it (textAt's max narrows the glyphs). */
/** proto: the habits card's checkbox (drawFocusCard) - pink filled with a tick when done */
function checkBox(c: Ctx, x: number, y: number, on: boolean): void {
  c.strokeStyle = on ? '#F4A9C6' : 'rgba(255,255,255,0.4)';
  c.fillStyle = '#F4A9C6';
  c.lineWidth = 1.4;
  rrect(c, x, y - 5, 10, 10, 3);
  if (on) c.fill();
  else c.stroke();
  if (on) {
    c.strokeStyle = '#16171A';
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(x + 2.5, y);
    c.lineTo(x + 4.5, y + 2.2);
    c.lineTo(x + 7.8, y - 2.4);
    c.stroke();
  }
}

function fit(c: Ctx, str: string, font: string, max: number): string {
  c.save();
  c.font = font;
  let out = str;
  if (c.measureText(out).width > max) {
    while (out.length > 1 && c.measureText(out + '…').width > max) out = out.slice(0, -1);
    out = out.trimEnd() + '…';
  }
  c.restore();
  return out;
}

/** Not in the prototype (docs/CHANGES.md): a Grafana row's dot - red breathing, amber, green. */
function alertDot(c: Ctx, x: number, y: number, st: 'fail' | 'run' | 'ok', t: number): void {
  c.save();
  if (st === 'fail') c.globalAlpha *= 0.6 + 0.4 * Math.sin(t * 5);
  c.fillStyle = st === 'fail' ? '#FF453A' : st === 'run' ? '#F5A524' : '#34C759';
  c.beginPath();
  c.arc(x, y, 2.6, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/**
 * Not in the prototype (docs/CHANGES.md): the picked Grafana dashboard - its title, the panel's
 * last value and a small graph of its last hour; the block opens the dashboard.
 */
function boardBlock(
  s: IslandState,
  c: Ctx,
  b: NonNullable<NonNullable<IslandState['grafana']>['board']>,
  tx: number,
  y: number,
  tmax: number,
): void {
  const h = 36,
    hov = hovering(s, tx - 6, y, tmax + 6, h);
  c.fillStyle = hov ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)';
  rrect(c, tx - 6, y, tmax + 6, h, 8);
  c.fill();
  const gw = Math.min(110, tmax * 0.48),
    gx1 = tx + tmax - 6,
    gx0 = gx1 - gw;
  let lx = tx;
  if (b.firing) {
    alertDot(c, tx + 3, y + 10.5, 'fail', s.t);
    lx = tx + 11;
  }
  // the title takes the whole width; the graph sits under it, right of the value
  const title = fit(c, b.title, '400 10.5px Onest, system-ui, sans-serif', tx + tmax - 6 - lx);
  textAt(c, title, lx, y + 10.5, { size: 10.5, weight: 400, color: T_MUTED });
  textAt(c, b.value, tx, y + 25.5, { size: 14, weight: 600, color: 'rgba(255,255,255,0.92)', max: gx0 - tx - 6 });
  const pts = b.points;
  if (pts.length > 1) {
    const lo = Math.min(...pts),
      hi = Math.max(...pts);
    const gy0 = y + 18,
      gh = h - 22,
      span = hi - lo || 1,
      px = (i: number): number => gx0 + (i / (pts.length - 1)) * gw,
      py = (v: number): number => (hi === lo ? gy0 + gh / 2 : gy0 + gh - ((v - lo) / span) * gh);
    const col = b.firing ? '#FF6B61' : MODULE_COL.grafana.body;
    c.beginPath();
    pts.forEach((v, i) => (i ? c.lineTo(px(i), py(v)) : c.moveTo(px(i), py(v))));
    c.save();
    c.lineTo(gx1, gy0 + gh);
    c.lineTo(gx0, gy0 + gh);
    c.closePath();
    const g = c.createLinearGradient(0, gy0, 0, gy0 + gh);
    g.addColorStop(0, b.firing ? 'rgba(255,107,97,0.28)' : 'rgba(255,140,102,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fill();
    c.restore();
    c.beginPath();
    pts.forEach((v, i) => (i ? c.lineTo(px(i), py(v)) : c.moveTo(px(i), py(v))));
    c.strokeStyle = col;
    c.lineWidth = 1.4;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.stroke();
    c.fillStyle = col;
    c.beginPath();
    c.arc(gx1, py(pts[pts.length - 1] as number), 2, 0, Math.PI * 2);
    c.fill();
  }
  addHit(s, c, { x: tx - 6, y, w: tmax + 6, h, act: 'grafana:board' });
}

/** proto: drawFocusCard - the large card of the module in focus */
/** The CI card on the wide card: the lead line says what happened, the quiet line where (repo,
 * branch, when, the commit), the buttons what can be done. A failure leads with what to do -
 * open the run - and can be re-run or set aside; a success needs nothing, one quiet button. */
function ciCard(s: IslandState, c: Ctx, run: CiRun, tx: number, y0: number, tmax: number): void {
  const fail = run.state === 'fail',
    of = run.total ? tr(s, ' · {0} из {1}', run.done, run.total) : '';
  const lead = fail
    ? run.check
      ? tr(s, 'Упала проверка {0}', run.check)
      : tr(s, 'CI упал')
    : run.state === 'ok'
      ? tr(s, 'Все проверки прошли') + of
      : tr(s, 'Проверки идут') + of;
  stateDisc(c, tx + 6, y0 + ROW0 - 1, run.state);
  textAt(c, lead, tx + 20, y0 + ROW0 - 0.5, { size: 14, weight: 600, color: VAL, max: tmax - 20 });
  // the commit's title is the least needed part: it goes last and is the one cut
  const note = s.ciNote && s.ciNote.key === run.key ? s.ciNote : null,
    where = [run.repo, run.branch, agoText(s, run.at || null)].join(' · ') + (run.title ? ` · «${run.title}»` : '');
  textAt(c, note ? note.text : where, tx + 20, y0 + ROW0 + 19, {
    size: 11.5,
    weight: 400,
    color: note && note.err ? '#F5B94A' : DIM,
    max: tmax - 20,
  });
  const by = y0 + ROW0 + 34,
    bw = (label: string): number => {
      c.save();
      c.font = '500 12px Onest, system-ui, sans-serif';
      const w = c.measureText(label).width + 30;
      c.restore();
      return w;
    };
  const open = tr(s, 'Открыть прогон'),
    rerun = tr(s, 'Перезапустить');
  kbdButton(s, c, tx + 20, by, bw(open), 24, open, '', 'gh:open:' + run.repo, fail);
  if (fail && run.rerun)
    kbdButton(s, c, tx + 28 + bw(open), by, bw(rerun), 24, rerun, '', 'gh:rerun:' + run.repo, false);
  // set aside: a cross in the card's corner, where a dismissal is looked for
  if (fail) {
    const cx = tx + tmax - 2,
      cy = y0 + 20,
      hov = hovering(s, cx - 11, cy - 11, 22, 22);
    c.fillStyle = hov ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.07)';
    c.beginPath();
    c.arc(cx, cy, 11, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = hov ? INK : DIM;
    c.lineWidth = 1.5;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(cx - 3.5, cy - 3.5);
    c.lineTo(cx + 3.5, cy + 3.5);
    c.moveTo(cx + 3.5, cy - 3.5);
    c.lineTo(cx - 3.5, cy + 3.5);
    c.stroke();
    addHit(s, c, { x: cx - 11, y: cy - 11, w: 22, h: 22, act: 'gh:hide' });
  }
}

export function drawFocusCard(
  s: IslandState,
  c: Ctx,
  f: ModuleId,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  fx: WorkFx | null,
): void {
  const m = modules(s),
    it = m.find((i) => i.id === f) as ModuleItem;
  cardMascot(s, c, x0, y0, y1, f, f === 'claude' ? fx : null, propFor(s, f));
  const tx = x0 + 84,
    tmax = x1 - tx - 10;
  // Almanac with habits: every habit of the day in a list, each one a level of its own (stage 10)
  if (it.kind === 'habits' && s.almanac && s.almanac.auth === 'ok' && s.almanac.rows.length) {
    const al = s.almanac;
    drawDepth(s, c, 'almanac', (key) =>
      key.startsWith('item:') && al.rows.some((r) => r.id === key.slice(5))
        ? habitLevel(s, c, al, key.slice(5), tx, y0, tmax)
        : habitList(s, c, it, al, tx, y0, x1, y1, tmax),
    );
    return;
  }
  // GitHub: the summary's rows open the CI of every repository and the PRs waiting for review
  // (stage 10); the wide card of a red CI stays as it was (island/ci.ts)
  if (it.kind === 'ci' && s.github && s.github.auth === 'ok' && !(tmax > 300 && ciRun(s))) {
    const gh = s.github;
    drawDepth(s, c, 'github', (key) => githubLevel(s, c, it, gh, key, tx, y0, x1, y1, tmax));
    return;
  }
  // Vercel: every deployment kept, a list; one opens - its site, or "Повторить" when it failed
  if (it.kind === 'deploy' && s.vercel && s.vercel.auth === 'ok' && s.vercel.rows.length) {
    const vc = s.vercel;
    drawDepth(s, c, 'vercel', (key) => vercelLevel(s, c, it, vc, key, tx, y0, x1, y1, tmax));
    return;
  }
  // the calendar: the next meeting and the day open further - where it is, join the call (stage 10)
  if (it.kind === 'cal' && s.cal && s.cal.mins !== null && s.cal.events && s.cal.events.length) {
    const cal = s.cal;
    drawDepth(s, c, 'cal', (key) => calLevel(s, c, it, cal, key, tx, y0, x1, y1, tmax));
    return;
  }
  // one head for every card; the calendar's says how soon the next meeting is (amber when close)
  const calMins = it.kind === 'cal' ? (s.cal ? s.cal.mins : it.mins) : null;
  if (calMins !== null)
    brandHead(
      s,
      c,
      it.id,
      it.name,
      tx,
      y0,
      x1,
      calMins <= 0 ? tr(s, 'сейчас') : tr(s, 'через {0}', minsText(s, calMins)),
      calMins <= 5 ? '#F5B94A' : DIM,
    );
  else if (it.kind === 'habits')
    brandHead(s, c, it.id, it.name, tx, y0, x1, undefined, DIM, it.total ? `${it.done}/${it.total}` : undefined);
  else if (it.kind === 'music' && !s.musicPlaying) brandHead(s, c, it.id, it.name, tx, y0, x1, tr(s, 'на паузе'));
  else brandHead(s, c, it.id, it.name, tx, y0, x1);
  // one line leads (14 px, bright), the rest step back - as Grok Bot's card reads at a glance
  // plain lines (music, hints): the first one in the value tone, the rest dim - the same system
  const L = (i: number, str: string, color?: string, mono?: boolean): void =>
    textAt(c, str, tx, y0 + ROW0 + i * ROW_STEP, {
      size: mono ? 11 : i === 0 ? 12.5 : 11.5,
      weight: i === 0 ? 500 : 400,
      color: color || (i === 0 ? VAL : DIM),
      ...(mono ? { mono } : {}),
      max: tmax,
    });
  if (it.kind === 'agent') {
    if (it.state === 'work') drawSteps(s, c, tx, y0, tmax);
    else if (it.state === 'search') {
      listRow(c, '#5FD6F0', true, tr(s, 'ищет по проекту'), '', tx, y0 + ROW0, tmax);
      listRow(
        c,
        DIM3,
        false,
        s.agent ? s.agent.search : tr(s, 'grep "rrect(" · 14 совпадений'),
        '',
        tx,
        y0 + ROW0 + ROW_STEP,
        tmax,
      );
    } else if (it.state === 'limit') {
      listRow(c, '#C7C7CC', true, tr(s, 'лимит плана исчерпан'), '', tx, y0 + ROW0, tmax);
      statRow(c, (x, y) => rowIcon(c, 'clock', x, y), tr(s, 'Сброс'), limitText(s), tx, y0 + ROW0 + ROW_STEP, tmax);
      statRow(
        c,
        (x, y) => rowIcon(c, 'commits', x, y),
        tr(s, 'План'),
        s.agent ? s.agent.plan : 'Pro',
        tx,
        y0 + ROW0 + ROW_STEP * 2,
        tmax,
      );
    } else if (it.state === 'think') {
      listRow(c, '#BFA6FF', true, tr(s, s.agent ? 'думает' : 'планирует изменения'), '', tx, y0 + ROW0, tmax);
      listRow(
        c,
        DIM3,
        false,
        s.agent ? s.agent.think : tr(s, 'смотрит структуру проекта'),
        '',
        tx,
        y0 + ROW0 + ROW_STEP,
        tmax,
      );
    } else {
      statRow(c, (x, y) => stateDisc(c, x, y, 'ok'), tr(s, 'Статус'), tr(s, 'свободен'), tx, y0 + ROW0, tmax);
      statRow(
        c,
        (x, y) => rowIcon(c, 'clock', x, y),
        tr(s, 'Последняя сессия'),
        agoText(s, s.agent ? s.agent.lastActive : Date.now() - 12 * 60000),
        tx,
        y0 + ROW0 + ROW_STEP,
        tmax,
      );
    }
  } else if (it.kind === 'ci' && s.github && s.github.auth !== 'ok') {
    // live GitHub with nothing to show: say why and where to connect
    L(0, s.github.hint[0], 'rgba(255,255,255,0.92)');
    L(1, s.github.hint[1], T_MUTED);
  } else if (it.kind === 'ci') {
    // coucou's GitHub card: the numbers as rows, the colour only on the CI disc
    const gh = s.github,
      ci = gh ? gh.ci : it.state === 'off' ? 'none' : it.state;
    const repo = gh && gh.ciText.includes(' · ') ? gh.ciText.split(' · ')[0] : '';
    const ciWord =
      ci === 'ok'
        ? tr(s, 'зелёный')
        : ci === 'fail'
          ? tr(s, 'упал')
          : ci === 'run'
            ? tr(s, 'идёт')
            : tr(s, 'нет проверок');
    const prs = gh ? gh.prs : 2,
      week = (gh ? gh.commits : [4, 0, 6, 9, 3, 7, 5]).reduce((a, b) => a + b, 0);
    // the wide card (an event, a red CI in focus): what happened, where, what to do (island/ci.ts)
    const run = tmax > 300 ? ciRun(s) : null;
    if (run) ciCard(s, c, run, tx, y0, tmax);
    else {
      statRow(
        c,
        (x, y) => stateDisc(c, x, y, ci),
        repo ? tr(s, 'CI · {0}', repo) : tr(s, 'CI основной ветки'),
        ciWord,
        tx,
        y0 + ROW0,
        tmax,
        ci === 'fail' ? '#F4505E' : VAL,
      );
      statRow(c, (x, y) => prIcon(c, x, y), tr(s, 'Ждут ревью'), String(prs), tx, y0 + ROW0 + ROW_STEP, tmax);
      statRow(
        c,
        (x, y) => rowIcon(c, 'commits', x, y),
        tr(s, 'Коммиты за 7 дней'),
        String(week),
        tx,
        y0 + ROW0 + ROW_STEP * 2,
        tmax,
      );
    }
  } else if (it.kind === 'deploy' && s.vercel) {
    // not in the prototype (docs/CHANGES.md): the newest deployments, as coucou's card
    const vc = s.vercel;
    if (vc.auth !== 'ok' || !vc.rows.length) {
      L(0, vc.hint[0], 'rgba(255,255,255,0.92)');
      if (vc.hint[1]) L(1, vc.hint[1], T_MUTED);
    } else
      vc.rows.forEach((r, i) => {
        const y = y0 + 40 + i * 18;
        if (i === 0) {
          c.fillStyle = 'rgba(255,255,255,0.06)';
          rrect(c, tx - 6, y - 9, tmax + 6, 18, 6);
          c.fill();
        }
        deployDot(c, tx + 3, y + 0.5, 2.6, r.state, s.t);
        c.save();
        c.font = '600 11.5px Onest, system-ui, sans-serif';
        const nw = Math.min(c.measureText(r.name).width, tmax - 60);
        c.restore();
        textAt(c, r.name, tx + 12, y + 0.5, {
          size: 11.5,
          weight: 600,
          color: i === 0 ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.75)',
          max: tmax - 60,
        });
        textAt(c, r.ago, tx + 18 + nw, y + 0.5, { size: 11, weight: 400, color: T_MUTED, max: tmax - 18 - nw });
      });
  } else if (it.kind === 'pages' && s.notion) {
    // not in the prototype (docs/CHANGES.md): the pages edited last, as coucou's card; a row opens the page
    const no = s.notion;
    if (no.auth !== 'ok' || !no.rows.length) {
      L(0, no.hint[0], 'rgba(255,255,255,0.92)');
      if (no.hint[1]) L(1, no.hint[1], T_MUTED);
    } else
      no.rows.forEach((r, i) => {
        const y = y0 + 40 + i * 18,
          hov = hovering(s, tx - 6, y - 9, tmax + 6, 18);
        if (hov || i === 0) {
          c.fillStyle = hov ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)';
          rrect(c, tx - 6, y - 9, tmax + 6, 18, 6);
          c.fill();
        }
        if (r.emoji) textAt(c, r.emoji, tx + 3, y + 0.5, { size: 10, weight: 400, align: 'center' });
        else pageMark(c, tx + 3, y + 0.5, 3.6, 'rgba(255,255,255,0.55)');
        c.save();
        c.font = '600 11.5px Onest, system-ui, sans-serif';
        const nw = Math.min(c.measureText(r.title).width, tmax - 60);
        c.restore();
        textAt(c, r.title, tx + 12, y + 0.5, {
          size: 11.5,
          weight: 600,
          color: i === 0 || hov ? '#FFFFFF' : 'rgba(255,255,255,0.75)',
          max: tmax - 60,
        });
        textAt(c, r.ago, tx + 18 + nw, y + 0.5, { size: 11, weight: 400, color: T_MUTED, max: tmax - 18 - nw });
        addHit(s, c, { x: tx - 6, y: y - 9, w: tmax + 6, h: 18, act: 'notion:' + r.id });
      });
  } else if (it.kind === 'alerts' && s.grafana) {
    // not in the prototype (docs/CHANGES.md): the alert rules firing (red) or pending (amber),
    // then the dashboard picked in settings with one panel's last hour
    const gf = s.grafana,
      n = gf.board ? 1 : 3;
    const row = (i: number, dot: 'fail' | 'run' | 'ok', name: string, ago: string): void => {
      const y = y0 + 40 + i * 18;
      if (i === 0 && dot !== 'ok') {
        c.fillStyle = dot === 'fail' ? 'rgba(255,69,58,0.14)' : 'rgba(255,255,255,0.06)';
        rrect(c, tx - 6, y - 9, tmax + 6, 18, 6);
        c.fill();
      }
      alertDot(c, tx + 3, y + 0.5, dot, s.t);
      c.save();
      c.font = '400 11px Onest, system-ui, sans-serif';
      const aw = c.measureText(ago).width;
      c.font = '600 11.5px Onest, system-ui, sans-serif';
      // the name keeps at least 60% of the row; the age gives way first
      const label = fit(c, name, c.font, Math.max(tmax * 0.6, tmax - 18 - aw)),
        nw = c.measureText(label).width;
      c.restore();
      const when = fit(c, ago, '400 11px Onest, system-ui, sans-serif', tmax - 18 - nw);
      textAt(c, label, tx + 12, y + 0.5, {
        size: 11.5,
        weight: 600,
        color: dot === 'run' ? 'rgba(255,255,255,0.75)' : '#FFFFFF',
      });
      textAt(c, when, tx + 18 + nw, y + 0.5, { size: 11, weight: 400, color: T_MUTED });
    };
    if (gf.auth !== 'ok') {
      L(0, gf.hint[0], 'rgba(255,255,255,0.92)');
      if (gf.hint[1]) L(1, gf.hint[1], T_MUTED);
    } else {
      if (gf.rows.length)
        gf.rows.slice(0, n).forEach((r, i) => {
          const more = i === n - 1 && gf.total > n ? '+' + (gf.total - n) : '';
          row(i, r.state, r.name, r.ago && more ? r.ago + ' · ' + more : r.ago || more);
        });
      else if (gf.state === 'ok') {
        row(0, 'ok', gf.hint[0], '');
        if (!gf.board) L(1, gf.hint[1], T_MUTED);
      } else {
        L(0, gf.hint[0], 'rgba(255,255,255,0.92)');
        if (!gf.board && gf.hint[1]) L(1, gf.hint[1], T_MUTED);
      }
      if (gf.board) boardBlock(s, c, gf.board, tx, y0 + 51, tmax);
    }
  } else if (it.kind === 'cal' && s.cal) {
    const cal = s.cal;
    if (cal.mins === null) {
      listRow(c, MODULE_COL.cal.body, true, cal.title, '', tx, y0 + ROW0, tmax);
      if (cal.after) listRow(c, DIM3, false, cal.after, '', tx, y0 + ROW0 + ROW_STEP, tmax);
    } else {
      // the next meeting leads, its time in the warm mono of coucou's lists (how soon is in the head)
      const soon = cal.mins <= 5;
      listRow(c, soon ? '#F5B94A' : MODULE_COL.cal.body, true, cal.title, '', tx, y0 + ROW0, tmax, cal.at);
      if (cal.after) listRow(c, DIM3, false, cal.after, '', tx, y0 + ROW0 + ROW_STEP, tmax);
    }
  } else if (it.kind === 'cal') {
    listRow(
      c,
      it.mins <= 5 ? '#F5B94A' : MODULE_COL.cal.body,
      true,
      tr(s, 'Созвон с командой'),
      '',
      tx,
      y0 + ROW0,
      tmax,
      '15:00',
    );
    listRow(c, DIM3, false, tr(s, 'Лекция'), '', tx, y0 + ROW0 + ROW_STEP, tmax, '17:10');
  } else if (it.kind === 'music') {
    const trk = s.media ? ([s.media.title, s.media.sub] as const) : (TRACKS[s.trackIdx] as readonly [string, string]);
    // live track names pass through; the stub and the "nothing playing" lines are keys
    L(0, s.media && !s.media.idle ? trk[0] : tr(s, trk[0]));
    L(1, s.media && !s.media.idle ? trk[1] : tr(s, trk[1]));
    const by = y1 - 16,
      cx = tx + tmax / 2;
    const ctrl = (x: number, act: string, draw: (x: number) => void): void => {
      const hov = hovering(s, x - 12, by - 11, 24, 22);
      if (hov) {
        c.fillStyle = 'rgba(255,255,255,0.1)';
        c.beginPath();
        c.arc(x, by, 11, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = hov ? INK : VAL;
      draw(x);
      addHit(s, c, { x: x - 12, y: by - 11, w: 24, h: 22, act });
    };
    ctrl(cx - 32, 'm:prev', (x) => {
      c.beginPath();
      c.moveTo(x + 4, by - 5);
      c.lineTo(x - 3, by);
      c.lineTo(x + 4, by + 5);
      c.closePath();
      c.fill();
      c.fillRect(x - 5, by - 5, 2, 10);
    });
    ctrl(cx, 'm:toggle', (x) => {
      if (s.musicPlaying) {
        c.fillRect(x - 5, by - 6, 3.5, 12);
        c.fillRect(x + 1.5, by - 6, 3.5, 12);
      } else {
        c.beginPath();
        c.moveTo(x - 4, by - 6);
        c.lineTo(x + 6, by);
        c.lineTo(x - 4, by + 6);
        c.closePath();
        c.fill();
      }
    });
    ctrl(cx + 32, 'm:next', (x) => {
      c.beginPath();
      c.moveTo(x - 4, by - 5);
      c.lineTo(x + 3, by);
      c.lineTo(x - 4, by + 5);
      c.closePath();
      c.fill();
      c.fillRect(x + 3, by - 5, 2, 10);
    });
  } else if (s.almanac) {
    // not in the prototype (docs/CHANGES.md): today's habits from Almanac, the open ones first;
    // a row marks the habit in Almanac (one tap more for "8 glasses"), like the stub's checkbox
    const al = s.almanac;
    if (al.auth !== 'ok' || !al.rows.length) {
      L(0, al.hint[0], 'rgba(255,255,255,0.92)');
      if (al.hint[1]) L(1, al.hint[1], T_MUTED);
    } else
      al.rows
        .slice(0, 3)
        .forEach((h, i) =>
          habitRow(s, c, h.name, h.done, h.progress ?? '', 'almanac:' + h.id, tx, y0 + ROW0 + i * ROW_STEP, tmax),
        );
  } else {
    s.habits
      .slice(0, 3)
      .forEach((h, i) => habitRow(s, c, tr(s, h[0]), h[1], '', 'habit:' + i, tx, y0 + ROW0 + i * ROW_STEP, tmax));
  }
}

/** proto: drawAsk - approvals and questions: one wide card tinted with the state colour, keyboard answers */
export function drawAsk(
  s: IslandState,
  c: Ctx,
  X0: number,
  X1: number,
  cy0: number,
  cy1: number,
  fx: WorkFx | null,
): void {
  const ev = s.event;
  if (!ev) return;
  const t = s.t;
  const q = ev.type === 'question',
    el = t - ev.start,
    E = EVENTS[ev.type];
  // on an island already open the card comes in by the event sequence (island/eventIn.ts): the
  // plate is drawn outside, widening; the glow and the text come up late
  const k = seq.on ? 1 : ss(0, 1, el / 0.35);
  let dx = 0;
  if (ev.answer === 'deny') {
    const a = t - (ev.answerAt ?? 0);
    dx = Math.sin(a * 42) * 4 * Math.exp(-a * 6);
  }
  c.save();
  c.translate(dx, (1 - k) * -6);
  c.globalAlpha *= k;
  const W = X1 - X0,
    H = cy1 - cy0;
  if (!seq.on) card(c, X0, cy0, W, H, false);
  cardTint(c, X0, cy0, W, H, ev.answer === 'approve' ? '#34C759' : E.color, 0.42 * (seq.on ? seq.tintA : 1));
  if (seq.on) cardFade.a = c.globalAlpha;
  cardMascot(s, c, X0, cy0, cy1, 'claude', fx);
  if (seq.on) {
    cardFade.a = -1;
    c.globalAlpha *= seq.textA;
  }
  // the text block sits in the middle of a card taller than the prototype's (2026-10-19); the
  // timer line stays on the bottom edge
  const top = cy0 + Math.max(0, (H - 100) / 2);
  const tx = X0 + 88,
    tw = X1 - tx - 14;
  c.fillStyle = E.color;
  c.beginPath();
  c.arc(tx + 3, top + 17, 3, 0, Math.PI * 2);
  c.fill();
  textAt(c, 'Claude Code', tx + 12, top + 17.5, { size: 12.5, weight: 600 });
  c.save();
  c.font = '600 12.5px Onest, system-ui, sans-serif';
  const nw = c.measureText('Claude Code').width;
  c.restore();
  textAt(c, tr(s, q ? 'спрашивает' : 'нужно разрешение'), tx + 18 + nw, top + 17.5, {
    size: 12,
    weight: 400,
    color: T_MUTED,
  });
  if (!q) {
    c.fillStyle = 'rgba(255,255,255,0.08)';
    rrect(c, tx, top + 28, tw, 26, 8);
    c.fill();
    const cmd = s.agent ? s.agent.cmd : 'git push origin main',
      n = clamp(Math.floor((el - 0.25) * 40), 0, cmd.length);
    textAt(c, cmd.slice(0, n), tx + 10, top + 41.5, {
      mono: true,
      size: 11.5,
      color: 'rgba(255,255,255,0.9)',
      max: tw - 20,
    });
    if (n < cmd.length || Math.floor(t * 2) % 2) {
      c.save();
      c.font = '400 11.5px "JetBrains Mono", monospace';
      const cw = c.measureText(cmd.slice(0, n)).width;
      c.restore();
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.fillRect(tx + 11 + cw, top + 35, 1.5, 13);
    }
    const by = top + 64;
    if (ev.answer === 'approve') {
      const a = ss(0, 1, (t - (ev.answerAt ?? 0)) / 0.25);
      c.fillStyle = '#34C759';
      rrect(c, tx, by, 190, 24, 12);
      c.fill();
      c.save();
      c.globalAlpha *= a;
      textAt(c, tr(s, '✓ Разрешено'), tx + 95, by + 12.5, { size: 12, align: 'center', color: '#04210E' });
      c.restore();
    } else {
      kbdButton(s, c, tx, by, 102, 24, tr(s, 'Отклонить'), 'N', 'deny', false);
      kbdButton(s, c, tx + 110, by, 104, 24, tr(s, 'Разрешить'), 'Y', 'approve', true);
    }
  } else {
    const Q = (s.agent && s.agent.question) || QUESTION;
    textAt(c, s.agent && s.agent.question ? Q[0] : tr(s, Q[0]), tx, top + 38, { size: 12.5, weight: 600, max: tw });
    let ox = tx,
      full = false;
    Q[1].forEach((opt, i) => {
      c.save();
      c.font = '500 12px Onest, system-ui, sans-serif';
      const w = c.measureText(opt).width + 44;
      c.restore();
      // real options can be long: those that do not fit are answered in the terminal
      if (full || (s.agent && i > 0 && ox + w > tx + tw)) {
        full = true;
        return;
      }
      const y = top + 54,
        sel = ev.choice === i,
        hov = hovering(s, ox, y, w, 24);
      const appear = ss(0, 1, (el - 0.15 - i * 0.08) / 0.25);
      c.save();
      c.globalAlpha *= appear;
      c.translate(0, (1 - appear) * 6);
      c.fillStyle = sel ? '#22C3E6' : hov ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)';
      rrect(c, ox, y, w, 24, 12);
      c.fill();
      c.strokeStyle = sel ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)';
      c.lineWidth = 1;
      rrect(c, ox + 8, y + 5, 14, 14, 4);
      c.stroke();
      textAt(c, sel ? '✓' : String(i + 1), ox + 15, y + 12.5, {
        size: 9.5,
        mono: true,
        align: 'center',
        color: sel ? '#002A33' : 'rgba(255,255,255,0.65)',
      });
      textAt(c, opt, ox + 28, y + 12.5, { size: 12, color: sel ? '#002A33' : 'rgba(255,255,255,0.92)' });
      c.restore();
      if (ev.choice !== undefined && ev.choice < 0) addHit(s, c, { x: ox, y, w, h: 24, act: 'opt:' + i });
      ox += w + 6;
    });
  }
  if (!ev.answer) {
    const left = clamp(1 - el / E.dur, 0, 1);
    c.fillStyle = 'rgba(255,255,255,0.08)';
    rrect(c, tx, cy1 - 9, tw, 2.5, 1.25);
    c.fill();
    c.fillStyle = left < 0.25 ? '#FF6B61' : E.color;
    rrect(c, tx, cy1 - 9, tw * left, 2.5, 1.25);
    c.fill();
  }
  c.restore();
}

/** proto: drawAlert - over-clicked: the mascot reboots, the island explains it with a tinted card and a countdown */
export function drawAlert(s: IslandState, c: Ctx, X0: number, X1: number, cy0: number, cy1: number): void {
  const W = X1 - X0,
    H = cy1 - cy0,
    left = Math.max(0, s.overloadUntil - s.t),
    el = 3.2 - left;
  const k = ss(0, 1, el / 0.3);
  c.save();
  c.globalAlpha *= k;
  c.translate(0, (1 - k) * -6);
  card(c, X0, cy0, W, H, false);
  cardTint(c, X0, cy0, W, H, '#FF5FA2', 0.45);
  cardMascot(s, c, X0, cy0, cy1, null, null);
  const tx = X0 + 88;
  textAt(c, tr(s, 'Слишком много тыков'), tx, cy0 + H / 2 - 9, { size: 14, weight: 600, max: X1 - tx - 14 });
  textAt(
    c,
    left > 0 ? tr(s, 'Перезагружаюсь - вернусь через {0} с', Math.ceil(left)) : tr(s, 'Снова на связи'),
    tx,
    cy0 + H / 2 + 11,
    { size: 12, weight: 400, color: 'rgba(255,255,255,0.6)', max: X1 - tx - 14 },
  );
  c.fillStyle = 'rgba(255,255,255,0.08)';
  rrect(c, tx, cy1 - 14, X1 - tx - 16, 2.5, 1.25);
  c.fill();
  c.fillStyle = '#FF5FA2';
  rrect(c, tx, cy1 - 14, (X1 - tx - 16) * clamp(left / 3.2, 0, 1), 2.5, 1.25);
  c.fill();
  c.restore();
}

/** proto: STARS - fixed pseudo-random stars from Math.sin, no rng */
export const STARS: readonly { a: number; s: number; d: number }[] = Array.from({ length: 110 }, (_, i) => {
  const r1 = Math.sin(i * 12.9898) * 43758.5453,
    r2 = Math.sin(i * 78.233) * 12345.678;
  return { a: (r1 - Math.floor(r1)) * Math.PI * 2, s: 0.35 + (r2 - Math.floor(r2)) * 0.9, d: (i * 0.618) % 1 };
});

/** proto: drawLaunch - a warp of particles flies out of the camera, the mascot appears in the middle and says hello */
export function drawLaunch(s: IslandState, c: Ctx, X0: number, X1: number, cy0: number, cy1: number): void {
  const ev = s.event;
  if (!ev) return;
  const t = s.t;
  const W = X1 - X0,
    H = cy1 - cy0,
    el = t - ev.start,
    cx = (X0 + X1) / 2,
    cy = (cy0 + cy1) / 2;
  card(c, X0, cy0, W, H, false);
  c.save();
  rrect(c, X0, cy0, W, H, 14);
  c.clip();
  const warp = clamp(el / 1.0, 0, 1),
    fade = el > 3.8 ? clamp(1 - (el - 3.8) / 0.8, 0, 1) : 1;
  for (const st of STARS) {
    // fast outward rush during the warp, then a slow drift with a twinkle
    const r = (Math.pow(warp, 1.8) * 0.9 + Math.max(0, el - 1) * 0.06 + st.d * 0.12) * W * 0.55 * st.s;
    const x = cx + Math.cos(st.a) * r,
      y = cy + Math.sin(st.a) * r * 0.42;
    const tw = 0.55 + 0.45 * Math.sin(t * 3 + st.d * 20);
    const a = (warp < 1 ? 0.25 + 0.75 * warp : tw) * fade * 0.85;
    if (warp < 1) {
      const r0 = r * 0.82,
        x0 = cx + Math.cos(st.a) * r0,
        y0 = cy + Math.sin(st.a) * r0 * 0.42;
      c.strokeStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x, y);
      c.stroke();
    } else {
      c.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      c.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
    }
  }
  const glow = clamp((el - 0.6) / 0.8, 0, 1) * fade;
  if (glow > 0) {
    const g = c.createRadialGradient(cx, cy, 4, cx, cy, 70);
    g.addColorStop(0, 'rgba(210,230,255,' + (0.28 * glow).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(210,230,255,0)');
    c.fillStyle = g;
    c.fillRect(cx - 70, cy - 70, 140, 140);
  }
  c.restore();
  const R = 25,
    gy = cy + R * 0.92;
  if (el > 0.9) {
    drawMascot(s, c, cx, gy, R, 'card', '#111112');
    s.mascotSpots.push({ x: cx, y: gy - R, a: c.globalAlpha });
    if (c.globalAlpha > 0.5) s.islandMascot = { x: cx, y: gy - R * 0.92, R };
    addHit(s, c, { x: cx - R * 1.1, y: gy - R * 2, w: R * 2.2, h: R * 2, act: 'mascot', cx, cy: gy - R * 0.92, R });
  }
  const st = statusOf(s);
  if (st && st.text) textAt(c, st.text, cx + R + 22, cy + 0.5, { size: 15, weight: 600 });
}
