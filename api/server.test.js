const test = require('node:test');
const assert = require('node:assert');
const { processParsedData, requireAuth } = require('./server.js');

test('Авторизация (requireAuth): пропускает валидный токен', (t) => {
    // Имитируем запрос с правильным токеном
    const req = { method: 'POST', headers: { 'x-api-token': process.env.API_TOKEN || 'SuperSecretKey123' } };
    const res = {};
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    requireAuth(req, res, next);
    assert.strictEqual(nextCalled, true, 'Функция next() должна быть вызвана');
});

test('Парсинг DLsite (processParsedData): правильно извлекает теги', async (t) => {
    // Имитируем ответ от DLsite
    const mockGameData = {
        genres: [{ name: 'RPG' }, { name: 'Fantasy' }],
        intro_s: '<p>Epic game!</p>'
    };

    const result = await processParsedData(mockGameData, 'RJ111111');
    
    assert.deepStrictEqual(result.tags, ['RPG', 'Fantasy'], 'Теги должны совпадать');
    // В реальности переводчик переведет "Epic game!", но для базы проверим наличие текста
    assert.ok(result.description.length > 0, 'Описание не должно быть пустым');
});