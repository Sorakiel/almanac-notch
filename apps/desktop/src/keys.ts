// The answer keys (stage 9f): which global combination answers Claude Code's open permission or
// question, and whether it is on. Kept in the storage the island and the settings windows share;
// the island registers them only while a prompt is open (src/main.ts, syncHotkeys).

export type KeyAction = 'approve' | 'deny' | 'opt1' | 'opt2' | 'opt3';
export const KEY_ACTIONS: readonly KeyAction[] = ['approve', 'deny', 'opt1', 'opt2', 'opt3'];

/** a combination in the global-shortcut plugin's accelerator form ("Alt+Y") and its switch */
export interface KeyBinding {
  combo: string;
  on: boolean;
}
export type Keys = Record<KeyAction, KeyBinding>;

/** the shipped answer keys (decision 2026-10-14): ⌥Y / ⌥N / ⌥1-3 */
export const KEY_DEFAULTS: Readonly<Record<KeyAction, string>> = {
  approve: 'Alt+Y',
  deny: 'Alt+N',
  opt1: 'Alt+1',
  opt2: 'Alt+2',
  opt3: 'Alt+3',
};

export const KEYS_STORAGE = 'almanac-notch.keys';

export function defaultKeys(): Keys {
  const k = {} as Keys;
  for (const a of KEY_ACTIONS) k[a] = { combo: KEY_DEFAULTS[a], on: true };
  return k;
}

/** what is stored, each action checked on its own: a broken entry falls back to its default */
export function parseKeys(raw: string | null): Keys {
  const k = defaultKeys();
  let saved: unknown;
  try {
    saved = JSON.parse(raw ?? '{}');
  } catch {
    return k;
  }
  if (!saved || typeof saved !== 'object') return k;
  for (const a of KEY_ACTIONS) {
    const v = (saved as Record<string, unknown>)[a];
    if (!v || typeof v !== 'object') continue;
    const { combo, on } = v as Record<string, unknown>;
    if (typeof combo === 'string' && isCombo(combo)) k[a].combo = combo;
    if (typeof on === 'boolean') k[a].on = on;
  }
  return k;
}

export function readKeys(): Keys {
  try {
    return parseKeys(localStorage.getItem(KEYS_STORAGE));
  } catch {
    return defaultKeys();
  }
}

export function writeKeys(k: Keys): void {
  try {
    localStorage.setItem(KEYS_STORAGE, JSON.stringify(k));
  } catch {
    // not saved: the island keeps the keys it has
  }
}

const MODS = ['Control', 'Alt', 'Shift', 'Super'] as const;

/** a combination this app accepts: one or more modifiers besides Shift alone, then one key */
export function isCombo(c: string): boolean {
  const parts = c.split('+');
  const key = parts.pop() ?? '';
  if (!key || parts.length === 0 || (MODS as readonly string[]).includes(key)) return false;
  if (!parts.every((p) => (MODS as readonly string[]).includes(p))) return false;
  // Shift alone would take a capital letter away from every text field
  return parts.some((p) => p !== 'Shift');
}

/**
 * The combination a key press means, or null while only modifiers are down. The key comes from
 * `code`, not `key`: with a Russian layout ⌥Y must still be "Alt+Y", and ⌥ on a Mac turns the
 * character into "ý".
 */
export function comboFromEvent(e: KeyboardEvent): string | null {
  const key = keyOfCode(e.code);
  if (!key) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  const c = [...mods, key].join('+');
  return isCombo(c) ? c : null;
}

function keyOfCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  const named: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    Backquote: 'Backquote',
    Minus: 'Minus',
    Equal: 'Equal',
    BracketLeft: 'BracketLeft',
    BracketRight: 'BracketRight',
    Semicolon: 'Semicolon',
    Quote: 'Quote',
    Comma: 'Comma',
    Period: 'Period',
    Slash: 'Slash',
    Backslash: 'Backslash',
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
  };
  return named[code] ?? null;
}

const MAC_MOD: Record<string, string> = { Control: '⌃', Alt: '⌥', Shift: '⇧', Super: '⌘' };
const WIN_MOD: Record<string, string> = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Win' };
const KEY_SIGN: Record<string, string> = {
  Space: '␣',
  Enter: '↩',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** how the combination reads: "⌥Y" on a Mac (system order ⌃⌥⇧⌘), "Alt+Y" on Windows */
export function comboLabel(c: string, mac: boolean): string {
  const parts = c.split('+');
  const key = parts.pop() ?? '';
  const sign = KEY_SIGN[key] ?? key;
  if (mac) return parts.map((p) => MAC_MOD[p] ?? p).join('') + sign;
  return [...parts.map((p) => WIN_MOD[p] ?? p), sign].join('+');
}

/** the actions whose switched-on combination another switched-on action also uses */
export function clashes(k: Keys): KeyAction[] {
  const seen = new Map<string, KeyAction[]>();
  for (const a of KEY_ACTIONS) {
    if (!k[a].on) continue;
    const c = normCombo(k[a].combo);
    seen.set(c, [...(seen.get(c) ?? []), a]);
  }
  return [...seen.values()].filter((v) => v.length > 1).flat();
}

/** one spelling for comparing: the plugin reports a pressed shortcut its own way ("alt+KeyY") */
export function normCombo(c: string): string {
  const alias: Record<string, string> = {
    ctrl: 'control',
    meta: 'super',
    cmd: 'super',
    command: 'super',
    commandorcontrol: 'super',
    option: 'alt',
  };
  const parts = c.split('+').map((p) => p.trim().toLowerCase());
  const key = (parts.pop() ?? '').replace(/^key([a-z])$/, '$1').replace(/^digit([0-9])$/, '$1');
  const mods = [...new Set(parts.map((p) => alias[p] ?? p))].sort();
  return [...mods, key].join('+');
}
