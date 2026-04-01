const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const multer = require('multer');
const https = require('https');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
const GAMES_DIR = '/games';
const UPLOAD_TMP = '/tmp/rpg-uploads';
const SAVES_DIR = path.join(GAMES_DIR, '_saves'); 

fsp.mkdir(UPLOAD_TMP, { recursive: true }).catch(() => {});
fsp.mkdir(SAVES_DIR, { recursive: true }).catch(() => {});

app.use(express.json({ limit: '50mb' }));

const upload = multer({
    dest: UPLOAD_TMP,
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, 
    fileFilter: (req, file, cb) => {
        if (file.originalname.match(/\.(zip|7z|rar)$/i)) cb(null, true);
        else cb(new Error('Поддерживаются только ZIP, 7z и RAR!'));
    }
});

async function findGameFolder(dir) {
    const items = await fsp.readdir(dir, { withFileTypes: true });
    const wwwFolder = items.find(i => i.isDirectory() && i.name.toLowerCase() === 'www');
    if (wwwFolder) return path.join(dir, wwwFolder.name);
    const hasIndexHtml = items.some(i => i.isFile() && i.name.toLowerCase() === 'index.html');
    if (hasIndexHtml) return dir;
    for (const item of items) {
        if (item.isDirectory()) {
            const found = await findGameFolder(path.join(dir, item.name));
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
// DLsite Tags: Умный пул прокси + Кэширование (Оптимизированная версия)
// =====================================================================

// Настройки пула
const MAX_PROXY_ATTEMPTS = 5;
const DL_PAGE_TIMEOUT_MS = 25000;
const DL_AJAX_TIMEOUT_MS = 8000;
const PROXY_TTL_MS = 30 * 60 * 1000; // Прокси забывается через 30 минут простоя

const dlsiteTagCache = new Map(); // Кэш найденных тегов: rjCode -> tags
const proxyPool = new Map();      // Умная память прокси: proxy -> { score, fails }

function nowMs() { return Date.now(); }

// Очистка старых прокси из памяти
function cleanupProxyPool() {
    const now = nowMs();
    for (const [proxy, meta] of proxyPool.entries()) {
        if (now - meta.lastUsed > PROXY_TTL_MS) proxyPool.delete(proxy);
    }
}

// Изменение рейтинга прокси
function updateProxyScore(proxy, isSuccess) {
    if (!proxy || proxy === 'direct') return;
    const meta = proxyPool.get(proxy) || { score: 0, fails: 0, lastUsed: nowMs() };
    
    meta.lastUsed = nowMs();
    if (isSuccess) {
        meta.score += 3;
        meta.fails = 0;
    } else {
        meta.score -= 2;
        meta.fails += 1;
    }

    // Если прокси сильно провинился - выкидываем его навсегда
    if (meta.fails >= 2 || meta.score <= -3) {
        proxyPool.delete(proxy);
    } else {
        proxyPool.set(proxy, meta);
    }
}

// Получение свежего списка публичных прокси
async function getPublicJapaneseProxies() {
    try {
        const res = await fetch('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=JP');
        if (!res.ok) throw new Error('Proxy API error');
        const text = await res.text();
        return text.split('\n')
                   .map(p => p.trim())
                   .filter(p => p.includes(':'))
                   .sort(() => Math.random() - 0.5); // Перемешиваем
    } catch (e) {
        console.log(`[DLsite] ⚠️ Ошибка загрузки списка прокси: ${e.message}`);
        return [];
    }
}

// Формирование умной очереди (Сначала лучшие из памяти, затем новые)
function buildProxyCandidates(publicList) {
    cleanupProxyPool();
    // Сортируем память по очкам (score) по убыванию
    const remembered = [...proxyPool.entries()]
        .sort((a, b) => b[1].score - a[1].score)
        .map(entry => entry[0]);

    // Если у тебя когда-нибудь появится платный прокси, он будет читаться отсюда
    const trustedProxy = process.env.DLSITE_JP_PROXY || null;
    
    let candidates = new Set();
    if (trustedProxy) candidates.add(trustedProxy);
    remembered.forEach(p => candidates.add(p));
    publicList.forEach(p => candidates.add(p));
    
    if (candidates.size === 0) candidates.add('direct');
    
    return Array.from(candidates).slice(0, MAX_PROXY_ATTEMPTS);
}

// Главная функция парсинга
async function fetchDLsiteTags(rjCode) {
    // 1. Быстрый возврат из кэша (если мы уже парсили эту игру в этой сессии)
    if (dlsiteTagCache.has(rjCode)) {
        console.log(`[DLsite] ⚡ Теги для ${rjCode} взяты из локального кэша.`);
        return dlsiteTagCache.get(rjCode);
    }

    console.log(`\n======================================================`);
    console.log(`[DLsite] 🤖 Начинаем операцию для ${rjCode}...`);

    const publicList = await getPublicJapaneseProxies();
    const candidates = buildProxyCandidates(publicList);

    for (let i = 0; i < candidates.length; i++) {
        const proxy = candidates[i];
        let browser;
        try {
            const isRemembered = proxyPool.has(proxy) ? '(⭐ Из памяти)' : '';
            console.log(`\n[DLsite] 🚀 Попытка ${i + 1}/${candidates.length}. IP: ${proxy} ${isRemembered}`);

            const args = [
                '--no-sandbox', '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', '--disable-gpu', '--lang=en-US'
            ];
            if (proxy !== 'direct') args.push(`--proxy-server=http://${proxy}`);

            browser = await puppeteer.launch({
                headless: "new",
                executablePath: '/usr/bin/chromium',
                args: args
            });

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
            
            // Проверка на блокировку или "левый" редирект (Google, Cloudflare)
            if (!pageTitle.includes('DLsite') || pageTitle.includes('Google') || pageTitle === '') {
                throw new Error(`Заблокирован или перенаправлен (Title: ${pageTitle.substring(0, 20)})`);
            }

            // Пытаемся достать теги (Сначала API, потом HTML)
            const tags = await page.evaluate(async (rj, timeout) => {
                // План А: Внутреннее API
                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), timeout);
                    const apiRes = await fetch(`https://www.dlsite.com/maniax/product/info/ajax?product_id=${rj}`, { signal: controller.signal });
                    clearTimeout(timer);
                    const data = await apiRes.json();
                    if (data && data[rj] && data[rj].genres) return data[rj].genres.map(g => g.name);
                } catch (e) {}

                // План Б: Парсинг DOM
                const genreLinks = Array.from(document.querySelectorAll('a[href*="/genre/"]'));
                return genreLinks.map(el => el.innerText.trim()).filter(text => text.length > 0);
            }, rjCode, DL_AJAX_TIMEOUT_MS); 

            if (tags && tags.length > 0) {
                const uniqueTags = [...new Set(tags)];
                console.log(`[DLsite] ✅ УСПЕХ! Теги найдены:`, uniqueTags);
                
                updateProxyScore(proxy, true); // Хвалим прокси
                dlsiteTagCache.set(rjCode, uniqueTags); // Сохраняем в кэш
                
                await browser.close();
                return uniqueTags;
            } else {
                throw new Error('Мягкая блокировка (Soft-Lock), тегов нет.');
            }

        } catch (error) {
            console.log(`[DLsite] 🚫 Ошибка: ${error.message.split('\n')[0]}`);
            updateProxyScore(proxy, false); // Штрафуем прокси
            if (browser) await browser.close();
        }
    }

    console.log(`\n[DLsite] ❌ Все попытки исчерпаны. Теги не найдены.`);
    console.log(`======================================================\n`);
    return [];
}

async function getGameMetadata(folder, gamePath) {
    const metaPath = path.join(gamePath, 'meta.json');
    const checkExists = async (p) => { try { await fsp.access(p); return true; } catch { return false; } };

    let existingMeta = {};
    try {
        if (await checkExists(metaPath)) {
            const metaRaw = await fsp.readFile(metaPath, 'utf8');
            existingMeta = JSON.parse(metaRaw);
            if (existingMeta.scraped) return existingMeta;
        }
    } catch(e) {}

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
    let tags = existingMeta.tags || []; // Подхватываем старые теги, если есть

    if (await checkExists(path.join(gamePath, 'cover.jpg'))) cover = `${folder}/cover.jpg`;
    else if (await checkExists(path.join(gamePath, 'cover.png'))) cover = `${folder}/cover.png`;

    const rjCode = await findRJCode(folder, gamePath);
    
    // 🔥 Если нашли RJ-код, скачиваем обложку и ТЕГИ
    if (rjCode) {
        if (!cover) {
            const coverDest = path.join(gamePath, 'cover.jpg');
            const success = await fetchDLsiteCover(rjCode, coverDest);
            if (success) cover = `${folder}/cover.jpg`;
        }
        
        // Если тегов еще нет, парсим их с DLsite
        if (tags.length === 0) {
            console.log(`🏷️ Парсим теги с DLsite для ${rjCode}...`);
            tags = await fetchDLsiteTags(rjCode);
        }
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

    // Сохраняем парсинг
    const finalMeta = { ...existingMeta, title, cover, tags, scraped: true };
    await fsp.writeFile(metaPath, JSON.stringify(finalMeta, null, 2), 'utf8').catch(()=>{});
    return finalMeta;
}

app.get('/api/games', async (req, res) => {
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
                    id: folder, 
                    title: meta.title, 
                    cover: meta.cover, 
                    tags: meta.tags || [], // Отправляем теги на фронтенд
                    url: `/${folder}/`, 
                    number: games.length + 1,
                    addedAt: stat.birthtimeMs || stat.mtimeMs || 0,
                    lastPlayed: meta.lastPlayed || 0,
                    rating: meta.rating || 0
                });
            } catch(e) {}
        }
        res.json(games);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/games/:id/meta', async (req, res) => {
    const id = req.params.id.replace(/[^a-zA-Z0-9а-яА-Я._\-\s\[\]]/g, '');
    const metaPath = path.join(GAMES_DIR, id, 'meta.json');
    try {
        let meta = {};
        try {
            const metaRaw = await fsp.readFile(metaPath, 'utf8');
            meta = JSON.parse(metaRaw);
        } catch(e) {}

        if (req.body.rating !== undefined) meta.rating = req.body.rating;
        if (req.body.lastPlayed !== undefined) meta.lastPlayed = req.body.lastPlayed;
        meta.scraped = true; 

        await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API Сейвов и Загрузки
app.get('/api/saves/:gameId', async (req, res) => {
    const gameId = req.params.gameId.replace(/[^a-zA-Z0-9а-яА-Я._\-\s]/g, '');
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
    const gameId = req.params.gameId.replace(/[^a-zA-Z0-9а-яА-Я._\-\s]/g, '');
    const key = req.params.key; 
    const gameSavesDir = path.join(SAVES_DIR, gameId);
    try {
        await fsp.mkdir(gameSavesDir, { recursive: true });
        const safeFileName = encodeURIComponent(key) + '.json';
        await fsp.writeFile(path.join(gameSavesDir, safeFileName), req.body.value, 'utf8');
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/saves/:gameId/:key', async (req, res) => {
    const gameId = req.params.gameId.replace(/[^a-zA-Z0-9а-яА-Я._\-\s]/g, '');
    const key = req.params.key;
    const safeFileName = encodeURIComponent(key) + '.json';
    try {
        await fsp.unlink(path.join(SAVES_DIR, gameId, safeFileName));
        res.json({ success: true });
    } catch(e) { res.json({ success: true }); }
});

app.post('/api/upload', upload.single('game'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
    const archivePath = req.file.path;
    const originalName = req.file.originalname.replace(/\.(zip|7z|rar)$/i, '').replace(/[^\w\s\-\.а-яА-Я\[\]]/g, '_').trim();
    const tmpExtractDir = path.join(UPLOAD_TMP, 'ext_' + Date.now());
    try {
        await fsp.mkdir(tmpExtractDir, { recursive: true });
        await execPromise(`7z x "${archivePath}" -o"${tmpExtractDir}" -y`);
        let sourceDir = await findGameFolder(tmpExtractDir);
        if (!sourceDir) throw new Error("В архиве не найдена папка 'www' или файл 'index.html'");
        let finalDestFolder = originalName;
        let counter = 1;
        while (fs.existsSync(path.join(GAMES_DIR, finalDestFolder))) {
            finalDestFolder = `${originalName}_${counter}`;
            counter++;
        }
        const finalPath = path.join(GAMES_DIR, finalDestFolder);
        await execPromise(`chmod -R 777 "${sourceDir}"`);
        await fsp.cp(sourceDir, finalPath, { recursive: true });
        await fsp.rm(tmpExtractDir, { recursive: true, force: true }).catch(() => {});
        await fsp.unlink(archivePath).catch(() => {});
        res.json({ success: true, folder: finalDestFolder, message: `Игра "${finalDestFolder}" успешно добавлена!` });
    } catch (e) {
        await fsp.rm(tmpExtractDir, { recursive: true, force: true }).catch(() => {});
        await fsp.unlink(archivePath).catch(() => {});
        res.status(500).json({ error: 'Ошибка: ' + e.message });
    }
});

app.delete('/api/games/:id', async (req, res) => {
    const id = req.params.id.replace(/[^a-zA-Z0-9а-яА-Я._\-\s\[\]]/g, '');
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
                        return res.status(404).send(`
                            <div style="background:#080608; color:#e8dfc8; font-family:'Cinzel', sans-serif; text-align:center; padding:50px; height:100vh; box-sizing:border-box;">
                                <h1 style="color:#c9a84c;">Магия рассеялась...</h1>
                                <p>В папке <b>${req.path}</b> не найден исполняемый файл <code>index.html</code>.</p>
                                <p style="color:#7a7060; margin-top:20px;">Возможно, вы скачали версию для Windows (.exe), а не HTML5-версию для браузера.</p>
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

app.listen(3000, () => console.log('🚀 RPG API: Tags, Ratings, and Sorting Ready!'));