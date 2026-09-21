const express = require('express');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const dbService = require('../db/database.js');
const scraperService = require('../services/scraper.js');
const { GAMES_DIR } = require('../config/index.js');
const { uploadLimiter, coverUpload } = require('../utils/upload.js');
const { spawnExtract, findGameFolder, getFolderSize } = require('../utils/archive.js');
const { validateIdParam } = require('../utils/validate.js');
const { redisClient, invalidateGamesList, GAMES_LIST_KEY } = require('../utils/cache.js');
const { normalizeTags } = require('../utils/tags.js');

const router = express.Router();

// Все роуты с :id — только безопасное имя папки (без "." / ".." / слэшей)
router.param('id', validateIdParam);

let isCalculatingSizes = false; // Глобальный замок

// Строку пишем мы сами, но битое значение в базе не должно ронять весь список
const parseProgress = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

// --- 1. ПОЛУЧЕНИЕ ВСЕХ ИГР (С КЭШИРОВАНИЕМ REDIS) ---
router.get('/', async (req, res) => {
    try {
        // [REDIS] 1. Проверяем кэш. Если есть — отдаем мгновенно!
        const cachedGames = await redisClient.get(GAMES_LIST_KEY);
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
                    if (sizeUpdated) await invalidateGamesList();
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
            // Без этого поля значок «ждёт метаданные» горел на каждой карточке
            scraped: !!row.scraped,
            tags: normalizeTags(row.tags ? JSON.parse(row.tags) : []),
            description: row.description, 
            url: `/${row.id}/`, 
            number: 0,
            addedAt: row.addedAt, 
            lastPlayed: row.lastPlayed, 
            rating: row.rating,
            status: row.status || '',
            favorite: !!row.favorite,
            playtime: row.playtime || 0,
            progress: parseProgress(row.progress),
            screens: parseProgress(row.screens) || []
        })).sort((a, b) => b.addedAt - a.addedAt); 
        games.forEach((g, i) => g.number = i + 1);

        // [REDIS] 2. Сохраняем собранный список в кэш на 5 минут (300 секунд)
        await redisClient.set(GAMES_LIST_KEY, JSON.stringify(games), { EX: 300 });

        res.json(games);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

// --- ДОГОН МЕТАДАННЫХ: ставим в очередь всех, у кого их нет ---
router.post('/rescan', async (req, res) => {
    try {
        // Берём и те игры, у которых нет картинок: кнопка называется «дозагрузить»,
        // а не «дозагрузить теги», и после появления галереи это стало заметно.
        const rows = await dbService.get().all(
            `SELECT id FROM games WHERE ready = 1 AND (
                tags IS NULL OR tags = '' OR tags = '[]'
                OR scraped = 0 OR link = ''
                OR screens IS NULL OR screens = '' OR screens = '[]'
            )`
        );
        // Очередь живёт в Redis и сама держит паузу в 4 секунды между играми,
        // поэтому просто складываем туда всё и отвечаем сразу, не дожидаясь обхода.
        // force: недельная память о неудачах существует для автоматических обходов.
        // Кнопку человек нажимает сам и обычно как раз после того, как парсер починили,
        // так что старый отрицательный ответ здесь только мешает.
        let queued = 0, skipped = 0;
        for (const row of rows) {
            // Вернёт false, только если игра уже стоит в очереди
            const added = await scraperService.queueScrape(row.id, { force: true });
            added ? queued++ : skipped++;
        }
        res.json({ success: true, queued, skipped });
    } catch (e) {
        res.status(500).json({ error: 'Не удалось поставить в очередь' });
    }
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
        await invalidateGamesList();
        
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
        await invalidateGamesList();
        
        res.json({ success: true, coverPath: newDbCover });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка при сбросе обложки' });
    }
});

// --- ПОИСК КАНДИДАТОВ НА F95 (ручной выбор в модалке) ---
router.get('/:id/f95-search', async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (query.length < 2) return res.status(400).json({ error: 'Слишком короткий запрос' });
    try {
        res.json({ items: await scraperService.searchF95Candidates(query) });
    } catch (e) {
        res.status(500).json({ error: 'Поиск не удался' });
    }
});

// --- 4. РЕДАКТИРОВАНИЕ МЕТАДАННЫХ ---
router.post('/:id/edit', async (req, res) => {
    const folder = path.basename(req.params.id);
    const { title, rjCode, developer, language, releaseDate, link } = req.body;

    try {
        let scrapeWarning = null;
        
        // Обновляем только те поля, что реально пришли. Раньше частичный запрос
        // (например, одна лишь ссылка) затирал название и остальное пустыми строками.
        const manual = { title, developer, language, releaseDate, link };
        const manualKeys = Object.keys(manual).filter(k => manual[k] !== undefined);
        if (manualKeys.length > 0) {
            await dbService.get().run(
                `UPDATE games SET ${manualKeys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
                [...manualKeys.map(k => manual[k]), folder]
            );
        }

        // Искать будем по тому названию, что сейчас в базе, если своё не прислали
        const current = await dbService.get().get('SELECT title FROM games WHERE id = ?', [folder]);
        const searchFrom = title || current?.title || folder;

        const rawQuery = rjCode || link; 
        const actualRjCode = (rawQuery && rawQuery.match(/RJ\d{6,8}/i)) ? rawQuery.match(/RJ\d{6,8}/i)[0].toUpperCase() : null;
        let coverUpdated = false;

        const scrapedData = await scraperService.fetchUniversalMetadata(searchFrom, rawQuery);
        
        if (scrapedData) {
            // Все картинки сохраняет saveGameMedia и только в _media. Раньше обложка
            // писалась ещё и в папку игры, а потом перетиралась картинкой с форума —
            // из-за этого вместо обложки магазина в карточке оказывалась анимация темы.
            const currentRow = await dbService.get().get('SELECT cover FROM games WHERE id = ?', [folder]);
            const media = await scraperService.saveGameMedia(
                folder,
                { ...scrapedData, rjCode: scrapedData.rjCode || actualRjCode },
                currentRow?.cover
            );
            if (media.cover) {
                await dbService.get().run('UPDATE games SET cover = ? WHERE id = ?', [media.cover, folder]);
                coverUpdated = true;
            }
            if (media.screens.length) {
                await dbService.get().run('UPDATE games SET screens = ? WHERE id = ?', [JSON.stringify(media.screens), folder]);
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
        await invalidateGamesList();

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
                tags: normalizeTags(updatedGame.tags ? JSON.parse(updatedGame.tags) : []),
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
    const { rating, lastPlayed, status, favorite } = req.body;

    try {
        const game = await dbService.get().get('SELECT id FROM games WHERE id = ?', [folder]);
        if (!game) return res.status(404).json({ error: 'Игра не найдена' });

        const updates = [], params = [];
        if (rating !== undefined) { updates.push('rating = ?'); params.push(rating); }
        if (lastPlayed !== undefined) { updates.push('lastPlayed = ?'); params.push(lastPlayed); }

        // Статус приходит из браузера — принимаем только известные значения.
        // Иначе в базе окажется любой текст, который пришлёт клиент.
        const STATUSES = ['', 'playing', 'done', 'dropped', 'wish'];
        if (status !== undefined) {
            if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Неизвестный статус' });
            updates.push('status = ?'); params.push(status);
        }
        if (favorite !== undefined) { updates.push('favorite = ?'); params.push(favorite ? 1 : 0); }

        if (updates.length > 0) {
            params.push(folder);
            await dbService.get().run(`UPDATE games SET ${updates.join(', ')} WHERE id = ?`, params);
            
            // [REDIS] Сбрасываем кэш, так как рейтинг или время игры обновились
            await invalidateGamesList();
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Ошибка сохранения метаданных' }); }
});

// --- 6. УДАЛЕНИЕ ИГРЫ ---
router.delete('/:id', async (req, res) => {
    const id = path.basename(req.params.id);
    const gamePath = path.join(GAMES_DIR, id);
    
    try {
        // Удаляем только то, что есть в библиотеке (не _saves, не library.db и т.п.)
        const game = await dbService.get().get('SELECT id FROM games WHERE id = ?', [id]);
        if (!game) return res.status(404).json({ error: 'Игра не найдена' });

        await fsp.access(gamePath);
        await fsp.rm(gamePath, { recursive: true, force: true });
        await dbService.get().run('DELETE FROM games WHERE id = ?', [id]);
        
        // [REDIS] Сбрасываем кэш после удаления
        await invalidateGamesList();
        
        res.json({ success: true });
    } catch(e) { 
        res.status(404).json({ error: 'Игра не найдена' }); 
    }
});

// --- 7. ЧАНКОВАЯ ЗАГРУЗКА АРХИВОВ ---
module.exports = function(io, addGameToDB, EXTRACT_TMP) {
    router.post('/upload-chunk', uploadLimiter, async (req, res) => {
        const { uploadId, chunkIndex, totalChunks, originalName, offset, totalSize } = req.query;

        const safeUploadId = String(uploadId || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const start = Number(offset);
        if (!safeUploadId || !Number.isInteger(start) || start < 0 || !originalName) {
            return res.status(400).json({ error: 'Некорректные параметры загрузки' });
        }
        if (!/\.(zip|7z|rar)$/i.test(originalName)) {
            return res.status(400).json({ error: 'Поддерживаются только ZIP, 7z и RAR!' });
        }

        const finalArchivePath = path.join(EXTRACT_TMP, `${safeUploadId}.archive`);

        try {
            // Тело запроса пишем СРАЗУ в нужное место архива: ни временных кусков, ни склейки.
            // Файл создаём заранее ('a'), чтобы затем писать по смещению ('r+').
            await fsp.mkdir(EXTRACT_TMP, { recursive: true });
            await (await fsp.open(finalArchivePath, 'a')).close();
            await new Promise((resolve, reject) => {
                const ws = fs.createWriteStream(finalArchivePath, { flags: 'r+', start });
                req.on('error', reject);
                ws.on('error', reject);
                ws.on('close', resolve);
                req.pipe(ws);
            });

            if (parseInt(chunkIndex) < parseInt(totalChunks) - 1) {
                return res.json({ success: true, finished: false });
            }

            // Последний кусок: проверяем, что архив собран целиком
            const archiveSize = (await fsp.stat(finalArchivePath)).size;
            if (totalSize && archiveSize !== Number(totalSize)) {
                await fsp.unlink(finalArchivePath).catch(() => {});
                return res.status(400).json({ error: `Архив собран не полностью: ${archiveSize} из ${totalSize} байт` });
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
                        await invalidateGamesList();

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
            if (!res.headersSent) {
                return res.status(500).json({ error: 'Ошибка склейки файла: ' + e.message });
            }
        }
    });

    return router;
};
