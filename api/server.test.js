const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const {
    requireAuth,
    findGameFolder,
    findRJCode,
    processParsedData
} = require('./server');

test('requireAuth allows all GET requests without token', () => {
    let called = false;
    const req = { method: 'GET', headers: {} };
    const res = {
        status() { throw new Error('status should not be called'); },
        json() { throw new Error('json should not be called'); }
    };
    const next = () => { called = true; };
    requireAuth(req, res, next);
    assert.equal(called, true);
});

test('requireAuth rejects non-GET with invalid token', () => {
    const req = { method: 'POST', headers: { 'x-api-token': 'invalid' } };
    const state = { statusCode: 200, body: null };
    const res = {
        status(code) { state.statusCode = code; return this; },
        json(payload) { state.body = payload; return this; }
    };
    const next = () => { throw new Error('next should not be called'); };
    requireAuth(req, res, next);
    assert.equal(state.statusCode, 401);
    assert.deepEqual(state.body, { error: 'Отказано в доступе. Неверный токен.' });
});

test('requireAuth allows non-GET with correct token', () => {
    process.env.API_TOKEN = 'abc-token';
    delete require.cache[require.resolve('./server')];
    const { requireAuth: freshRequireAuth } = require('./server');
    let called = false;
    const req = { method: 'POST', headers: { 'x-api-token': 'abc-token' } };
    const res = {
        status() { throw new Error('status should not be called'); },
        json() { throw new Error('json should not be called'); }
    };
    const next = () => { called = true; };
    freshRequireAuth(req, res, next);
    assert.equal(called, true);
});

test('findGameFolder finds direct www folder', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'rpg-tests-'));
    try {
        await fsp.mkdir(path.join(root, 'www'));
        const result = await findGameFolder(root);
        assert.equal(result, path.join(root, 'www'));
    } finally {
        await fsp.rm(root, { recursive: true, force: true });
    }
});

test('findGameFolder falls back to directory with index.html', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'rpg-tests-'));
    try {
        await fsp.writeFile(path.join(root, 'index.html'), '<html></html>');
        const result = await findGameFolder(root);
        assert.equal(result, root);
    } finally {
        await fsp.rm(root, { recursive: true, force: true });
    }
});

test('findGameFolder finds nested game folder recursively', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'rpg-tests-'));
    try {
        const deep = path.join(root, 'a', 'b', 'c');
        await fsp.mkdir(path.join(deep, 'www'), { recursive: true });
        const result = await findGameFolder(root);
        assert.equal(result, path.join(deep, 'www'));
    } finally {
        await fsp.rm(root, { recursive: true, force: true });
    }
});

test('findRJCode extracts from folder name', async () => {
    const result = await findRJCode('Some-Game-rj123456', '/not-used');
    assert.equal(result, 'RJ123456');
});

test('findRJCode extracts from text file content', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'rpg-tests-'));
    try {
        await fsp.writeFile(path.join(root, 'readme.txt'), 'hello RJ7654321 world');
        const result = await findRJCode('NoCodeHere', root);
        assert.equal(result, 'RJ7654321');
    } finally {
        await fsp.rm(root, { recursive: true, force: true });
    }
});

test('findRJCode skips large files and returns null when no code', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'rpg-tests-'));
    try {
        const largePath = path.join(root, 'big.txt');
        await fsp.writeFile(largePath, 'A'.repeat(600000));
        const result = await findRJCode('NoCodeHere', root);
        assert.equal(result, null);
    } finally {
        await fsp.rm(root, { recursive: true, force: true });
    }
});

test('processParsedData normalizes tags, strips html and translates description', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
        json: async () => [[['Translated description']]]
    });
    try {
        const out = await processParsedData(
            {
                genres: [{ name: 'RPG' }, { name: 'RPG' }, { name: 'Fantasy' }],
                intro_s: '<p>Hello <b>world</b></p>'
            },
            'RJ111111'
        );
        assert.deepEqual(out.tags, ['RPG', 'Fantasy']);
        assert.equal(out.description, 'Translated description');
    } finally {
        global.fetch = originalFetch;
    }
});

test('processParsedData returns null when no tags', async () => {
    const out = await processParsedData({ genres: [], intro_s: 'x' }, 'RJ222222');
    assert.equal(out, null);
});
