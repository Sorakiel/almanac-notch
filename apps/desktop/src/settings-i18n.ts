// The settings window in English (stage 8). settings.html stays Russian; its text nodes and a few
// attributes are swapped by this table, keyed by the Russian text with whitespace collapsed.
import { EN, type Lang } from '@almanac-notch/island';

export const SETTINGS_EN: Readonly<Record<string, string>> = {
  // tabs and the general page
  Общие: 'General',
  Модули: 'Modules',
  Остров: 'Island',
  Состояние: 'State',
  'Состояние острова': 'Island state',
  Авто: 'Auto',
  Закрыто: 'Closed',
  Полуоткрыто: 'Half-open',
  Открыто: 'Open',
  Вкладки: 'Tabs',
  'Чат в острове': 'Chat in the island',
  Язык: 'Language',
  'Язык интерфейса': 'Interface language',
  'Как в системе': 'System',
  'Проверить события': 'Test events',
  Внимание: 'Attention',
  Вопрос: 'Question',
  Успех: 'Success',
  Ошибка: 'Error',
  Привет: 'Hello',
  Сон: 'Sleep',
  Приложение: 'App',
  'Выйти из Almanac Notch': 'Quit Almanac Notch',
  // module pages
  'Модуль включён': 'Module on',
  'Установить хуки…': 'Install hooks…',
  'Удалить хуки…': 'Remove hooks…',
  'Что это': 'What it is',
  'Хуки - короткие команды в ~/.claude/settings.json: Claude Code сообщает острову, что делает, и ждёт ответа на разрешения и вопросы. Перед записью покажу, что изменится, и сделаю копию файла. Ваши другие хуки не трогаю.':
    'Hooks are short commands in ~/.claude/settings.json: Claude Code tells the island what it is doing and waits for answers to permissions and questions. Before writing I show what changes and back the file up. Your other hooks stay untouched.',
  'Источник календаря': 'Calendar source',
  'Ссылка iCal': 'iCal link',
  Ничего: 'None',
  'Секретная ссылка на календарь': 'Secret calendar link',
  Подключить: 'Connect',
  Заменить: 'Replace',
  'Где взять ссылку': 'Where to get the link',
  'Google: calendar.google.com → ⚙ Настройки → слева ваш календарь → «Секретный адрес в формате iCal» → копировать.':
    'Google: calendar.google.com → ⚙ Settings → your calendar on the left → “Secret address in iCal format” → copy.',
  'Outlook.com: Параметры → Календарь → Общие календари → Опубликовать календарь → ссылка ICS.':
    'Outlook.com: Settings → Calendar → Shared calendars → Publish a calendar → ICS link.',
  'iCloud: Календарь → значок доступа у календаря → «Публичный календарь» → копировать ссылку.':
    'iCloud: Calendar → the sharing icon next to a calendar → “Public Calendar” → copy link.',
  'На Mac остров читает системный Календарь: в нём уже есть ваши аккаунты Google, iCloud и Exchange (Системные настройки → Интернет-аккаунты).':
    'On a Mac the island reads the system Calendar: it already has your Google, iCloud and Exchange accounts (System Settings → Internet Accounts).',
  'Доступ к календарю…': 'Calendar access…',
  'Что читается и куда уходит': 'What is read and where it goes',
  'Только название и время встреч на 48 часов вперёд. Outlook читается на этом компьютере, без сети. Ссылка iCal открывается раз в 5 минут, других запросов нет; сама ссылка - секрет и хранится в системном хранилище паролей.':
    'Only the title and time of meetings for the next 48 hours. Outlook is read on this computer, without the network. The iCal link is opened every 5 minutes, nothing else is requested; the link itself is a secret and is kept in the system credential store.',
  'Что играет в системе: название, исполнитель, альбом, обложка, позиция, и громкость. Обложку отдаёт сам плеер, сети нет. Кнопки острова управляют тем плеером, который сейчас играет.':
    'What is playing in the system: title, artist, album, cover, position, and the volume. The cover comes from the player itself, no network. The island buttons control the player that is playing now.',
  'Токен доступа': 'Access token',
  Отключить: 'Disconnect',
  'Как получить токен': 'How to get a token',
  'Откройте github.com → Settings → Developer settings → Fine-grained tokens → Generate new token.':
    'Open github.com → Settings → Developer settings → Fine-grained tokens → Generate new token.',
  'Repository access: все репозитории или только нужные.':
    'Repository access: all repositories or only the ones you need.',
  'Права только на чтение: Contents, Pull requests, Commit statuses, Actions (Metadata добавится сама).':
    'Read-only permissions: Contents, Pull requests, Commit statuses, Actions (Metadata is added by itself).',
  'Названия репозиториев, статус проверок последнего коммита основной ветки, число PR, ждущих вашего ревью, и время ваших коммитов за 7 дней. Запросы идут только на api.github.com раз в минуту. Токен хранится в связке ключей системы и не попадает ни в файлы, ни в остров.':
    'Repository names, the check status of the latest commits, the number of PRs waiting for your review, and the times of your commits over 7 days. Requests go only to api.github.com, once a minute. The token is kept in the system keychain and never gets into files or the island.',
  'Пока заглушка': 'A stub for now',
  'Привычки дня. Сейчас это заглушка из прототипа; подключение к Almanac появится позже (локальное API или файл). Сети нет.':
    'Habits of the day. For now this is the prototype stub; the Almanac connection comes later (a local API or a file). No network.',
  // dynamic texts (src/settings.ts)
  'GitHub не принял сохранённый токен': 'GitHub rejected the saved token',
  // Vercel, the module limit
  'Кроме Claude Code можно включить не больше 4 модулей - сначала выключите один':
    'Besides Claude Code, at most 4 modules can be on - switch one off first',
  'Кроме Claude Code включено не больше 4 модулей': 'Besides Claude Code, at most 4 modules are on',
  'Токен Vercel': 'Vercel token',
  'Откройте vercel.com → Account Settings → Tokens → Create Token.':
    'Open vercel.com → Account Settings → Tokens → Create Token.',
  'Scope: личный аккаунт или команда, срок - на ваш выбор.': 'Scope: your personal account or a team, any expiration.',
  'Имя пользователя, список команд и последние деплои ваших проектов: название проекта, состояние сборки, продакшен или превью, ветка и время. Код, переменные окружения и логи не читаются. Запросы идут только на api.vercel.com раз в минуту и только при включённом модуле. Токен хранится в связке ключей системы и не попадает ни в файлы, ни в остров.':
    'Your username, team list and the latest deployments of your projects: project name, build state, production or preview, branch and time. Code, environment variables and logs are not read. Requests go only to api.vercel.com, once a minute, and only while the module is on. The token is kept in the system keychain and never gets into files or the island.',
  'Vercel не принял сохранённый токен': 'Vercel rejected the saved token',
  // Notion
  'Токен интеграции': 'Integration token',
  'Откройте notion.so/profile/integrations → New integration, тип Internal.':
    'Open notion.so/profile/integrations → New integration, type Internal.',
  'В Capabilities оставьте только Read content и Read user information without email, скопируйте Internal Integration Secret.':
    'Under Capabilities keep only Read content and Read user information without email, then copy the Internal Integration Secret.',
  'В Notion на нужной странице: ••• → Connections → ваша интеграция. Остров увидит эту страницу и её подстраницы.':
    'In Notion, on the page you want: ••• → Connections → your integration. The island will see that page and its subpages.',
  'Название рабочего пространства, имена его участников и страницы, к которым вы дали доступ интеграции: название, значок, кто и когда правил последним, ссылка. Содержимое страниц и почта участников не читаются. Запросы идут только на api.notion.com раз в минуту и только при включённом модуле. Токен хранится в связке ключей системы и не попадает ни в файлы, ни в остров. Строка карточки открывает страницу на notion.so в браузере.':
    "The workspace name, its members' names and the pages you shared with the integration: title, icon, who edited last and when, link. Page contents and members' emails are not read. Requests go only to api.notion.com, once a minute, and only while the module is on. The token is kept in the system keychain and never gets into files or the island. A card row opens the page on notion.so in your browser.",
  'Notion не принял сохранённый токен': 'Notion rejected the saved token',
  ' · нет доступа к страницам': ' · no pages shared',
  'Это вы': 'This is you',
  'Остров подаёт знак, когда страницу правит кто-то другой.': 'The island gives a sign when someone else edits a page.',
  'Чтобы остров сообщал о чужих правках, включите у интеграции Read user information.':
    'To hear about edits by others, turn on Read user information for the integration.',
  'Не выбрано': 'Not picked',
  проект: 'project',
  проекта: 'projects',
  проектов: 'projects',
  'Не подключён': 'Not connected',
  'Хотя бы один модуль должен остаться включённым': 'At least one module must stay on',
  'Ничего не играет': 'Nothing playing',
  'Музыка недоступна на этой системе': 'Music is unavailable on this system',
  'Пауза · ': 'Paused · ',
  'ссылка iCal': 'iCal link',
  'системный Календарь': 'system Calendar',
  календарь: 'calendar',
  'Доступ ещё не выдан': 'Access not granted yet',
  'Календарь пока не ответил': 'The calendar has not answered yet',
  'Outlook не найден': 'Outlook not found',
  'Ссылка не открывается': 'The link does not open',
  'Нет доступа к календарю': 'No calendar access',
  'Недоступен на этой системе': 'Unavailable on this system',
  'Календарь по умолчанию из классического Outlook на этом компьютере, без сети.':
    'The default calendar of classic Outlook on this computer, without the network.',
  'Google, Outlook.com, iCloud, Яндекс и другие: секретная ссылка на календарь в формате iCal.':
    'Google, Outlook.com, iCloud, Yandex and others: a secret calendar link in iCal format.',
  'Карточка календаря пустая.': 'The calendar card is empty.',
  'Карточка календаря пустая. Классический Outlook не найден: новый Outlook подключается ссылкой iCal.':
    'The calendar card is empty. Classic Outlook not found: the new Outlook connects with an iCal link.',
  'Хуки установлены': 'Hooks installed',
  'Хуки не установлены': 'Hooks not installed',
  'Windows: системный медиа-сеанс - любой плеер, который показывает себя в регуляторе громкости (Spotify, браузеры, Я.Музыка).':
    'Windows: the system media session - any player that shows up in the volume flyout (Spotify, browsers, Yandex Music).',
  'Mac: любой плеер из «Исполняется» в Пункте управления, включая браузеры.':
    'Mac: any player from Now Playing in Control Center, browsers included.',
  'Подключено: {0} за 48 ч': 'Connected: {0} in 48 h',
  '{0} · {1} за 48 ч': '{0} · {1} in 48 h',
  '{0} · CI в {1}': '{0} · CI in {1}',
  ' · нет связи': ' · offline',
};

let lang: Lang = 'ru';

export function setLang(l: Lang): void {
  lang = l;
}

export function getLang(): Lang {
  return lang;
}

/** A text of the settings window (or of the island's table) in the current language. */
export function t(ru: string, ...args: (string | number)[]): string {
  const text = lang === 'en' ? (SETTINGS_EN[ru] ?? EN[ru] ?? ru) : ru;
  return args.length ? text.replace(/\{(\d)\}/g, (m, i: string) => String(args[Number(i)] ?? m)) : text;
}

/** "1 встреча", "3 встречи", "5 встреч" / "1 meeting", "3 meetings" */
export function count(n: number, ru: [string, string, string], en: [string, string]): string {
  if (lang === 'en') return n + ' ' + (n === 1 ? en[0] : en[1]);
  const m10 = n % 10,
    m100 = n % 100;
  return (
    n + ' ' + (m10 === 1 && m100 !== 11 ? ru[0] : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? ru[1] : ru[2])
  );
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** English for a static text of the page; the island's table covers the shared words */
const en = (key: string): string | undefined => SETTINGS_EN[key] ?? EN[key];
/** the Russian original of every swapped text node and attribute, to switch back */
const original = new WeakMap<Node, string>();
const originalAttrs = new WeakMap<Element, Record<string, string>>();
const ATTRS = ['aria-label', 'placeholder', 'title'] as const;

/** Swap the static texts of the page to the current language (and back). */
export function translatePage(root: HTMLElement): void {
  document.documentElement.lang = lang;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const ru = original.get(n) ?? n.nodeValue ?? '';
    const key = norm(ru);
    const tr = en(key);
    if (!key || tr === undefined) continue;
    original.set(n, ru);
    n.nodeValue = lang === 'en' ? tr : ru;
  }
  root.querySelectorAll('[aria-label], [placeholder], [title]').forEach((el) => {
    const was = originalAttrs.get(el) ?? {};
    for (const a of ATTRS) {
      const ru = was[a] ?? el.getAttribute(a);
      const tr = ru === null ? undefined : en(norm(ru));
      if (ru === null || tr === undefined) continue;
      was[a] = ru;
      el.setAttribute(a, lang === 'en' ? tr : ru);
    }
    originalAttrs.set(el, was);
  });
}
