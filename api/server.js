require('dotenv').config();
const express = require('express');
const compression = require('compression');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const multer = require('multer');
const util = require('util');
const { execFile } = require('child_process');
const execFilePromise = util.promisify(execFile);
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// ⚡ ПОДКЛЮЧАЕМ SQLITE
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

puppeteer.use(StealthPlugin());

const app = express();
app.use(compression());
const GAMES_DIR = '/games';
const UPLOAD_TMP = '/tmp/rpg-uploads';
const SAVES_DIR = path.join(GAMES_DIR, '_saves'); 
const API_TOKEN = process.env.API_TOKEN || 'SuperSecretKey123'; 

let db; // Глобальная переменная для базы данных

fsp.mkdir(UPLOAD_TMP, { recursive: true }).catch(() => {});
fsp.mkdir(SAVES_DIR, { recursive: true }).catch(() => {});

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '50mb' }));

const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, message: { error: 'Слишком много запросов' }});
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: 'Слишком много загрузок' }});
app.use('/api/', apiLimiter);

function requireAuth(req, res, next) {
    if (req.method === 'GET') return next(); 
    if (req.headers['x-api-token'] !== API_TOKEN) {
        console.log(`[Security] 🛑 Заблокирована попытка доступа (${req.method} ${req.path}). IP: ${req.ip}`);
        return res.status(401).json({ error: 'Отказано в доступе. Неверный токен.' });
    }
    next();
}
app.use('/api/', requireAuth);

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, UPLOAD_TMP); },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname) || '';
        cb(null, 'archive_' + Date.now() + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.originalname.match(/\.(zip|7z|rar)$/i)) cb(null, true);
        else cb(new Error('Поддерживаются только ZIP, 7z и RAR!'));
    }
});

function escapeHtml(unsafe) {
    return (unsafe || '').toString().replace(/[&<"'>]/g, function(m) {
        switch (m) {
            case '&': return '&amp;'; case '<': return '&lt;'; case '>': return '&gt;';
            case '"': return '&quot;'; case "'": return '&#039;'; default: return m;
        }
    });
}

async function findGameFolder(dir, depth = 0) {
    if (depth > 10) return null; 
    const items = await fsp.readdir(dir, { withFileTypes: true });
    const wwwFolder = items.find(i => i.isDirectory() && i.name.toLowerCase() === 'www');
    if (wwwFolder) return path.join(dir, wwwFolder.name);
    const hasIndexHtml = items.some(i => i.isFile() && i.name.toLowerCase() === 'index.html');
    if (hasIndexHtml) return dir;
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

async function fetchDLsiteCover(rjCode, destPath) {
    const numStr = rjCode.replace(/RJ/i, '');
    const num = parseInt(numStr, 10);
    const dirNum = Math.ceil(num / 1000) * 1000;
    const dirStr = 'RJ' + String(dirNum).padStart(numStr.length, '0');
    const urls = [
        `https://img.dlsite.jp/modpub/images2/work/doujin/${dirStr}/${rjCode}_img_main.jpg`,
        `https://img.dlsite.jp/modpub/images2/work/professional/${dirStr}/${rjCode}_img_main.jpg`
    ];
    for (const url of urls) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (res.ok) {
                const buffer = await res.arrayBuffer();
                await fsp.writeFile(destPath, Buffer.from(buffer));
                return true; 
            }
        } catch (e) {}
    }
    return false;
}

// =====================================================================
// DLsite Tags & Translate
// =====================================================================
const backgroundScrapeQueue = [];
const queuedScrapes = new Set();
let isBackgroundScraping = false;

async function translateText(text, targetLang = 'en') {
    if (!text) return '';
    try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`);
        const data = await res.json();
        return data[0].map(item => item[0]).join(''); 
    } catch (e) {
        console.error('[Translate Error]', e.message);
        return text; 
    }
}

async function processBackgroundScrape() {
    if (isBackgroundScraping) return; 
    if (backgroundScrapeQueue.length === 0) {
        console.log(`[Queue] ✅ Очередь пуста. Все задачи выполнены.`);
        return;
    }

    isBackgroundScraping = true;
    const task = backgroundScrapeQueue.shift();
    console.log(`\n[Queue] 🚀 Запускаем парсинг для ${task.rjCode} (Осталось в очереди: ${backgroundScrapeQueue.length})`);
    
    try {
        const scrapedData = await executeFetchDLsiteTags(task.rjCode);
        if (scrapedData && scrapedData.tags && scrapedData.tags.length > 0) {
            
            // ⚡ ТЕПЕРЬ СОХРАНЯЕМ ДАННЫЕ СРАЗУ В БАЗУ ДАННЫХ, А НЕ В ФАЙЛ
            await db.run(
                'UPDATE games SET tags = ?, description = ?, scraped = 1 WHERE id = ?',
                [JSON.stringify(scrapedData.tags), scrapedData.description, task.folder]
            );
            console.log(`[Queue] 💾 Теги и Описание для ${task.rjCode} успешно сохранены в БД!`);
            
        } else {
            console.log(`[Queue] ⚠️ Парсер вернул пустоту для ${task.rjCode}`);
        }
    } catch (e) {
        console.error(`[Queue] 🚫 Ошибка парсинга ${task.rjCode}:`, e.message);
    } finally {
        queuedScrapes.delete(task.rjCode); 
        isBackgroundScraping = false;
        processBackgroundScrape();
    }
}

const MAX_PROXY_ATTEMPTS = 5;
const DL_PAGE_TIMEOUT_MS = 25000;
const DL_AJAX_TIMEOUT_MS = 8000;
const PROXY_TTL_MS = 30 * 60 * 1000; 
const TAGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; 

const dlsiteTagCache = new Map(); 
const proxyPool = new Map();      

function nowMs() { return Date.now(); }

function cleanupProxyPool() {
    const now = nowMs();
    for (const [proxy, meta] of proxyPool.entries()) {
        if (now - meta.lastUsed > PROXY_TTL_MS) proxyPool.delete(proxy);
    }
}

function updateProxyScore(proxy, isSuccess) {
    if (!proxy || proxy === 'direct') return;
    const meta = proxyPool.get(proxy) || { score: 0, fails: 0, lastUsed: nowMs() };
    meta.lastUsed = nowMs();
    if (isSuccess) { meta.score += 3; meta.fails = 0; } 
    else { meta.score -= 2; meta.fails += 1; }
    if (meta.fails >= 2 || meta.score <= -3) proxyPool.delete(proxy);
    else proxyPool.set(proxy, meta);
}

async function getPublicJapaneseProxies() {
    try {
        const res = await fetch('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=JP');
        if (!res.ok) throw new Error('Proxy API error');
        const text = await res.text();
        return text.split('\n').map(p => p.trim()).filter(p => p.includes(':')).sort(() => Math.random() - 0.5); 
    } catch (e) { return []; }
}

function buildProxyCandidates(publicList) {
    cleanupProxyPool();
    const remembered = [...proxyPool.entries()].sort((a, b) => b[1].score - a[1].score).map(entry => entry[0]);
    const trustedProxy = process.env.DLSITE_JP_PROXY || null;
    let candidates = new Set();
    if (trustedProxy) candidates.add(trustedProxy);
    remembered.forEach(p => candidates.add(p));
    publicList.forEach(p => candidates.add(p));
    if (candidates.size === 0) candidates.add('direct');
    return Array.from(candidates).slice(0, MAX_PROXY_ATTEMPTS);
}

async function executeFetchDLsiteTags(rjCode) {
    const cached = dlsiteTagCache.get(rjCode);
    if (cached && cached.expiresAt > nowMs()) return cached.data; 

    const publicList = await getPublicJapaneseProxies();
    const candidates = buildProxyCandidates(publicList);

    for (let i = 0; i < candidates.length; i++) {
        const proxy = candidates[i];
        let browser;
        try {
            const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--lang=en-US'];
            if (proxy !== 'direct') args.push(`--proxy-server=http://${proxy}`);

            browser = await puppeteer.launch({ headless: "new", executablePath: '/usr/bin/chromium', args });
            const page = await browser.newPage();
            page.setDefaultNavigationTimeout(DL_PAGE_TIMEOUT_MS);

            await page.setCookie({ name: 'adultchecked', value: '1', domain: '.dlsite.com', path: '/' });
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
                else req.continue();
            });

            const url = `https://www.dlsite.com/maniax/work/=/product_id/${rjCode}.html?locale=en_US`;
            await page.goto(url, { waitUntil: 'domcontentloaded' });
            const pageTitle = await page.title();
            
            if (!pageTitle.includes('DLsite') || pageTitle.includes('Google') || pageTitle === '') throw new Error('Blocked');

            const scrapedData = await page.evaluate(async (rj, timeout) => {
                let tags = [];
                let description = '';
                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), timeout);
                    const apiRes = await fetch(`https://www.dlsite.com/maniax/product/info/ajax?product_id=${rj}`, { signal: controller.signal });
                    clearTimeout(timer);
                    const data = await apiRes.json();
                    if (data && data[rj] && data[rj].genres) tags = data[rj].genres.map(g => g.name);
                } catch (e) {}
                
                if (tags.length === 0) {
                    const genreLinks = Array.from(document.querySelectorAll('a[href*="/genre/"]'));
                    tags = genreLinks.map(el => el.innerText.trim()).filter(text => text.length > 0);
                }
                const descEl = document.querySelector('[itemprop="description"]') || document.querySelector('.work_parts_area');
                if (descEl) description = descEl.innerText.trim();
                return { tags, description };
            }, rjCode, DL_AJAX_TIMEOUT_MS); 

            if (scrapedData && scrapedData.tags && scrapedData.tags.length > 0) {
                const uniqueTags = [...new Set(scrapedData.tags)];
                console.log(`[DLsite] 🌐 Переводим описание для ${rjCode} на английский...`);
                const translatedDesc = await translateText(scrapedData.description, 'en');
                const finalData = { tags: uniqueTags, description: translatedDesc };
                
                updateProxyScore(proxy, true); 
                dlsiteTagCache.set(rjCode, { data: finalData, expiresAt: nowMs() + TAGS_CACHE_TTL_MS }); 
                await browser.close();
                return finalData;
            } else {
                throw new Error('Soft-Lock');
            }
        } catch (error) {
            updateProxyScore(proxy, false); 
            if (browser) await browser.close();
        }
    }
    return null;
}

// =====================================================================
// ⚡ НОВОЕ: Инициализация БД и Синхронизация папок
// =====================================================================
async function initDB() {
    // База данных будет лежать в папке games, чтобы не удаляться при перезапуске Докера
    db = await open({ filename: path.join(GAMES_DIR, 'library.db'), driver: sqlite3.Database });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS games (
            id TEXT PRIMARY KEY,
            title TEXT,
            cover TEXT,
            tags TEXT,
            description TEXT,
            rating INTEGER DEFAULT 0,
            lastPlayed INTEGER DEFAULT 0,
            addedAt INTEGER DEFAULT 0,
            scraped INTEGER DEFAULT 0
        )
    `);
}

async function syncDatabase() {
    console.log('[DB] 🔄 Синхронизация диска с SQLite базой данных...');
    const entries = await fsp.readdir(GAMES_DIR);
    const existingGames = await db.all('SELECT id FROM games');
    const dbIds = existingGames.map(g => g.id);

    for (const folder of entries) {
        const gamePath = path.join(GAMES_DIR, folder);
        let stat;
        try { stat = await fsp.stat(gamePath); } catch(e) { continue; }
        
        if (!stat.isDirectory() || folder === 'node_modules' || folder === '_saves') continue;

        if (!dbIds.includes(folder)) {
            console.log(`[DB] ➕ Найдена новая игра на диске: ${folder}`);
            
            // Пытаемся вытащить имя из файлов движка
            let title = folder.replace(/\[?RJ\d{6,8}\]?/gi, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim() || folder;
            try {
                const sysRaw = await fsp.readFile(path.join(gamePath, 'data', 'System.json'), 'utf8');
                const sys = JSON.parse(sysRaw);
                if (sys.gameTitle && !sys.gameTitle.toLowerCase().includes('rmmz')) title = sys.gameTitle;
            } catch(e) {}

            if (title === folder) {
                try {
                    const pkgRaw = await fsp.readFile(path.join(gamePath, 'package.json'), 'utf8');
                    let pName = JSON.parse(pkgRaw).productName || JSON.parse(pkgRaw).name;
                    if (pName && !pName.toLowerCase().includes('rmmz')) title = pName;
                } catch(e) {}
            }

            // Ищем обложку
            let cover = null;
            const checkExists = async (p) => { try { await fsp.access(p); return true; } catch { return false; } };
            if (await checkExists(path.join(gamePath, 'cover.jpg'))) cover = `${folder}/cover.jpg`;
            else if (await checkExists(path.join(gamePath, 'cover.png'))) cover = `${folder}/cover.png`;

            // ⚡ МИГРАЦИЯ: Если есть старый meta.json, переносим его в БД!
            let tags = [], description = '', rating = 0, lastPlayed = 0, scraped = 0;
            try {
                const oldMeta = JSON.parse(await fsp.readFile(path.join(gamePath, 'meta.json'), 'utf8'));
                if (oldMeta.tags) tags = oldMeta.tags;
                if (oldMeta.description) description = oldMeta.description;
                if (oldMeta.rating) rating = oldMeta.rating;
                if (oldMeta.lastPlayed) lastPlayed = oldMeta.lastPlayed;
                if (oldMeta.scraped) scraped = 1;
                if (oldMeta.title && title === folder) title = oldMeta.title;
            } catch(e) {}

            const rjCode = await findRJCode(folder, gamePath);
            if (rjCode && !cover) {
                const success = await fetchDLsiteCover(rjCode, path.join(gamePath, 'cover.jpg'));
                if (success) cover = `${folder}/cover.jpg`;
            }

            if (!cover) {
                const titles1Path = path.join(gamePath, 'img', 'titles1');
                if (await checkExists(titles1Path)) {
                    const validFiles = (await fsp.readdir(titles1Path)).filter(f => f.match(/\.(png|jpg|jpeg)$/i));
                    if (validFiles.length > 0) cover = `${folder}/img/titles1/${validFiles[0]}`;
                }
                if (!cover && await checkExists(path.join(gamePath, 'icon', 'icon.png'))) cover = `${folder}/icon/icon.png`;
            }

            // Добавляем запись в SQLite
            await db.run(`
                INSERT INTO games (id, title, cover, tags, description, rating, lastPlayed, addedAt, scraped)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [folder, title, cover, JSON.stringify(tags), description, rating, lastPlayed, stat.birthtimeMs || stat.mtimeMs || Date.now(), scraped]);

            // Если тегов нет, отправляем в очередь
            if (rjCode && tags.length === 0 && !queuedScrapes.has(rjCode)) {
                queuedScrapes.add(rjCode);
                backgroundScrapeQueue.push({ rjCode, folder });
                processBackgroundScrape();
            }
        }
    }

    // Удаляем из БД игры, чьи папки были физически удалены с диска
    for (const id of dbIds) {
        if (!entries.includes(id)) {
            console.log(`[DB] 🗑️ Папка не найдена, удаляем из БД: ${id}`);
            await db.run('DELETE FROM games WHERE id = ?', [id]);
        }
    }
    console.log('[DB] ✅ Синхронизация завершена!');
}

// =====================================================================
// ⚡ ОБНОВЛЕННЫЕ API МАРШРУТЫ (РАБОТАЮТ ЧЕРЕЗ БД)
// =====================================================================
app.get('/api/games', async (req, res) => {
    console.log(`[API] 📥 Отдаем список игр из SQLite...`);
    try {
        const rows = await db.all('SELECT * FROM games');
        const games = rows.map(row => ({
            id: row.id, title: row.title, cover: row.cover,
            tags: row.tags ? JSON.parse(row.tags) : [],
            description: row.description, url: `/${row.id}/`, number: 0,
            addedAt: row.addedAt, lastPlayed: row.lastPlayed, rating: row.rating
        }));
        
        // Присваиваем номера томов на лету
        games.sort((a,b) => a.addedAt - b.addedAt).forEach((g, i) => g.number = i + 1);
        
        res.json(games);
    } catch (e) { 
        console.error(`[API] ❌ ОШИБКА БД:`, e);
        res.status(500).json({ error: 'Внутренняя ошибка базы данных' }); 
    }
});

app.post('/api/games/:id/meta', async (req, res) => {
    const id = path.basename(req.params.id);
    try {
        const updates = [];
        const params = [];
        if (typeof req.body.rating === 'number') {
            updates.push('rating = ?'); 
            params.push(Math.max(0, Math.min(5, req.body.rating)));
        }
        if (typeof req.body.lastPlayed === 'number') {
            updates.push('lastPlayed = ?'); 
            params.push(req.body.lastPlayed);
        }
        
        if (updates.length > 0) {
            params.push(id);
            await db.run(`UPDATE games SET ${updates.join(', ')} WHERE id = ?`, params);
        }
        res.json({ success: true });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: 'Ошибка БД' }); 
    }
});

app.post('/api/upload', uploadLimiter, upload.single('game'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
    console.log(`[Upload] 📥 Принят архив: ${req.file.originalname}`);
    
    const archivePath = req.file.path; 
    let originalName = req.file.originalname.replace(/\.(zip|7z|rar)$/i, '').replace(/[^\w\s\-\.а-яА-Я\[\]]/g, '_').trim();
    if (!originalName) originalName = 'game_archive';

    const tmpExtractDir = path.join(UPLOAD_TMP, 'ext_' + Date.now());
    const isRar = archivePath.toLowerCase().endsWith('.rar'); 

    try {
        await fsp.mkdir(tmpExtractDir, { recursive: true });
        
        if (isRar) await execFilePromise('unrar', ['x', '-y', archivePath, tmpExtractDir + '/']);
        else {
            const { stdout } = await execFilePromise('7zz', ['l', '-ba', '-slt', archivePath]);
            const lines = stdout.split('\n').filter(l => l.startsWith('Path = '));
            for (const line of lines) {
                const entryPath = path.resolve(tmpExtractDir, line.replace('Path = ', '').trim());
                if (!entryPath.startsWith(path.resolve(tmpExtractDir) + path.sep)) throw new Error('Zip Slip');
            }
            await execFilePromise('7zz', ['x', archivePath, `-o${tmpExtractDir}`, '-y']);
        }
        
        let sourceDir = await findGameFolder(tmpExtractDir);
        if (!sourceDir) throw new Error("Не найдена папка 'www'");
        
        let finalDestFolder = originalName;
        let counter = 1;
        while (fs.existsSync(path.join(GAMES_DIR, finalDestFolder))) { finalDestFolder = `${originalName}_${counter}`; counter++; }
        const finalPath = path.join(GAMES_DIR, finalDestFolder);
        
        await execFilePromise('chmod', ['-R', '755', sourceDir]);
        await fsp.cp(sourceDir, finalPath, { recursive: true });
        
        // ⚡ После загрузки просим сервер проверить новую папку и добавить в БД
        await syncDatabase(); 

        await fsp.rm(tmpExtractDir, { recursive: true, force: true }).catch(() => {});
        await fsp.unlink(archivePath).catch(() => {});
        res.json({ success: true, folder: finalDestFolder, message: `Игра "${finalDestFolder}" добавлена!` });
    } catch (e) {
        console.error('[Upload Error]:', e.message ? e.message.substring(0, 300) + '...' : e);
        await fsp.rm(tmpExtractDir, { recursive: true, force: true }).catch(() => {});
        await fsp.unlink(archivePath).catch(() => {});
        res.status(500).json({ error: 'Ошибка загрузки или неподдерживаемый архив' });
    }
});

app.delete('/api/games/:id', async (req, res) => {
    const id = path.basename(req.params.id);
    const gamePath = path.join(GAMES_DIR, id);
    try {
        await fsp.access(gamePath);
        await fsp.rm(gamePath, { recursive: true, force: true });
        await db.run('DELETE FROM games WHERE id = ?', [id]); // Удаляем из БД
        res.json({ success: true });
    } catch(e) { res.status(404).json({ error: 'Игра не найдена' }); }
});

// Сохранения остаются в файлах, так как это огромные JSON-строки
app.get('/api/saves/:gameId', async (req, res) => {
    const gameId = path.basename(req.params.gameId);
    const gameSavesDir = path.join(SAVES_DIR, gameId);
    try {
        const files = await fsp.readdir(gameSavesDir);
        const saves = {};
        for (const file of files) {
            if (file.endsWith('.json')) {
                saves[decodeURIComponent(file.replace('.json', ''))] = await fsp.readFile(path.join(gameSavesDir, file), 'utf8');
            }
        }
        res.json(saves);
    } catch(e) { res.json({}); }
});

app.post('/api/saves/:gameId/:key', async (req, res) => {
    const gameId = path.basename(req.params.gameId);
    const key = path.basename(req.params.key); 
    const gameSavesDir = path.join(SAVES_DIR, gameId);
    const value = req.body.value;
    if (typeof value !== 'string') return res.status(400).json({ error: 'Bad data' });
    try {
        await fsp.mkdir(gameSavesDir, { recursive: true });
        await fsp.writeFile(path.join(gameSavesDir, encodeURIComponent(key) + '.json'), value, 'utf8');
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/saves/:gameId/:key', async (req, res) => {
    const gameId = path.basename(req.params.gameId);
    const key = path.basename(req.params.key);
    try {
        await fsp.unlink(path.join(SAVES_DIR, gameId, encodeURIComponent(key) + '.json'));
        res.json({ success: true });
    } catch(e) { res.json({ success: true }); }
});

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
        let stat;
        try { stat = await fsp.stat(filePath); } catch(e) {}

        if (stat && stat.isDirectory()) {
            if (!req.path.endsWith('/')) return res.redirect(req.path + '/');
            let hasRoot = false, hasWww = false;
            try { await fsp.access(path.join(filePath, 'index.html')); hasRoot = true; } catch(e) {}
            if (hasRoot) {
                reqPath += 'index.html'; filePath = path.join(filePath, 'index.html');
            } else {
                try { await fsp.access(path.join(filePath, 'www', 'index.html')); hasWww = true; } catch(e) {}
                if (hasWww) return res.redirect(req.path + 'www/');
                else {
                    const deepDir = await findGameFolder(filePath);
                    if (deepDir) return res.redirect('/' + path.relative(GAMES_DIR, deepDir).replace(/\\/g, '/') + '/');
                    return res.status(404).send(`<div style="color:red; text-align:center; padding:50px;">Магия рассеялась... index.html не найден.</div>`);
                }
            }
        }

        if (reqPath.endsWith('.ogg')) {
            try { await fsp.access(filePath); } catch {
                try { await fsp.access(filePath + '_'); filePath += '_'; } catch {
                    try { const p = filePath.replace(/\.ogg$/, '.rpgmvo'); await fsp.access(p); filePath = p; } catch {}
                }
            }
        } else if (reqPath.endsWith('.m4a')) {
            try { await fsp.access(filePath); } catch {
                try { await fsp.access(filePath + '_'); filePath += '_'; } catch {
                    try { const p = filePath.replace(/\.m4a$/, '.rpgmvm'); await fsp.access(p); filePath = p; } catch {}
                }
            }
        }

        let finalStat;
        try { finalStat = await fsp.stat(filePath); } catch(e) {}

        if (finalStat && finalStat.isFile()) {
            if (filePath.endsWith('index.html')) {
                let html = await fsp.readFile(filePath, 'utf8');
                html = html.replace(/<meta[^>]+http-equiv=['"]?Content-Security-Policy['"]?[^>]*>/gi, '');
                html = html.replace('<body', '<body><script src="/rpg-fixes.js"></script><x ');
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

// ⚡ ЗАПУСК СЕРВЕРА С БАЗОЙ ДАННЫХ
initDB().then(async () => {
    await syncDatabase();
    app.listen(3000, () => console.log('🚀 RPG API: SQLite подключен, сервер готов!'));
}).catch(console.error);