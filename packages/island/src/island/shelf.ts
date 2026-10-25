// The "+" tab: a shelf that keeps files, text and links for 10 minutes until they are dragged
// somewhere else (docs/PLAN.md stage 9, docs/CHANGES.md 2026-10-25). The island draws and animates;
// the host keeps the real things (files by reference, text and links in its temp folder), starts
// drags out and opens menus - it gets `shelf:*` requests.
import { clamp, hexA, ss } from '../util/math';
import { rrect, textAt, type Ctx } from '../util/draw';
import type { IslandState, ShelfItem, ShelfKind } from '../sim/state';
import { after } from '../sim/state';
import { hop } from '../sim/actions';
import { tr } from '../i18n';
import { card, cardMascot } from './card';
import { drawMascot } from '../mascot/body';
import { addHit, hovering } from './hits';
import { hoverK, pressScale } from './hover';
import { springK, switchTab } from './reveal';
import { scrollZone } from './depth';
import { notchState } from './focus';

/** how long a thing stays (s): the owner's decision 2026-10-18 */
export const SHELF_LIFE = 600;
/** the last stretch in which a tile shows it is about to go (s): two minutes are enough to notice
 * and drag it out, and the first eight stay quiet - a countdown on every tile all the time would
 * be noise on a shelf that is meant to be glanced at */
export const SHELF_LEAD = 120;
/** a tile at the very end is this transparent: still readable, clearly on its way out */
const END_ALPHA = 0.55;
/** the shelf's own colour: the cool blue of Almanac's mascot halo (card.ts), calm on black */
export const SHELF_ACC = '#8FA8FF';

const TILE_W = 100,
  TILE_GAP = 8,
  /** the mascot's column on the left: cardMascot sits at x0 + 42 */
  KEEPER_W = 88,
  THUMB = 54;

export type ShelfIn = Omit<ShelfItem, 'until'> & { left?: number };

/** Something is carried over the island (null: carried away). The island opens onto the shelf the
 * moment a file comes near, so the person sees where to let go before reaching it. */
export function shelfCarry(s: IslandState, p: { x: number; y: number } | null, n = 0): void {
  const sh = s.shelf;
  if (p) {
    if (!sh.carry) {
      sh.tabBefore = notchState(s) === 'open' ? s.tab : null;
      switchTab(s, 'add');
    }
    sh.carry = { x: p.x, y: p.y, n };
    return;
  }
  if (!sh.carry) return;
  sh.carry = null;
  // carried past without a drop: the island goes back to how it was
  s.hoverLeftAt = s.t;
  const back = sh.tabBefore;
  sh.tabBefore = null;
  if (back) switchTab(s, back);
  else {
    s.clickOpen = false;
    // after the fold, so the tab switch does not show
    after(s, 0.5, () => {
      if (!sh.carry && notchState(s) !== 'open') switchTab(s, 'home');
    });
  }
}

/** Things let go over the island (host: after it has taken them in). Newest go first: what was
 * just dropped is what is dragged out next, and the oldest drift to the end where they expire. */
export function shelfDrop(s: IslandState, items: ShelfIn[], p: { x: number; y: number } | null): void {
  const sh = s.shelf;
  const at = p ?? sh.carry ?? s.islandPtr ?? { x: s.islandBox.x0 + KEEPER_W + 60, y: 90 };
  sh.carry = null;
  sh.tabBefore = null;
  if (!items.length) return;
  if (s.tab !== 'add') switchTab(s, 'add');
  // it stays open to show where things went, then closes as after a click
  s.clickOpen = true;
  s.hoverLeftAt = s.t;
  const ids = items.map((it) => it.id);
  sh.items = [
    ...items.map(({ left, ...it }) => ({ ...it, until: s.t + (left ?? SHELF_LIFE) })),
    ...sh.items.filter((it) => !ids.includes(it.id)),
  ];
  sh.sel = sh.sel.filter((id) => !ids.includes(id));
  sh.drop = { x: at.x, y: at.y, at: s.t, ids };
  sh.look = { x: at.x, y: at.y, until: s.t + 0.5 };
  // the mascot catches it: a small hop and a happy face, smaller than a poke's - it is pleased, not startled
  hop(s, 2.6);
  s.happyUntil = s.t + 0.9;
}

/** Things leave the shelf: dragged out ('sent'), by their time ('expired') or by the menu. */
export function shelfRemove(s: IslandState, ids: string[], how: 'sent' | 'expired' | 'removed'): void {
  const sh = s.shelf;
  sh.items.forEach((it, i) => {
    if (!ids.includes(it.id)) return;
    const x = lastX.get(s)?.get(it.id);
    if (x !== undefined) sh.gone.push({ item: it, at: s.t, x, i, how });
    if (how === 'expired' && x !== undefined) sh.look = { x: x + TILE_W / 2, y: 80, until: s.t + 0.8 };
  });
  sh.items = sh.items.filter((i) => !ids.includes(i.id));
  sh.sel = sh.sel.filter((id) => !ids.includes(id));
}

/** Per frame: tiles past their time leave by themselves (the host deletes its copy on its own clock). */
export function shelfTick(s: IslandState): void {
  const due = s.shelf.items.filter((it) => it.until <= s.t).map((it) => it.id);
  if (due.length) shelfRemove(s, due, 'expired');
  s.shelf.gone = s.shelf.gone.filter((g) => s.t - g.at < GONE_DUR[g.how]);
}

const GONE_DUR = { sent: 0.24, removed: 0.2, expired: 0.6 } as const;
/** the gap a leaving tile keeps before the others close up: they move into an emptied place,
 * not over a tile still fading there */
const GONE_HOLD = { sent: 0.12, removed: 0.1, expired: 0.36 } as const;

/** A press on a tile: picks it (a modifier adds to the pick) and may become a drag out. */
export function shelfPress(s: IslandState, id: string, p: { x: number; y: number }, multi: boolean): void {
  const sh = s.shelf;
  if (multi) sh.sel = sh.sel.includes(id) ? sh.sel.filter((x) => x !== id) : [...sh.sel, id];
  else if (!sh.sel.includes(id)) sh.sel = [id];
  sh.press = { id, x: p.x, y: p.y };
}

/** The pointer moved while pressed: past a few px it is a drag out of everything picked. */
export function shelfMove(s: IslandState, p: { x: number; y: number }): void {
  const pr = s.shelf.press;
  if (!pr || Math.hypot(p.x - pr.x, p.y - pr.y) < 5) return;
  s.shelf.press = null;
  s.requests.push('shelf:drag:' + pickOf(s, pr.id).join(','));
}

/** the ids a drag or the menu acts on: the pick when the tile is in it, else just the tile */
export function pickOf(s: IslandState, id: string): string[] {
  const sel = s.shelf.sel;
  return sel.includes(id) ? s.shelf.items.filter((it) => sel.includes(it.id)).map((it) => it.id) : [id];
}

// ---------- drawing ----------

/** tile x positions on a spring, so tiles make room and close up instead of jumping */
const xs = new WeakMap<IslandState, Map<string, { x: number; v: number; last: number }>>();
/** where each tile was drawn last frame: a tile that leaves fades out from there */
const lastX = new WeakMap<IslandState, Map<string, number>>();

function slide(s: IslandState, id: string, target: number): number {
  let m = xs.get(s);
  if (!m) xs.set(s, (m = new Map()));
  let sp = m.get(id);
  if (!sp) m.set(id, (sp = { x: target, v: 0, last: s.t }));
  // response 0.4 s, damping 0.85: the same family as the tab capsule's spring, a touch softer
  const w = (2 * Math.PI) / 0.4,
    k = w * w,
    c = 2 * 0.85 * w;
  let dt = clamp(s.t - sp.last, 0, 0.1);
  sp.last = s.t;
  while (dt > 0) {
    const h = Math.min(dt, 1 / 240);
    sp.v += (-k * (sp.x - target) - c * sp.v) * h;
    sp.x += sp.v * h;
    dt -= h;
  }
  return sp.x;
}

/** proto: drawAdd - replaced by the shelf (docs/CHANGES.md 2026-10-25) */
export function drawShelf(s: IslandState, c: Ctx, X0: number, X1: number, y0: number, y1: number): void {
  const sh = s.shelf,
    H = y1 - y0,
    carryK = clamp(hoverK(s, 'shelf-carry', !!sh.carry, 0.25, 0.8), 0, 1.2);
  if (!sh.items.length && !sh.gone.length) return drawEmpty(s, c, X0, X1, y0, y1, carryK);
  // the first drop onto an empty shelf: its big card dissolves under the tiles instead of vanishing
  const d = sh.drop,
    first = d && sh.items.every((it) => d.ids.includes(it.id)) ? s.t - d.at : -1,
    dissolve = first >= 0 && first < 0.3;
  if (dissolve) {
    c.save();
    c.globalAlpha *= 1 - ss(0, 0.3, first);
    card(c, X0, y0, X1 - X0, H, false);
    // the words go quicker than the card: they are about the empty shelf that is no more
    c.globalAlpha *= 1 - ss(0, 0.15, first);
    emptyText(s, c, X0, X1, y0, y1, 1);
    c.restore();
  }
  // the outline that says "let go here" while something is carried over a full shelf
  if (carryK > 0.01) dropFrame(s, c, X0, y0, X1 - X0, H, carryK, dissolve ? 1 : 0);
  keeper(s, c, X0, X1, y0, y1, carryK);
  const rx0 = X0 + KEEPER_W,
    rw = X1 - rx0,
    // a carried file opens a slot at the front: where it will land
    open = sh.carry ? 1 : 0,
    n = sh.items.length + open;
  let mx = lastX.get(s);
  if (!mx) lastX.set(s, (mx = new Map()));
  const seen = new Set<string>();
  const off = scrollZone(s, c, 'shelf', rx0, y0, rw, H, Math.max(0, n * (TILE_W + TILE_GAP) - TILE_GAP - rw));
  c.save();
  c.beginPath();
  c.rect(rx0 - 4, y0 - 6, rw + 8, H + 12);
  c.clip();
  // the slot shows once the tiles have made room for it, not over the first one still moving
  const lead = sh.items[0] ? (mx.get(sh.items[0].id) ?? rx0) : rx0 + TILE_W + TILE_GAP;
  if (open)
    placeholder(s, c, slide(s, '__slot', rx0 - off), y0, H, carryK * ss(0.55, 1, (lead - rx0) / (TILE_W + TILE_GAP)));
  // the row with the gaps of tiles that are still leaving
  const row: (ShelfItem | null)[] = [...sh.items];
  for (const g of [...sh.gone].sort((a, b) => a.i - b.i))
    if (s.t - g.at < GONE_HOLD[g.how]) row.splice(Math.min(g.i, row.length), 0, null);
  row.forEach((it, i) => {
    if (!it) return;
    const x = slide(s, it.id, rx0 + (i + open) * (TILE_W + TILE_GAP) - off);
    seen.add(it.id);
    mx.set(it.id, x);
    if (x > X1 + 4 || x + TILE_W < rx0 - 4) return;
    // fade at the edge only where tiles go on past it
    const edge = Math.min(clamp((x + TILE_W - rx0) / 24, 0, 1), clamp((X1 - x) / 24, 0, 1));
    c.save();
    c.globalAlpha *= x < rx0 || x + TILE_W > X1 ? edge : 1;
    tile(s, c, it, x, y0, H);
    c.restore();
  });
  for (const g of sh.gone) gone(s, c, g, y0, H);
  c.restore();
  for (const id of mx.keys()) if (!seen.has(id)) mx.delete(id);
}

function drawEmpty(s: IslandState, c: Ctx, X0: number, X1: number, y0: number, y1: number, carryK: number): void {
  const W = X1 - X0,
    H = y1 - y0;
  card(c, X0, y0, W, H, false);
  dropFrame(s, c, X0, y0, W, H, carryK, 1);
  keeper(s, c, X0, X1, y0, y1, carryK);
  emptyText(s, c, X0, X1, y0, y1, carryK);
}

function emptyText(s: IslandState, c: Ctx, X0: number, X1: number, y0: number, y1: number, carryK: number): void {
  // the bigger mascot of the new styles needs a little more room before the words
  const tx = X0 + KEEPER_W + (s.shelf.style === 'old' ? 8 : 18),
    cy = (y0 + y1) / 2,
    max = X1 - tx - 16;
  // what to do, then the two rules the person needs before trusting it with a file
  const title = carryK > 0.5 ? tr(s, 'Отпустите - положу на полку') : tr(s, 'Бросьте сюда файлы, текст или ссылку');
  textAt(c, title, tx, cy - 10, { size: 14, weight: 600, color: mixWhite(carryK), max });
  textAt(c, tr(s, 'Полежат 10 минут. Оригиналы останутся на месте'), tx, cy + 11, {
    size: 12,
    color: '#8E939C',
    max,
  });
}

/** text colour that leans to the shelf's blue while a file is over it */
function mixWhite(k: number): string {
  const a = clamp(k, 0, 1);
  const r = Math.round(0xf5 + (0xc4 - 0xf5) * a),
    g = Math.round(0xf6 + (0xd0 - 0xf6) * a),
    b = Math.round(0xf8 + (0xff - 0xf8) * a);
  return `rgb(${r},${g},${b})`;
}

/** The shelf's colour for its frame and picks. The first version's blue (Almanac's mascot halo)
 * read as a colour of its own with no meaning here (owner, 2026-10-25); the variants use a soft
 * white - the island's own light. */
function acc(s: IslandState): string {
  return s.shelf.style === 'old' ? SHELF_ACC : '#E6EAF0';
}

/** the shelf's mascot: bigger than a card's (it is the only figure on the tab) */
const KEEPER_R = 30;

/** The mascot that keeps the shelf (owner, 2026-10-25: the card mascot was small, did not react
 * to a carried file and had a blue halo that meant nothing here). Three ways to meet a file:
 * - catch: it grows towards a carried file, a light under it brightens as the file comes nearer,
 *   one ring goes out when it lands - "it comes to me, I have it";
 * - reach: it leans and slides towards the file, the spot where the file will land lights up -
 *   "there, that is where it goes";
 * - breath: the card's edge glows in the mascot's breathing rhythm while a file is carried -
 *   calm, the shelf and the mascot are one thing. */
function keeper(s: IslandState, c: Ctx, X0: number, X1: number, y0: number, y1: number, carryK: number): void {
  const sh = s.shelf,
    st = sh.style;
  if (st === 'old') return cardMascot(s, c, X0, y0, y1, null, null);
  const a = clamp(carryK, 0, 1),
    R = KEEPER_R,
    mx = X0 + KEEPER_W / 2,
    cy = (y0 + y1) / 2 + 2,
    gy = cy + R * 0.92,
    near = sh.carry ? 1 - clamp(Math.hypot(sh.carry.x - mx, sh.carry.y - cy) / 360, 0, 1) : 0,
    age = sh.drop ? s.t - sh.drop.at : 9;
  let grow = 1,
    dx = 0;
  c.save();
  if (st === 'catch') {
    grow = 1 + 0.12 * a * (0.5 + 0.5 * near);
    const la = 0.05 + 0.26 * a * (0.35 + 0.65 * near),
      g = c.createRadialGradient(mx, gy, 2, mx, gy, R * 2.3);
    g.addColorStop(0, `rgba(255,255,255,${la})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(mx - R * 2.4, gy - R * 2.4, R * 4.8, R * 4.8);
  } else if (st === 'reach') {
    if (sh.carry) {
      dx = clamp((sh.carry.x - mx) * 0.05, -6, 14) * a;
      const g = c.createRadialGradient(sh.carry.x, sh.carry.y, 4, sh.carry.x, sh.carry.y, 80);
      g.addColorStop(0, `rgba(255,255,255,${0.16 * a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(sh.carry.x - 80, sh.carry.y - 80, 160, 160);
    }
    grow = 1 + 0.05 * a;
  } else if (st === 'breath' && a > 0.01) {
    const pulse = 0.5 + 0.5 * Math.sin((s.t * 2 * Math.PI) / 3.6),
      ea = a * (0.14 + 0.16 * pulse);
    c.shadowColor = `rgba(255,255,255,${ea})`;
    c.shadowBlur = 18;
    c.strokeStyle = `rgba(255,255,255,${ea})`;
    c.lineWidth = 1.5;
    rrect(c, X0 + 1, y0 + 1, X1 - X0 - 2, y1 - y0 - 2, 13);
    c.stroke();
    c.shadowBlur = 0;
    grow = 1 + 0.06 * a;
  }
  // the landing: one ring, from the mascot (catch, breath) or from where the file fell (reach)
  if (age < 0.6 && sh.drop) {
    const e = 1 - Math.pow(1 - age / 0.6, 3),
      rx = st === 'reach' ? sh.drop.x : mx,
      ry = st === 'reach' ? sh.drop.y : cy;
    c.strokeStyle = `rgba(255,255,255,${0.32 * (1 - age / 0.6)})`;
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(rx, ry, R * 1.05 + 46 * e, 0, Math.PI * 2);
    c.stroke();
  }
  c.restore();
  const x = mx + dx;
  c.save();
  c.translate(x, gy);
  c.scale(grow, grow);
  c.translate(-x, -gy);
  drawMascot(s, c, x, gy, R, 'card', '#141415', null);
  c.restore();
  s.mascotSpots.push({ x, y: gy - R, a: c.globalAlpha });
  if (c.globalAlpha > 0.5) s.islandMascot = { x, y: cy, R };
  addHit(s, c, { x: x - R * 1.1, y: gy - R * 2, w: R * 2.2, h: R * 2, act: 'mascot', cx: x, cy, R });
}

/** The dashed outline: barely there at rest (an empty shelf still reads as a place), the shelf's
 * blue and slowly moving while something is carried over it, with light from below. */
function dropFrame(s: IslandState, c: Ctx, x: number, y: number, w: number, h: number, k: number, rest: number): void {
  const a = clamp(k, 0, 1);
  c.save();
  if (a > 0.01) {
    const g = c.createRadialGradient(x + w / 2, y + h + 20, 10, x + w / 2, y + h + 20, w * 0.6);
    g.addColorStop(0, hexA(acc(s), 0.16 * a));
    g.addColorStop(1, hexA(acc(s), 0));
    c.fillStyle = g;
    rrect(c, x, y, w, h, 14);
    c.fill();
  }
  c.setLineDash([5, 6]);
  // moving only while carried: a still frame at rest does not pull the eye
  c.lineDashOffset = -s.t * 16 * a;
  c.lineWidth = 1.25;
  c.strokeStyle = a > 0.01 ? hexA(acc(s), 0.12 * rest * (1 - a) + 0.7 * a) : `rgba(255,255,255,${0.13 * rest})`;
  rrect(c, x + 0.75, y + 0.75, w - 1.5, h - 1.5, 13.5);
  c.stroke();
  c.restore();
}

/** the slot a carried file will land in */
function placeholder(s: IslandState, c: Ctx, x: number, y: number, h: number, k: number): void {
  c.save();
  c.globalAlpha *= clamp(k, 0, 1);
  c.setLineDash([4, 5]);
  c.lineDashOffset = -s.t * 16;
  c.lineWidth = 1.25;
  c.strokeStyle = hexA(acc(s), 0.6);
  rrect(c, x + 0.75, y + 0.75, TILE_W - 1.5, h - 1.5, 12);
  c.stroke();
  c.strokeStyle = hexA(acc(s), 0.8);
  c.setLineDash([]);
  c.lineWidth = 1.5;
  c.lineCap = 'round';
  const cx = x + TILE_W / 2,
    cy = y + h / 2;
  c.beginPath();
  c.moveTo(cx - 6, cy);
  c.lineTo(cx + 6, cy);
  c.moveTo(cx, cy - 6);
  c.lineTo(cx, cy + 6);
  c.stroke();
  c.restore();
}

/** One thing on the shelf: its picture, its name with the extension kept, a quiet second line. */
function tile(s: IslandState, c: Ctx, it: ShelfItem, x: number, y: number, h: number): void {
  const sh = s.shelf,
    act = 'shelf:' + it.id,
    sel = sh.sel.includes(it.id),
    hov = hovering(s, x, y, TILE_W, h),
    hk = clamp(hoverK(s, act, hov, 0.2, 0.7), 0, 1.2),
    left = it.until - s.t,
    endK = ss(0, 1, (SHELF_LEAD - left) / SHELF_LEAD);
  // landing: the picture flies from where it was dropped into its place, a little after the one before
  const d = sh.drop,
    j = d ? d.ids.indexOf(it.id) : -1,
    land = d && j >= 0 ? springK(s.t - d.at - j * 0.05, 0.45, 0.72) : 1,
    landing = land < 0.999 || (d !== null && j >= 0 && s.t - d.at - j * 0.05 < 0);
  c.save();
  c.globalAlpha *= 1 - (1 - END_ALPHA) * endK;
  const ps = pressScale(s, act);
  if (ps !== 1) {
    c.translate(x + TILE_W / 2, y + h / 2);
    c.scale(ps, ps);
    c.translate(-x - TILE_W / 2, -y - h / 2);
  }
  // the plate and the text come in under the flying picture
  const plateA = landing ? ss(0.35, 0.9, land) : 1,
    textA = landing ? ss(0.75, 1, land) : 1;
  c.save();
  c.globalAlpha *= plateA;
  c.fillStyle = `rgba(255,255,255,${sel ? 0.14 : 0.075 + 0.04 * hk})`;
  rrect(c, x, y, TILE_W, h, 12);
  c.fill();
  if (sel) {
    c.lineWidth = 1.5;
    c.strokeStyle = hexA(acc(s), 0.8);
    rrect(c, x + 0.75, y + 0.75, TILE_W - 1.5, h - 1.5, 11.25);
    c.stroke();
  }
  c.restore();
  const tcx = x + TILE_W / 2,
    tcy = y + 14 + THUMB / 2;
  if (landing && d) {
    const k = Math.max(0, land),
      fx = d.x + (j - (d.ids.length - 1) / 2) * 6,
      px = fx + (tcx - fx) * k,
      py = d.y + (tcy - d.y) * k,
      sc = 0.85 + 0.15 * k;
    c.save();
    c.translate(px, py);
    c.scale(sc, sc);
    picture(s, c, it, 0, 0);
    c.restore();
  } else picture(s, c, it, tcx, tcy);
  c.save();
  c.globalAlpha *= textA;
  // a file's name is cut in the middle to keep its extension; text and links read from the start
  const named = it.kind === 'text' || it.kind === 'link';
  textAt(c, named ? it.name : midCut(c, it.name, TILE_W - 14), tcx, y + 14 + THUMB + 16, {
    max: TILE_W - 14,
    size: 12,
    weight: 500,
    color: '#F5F6F8',
    align: 'center',
  });
  textAt(c, metaOf(s, it, hov && left < SHELF_LEAD ? left : null), tcx, y + 14 + THUMB + 33, {
    size: 11,
    color: '#8E939C',
    align: 'center',
    max: TILE_W - 14,
  });
  // the time running out: a thin line along the bottom that shortens over the last two minutes
  if (endK > 0) {
    const fr = clamp(left / SHELF_LEAD, 0, 1),
      lw = (TILE_W - 28) * fr;
    c.strokeStyle = 'rgba(255,255,255,0.32)';
    c.lineWidth = 2;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x + 14, y + h - 9);
    c.lineTo(x + 14 + Math.max(0.01, lw), y + h - 9);
    c.stroke();
  }
  c.restore();
  c.restore();
  addHit(s, c, { x, y, w: TILE_W, h, act });
}

/** a tile on its way out, where it was */
function gone(s: IslandState, c: Ctx, g: IslandState['shelf']['gone'][number], y: number, h: number): void {
  const k = clamp((s.t - g.at) / GONE_DUR[g.how], 0, 1);
  c.save();
  // sent: lifts a little as it goes, as if taken; expired: sinks back into the island
  const dy = g.how === 'sent' ? -8 * ss(0, 1, k) : g.how === 'expired' ? 4 * k : 0,
    sc = g.how === 'expired' ? 1 - 0.08 * k : 1 - 0.05 * k;
  c.globalAlpha *= (1 - ss(0, 1, k)) * (g.how === 'expired' ? END_ALPHA : 1);
  c.translate(g.x + TILE_W / 2, y + h / 2 + dy);
  c.scale(sc, sc);
  c.translate(-g.x - TILE_W / 2, -y - h / 2);
  c.fillStyle = 'rgba(255,255,255,0.075)';
  rrect(c, g.x, y, TILE_W, h, 12);
  c.fill();
  picture(s, c, g.item, g.x + TILE_W / 2, y + 14 + THUMB / 2);
  textAt(c, midCut(c, g.item.name, TILE_W - 14), g.x + TILE_W / 2, y + 14 + THUMB + 16, {
    size: 12,
    color: '#F5F6F8',
    align: 'center',
  });
  c.restore();
}

/** the tile's picture centred at (cx, cy): the host's preview, or a glyph of the type */
function picture(s: IslandState, c: Ctx, it: ShelfItem, cx: number, cy: number): void {
  if (it.thumb) {
    const img = it.thumb as CanvasImageSource & { width: number; height: number },
      iw = img.width || 1,
      ih = img.height || 1,
      k = Math.min(THUMB / iw, THUMB / ih),
      w = iw * k,
      h = ih * k;
    c.save();
    rrect(c, cx - w / 2, cy - h / 2, w, h, 6);
    c.clip();
    c.drawImage(it.thumb, cx - w / 2, cy - h / 2, w, h);
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,0.1)';
    c.lineWidth = 1;
    rrect(c, cx - w / 2 + 0.5, cy - h / 2 + 0.5, w - 1, h - 1, 6);
    c.stroke();
    return;
  }
  glyph(s, c, it, cx, cy);
}

/** families by extension: the colour says what kind of thing it is before the name is read */
const FAMILY: [RegExp, string][] = [
  [/^(png|jpe?g|gif|webp|heic|heif|svg|bmp|tiff?|avif|ico)$/, '#FFD27A'],
  [/^(pdf|docx?|pages|rtf|odt|txt|md|epub)$/, '#B8C2FF'],
  [/^(xlsx?|numbers|csv|ods|tsv)$/, '#9EE6B8'],
  [/^(pptx?|key|odp)$/, '#F0B08A'],
  [/^(zip|rar|7z|tar|gz|tgz|bz2|xz|dmg|pkg|iso)$/, '#E8C39E'],
  [/^(mp3|wav|aiff?|flac|m4a|ogg|mp4|mov|m4v|avi|mkv|webm)$/, '#F4A9C6'],
  [/^(ts|tsx|js|jsx|json|rs|py|go|swift|kt|java|c|cpp|h|cs|rb|php|sh|html|css|yml|yaml|toml|sql)$/, '#C9B8FF'],
];

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : '';
}

function familyCol(kind: ShelfKind, ext: string): string {
  if (kind === 'link' || kind === 'folder') return SHELF_ACC;
  if (kind === 'text') return '#C5C8CD';
  for (const [re, col] of FAMILY) if (re.test(ext)) return col;
  return '#C5C8CD';
}

function glyph(s: IslandState, c: Ctx, it: ShelfItem, cx: number, cy: number): void {
  const ext = extOf(it.name),
    col = familyCol(it.kind, ext);
  c.save();
  c.lineWidth = 1.25;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.fillStyle = hexA(col, 0.14);
  c.strokeStyle = hexA(col, 0.75);
  if (it.kind === 'folder') {
    const w = 46,
      h = 34,
      x = cx - w / 2,
      y = cy - h / 2 + 2;
    c.beginPath();
    c.moveTo(x + 4, y - 5);
    c.lineTo(x + 16, y - 5);
    c.lineTo(x + 20, y);
    c.lineTo(x + w - 4, y);
    c.arcTo(x + w, y, x + w, y + 4, 4);
    c.lineTo(x + w, y + h - 4);
    c.arcTo(x + w, y + h, x + w - 4, y + h, 4);
    c.lineTo(x + 4, y + h);
    c.arcTo(x, y + h, x, y + h - 4, 4);
    c.lineTo(x, y - 1);
    c.arcTo(x, y - 5, x + 4, y - 5, 4);
    c.closePath();
    c.fill();
    c.stroke();
  } else if (it.kind === 'link') {
    // two links of a chain, at an angle
    c.translate(cx, cy);
    c.rotate(-Math.PI / 4);
    c.lineWidth = 2;
    rrect(c, -15, -6, 18, 12, 6);
    c.stroke();
    rrect(c, -3, -6, 18, 12, 6);
    c.stroke();
  } else {
    // a sheet with a folded corner; text shows lines, a file its extension
    const w = 40,
      h = 50,
      x = cx - w / 2,
      y = cy - h / 2,
      f = 11;
    c.beginPath();
    c.moveTo(x + 5, y);
    c.lineTo(x + w - f, y);
    c.lineTo(x + w, y + f);
    c.lineTo(x + w, y + h - 5);
    c.arcTo(x + w, y + h, x + w - 5, y + h, 5);
    c.lineTo(x + 5, y + h);
    c.arcTo(x, y + h, x, y + h - 5, 5);
    c.lineTo(x, y + 5);
    c.arcTo(x, y, x + 5, y, 5);
    c.closePath();
    c.fill();
    c.stroke();
    c.beginPath();
    c.moveTo(x + w - f, y);
    c.lineTo(x + w - f, y + f);
    c.lineTo(x + w, y + f);
    c.stroke();
    if (it.kind === 'text' || !ext) {
      c.strokeStyle = hexA(col, 0.55);
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        c.moveTo(x + 9, y + 21 + i * 7);
        c.lineTo(x + w - (i === 2 ? 17 : 9), y + 21 + i * 7);
        c.stroke();
      }
    } else
      textAt(c, ext.slice(0, 4).toUpperCase(), cx, y + h - 15, {
        size: ext.length > 3 ? 9 : 10,
        weight: 700,
        color: col,
        align: 'center',
      });
  }
  c.restore();
}

/** the second line: size or what it is; near the end, on hover, when it goes */
function metaOf(s: IslandState, it: ShelfItem, left: number | null): string {
  if (left !== null) {
    const min = Math.ceil(left / 60);
    return min <= 1 ? tr(s, 'ещё минута') : tr(s, 'ещё {0} мин', min);
  }
  if (it.kind === 'link' || it.kind === 'text')
    // a link's host under its name, unless the name is the host already
    return it.note && it.note !== it.name ? it.note : it.kind === 'link' ? tr(s, 'Ссылка') : tr(s, 'Текст');
  if (it.kind === 'folder') return tr(s, 'Папка');
  return it.size === null ? '' : sizeOf(s, it.size);
}

/** 2,4 МБ / 2.4 MB: one decimal below 10, whole numbers above */
export function sizeOf(s: IslandState, n: number): string {
  const units = s.lang === 'en' ? ['B', 'KB', 'MB', 'GB'] : ['Б', 'КБ', 'МБ', 'ГБ'];
  let v = n,
    u = 0;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  const num = u === 0 || v >= 10 ? String(Math.round(v)) : v.toFixed(1);
  return (s.lang === 'en' ? num : num.replace('.', ',')) + ' ' + units[u];
}

/** Cut a long name in the middle so the extension stays: "квартальный-от…чёт.pdf". */
export function midCut(c: Ctx, name: string, max: number): string {
  c.save();
  c.font = '500 12px Onest, system-ui, sans-serif';
  const fits = (t: string): boolean => c.measureText(t).width <= max;
  let out = name;
  if (!fits(name)) {
    const ext = extOf(name),
      tail = ext ? Math.min(name.length - 1, ext.length + 4) : 4;
    let head = name.length - tail;
    while (head > 1 && !fits(name.slice(0, head) + '…' + name.slice(-tail))) head--;
    out = name.slice(0, head).trimEnd() + '…' + name.slice(-tail);
  }
  c.restore();
  return out;
}

/** The "+" tab's count when the shelf is not on screen: something is waiting there. */
export function shelfBadge(c: Ctx, n: number, x: number, y: number): void {
  if (!n) return;
  const label = n > 9 ? '9+' : String(n),
    w = label.length > 1 ? 17 : 13;
  c.save();
  c.fillStyle = SHELF_ACC;
  rrect(c, x - w / 2, y - 6.5, w, 13, 6.5);
  c.fill();
  textAt(c, label, x, y + 0.5, { size: 9, weight: 700, color: '#101114', align: 'center' });
  c.restore();
}
