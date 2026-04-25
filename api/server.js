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

// ⚡ 1. ПОДКЛЮЧАЕМ SOCKET.IO
const http = require('http');
const { Server } = require('socket.io');

const cookieParser = require('cookie-parser');

const app = express();

// ⚡ 2. СОЗДАЕМ HTTP СЕРВЕР С СОКЕТАМИ
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(compression());

// ⚡ ИДЕАЛЬНАЯ АРХИТЕКТУРА ПАПОК
const GAMES_DIR = '/games';
const EXTRACT_TMP = path.join(GAMES_DIR, '_tmp_uploads'); // РЕАЛЬНЫЙ ДИСК
const UPLOAD_TMP = EXTRACT_TMP; // Грузим сразу на диск, чтобы не убить Docker
const SAVES_DIR = path.join(GAMES_DIR, '_saves');

const API_TOKEN = process.env.API_TOKEN || 'SuperSecretKey123';

let db;

fsp.mkdir(UPLOAD_TMP, { recursive: true }).catch(() => {});
fsp.mkdir(EXTRACT_TMP, { recursive: true }).catch(() => {});
fsp.mkdir(SAVES_DIR, { recursive: true }).catch(() => {});

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, message: { error: 'Слишком много запросов' } });
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: 'Слишком много загрузок' } });
app.use('/api/', apiLimiter);

function requireAuth(req, res, next) {
    // Теперь проверяем куку, а не заголовок
    const token = req.cookies.auth_token;
    
    if (token !== API_TOKEN) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    next();
}

// ⚡ МАРШРУТ АВТОРИЗАЦИИ (Открыт для всех)
app.post('/api/login', apiLimiter, (req, res) => {
    const { password } = req.body;
    if (password === API_TOKEN) {
        // Ставим безопасную куку на 30 дней
        res.cookie('auth_token', API_TOKEN, {
            httpOnly: true,  // Защита от кражи через JS (XSS)
            secure: false,   // Ставь true, если используешь HTTPS
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000 
        });
        return res.json({ success: true });
    }
    res.status(401).json({ error: 'Неверный пароль' });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ success: true });
});
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
    limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // Лимит 10 ГБ
    fileFilter: (req, file, cb) => {
        if (file.originalname.match(/\.(zip|7z|rar)$/i)) cb(null, true);
        else cb(new Error('Поддерживаются только ZIP, 7z и RAR!'));
    }
});

// =====================================================================
// ✅ КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: spawn вместо execFilePromise для распаковки
//
// Проблема: execFilePromise буферизует ВСЁ stdout в оперативке.
// При распаковке 2.8GB архива с тысячами файлов 7zz/unar печатает
// каждый файл — это сотни МБ текста → buffer overflow → крэш.
//
// Решение: spawn с stdio: ['pipe', 'ignore', 'pipe']
//   - stdout идет в /dev/null (не в память)
//   - stderr собирается только первые 50KB для диагностики ошибок
// =====================================================================
function spawnExtract(cmd, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, {
            stdio: ['pipe', 'ignore', 'pipe'] // stdout игнорируем, stderr для ошибок
        });

        let stderr = '';
        proc.stderr.on('data', d => {
            // Собираем только первые 50KB stderr (достаточно для диагностики)
            if (stderr.length < 50000) stderr += d.toString();
        });

        proc.on('close', code => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`${cmd} завершился с кодом ${code}. Stderr: ${stderr.slice(0, 2000)}`));
            }
        });

        proc.on('error', err => {
            reject(new Error(`Не удалось запустить ${cmd}: ${err.message}`));
        });
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
        return text;
    }
}

async function processBackgroundScrape() {
    if (isBackgroundScraping) return;
    if (backgroundScrapeQueue.length === 0) return;

    isBackgroundScraping = true;
    const task = backgroundScrapeQueue.shift();
    console.log(`\n[Queue] 🚀 Запускаем парсинг для ${task.rjCode}`);

    try {
        const scrapedData = await executeFetchDLsiteTags(task.rjCode);
        if (scrapedData && scrapedData.tags && scrapedData.tags.length > 0) {
            await db.run(
                'UPDATE games SET tags = ?, description = ?, scraped = 1 WHERE id = ?',
                [JSON.stringify(scrapedData.tags), scrapedData.description, task.folder]
            );

            const row = await db.get('SELECT title FROM games WHERE id = ?', [task.folder]);
            const gameTitle = row ? row.title : task.rjCode;
            io.emit('scrape-success', { message: `✨ Свиток расшифрован: Описание для "${gameTitle}" добавлено!` });
        }
    } catch (e) {
        console.error(`[Queue] 🚫 Ошибка парсинга ${task.rjCode}:`, e.message);
    } finally {
        queuedScrapes.delete(task.rjCode);
        isBackgroundScraping = false;
        processBackgroundScrape();
    }
}

const TAGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const dlsiteTagCache = new Map();

function nowMs() { return Date.now(); }

// ⚡ 1. УСИЛЕННЫЙ ЯПОНСКИЙ КАНАЛ (Используем 2 независимые базы прокси)
// ⚡ 1. УСИЛЕННЫЙ ЯПОНСКИЙ КАНАЛ (ПАРАЛЛЕЛЬНАЯ АТАКА - ВЕЕРНЫЙ ЗАПРОС)
async function fetchViaJapanProxy(url) {
    try {
        console.log('[Scraper] 📡 Собираем Японские прокси из нескольких баз...');
        let proxies = [];

        // База 1: ProxyScrape
        try {
            const res1 = await fetch('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=JP');
            if (res1.ok) {
                const text1 = await res1.text();
                proxies.push(...text1.split('\n').map(p => p.trim()).filter(p => p.includes(':')));
            }
        } catch(e) {}

        // База 2: Geonode
        try {
            const res2 = await fetch('https://proxylist.geonode.com/api/proxy-list?country=JP&protocols=http&limit=50&sort_by=lastChecked&sort_type=desc');
            if (res2.ok) {
                const json2 = await res2.json();
                if (json2.data) proxies.push(...json2.data.map(p => `${p.ip}:${p.port}`));
            }
        } catch(e) {}

        // База 3: Дополнительный GitHub-источник для страховки
        try {
            const res3 = await fetch('https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt');
            if (res3.ok) {
                const text3 = await res3.text();
                // Так как тут весь мир, фильтруем хотя бы по порту 8080/3128/80 (частые для JP) для количества
                proxies.push(...text3.split('\n').map(p => p.trim()).filter(p => p.includes(':')).slice(0, 20));
            }
        } catch(e) {}

        // Убираем дубликаты и перемешиваем
        proxies = [...new Set(proxies)].sort(() => Math.random() - 0.5);

        if (proxies.length === 0) {
            console.log('[Scraper] ⚠️ Японские прокси сейчас недоступны.');
            return null;
        }

        // Берем до 20 прокси для одновременного удара
        const maxConcurrent = Math.min(20, proxies.length);
        const selectedProxies = proxies.slice(0, maxConcurrent);
        
        console.log(`[Scraper] 🚀 ЗАПУСК ПАРАЛЛЕЛЬНОЙ АТАКИ через ${maxConcurrent} прокси одновременно...`);

        // Создаем массив одновременно выполняющихся задач (Promise)
        const promises = selectedProxies.map((proxy, index) => {
            return new Promise(async (resolve, reject) => {
                try {
                    // Уменьшаем таймаут до 7 секунд (кто не успел, тот опоздал)
                    const { stdout } = await execFilePromise('curl', [
                        '-sS', '-L', '-m', '7', 
                        '-x', proxy, 
                        '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                        url
                    ]);
                    
                    const data = JSON.parse(stdout); 
                    if (data && data[0] && data[0].work_name) {
                        console.log(`[Scraper] 🎯 ПРОРЫВ! Прокси ${proxy} (Поток ${index + 1}) первым достал данные!`);
                        resolve(data); // Первый успешный завершает всю гонку (Promise.any)
                    } else {
                        reject(new Error('Пустой JSON'));
                    }
                } catch (e) {
                    reject(e); // Молча убиваем неудачные потоки
                }
            });
        });

        // ⚡ PROMISE.ANY: Магия NodeJS. Возвращает результат ПЕРВОГО успешного промиса
        // и мгновенно игнорирует все остальные ошибки и таймауты!
        try {
            const winningData = await Promise.any(promises);
            return winningData;
        } catch (e) {
            console.log(`[Scraper] 💀 Параллельная атака захлебнулась. Ни один из ${maxConcurrent} прокси не смог пробиться за 7 секунд.`);
        }

    } catch (e) {
        console.error('[Scraper] ❌ Системная ошибка JP-канала:', e.message);
    }
    return null;
}

// ⚡ 2. ОБРАБОТЧИК И ПЕРЕВОДЧИК
async function processParsedData(gameData, rjCode) {
    let tags = [];
    if (gameData.genres) {
        tags = gameData.genres.map(g => g.name);
    }
    
    let description = gameData.intro_s || gameData.intro || '';
    description = description.replace(/<[^>]*>?/gm, '').trim();

    console.log(`[Scraper] 🏷️ Найдено тегов: ${tags.length}`);
    
    if (tags.length > 0) {
        const uniqueTags = [...new Set(tags)];
        console.log(`[Scraper] 🗣️ Переводим описание...`);
        const translatedDesc = await translateText(description, 'en');
        const finalData = { tags: uniqueTags, description: translatedDesc };
        
        dlsiteTagCache.set(rjCode, { data: finalData, expiresAt: nowMs() + TAGS_CACHE_TTL_MS }); 
        console.log(`[Scraper] ✅ УСПЕХ! Данные расшифрованы.`);
        return finalData;
    }
    return null;
}

// ⚡ 3. ГЛАВНАЯ ФУНКЦИЯ (С обходом Language Lock)
async function executeFetchDLsiteTags(rjCode) {
    const cached = dlsiteTagCache.get(rjCode);
    if (cached && cached.expiresAt > nowMs()) return cached.data;

    console.log(`\n[Scraper] 🚀=== СТАРТ БЫСТРОГО ПАРСИНГА ДЛЯ ${rjCode} ===🚀`);
    
    // ⚡ ХИТРОСТЬ: Пробуем сначала Английский магазин, затем Японский
    const locales = ['en_US', 'ja_JP'];

    for (const loc of locales) {
        console.log(`[Scraper] 🌍 Проверяем локаль магазина: ${loc}...`);
        const targetUrl = `https://www.dlsite.com/maniax/api/=/product.json?workno=${rjCode}&locale=${loc}`;
        
        const gateways = [
            `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
            `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
            `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`
        ];

        for (let i = 0; i < gateways.length; i++) {
            console.log(`[Scraper] 🌐 Запрос через шлюз ${i + 1}...`);
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000); 
                const res = await fetch(gateways[i], { signal: controller.signal });
                clearTimeout(timeoutId);
                
                if (!res.ok) throw new Error(`Статус ${res.status}`);
                const data = await res.json();
                
                // Если API вернуло данные - мы победили!
                if (data && data[0] && data[0].work_name) {
                    return await processParsedData(data[0], rjCode);
                }
                throw new Error('Данные пусты (Регионлок)');
            } catch (e) {
                console.warn(`[Scraper] ⚠️ Шлюз ${i + 1} не справился:`, e.message);
            }
        }
    }

    // Если даже японская версия через шлюзы США не отдалась, значит это жесткий IP-блок
    console.log(`[Scraper] 💀 Шлюзы бессильны (Жесткий IP-блок). Запуск Японского спецназа...`);
    const jpUrl = `https://www.dlsite.com/maniax/api/=/product.json?workno=${rjCode}&locale=en_US`;
    const jpData = await fetchViaJapanProxy(jpUrl);
    
    if (jpData && jpData[0] && jpData[0].work_name) {
        console.log(`[Scraper] 🌸 Японский прокси успешно пробил защиту!`);
        return await processParsedData(jpData[0], rjCode);
    }

    console.log(`[Scraper] ❌ Финальный отказ. Парсинг провален.`);
    return null;
}

async function initDB() {
    db = await open({ filename: path.join(GAMES_DIR, 'library.db'), driver: sqlite3.Database });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS games (
            id TEXT PRIMARY KEY, title TEXT, cover TEXT, tags TEXT, description TEXT,
            rating INTEGER DEFAULT 0, lastPlayed INTEGER DEFAULT 0, addedAt INTEGER DEFAULT 0, scraped INTEGER DEFAULT 0,
            ready INTEGER DEFAULT 0
        )
    `);

    // миграция для добавления колонки (если её ещё нет)
    try {
        await db.exec('ALTER TABLE games ADD COLUMN ready INTEGER DEFAULT 0');
    } catch (_) {}

    // 🔥 СПАСАТЕЛЬНЫЙ КРУГ ДЛЯ СТАРЫХ ИГР 🔥
    // Находим все старые игры, которые застряли со статусом ready = 0, 
    // но у которых уже есть название или обложка, и принудительно делаем их "готовыми".
    try {
        const result = await db.run(`
            UPDATE games 
            SET ready = 1 
            WHERE ready = 0 AND (title IS NOT NULL OR cover IS NOT NULL)
        `);
        if (result.changes > 0) {
            console.log(`[DB Migration] 🚀 Восстановлено старых игр: ${result.changes}`);
        }
    } catch (e) {
        console.error('[DB Migration Error]', e);
    }
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

    const stat = await fsp.stat(gamePath);

    // Черновик (не виден на сайте, пока ready=0)
    await db.run(
        `INSERT OR REPLACE INTO games
         (id, title, cover, tags, description, rating, lastPlayed, addedAt, scraped, ready)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [folder, title, cover, '[]', '', 0, 0, stat.birthtimeMs || stat.mtimeMs || Date.now(), 0, 0]
    );

    // Пытаемся дотянуть теги/описание сразу (не в фоне), чтобы игра появилась уже "готовой"
    if (rjCode) {
        try {
            const scrapedData = await executeFetchDLsiteTags(rjCode);
            if (scrapedData && scrapedData.tags && scrapedData.tags.length > 0) {
                await db.run(
                    'UPDATE games SET tags = ?, description = ?, scraped = 1 WHERE id = ?',
                    [JSON.stringify(scrapedData.tags), scrapedData.description, folder]
                );
            }
        } catch (e) {
            console.warn(`[AddGame] scrape fail for ${folder}:`, e.message);
        }
    }

    // Публикуем только после всех шагов
    await db.run('UPDATE games SET ready = 1 WHERE id = ?', [folder]);

    // ⚡ БОНУС: Уведомляем сайт точечно, с названием конкретной игры!
    if (io) {
        io.emit('scrape-success', { message: `✅ Игра "${title}" полностью обработана и добавлена!` });
    }
}

async function syncDatabase() {
    const entries = await fsp.readdir(GAMES_DIR);
    const existingGames = await db.all('SELECT id FROM games');
    const dbIds = existingGames.map(g => g.id);

    for (const folder of entries) {
        const gamePath = path.join(GAMES_DIR, folder);
        let stat;
        try { stat = await fsp.stat(gamePath); } catch(e) { continue; }

        if (!stat.isDirectory() || folder === 'node_modules' || folder === '_saves' || folder === '_tmp_uploads') continue;

        if (!dbIds.includes(folder)) {
            await addGameToDB(folder, gamePath);
        }
    }

    for (const id of dbIds) {
        if (!entries.includes(id) || id === '_saves' || id === '_tmp_uploads' || id === 'node_modules') {
            await db.run('DELETE FROM games WHERE id = ?', [id]);
        }
    }
}

// =====================================================================
// API Routes
// =====================================================================

app.get('/api/games', async (req, res) => {
    try {
        const rows = await db.all('SELECT * FROM games WHERE ready = 1');
        const games = rows.map(row => ({
            id: row.id,
            title: row.title,
            cover: row.cover,
            tags: row.tags ? JSON.parse(row.tags) : [],
            description: row.description,
            url: `/${row.id}/`,
            number: 0,
            addedAt: row.addedAt,
            lastPlayed: row.lastPlayed,
            rating: row.rating
        }));

        games.sort((a, b) => a.addedAt - b.addedAt).forEach((g, i) => g.number = i + 1);
        res.json(games);
    } catch (e) {
        res.status(500).json({ error: 'DB Error' });
    }
});

// 🔥 РУЧНОЕ РЕДАКТИРОВАНИЕ И ПРИНУДИТЕЛЬНЫЙ ПАРСИНГ (УЛУЧШЕНО)
app.post('/api/games/:id/edit', async (req, res) => {
    const folder = path.basename(req.params.id);
    const { title, rjCode } = req.body;
    const gamePath = path.join(GAMES_DIR, folder);

    try {
        let scrapeWarning = null;

        // 1. Обновляем название игры
        if (title) {
            await db.run('UPDATE games SET title = ? WHERE id = ?', [title, folder]);
        }

        // 2. Если передан RJ-код, насильно скрейпим DLsite
        if (rjCode && rjCode.match(/RJ\d+/i)) {
            const cleanRj = rjCode.match(/RJ\d+/i)[0].toUpperCase();
            console.log(`[Manual Edit] 🕵️‍♂️ Поиск для: ${cleanRj}`);

            // Скачиваем обложку
            const coverDest = path.join(gamePath, 'cover.jpg');
            const coverSuccess = await fetchDLsiteCover(cleanRj, coverDest);
            if (coverSuccess) {
                await db.run('UPDATE games SET cover = ? WHERE id = ?', [`${folder}/cover.jpg`, folder]);
            }

            // Парсим теги и описание
            const scrapedData = await executeFetchDLsiteTags(cleanRj);
            if (scrapedData && scrapedData.tags && scrapedData.tags.length > 0) {
                await db.run(
                    'UPDATE games SET tags = ?, description = ?, scraped = 1 WHERE id = ?',
                    [JSON.stringify(scrapedData.tags), scrapedData.description, folder]
                );
            } else {
                // ⚡ ЕСЛИ ТЕГИ НЕ НАЙДЕНЫ — НЕ ВЫДАЕМ ОШИБКУ 404, А ПРОСТО ПРЕДУПРЕЖДАЕМ
                scrapeWarning = 'Обложка обновлена, но теги не найдены (Возможно защита Cloudflare или игра из раздела Pro).';
            }
        }

        // 3. Возвращаем обновленные данные (даже если теги не нашлись, мы вернем новое имя и обложку!)
        const updatedGame = await db.get('SELECT * FROM games WHERE id = ?', [folder]);
        res.json({
            success: true,
            warning: scrapeWarning,
            title: updatedGame.title,
            cover: updatedGame.cover,
            tags: updatedGame.tags ? JSON.parse(updatedGame.tags) : [],
            description: updatedGame.description
        });

    } catch (e) {
        console.error('[Edit Error]', e);
        res.status(500).json({ error: 'Сбой сервера при обновлении' });
    }
});

// 🔥 ОБНОВЛЕНИЕ МЕТАДАННЫХ (Рейтинг и Последний запуск)
app.post('/api/games/:id/meta', async (req, res) => {
    const folder = path.basename(req.params.id);
    const { rating, lastPlayed } = req.body;

    try {
        // Проверяем, существует ли игра в базе
        const game = await db.get('SELECT id FROM games WHERE id = ?', [folder]);
        if (!game) return res.status(404).json({ error: 'Игра не найдена' });

        // Умный динамический апдейт: обновляем только то, что прислал фронтенд
        const updates = [];
        const params = [];
        
        if (rating !== undefined) {
            updates.push('rating = ?');
            params.push(rating);
        }
        if (lastPlayed !== undefined) {
            updates.push('lastPlayed = ?');
            params.push(lastPlayed);
        }

        if (updates.length > 0) {
            params.push(folder);
            await db.run(`UPDATE games SET ${updates.join(', ')} WHERE id = ?`, params);
        }

        res.json({ success: true });
    } catch (e) {
        console.error('[Meta Update Error]', e);
        res.status(500).json({ error: 'Ошибка при сохранении метаданных' });
    }
});

// 🔥 БРОНЕБОЙНАЯ ЗАГРУЗКА И РАСПАКОВКА
app.post('/api/upload', uploadLimiter, upload.single('game'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен' });

    console.log(`[Upload] 📥 ${req.file.originalname} | ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);

    const archivePath = req.file.path;
    let originalName = req.file.originalname
        .replace(/\.(zip|7z|rar)$/i, '')
        .replace(/[^\w\s\-\.а-яА-Я\[\]]/g, '_')
        .trim() || 'game_archive';

    const tmpExtractDir = path.join(EXTRACT_TMP, 'ext_' + Date.now());

    try {
        await fsp.mkdir(tmpExtractDir, { recursive: true });
        io.emit('upload-status', { message: '🗜️ Распаковка архива...' });

        // Zip Slip защита только для zip/7z (RAR проверяем иначе)
        const isZipOrSevenz = req.file.originalname.match(/\.(zip|7z)$/i);
        if (isZipOrSevenz) {
            const { stdout } = await execFilePromise('7zz', ['l', '-ba', '-slt', archivePath], { maxBuffer: 200 * 1024 * 1024 });
            const lines = stdout.split('\n').filter(l => l.startsWith('Path = '));
            for (const line of lines) {
                const entryPath = path.resolve(tmpExtractDir, line.replace('Path = ', '').trim());
                if (!entryPath.startsWith(path.resolve(tmpExtractDir) + path.sep)) {
                    throw new Error('Обнаружен опасный путь в архиве (Zip Slip)');
                }
            }
        }

        // Пример логики проверки путей перед распаковкой
        async function validateArchivePaths(archivePath) {
            const { stdout } = await execFilePromise('7zz', ['l', '-ba', '-slt', archivePath]);
            const lines = stdout.split('\n').filter(l => l.startsWith('Path = '));
            for (const line of lines) {
                const internalPath = line.replace('Path = ', '').trim();
                // Если путь содержит переход на уровень вверх или абсолютный путь
                if (internalPath.includes('..') || internalPath.startsWith('/') || internalPath.startsWith('\\')) {
                    throw new Error(`Обнаружен опасный путь: ${internalPath}`);
                }
            }
        }

        // 7zz справляется со всем: zip, 7z, rar, rar5
        await spawnExtract('7zz', ['x', archivePath, `-o${tmpExtractDir}`, '-y']);

        io.emit('upload-status', { message: '🔍 Поиск файлов игры...' });
        const sourceDir = await findGameFolder(tmpExtractDir);
        if (!sourceDir) throw new Error("Не найдена папка 'www' или 'index.html'");

        let finalDestFolder = originalName;
        let counter = 1;
        while (fs.existsSync(path.join(GAMES_DIR, finalDestFolder))) {
            finalDestFolder = `${originalName}_${counter++}`;
        }
        const finalPath = path.join(GAMES_DIR, finalDestFolder);

        io.emit('upload-status', { message: '📦 Сохранение в библиотеку...' });
        await execFilePromise('mv', [sourceDir, finalPath]);

        await Promise.all([
            fsp.rm(tmpExtractDir, { recursive: true, force: true }).catch(() => {}),
            fsp.unlink(archivePath).catch(() => {})
        ]);

        await addGameToDB(finalDestFolder, finalPath);

        io.emit('upload-status', { message: '✨ Готово!' });
        res.json({ success: true, folder: finalDestFolder, message: `Игра "${finalDestFolder}" добавлена!` });

    } catch (e) {
        console.error('[UPLOAD ERROR]', e);
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
        await fsp.access(gamePath);
        await fsp.rm(gamePath, { recursive: true, force: true });
        await db.run('DELETE FROM games WHERE id = ?', [id]);
        res.json({ success: true });
    } catch(e) { res.status(404).json({ error: 'Игра не найдена' }); }
});

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
                reqPath += 'index.html';
                filePath = path.join(filePath, 'index.html');
            } else {
                try { await fsp.access(path.join(filePath, 'www', 'index.html')); hasWww = true; } catch(e) {}
                if (hasWww) {
                    return res.redirect(req.path + 'www/');
                } else {
                    const deepDir = await findGameFolder(filePath);
                    if (deepDir) return res.redirect('/' + path.relative(GAMES_DIR, deepDir).replace(/\\/g, '/') + '/');
                    return res.status(404).send(`<div style="color:red; text-align:center; padding:50px;">index.html не найден.</div>`);
                }
            }
        }

        // ⚡ УМНЫЙ РОУТИНГ АУДИО (Smart Audio Fallback 2026)
        // Если движок (iOS) просит .m4a, но его нет, сервер сам найдет .ogg или зашифрованный файл
        const ext = path.extname(filePath).toLowerCase();
        
        async function tryPath(p) {
            try { await fsp.access(p); return p; } catch { return null; }
        }

        if (ext === '.m4a' || ext === '.ogg') {
            const base = filePath.slice(0, -4); // Отрезаем расширение
            
            // Формируем список приоритетов (что ищем в первую очередь)
            const pathsToTry = ext === '.m4a' 
                ? [filePath, base + '.ogg', filePath + '_', base + '.rpgmvo', base + '.rpgmvm'] // iOS Priority
                : [filePath, base + '.m4a', filePath + '_', base + '.rpgmvm', base + '.rpgmvo']; // PC Priority

            // Каскадный поиск: отдаем первый найденный файл из списка
            for (const p of pathsToTry) {
                const found = await tryPath(p);
                if (found) { 
                    filePath = found; 
                    break; 
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

// ⚡ ЗАПУСК СЕРВЕРА (Только если файл запущен напрямую, а не импортирован тестами)
if (require.main === module) {
    initDB().then(async () => {
        await syncDatabase();

        const srv = server.listen(3000, () => console.log('🚀 RPG API: SQLite и WebSockets подключены, сервер готов!'));
        srv.timeout = 0;
        srv.requestTimeout = 0;
        srv.keepAliveTimeout = 0;

        // ---- Hybrid watcher ----
        let syncTimer = null;
        let syncInProgress = false;
        let pendingSync = false;
        let lastReadyCount = 0;

        async function getReadyCount() {
            const row = await db.get('SELECT COUNT(*) as c FROM games WHERE ready = 1');
            return row?.c || 0;
        }

        lastReadyCount = await getReadyCount();

        async function runSyncSafely(reason = 'watcher') {
            if (syncInProgress) {
                pendingSync = true;
                return;
            }

            syncInProgress = true;
            try {
                console.log(`[Watcher] 🔄 Запуск синхронизации (${reason})...`);
                await syncDatabase();

                const newReadyCount = await getReadyCount();
                if (newReadyCount !== lastReadyCount) {
                    const diff = newReadyCount - lastReadyCount;
                    lastReadyCount = newReadyCount;

                    io.emit('scrape-success', {
                        message: diff > 0
                            ? `✅ Добавлено готовых игр: ${diff}`
                            : '🔄 Библиотек�� обновлена'
                    });
                }

                console.log('[Watcher] ✅ Синхронизация завершена');
            } catch (e) {
                console.error('[Watcher] ❌ Ошибка синхронизации:', e);
            } finally {
                syncInProgress = false;
                if (pendingSync) {
                    pendingSync = false;
                    setTimeout(() => runSyncSafely('pending'), 300);
                }
            }
        }

        const watcher = fs.watch(GAMES_DIR, { persistent: true }, (eventType, filename) => {
            if (!filename) return;
            if (filename === '_tmp_uploads' || filename === '_saves' || filename === 'node_modules') return;

            clearTimeout(syncTimer);
            syncTimer = setTimeout(() => {
                runSyncSafely(`fs.watch:${eventType}:${filename}`);
            }, 5000);
        });

        watcher.on('error', (err) => {
            console.error('[Watcher] ❌ Ошибка watcher:', err.message);
        });

        console.log(`[Watcher] 👀 Наблюдение за ${GAMES_DIR} включено`);
    }).catch(console.error);
}

// ⚡ ЭКСПОРТ ФУНКЦИЙ ДЛЯ UNIT-ТЕСТОВ
module.exports = {
    app,
    requireAuth,
    processParsedData,
    findRJCode,
    translateText // Если будешь тестировать перевод
};