import { describe, expect, it } from 'vitest';
import { createMascot, defaultSettings, statusOf } from '@almanac-notch/island';
import { AgentDriver, limitReset, toolStep, type AgentMsg, type Hook } from './agent';

const DT = 1 / 60;

function make() {
  const m = createMascot({ settings: defaultSettings(), now: 0, greetAfter: null });
  m.state.W = 758;
  m.state.H = 420;
  const sent: [number, string][] = [];
  let wall = Date.parse('2026-10-14T12:00:00Z');
  m.state.date = () => new Date(wall);
  const d = new AgentDriver({ m, send: (id, a) => sent.push([id, a]), now: () => wall });
  let now = 0;
  const run = (secs: number) => {
    for (let i = 0; i < Math.round(secs / DT); i++) {
      now += DT * 1000;
      wall += DT * 1000;
      m.update(DT, now);
      d.tick();
    }
  };
  const hook = (h: Hook, id?: number) =>
    d.onMessage({ kind: 'hook', hook: h, ...(id !== undefined ? { id } : {}) } as AgentMsg);
  return { m, s: m.state, d, sent, run, hook };
}

describe('toolStep', () => {
  it('maps tools to card steps', () => {
    expect(toolStep('Read', { file_path: '/a/src/notch.rs' })).toEqual(['read', 'Читает', 'notch.rs']);
    expect(toolStep('Edit', { file_path: '/a/island.ts', plus: 12, minus: 3 })).toEqual([
      'edit',
      'Правит',
      'island.ts',
      '+12',
      '−3',
    ]);
    expect(toolStep('Bash', { command: 'npm test\necho done' })).toEqual(['bash', 'Запускает', 'npm test']);
    expect(toolStep('mcp__github__get_issue', {})).toEqual(['bash', 'Вызывает', 'get_issue']);
    expect(toolStep('TodoWrite', {})).toBeNull();
  });
});

describe('AgentDriver', () => {
  it('prompt -> thinking, tools -> working with real steps, stop -> success on the claude card', () => {
    const { s, run, hook } = make();
    hook({ hook_event_name: 'UserPromptSubmit', session_id: 'a' });
    expect(s.event?.type).toBe('thinking');
    hook({ hook_event_name: 'PreToolUse', session_id: 'a', tool_name: 'Read', tool_input: { file_path: '/x/lib.rs' } });
    expect(s.event?.type).toBe('working');
    expect(statusOf(s)?.text).toBe('Читает lib.rs');
    run(0.5);
    hook({ hook_event_name: 'PreToolUse', session_id: 'a', tool_name: 'Bash', tool_input: { command: 'cargo test' } });
    expect(s.event?.type).toBe('working'); // not toggled off by a second working
    expect(statusOf(s)?.text).toBe('Запускает cargo test');
    hook({ hook_event_name: 'PreToolUse', session_id: 'a', tool_name: 'Grep', tool_input: { pattern: 'rrect(' } });
    expect(s.event?.type).toBe('searching');
    expect(s.agent?.search).toBe('grep "rrect("');
    hook({ hook_event_name: 'Stop', session_id: 'a' });
    expect(s.event?.type).toBe('success');
    expect(s.event?.label).toBe('Готово');
    expect(s.event?.src).toBe('agent');
  });

  it('approve in the island goes back to the hook', () => {
    const { m, s, sent, run, hook } = make();
    hook(
      { hook_event_name: 'PermissionRequest', session_id: 'a', tool_name: 'Bash', tool_input: { command: 'git push' } },
      7,
    );
    expect(s.event?.type).toBe('attention');
    expect(s.agent?.cmd).toBe('git push');
    run(1);
    m.answer('approve');
    run(0.1);
    expect(sent).toEqual([[7, 'approve']]);
    run(1);
    expect(s.event?.type).toBe('working');
  });

  it('a question answer is the option index; prompts queue up', () => {
    const { m, s, sent, run, hook } = make();
    const q = { questions: [{ question: 'Раннер?', options: [{ label: 'Vitest' }, { label: 'Jest' }] }] };
    hook({ hook_event_name: 'PreToolUse', session_id: 'a', tool_name: 'AskUserQuestion', tool_input: q }, 1);
    hook(
      { hook_event_name: 'PermissionRequest', session_id: 'b', tool_name: 'Bash', tool_input: { command: 'ls' } },
      2,
    );
    expect(s.event?.type).toBe('question');
    expect(s.agent?.question).toEqual(['Раннер?', ['Vitest', 'Jest']]);
    m.answer('opt:1');
    run(1);
    expect(sent[0]).toEqual([1, 'opt:1']);
    expect(s.event?.type).toBe('attention');
    expect(s.agent?.cmd).toBe('ls');
  });

  it('answered in the terminal: the card goes away; timeout: "none"', () => {
    const { s, sent, run, d, hook } = make();
    hook({ hook_event_name: 'PermissionRequest', session_id: 'a', tool_name: 'Bash', tool_input: { command: 'x' } }, 3);
    d.onMessage({ kind: 'resolved', id: 3 });
    expect(s.event).toBeNull();
    expect(sent).toEqual([]);
    hook({ hook_event_name: 'PermissionRequest', session_id: 'a', tool_name: 'Bash', tool_input: { command: 'y' } }, 4);
    run(31);
    expect(sent).toEqual([[4, 'none']]);
  });

  it('plan limit shows the time to reset and ends by itself', () => {
    const { s, d, run } = make();
    d.onUsage({
      plan: 'Max',
      limit: { at: '2026-10-14T11:59:00Z', text: "You've hit your session limit · resets 12:01pm (UTC)" },
    });
    expect(s.event?.type).toBe('ratelimit');
    expect(statusOf(s)?.text).toBe('Лимит 1:00');
    expect(s.agent?.plan).toBe('Max');
    run(61);
    expect(s.event).toBeNull();
  });
});

describe('limitReset', () => {
  it('parses clock times in a zone, rolling to the next day', () => {
    // 19:00 Moscow (UTC+3) = 16:00 UTC
    expect(new Date(limitReset('resets 7pm (Europe/Moscow)', '2026-07-12T13:29:27Z') ?? 0).toISOString()).toBe(
      '2026-07-12T16:00:00.000Z',
    );
    expect(new Date(limitReset('resets 5:30am (Europe/Moscow)', '2026-07-18T23:18:52Z') ?? 0).toISOString()).toBe(
      '2026-07-19T02:30:00.000Z',
    );
    expect(
      new Date(limitReset('resets Jul 18 at 9pm (Europe/Moscow)', '2026-07-15T16:32:04Z') ?? 0).toISOString(),
    ).toBe('2026-07-18T18:00:00.000Z');
    expect(limitReset('Claude AI usage limit reached|1720000000', '2026-01-01T00:00:00Z')).toBe(1720000000000);
    expect(limitReset('nothing here', '2026-01-01T00:00:00Z')).toBeNull();
  });
});
