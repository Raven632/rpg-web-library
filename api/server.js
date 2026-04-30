require('dotenv').config();
const express = require('express');
const compression = require('compression');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const multer = require('multer');
const util = require('util');
const { execFile, spawn } = require('child_process');
const execFilePromise = util.promisify(execFile);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const http = require('http');
const { Server } = require('socket.io');

const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

const dbService = require('./src/db/database.js');
const scraperService = require('./src/services/scraper.js');
const { authRouter, requireAuth } = require('./src/routes/auth.js');
const { GAMES_DIR, EXTRACT_TMP, UPLOAD_TMP, SAVES_DIR, AUDIOCACHE } = require('./src/config/index.js');
const { spawnExtract, findGameFolder } = require('./src/utils/archive.js');
const { upload, uploadLimiter } = require('./src/utils/upload.js');
const createGamesRouter = require('./src/routes/games.js');
const createSavesRouter = require('./src/routes/saves.js');
const audioService = require('./src/services/audio.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(compression());


// ============================================================================
// [2] ИНИЦИАЛИЗАЦИЯ И MIDDLEWARE
// ============================================================================

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, message: { error: 'Слишком много запросов' } });
app.use('/api/', apiLimiter);

Promise.all([
    fsp.mkdir(EXTRACT_TMP, { recursive: true }),
    fsp.mkdir(SAVES_DIR, { recursive: true }),
    fsp.mkdir(AUDIOCACHE, { recursive: true })
]).catch(err => console.error('[Init] Ошибка создания системных папок:', err));

// ============================================================================
// [3] СИСТЕМНЫЕ УТИЛИТЫ И ФОНОВАЯ ОЧЕРЕДЬ
// ============================================================================

// Процессор фоновой очереди (Умный универсальный парсер)
async function processBackgroundScrape() {
    if (isBackgroundScraping || backgroundScrapeQueue.length === 0) return;
    isBackgroundScraping = true;
    
    while (backgroundScrapeQueue.length > 0) {
        const folder = backgroundScrapeQueue.shift();
        
        try {
            console.log(`[Queue] ⏳ Фоновый парсинг для: ${folder}`);
            const gamePath = path.join(GAMES_DIR, folder);
            
            // 1. Сначала глубоко ищем RJ-код внутри текстовых файлов игры
            const rjCode = await scraperService.findRJCode(folder, gamePath);
            
            // 2. Получаем чистое название для резервного поиска (VNDB/Steam)
            let title = folder.replace(/\[?RJ\d{6,8}\]?/gi, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim() || folder;
            try {
                const sys = JSON.parse(await fsp.readFile(path.join(gamePath, 'data', 'System.json'), 'utf8'));
                if (sys.gameTitle && !sys.gameTitle.toLowerCase().includes('rmmz')) title = sys.gameTitle;
            } catch(e) {}

            // 3. Каскадный поиск: Если есть RJ -> DLsite. Иначе -> VNDB -> Steam
            const scrapedData = await scraperService.fetchUniversalMetadata(title, rjCode);
            
            if (scrapedData && (scrapedData.tags?.length > 0 || scrapedData.description)) {
                const tagsJson = JSON.stringify(scrapedData.tags || []);
                const desc = scrapedData.description || '';

                await dbService.get().run('UPDATE games SET tags = ?, description = ?, scraped = 1 WHERE id = ?',
                    [tagsJson, desc, folder]);
                
                // Если парсер нашел обложку (например в Steam/VNDB), а у нас её нет - скачиваем
                if (scrapedData.coverUrl) {
                    const current = await dbService.get().get('SELECT cover FROM games WHERE id = ?', [folder]);
                    if (!current?.cover) {
                        if (await scraperService.downloadRemoteCover(scrapedData.coverUrl, path.join(gamePath, 'cover.jpg'))) {
                            await dbService.get().run('UPDATE games SET cover = ? WHERE id = ?', [`${folder}/cover.jpg`, folder]);
                        }
                    }
                }

                if (io) io.emit('scrape-success', { message: `✅ Данные для "${title}" успешно загружены!` });
                console.log(`[Queue] ✅ Успешно обновлено: ${folder}`);
            } else {
                // Помечаем как scraped=1, чтобы больше не пытаться парсить пустые игры при каждом перезапуске
                await dbService.get().run('UPDATE games SET scraped = 1 WHERE id = ?', [folder]);
                console.log(`[Queue] ⚠️ Данные не найдены для: ${folder}`);
            }
        } catch (e) {
            console.error(`[Queue] ❌ Ошибка для ${folder}:`, e.message);
        } finally {
            queuedScrapes.delete(folder); 
        }
        
        // Защита от бана DLsite/VNDB (пауза 4 сек между играми)
        await new Promise(r => setTimeout(r, 4000));
    }
    isBackgroundScraping = false;
}

// ============================================================================
// [5] БАЗА ДАННЫХ
// ============================================================================

async function addGameToDB(folder, gamePath) {
    let title = folder.replace(/\[?RJ\d{6,8}\]?/gi, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim() || folder;
    
    try {
        const sysRaw = await fsp.readFile(path.join(gamePath, 'data', 'System.json'), 'utf8');
        const sys = JSON.parse(sysRaw);
        if (sys.gameTitle && !sys.gameTitle.toLowerCase().includes('rmmz')) title = sys.gameTitle;
    } catch(e) {}

    const checkExists = async (p) => { try { await fsp.access(p); return true; } catch { return false; } };

    let cover = null;
    if (await checkExists(path.join(gamePath, 'cover.jpg'))) cover = `${folder}/cover.jpg`;
    else if (await checkExists(path.join(gamePath, 'cover.png'))) cover = `${folder}/cover.png`;

    // Вытаскиваем RJ-код только для того, чтобы скачать обложку напрямую (если её нет)
    const rjCode = await scraperService.findRJCode(folder, gamePath);
    if (rjCode && !cover) {
        if (await scraperService.fetchDLsiteCover(rjCode, path.join(gamePath, 'cover.jpg'))) cover = `${folder}/cover.jpg`;
    }

    if (!cover) {
        const titles1Path = path.join(gamePath, 'img', 'titles1');
        if (await checkExists(titles1Path)) {
            const validFiles = (await fsp.readdir(titles1Path)).filter(f => f.match(/\.(png|jpg|jpeg)$/i));
            if (validFiles.length > 0) cover = `${folder}/img/titles1/${validFiles[0]}`;
        }
        if (!cover && await checkExists(path.join(gamePath, 'icon', 'icon.png'))) cover = `${folder}/icon/icon.png`;
    }

    const stat = await fsp.stat(gamePath);

    // Добавляем игру в БД. ready = 1 (чтобы сразу отображалась в интерфейсе), scraped = 0
    await dbService.get().run(
        `INSERT OR REPLACE INTO games (id, title, cover, tags, description, rating, lastPlayed, addedAt, scraped, ready)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [folder, title, cover, '[]', '', 0, 0, stat.birthtimeMs || stat.mtimeMs || Date.now(), 0, 1]
    );

    if (io) io.emit('scrape-success', { message: `✅ Игра "${title}" добавлена в библиотеку!` });

    // ⚡ Отправляем ВСЕ добавленные игры в умную фоновую очередь
    // Очередь сама разберется: искать по RJ-коду на DLsite или по названию на VNDB/Steam
    if (!queuedScrapes.has(folder)) {
        queuedScrapes.add(folder);
        backgroundScrapeQueue.push(folder);
        processBackgroundScrape();
    }
}

async function syncDatabase() {
    const entries = await fsp.readdir(GAMES_DIR);
    const existingGames = await dbService.get().all('SELECT id FROM games');
    const dbIds = existingGames.map(g => g.id);

    for (const folder of entries) {
        const gamePath = path.join(GAMES_DIR, folder);
        try { 
            const stat = await fsp.stat(gamePath); 
            if (!stat.isDirectory() || ['node_modules', '_saves', '_tmp_uploads', '.audio-cache'].includes(folder)) continue;
            if (!dbIds.includes(folder)) await addGameToDB(folder, gamePath);
        } catch(e) { continue; }
    }

    for (const id of dbIds) {
        if (!entries.includes(id) || ['_saves', '_tmp_uploads', 'node_modules', '.audio-cache'].includes(id)) {
            await dbService.get().run('DELETE FROM games WHERE id = ?', [id]);
        }
    }
}

// ============================================================================
// [6] МАРШРУТЫ АВТОРИЗАЦИИ
// ============================================================================

app.use('/api', authRouter); // Подключаем роуты логина
app.use('/api', requireAuth); // Ставим "замок": все роуты, написанные ниже, будут требовать авторизацию!

// ============================================================================
// [7,8] ОСНОВНЫЕ API МАРШРУТЫ И СОХРАНЕНИЯ
// ============================================================================

app.use('/api/games', createGamesRouter(io, addGameToDB, EXTRACT_TMP));
app.use('/api/saves', createSavesRouter(EXTRACT_TMP));

// ============================================================================
// [7] ГЛОБАЛЬНЫЙ РОУТИНГ (СТАТИКА И ЗВУК)
// ============================================================================

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', async (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/') return next();

    let reqPath = decodeURIComponent(req.path);
    let filePath = path.join(GAMES_DIR, reqPath);

    const normalizedGamesDir = path.resolve(GAMES_DIR);
    const normalizedFilePath = path.resolve(filePath);
    if (normalizedFilePath !== normalizedGamesDir && !normalizedFilePath.startsWith(normalizedGamesDir + path.sep)) {
        return res.status(403).send('Доступ запрещен');
    }

    try {
        if (!fs.existsSync(filePath)) {
            const dir = path.dirname(filePath);
            const baseLow = path.basename(filePath).toLowerCase();
            try {
                const match = fs.readdirSync(dir).find(f => f.toLowerCase() === baseLow);
                if (match) {
                    filePath = path.join(dir, match);
                    reqPath = path.relative(GAMES_DIR, filePath);
                }
            } catch(e) {}
        }

        let stat;
        try { stat = await fsp.stat(filePath); } catch(e) {}

        if (stat && stat.isDirectory()) {
            if (!req.path.endsWith('/')) return res.redirect(req.path + '/');
            if (fs.existsSync(path.join(filePath, 'index.html'))) {
                filePath = path.join(filePath, 'index.html');
            } else if (fs.existsSync(path.join(filePath, 'www', 'index.html'))) {
                return res.redirect(req.path + 'www/');
            } else {
                const deepDir = await findGameFolder(filePath);
                if (deepDir) return res.redirect('/' + path.relative(GAMES_DIR, deepDir).replace(/\\/g, '/') + '/');
                return res.status(404).send(`<div style="color:red; text-align:center; padding:50px;">index.html не найден.</div>`);
            }
        }

        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.m4a' || ext === '.ogg') {
            const base = filePath.slice(0, -4);
            
            // Детектор для iPhone и iPadOS Safari
            const ua = req.headers['user-agent'] || '';
            const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && ua.includes('Mobile'));
            
            const pathsToTry = ext === '.m4a' 
                ? [filePath, base + '.ogg', filePath + '_', base + '.rpgmvo', base + '.rpgmvm'] 
                : [filePath, base + '.m4a', filePath + '_', base + '.rpgmvm', base + '.rpgmvo']; 

            let sourcePath = null;
            for (const p of pathsToTry) {
                try { await fsp.access(p); sourcePath = p; break; } catch {}
            }

            if (sourcePath) {
                const isEncrypted = sourcePath.endsWith('.rpgmvo') || sourcePath.endsWith('.rpgmvm');
                if (isIOS && (isEncrypted || sourcePath.endsWith('.ogg'))) {
                    try {
                        const gameFolder = reqPath.split('/').filter(Boolean)[0];
                        const readyPath = await audioService.ensureM4aFromSource(sourcePath, path.join(GAMES_DIR, gameFolder));
                        res.type('audio/mp4');
                        res.setHeader('Cache-Control', 'public, max-age=86400');
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        return res.sendFile(readyPath);
                    } catch (err) { filePath = sourcePath; } 
                } else {
                    filePath = sourcePath;
                }
            }
        }

        let finalStat;
        try { finalStat = await fsp.stat(filePath); } catch(e) {}

        if (finalStat && finalStat.isFile()) {
            if (filePath.endsWith('index.html')) {
                let html = await fsp.readFile(filePath, 'utf8');
                html = html.replace(/<meta[^>]+http-equiv=['"]?Content-Security-Policy['"]?[^>]*>/gi, '');
                html = html.replace(/(<body[^>]*>)/i, '$1<script src="/rpg-fixes.js?v=' + Date.now() + '"></script>');
                res.setHeader('Content-Type', 'text/html');
                res.setHeader('Access-Control-Allow-Origin', '*');
                return res.send(html);
            }
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.sendFile(filePath);
        }
    } catch(e) {}
    next();
});

// ============================================================================
// [11] ЗАПУСК СЕРВЕРА И ФОНОВЫХ ПРОЦЕССОВ
// ============================================================================

if (require.main === module) {
    dbService.init(GAMES_DIR).then(async () => {
        await syncDatabase();

        const srv = server.listen(3000, () => console.log('🚀 RPG API: SQLite и WebSockets подключены, сервер готов!'));
        srv.timeout = 0; srv.requestTimeout = 0; srv.keepAliveTimeout = 0;

        let syncTimer = null;
        let syncInProgress = false;
        let pendingSync = false;
        let lastReadyCount = (await dbService.get().get('SELECT COUNT(*) as c FROM games WHERE ready = 1'))?.c || 0;

        async function runSyncSafely(reason = 'watcher') {
            if (syncInProgress) { pendingSync = true; return; }
            syncInProgress = true;
            try {
                await syncDatabase();
                const newReadyCount = (await dbService.get().get('SELECT COUNT(*) as c FROM games WHERE ready = 1'))?.c || 0;
                if (newReadyCount !== lastReadyCount) {
                    const diff = newReadyCount - lastReadyCount;
                    lastReadyCount = newReadyCount;
                    io.emit('scrape-success', { message: diff > 0 ? `✅ Добавлено готовых игр: ${diff}` : '🔄 Библиотека обновлена' });
                }
                console.log('[Watcher] ✅ Синхронизация завершена');
            } catch (e) { 
                console.error('[Watcher] ❌ Ошибка синхронизации:', e); 
            } finally {
                syncInProgress = false;
                if (pendingSync) { pendingSync = false; setTimeout(() => runSyncSafely('pending'), 300); }
            }
        }

        fs.watch(GAMES_DIR, { persistent: true }, (eventType, filename) => {
            if (!filename || ['_tmp_uploads', '_saves', 'node_modules', '.audio-cache'].includes(filename)) return;
            clearTimeout(syncTimer);
            syncTimer = setTimeout(() => runSyncSafely(`fs.watch:${eventType}:${filename}`), 5000);
        });

        console.log(`[Watcher] 👀 Наблюдение за ${GAMES_DIR} включено`);
    }).catch(console.error);
}

module.exports = { app };