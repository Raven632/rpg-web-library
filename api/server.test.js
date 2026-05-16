const test = require('node:test');
const assert = require('node:assert');

// 1. Правильный импорт мидлвары (она обычная функция)
const { requireAuth } = require('./src/routes/auth.js'); 

// 2. Правильный импорт скрапера (это ЭКЗЕМПЛЯР КЛАССА, импортируем целиком)
const scraperService = require('./src/services/scraper.js');

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
  const req = { method: 'POST', cookies: { auth_token: 'WRONG_TOKEN_123' } };
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

test('requireAuth: запрос с правильным токеном пропускается', () => {
  const req = { method: 'POST', cookies: { auth_token: '' } };
  const res = {};
  let nextCalled = false;

  requireAuth(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, true, 'Запрос с валидным токеном должен проходить');
});

// ============================================================================
// processParsedData tests (Проверка парсинга данных)
// ============================================================================

test('processParsedData: извлекает теги и очищает HTML', async (t) => {
  const originalFetch = global.fetch;
  // Мокаем переводчик Google
  global.fetch = async () => ({
    json: async () => [[['Epic game translated!', 'Epic game!', null, null]]]
  });

  t.after(() => { global.fetch = originalFetch; });

  const mockGameData = {
    genres: [],
    intro: '',
    maker_name: ''
  };

  // 3. Вызываем через объект скрапера и используем правильное имя переменной
  const result = await scraperService.processParsedData(mockGameData, 'RJ123456');

  assert.ok(result, 'Результат не должен быть null');
  assert.deepStrictEqual(result.tags, ['RPG', 'Fantasy'], 'Теги должны совпадать');
  assert.strictEqual(result.description, 'Epic game translated!', 'Описание должно быть переведено');
});

test('processParsedData: если genres пустой — возвращает null', async () => {
  // Вызываем через объект скрапера
  const result = await scraperService.processParsedData({ genres: [], intro_s: 'Empty genres' }, 'RJ555555');
  assert.strictEqual(result, null, 'При пустом genres функция должна вернуть null');
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
  fsp.readdir = async () => ['readme.txt'];
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