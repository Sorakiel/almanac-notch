// The settings window in English (stage 8). settings.html stays Russian; its text nodes and a few
// attributes are swapped by this table, keyed by the Russian text with whitespace collapsed.
import { EN, type Lang } from '@almanac-notch/island';

export const SETTINGS_EN: Readonly<Record<string, string>> = {
  // Almanac
  'В этой сборке нет адреса Almanac: остров показывает пример привычек. Адрес задаётся при сборке (файл .env.almanac).':
    'This build has no Almanac address: the island shows sample habits. The address is set at build time (the .env.almanac file).',
  Пароль: 'Password',
  'Код из письма': 'Code from the email',
  'Прислать код': 'Send a code',
  Войти: 'Sign in',
  'Остров показывает привычки на сегодня; нажатие на привычку отмечает её в Almanac.':
    "The island shows today's habits; tapping a habit marks it in Almanac.",
  Выйти: 'Sign out',
  'Как войти': 'How to sign in',
  'Почта и пароль от Almanac.': 'Your Almanac email and password.',
  'Если в Almanac вы входите по ссылке из письма: «Код из письма» → «Прислать код», введите код из письма.':
    'If you sign in to Almanac with an email link: "Code from the email" → "Send a code", then enter the code.',
  'Привычки на сегодня из вашего аккаунта Almanac: название, сколько отмечено и сколько нужно за день. Нажатие на привычку в острове отмечает её в Almanac, как нажатие в самом Almanac. Заметки, серии, тренировки и другие данные не читаются. Запросы идут только на сервер Almanac, раз в минуту и только при включённом модуле. Пароль не сохраняется; ключ входа хранится в связке ключей системы, почта - в файле настроек приложения. В остров не попадают ни пароль, ни ключ.':
    "Today's habits from your Almanac account: the name, how many taps are done and how many the day needs. Tapping a habit on the island marks it in Almanac, the same as a tap in Almanac. Notes, streaks, workouts and other data are not read. Requests go only to the Almanac server, once a minute and only while the module is on. The password is not kept; the sign-in key is kept in the system keychain, the email in the app's settings file. Neither the password nor the key reaches the island.",
  'Способ входа': 'Sign-in method',
  'Пример из прототипа': 'Prototype sample',
  'Вход истёк - войдите снова': 'Signed out - sign in again',
  'Код отправлен на почту': 'The code is on its way to your email',
  // app and updates (stage 8f)
  'Запускать вместе с системой': 'Launch at login',
  'Проверять обновления': 'Check for updates',
  'Проверить сейчас': 'Check now',
  'Версия {0}': 'Version {0}',
  'Проверка…': 'Checking…',
  'Установлена последняя версия': 'You have the latest version',
  'Вышла версия {0}': 'Version {0} is out',
  'Загрузка обновления… {0}%': 'Downloading the update… {0}%',
  'Обновить и перезапустить': 'Update and restart',
  // first-run guide (stage 8f)
  'Привет! Я живу у выреза камеры': 'Hi! I live at the camera notch',
  'Покажу, сколько осталось до созвона, что играет и всё, что подключите: от CI и деплоев до привычек. Настроим за минуту.':
    "I'll show how long until your next call, what's playing and everything you connect - from CI and deploys to habits. Setup takes a minute.",
  'Подключим Claude Code': "Let's connect Claude Code",
  'Буду показывать шаги агента и отвечать на его вопросы и запросы разрешений прямо с острова.':
    "I'll show the agent's steps and answer its questions and permission requests right from the island.",
  '+ хуки Almanac Notch': '+ Almanac Notch hooks',
  'Перед записью покажу дифф и сохраню копию файла. Чужие хуки останутся.':
    "Before writing I'll show the diff and keep a copy of the file. Other hooks stay.",
  'Ближайшая встреча': 'Your next meeting',
  'Покажу, сколько осталось до созвона, и напомню заранее. macOS один раз спросит разрешение.':
    "I'll show how long until your call and remind you ahead. macOS will ask for permission once.",
  'Покажу, сколько осталось до созвона: из классического Outlook на этом компьютере или по секретной ссылке iCal.':
    "I'll show how long until your call: from classic Outlook on this computer or a secret iCal link.",
  'Разрешить доступ': 'Allow access',
  'Выбрать источник': 'Pick a source',
  'Что ещё показывать?': 'What else should I show?',
  'Claude Code всегда со мной. Выберите до четырёх модулей, подключить их можно потом.':
    'Claude Code is always with me. Pick up to four modules - you can connect them later.',
  'Выбрано {0} из 4': '{0} of 4 picked',
  'Всё готово': 'All set',
  'Раз в день приложение смотрит на GitHub, вышла ли новая версия. Ставится только по кнопке.':
    'Once a day the app checks GitHub for a new version. It installs only when you press the button.',
  'Остров - у верхнего края экрана: наведите на него курсор. Меню - значок Almanac Notch в трее.':
    'The island sits at the top edge of the screen - hover over it. The menu is the Almanac Notch icon in the tray.',
  'Остров - у выреза камеры: наведите на него курсор. Меню - значок Almanac Notch в строке меню.':
    'The island sits at the camera notch - hover over it. The menu is the Almanac Notch icon in the menu bar.',
  Назад: 'Back',
  Пропустить: 'Skip',
  Дальше: 'Next',
  Начать: 'Start',
  Подключено: 'Connected',
  'Доступ есть': 'Access granted',
  'Открыть приветствие': 'Open the welcome guide',
  'Войти через Almanac': 'Sign in with Almanac',
  'Подтвердите вход в браузере': 'Confirm the sign-in in your browser',
  Отмена: 'Cancel',
  'Войти паролем или кодом из письма': 'Sign in with a password or an email code',
  '«Войти через Almanac» открывает Almanac в браузере. Там нажмите «Разрешить» - нотч получит свой доступ только к привычкам. Отключить его можно здесь или в Almanac: Профиль → Подключённые приложения.':
    '"Sign in with Almanac" opens Almanac in your browser. Press "Allow" there - the notch gets its own access, to habits only. You can disconnect it here or in Almanac: Profile → Connected apps.',
  'Запасной путь - почта и пароль от Almanac или код из письма.':
    'The fallback is your Almanac email and password or a code from the email.',
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
  // sounds (stage 9a)
  Звук: 'Sound',
  События: 'Events',
  'Разрешения, вопросы, готово, ошибки, начало работы агента':
    'Permissions, questions, done, errors, an agent starting work',
  Маскот: 'Mascot',
  'Приветствие, клики, поглаживание, сон': 'The greeting, clicks, stroking, sleep',
  'Остров и кнопки': 'Island and buttons',
  'Открытие, закрытие, вкладки, переключатели': 'Opening, closing, tabs, switches',
  'Громкость и общий выключатель - в карточке настроек острова. Во время звонка звуки молчат, под музыку кнопки молчат, а остальное тише; ночью (с 22 до 8) всё на треть тише.':
    "The volume and the main switch are in the island's settings card. During a call sounds stay silent, under music the buttons are silent and the rest quieter; at night (10 pm to 8 am) everything is a third quieter.",
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
  'Хуки - короткие команды в ~/.claude/settings.json: Claude Code сообщает острову, что делает, и ждёт ответа на разрешения и вопросы. Перед записью видно, что изменится, и сохраняется копия файла. Другие ваши хуки не меняются.':
    'Hooks are short commands in ~/.claude/settings.json: Claude Code tells the island what it is doing and waits for answers to permissions and questions. Before writing you see what changes, and the file is backed up. Your other hooks stay untouched.',
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
  // dynamic texts (src/settings.ts)
  'GitHub не принял сохранённый токен': 'GitHub rejected the saved token',
  // Vercel, the module limit
  'Одновременно можно включить не больше 5 модулей - сначала выключите один':
    'At most 5 modules can be on at once - switch one off first',
  'В острове помещается 5 модулей': 'The island fits 5 modules',
  'Токен Vercel': 'Vercel token',
  'Откройте vercel.com → Account Settings → Tokens → Create Token.':
    'Open vercel.com → Account Settings → Tokens → Create Token.',
  'Scope: личный аккаунт или команда, срок - на ваш выбор.': 'Scope: your personal account or a team, any expiration.',
  'Имя пользователя, список команд и последние деплои ваших проектов: название проекта, состояние сборки, продакшен или превью, ветка и время. Код, переменные окружения и логи не читаются. Запросы идут только на api.vercel.com раз в минуту и только при включённом модуле. Токен хранится в связке ключей системы и не попадает ни в файлы, ни в остров.':
    'Your username, team list and the latest deployments of your projects: project name, build state, production or preview, branch and time. Code, environment variables and logs are not read. Requests go only to api.vercel.com, once a minute, and only while the module is on. The token is kept in the system keychain and never gets into files or the island.',
  'Vercel не принял сохранённый токен': 'Vercel rejected the saved token',
  // Grafana
  'Адрес Grafana': 'Grafana address',
  'Токен сервисного аккаунта': 'Service account token',
  'Дашборд в карточке': 'Dashboard on the card',
  'Панель для графика': 'Panel to graph',
  'Карточка показывает график панели за последний час; клик по нему открывает дашборд.':
    "The card shows the panel's graph for the last hour; clicking it opens the dashboard.",
  'В Grafana: Administration → Users and access → Service accounts → Add service account, роль Viewer.':
    'In Grafana: Administration → Users and access → Service accounts → Add service account, role Viewer.',
  'В сервисном аккаунте: Add service account token → Generate token, скопируйте токен (glsa_…).':
    'In the service account: Add service account token → Generate token, copy the token (glsa_…).',
  'Вставьте сюда адрес Grafana, как в браузере (например, https://имя.grafana.net), и токен.':
    'Paste the Grafana address as in your browser (for example, https://name.grafana.net) and the token here.',
  'Название организации, правила алертов (название, состояние, с какого времени горит), список дашбордов для выбора и у выбранного дашборда - название и данные одной панели за последний час. Другие данные, логи и настройки Grafana не читаются. Запросы идут только на адрес, который вы ввели, раз в минуту и только при включённом модуле. Адрес и токен хранятся в связке ключей системы и не попадают ни в файлы, ни в остров; выбранный дашборд - в файле настроек приложения. По http можно подключить только адрес в локальной сети.':
    "The organization name, alert rules (name, state, since when it fires), the dashboard list to pick from and, for the picked dashboard, its title and one panel's data for the last hour. Other data, logs and Grafana settings are not read. Requests go only to the address you entered, once a minute, and only while the module is on. The address and token are kept in the system keychain and never get into files or the island; the picked dashboard is kept in the app's settings file. Plain http works only for an address on your local network.",
  'Не подключена': 'Not connected',
  'Grafana не приняла сохранённый токен': 'Grafana rejected the saved token',
  ' · горит {0}': ' · {0} firing',
  'Адрес: {0}': 'Address: {0}',
  'Не выбран': 'Not picked',
  'Без графика': 'No graph',
  правило: 'rule',
  правила: 'rules',
  правил: 'rules',
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
  // installer and uninstall windows (stage 8g)
  'Удалить Almanac Notch': 'Uninstall Almanac Notch',
  'Удалить Almanac Notch?': 'Uninstall Almanac Notch?',
  'Хуки Claude Code и запуск при входе будут сняты, приложение уйдёт в Корзину.':
    'The Claude Code hooks and launch at login will be removed, and the app will go to the Trash.',
  'Хуки Claude Code и запуск при входе будут сняты, программа и её ярлыки - удалены.':
    'The Claude Code hooks and launch at login will be removed, along with the app and its shortcuts.',
  'Удалить настройки и данные': 'Remove settings and data',
  'Подключения, токены в связке ключей, кэш и доступ к календарю':
    'Connections, tokens in the keychain, the cache and calendar access',
  'Подключения, токены в диспетчере учётных данных и кэш': 'Connections, tokens in Credential Manager and the cache',
  Закрыть: 'Close',
  Удалить: 'Uninstall',
  'Удаление…': 'Uninstalling…',
  'Снимаются хуки Claude Code, удаляются файлы.': 'Removing the Claude Code hooks and the files.',
  'Almanac Notch удалён': 'Almanac Notch is uninstalled',
  'Хуки Claude Code сняты. Настройки остались - пригодятся, если вернёте приложение.':
    'The Claude Code hooks are gone. Your settings stay, in case you come back.',
  'Хуки Claude Code сняты, настройки и данные удалены.': 'The Claude Code hooks, settings and data are gone.',
  'Удалить…': 'Uninstall…',
  'Снимает хуки Claude Code и запуск при входе; настройки и данные - по желанию':
    'Removes the Claude Code hooks and launch at login; settings and data if you choose',
  'Установка Almanac Notch': 'Almanac Notch Setup',
  'Живой остров у выреза камеры: ближайший созвон, музыка и модули, которые вы выберете сами.':
    'A living island at the camera notch: your next call, music and the modules you pick.',
  Папка: 'Folder',
  Изменить: 'Change',
  'Ярлык на рабочем столе': 'Desktop shortcut',
  Установить: 'Install',
  'Установка…': 'Installing…',
  'Займёт несколько секунд.': 'This takes a few seconds.',
  'Almanac Notch установлен. Остров живёт у верхнего края экрана, по центру.':
    'Almanac Notch is installed. The island lives at the top centre of the screen.',
  Открыть: 'Open',
  'Версия {0} обновится до {1}. Настройки и подключения сохранятся.':
    'Version {0} will be updated to {1}. Settings and connections stay.',
  'Версия {0} уже установлена - она будет поставлена заново. Настройки и подключения сохранятся.':
    'Version {0} is already installed - it will be installed again. Settings and connections stay.',
  'Установлена более новая версия {0}. Можно поставить {1} поверх, настройки сохранятся.':
    'A newer version {0} is installed. You can put {1} over it, settings stay.',
  Обновить: 'Update',
  Переустановить: 'Reinstall',
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
