import { describe, expect, it } from 'vitest';
import { KEY_DEFAULTS, clashes, comboFromEvent, comboLabel, defaultKeys, isCombo, normCombo, parseKeys } from './keys';

const press = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) =>
  ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }) as KeyboardEvent;

describe('answer keys', () => {
  it('ships ⌥Y / ⌥N / ⌥1-3, all on', () => {
    const k = defaultKeys();
    expect(k.approve).toEqual({ combo: 'Alt+Y', on: true });
    expect(Object.values(k).map((b) => b.combo)).toEqual(Object.values(KEY_DEFAULTS));
  });

  it('reads what is stored, each action on its own', () => {
    const k = parseKeys(JSON.stringify({ deny: { combo: 'Control+Alt+K', on: false }, opt1: { combo: 'Y' }, opt2: 5 }));
    expect(k.deny).toEqual({ combo: 'Control+Alt+K', on: false });
    // a key without a modifier, or junk, falls back to the default
    expect(k.opt1.combo).toBe('Alt+1');
    expect(k.opt2.combo).toBe('Alt+2');
    expect(parseKeys('not json')).toEqual(defaultKeys());
    expect(parseKeys(null)).toEqual(defaultKeys());
  });

  it('takes the key from the physical key, not the layout', () => {
    // a Russian layout, or ⌥ turning Y into "ý": still Alt+Y
    expect(comboFromEvent(press('KeyY', { altKey: true }))).toBe('Alt+Y');
    expect(comboFromEvent(press('Digit2', { ctrlKey: true, altKey: true }))).toBe('Control+Alt+2');
    expect(comboFromEvent(press('KeyK', { metaKey: true, shiftKey: true }))).toBe('Shift+Super+K');
  });

  it('refuses a bare key, Shift alone and modifiers alone', () => {
    expect(comboFromEvent(press('KeyY'))).toBeNull();
    expect(comboFromEvent(press('KeyY', { shiftKey: true }))).toBeNull();
    expect(comboFromEvent(press('AltLeft', { altKey: true }))).toBeNull();
    expect(isCombo('Alt+Shift')).toBe(false);
    expect(isCombo('Shift+Alt+F5')).toBe(true);
  });

  it('reads as the system writes it', () => {
    expect(comboLabel('Control+Alt+Shift+Super+K', true)).toBe('⌃⌥⇧⌘K');
    expect(comboLabel('Alt+Y', false)).toBe('Alt+Y');
    expect(comboLabel('Control+Space', false)).toBe('Ctrl+␣');
  });

  it('matches the plugin spelling of a pressed shortcut', () => {
    expect(normCombo('Alt+Y')).toBe(normCombo('alt+KeyY'));
    expect(normCombo('Control+Alt+1')).toBe(normCombo('alt+ctrl+Digit1'));
    expect(normCombo('Alt+Y')).not.toBe(normCombo('Alt+N'));
  });

  it('finds two switched-on actions on one combination', () => {
    const k = defaultKeys();
    expect(clashes(k)).toEqual([]);
    k.deny.combo = 'alt+KeyY';
    expect(clashes(k).sort()).toEqual(['approve', 'deny']);
    // a switched-off action takes no combination
    k.deny.on = false;
    expect(clashes(k)).toEqual([]);
  });
});
