const express = require('express');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);
const { SAVES_DIR } = require('../config/index.js');
const { spawnExtract } = require('../utils/archive.js');
const { upload, uploadLimiter } = require('../utils/upload.js');
const { requireAuth } = require('./auth.js'); 

module.exports = function(EXTRACT_TMP) {
    const router = express.Router();

    router.use(requireAuth);

    // --- 1. АРХИВЫ (Должны быть вверху) ---
    router.get('/export/:id', async (req, res) => {
        const gameId = path.basename(req.params.id);
        const gameSavesDir = path.join(SAVES_DIR, gameId);

        try {
            const files = await fsp.readdir(gameSavesDir);
            if (files.filter(f => f.endsWith('.json')).length === 0) throw new Error();
            
            const tmpZip = path.join(EXTRACT_TMP, `saves_${gameId}_${crypto.randomBytes(4).toString('hex')}.zip`);
            await execFilePromise('7zz', ['a', '-tzip', tmpZip, path.join(gameSavesDir, '*.json')]);
            
            res.download(tmpZip, `${gameId}_saves.zip`, () => fsp.unlink(tmpZip).catch(() => {}));
        } catch (e) { res.status(404).json({ error: 'У этой игры еще нет сохранений' }); }
    });

    router.post('/import/:id', uploadLimiter, upload.single('saves'), async (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
        
        // ВОЗВРАЩЕНА ПРОВЕРКА: Лимит 50MB
        if (req.file.size > 50 * 1024 * 1024) {
            await fsp.unlink(req.file.path).catch(() => {});
            return res.status(400).json({ error: 'Архив слишком большой' });
        }

        const gameSavesDir = path.join(SAVES_DIR, path.basename(req.params.id));
        const archivePath = req.file.path;

        try {
            await fsp.mkdir(gameSavesDir, { recursive: true });
            
            // ВОЗВРАЩЕНА ПРОВЕРКА: Zip Slip защита
            const { stdout } = await execFilePromise('7zz', ['l', '-ba', '-slt', archivePath], { maxBuffer: 50 * 1024 * 1024 });
            const baseTarget = path.resolve(gameSavesDir) + path.sep;
            for (const line of stdout.split('\n').filter(l => l.startsWith('Path = '))) {
                const internalPath = line.replace('Path = ', '').trim();
                if (!path.resolve(gameSavesDir, internalPath).startsWith(baseTarget)) throw new Error('Zip Slip Attack!');
            }
            
            await spawnExtract('7zz', ['e', archivePath, `-o${gameSavesDir}`, '-y']);
            await fsp.unlink(archivePath).catch(() => {});
            
            const now = new Date();
            for (const file of await fsp.readdir(gameSavesDir)) {
                const filePath = path.join(gameSavesDir, file);
                
                // ВОЗВРАЩЕНА ПРОВЕРКА: Удаление левых папок из архива
                if ((await fsp.stat(filePath)).isDirectory()) {
                    await fsp.rm(filePath, { recursive: true, force: true }).catch(() => {});
                    continue;
                }

                // ВОЗВРАЩЕНА ПРОВЕРКА: Обновление меток времени
                if (file.toLowerCase().endsWith('.rpgsave')) {
                    const newPath = path.join(gameSavesDir, file.replace(/\.rpgsave$/i, '.json'));
                    await fsp.rename(filePath, newPath);
                    await fsp.utimes(newPath, now, now).catch(() => {});
                } else if (file.toLowerCase().endsWith('.json')) {
                    await fsp.utimes(filePath, now, now).catch(() => {});
                } else {
                    await fsp.unlink(filePath).catch(() => {});
                }
            }
            res.json({ success: true, message: 'Сохранения загружены!' });
        } catch (e) {
            await fsp.unlink(archivePath).catch(() => {});
            res.status(500).json({ error: 'Ошибка импорта' });
        }
    });

    // --- 2. ОДИНОЧНЫЕ ФАЙЛЫ ДВИЖКА (Внизу) ---
    router.get('/:gameId', async (req, res) => {
        const gameSavesDir = path.join(SAVES_DIR, path.basename(req.params.gameId));
        try {
            const files = await fsp.readdir(gameSavesDir);
            const saves = {};
            for (const file of files.filter(f => f.endsWith('.json'))) {
                const filePath = path.join(gameSavesDir, file);
                const stats = await fsp.stat(filePath);
                saves[decodeURIComponent(file.replace('.json', ''))] = {
                    value: await fsp.readFile(filePath, 'utf8'), updatedAt: stats.mtimeMs 
                };
            }
            res.json(saves);
        } catch(e) { res.json({}); }
    });

    router.post('/:gameId/:key', async (req, res) => {
        if (typeof req.body.value !== 'string') return res.status(400).json({ error: 'Bad data' });
        try {
            const dir = path.join(SAVES_DIR, path.basename(req.params.gameId));
            await fsp.mkdir(dir, { recursive: true });
            await fsp.writeFile(path.join(dir, encodeURIComponent(path.basename(req.params.key)) + '.json'), req.body.value, 'utf8');
            res.json({ success: true });
        } catch(e) { res.status(500).json({ error: 'Server error' }); }
    });

    // ВОЗВРАЩЕНА ФУНКЦИЯ: Удаление сейвов!
    router.delete('/:gameId/:key', async (req, res) => {
        try { await fsp.unlink(path.join(SAVES_DIR, path.basename(req.params.gameId), encodeURIComponent(path.basename(req.params.key)) + '.json')); } catch(e) {}
        res.json({ success: true });
    });

    return router;
};