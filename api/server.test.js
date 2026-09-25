const test = require('node:test');
const assert = require('node:assert');

// 1. Правильный импорт мидлвары (она обычная функция)
const { requireAuth } = require('./src/routes/auth.js');
const dbService = require('./src/db/database.js');
const { isSafeSegment } = require('./src/utils/validate.js');

// 2. Правильный импорт скрапера (это ЭКЗЕМПЛЯР КЛАССА, импортируем целиком)
const scraperService = require('./src/services/scraper.js');
// Имя куки задаётся через .env (в dev оно своё — auth_token_dev),
// поэтому тест обязан спрашивать его там же, где код, а не писать строку руками
const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'auth_token';

// ============================================================================
// requireAuth tests (Проверка авторизации)
// ============================================================================

test('requireAuth: GET/POST без куки возвращает 401', () => {
  const req = { method: 'GET', cookies: {} };
  let statusCode;
  let payload;
  let nextCalled = false;

  const res = {
    status(code) {
      statusCode = code;
      return { json(body) { payload = body; } };
    }
  };

  requireAuth(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false, 'next() не должен вызываться');
  assert.strictEqual(statusCode, 401, 'Ожидается HTTP 401');
  assert.ok(payload && payload.error, 'Должен быть текст ошибки');
});

test('requireAuth: запрос с неверным токеном возвращает 401', () => {
  const req = { method: 'POST', cookies: { [COOKIE_NAME]: 'WRONG_TOKEN_123' } };
  let statusCode;
  let nextCalled = false;

  const res = {
    status(code) {
      statusCode = code;
      return { json() {} };
    }
  };

  requireAuth(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false, 'next() не должен вызываться при неверном токене');
  assert.strictEqual(statusCode, 401, 'Ожидается HTTP 401');
});

test('requireAuth: запрос с правильным токеном пропускается', (t) => {
  const originalToken = dbService.sessionToken;
  dbService.sessionToken = 'test_token_123';
  t.after(() => { dbService.sessionToken = originalToken; });

  const req = { method: 'POST', cookies: { [COOKIE_NAME]: 'test_token_123' } };
  const res = {};
  let nextCalled = false;

  requireAuth(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, true, 'Запрос с валидным токеном должен проходить');
});

test('requireAuth: пустой токен сервера (до init) не пропускает пустую куку', (t) => {
  const originalToken = dbService.sessionToken;
  dbService.sessionToken = '';
  t.after(() => { dbService.sessionToken = originalToken; });

  const req = { method: 'GET', cookies: { [COOKIE_NAME]: '' } };
  let statusCode;
  let nextCalled = false;
  const res = { status(code) { statusCode = code; return { json() {} }; } };

  requireAuth(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false, 'next() не должен вызываться');
  assert.strictEqual(statusCode, 401, 'Ожидается HTTP 401');
});

test('requireAuth: старый захардкоженный fallback-токен больше не работает', () => {
  const req = { method: 'GET', cookies: { [COOKIE_NAME]: 'fallback_secret_key_for_dev' } };
  let statusCode;
  let nextCalled = false;
  const res = { status(code) { statusCode = code; return { json() {} }; } };

  requireAuth(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false, 'next() не должен вызываться');
  assert.strictEqual(statusCode, 401, 'Ожидается HTTP 401');
});

// ============================================================================
// isSafeSegment tests (Защита id игры от "." / ".." / слэшей)
// ============================================================================

test('isSafeSegment: отбивает опасные значения', () => {
  for (const bad of ['', '.', '..', '../x', 'a/b', '/etc', 'x/..', undefined, null, 42]) {
    assert.strictEqual(isSafeSegment(bad), false, `Должен отбить: ${JSON.stringify(bad)}`);
  }
});

test('isSafeSegment: пропускает реальные имена папок игр', () => {
  for (const good of ['RJ01364780', 'Kubel\'s Pillory RJ255342', 'Cornelica_ Town of Succubi', 'Roseliam-1.08', '...json']) {
    assert.strictEqual(isSafeSegment(good), true, `Должен пропустить: ${good}`);
  }
});

// ============================================================================
// processParsedData tests (Проверка парсинга данных)
// ============================================================================

test('processParsedData: извлекает теги и очищает HTML', async (t) => {
  const originalFetch = global.fetch;
  // Мокаем переводчик Google (формат ответа client=dict-chrome-ex: [["перевод","ja"]])
  global.fetch = async () => ({
    ok: true,
    json: async () => [['Epic game translated!', 'ja']]
  });

  t.after(() => { global.fetch = originalFetch; });

  const mockGameData = {
    genres: [{ name: 'RPG' }, { name: 'Fantasy' }],
    intro: 'Epic game!',
    maker_name: 'TestDev'
  };

  // 3. Вызываем через объект скрапера и используем правильное имя переменной
  const result = await scraperService.processParsedData(mockGameData, 'RJ123456');

  assert.ok(result, 'Результат не должен быть null');
  assert.deepStrictEqual(result.tags, ['RPG', 'Fantasy'], 'Теги должны совпадать');
  assert.strictEqual(result.description, 'Epic game translated!', 'Описание должно быть переведено');
});

test('processParsedData: если нет полезных данных — возвращает null', async () => {
  // Передаем абсолютно пустые данные, чтобы парсер точно вернул null
  const result = await scraperService.processParsedData({ genres: [], intro_s: '', maker_name: '' }, 'RJ555555');
  assert.strictEqual(result, null, 'При пустых данных функция должна вернуть null');
});

// ============================================================================
// findRJCode tests (Поиск RJ-кода в файлах)
// ============================================================================

const fsp = require('fs').promises;

test('findRJCode: находит RJ внутри текстового файла', async (t) => {
  const originalReaddir = fsp.readdir;
  const originalStat = fsp.stat;
  const originalReadFile = fsp.readFile;

  // Мокаем файловую систему, чтобы тест не лез на жесткий диск
  // Новый findRJCode просит readdir с withFileTypes, поэтому заглушка отдаёт
  // такие же объекты, какие вернула бы настоящая файловая система
  fsp.readdir = async () => [{ name: 'readme.txt', isFile: () => true, isDirectory: () => false }];
  fsp.stat = async () => ({ size: 1024 }); 
  fsp.readFile = async () => 'Welcome to the game! Code: RJ999999.';

  t.after(() => {
    fsp.readdir = originalReaddir;
    fsp.stat = originalStat;
    fsp.readFile = originalReadFile;
  });

  // Вызываем через объект скрапера
  const code = await scraperService.findRJCode('UnknownFolder', '/fake/path');
  assert.strictEqual(code, 'RJ999999', 'Должен найти RJ-код внутри readme.txt');
});

test('findRJCode: чужие коды из титров и карт игры не берёт', async (t) => {
  const originalReaddir = fsp.readdir;
  const originalStat = fsp.stat;
  const originalReadFile = fsp.readFile;

  // readme с титрами (два кода купленных ассетов) и папка data с рекламой в карте
  fsp.readdir = async (dir) => dir.endsWith('data')
    ? [{ name: 'Map044.json', isFile: () => true, isDirectory: () => false }]
    : [
        { name: 'Readme.txt', isFile: () => true, isDirectory: () => false },
        { name: 'data', isFile: () => false, isDirectory: () => true },
      ];
  fsp.stat = async () => ({ size: 1024 });
  fsp.readFile = async (file) => String(file).endsWith('Map044.json')
    ? '《Tail Touch Girl——RJ310249》 Да... это всего лишь реклама.'
    : 'Звуки: RJ01470050\nИнтерфейс: RJ01026120';

  t.after(() => {
    fsp.readdir = originalReaddir;
    fsp.stat = originalStat;
    fsp.readFile = originalReadFile;
  });

  assert.strictEqual(await scraperService.findRJCode('UnknownFolder', '/fake/path'), null);
});

test('titleFromFolder: всё после номера версии — служебный хвост', () => {
  const t = (f) => scraperService.titleFromFolder(f);
  assert.strictEqual(t('Labyrinth_of_Subjugation_and_Liberation_1.4-Naughty_Insomniac'), 'Labyrinth of Subjugation and Liberation');
  assert.strictEqual(t('nightmare-knight-2.01-rus__hchan.live'), 'nightmare knight');
  assert.strictEqual(t('celesphonia-ver-1.07-cn-mod-55.6-fixed2-rus__hchan.live'), 'celesphonia');
  // Число без точки — часть названия, а не версия
  assert.strictEqual(t('Total_NTR_2-v1.0'), 'Total NTR 2');
  assert.strictEqual(t('RJ01364780'), 'RJ01364780');
});

test('buildF95Queries: слово с умлаутом выпадает целиком, а не обрубком', () => {
  const queries = scraperService.buildF95Queries('Nebel Geisterjäger ~ The First Lamb');
  assert.ok(queries.includes('Nebel'), JSON.stringify(queries));
  assert.ok(!queries.some(q => /Geisterj/.test(q)), JSON.stringify(queries));
});

// ============================================================================
// translateText tests (Проверка переводчика)
// ============================================================================

test('translateText: корректно обрабатывает пустой текст', async () => {
  // Вызываем через объект скрапера
  const result = await scraperService.translateText('');
  assert.strictEqual(result, '');
});

test('translateText: возвращает оригинальный текст при ошибке API', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('Network error'); };

  t.after(() => { global.fetch = originalFetch; });

  // Вызываем через объект скрапера
  const result = await scraperService.translateText('Original text');
  assert.strictEqual(result, 'Original text', 'При сбое сети должен вернуться оригинал');
});

// ============================================================================
// Политика поиска метаданных (итог попытки и срок следующей)
// ============================================================================

const plan = require('./src/utils/scrapeplan.js');

test('scrapeplan: итог считается по тому, что у игры осталось после попытки', () => {
    const full = { tags: '["rpg"]', link: 'https://f95zone.to/threads/1/', screens: '["a.jpg"]' };
    assert.strictEqual(plan.statusOfRow(full), 'ok');
    assert.strictEqual(plan.statusOfRow({ ...full, screens: '[]' }), 'partial', 'теги есть, картинок нет');
    // Поиск упал, но теги остались с прошлого раза — игра не становится «не найденной»
    assert.strictEqual(plan.statusOfRow({ ...full, screens: '[]' }, ['f95zone.to']), 'partial');
    assert.strictEqual(plan.statusOfRow({ tags: '[]' }), 'not_found', 'все ответили «нет»');
    assert.strictEqual(plan.statusOfRow({ tags: '[]' }, ['f95zone.to']), 'error', 'кто-то не ответил');
});

test('scrapeplan: паузы растут, а после последней автопоиск останавливается', () => {
    const now = 1_000_000;
    assert.deepStrictEqual(plan.planNext('ok', 3, now), { attempts: 0, retryAt: null }, 'успех обнуляет счётчик');

    let attempts = 0;
    const delays = [];
    for (;;) {
        const next = plan.planNext('not_found', attempts, now);
        attempts = next.attempts;
        if (next.retryAt === null) break;
        delays.push(next.retryAt - now);
    }
    assert.deepStrictEqual(delays, plan.DELAYS.not_found);
    for (let i = 1; i < delays.length; i++) assert.ok(delays[i] > delays[i - 1], 'каждая пауза длиннее предыдущей');

    // Сбой источника — временная беда: первая повторная попытка через час, а не через сутки
    assert.strictEqual(plan.planNext('error', 0, now).retryAt - now, plan.HOUR);
});

test('lookupMetadata: «нигде нет» и «не смогли спросить» — разные итоги', async (t) => {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });

    // Все источники ответили, но пусто
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
    const none = await scraperService.lookupMetadata('Totally Unknown Game', '');
    assert.strictEqual(none.data, null);
    assert.deepStrictEqual(none.failed, [], 'никто не упал — значит честное «не найдено»');

    // Сеть лежит
    global.fetch = async () => { throw new Error('ECONNRESET'); };
    const down = await scraperService.lookupMetadata('Totally Unknown Game', '');
    assert.strictEqual(down.data, null);
    assert.ok(down.failed.length > 0, 'упавшие источники попали в отчёт');
    assert.ok(down.failed.includes('f95zone.to'), `ожидали f95zone.to в ${JSON.stringify(down.failed)}`);

    // Лимит 429 — тоже «не смогли спросить», хотя сеть в порядке
    global.fetch = async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => '' });
    const limited = await scraperService.lookupMetadata('Totally Unknown Game', '');
    assert.ok(limited.failed.length > 0);
});

// ============================================================================
// gamelang: язык по тексту самой игры
// ============================================================================

const os = require('os');
const path = require('path');
const { detectGameLanguages } = require('./src/utils/gamelang.js');

// Настоящая папка игры во временном каталоге: детектор читает файлы сам
async function makeGame(t, files) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rpg-lang-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    await fsp.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fsp.writeFile(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}
const say = (lines) => ({ events: [null, { pages: [{ list: lines.map(s => ({ code: 401, parameters: [s] })) }] }] });

test('gamelang: русский перевод японской игры', async (t) => {
  const phrase = 'Ты правда думаешь, что мы успеем дойти до города до заката? Нам ещё идти через лес.';
  const dir = await makeGame(t, {
    'data/System.json': { locale: 'ja_JP' },
    // Имена карт видит только автор — по ним и узнаём язык оригинала
    'data/MapInfos.json': [null, { name: 'はじまりの村' }, { name: 'まおうのしろ' }],
    'data/Map001.json': say(Array(20).fill(phrase)),
  });
  assert.deepStrictEqual(await detectGameLanguages(dir), { main: 'ru', langs: ['ru'], original: 'ja' });
});

test('gamelang: таблица переводов даёт все языки, коды \\REM_MAP[...] — не текст', async (t) => {
  const ja = 'はぁ……いい天気だな。今日はどこへ行こうか。';
  const en = 'Hah… the weather feels great. Where should we go today, and what do you want to do?';
  const csv = ['Original,jp,en', ...Array(40).fill(`"${ja}","${ja}","${en}"`)].join('\n');
  const dir = await makeGame(t, {
    'data/System.json': { locale: 'en_US' },
    'data/MapInfos.json': [null, { name: 'Town' }],
    // Карты Karryn's Prison: вместо реплик ссылки на файлы перевода
    'data/Map001.json': say(Array(50).fill('\\REM_MAP[map17_ev63_p2_karryn_15]')),
    'game_messages.csv': csv,
  });
  const found = await detectGameLanguages(dir);
  assert.deepStrictEqual([...found.langs].sort(), ['en', 'ja']);
});

// ============================================================================
// Название для показа и версия
// ============================================================================

const { presentTitle, extractVersion } = require('./src/utils/title.js');

test('presentTitle: срезает версии и подписи переводчиков, подзаголовок оставляет', () => {
  const show = (raw, folder = '', link = '') => presentTitle(raw, { folder, link }).title;
  assert.strictEqual(show('Unholy Maiden v1.0.9 | TL: DazedAnon & O&M'), 'Unholy Maiden');
  assert.strictEqual(show("Fallen Priestess: My Sister's Demonic Bloodline 1.3.0 Steam 04/17/2342"), "Fallen Priestess: My Sister's Demonic Bloodline");
  assert.strictEqual(show('Кошмар Рыцаря 2.01 (Перевод:Neriko)'), 'Кошмар Рыцаря');
  assert.strictEqual(show('Labyrinth of Subjugation and Liberation Production Version 1.4'), 'Labyrinth of Subjugation and Liberation');
  assert.strictEqual(show('Freya s Potion Shop ver1.03'), "Freya's Potion Shop");
  assert.strictEqual(show('Tale of Salvation ~Even Fallen, Hero Erica Faces Tomorrow~ 1.04'), 'Tale of Salvation ~Even Fallen, Hero Erica Faces Tomorrow~');
  assert.strictEqual(show('Nebel Geisterjäger ~ The First Lamb Steam EN1.12 | Перевод: Karabas Barabas'), 'Nebel Geisterjäger ~ The First Lamb');
  // Число без точки — часть названия
  assert.strictEqual(show('Total NTR 2'), 'Total NTR 2');
});

test('presentTitle: японское название заменяет английское из папки или ссылки F95', () => {
  const listaria = presentTitle('リスタリア［メッセージ非表示：右クリック | 文章スキップ：Control］', { folder: 'Listaria_v26.08.02' });
  assert.deepStrictEqual(listaria, { title: 'Listaria', original: 'リスタリア' });
  const byLink = presentTitle('催堕的魔法使', { folder: 'RJ01548022', link: 'https://f95zone.to/threads/fallenmage-v1-0-0-other-side-of-the-sky.288905/,https://www.dlsite.com/x' });
  assert.strictEqual(byLink.title, 'Fallenmage');
  // Английского взять неоткуда — остаётся как есть
  assert.strictEqual(presentTitle('フロンティアガーディアン最新', { folder: 'RJ01380813' }).title, 'フロンティアガーディアン最新');
  // Сокращённое имя игры уступает полному из папки
  assert.strictEqual(presentTitle('Dancer 1.2', { folder: 'My_Girlfriend_Advanced_to_the_Dancer_Class_and_She_Buffs_Everybody_v1.2_Windows' }).title,
    'My Girlfriend Advanced to the Dancer Class and She Buffs Everybody');
});

test('extractVersion: из названия, иначе из папки; версия перевода после «|» не считается', () => {
  assert.strictEqual(extractVersion('A Master Exorcist Never Yields to Tentacle Demons_v1.0.4', ''), '1.0.4');
  assert.strictEqual(extractVersion('Star Witch （ver1.19）', ''), '1.19');
  assert.strictEqual(extractVersion('Horny Adventurer Karen', 'RJ405415'), '');
  assert.strictEqual(extractVersion('Going to the caves NTR', 'Going to the caves NTR 2.0.0v'), '2.0.0');
  assert.strictEqual(extractVersion('Зверодевочки никогда не предадут v1', 'fox-girls-never-play-dirty-ver1.03-rus__hchan.live'), '1.03');
  assert.strictEqual(extractVersion('Nebel | Версия перевода: 1.0', ''), '');
});
