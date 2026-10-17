import { after, type EventType, type IslandState } from './state';
import { hop, wake } from './actions';
import { burst } from './particles';
import { STEPS, STEP_LEN, clockLeft, limitLeft, type Step } from '../stub';
import { tr } from '../i18n';

export interface EventDef {
  label: string;
  dur: number;
  color: string;
  text: string;
  drop?: boolean;
}

/** proto: EVENTS */
export const EVENTS: Readonly<Record<EventType, EventDef>> = {
  attention: { label: 'ждёт подтверждения', dur: 30, color: '#F5A524', text: 'Ждёт подтверждения', drop: true },
  question: { label: 'вопрос', dur: 30, color: '#22C3E6', text: 'Задаёт вопрос', drop: true },
  working: { label: 'работает', dur: Infinity, color: '#3D8BFF', text: 'Работает' },
  thinking: { label: 'думает', dur: Infinity, color: '#A07CFF', text: 'Думает' },
  searching: { label: 'ищет', dur: Infinity, color: '#38BDF8', text: 'Ищет по проекту' },
  ratelimit: { label: 'лимит', dur: Infinity, color: '#8E8E93', text: 'Лимит' },
  success: { label: 'успех', dur: 2.4, color: '#34C759', text: 'CI прошёл' },
  error: { label: 'ошибка', dur: 3, color: '#FF453A', text: 'Деплой упал' },
  dance: { label: 'празднует', dur: 4.5, color: '#FF5FA2', text: 'Праздник' },
  greeting: { label: 'просыпается', dur: 4.6, color: '#7CC4FF', text: '' },
};

export const EVENT_TYPES = Object.keys(EVENTS) as EventType[];

/** proto: stepIndex - with a live session, the newest real step */
export function stepIndex(s: IslandState): number {
  if (!s.event || s.event.type !== 'working') return -1;
  if (s.agent) return s.agent.steps.length - 1;
  return Math.floor((s.t - s.event.start) / STEP_LEN);
}
/** proto: stepAt - stubs cycle; real steps end (null before the first one) */
export function stepAt(s: IslandState, i: number): Step | null {
  const st = s.agent ? (s.agent.steps[i] ?? null) : (STEPS[((i % STEPS.length) + STEPS.length) % STEPS.length] as Step);
  // the verb is a Russian key (stub and live steps alike); the target is a file or a command
  // and passes through, except the app's own fallback words ("агенту")
  return st && s.lang === 'en' ? ([st[0], tr(s, st[1]), tr(s, st[2]), ...st.slice(3)] as unknown as Step) : st;
}
/** progress 0..1 of the newest step's slide-in period */
export function stepFrac(s: IslandState): number {
  const ev = s.event;
  if (!ev) return 0;
  if (s.agent) return Math.min(1, Math.max(0, s.t - Math.max(s.agent.stepT, ev.start)) / STEP_LEN);
  return ((s.t - ev.start) % STEP_LEN) / STEP_LEN;
}
/** proto: limitLeft(t - event.start) - or the time to the real plan usage reset */
export function limitText(s: IslandState): string {
  const reset = s.agent && s.agent.limitReset;
  if (reset !== null && reset !== undefined) return clockLeft((reset - s.date().getTime()) / 1000);
  return limitLeft(s.event ? s.t - s.event.start : 0);
}

/** proto: greetText */
export function greetText(d: Date): string {
  const h = d.getHours();
  return h >= 5 && h < 12
    ? 'Доброе утро'
    : h >= 12 && h < 17
      ? 'Добрый день'
      : h >= 17 && h < 23
        ? 'Добрый вечер'
        : 'Доброй ночи';
}

/** proto: trigger - start an event; infinite events toggle off */
export function trigger(s: IslandState, type: EventType | 'sleep'): void {
  const { sp } = s;
  if (type === 'sleep') {
    if (s.sleeping) wake(s, true);
    else {
      s.sleeping = true;
      s.forcedSleep = true;
      s.event = null;
    }
    s.notify();
    return;
  }
  if (s.sleeping) wake(s, false);
  if (s.event && s.event.type === 'greeting') s.postLaunchUntil = s.t + 30;
  const E = EVENTS[type];
  if (s.event && s.event.type === type && E.dur === Infinity) {
    s.event = null;
    s.notify();
    return;
  }
  const t = s.t;
  const event = (s.event = { type, start: t, until: t + E.dur, nextHop: t + 1.5 } as NonNullable<IslandState['event']>);
  s.focusId = null;
  s.tab = 'home';
  s.glowColor = E.color;
  if (type === 'attention') {
    sp.wide.v += 4;
    hop(s, 3.2);
    sp.badge.v += 8;
  }
  if (type === 'question') {
    sp.wide.v += 3;
    hop(s, 2.6);
    sp.badge.v += 8;
    event.choice = -1;
  }
  if (type === 'greeting') {
    // a boot-up scene in beats: the island traces itself, the mascot rises with its eyes shut,
    // lands, powers its eyes on, looks around, recognises you, hops twice and says hello
    event.greet = tr(s, greetText(s.date()));
    sp.hide.x = 1.15;
    sp.hide.v = 0;
    sp.lid.x = 0;
    after(s, 1.4, () => {
      sp.sq.v += 3.2;
    });
    after(s, 1.8, () => {
      sp.sq.v -= 4.8;
    });
    after(s, 2.95, () => hop(s, 5));
    after(s, 3.02, () => burst(s, 10, '#BFE3FF'));
    after(s, 3.4, () => hop(s, 3));
  }
  if (type === 'dance') {
    event.nextHop = t + 0.25;
    burst(s, 16, '#FF5FA2');
    after(s, 0.15, () => burst(s, 12, '#FFD27A'));
    after(s, 0.3, () => burst(s, 10, '#7CC4FF'));
  }
  if (type === 'success') {
    hop(s, 5.2);
    after(s, 0.3, () => burst(s, 14, '#34C759'));
  }
  if (type === 'error') {
    for (let i = 0; i < 6; i++)
      after(s, i * 0.07, () => {
        sp.posX.v += (i % 2 ? 1 : -1) * 3.2;
      });
  }
  s.notify();
}

export type Answer = 'approve' | 'deny' | `opt:${number}`;

/** proto: answer - reply to attention or question */
export function answer(s: IslandState, act: Answer): void {
  const ev0 = s.event;
  if (!ev0 || ev0.answer) return;
  ev0.answerAt = s.t;
  if (act === 'approve') {
    ev0.answer = 'approve';
    after(s, 0.55, () => {
      if (s.event === ev0) {
        s.event = null;
        trigger(s, 'working');
        s.happyUntil = s.t + 0.9;
      }
    });
  } else if (act === 'deny') {
    ev0.answer = 'deny';
    after(s, 0.5, () => {
      if (s.event === ev0) {
        s.event = null;
        s.notify();
        s.grumpyUntil = s.t + 1.2;
      }
    });
  } else {
    ev0.answer = 'opt';
    ev0.choice = +act.slice(4);
    after(s, 0.6, () => {
      if (s.event === ev0) {
        s.event = null;
        trigger(s, 'working');
        s.happyUntil = s.t + 0.9;
      }
    });
  }
}

export interface Status {
  text: string;
  color: string;
  badge?: boolean;
  drop?: boolean;
}

/** proto: statusOf - status text, colour and dot: events and sleep, never plain idle */
export function statusOf(s: IslandState): Status | null {
  const { event, t } = s;
  if (event) {
    const E = EVENTS[event.type];
    let text = tr(s, E.text);
    if (event.type === 'working') {
      const st = stepAt(s, stepIndex(s));
      if (st) text = st[1] ? st[1] + ' ' + st[2] : st[2];
    }
    if (event.type === 'ratelimit') text = tr(s, 'Лимит {0}', limitText(s));
    if (event.type === 'greeting') {
      const el = t - event.start,
        g = event.greet || '';
      text = el < 3.45 ? '' : g.slice(0, Math.floor((el - 3.45) * 26));
    }
    if (event.label) text = tr(s, event.label);
    return { text, color: E.color, badge: event.type !== 'greeting' && event.type !== 'ratelimit', drop: !!E.drop };
  }
  if (s.overloadUntil > t) return { text: tr(s, 'Перегруз'), color: '#FF5FA2' };
  if (s.grab && s.grab.active) return { text: tr(s, 'Поставь на место'), color: '#F5A524' };
  if (s.hideUntil > t) return { text: tr(s, 'Спрятался'), color: '#8E8E93' };
  if (s.grumpyUntil > t) return { text: tr(s, 'Дуется'), color: '#FF453A' };
  if (s.petting) return { text: tr(s, 'Нравится'), color: '#34C759' };
  if (s.sleeping) return { text: tr(s, 'Тихо'), color: '#8E8E93', badge: true };
  return null;
}
