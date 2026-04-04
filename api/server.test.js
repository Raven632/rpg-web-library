const test = require('node:test');
const assert = require('node:assert');

const {
  processParsedData,
  requireAuth,
  findRJCode
} = require('./server.js');

// ---------------------------
// requireAuth tests
// ---------------------------

test('requireAuth: GET без токена пропускается', () => {
  const req = { method: 'GET', headers: {} };
  const res = {};
  let nextCalled = false;

  requireAuth(req, res, () => {
    nextCalled = true;
  });

  assert.strictEqual(nextCalled, true, 'GET должен проходить без токена');
});

test('requireAuth: POST с валидным токеном пропускается', () => {
  const validToken = process.env.API_TOKEN || 'SuperSecretKey123';
  const req = { method: 'POST', headers: { 'x-api-token': validToken } };
  const res = {};
  let nextCalled = false;

  requireAuth(req, res, () => {
    nextCalled = true;
  });

  assert.strictEqual(nextCalled, true, 'POST с валидным токеном должен проходить');
});

test('requireAuth: POST без токена возвращает 401', () => {
  const req = { method: 'POST', headers: {} };
  let statusCode;
  let payload;
  let nextCalled = false;

  const res = {
    status(code) {
      statusCode = code;
      return {
        json(body) {
          payload = body;
        }
      };
    }
  };

  requireAuth(req, res, () => {
    nextCalled = true;
  });

  assert.strictEqual(nextCalled, false, 'next() не должен вызываться при 401');
  assert.strictEqual(statusCode, 401, 'Ожидается HTTP 401');
  assert.ok(payload && payload.error, 'Должен быть текст ошибки');
});

test('requireAuth: POST с неверным токеном возвращает 401', () => {
  const req = { method: 'POST', headers: { 'x-api-token': 'WRONG_TOKEN' } };
  let statusCode;
  let payload;
  let nextCalled = false;

  const res = {
    status(code) {
      statusCode = code;
      return {
        json(body) {
          payload = body;
        }
      };
    }
  };

  requireAuth(req, res, () => {
    nextCalled = true;
  });

  assert.strictEqual(nextCalled, false, 'next() не должен вызываться при неверном токене');
  assert.strictEqual(statusCode, 401, 'Ожидается HTTP 401');
  assert.ok(payload && payload.error, 'Должен быть текст ошибки');
});

// ---------------------------
// processParsedData tests
// ---------------------------

test('processParsedData: извлекает теги и очищает HTML', async (t) => {
  const originalFetch = global.fetch;
  // Мокаем переводчик: возвращаем "перевод"
  global.fetch = async () => ({
    json: async () => [[['Epic game translated!', 'Epic game!', null, null]]]
  });

  t.after(() => {
    global.fetch = originalFetch;
  });

  const mockGameData = {
    genres: [{ name: 'RPG' }, { name: 'Fantasy' }],
    intro_s: '<p>Epic <b>game</b>!</p>'
  };

  const result = await processParsedData(mockGameData, 'RJ111111');

  assert.ok(result, 'Результат не должен быть null');
  assert.deepStrictEqual(result.tags, ['RPG', 'Fantasy'], 'Теги должны совпадать');
  assert.ok(result.description.length > 0, 'Описание не должно быть пустым');
});

test('processParsedData: удаляет дубли тегов', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    json: async () => [[['Some text', 'Some text', null, null]]]
  });

  t.after(() => {
    global.fetch = originalFetch;
  });

  const mockGameData = {
    genres: [{ name: 'RPG' }, { name: 'RPG' }, { name: 'Fantasy' }],
    intro_s: '<div>Hello</div>'
  };

  const result = await processParsedData(mockGameData, 'RJ222222');

  assert.ok(result, 'Результат не должен быть null');
  assert.deepStrictEqual(result.tags, ['RPG', 'Fantasy'], 'Дубликаты должны быть удалены');
});

test('processParsedData: использует intro, если intro_s отсутствует', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    json: async () => [[['Fallback intro translated', 'Fallback intro', null, null]]]
  });

  t.after(() => {
    global.fetch = originalFetch;
  });

  const mockGameData = {
    genres: [{ name: 'Adventure' }],
    intro: '<p>Fallback intro</p>'
  };

  const result = await processParsedData(mockGameData, 'RJ333333');

  assert.ok(result, 'Результат не должен быть null');
  assert.deepStrictEqual(result.tags, ['Adventure']);
  assert.ok(result.description.length > 0, 'Описание должно быть заполнено');
});

test('processParsedData: если genres отсутствует — возвращает null', async () => {
  const result = await processParsedData({ intro_s: 'No genres here' }, 'RJ444444');
  assert.strictEqual(result, null, 'Без genres функция должна вернуть null');
});

test('processParsedData: если genres пустой — возвращает null', async () => {
  const result = await processParsedData({ genres: [], intro_s: 'Empty genres' }, 'RJ555555');
  assert.strictEqual(result, null, 'При пустом genres функция должна вернуть null');
});

// ---------------------------
// findRJCode tests
// ---------------------------

const fsp = require('fs').promises;

test('findRJCode: находит RJ внутри текстового файла, если его нет в имени папки', async (t) => {
  // Запоминаем оригинальные функции
  const originalReaddir = fsp.readdir;
  const originalStat = fsp.stat;
  const originalReadFile = fsp.readFile;

  // Мокаем файловую систему
  fsp.readdir = async () => ['readme.txt', 'image.png'];
  fsp.stat = async () => ({ size: 1024 }); // Файл меньше 500kb
  fsp.readFile = async (filePath) => {
    if (filePath.endsWith('readme.txt')) {
      return 'Hello, this is a great game! Code: RJ999999.';
    }
    return '';
  };

  // Убираем моки после теста
  t.after(() => {
    fsp.readdir = originalReaddir;
    fsp.stat = originalStat;
    fsp.readFile = originalReadFile;
  });

  const code = await findRJCode('UnknownGameFolder', '/fake/path');
  assert.strictEqual(code, 'RJ999999', 'Должен найти RJ-код внутри readme.txt');
});

test('findRJCode: возвращает null, если RJ нигде не найден', async () => {
  // Путь не существует => внутри try/catch будет ошибка readdir, ожидаем null
  const code = await findRJCode('NoCodeGame', '/tmp/definitely-not-existing-folder');
  assert.strictEqual(code, null);
});