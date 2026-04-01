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

puppeteer.use(StealthPlugin());

const app = express();
app.use(compression());
const GAMES_DIR = '/games';
const UPLOAD_TMP = '/tmp/rpg-uploads';
const SAVES_DIR = path.join(GAMES_DIR, '_saves'); 
const API_TOKEN = process.env.API_TOKEN || 'SuperSecretKey123'; // Токен для защиты API

fsp.mkdir(UPLOAD_TMP, { recursive: true }).catch(() => {});
fsp.mkdir(SAVES_DIR, { recursive: true }).catch(() => {});

// Базовая безопасность HTTP-заголовков
app.use(helmet({
    contentSecurityPolicy: false, // Отключаем CSP, так как RPG Maker игры используют eval() и инлайн-скрипты
    crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: '50mb' }));

// Лимиты запросов (защита от DDoS и брутфорса)
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, message: { error: 'Слишком много запросов' }});
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: 'Слишком много загрузок' }});
app.use('/api/', apiLimiter);

// Middleware авторизации для изменяющих запросов (POST, DELETE)
function requireAuth(req, res, next) {
    if (req.method === 'GET') return next(); // Читать можно всем
    
    if (req.headers['x-api-token'] !== API_TOKEN) {
        console.log(`[Security] 🛑 Заблокирована попытка доступа (${req.method} ${req.path}). IP: ${req.ip}`);
        return res.status(401).json({ error: 'Отказано в доступе. Неверный токен.' });
    }
    next();
}
app.use('/api/', requireAuth);

// ⚡ Умное сохранение с расширением файла
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_TMP);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname) || '';
        cb(null, 'archive_' + Date.now() + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // Лимит 5 ГБ
    fileFilter: (req, file, cb) => {
        if (file.originalname.match(/\.(zip|7z|rar)$/i)) cb(null, true);
        else cb(new Error('Поддерживаются только ZIP, 7z и RAR!'));
    }
});

function escapeHtml(unsafe) {
    return (unsafe || '').toString().replace(/[&<"'>]/g, function(m) {
        switch (m) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#039;';
            default: return m;
        }
    });
}

// Защита от Stack Overflow: ограничение глубины рекурсии (depth)
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
// DLsite Tags: Фоновая очередь
// =====================================================================
const backgroundScrapeQueue = [];
const queuedScrapes = new Set();
let isBackgroundScraping = false;

async function processBackgroundScrape() {
    if (isBackgroundScraping) return; // Если уже работает, тихо ждем
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
            let meta = {};
            try {
                const metaRaw = await fsp.readFile(task.metaPath, 'utf8');
                meta = JSON.parse(metaRaw);
            } catch(e) {}
            
            meta.tags = scrapedData.tags;
            meta.description = scrapedData.description; // ⚡ ДОБАВЛЯЕМ ОПИСАНИЕ
            meta.scraped = true;
            await fsp.writeFile(task.metaPath, JSON.stringify(meta, null, 2), 'utf8');
            console.log(`[Queue] 💾 Теги и Описание для ${task.rjCode} успешно сохранены!`);
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

// =====================================================================
// DLsite Tags: Умный пул прокси + Кэширование
// =====================================================================
const MAX_PROXY_ATTEMPTS = 5;
const DL_PAGE_TIMEOUT_MS = 25000;
const DL_AJAX_TIMEOUT_MS = 8000;
const PROXY_TTL_MS = 30 * 60 * 1000; 
const TAGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // Кэш тегов на 24 часа

const dlsiteTagCache = new Map(); // rjCode -> { data, expiresAt }
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

// ⚡ Бесплатный переводчик через неофициальное API Google Translate
async function translateText(text, targetLang = 'en') {
    if (!text) return '';
    try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`);
        const data = await res.json();
        return data[0].map(item => item[0]).join(''); // Склеиваем переведенные абзацы
    } catch (e) {
        console.error('[Translate Error]', e.message);
        return text; // Если Гугл заблокировал запрос, отдаем оригинальный японский текст
    }
}

async function executeFetchDLsiteTags(rjCode) {
    const cached = dlsiteTagCache.get(rjCode);
    if (cached && cached.expiresAt > nowMs()) {
        return cached.data; // ⚡ Возвращаем сохраненную data (теги + описание)
    }

    const publicList = await getPublicJapaneseProxies();
    const candidates = buildProxyCandidates(publicList);

    for (let i = 0; i < candidates.length; i++) {
        const proxy = candidates[i];
        let browser;
        try {
            const args = [
                '--no-sandbox', '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', '--disable-gpu', '--lang=en-US'
            ];
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
            
            if (!pageTitle.includes('DLsite') || pageTitle.includes('Google') || pageTitle === '') {
                throw new Error('Blocked');
            }

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

                // Ищем описание на странице DLsite
                const descEl = document.querySelector('[itemprop="description"]') || document.querySelector('.work_parts_area');
                if (descEl) description = descEl.innerText.trim();

                return { tags, description };
            }, rjCode, DL_AJAX_TIMEOUT_MS); 

            if (scrapedData && scrapedData.tags && scrapedData.tags.length > 0) {
                const uniqueTags = [...new Set(scrapedData.tags)];
                
                // ⚡ ИЗМЕНЕНИЕ: Отправляем текст в Google Translate
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

async function getGameMetadata(folder, gamePath) {
    console.log(`[API] 🔍 Читаем папку: ${folder}`);
    const metaPath = path.join(gamePath, 'meta.json');
    const checkExists = async (p) => { try { await fsp.access(p); return true; } catch { return false; } };

    let existingMeta = {};
    try {
        if (await checkExists(metaPath)) {
            const metaRaw = await fsp.readFile(metaPath, 'utf8');
            existingMeta = JSON.parse(metaRaw);
            
            if (existingMeta.scraped && existingMeta.tags && existingMeta.tags.length > 0) {
                console.log(`[API] ⏩ ${folder} уже имеет теги, пропускаем.`);
                return existingMeta;
            }
        }
    } catch(e) {
        console.log(`[API] ⚠️ Ошибка чтения meta.json для ${folder}:`, e.message);
    }

    let title = null;
    try {
        const sysRaw = await fsp.readFile(path.join(gamePath, 'data', 'System.json'), 'utf8');
        const sys = JSON.parse(sysRaw);
        if (sys.gameTitle && !sys.gameTitle.toLowerCase().includes('rmmz') && !sys.gameTitle.toLowerCase().includes('rpgmaker')) {
            title = sys.gameTitle;
        }
    } catch(e) {}

    if (!title) {
        try {
            const pkgRaw = await fsp.readFile(path.join(gamePath, 'package.json'), 'utf8');
            const pkg = JSON.parse(pkgRaw);
            let pName = pkg.productName || pkg.name;
            if (pName && !pName.toLowerCase().includes('rmmz') && pName.toLowerCase() !== 'rpgmaker') title = pName;
        } catch(e) {}
    }

    if (!title) {
        title = folder.replace(/\[?RJ\d{6,8}\]?/gi, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!title || title.toLowerCase() === 'game') title = folder;
    }

    let cover = null;
    let tags = existingMeta.tags || []; 

    if (await checkExists(path.join(gamePath, 'cover.jpg'))) cover = `${folder}/cover.jpg`;
    else if (await checkExists(path.join(gamePath, 'cover.png'))) cover = `${folder}/cover.png`;

    const rjCode = await findRJCode(folder, gamePath);
    
    if (rjCode) {
        console.log(`[API] 🏷️ Найден RJ-код: ${rjCode} (для папки ${folder})`);
        if (!cover) {
            const coverDest = path.join(gamePath, 'cover.jpg');
            const success = await fetchDLsiteCover(rjCode, coverDest);
            if (success) cover = `${folder}/cover.jpg`;
        }
        
        if (tags.length === 0 && !queuedScrapes.has(rjCode)) {
            console.log(`[Queue] ➕ Добавляем ${rjCode} в очередь.`);
            queuedScrapes.add(rjCode);
            backgroundScrapeQueue.push({ rjCode, metaPath });
            processBackgroundScrape();
        } else if (queuedScrapes.has(rjCode)) {
            console.log(`[Queue] ⏳ ${rjCode} уже стоит в очереди.`);
        }
    } else {
        console.log(`[API] ❓ RJ-код не найден для ${folder}. Парсинг пропущен.`);
    }

    if (!cover) {
        const titles1Path = path.join(gamePath, 'img', 'titles1');
        if (await checkExists(titles1Path)) {
            const titleFiles = await fsp.readdir(titles1Path);
            const validFiles = titleFiles.filter(f => f.match(/\.(png|jpg|jpeg)$/i));
            if (validFiles.length > 0) cover = `${folder}/img/titles1/${validFiles[0]}`;
        }
        if (!cover && await checkExists(path.join(gamePath, 'icon', 'icon.png'))) cover = `${folder}/icon/icon.png`;
    }

    const finalMeta = { ...existingMeta, title, cover, tags, scraped: (tags && tags.length > 0) };
    await fsp.writeFile(metaPath, JSON.stringify(finalMeta, null, 2), 'utf8').catch(()=>{});
    return finalMeta;
}

app.get('/api/games', async (req, res) => {
    console.log(`\n[API] 📥 Получен запрос списка игр от фронтенда!`);
    try {
        const entries = await fsp.readdir(GAMES_DIR);
        const games = [];
        for (let i = 0; i < entries.length; i++) {
            const folder = entries[i];
            const gamePath = path.join(GAMES_DIR, folder);
            try {
                const stat = await fsp.stat(gamePath);
                if (!stat.isDirectory() || folder === 'node_modules' || folder === '_saves') continue;

                const meta = await getGameMetadata(folder, gamePath);
                games.push({ 
                    id: folder, title: meta.title, cover: meta.cover, tags: meta.tags || [], 
                    description: meta.description || '', // ⚡ ОТПРАВЛЯЕМ ОПИСАНИЕ НА ФРОНТ
                    url: `/${folder}/`, number: games.length + 1, addedAt: stat.birthtimeMs || stat.mtimeMs || 0,
                    lastPlayed: meta.lastPlayed || 0, rating: meta.rating || 0
                });
            } catch(e) {
                console.error(`[API] ❌ Ошибка в папке ${folder}:`, e.message); 
            }
        }
        console.log(`[API] 📤 Отправляем ${games.length} игр на фронтенд.`);
        res.json(games);
    } catch (e) { 
        console.error(`[API] ❌ КРИТИЧЕСКАЯ ОШИБКА:`, e);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' }); 
    }
});

app.post('/api/games/:id/meta', async (req, res) => {
    const id = path.basename(req.params.id).replace(/[^a-zA-Z0-9а-яА-Я._\-\s\[\]]/g, '');
    const metaPath = path.join(GAMES_DIR, id, 'meta.json');
    try {
        let meta = {};
        try {
            const metaRaw = await fsp.readFile(metaPath, 'utf8');
            meta = JSON.parse(metaRaw);
        } catch(e) {}

        if (typeof req.body.rating === 'number') meta.rating = Math.max(0, Math.min(5, req.body.rating));
        if (typeof req.body.lastPlayed === 'number') meta.lastPlayed = req.body.lastPlayed;
        meta.scraped = true; 

        await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
        res.json({ success: true });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' }); 
    }
});

app.get('/api/saves/:gameId', async (req, res) => {
    const gameId = path.basename(req.params.gameId).replace(/[^a-zA-Z0-9а-яА-Я._\-\s]/g, '');
    const gameSavesDir = path.join(SAVES_DIR, gameId);
    try {
        await fsp.access(gameSavesDir);
        const files = await fsp.readdir(gameSavesDir);
        const saves = {};
        for (const file of files) {
            if (file.endsWith('.json')) {
                const key = decodeURIComponent(file.replace('.json', ''));
                saves[key] = await fsp.readFile(path.join(gameSavesDir, file), 'utf8');
            }
        }
        res.json(saves);
    } catch(e) { res.json({}); }
});

app.post('/api/saves/:gameId/:key', async (req, res) => {
    const gameId = path.basename(req.params.gameId).replace(/[^a-zA-Z0-9а-яА-Я._\-\s]/g, '');
    const key = path.basename(req.params.key); 
    const gameSavesDir = path.join(SAVES_DIR, gameId);
    
    // Валидация содержимого сохранения
    const value = req.body.value;
    if (typeof value !== 'string') return res.status(400).json({ error: 'Сохранение должно быть строкой' });
    if (value.length > 5_000_000) return res.status(413).json({ error: 'Слишком большой файл сохранения' });

    try {
        await fsp.mkdir(gameSavesDir, { recursive: true });
        const safeFileName = encodeURIComponent(key) + '.json';
        await fsp.writeFile(path.join(gameSavesDir, safeFileName), value, 'utf8');
        res.json({ success: true });
    } catch(e) { 
        console.error(e);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' }); 
    }
});

app.delete('/api/saves/:gameId/:key', async (req, res) => {
    const gameId = path.basename(req.params.gameId).replace(/[^a-zA-Z0-9а-яА-Я._\-\s]/g, '');
    const key = path.basename(req.params.key);
    const safeFileName = encodeURIComponent(key) + '.json';
    try {
        await fsp.unlink(path.join(SAVES_DIR, gameId, safeFileName));
        res.json({ success: true });
    } catch(e) { res.json({ success: true }); }
});

app.post('/api/upload', uploadLimiter, upload.single('game'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
    console.log(`[Upload] 📥 Принят файл: ${req.file.originalname} | Размер: ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);
    
    const archivePath = req.file.path; 
    let originalName = req.file.originalname.replace(/\.(zip|7z|rar)$/i, '').replace(/[^\w\s\-\.а-яА-Я\[\]]/g, '_').trim();
    if (!originalName) originalName = 'game_archive';

    const tmpExtractDir = path.join(UPLOAD_TMP, 'ext_' + Date.now());
    const isRar = archivePath.toLowerCase().endsWith('.rar'); 

    try {
        await fsp.mkdir(tmpExtractDir, { recursive: true });
        
        if (isRar) {
            console.log(`[Upload] 🗜️ Распаковка RAR архива через официальный алгоритм...`);
            await execFilePromise('unrar', ['x', '-y', archivePath, tmpExtractDir + '/']);
        } else {
            console.log(`[Upload] 🗜️ Распаковка ZIP/7Z через 7-Zip...`);
            const { stdout } = await execFilePromise('7zz', ['l', '-ba', '-slt', archivePath]);
            const lines = stdout.split('\n').filter(l => l.startsWith('Path = '));
            for (const line of lines) {
                const entryPath = path.resolve(tmpExtractDir, line.replace('Path = ', '').trim());
                if (!entryPath.startsWith(path.resolve(tmpExtractDir) + path.sep)) {
                    throw new Error('Обнаружен опасный путь в архиве (Zip Slip)');
                }
            }
            await execFilePromise('7zz', ['x', archivePath, `-o${tmpExtractDir}`, '-y']);
        }
        
        let sourceDir = await findGameFolder(tmpExtractDir);
        if (!sourceDir) throw new Error("В архиве не найдена папка 'www' или файл 'index.html'");
        let finalDestFolder = originalName;
        let counter = 1;
        while (fs.existsSync(path.join(GAMES_DIR, finalDestFolder))) {
            finalDestFolder = `${originalName}_${counter}`;
            counter++;
        }
        const finalPath = path.join(GAMES_DIR, finalDestFolder);
        
        await execFilePromise('chmod', ['-R', '755', sourceDir]);
        
        await fsp.cp(sourceDir, finalPath, { recursive: true });
        await fsp.rm(tmpExtractDir, { recursive: true, force: true }).catch(() => {});
        await fsp.unlink(archivePath).catch(() => {});
        res.json({ success: true, folder: finalDestFolder, message: `Игра "${finalDestFolder}" успешно добавлена!` });
    } catch (e) {
        console.error('[Upload Error]:', e.message ? e.message.substring(0, 300) + '...' : e);
        await fsp.rm(tmpExtractDir, { recursive: true, force: true }).catch(() => {});
        await fsp.unlink(archivePath).catch(() => {});
        res.status(500).json({ error: 'Ошибка загрузки или неподдерживаемый архив' });
    }
});

app.delete('/api/games/:id', async (req, res) => {
    const id = path.basename(req.params.id).replace(/[^a-zA-Z0-9а-яА-Я._\-\s\[\]]/g, '');
    const gamePath = path.join(GAMES_DIR, id);
    try {
        await fsp.access(gamePath);
        await fsp.rm(gamePath, { recursive: true, force: true });
        res.json({ success: true });
    } catch(e) { res.status(404).json({ error: 'Игра не найдена' }); }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', async (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/') return next();

    let reqPath = decodeURIComponent(req.path);
    let filePath = path.join(GAMES_DIR, reqPath);

    const normalizedGamesDir = path.resolve(GAMES_DIR);
    const normalizedFilePath = path.resolve(filePath);
    if (normalizedFilePath !== normalizedGamesDir && !normalizedFilePath.startsWith(normalizedGamesDir + path.sep)) {
        return res.status(403).send('Доступ запрещен / Forbidden');
    }

    try {
        let stat;
        try { stat = await fsp.stat(filePath); } catch(e) {}

        if (stat && stat.isDirectory()) {
            if (!req.path.endsWith('/')) return res.redirect(req.path + '/');

            let hasRoot = false, hasWww = false;
            try { await fsp.access(path.join(filePath, 'index.html')); hasRoot = true; } catch(e) {}
            
            if (hasRoot) {
                reqPath += 'index.html';
                filePath = path.join(filePath, 'index.html');
            } else {
                try { await fsp.access(path.join(filePath, 'www', 'index.html')); hasWww = true; } catch(e) {}
                
                if (hasWww) {
                    return res.redirect(req.path + 'www/');
                } else {
                    const deepDir = await findGameFolder(filePath);
                    if (deepDir) {
                        const relPath = path.relative(GAMES_DIR, deepDir).replace(/\\/g, '/');
                        return res.redirect('/' + relPath + '/');
                    } else {
                        const safePath = escapeHtml(req.path);
                        return res.status(404).send(`
                            <div style="background:#080608; color:#e8dfc8; font-family:'Cinzel', sans-serif; text-align:center; padding:50px; height:100vh; box-sizing:border-box;">
                                <h1 style="color:#c9a84c;">Магия рассеялась...</h1>
                                <p>В папке <b>${safePath}</b> не найден исполняемый файл <code>index.html</code>.</p>
                            </div>
                        `);
                    }
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

app.listen(3000, () => console.log('🚀 RPG API: Secured, Queued, and Ready!'));