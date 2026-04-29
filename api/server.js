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

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(compression());

// ============================================================================
// [1] КОНФИГУРАЦИЯ СЕРВЕРА
// ============================================================================

const GAMES_DIR = process.env.GAMES_DIR || path.join(__dirname, 'games');
const EXTRACT_TMP = path.join(GAMES_DIR, '_tmp_uploads'); 
const UPLOAD_TMP = EXTRACT_TMP; 
const SAVES_DIR = path.join(GAMES_DIR, '_saves');
const AUDIOCACHE = path.join(GAMES_DIR, '.audio-cache');

// ⚡ Уникальный токен сессии (Генерируется при первом запуске и хранится в БД)
let SESSION_TOKEN = '';

const TAGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const dlsiteTagCache = new Map();
let db; 

// ⚡ Очередь фонового скрейпинга с дедупликацией
const backgroundScrapeQueue = [];
const queuedScrapes = new Set(); // Защита от дублирования
let isBackgroundScraping = false;

// ============================================================================
// [2] ИНИЦИАЛИЗАЦИЯ И MIDDLEWARE
// ============================================================================

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, message: { error: 'Слишком много запросов' } });
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: 'Слишком много загрузок' } });
app.use('/api/', apiLimiter);

Promise.all([
    fsp.mkdir(EXTRACT_TMP, { recursive: true }),
    fsp.mkdir(SAVES_DIR, { recursive: true }),
    fsp.mkdir(AUDIOCACHE, { recursive: true })
]).catch(err => console.error('[Init] Ошибка создания системных папок:', err));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_TMP),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '';
        cb(null, `archive_${Date.now()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 * 1024 }, 
    fileFilter: (req, file, cb) => {
        if (file.originalname.match(/\.(zip|7z|rar)$/i)) cb(null, true);
        else cb(new Error('Поддерживаются только ZIP, 7z и RAR!'));
    }
});

// ============================================================================
// [3] СИСТЕМНЫЕ УТИЛИТЫ И ФОНОВАЯ ОЧЕРЕДЬ
// ============================================================================

// Процессор фоновой очереди
async function processBackgroundScrape() {
    if (isBackgroundScraping || backgroundScrapeQueue.length === 0) return;
    isBackgroundScraping = true;
    
    while (backgroundScrapeQueue.length > 0) {
        const folder = backgroundScrapeQueue.shift();
        
        try {
            console.log(`[Queue] ⏳ Фоновый парсинг для: ${folder}`);
            const gamePath = path.join(GAMES_DIR, folder);
            const rjCode = await findRJCode(folder, gamePath);
            
            if (rjCode) {
                const scrapedData = await executeFetchDLsiteTags(rjCode);
                if (scrapedData?.tags?.length > 0) {
                    await db.run('UPDATE games SET tags = ?, description = ?, scraped = 1 WHERE id = ?',
                        [JSON.stringify(scrapedData.tags), scrapedData.description, folder]);
                    io.emit('scrape-success', { message: `✅ Данные для "${folder}" успешно загружены!` });
                    console.log(`[Queue] ✅ Успешно обновлено: ${folder}`);
                }
            }
        } catch (e) {
            console.error(`[Queue] ❌ Ошибка для ${folder}:`, e.message);
        } finally {
            // ⚡ ИСПРАВЛЕНИЕ: Удаляем блокировку ТОЛЬКО после полного завершения работы
            queuedScrapes.delete(folder); 
        }
        
        // Защита от бана DLsite (пауза 3 сек)
        await new Promise(r => setTimeout(r, 3000));
    }
    isBackgroundScraping = false;
}

function spawnExtract(cmd, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', d => { if (stderr.length < 50000) stderr += d.toString(); });
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Exit code ${code}. Stderr: ${stderr.slice(0, 2000)}`)));
        proc.on('error', err => reject(new Error(`Запуск ${cmd} не удался: ${err.message}`)));
    });
}

async function findGameFolder(dir, depth = 0) {
    if (depth > 10) return null;
    const items = await fsp.readdir(dir, { withFileTypes: true });
    
    if (items.some(i => i.isDirectory() && i.name.toLowerCase() === 'www')) {
        return path.join(dir, items.find(i => i.name.toLowerCase() === 'www').name);
    }
    if (items.some(i => i.isFile() && i.name.toLowerCase() === 'index.html')) return dir;
    
    for (const item of items) {
        if (item.isDirectory()) {
            const found = await findGameFolder(path.join(dir, item.name), depth + 1);
            if (found) return found;
        }
    }
    return null;
}

async function findRJCode(folderName, gamePath) {
    const rjRegex = /RJ\d{6,8}/i;
    let match = folderName.match(rjRegex);
    if (match) return match[0].toUpperCase();

    try {
        const files = await fsp.readdir(gamePath);
        const textFiles = files.filter(f => f.match(/\.(txt|md|html|json)$/i));
        for (const file of textFiles) {
            const filePath = path.join(gamePath, file);
            const stats = await fsp.stat(filePath);
            if (stats.size < 500000) {
                const content = await fsp.readFile(filePath, 'utf8');
                match = content.match(rjRegex);
                if (match) return match[0].toUpperCase();
            }
        }
    } catch (e) {}
    return null;
}

// ============================================================================
// [4] КАСКАДНЫЙ ПАРСЕР МЕТАДАННЫХ
// ============================================================================

async function fetchDLsiteCover(rjCode, destPath) {
    const numStr = rjCode.replace(/RJ/i, '');
    const dirStr = 'RJ' + String(Math.ceil(parseInt(numStr, 10) / 1000) * 1000).padStart(numStr.length, '0');
    const urls = [
        `https://img.dlsite.jp/modpub/images2/work/doujin/${dirStr}/${rjCode}_img_main.jpg`,
        `https://img.dlsite.jp/modpub/images2/work/professional/${dirStr}/${rjCode}_img_main.jpg`
    ];
    for (const url of urls) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (res.ok) {
                await fsp.writeFile(destPath, Buffer.from(await res.arrayBuffer()));
                return true;
            }
        } catch (e) {}
    }
    return false;
}

async function downloadRemoteCover(url, destPath) {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (res.ok) {
            await fsp.writeFile(destPath, Buffer.from(await res.arrayBuffer()));
            return true;
        }
    } catch (e) {}
    return false;
}

async function translateText(text, targetLang = 'en') {
    if (!text) return '';
    try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`);
        const data = await res.json();
        return data[0].map(item => item[0]).join('');
    } catch (e) { return text; }
}

async function fetchViaJapanProxy(url) {
    try {
        console.log('[Scraper] 📡 Собираем Японские прокси...');
        let proxies = [];

        try {
            const res1 = await fetch('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=JP');
            if (res1.ok) proxies.push(...(await res1.text()).split('\n').map(p => p.trim()).filter(p => p.includes(':')));
        } catch(e) {}

        try {
            const res2 = await fetch('https://proxylist.geonode.com/api/proxy-list?country=JP&protocols=http&limit=50&sort_by=lastChecked&sort_type=desc');
            if (res2.ok) {
                const json2 = await res2.json();
                if (json2.data) proxies.push(...json2.data.map(p => `${p.ip}:${p.port}`));
            }
        } catch(e) {}

        proxies = [...new Set(proxies)].sort(() => Math.random() - 0.5);

        if (proxies.length === 0) {
            console.log('[Scraper] ⚠️ Японские прокси недоступны.');
            return null;
        }

        const maxConcurrent = Math.min(20, proxies.length);
        console.log(`[Scraper] 🚀 ЗАПУСК АТАКИ через ${maxConcurrent} прокси...`);

        const promises = proxies.slice(0, maxConcurrent).map((proxy) => {
            return new Promise(async (resolve, reject) => {
                try {
                    const { stdout } = await execFilePromise('curl', [
                        '-sS', '-L', '-m', '7', '-x', proxy, 
                        '-H', 'User-Agent: Mozilla/5.0', url
                    ]);
                    const data = JSON.parse(stdout); 
                    if (data?.[0]?.work_name) resolve(data);
                    else reject(new Error('Пустой JSON'));
                } catch (e) { reject(e); }
            });
        });

        return await Promise.any(promises);
    } catch (e) {
        console.error('[Scraper] ❌ Ошибка JP-канала:', e.message);
    }
    return null;
}

async function processParsedData(gameData, rjCode) {
    const tags = gameData.genres ? gameData.genres.map(g => g.name) : [];
    let description = (gameData.intro_s || gameData.intro || '').replace(/<[^>]*>?/gm, '').trim();

    if (tags.length > 0) {
        const translatedDesc = await translateText(description, 'en');
        const finalData = { tags: [...new Set(tags)], description: translatedDesc };
        dlsiteTagCache.set(rjCode, { data: finalData, expiresAt: Date.now() + TAGS_CACHE_TTL_MS }); 
        return finalData;
    }
    return null;
}

async function executeFetchDLsiteTags(rjCode) {
    const cached = dlsiteTagCache.get(rjCode);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const locales = ['en_US', 'ja_JP'];
    for (const loc of locales) {
        const targetUrl = `https://www.dlsite.com/maniax/api/=/product.json?workno=${rjCode}&locale=${loc}`;
        const gateways = [
            `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
            `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
            `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`
        ];

        for (const gateway of gateways) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000); 
                const res = await fetch(gateway, { signal: controller.signal });
                clearTimeout(timeoutId);
                
                const data = await res.json();
                if (data?.[0]?.work_name) return await processParsedData(data[0], rjCode);
            } catch (e) {}
        }
    }

    const jpUrl = `https://www.dlsite.com/maniax/api/=/product.json?workno=${rjCode}&locale=en_US`;
    const jpData = await fetchViaJapanProxy(jpUrl);
    if (jpData?.[0]?.work_name) return await processParsedData(jpData[0], rjCode);

    return null;
}

async function fetchVNDBMetadata(title) {
    try {
        console.log(`[Scraper] 🌸 Ищем на VNDB: "${title}"...`);
        const res = await fetch('https://api.vndb.org/kana/vn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filters: ["search", "=", title], fields: "title, description, image.url, tags.name" })
        });
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            const vn = data.results[0];
            let desc = (vn.description || '').replace(/\[\/?(b|i|u|url|spoiler|quote)[^\]]*\]/gi, '').trim();
            return { coverUrl: vn.image ? vn.image.url : null, description: desc, tags: vn.tags ? vn.tags.map(t => t.name) : [] };
        }
    } catch (e) {}
    return null;
}

async function fetchSteamMetadata(title) {
    try {
        console.log(`[Scraper] 🚂 Ищем в Steam: "${title}"...`);
        const searchRes = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=US`);
        const searchData = await searchRes.json();

        if (searchData.total > 0 && searchData.items?.length > 0) {
            const appId = searchData.items[0].id;
            const detailRes = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`);
            const detailData = await detailRes.json();

            if (detailData[appId]?.success) {
                const game = detailData[appId].data;
                const desc = (game.short_description || game.about_the_game || '').replace(/<[^>]*>?/gm, '').trim();
                return { coverUrl: game.header_image, description: desc, tags: game.genres ? game.genres.map(g => g.description) : [] };
            }
        }
    } catch (e) {}
    return null;
}

async function fetchUniversalMetadata(title, rjCode) {
    if (rjCode) {
        const dlsiteData = await executeFetchDLsiteTags(rjCode);
        if (dlsiteData?.tags?.length > 0) return dlsiteData;
    }

    const cleanTitle = title.replace(/v\d+\.\d+/gi, '').replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
    if (!cleanTitle || cleanTitle.length < 3) return null;

    const vndbData = await fetchVNDBMetadata(cleanTitle);
    if (vndbData) return vndbData;

    const steamData = await fetchSteamMetadata(cleanTitle);
    if (steamData) return steamData;

    return null;
}

// ============================================================================
// [5] БАЗА ДАННЫХ
// ============================================================================

async function initDB() {
    db = await open({ filename: path.join(GAMES_DIR, 'library.db'), driver: sqlite3.Database });
    
    // 1. Создаем таблицы
    await db.exec(`
        CREATE TABLE IF NOT EXISTS games (
            id TEXT PRIMARY KEY, title TEXT, cover TEXT, tags TEXT, description TEXT,
            rating INTEGER DEFAULT 0, lastPlayed INTEGER DEFAULT 0, addedAt INTEGER DEFAULT 0, scraped INTEGER DEFAULT 0,
            ready INTEGER DEFAULT 0
        )
    `);
    await db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');

    // ⚡ 2. БЛОК БЕЗОПАСНОСТИ ZERO-CONFIG (То, что потерялось)
    let tokenRow = await db.get('SELECT value FROM settings WHERE key = "session_secret"');
    if (!tokenRow) {
        // Если сервер запускается ВПЕРВЫЕ - создаем сверхнадежный пароль
        SESSION_TOKEN = crypto.randomBytes(64).toString('hex');
        await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['session_secret', SESSION_TOKEN]);
        console.log('🛡️ [Security] Сгенерирован уникальный и безопасный ключ сессии для этой установки.');
    } else {
        // Сервер уже запускался - берем существующий пароль из базы
        SESSION_TOKEN = tokenRow.value;
    }

    // 3. Миграции старых данных
    try { await db.exec('ALTER TABLE games ADD COLUMN ready INTEGER DEFAULT 0'); } catch (_) {}
    try { 
        console.log('[DB] Проверка миграций...');
        await db.run('UPDATE games SET ready = 1 WHERE ready = 0 AND (title IS NOT NULL OR cover IS NOT NULL)'); 
    } catch (e) {}
}

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

    const rjCode = await findRJCode(folder, gamePath);
    if (rjCode && !cover) {
        if (await fetchDLsiteCover(rjCode, path.join(gamePath, 'cover.jpg'))) cover = `${folder}/cover.jpg`;
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

    await db.run(
        `INSERT OR REPLACE INTO games (id, title, cover, tags, description, rating, lastPlayed, addedAt, scraped, ready)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [folder, title, cover, '[]', '', 0, 0, stat.birthtimeMs || stat.mtimeMs || Date.now(), 0, 0]
    );

    // ⚡ ВОССТАНОВЛЕНО: Моментальный (синхронный) скрейп для красивого UI
    let scrapeSuccess = false;
    if (rjCode) {
        try {
            const scrapedData = await executeFetchDLsiteTags(rjCode);
            if (scrapedData?.tags?.length > 0) {
                await db.run('UPDATE games SET tags = ?, description = ?, scraped = 1 WHERE id = ?',
                    [JSON.stringify(scrapedData.tags), scrapedData.description, folder]);
                scrapeSuccess = true;
            }
        } catch (e) {}
    }

    await db.run('UPDATE games SET ready = 1 WHERE id = ?', [folder]);
    if (io) io.emit('scrape-success', { message: `✅ Игра "${title}" добавлена в библиотеку!` });

    // ⚡ Умная постановка в очередь с дедупликацией
    if (rjCode && !scrapeSuccess && !queuedScrapes.has(folder)) {
        queuedScrapes.add(folder);
        backgroundScrapeQueue.push(folder);
        processBackgroundScrape();
    }
}

async function syncDatabase() {
    const entries = await fsp.readdir(GAMES_DIR);
    const existingGames = await db.all('SELECT id FROM games');
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
            await db.run('DELETE FROM games WHERE id = ?', [id]);
        }
    }
}

// ============================================================================
// [6] МАРШРУТЫ АВТОРИЗАЦИИ
// ============================================================================

app.get('/api/setup/status', async (req, res) => {
    const adminSet = await db.get('SELECT value FROM settings WHERE key = "admin_user"');
    res.json({ initialized: !!adminSet });
});

app.post('/api/setup/init', apiLimiter, async (req, res) => {
    const adminSet = await db.get('SELECT value FROM settings WHERE key = "admin_user"');
    if (adminSet) return res.status(403).json({ error: 'Сервер уже настроен!' });

    const { username, password } = req.body;
    if (!username || !password || username.length < 3 || password.length < 4) {
        return res.status(400).json({ error: 'Слишком короткий логин или пароль' });
    }

    const hashedPass = await bcrypt.hash(password, 10);
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['admin_user', username]);
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['admin_pass', hashedPass]);
    res.json({ success: true });
});

app.post('/api/login', apiLimiter, async (req, res) => {
    const { username, password } = req.body;
    const dbUser = await db.get('SELECT value FROM settings WHERE key = "admin_user"');
    const dbPass = await db.get('SELECT value FROM settings WHERE key = "admin_pass"');

    if (dbUser && dbPass && username === dbUser.value) {
        if (await bcrypt.compare(password, dbPass.value)) {
            res.cookie('auth_token', SESSION_TOKEN, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
            return res.json({ success: true });
        }
    }
    res.status(401).json({ error: 'Неверный логин или пароль' });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ success: true });
});

function requireAuth(req, res, next) {
    if (req.cookies.auth_token !== SESSION_TOKEN) return res.status(401).json({ error: 'Требуется авторизация' });
    next();
}
app.use('/api/', requireAuth);

// ============================================================================
// [7] ОСНОВНЫЕ API МАРШРУТЫ
// ============================================================================

app.get('/api/games', async (req, res) => {
    try {
        const rows = await db.all('SELECT * FROM games WHERE ready = 1');
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

app.post('/api/games/:id/edit', async (req, res) => {
    const folder = path.basename(req.params.id);
    const { title, rjCode } = req.body;
    const gamePath = path.join(GAMES_DIR, folder);

    try {
        let scrapeWarning = null;
        if (title) await db.run('UPDATE games SET title = ? WHERE id = ?', [title, folder]);

        const gameObj = await db.get('SELECT title FROM games WHERE id = ?', [folder]);
        const searchTitle = title || gameObj.title; 
        const searchRj = (rjCode && rjCode.match(/RJ\d+/i)) ? rjCode.match(/RJ\d+/i)[0].toUpperCase() : null;
        let coverUpdated = false;

        if (searchRj && await fetchDLsiteCover(searchRj, path.join(gamePath, 'cover.jpg'))) {
            await db.run('UPDATE games SET cover = ? WHERE id = ?', [`${folder}/cover.jpg`, folder]);
            coverUpdated = true;
        }

        const scrapedData = await fetchUniversalMetadata(searchTitle, searchRj);
        if (scrapedData) {
            if (scrapedData.coverUrl && !coverUpdated && await downloadRemoteCover(scrapedData.coverUrl, path.join(gamePath, 'cover.jpg'))) {
                await db.run('UPDATE games SET cover = ? WHERE id = ?', [`${folder}/cover.jpg`, folder]);
                coverUpdated = true;
            }
            if (scrapedData.tags?.length > 0) {
                await db.run('UPDATE games SET tags = ?, description = ?, scraped = 1 WHERE id = ?', [JSON.stringify(scrapedData.tags), scrapedData.description, folder]);
            } else if (coverUpdated) {
                scrapeWarning = 'Обложка обновлена, но теги не найдены.';
            }
        } else if (searchRj || title) {
            scrapeWarning = 'Данные не найдены (DLsite/VNDB/Steam).';
        }

        const updatedGame = await db.get('SELECT * FROM games WHERE id = ?', [folder]);
        res.json({
            success: true, warning: scrapeWarning, title: updatedGame.title, cover: updatedGame.cover,
            tags: updatedGame.tags ? JSON.parse(updatedGame.tags) : [], description: updatedGame.description
        });
    } catch (e) { res.status(500).json({ error: 'Сбой сервера при обновлении' }); }
});

app.post('/api/games/:id/meta', async (req, res) => {
    const folder = path.basename(req.params.id);
    const { rating, lastPlayed } = req.body;

    try {
        const game = await db.get('SELECT id FROM games WHERE id = ?', [folder]);
        if (!game) return res.status(404).json({ error: 'Игра не найдена' });

        const updates = [], params = [];
        if (rating !== undefined) { updates.push('rating = ?'); params.push(rating); }
        if (lastPlayed !== undefined) { updates.push('lastPlayed = ?'); params.push(lastPlayed); }

        if (updates.length > 0) {
            params.push(folder);
            await db.run(`UPDATE games SET ${updates.join(', ')} WHERE id = ?`, params);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Ошибка сохранения метаданных' }); }
});

app.post('/api/upload', uploadLimiter, upload.single('game'), async (req, res) => {
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

        const { stdout } = await execFilePromise('7zz', ['l', '-ba', '-slt', archivePath], { maxBuffer: 200 * 1024 * 1024 });
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
        while (fs.existsSync(path.join(GAMES_DIR, finalDestFolder))) finalDestFolder = `${originalName}_${counter++}`;
        const finalPath = path.join(GAMES_DIR, finalDestFolder);

        io.emit('upload-status', { message: '📦 Сохранение в библиотеку...' });
        await execFilePromise('mv', [sourceDir, finalPath]);

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

app.delete('/api/games/:id', async (req, res) => {
    const id = path.basename(req.params.id);
    const gamePath = path.join(GAMES_DIR, id);
    
    try {
        // ⚡ ИСПРАВЛЕНИЕ: Проверяем физическое существование папки перед удалением
        await fsp.access(gamePath);
        
        await fsp.rm(gamePath, { recursive: true, force: true });
        await db.run('DELETE FROM games WHERE id = ?', [id]);
        res.json({ success: true });
    } catch(e) { 
        res.status(404).json({ error: 'Игра не найдена' }); 
    }
});

// ============================================================================
// [8] СОХРАНЕНИЯ (СИНХРОНИЗАЦИЯ, ИМПОРТ, ЭКСПОРТ)
// ============================================================================

app.get('/api/saves/:gameId', async (req, res) => {
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

app.post('/api/saves/:gameId/:key', async (req, res) => {
    if (typeof req.body.value !== 'string') return res.status(400).json({ error: 'Bad data' });
    try {
        const dir = path.join(SAVES_DIR, path.basename(req.params.gameId));
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(path.join(dir, encodeURIComponent(path.basename(req.params.key)) + '.json'), req.body.value, 'utf8');
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/saves/:gameId/:key', async (req, res) => {
    try { await fsp.unlink(path.join(SAVES_DIR, path.basename(req.params.gameId), encodeURIComponent(path.basename(req.params.key)) + '.json')); } catch(e) {}
    res.json({ success: true });
});

app.get('/api/games/:id/saves/export', async (req, res) => {
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

app.post('/api/games/:id/saves/import', uploadLimiter, upload.single('saves'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
    if (req.file.size > 50 * 1024 * 1024) {
        await fsp.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: 'Архив слишком большой' });
    }

    const gameSavesDir = path.join(SAVES_DIR, path.basename(req.params.id));
    const archivePath = req.file.path;

    try {
        await fsp.mkdir(gameSavesDir, { recursive: true });
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
            if ((await fsp.stat(filePath)).isDirectory()) {
                await fsp.rm(filePath, { recursive: true, force: true }).catch(() => {});
                continue;
            }

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

// ============================================================================
// [9] АУДИО КОНВЕРТЕР И ДЕКРИПТОР
// ============================================================================

async function decryptRpgmvo(filePath, gamePath) {
    const fileData = await fsp.readFile(filePath);
    if (fileData.slice(0, 4).toString('ascii') !== 'RPGM') return fileData;

    let encKey = '';
    try {
        let sysPath = path.join(gamePath, 'data', 'System.json');
        if (!fs.existsSync(sysPath)) sysPath = path.join(gamePath, 'www', 'data', 'System.json');
        encKey = JSON.parse(await fsp.readFile(sysPath, 'utf8')).encryptionKey || '';
    } catch(e) {}

    const keyBytes = [];
    for (let i = 0; i < encKey.length; i += 2) keyBytes.push(parseInt(encKey.substr(i, 2), 16));

    const out = Buffer.from(fileData.subarray(16));
    if (keyBytes.length === 0) return out;

    for (let i = 0; i < 16 && i < out.length; i++) out[i] ^= keyBytes[i % keyBytes.length];
    return out;
}

async function ensureM4aFromSource(sourcePath, gamePath) {
    const stat = await fsp.stat(sourcePath);
    const cacheKey = crypto.createHash('sha1').update(sourcePath + '|' + stat.mtimeMs).digest('hex');
    const outPath = path.join(AUDIOCACHE, cacheKey + '.m4a');
    
    try { await fsp.access(outPath); return outPath; } catch {} 

    const ext = path.extname(sourcePath).toLowerCase();
    if (ext === '.m4a') return sourcePath;
    if (ext === '.rpgmvm') {
        await fsp.writeFile(outPath, await decryptRpgmvo(sourcePath, gamePath));
        return outPath;
    }

    const tmpIn = path.join(EXTRACT_TMP, cacheKey + (ext === '.rpgmvo' ? '.ogg' : ext));
    await fsp.writeFile(tmpIn, ext === '.rpgmvo' ? await decryptRpgmvo(sourcePath, gamePath) : await fsp.readFile(sourcePath));

    try {
        await execFilePromise('ffmpeg', ['-y', '-i', tmpIn, '-vn', '-c:a', 'aac', '-b:a', '128k', outPath]);
        return outPath;
    } finally {
        await fsp.unlink(tmpIn).catch(() => {});
    }
}

// ============================================================================
// [10] ГЛОБАЛЬНЫЙ РОУТИНГ (СТАТИКА И ЗВУК)
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
                        const readyPath = await ensureM4aFromSource(sourcePath, path.join(GAMES_DIR, gameFolder));
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
                html = html.replace(/(<body[^>]*>)/i, '$1<script src="/rpg-fixes.js"></script>');
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
    initDB().then(async () => {
        await syncDatabase();

        const srv = server.listen(3000, () => console.log('🚀 RPG API: SQLite и WebSockets подключены, сервер готов!'));
        srv.timeout = 0; srv.requestTimeout = 0; srv.keepAliveTimeout = 0;

        let syncTimer = null;
        let syncInProgress = false;
        let pendingSync = false;
        let lastReadyCount = (await db.get('SELECT COUNT(*) as c FROM games WHERE ready = 1'))?.c || 0;

        async function runSyncSafely(reason = 'watcher') {
            if (syncInProgress) { pendingSync = true; return; }
            syncInProgress = true;
            try {
                await syncDatabase();
                const newReadyCount = (await db.get('SELECT COUNT(*) as c FROM games WHERE ready = 1'))?.c || 0;
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

module.exports = { app, requireAuth, processParsedData, findRJCode, translateText };