const express = require('express');
const fsp = require('fs').promises;
const path = require('path');
const dbService = require('../db/database.js');
const scraperService = require('../services/scraper.js');
const { GAMES_DIR } = require('../config/index.js');
const { upload, uploadLimiter } = require('../utils/upload.js');
const { spawnExtract, findGameFolder } = require('../utils/archive.js');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const rows = await dbService.get().all('SELECT * FROM games WHERE ready = 1');
        const games = rows.map(row => ({
            id: row.id, title: row.title, cover: row.cover,
            tags: row.tags ? JSON.parse(row.tags) : [],
            description: row.description, url: `/${row.id}/`, number: 0,
            addedAt: row.addedAt, lastPlayed: row.lastPlayed, rating: row.rating
        })).sort((a, b) => a.addedAt - b.addedAt);
        games.forEach((g, i) => g.number = i + 1);
        res.json(games);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

router.post('/:id/edit', async (req, res) => {
    const folder = path.basename(req.params.id);
    const { title, rjCode } = req.body;
    const gamePath = path.join(GAMES_DIR, folder);

    try {
        let scrapeWarning = null;
        if (title) await dbService.get().run('UPDATE games SET title = ? WHERE id = ?', [title, folder]);

        const gameObj = await dbService.get().get('SELECT title FROM games WHERE id = ?', [folder]);
        const searchTitle = title || gameObj.title; 
        const searchRj = (rjCode && rjCode.match(/RJ\d+/i)) ? rjCode.match(/RJ\d+/i)[0].toUpperCase() : null;
        let coverUpdated = false;

        if (searchRj && await scraperService.fetchDLsiteCover(searchRj, path.join(gamePath, 'cover.jpg'))) {
            await dbService.get().run('UPDATE games SET cover = ? WHERE id = ?', [`${folder}/cover.jpg`, folder]);
            coverUpdated = true;
        }

        const scrapedData = await scraperService.fetchUniversalMetadata(searchTitle, searchRj);
        if (scrapedData) {
            if (scrapedData.coverUrl && !coverUpdated && await scraperService.downloadRemoteCover(scrapedData.coverUrl, path.join(gamePath, 'cover.jpg'))) {
                await dbService.get().run('UPDATE games SET cover = ? WHERE id = ?', [`${folder}/cover.jpg`, folder]);
                coverUpdated = true;
            }
            if (scrapedData.tags?.length > 0) {
                await dbService.get().run('UPDATE games SET tags = ?, description = ?, scraped = 1 WHERE id = ?', [JSON.stringify(scrapedData.tags), scrapedData.description, folder]);
            } else if (coverUpdated) {
                scrapeWarning = 'Обложка обновлена, но теги не найдены.';
            }
        } else if (searchRj || title) {
            scrapeWarning = 'Данные не найдены (DLsite/VNDB/Steam).';
        }

        const updatedGame = await dbService.get().get('SELECT * FROM games WHERE id = ?', [folder]);
        res.json({
            success: true, warning: scrapeWarning, title: updatedGame.title, cover: updatedGame.cover,
            tags: updatedGame.tags ? JSON.parse(updatedGame.tags) : [], description: updatedGame.description
        });
    } catch (e) { res.status(500).json({ error: 'Сбой сервера при обновлении' }); }
});

router.post('/:id/meta', async (req, res) => {
    const folder = path.basename(req.params.id);
    const { rating, lastPlayed } = req.body;

    try {
        const game = await dbService.get().get('SELECT id FROM games WHERE id = ?', [folder]);
        if (!game) return res.status(404).json({ error: 'Игра не найдена' });

        const updates = [], params = [];
        if (rating !== undefined) { updates.push('rating = ?'); params.push(rating); }
        if (lastPlayed !== undefined) { updates.push('lastPlayed = ?'); params.push(lastPlayed); }

        if (updates.length > 0) {
            params.push(folder);
            await dbService.get().run(`UPDATE games SET ${updates.join(', ')} WHERE id = ?`, params);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Ошибка сохранения метаданных' }); }
});

router.delete('/:id', async (req, res) => {
    const id = path.basename(req.params.id);
    const gamePath = path.join(GAMES_DIR, id);
    
    try {
        await fsp.access(gamePath);
        await fsp.rm(gamePath, { recursive: true, force: true });
        await dbService.get().run('DELETE FROM games WHERE id = ?', [id]);
        res.json({ success: true });
    } catch(e) { 
        res.status(404).json({ error: 'Игра не найдена' }); 
    }
});

// Экспорт роутера и отдельной функции для использования WebSockets
module.exports = function(io, addGameToDB, EXTRACT_TMP) {
    
    // Этот роут требует io и addGameToDB из server.js, поэтому передаем их
    router.post('/upload', uploadLimiter, upload.single('game'), async (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'Файл не получен' });

        const archivePath = req.file.path;
        let originalName = req.file.originalname.replace(/\.(zip|7z|rar)$/i, '').replace(/[^\w\s\-\.а-яА-Я\[\]]/g, '_').trim() || 'game_archive';
        
        if (['_saves', '_tmp_uploads', 'api', 'socket.io', 'public', 'node_modules', '.audio-cache'].includes(originalName.toLowerCase())) {
            originalName = 'game_' + Date.now();
        }    

        const tmpExtractDir = path.join(EXTRACT_TMP, 'ext_' + Date.now());

       try {
            await fsp.mkdir(tmpExtractDir, { recursive: true });
            io.emit('upload-status', { message: '🛡️ Проверка безопасности архива...' });

            const { stdout } = await require('util').promisify(require('child_process').execFile)('7zz', ['l', '-ba', '-slt', archivePath], { maxBuffer: 200 * 1024 * 1024 });
            const lines = stdout.split('\n').filter(l => l.startsWith('Path = '));
            const baseTarget = path.resolve(tmpExtractDir) + path.sep;

            for (const line of lines) {
                const internalPath = line.replace('Path = ', '').trim();
                if (!path.resolve(tmpExtractDir, internalPath).startsWith(baseTarget)) throw new Error(`Опасный путь (Zip Slip): ${internalPath}`);
            }

            io.emit('upload-status', { message: '🗜️ Распаковка архива...' });
            await spawnExtract('7zz', ['x', archivePath, `-o${tmpExtractDir}`, '-y']);

            io.emit('upload-status', { message: '🔍 Поиск файлов игры...' });
            
            const sourceDir = await findGameFolder(tmpExtractDir);            
            if (!sourceDir) throw new Error("Не найдена папка 'www' или 'index.html'");
            
            let finalDestFolder = originalName;
            let counter = 1;
            while (require('fs').existsSync(path.join(GAMES_DIR, finalDestFolder))) finalDestFolder = `${originalName}_${counter++}`;
            const finalPath = path.join(GAMES_DIR, finalDestFolder);

            io.emit('upload-status', { message: '📦 Сохранение в библиотеку...' });
            await require('util').promisify(require('child_process').execFile)('mv', [sourceDir, finalPath]);

            await fsp.rm(tmpExtractDir, { recursive: true, force: true }).catch(() => {});
            await fsp.unlink(archivePath).catch(() => {});

            await addGameToDB(finalDestFolder, finalPath);

            io.emit('upload-status', { message: '✨ Готово!' });
            res.json({ success: true, folder: finalDestFolder, message: `Игра добавлена!` });
        } catch (e) {
            await fsp.rm(tmpExtractDir, { recursive: true, force: true }).catch(() => {});
            await fsp.unlink(archivePath).catch(() => {});
            io.emit('upload-status', { message: '❌ Ошибка: ' + e.message });
            res.status(500).json({ error: 'Сбой: ' + e.message });
        }
    });

    return router;
};