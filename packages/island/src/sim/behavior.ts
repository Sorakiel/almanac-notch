import { clamp, ss } from '../util/math';
import type { IslandState } from './state';
import { GRAV, SPRING_STEP, kz, type SpringName } from './springs';
import { geo, hitBody } from './pose';
import { hop } from './actions';
import { EVENTS, statusOf } from './events';
import { spawnFloat, stepParticles } from './particles';
import { stepMusic } from './music';
import { moduleMood } from './mood';
import { after } from './state';
import { notchState } from '../island/focus';

/**
 * proto: update - one frame of behaviour. Targets T are rebuilt layer by layer
 * (background, module mood, interaction, event, blink), then the springs are stepped at 1/240 s.
 * now is the real clock in ms (pointer idleness is measured in real time, as in the prototype).
 */
export function update(s: IslandState, dt: number, now: number): void {
  const { S, sp, ptr, T, rng } = s;
  s.t += dt;
  stepMusic(s, dt);
  for (let i = s.timers.length - 1; i >= 0; i--) {
    const tm = s.timers[i];
    if (tm && tm.at <= s.t) {
      s.timers.splice(i, 1);
      tm.fn();
    }
  }
  const t = s.t;
  const grab = s.grab;
  const dragging = !!(grab && grab.active);
  if (s.event && t >= s.event.until) {
    if (s.event.type === 'greeting') s.postLaunchUntil = t + 30;
    s.event = null;
    s.notify();
  }
  // CHANGES 2026-10-14: in "auto" every time the open island closes (hover left, an event ended)
  // it stays half-open for 30 s, like after the launch greeting. Not in the prototype.
  if (S.nstate === 'auto') {
    const open = notchState(s) === 'open';
    if (s.wasOpen && !open) s.postLaunchUntil = Math.max(s.postLaunchUntil, t + 30);
    s.wasOpen = open;
  } else s.wasOpen = false;
  const hiding = s.hideUntil > t;
  if (s.prevHiding && !hiding) hop(s, 4.2);
  s.prevHiding = hiding;
  const overloaded = s.overloadUntil > t;
  if (s.prevOverload && !overloaded) {
    s.rebootAt = t;
    s.blinkUntil = t + 0.18;
    hop(s, 3.4);
  }
  s.prevOverload = overloaded;
  const grumpy = s.grumpyUntil > t && !hiding && !overloaded;
  const idleReal = (now - ptr.lastMoveReal) / 1000;
  if (!s.sleeping && !s.event && !dragging && idleReal > S.sleepAfter) {
    s.sleeping = true;
    s.notify();
  }

  const hb = hitBody(s, ptr.x, ptr.y);
  const moving = now - ptr.lastT < 140;
  const stroke =
    hb.inside && hb.ly < 0.1 && !ptr.down && !dragging && moving && ptr.speed > 15 && ptr.speed < 1400 && !s.sleeping;
  s.petAccum = clamp(s.petAccum + (stroke ? dt * 1.4 : -dt * 1.1), 0, 1.4);
  s.petting = s.petting ? s.petAccum > 0.25 : s.petAccum > 0.55;

  T.lookX = 0;
  T.lookY = 0;
  T.lid = 1;
  T.happy = 0;
  T.grump = 0;
  T.wide = 0;
  T.hide = 0;
  T.glow = 0;
  T.work = 0;
  T.think = 0;
  T.puff = 0;
  T.lean = 0;
  T.sq = 1;
  T.hand = 0; // proto: waveUntil, never set (dead code, docs/SPEC.md section 6)
  const L = (s.layerText = { ev: '', ia: '', bg: '' });

  // 1. background
  const pointerRecent = ptr.seen && idleReal < 4;
  if (!s.sleeping && s.islandHover && s.islandPtr && s.islandMascot) {
    // the pointer is over the island: look at it from the island's own mascot
    const M = s.islandMascot;
    T.lookX = Math.tanh((s.islandPtr.x - M.x) / (M.R * 2.6)) * S.lookRange;
    T.lookY = Math.tanh((s.islandPtr.y - M.y) / (M.R * 1.8)) * S.lookRange;
    L.bg = 'следит в острове';
  } else if (s.sleeping) {
    T.lid = 0.05;
    T.lookY = 0.35;
    L.bg = s.forcedSleep ? 'спит (по кнопке)' : 'спит';
  } else if (pointerRecent) {
    const G = geo(s),
      P = hb.P;
    const dx = ptr.x - P.ax,
      dy = ptr.y - (P.ay - G.b * P.sy * 1.05);
    T.lookX = Math.tanh(dx / (G.R * 2.6)) * S.lookRange;
    T.lookY = Math.tanh(dy / (G.R * 1.8)) * S.lookRange;
    L.bg = 'следит за курсором';
  } else {
    const w = s.wander;
    if (t > w.next) {
      const center = rng() < 0.3;
      w.x = center ? 0 : rng() * 1.4 - 0.7;
      w.y = center ? 0 : rng() * 0.9 - 0.4;
      w.next = t + 1.4 + rng() * 2;
      if (rng() < 0.4) s.blinkUntil = t + 0.07;
    }
    T.lookX = w.x * S.lookRange;
    T.lookY = w.y * S.lookRange;
    L.bg = 'осматривается';
  }

  // 2. module mood
  const mood = moduleMood(s, T);
  if (mood) L.bg = mood;

  // 3. interaction
  if (dragging) {
    const G = geo(s);
    T.sq = 1.1;
    T.wide = 0.55;
    T.lean = clamp(grab.vx / (G.R * 12), -0.5, 0.5);
    T.lookX = Math.tanh(grab.vx / (G.R * 8));
    T.lookY = 0.1;
    L.ia = 'держат на весу';
  } else if (overloaded) {
    const ramp = ss(0, 1, (3.2 - (s.overloadUntil - t)) / 0.9);
    T.lean = Math.sin(t * 9) * 0.08 * ramp;
    T.puff = 0.5 * ramp;
    T.sq = 1 - 0.05 * ramp;
    T.lookX = 0;
    T.lookY = 0;
    T.glow = 0.6;
    L.ia = 'перегруз';
  } else if (hiding) {
    T.hide = 1;
    T.lid = 0.6;
    T.lookY = 0.2;
    T.lookX *= 0.3;
    T.sq = 0.8;
    L.ia = 'прячется';
  } else if (grumpy) {
    const away = -(Math.sign(T.lookX) || 1);
    T.grump = 1;
    T.puff = 1;
    T.lookX = away * 0.85;
    T.lookY = 0.12;
    T.lid = 0.62;
    T.lean = away * 0.08;
    L.ia = 'дуется';
  } else if (s.petting) {
    T.happy = 1;
    T.lookY = -0.2;
    T.lookX *= 0.3;
    L.ia = 'гладят';
    if (t > s.nextBit) {
      spawnFloat(s, 'bit', '#9FE3B0');
      s.nextBit = t + 0.4;
    }
  } else if (s.happyUntil > t) {
    T.happy = 1;
    L.ia = 'радуется';
  }
  if (s.squintUntil > t) {
    T.lid = Math.min(T.lid, 0.18);
    if (!L.ia) L.ia = 'тычок';
  }

  // 4. event
  const event = s.event;
  if (event) {
    const el = t - event.start;
    T.glow = 0.9;
    switch (event.type) {
      case 'attention':
        T.wide = 0.6;
        T.lid = 1;
        T.happy = 0;
        T.grump = 0;
        T.puff = 0;
        T.glow = 0.55 + 0.45 * Math.sin(el * 5);
        if (!pointerRecent) {
          T.lookX = 0;
          T.lookY = 0;
        }
        if (t >= event.nextHop) {
          hop(s, 2.6);
          event.nextHop = t + 1.5;
        }
        break;
      case 'working':
        T.work = 1;
        T.lookX = 0.5 + 0.14 * Math.sin(Math.floor(el * 1.6) * 1.7);
        T.lookY = 0.38;
        T.lean = 0.05;
        T.lid = 0.88;
        T.happy = 0;
        T.grump = 0;
        T.glow = 0.3;
        break;
      case 'thinking':
        T.think = 1;
        T.lookX = -0.55;
        T.lookY = -0.6;
        T.lid = 0.72;
        T.lean = Math.sin(el * 1.3) * 0.05;
        T.happy = 0;
        T.glow = 0.3;
        break;
      case 'success':
        T.happy = 1;
        T.grump = 0;
        T.glow = Math.max(0, 1 - el / 1.6);
        break;
      case 'error':
        T.grump = 0.7;
        T.lid = 0.5;
        T.happy = 0;
        T.glow = Math.max(0.2, 1 - el / 2);
        break;
      case 'question':
        T.lean = 0.17;
        T.wide = 0.3;
        T.lookY = -0.25;
        T.happy = 0;
        T.grump = 0;
        T.lid = 1;
        if (!pointerRecent) T.lookX = 0.2;
        T.glow = 0.5 + 0.3 * Math.sin(el * 3);
        break;
      case 'searching':
        T.lookX = Math.sin(el * 3.2) * 0.85;
        T.lookY = 0.15;
        T.lid = 0.95;
        T.lean = Math.sin(el * 3.2) * 0.04;
        T.happy = 0;
        T.glow = 0.3;
        break;
      case 'ratelimit':
        T.lid = 0.42;
        T.lookY = 0.35;
        T.lookX = 0;
        T.sq = 0.97;
        T.happy = 0;
        T.grump = 0;
        T.glow = 0.15;
        break;
      case 'dance':
        T.happy = 1;
        T.grump = 0;
        T.lean = Math.sin(el * 6.3) * 0.16;
        T.sq = 1 + 0.07 * Math.sin(el * 12.6);
        T.glow = 0.4;
        if (t >= event.nextHop) {
          hop(s, 2.2);
          event.nextHop = t + 0.5;
        }
        if (t > s.nextBit) {
          spawnFloat(s, 'note', '#FF5FA2');
          s.nextBit = t + 0.35;
        }
        break;
      case 'greeting': {
        const eg = el - 1.0; // the first second belongs to the particle warp
        T.glow = 0;
        T.grump = 0;
        T.puff = 0;
        T.hide = eg < 0.35 ? 1.15 : 0;
        T.lid = eg < 0.95 ? 0 : 1;
        if (eg > 1.2 && eg < 1.9) {
          T.lookX = eg < 1.42 ? -0.85 : eg < 1.64 ? 0.85 : pointerRecent ? T.lookX : 0;
          if (eg < 1.64) T.lookY = 0.05;
        }
        T.happy = eg > 1.9 && eg < 2.95 ? 1 : 0;
        if (eg > 3.1 && eg < 3.18) T.lid = 0;
        T.hand = eg > 1.95 && eg < 3.05 ? 1 : 0;
        break;
      }
    }
    L.ev = EVENTS[event.type].label;
  }

  // 5. blink and forced squash on top of everything
  if (!s.sleeping && t >= s.nextBlink) {
    s.blinkUntil = t + 0.075;
    if (rng() < 0.18)
      after(s, 0.22, () => {
        s.blinkUntil = s.t + 0.07;
      });
    s.nextBlink = t + S.blinkEvery * (0.55 + rng() * 0.9);
  }
  if (s.blinkUntil > t) T.lid = 0;
  if (s.sqOverride && s.sqOverride.until > t) T.sq = s.sqOverride.val;

  for (const k in T) {
    const key = k as keyof typeof T;
    sp[key].t = T[key];
  }
  sp.alertA.t = overloaded ? 1 : 0;
  sp.spin.t = overloaded ? 1 : 0;
  sp.posX.t = dragging ? grab.tx : 0;
  if (!dragging) sp.lean.t += clamp(sp.posX.v * 0.05, -0.4, 0.4);

  // status dot: events and sleep, never plain idle
  const st = statusOf(s);
  sp.badge.t =
    st && st.badge ? (event && event.type === 'attention' ? 1 + 0.18 * Math.sin((t - event.start) * 7) : 1) : 0;
  if (st && st.badge) s.badgeColor = st.color;

  stepSprings(s, dt, dragging);
  if (dt > 1e-4) s.lastAx = clamp((sp.posX.v - s.prevPosXv) / dt, -200, 200);
  s.prevPosXv = sp.posX.v;

  if (s.sleeping && t > s.nextZ) {
    spawnFloat(s, 'z');
    s.nextZ = t + 1.7;
  }
  stepParticles(s, dt);
}

const NAMES = (s: IslandState) => Object.keys(s.sp) as SpringName[];

/** proto: the fixed-step spring loop inside update; posY falls under gravity instead */
export function stepSprings(s: IslandState, dt: number, dragging: boolean): void {
  const { sp, S, grab } = s;
  const names = NAMES(s);
  let acc = dt;
  while (acc > 1e-6) {
    const hh = Math.min(SPRING_STEP, acc);
    acc -= hh;
    for (const name of names) {
      if (name === 'posY') continue;
      let k = kz(S, name);
      if (name === 'posX' && dragging) k = [900, 0.85];
      sp[name].step(hh, k[0], k[1]);
    }
    if (dragging && grab) {
      sp.posY.t = grab.ty;
      sp.posY.step(hh, 900, 0.85);
    } else if (sp.posY.x < 0 || sp.posY.v < 0) {
      sp.posY.v += GRAV * hh;
      sp.posY.x += sp.posY.v * hh;
      if (sp.posY.x >= 0) {
        const vi = sp.posY.v;
        sp.posY.x = 0;
        if (vi > 0.6) sp.sq.v -= vi * 0.6;
        sp.posY.v = vi > 4 ? -vi * 0.16 : 0;
      }
    }
  }
}
