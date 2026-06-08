const express = require('express');
const fsp = require('fs').promises;
const path = require('path');
const dbService = require('../db/database.js');
const scraperService = require('../services/scraper.js');
const { GAMES_DIR } = require('../config/index.js');
const { upload, uploadLimiter, coverUpload } = require('../utils/upload.js');
const { spawnExtract, findGameFolder, getFolderSize } = require('../utils/archive.js');
const { createClient } = require('redis');

// Подключение к Redis
const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' });
redisClient.connect().catch(console.error);

const router = express.Router();

let isCalculatingSizes = false; // Глобальный замок

// --- 1. ПОЛУЧЕНИЕ ВСЕХ ИГР (С КЭШИРОВАНИЕМ REDIS) ---
router.get('/', async (req, res) => {
    try {
        // [REDIS] 1. Проверяем кэш. Если есть — отдаем мгновенно!
        const cachedGames = await redisClient.get('api:games:list');
        if (cachedGames) {
            return res.json(JSON.parse(cachedGames));
        }

        const rows = await dbService.get().all('SELECT * FROM games WHERE ready = 1');

        // =========================================================
        // БЕЗОПАСНОЕ ФОНОВОЕ ВЗВЕШИВАНИЕ (С ЗАЩИТОЙ ОТ ГОНКИ)
        // =========================================================
        const gamesWithoutSize = rows.filter(r => !r.size || r.size === 0);
        if (gamesWithoutSize.length > 0 && !isCalculatingSizes) {
            isCalculatingSizes = true; 
            
            setTimeout(async () => {
                try {
                    let sizeUpdated = false;
                    for (const g of gamesWithoutSize) {
                        const gamePath = path.join(GAMES_DIR, g.id);
                        const s = await getFolderSize(gamePath);
                        if (s > 0) {
                            await dbService.get().run('UPDATE games SET size = ? WHERE id = ?', [s, g.id]);
                            sizeUpdated = true;
                        }
                    }
                    // [REDIS] Сбрасываем кэш, если размеры обновились, чтобы UI увидел изменения
                    if (sizeUpdated) await redisClient.del('api:games:list');
                } catch (e) {
                    console.error('[Background] Ошибка взвешивания:', e);
                } finally {
                    isCalculatingSizes = false; 
                }
            }, 1000); 
        }
        // =========================================================

        const games = rows.map(row => ({
            id: row.id, 
            title: row.title, 
            cover: row.cover,
            developer: row.developer || '',
            language: row.language || '',
            releaseDate: row.releaseDate || '',
            link: row.link || '',
            size: row.size || 0,
            version: row.version || '1.0.0',
            tags: row.tags ? JSON.parse(row.tags) : [],
            description: row.description, 
            url: `/${row.id}/`, 
            number: 0,
            addedAt: row.addedAt, 
            lastPlayed: row.lastPlayed, 
            rating: row.rating
        })).sort((a, b) => b.addedAt - a.addedAt); 
        games.forEach((g, i) => g.number = i + 1);

        // [REDIS] 2. Сохраняем собранный список в кэш на 5 минут (300 секунд)
        await redisClient.set('api:games:list', JSON.stringify(games), { EX: 300 });

        res.json(games);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

// --- 2. РОУТ ДЛЯ ЗАГРУЗКИ КАСТОМНОЙ ОБЛОЖКИ ---
router.post('/:id/cover', coverUpload.single('cover'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл обложки не получен' });
    const gameId = path.basename(req.params.id);
    try {
        const game = await dbService.get().get('SELECT cover FROM games WHERE id = ?', [gameId]);
        if (!game) {
            await fsp.unlink(req.file.path).catch(()=>{});
            return res.status(404).json({ error: 'Игра не найдена' });
        }
        if (game.cover && game.cover.includes('cover_custom')) {
            const oldCoverPath = path.join(GAMES_DIR, game.cover);
            await fsp.unlink(oldCoverPath).catch(() => {});
        }
        const ext = path.extname(req.file.originalname) || '.jpg';
        const coverName = `cover_custom_${Date.now()}${ext}`;
        const finalCoverPath = path.join(GAMES_DIR, gameId, coverName);
        const dbCoverPath = `${gameId}/${coverName}`;

        await fsp.rename(req.file.path, finalCoverPath);
        await dbService.get().run('UPDATE games SET cover = ? WHERE id = ?', [dbCoverPath, gameId]);
        
        // [REDIS] Сбрасываем кэш, так как обложка изменилась
        await redisClient.del('api:games:list');
        
        res.json({ success: true, coverPath: dbCoverPath });
    } catch (e) {
        await fsp.unlink(req.file.path).catch(()=>{});
        res.status(500).json({ error: 'Ошибка при смене обложки' });
    }
});

// --- 3. РОУТ ДЛЯ СБРОСА ОБЛОЖКИ (ВОЗВРАТ К ОРИГИНАЛУ) ---
router.delete('/:id/cover', async (req, res) => {
    const gameId = path.basename(req.params.id);
    try {
        const game = await dbService.get().get('SELECT cover FROM games WHERE id = ?', [gameId]);
        if (!game) return res.status(404).json({ error: 'Игра не найдена' });

        if (game.cover && game.cover.includes('cover_custom')) {
            const oldCoverPath = path.join(GAMES_DIR, game.cover);
            await fsp.unlink(oldCoverPath).catch(() => {});
        }
        const originalCoverPath = path.join(GAMES_DIR, gameId, 'cover.jpg');
        let newDbCover = '';
        try {
            await fsp.access(originalCoverPath);
            newDbCover = `${gameId}/cover.jpg`; 
        } catch (e) {
            newDbCover = ''; 
        }
        await dbService.get().run('UPDATE games SET cover = ? WHERE id = ?', [newDbCover, gameId]);
        
        // [REDIS] Сбрасываем кэш
        await redisClient.del('api:games:list');
        
        res.json({ success: true, coverPath: newDbCover });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка при сбросе обложки' });
    }
});

// --- 4. РЕДАКТИРОВАНИЕ МЕТАДАННЫХ ---
router.post('/:id/edit', async (req, res) => {
    const folder = path.basename(req.params.id);
    const { title, rjCode, developer, language, releaseDate, link } = req.body;
    const gamePath = path.join(GAMES_DIR, folder);

    try {
        let scrapeWarning = null;
        
        await dbService.get().run(
            `UPDATE games SET title = ?, developer = ?, language = ?, releaseDate = ?, link = ? WHERE id = ?`,
            [title || '', developer || '', language || '', releaseDate || '', link || '', folder]
        );

        const rawQuery = rjCode || link; 
        const actualRjCode = (rawQuery && rawQuery.match(/RJ\d{6,8}/i)) ? rawQuery.match(/RJ\d{6,8}/i)[0].toUpperCase() : null;
        let coverUpdated = false;

        if (actualRjCode && await scraperService.fetchDLsiteCover(actualRjCode, path.join(gamePath, 'cover.jpg'))) {
            await dbService.get().run('UPDATE games SET cover = ? WHERE id = ?', [`${folder}/cover.jpg`, folder]);
            coverUpdated = true;
        }

        const scrapedData = await scraperService.fetchUniversalMetadata(title, rawQuery);
        
        if (scrapedData) {
            if (scrapedData.coverUrl && !coverUpdated && await scraperService.downloadRemoteCover(scrapedData.coverUrl, path.join(gamePath, 'cover.jpg'))) {
                await dbService.get().run('UPDATE games SET cover = ? WHERE id = ?', [`${folder}/cover.jpg`, folder]);
                coverUpdated = true;
            }
            
            const t_tags = scrapedData.tags?.length > 0 ? JSON.stringify(scrapedData.tags) : '[]';
            const t_desc = scrapedData.description || '';
            const t_dev = scrapedData.developer || developer || '';
            const t_lang = scrapedData.language || language || '';
            const t_rel = scrapedData.releaseDate || releaseDate || '';
            const t_link = scrapedData.link || link || '';

            await dbService.get().run(
                `UPDATE games SET tags = ?, description = ?, developer = ?, language = ?, releaseDate = ?, link = ?, scraped = 1 WHERE id = ?`,
                [t_tags, t_desc, t_dev, t_lang, t_rel, t_link, folder]
            );
            
            if (!scrapedData.tags?.length && coverUpdated) {
                scrapeWarning = 'Обложка обновлена, но теги не найдены.';
            }
        } else {
            await dbService.get().run(
                `UPDATE games SET tags = '[]', description = '', scraped = 0 WHERE id = ?`,
                [folder]
            );
            if (rawQuery) {
                scrapeWarning = 'Данные на внешних сервисах не найдены. Старые метаданные очищены.';
            }
        }

        // [REDIS] Сбрасываем кэш, так как метаданные игры изменились
        await redisClient.del('api:games:list');

        const updatedGame = await dbService.get().get('SELECT * FROM games WHERE id = ?', [folder]);
        res.json({
            success: true, 
            warning: scrapeWarning, 
            game: {
                title: updatedGame.title, 
                cover: updatedGame.cover,
                developer: updatedGame.developer,
                language: updatedGame.language,
                releaseDate: updatedGame.releaseDate,
                link: updatedGame.link,
                tags: updatedGame.tags ? JSON.parse(updatedGame.tags) : [], 
                description: updatedGame.description
            }
        });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: 'Сбой сервера при обновлении' }); 
    }
});

// --- 5. СОХРАНЕНИЕ РЕЙТИНГА И ВРЕМЕНИ ИГРЫ ---
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
            
            // [REDIS] Сбрасываем кэш, так как рейтинг или время игры обновились
            await redisClient.del('api:games:list');
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Ошибка сохранения метаданных' }); }
});

// --- 6. УДАЛЕНИЕ ИГРЫ ---
router.delete('/:id', async (req, res) => {
    const id = path.basename(req.params.id);
    const gamePath = path.join(GAMES_DIR, id);
    
    try {
        await fsp.access(gamePath);
        await fsp.rm(gamePath, { recursive: true, force: true });
        await dbService.get().run('DELETE FROM games WHERE id = ?', [id]);
        
        // [REDIS] Сбрасываем кэш после удаления
        await redisClient.del('api:games:list');
        
        res.json({ success: true });
    } catch(e) { 
        res.status(404).json({ error: 'Игра не найдена' }); 
    }
});

// --- 7. ЧАНКОВАЯ ЗАГРУЗКА АРХИВОВ ---
module.exports = function(io, addGameToDB, EXTRACT_TMP) {
    router.post('/upload-chunk', uploadLimiter, upload.single('chunk'), async (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'Чанк не получен' });

        const { uploadId, chunkIndex, totalChunks, originalName } = req.body;
        const chunkPath = req.file.path;
        
        const safeUploadId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
        const finalArchivePath = path.join(EXTRACT_TMP, `${safeUploadId}.archive`);

        try {
            const partFile = path.join(EXTRACT_TMP, `${safeUploadId}_${chunkIndex}.part`);
            await fsp.rename(chunkPath, partFile);

            if (parseInt(chunkIndex) < parseInt(totalChunks) - 1) {
                return res.json({ success: true, finished: false });
            }

            for (let i = 0; i < parseInt(totalChunks); i++) {
                const p = path.join(EXTRACT_TMP, `${safeUploadId}_${i}.part`);
                const partData = await fsp.readFile(p);
                await fsp.appendFile(finalArchivePath, partData);
                await fsp.unlink(p).catch(() => {});
            }

            let baseName = originalName.replace(/\.(zip|7z|rar)$/i, '').replace(/[^\w\s\-\.а-яА-Я\[\]]/g, '_').trim() || 'game_archive';
            if (['_saves', '_tmp_uploads', 'api', 'socket.io', 'public', 'node_modules', '.audio-cache'].includes(baseName.toLowerCase())) {
                baseName = 'game_' + Date.now();
            }    

            const tmpExtractDir = path.join(EXTRACT_TMP, 'ext_' + Date.now());

            try {
                await fsp.mkdir(tmpExtractDir, { recursive: true });
                io.emit('upload-status', { message: '🛡️ Проверка безопасности архива...' });

                // Улучшенная защита от Zip Slip
                const { stdout } = await require('util').promisify(require('child_process').execFile)('7zz', ['l', '-ba', finalArchivePath], { maxBuffer: 50 * 1024 * 1024 });
                if (stdout.includes('../') || stdout.includes('..\\')) {
                    throw new Error('Обнаружен опасный путь (Zip Slip Attack!)');
                }

                io.emit('upload-status', { message: '🗜️ Распаковка архива...' });
                await spawnExtract('7zz', ['x', finalArchivePath, `-o${tmpExtractDir}`, '-y']);

                io.emit('upload-status', { message: '🔍 Поиск файлов игры...' });
                const sourceDir = await findGameFolder(tmpExtractDir);            
                if (!sourceDir) throw new Error("Не найдена папка 'www' или 'index.html'");
                
                let finalDestFolder = baseName;
                let counter = 1;
                while (require('fs').existsSync(path.join(GAMES_DIR, finalDestFolder))) finalDestFolder = `${baseName}_${counter++}`;
                const finalPath = path.join(GAMES_DIR, finalDestFolder);

                io.emit('upload-status', { message: '📦 Сохранение в библиотеку...' });
                await require('util').promisify(require('child_process').execFile)('mv', [sourceDir, finalPath]);

                await fsp.rm(tmpExtractDir, { recursive: true, force: true }).catch(() => {});
                await fsp.unlink(finalArchivePath).catch(() => {});

                // Запись базовых данных игры в базу данных
                await addGameToDB(finalDestFolder, finalPath);

                io.emit('upload-status', { message: '✨ Готово!' });
                res.json({ success: true, finished: true, folder: finalDestFolder, message: `Игра добавлена!` });

                // Фоновый процесс подсчета размера
                setTimeout(async () => {
                    try {
                        io.emit('upload-status', { message: '📏 Подсчет размера...' });
                        const gameSize = await getFolderSize(finalPath);
                        await dbService.get().run('UPDATE games SET size = ? WHERE id = ?', [gameSize, finalDestFolder]);
                        
                        // [REDIS] Сбрасываем кэш, так как у новой игры появился размер
                        await redisClient.del('api:games:list');

                        io.emit('scrape-success', { message: `Размер игры успешно определен!` });
                    } catch (e) {
                        console.error('[Upload] Ошибка фонового подсчета размера:', e);
                    }
                }, 500);

            } catch (e) {
                await fsp.rm(tmpExtractDir, { recursive: true, force: true }).catch(() => {});
                await fsp.unlink(finalArchivePath).catch(() => {});
                io.emit('upload-status', { message: '❌ Ошибка: ' + e.message });
                
                if (!res.headersSent) {
                    return res.status(500).json({ error: 'Сбой: ' + e.message });
                }
            }

        } catch (e) {
            await fsp.unlink(chunkPath).catch(() => {});
            if (!res.headersSent) {
                return res.status(500).json({ error: 'Ошибка склейки файла: ' + e.message });
            }
        }
    });

    return router;
};