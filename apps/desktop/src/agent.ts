// Claude Code sessions -> island events. Hook payloads come from the Rust hook server
// (`island://agent`), plan usage from the transcript watcher (`island://usage`).
// Pure logic over the mascot, so it runs in vitest without Tauri.
import type { AgentFeed, EventType, IslandState, Mascot, MascotEvent } from '@almanac-notch/island';

type Step = AgentFeed['steps'][number];

export interface Hook {
  hook_event_name: string;
  session_id?: string;
  agent_id?: string;
  tool_name?: string;
  tool_use_id?: string;
  notification_type?: string;
  message?: string;
  error?: string;
  prompt?: string;
  is_interrupt?: boolean;
  tool_input?: {
    command?: string;
    description?: string;
    file_path?: string;
    notebook_path?: string;
    path?: string;
    pattern?: string;
    glob?: string;
    query?: string;
    url?: string;
    skill?: string;
    subagent_type?: string;
    plus?: number;
    minus?: number;
    questions?: { question: string; header?: string; options?: { label: string }[]; multiSelect?: boolean }[];
  };
}

export type AgentMsg = { kind: 'hook'; id?: number; hook: Hook } | { kind: 'resolved'; id: number };

export interface Usage {
  limit: { at: string; text: string } | null;
  plan: string;
}

/** Busy states a session drives; asks (attention, question) and the limit are never replaced by them. */
const BUSY: readonly EventType[] = ['working', 'thinking', 'searching'];
/** A busy state with no hook for this long is stale (Ctrl-C, closed terminal). */
const STALE_MS = 10 * 60 * 1000;
/** Pause after a tool before the island says Claude is thinking or writing the reply. */
const AFTER_TOOL_MS = 1500;
/** The picked option stays highlighted this long before the next question (the package moves on at 0.6 s). */
const NEXT_QUESTION_S = 0.45;
/** Steps kept for the card (it shows three). */
const KEEP_STEPS = 12;

const base = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const firstLine = (t: string): string => (t.split('\n')[0] ?? '').trim();

/** Step targets share the ear with the verb; canvas fillText squeezes longer text unreadably. */
const STEP_MAX = 20;
/** A caption has no verb before it, but a long one still squeezes; keep its gist. */
const CAPTION_MAX = 22;

/** "Fix expectation, run tests and parity" -> "Fix expectation": the first action, cut at a word. */
export function caption(desc: string): string {
  const first = (desc.split(/\s*(?:[,;:(]|\s[-–—]\s|\s(?:and|then|и|затем|потом)\s)\s*/i)[0] ?? desc).trim();
  if (first.length <= CAPTION_MAX) return first;
  const cut = first.slice(0, CAPTION_MAX - 1);
  const word = cut.lastIndexOf(' ');
  return (word > 8 ? cut.slice(0, word) : cut).trimEnd() + '…';
}
/** The approval card fits about this many mono characters. */
const ASK_MAX = 54;

export function clip(t: string, n: number): string {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

/** "cd ~/x && FOO=1 npm test | tail" -> "npm test": the command that actually runs. */
export function shortCommand(cmd: string): string {
  const parts = firstLine(cmd)
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .map((p) => p.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, ''))
    .filter((p) => p && !/^cd(\s|$)/.test(p));
  const toks = (parts[0] ?? firstLine(cmd)).split(' ').filter(Boolean);
  // program + subcommand ("npx prettier", "git commit", "npm run parity"); flags, paths, quotes end it
  const words = [base(toks[0] ?? '')];
  for (const tok of toks.slice(1)) {
    const prev = words[words.length - 1] ?? '';
    const more = words.length === 1 || (words.length === 2 && RUNNERS.includes(prev));
    if (!more || !/^[A-Za-z][\w:.-]*$/.test(tok) || tok.length > 20) break;
    words.push(tok);
  }
  return clip(words.join(' '), STEP_MAX);
}

/** Subcommands that take one more word worth showing: "npm run parity", "pnpm exec vitest". */
const RUNNERS = ['run', 'exec', 'x', 'dlx'];

/** A tool call as a card step [tag, verb, target, +, −]; null = not shown. */
export function toolStep(tool: string, input: NonNullable<Hook['tool_input']>): Step | null {
  const st = rawStep(tool, input);
  if (!st) return null;
  const target = clip(st[2], st[1] ? STEP_MAX : CAPTION_MAX);
  return st[3] === undefined ? [st[0], st[1], target] : [st[0], st[1], target, st[3], st[4] ?? ''];
}

function rawStep(tool: string, input: NonNullable<Hook['tool_input']>): Step | null {
  const file = base(input.file_path || input.notebook_path || '');
  const diff = (verb: string): Step => [
    'edit',
    verb,
    file,
    '+' + String(input.plus ?? 0),
    '−' + String(input.minus ?? 0),
  ];
  switch (tool) {
    case 'Read':
      return ['read', 'Читает', file];
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return diff('Правит');
    case 'Write':
      return diff('Пишет');
    case 'Bash':
    case 'PowerShell':
      // Claude's own caption of the command ("Run input parity") says more than "cat" or "for i";
      // Claude Desktop shows the same caption
      if (input.description) return ['bash', '', caption(input.description)];
      return ['bash', 'Запускает', shortCommand(input.command || '')];
    case 'Grep':
    case 'Glob':
      return ['grep', 'Ищет', '"' + (input.pattern || '') + '"'];
    case 'WebSearch':
      return ['grep', 'Ищет', input.query || ''];
    case 'WebFetch':
      return ['read', 'Читает', hostOf(input.url || '')];
    case 'Task':
    case 'Agent':
      return ['read', 'Поручает', input.subagent_type || input.description || 'агенту'];
    case 'Skill':
      return ['read', 'Берёт навык', input.skill || ''];
    case 'TodoWrite':
    case 'ExitPlanMode':
    case 'EnterPlanMode':
    case 'AskUserQuestion':
      return null;
    default:
      return ['bash', 'Вызывает', tool.startsWith('mcp__') ? tool.split('__').slice(-1)[0] || tool : tool];
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The line of the approval card: what exactly will run. */
export function askCommand(tool: string, input: NonNullable<Hook['tool_input']>): string {
  if (input.command) return clip(firstLine(input.command), ASK_MAX);
  const st = rawStep(tool, input);
  if (st && st[2]) return clip(st[1] + ' ' + st[2], ASK_MAX);
  return tool;
}

// ---------- plan usage reset time ----------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Offset of a time zone from UTC at an instant, ms. */
function tzOffset(at: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(at));
  const n = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (
    Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(at / 1000) * 1000
  );
}

/** Wall clock time in a zone -> epoch ms. */
function zoned(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo, d, h, mi);
  const first = guess - tzOffset(guess, tz);
  return guess - tzOffset(first, tz);
}

function wallDate(at: number, tz: string): [number, number, number] {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(at));
  const n = (t: string): number => Number(p.find((x) => x.type === t)?.value ?? 0);
  return [n('year'), n('month') - 1, n('day')];
}

/**
 * Reset time of a limit message, epoch ms, or null.
 * "You've hit your session limit · resets 7pm (Europe/Moscow)", "… resets 5:30am (…)",
 * "… resets Jul 18 at 9pm (…)", and the old "Claude AI usage limit reached|1720000000".
 */
export function limitReset(text: string, atIso: string): number | null {
  const epoch = /\|(\d{9,11})\b/.exec(text);
  if (epoch) return Number(epoch[1]) * 1000;
  const m =
    /resets\s+(?:([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:\(([^)]+)\))?/i.exec(
      text,
    );
  const at = Date.parse(atIso);
  if (!m || Number.isNaN(at)) return null;
  let tz = m[6] || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  let h = Number(m[3]) % 12;
  if ((m[5] as string).toLowerCase() === 'pm') h += 12;
  const mi = Number(m[4] ?? 0);
  const [y, mo, d] = wallDate(at, tz);
  if (m[1]) {
    const month = MONTHS.indexOf(m[1].toLowerCase());
    if (month < 0) return null;
    let t = zoned(y, month, Number(m[2]), h, mi, tz);
    if (t < at) t = zoned(y + 1, month, Number(m[2]), h, mi, tz);
    return t;
  }
  let t = zoned(y, mo, d, h, mi, tz);
  if (t <= at) t = zoned(y, mo, d + 1, h, mi, tz);
  return t;
}

// ---------- the driver ----------

type Question = NonNullable<AgentFeed['question']>;

interface Ask {
  id: number;
  type: 'attention' | 'question';
  cmd: string;
  /** AskUserQuestion: asked one by one, answered together */
  questions: Question[];
}

/** One line of the question card fits about this much; the card squeezes longer text. */
const QUESTION_MAX = 46;
const OPTION_MAX = 18;

/**
 * The question as the card shows it: "2/4 · " when there are several, and a long question
 * cut to its point - the header plus the last sentence ("Музыка на Mac: Что берём?").
 */
export function questionView(q: string, header: string | undefined, i: number, n: number, options: string[]): Question {
  const pre = n > 1 ? `${i + 1}/${n} · ` : '';
  const room = QUESTION_MAX - pre.length;
  let text = q.replace(/\s+/g, ' ').trim();
  if (text.length > room) {
    const last =
      text
        .split(/(?<=[.!?:])\s+/)
        .filter(Boolean)
        .pop() ?? text;
    text = clip(header && last !== text ? header + ': ' + last : last, room);
  }
  return [pre + text, options.map((o) => clip(o, OPTION_MAX))];
}

export interface AgentHost {
  m: Mascot;
  /** island answer -> Rust (agent_answer) */
  send: (id: number, answer: string) => void;
  now: () => number;
}

export function emptyFeed(): AgentFeed {
  return {
    steps: [],
    stepT: 0,
    cmd: '',
    question: null,
    search: '',
    think: '',
    limitReset: null,
    plan: 'Pro',
    lastActive: null,
  };
}

export class AgentDriver {
  readonly feed: AgentFeed = emptyFeed();
  private queue: Ask[] = [];
  private cur: { ask: Ask; ev: MascotEvent; sent: boolean; idx: number; picks: number[] } | null = null;
  /** when the last tool ended, while no new hook has come */
  private afterTool: number | null = null;

  constructor(private readonly host: AgentHost) {
    this.attach();
  }

  private get s(): IslandState {
    return this.host.m.state;
  }

  /** Live data back on the island (the debug tray switches to the prototype's stubs). */
  attach(): void {
    this.s.agent = this.feed;
  }

  private isBusy(): boolean {
    const ev = this.s.event;
    return !!ev && BUSY.includes(ev.type);
  }

  /** Show `type` unless it is already up (trigger would toggle an infinite event off). */
  private show(type: EventType, extra?: Partial<MascotEvent>): void {
    if (this.cur) return; // an open prompt keeps the island
    const ev = this.s.event;
    if (ev && ev.type === 'ratelimit' && type !== 'ratelimit') return;
    if (!ev || ev.type !== type) this.host.m.trigger(type);
    if (extra && this.s.event) Object.assign(this.s.event, extra);
  }

  private clearBusy(): void {
    if (!this.cur && this.isBusy()) {
      this.s.event = null;
      this.s.notify();
    }
  }

  private pushStep(st: Step): void {
    const f = this.feed;
    f.steps.push(st);
    if (f.steps.length > KEEP_STEPS) f.steps.splice(0, f.steps.length - KEEP_STEPS);
    f.stepT = this.s.t;
  }

  onMessage(msg: AgentMsg): void {
    this.attach();
    if (msg.kind === 'resolved') return this.resolved(msg.id);
    const h = msg.hook,
      tool = h.tool_name || '',
      input = h.tool_input || {};
    this.feed.lastActive = this.host.now();
    const ev = h.hook_event_name;
    // no hooks fire while Claude writes text: a tool that ended with no next one means it is replying
    this.afterTool = ev === 'PostToolUse' || (ev === 'PostToolUseFailure' && !h.is_interrupt) ? this.host.now() : null;
    switch (ev) {
      case 'UserPromptSubmit':
        this.feed.think = h.prompt ? '«' + clip(h.prompt, 34) + '»' : '';
        this.show('thinking');
        break;
      case 'PreToolUse': {
        if (tool === 'AskUserQuestion') {
          const qs = input.questions || [];
          if (msg.id !== undefined && qs.length) {
            this.enqueue({
              id: msg.id,
              type: 'question',
              cmd: '',
              questions: qs.map((q, i) =>
                questionView(
                  q.question,
                  q.header,
                  i,
                  qs.length,
                  (q.options || []).map((o) => o.label),
                ),
              ),
            });
          }
          break;
        }
        if (tool === 'Grep' || tool === 'Glob') {
          let line = (tool === 'Grep' ? 'grep ' : 'glob ') + '"' + clip(input.pattern || '', STEP_MAX) + '"';
          if (input.path || input.glob) line += ' · ' + base(input.glob || input.path || '');
          this.feed.search = clip(line, ASK_MAX);
          this.show('searching');
          break;
        }
        const st = toolStep(tool, input);
        if (st) this.pushStep(st);
        this.show('working');
        break;
      }
      case 'PermissionRequest':
        if (msg.id !== undefined)
          this.enqueue({ id: msg.id, type: 'attention', cmd: askCommand(tool, input), questions: [] });
        break;
      case 'PostToolUseFailure':
        if (h.is_interrupt) this.clearBusy();
        break;
      case 'Stop':
        if (this.isBusy() || !this.s.event) this.show('success', { label: 'Готово', src: 'agent' });
        break;
      case 'StopFailure':
        // a plan limit is shown by the usage watcher as the limit state
        if (h.error !== 'rate_limit') this.show('error', { label: 'Ошибка API', src: 'agent' });
        break;
      case 'Notification':
        if (h.notification_type === 'idle_prompt') this.clearBusy();
        break;
      case 'SessionEnd':
        this.clearBusy();
        break;
    }
  }

  private enqueue(a: Ask): void {
    this.queue.push(a);
    this.next();
  }

  private next(): void {
    if (this.cur) return;
    const a = this.queue.shift();
    if (!a) return;
    this.feed.cmd = a.cmd;
    this.feed.question = a.questions[0] ?? null;
    const s = this.s;
    // the prompt replaces whatever is up; trigger never toggles attention/question off
    if (s.event && s.event.type === a.type) s.event = null;
    this.host.m.trigger(a.type);
    this.cur = { ask: a, ev: s.event as MascotEvent, sent: false, idx: 0, picks: [] };
  }

  private resolved(id: number): void {
    this.queue = this.queue.filter((a) => a.id !== id);
    const c = this.cur;
    if (!c || c.ask.id !== id) return;
    this.cur = null;
    // answered in the terminal or timed out: take the card down unless the island answered it
    if (this.s.event === c.ev && !c.ev.answer) {
      this.s.event = null;
      this.s.notify();
    }
    this.next();
  }

  /** Per frame: forward island answers, notice expired prompts, the limit and stale states. */
  tick(): void {
    const c = this.cur,
      s = this.s;
    if (c) {
      const n = c.ask.questions.length;
      if (c.ev.answer === 'opt' && n > 1 && !c.sent) {
        // a questionnaire: keep the pick, show the next question once the pick has been seen
        if (c.picks.length === c.idx) c.picks.push(c.ev.choice ?? -1);
        if (c.idx === n - 1) {
          c.sent = true;
          this.host.send(c.ask.id, 'opts:' + c.picks.join(','));
        } else if (s.t >= (c.ev.answerAt ?? s.t) + NEXT_QUESTION_S) {
          c.idx += 1;
          this.feed.question = c.ask.questions[c.idx] ?? null;
          s.event = null;
          this.host.m.trigger('question');
          c.ev = s.event as unknown as MascotEvent;
        }
      }
      const ev = c.ev;
      if (ev.answer && !c.sent && n <= 1) {
        c.sent = true;
        this.host.send(c.ask.id, ev.answer === 'opt' ? 'opt:' + String(ev.choice ?? -1) : ev.answer);
      }
      if (s.event !== ev) {
        // the prompt is gone (answered and animated out, or its 30 s ran out)
        if (!c.sent) this.host.send(c.ask.id, 'none');
        this.cur = null;
        this.next();
      }
    }
    const now = this.host.now(),
      f = this.feed;
    if (this.afterTool !== null && now - this.afterTool > AFTER_TOOL_MS) {
      this.afterTool = null;
      const ev = s.event;
      if (ev && (ev.type === 'working' || ev.type === 'searching')) {
        const st = f.steps[f.steps.length - 1];
        f.think = st ? 'после: ' + (st[1] ? st[1].toLowerCase() + ' ' + st[2] : st[2]) : '';
        this.show('thinking');
      }
    }
    if (f.limitReset !== null && now >= f.limitReset) {
      f.limitReset = null;
      if (s.event && s.event.type === 'ratelimit') {
        s.event = null;
        s.notify();
      }
    }
    if (this.isBusy() && f.lastActive !== null && now - f.lastActive > STALE_MS) this.clearBusy();
  }

  onUsage(u: Usage): void {
    const f = this.feed;
    f.plan = u.plan || 'Pro';
    const reset = u.limit ? limitReset(u.limit.text, u.limit.at) : null;
    const s = this.s;
    if (reset !== null && reset > this.host.now()) {
      f.limitReset = reset;
      this.attach();
      const up = s.event && s.event.type === 'ratelimit';
      if (!up && !this.cur && (!s.event || this.isBusy() || s.event.src === 'agent')) this.host.m.trigger('ratelimit');
    } else {
      f.limitReset = null;
      if (s.event && s.event.type === 'ratelimit') {
        s.event = null;
        s.notify();
      }
    }
  }
}
