// The island's own choices in the settings window (stage 9f): opening on hover, closing after the
// pointer leaves, sound and volume - until now only on the island's settings card - and the
// answer keys. All live in the storage the two windows share; the island hears every change
// through the "storage" event (src/main.ts), so nothing here talks to Rust.
import { isRegistered, register, unregister } from '@tauri-apps/plugin-global-shortcut';
import {
  KEY_ACTIONS,
  KEY_DEFAULTS,
  clashes,
  comboFromEvent,
  comboLabel,
  defaultKeys,
  normCombo,
  readKeys,
  writeKeys,
  type KeyAction,
  type Keys,
} from './keys';
import { t } from './settings-i18n';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const isMac = navigator.userAgent.includes('Mac');
const inTauri = '__TAURI_INTERNALS__' in window;

// ---------- the island's card: hover, auto-close, sound, volume ----------
const CARD_KEY = 'almanac-notch.card';
interface Card {
  openOnHover: boolean;
  autoClose: number;
  sound: boolean;
  volume: number;
}
/** the island's defaults (main.ts: AUTO_CLOSE_DEFAULT, DEFAULT_VOLUME) */
const CARD_DEFAULT: Card = { openOnHover: true, autoClose: 5, sound: true, volume: 0.6 };

function readCard(): Card {
  const c = { ...CARD_DEFAULT };
  try {
    const v = JSON.parse(localStorage.getItem(CARD_KEY) ?? '{}') as Partial<Record<keyof Card, unknown>>;
    if (typeof v.openOnHover === 'boolean') c.openOnHover = v.openOnHover;
    // the island's rule (focus.ts autoCloseFrom): 3, 5 or 10; an old 15 or 30 reads as 10
    if (typeof v.autoClose === 'number') c.autoClose = v.autoClose <= 3 ? 3 : v.autoClose <= 5 ? 5 : 10;
    if (typeof v.sound === 'boolean') c.sound = v.sound;
    if (typeof v.volume === 'number' && v.volume >= 0 && v.volume <= 1) c.volume = v.volume;
  } catch {
    // unreadable: the defaults, as the island reads them
  }
  return c;
}
function writeCard(patch: Partial<Card>): void {
  try {
    localStorage.setItem(CARD_KEY, JSON.stringify({ ...readCard(), ...patch }));
  } catch {
    // not saved: the island keeps its choice
  }
  // "storage" reaches only the other windows: this one's example hears it here
  document.dispatchEvent(new CustomEvent('settings:card'));
}

const hover = $<HTMLInputElement>('open-hover'),
  closeRadios = [...document.querySelectorAll<HTMLInputElement>('input[name=autoclose]')],
  sndOn = $<HTMLInputElement>('snd-on'),
  sndVol = $<HTMLInputElement>('snd-vol');

function renderCard(): void {
  const c = readCard();
  hover.checked = c.openOnHover;
  $('hover-note').textContent = t(
    c.openOnHover
      ? 'Остров открывается, когда курсор подходит к вырезу.'
      : 'Остров только выглядывает; открывает его клик.',
  );
  for (const r of closeRadios) r.checked = +r.value === c.autoClose;
  sndOn.checked = c.sound;
  sndVol.value = String(c.volume);
  sndVol.style.setProperty('--v', String(c.volume));
  // the volume and the tiers mean nothing while sound is off: shown, but quiet
  $('sound').classList.toggle('muted', !c.sound);
  $('li-sound').textContent = c.sound ? t('Включён · {0} %', Math.round(c.volume * 100)) : t('Выключен');
  // the Sound page's mascot dozes off while sound is off (settings.ts)
  document.dispatchEvent(new CustomEvent('settings:sound', { detail: c.sound }));
}

hover.addEventListener('change', () => {
  writeCard({ openOnHover: hover.checked });
  renderCard();
});
for (const r of closeRadios)
  r.addEventListener('change', () => {
    if (r.checked) writeCard({ autoClose: +r.value });
  });
sndOn.addEventListener('change', () => {
  writeCard({ sound: sndOn.checked });
  renderCard();
});
// the fill follows the thumb at once; the island hears the level on release and plays a sample
sndVol.addEventListener('input', () => sndVol.style.setProperty('--v', sndVol.value));
sndVol.addEventListener('change', () => {
  writeCard({ volume: +sndVol.value });
  renderCard();
});
// the island's card changed the same choices
window.addEventListener('storage', (e) => {
  if (e.key === CARD_KEY) renderCard();
  if (e.key === 'almanac-notch.keys') renderKeys();
});
renderCard();

// ---------- the answer keys ----------
const NAMES: Record<KeyAction, string> = {
  approve: 'Разрешить',
  deny: 'Отклонить',
  opt1: 'Вариант 1',
  opt2: 'Вариант 2',
  opt3: 'Вариант 3',
};
const rows = $('key-rows'),
  note = $('key-note');
/** the action whose combination is being recorded */
let recording: KeyAction | null = null;

function say(text: string, err = false): void {
  note.textContent = text;
  note.classList.toggle('err', err);
}

function renderKeys(): void {
  // the Keys page's mascot watches the keyboard while a combination is being recorded
  document.dispatchEvent(new CustomEvent('settings:rec', { detail: recording !== null }));
  const k = readKeys(),
    clash = clashes(k);
  rows.replaceChildren(
    ...KEY_ACTIONS.map((a) => {
      const row = document.createElement('div');
      row.className = 'g-row key-row';
      row.classList.toggle('off', !k[a].on);
      const name = document.createElement('span');
      name.textContent = t(NAMES[a]);
      const chip = document.createElement('button');
      chip.className = 'key-chip';
      chip.classList.toggle('rec', recording === a);
      chip.classList.toggle('clash', clash.includes(a));
      chip.textContent = recording === a ? t('Нажмите клавиши…') : comboLabel(k[a].combo, isMac);
      chip.disabled = !k[a].on;
      chip.addEventListener('click', () => {
        recording = recording === a ? null : a;
        say(recording ? t('Новое сочетание для «{0}». Esc - отмена.', t(NAMES[a])) : '');
        renderKeys();
      });
      const sw = document.createElement('input');
      sw.type = 'checkbox';
      sw.className = 'toggle';
      sw.checked = k[a].on;
      sw.setAttribute('aria-label', t(NAMES[a]));
      sw.addEventListener('change', () => {
        const next = readKeys();
        next[a].on = sw.checked;
        // switched back on into a combination another action took meanwhile: say so, keep it off
        if (sw.checked && clashes(next).includes(a)) {
          say(t('«{0}» уже занято: сначала смените одно из сочетаний.', comboLabel(next[a].combo, isMac)), true);
          sw.checked = false;
          return;
        }
        writeKeys(next);
        say('');
        renderKeys();
      });
      row.append(name, chip, sw);
      return row;
    }),
  );
  $('key-reset').hidden = KEY_ACTIONS.every((a) => k[a].on && k[a].combo === KEY_DEFAULTS[a]);
}

/** true when another app already holds the combination: a trial registration says so */
async function heldElsewhere(combo: string): Promise<boolean> {
  if (!inTauri) return false;
  try {
    if (await isRegistered(combo)) return false;
    await register(combo, () => undefined);
    await unregister(combo);
    return false;
  } catch {
    return true;
  }
}

document.addEventListener(
  'keydown',
  (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    const a = recording;
    if (e.key === 'Escape') {
      recording = null;
      say('');
      renderKeys();
      return;
    }
    const combo = comboFromEvent(e);
    // modifiers alone, or a key without one: keep listening, and say why once a key came
    if (!combo) {
      if (!['Alt', 'Control', 'Shift', 'Meta'].includes(e.key))
        say(t('Нужен хотя бы один модификатор: {0}.', isMac ? t('⌥, ⌃ или ⌘') : t('Alt, Ctrl или Win')), true);
      return;
    }
    const k = readKeys();
    const other = KEY_ACTIONS.find((x) => x !== a && k[x].on && normCombo(k[x].combo) === normCombo(combo));
    if (other) {
      say(t('{0} уже отвечает «{1}». Выберите другое сочетание.', comboLabel(combo, isMac), t(NAMES[other])), true);
      return;
    }
    recording = null;
    void heldElsewhere(combo).then((held) => {
      if (held) {
        say(t('{0} занято другим приложением - сочетание не изменено.', comboLabel(combo, isMac)), true);
        renderKeys();
        return;
      }
      const next = readKeys();
      next[a].combo = combo;
      writeKeys(next);
      say(t('«{0}» теперь {1}.', t(NAMES[a]), comboLabel(combo, isMac)));
      renderKeys();
    });
  },
  true,
);

$('key-reset').addEventListener('click', () => {
  writeKeys(defaultKeys() satisfies Keys);
  recording = null;
  say('');
  renderKeys();
});
renderKeys();

/** the language changed: the texts made here are redrawn in it */
export function redrawPrefs(): void {
  renderCard();
  renderKeys();
}
