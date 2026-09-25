const express = require('express');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const dbService = require('../db/database.js');
const scraperService = require('../services/scraper.js');
const { GAMES_DIR, SAVES_DIR } = require('../config/index.js');
const { uploadLimiter, coverUpload } = require('../utils/upload.js');
const { spawnExtract, findGameFolder, getFolderSize } = require('../utils/archive.js');
const { validateIdParam } = require('../utils/validate.js');
const { redisClient, invalidateGamesList, GAMES_LIST_KEY } = require('../utils/cache.js');
const { normalizeTags } = require('../utils/tags.js');
const { cleanTitle } = require('../utils/title.js');

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
            screens: parseProgress(row.screens) || [],
            // Язык по тексту самой игры: { main, langs, original }. language выше —
            // только ручная правка, она главнее
            textLang: parseProgress(row.text_lang),
            // Состояние поиска метаданных — для строчки в окне игры и для ревизии
            meta: {
                status: row.meta_status || 'new',
                attempts: row.meta_attempts || 0,
                retryAt: row.meta_retry_at || null,
                checkedAt: row.meta_checked_at || 0,
                error: row.meta_error || '',
            },
        })).sort((a, b) => b.addedAt - a.addedAt); 
        games.forEach((g, i) => g.number = i + 1);

        // [REDIS] 2. Сохраняем собранный список в кэш на 5 минут (300 секунд)
        await redisClient.set(GAMES_LIST_KEY, JSON.stringify(games), { EX: 300 });

        res.json(games);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

// --- ДОГОН МЕТАДАННЫХ: ставим в очередь всех, у кого их нет ---
// Искать заново сразу для группы игр. Вызывается из ревизии: сначала видно,
// чего не хватает, и там же это чинится — раньше кнопка работала вслепую.
//   missing — не найденные и те, где источники не ответили
//   partial — с тегами, но без картинок или ссылки
router.post('/rescan', async (req, res) => {
    const scope = req.body?.scope === 'partial' ? ['partial'] : ['new', 'not_found', 'error'];
    try {
        const rows = await dbService.get().all(
            `SELECT id FROM games WHERE ready = 1 AND meta_status IN (${scope.map(() => '?').join(',')})`,
            scope
        );
        const queued = await scraperService.requestScrape(rows.map(r => r.id));
        await invalidateGamesList();
        res.json({ success: true, queued });
    } catch (e) {
        res.status(500).json({ error: 'Не удалось поставить в очередь' });
    }
});

// «Искать сейчас» для одной игры из её окна
router.post('/:id/rescrape', async (req, res) => {
    try {
        const queued = await scraperService.requestScrape([path.basename(req.params.id)]);
        if (!queued) return res.status(404).json({ error: 'Игра не найдена' });
        await invalidateGamesList();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Не удалось поставить в очередь' });
    }
});

// --- РЕВИЗИЯ БИБЛИОТЕКИ ---
// Отвечает на вопросы, которых по списку игр не видно: что не запустится, что лежит
// дважды, что занимает место и ни разу не открывалось, от чего остались сейвы, хотя
// игры уже нет. Ничего не удаляет и не чинит — только показывает.
router.get('/audit', async (req, res) => {
    const exists = async (p) => { try { await fsp.access(p); return true; } catch { return false; } };

    try {
        const rows = await dbService.get().all('SELECT * FROM games WHERE ready = 1');

        // Движок открывает игру через index.html: либо в корне папки, либо в www —
        // ровно так его ищет раздача файлов. Нет ни того, ни другого — игра не запустится
        const broken = [];
        for (const g of rows) {
            const dir = path.join(GAMES_DIR, g.id);
            const ok = await exists(path.join(dir, 'index.html'))
                || await exists(path.join(dir, 'www', 'index.html'));
            if (!ok) broken.push({ id: g.id, title: g.title, size: g.size || 0 });
        }

        // Похожие названия. Сравниваем очищенное от версий название без знаков:
        // «Roseliam-1.08» и «Roseliam v1.1» — это одна игра в двух папках.
        const byKey = new Map();
        for (const g of rows) {
            const key = cleanTitle(g.title || g.id).toLowerCase().replace(/[^a-z0-9а-я]/gi, '');
            if (key.length < 4) continue;   // от «TOD» и «123» пользы в сравнении нет
            if (!byKey.has(key)) byKey.set(key, []);
            byKey.get(key).push({ id: g.id, title: g.title, size: g.size || 0 });
        }
        const duplicates = [...byKey.values()].filter(group => group.length > 1);

        const slim = (g) => ({ id: g.id, title: g.title, size: g.size || 0 });
        const bySize = (a, b) => b.size - a.size;

        const never = rows.filter(g => !g.lastPlayed && !g.playtime).map(slim).sort(bySize);
        const heavy = rows.map(slim).sort(bySize).slice(0, 10);

        // Поиск метаданных: берём готовое состояние, а не угадываем по пустым полям.
        // Раньше ревизия и кнопка «Дозагрузить» считали «без метаданных» по-разному.
        const withMeta = (g) => ({ ...slim(g), status: g.meta_status, retryAt: g.meta_retry_at || null, error: g.meta_error || '' });
        const missing = rows.filter(g => g.meta_status === 'not_found' || g.meta_status === 'error').map(withMeta).sort(bySize);
        const partial = rows.filter(g => g.meta_status === 'partial').map(withMeta).sort(bySize);
        const now = Date.now();
        const pending = rows.filter(g => g.meta_status === 'new' || (g.meta_retry_at && g.meta_retry_at <= now)).length;

        // Папки, игры к которым уже нет. Сейвы в таком случае — единственное, что
        // осталось от прохождения, поэтому показываем отдельно и ничего не трогаем.
        const ids = new Set(rows.map(g => g.id));
        const orphanDirs = async (dir, kind) => {
            try {
                const entries = await fsp.readdir(dir, { withFileTypes: true });
                return entries.filter(e => e.isDirectory() && !ids.has(e.name)).map(e => ({ id: e.name, kind }));
            } catch (e) {
                return [];
            }
        };
        const orphans = [
            ...await orphanDirs(SAVES_DIR, 'saves'),
            ...await orphanDirs(path.join(GAMES_DIR, '_media'), 'media'),
        ];

        res.json({ total: rows.length, broken, duplicates, missing, partial, pending, orphans, never, heavy });
    } catch (e) {
        console.error('[Audit] Ошибка:', e.message);
        res.status(500).json({ error: 'Не удалось собрать ревизию' });
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
        const current = await dbService.get().get('SELECT * FROM games WHERE id = ?', [folder]);
        if (!current) return res.status(404).json({ error: 'Игра не найдена' });

        // Что человек действительно поменял. Форма присылает все поля разом, и если
        // считать ручным всё присланное, автопоиск навсегда перестал бы обновлять
        // поля, которые просто стояли в форме с прошлого раза.
        const sent = { developer, language, releaseDate, link };
        const manual = {};
        for (const [key, value] of Object.entries(sent)) {
            if (value !== undefined && String(value) !== String(current[key] || '')) manual[key] = value;
        }

        // Поменянное пишем сразу: оно главнее всего, что найдётся, и должно остаться,
        // даже если поиск ничего не даст
        const direct = { ...manual };
        if (title !== undefined && title !== current.title) direct.title = title;
        const directKeys = Object.keys(direct);
        if (directKeys.length) {
            await dbService.get().run(
                `UPDATE games SET ${directKeys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
                [...directKeys.map(k => direct[k]), folder]
            );
        }

        const searchFrom = title || current.title || folder;
        const rawQuery = rjCode || link;
        const typedRj = (String(rawQuery || '').match(/RJ\d{6,8}/i) || [])[0];

        const lookup = await scraperService.lookupMetadata(searchFrom, rawQuery, {
            altTitle: scraperService.titleFromFolder(folder),
        });
        if (lookup.data && !lookup.data.rjCode && typedRj) lookup.data.rjCode = typedRj.toUpperCase();

        // Раньше при неудаче здесь выполнялось tags = '[]', description = '' — опечатка
        // в RJ-коде стирала хорошие теги и описание. Теперь неудача ничего не трогает.
        const result = await scraperService.applyLookup(folder, lookup, { manual });

        // Текст сообщения собирает интерфейс на языке пользователя: отсюда — только факты
        const g = result.row;
        res.json({
            success: true,
            found: result.found,
            failed: result.failed,
            game: {
                title: g.title,
                cover: g.cover,
                developer: g.developer || '',
                language: g.language || '',
                releaseDate: g.releaseDate || '',
                link: g.link || '',
                tags: normalizeTags(g.tags ? JSON.parse(g.tags) : []),
                description: g.description || '',
                screens: parseProgress(g.screens) || [],
                meta: {
                    status: g.meta_status,
                    attempts: g.meta_attempts || 0,
                    retryAt: g.meta_retry_at || null,
                    checkedAt: g.meta_checked_at || 0,
                    error: g.meta_error || '',
                },
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
