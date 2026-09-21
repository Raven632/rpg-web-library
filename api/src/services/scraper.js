const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const util = require('util');
const { execFile, spawn } = require('child_process');
const execFilePromise = util.promisify(execFile);
const { redisClient, invalidateGamesList } = require('../utils/cache.js');
const { cleanTitle } = require('../utils/title.js');

// Steam прячет игры 18+ за возрастным подтверждением. Без этих кук appdetails
// отвечает success: false, и вся ветка Steam молча возвращает пустоту —
// именно поэтому у тебя ни одна игра не получила метаданные из Steam.
const STEAM_HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    Cookie: 'birthtime=283993201; mature_content=1; wants_mature_content=1; lastagecheckage=1-0-1979',
};
// Сходство названий: 1 — совпали, 0 — ничего общего. Нужен, чтобы автопоиск не приписал
// игре чужие теги: поиск F95 на непонятный запрос охотно отдаёт «что-то похожее».
// В .env можно положить как полную строку «xf_user=…; xf_session=…», так и одно
// значение xf_user — во втором случае имя подставим сами, иначе заголовок Cookie
// получается без имени и форум считает нас гостем.
function f95Cookie() {
    const raw = (process.env.F95_COOKIE || '').trim();
    if (!raw) return '';
    return raw.includes('=') ? raw : `xf_user=${raw}`;
}

// F95 хранит одну картинку в трёх видах: preview.f95zone.to и .../thumb/ — это
// превью в 400 px (именно они приезжали к нам «скриншотами»), а оригинал лежит
// на attachments по тому же пути. Приводим любую ссылку к полному размеру.
function fullSizeImage(url) {
    let u = String(url || '').replace(/^https?:\/\/preview\.f95zone\.to\//i, 'https://attachments.f95zone.to/');
    if (/attachments\.f95zone\.to\//i.test(u)) u = u.replace('/thumb/', '/');
    return u;
}

function titleSimilarity(a, b) {
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9а-я]/gi, '');
    const x = norm(a), y = norm(b);
    if (!x || !y) return 0;
    if (x === y) return 1;

    // Название игры часто короче названия темы: «Noble of Pride» против
    // «Noble of Pride -The Arrogant Noble Lady & the Succubus». Для таких случаев
    // вхождение надёжнее Дайса, который штрафует за разницу в длине.
    const shorter = x.length <= y.length ? x : y;
    const longer = x.length <= y.length ? y : x;
    if (shorter.length >= 8 && longer.startsWith(shorter)) return 0.95;
    if (shorter.length >= 12 && longer.includes(shorter)) return 0.9;
    // Коэффициент Дайса по парам букв: устойчив к перестановкам и мелким опечаткам
    const grams = (s) => {
        const m = new Map();
        for (let i = 0; i < s.length - 1; i++) {
            const g = s.slice(i, i + 2);
            m.set(g, (m.get(g) || 0) + 1);
        }
        return m;
    };
    const gx = grams(x), gy = grams(y);
    let hits = 0;
    for (const [g, n] of gx) if (gy.has(g)) hits += Math.min(n, gy.get(g));
    const total = (x.length - 1) + (y.length - 1);
    return total > 0 ? (2 * hits) / total : 0;
}

class ScraperService {
    constructor() {
        this.isBackgroundScraping = false;
        this.io = null;
        this.GAMES_DIR = '';
        this.dbService = null; 
    }

    setDependencies(io, gamesDir, dbService) { 
        this.io = io;
        this.GAMES_DIR = gamesDir;
        this.dbService = dbService; 
    }

    // --- НОВОЕ: Очередь на базе Redis ---
    async queueScrape(folder, { force = false } = {}) {
        // Игры, по которым неделю назад ничего не нашлось, заново не дёргаем:
        // источники те же, лимиты общие, результат будет тот же.
        if (!force) {
            const missed = await redisClient.exists(`scrape:miss:${folder}`).catch(() => 0);
            if (missed) return false;
        } else {
            // Разбор запросили руками — забываем прошлую неудачу, иначе она всплывёт
            // при следующем автоматическом обходе и снова закроет игре дорогу
            await redisClient.del(`scrape:miss:${folder}`).catch(() => {});
        }
        try {
            // Защита от дубликатов (sAdd вернет 1, если элемента не было)
            const isAdded = await redisClient.sAdd('scrape:queued_set', folder);
            
            if (isAdded) {
                // Добавляем задачу в конец очереди
                await redisClient.rPush('scrape:queue', folder);
                this.processBackgroundScrape();
            }
            return !!isAdded;
        } catch (e) {
            console.error('[Queue] Ошибка добавления в Redis:', e);
        }
    }

    async processBackgroundScrape() {
        if (this.isBackgroundScraping) return;
        
        // Проверяем, есть ли задачи в очереди
        const queueLength = await redisClient.lLen('scrape:queue').catch(() => 0);
        if (queueLength === 0) return;

        this.isBackgroundScraping = true;
        
        try {
            while (await redisClient.lLen('scrape:queue') > 0) {
                // Берем самую старую задачу из начала списка
                const folder = await redisClient.lPop('scrape:queue');
                if (!folder) break;
                
                try {
                    console.log(`[Queue] ⏳ Фоновый парсинг для: ${folder}`);
                    const gamePath = path.join(this.GAMES_DIR, folder);
                    
                    // Если источник для игры уже известен (ты вставил ссылку руками либо его
                    // нашли раньше) — берём его, а не угадываем заново.
                    const saved = await this.dbService.get().get('SELECT link FROM games WHERE id = ?', [folder]);
                    const savedLink = (saved?.link || '').split(',')[0].trim();
                    const fromFolder = await this.findRJCode(folder, gamePath);
                    // Передаём оба источника одной строкой: разбор вытащит и код, и ссылку.
                    // Иначе ссылка на тему F95 «съедала» код из имени папки, и DLsite не работал.
                    const rjCode = [savedLink, fromFolder].filter(Boolean).join(' ');
                    
                    let title = folder.replace(/\[?RJ\d{6,8}\]?/gi, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim() || folder;
                    try {
                        const sys = JSON.parse(await fsp.readFile(path.join(gamePath, 'data', 'System.json'), 'utf8'));
                        if (sys.gameTitle && !sys.gameTitle.toLowerCase().includes('rmmz')) title = sys.gameTitle;
                    } catch(e) {}

                    const scrapedData = await this.fetchUniversalMetadata(title, rjCode);
                    
                    if (scrapedData && (scrapedData.tags?.length > 0 || scrapedData.description)) {
                        const tagsJson = JSON.stringify(scrapedData.tags || []);
                        const desc = scrapedData.description || '';

                        // Раньше сохранялись только теги и описание, поэтому у игр из фоновой
                        // очереди не было ни ссылки на источник, ни разработчика. Пишем всё,
                        // но только то, что реально нашлось: пустым значением затирать уже
                        // имеющееся нельзя.
                        const fields = { tags: tagsJson, description: desc, scraped: 1 };
                        if (scrapedData.developer) fields.developer = scrapedData.developer;
                        if (scrapedData.language) fields.language = scrapedData.language;
                        if (scrapedData.releaseDate) fields.releaseDate = scrapedData.releaseDate;
                        if (scrapedData.link) fields.link = scrapedData.link;   // все найденные ссылки, через запятую

                        const keys = Object.keys(fields);
                        await this.dbService.get().run(
                            `UPDATE games SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
                            [...keys.map(k => fields[k]), folder]
                        );

                        // Обложка и скриншоты: с форума они красивее, чем кадр из самой игры
                        const current = await this.dbService.get().get('SELECT cover FROM games WHERE id = ?', [folder]);
                        const media = await this.saveGameMedia(folder, scrapedData, current?.cover);
                        if (media.cover) {
                            await this.dbService.get().run('UPDATE games SET cover = ? WHERE id = ?', [media.cover, folder]);
                        }
                        if (media.screens.length) {
                            await this.dbService.get().run('UPDATE games SET screens = ? WHERE id = ?', [JSON.stringify(media.screens), folder]);
                        }

                        // Сбрасываем кэш UI, так как игра получила новые теги!
                        await invalidateGamesList();

                        await redisClient.del(`scrape:miss:${folder}`).catch(() => {});
                        if (this.io) this.io.emit('scrape-success', { message: `✅ Данные для "${title}" успешно загружены!` });
                        console.log(`[Queue] ✅ Успешно обновлено: ${folder}`);
                    } else {
                        await this.dbService.get().run('UPDATE games SET scraped = 1 WHERE id = ?', [folder]);
                        // Помним неудачу неделю, чтобы следующий массовый догон не тратил
                        // на неё запросы к источникам впустую
                        await redisClient.set(`scrape:miss:${folder}`, '1', { EX: 7 * 24 * 3600 }).catch(() => {});
                        console.log(`[Queue] ⚠️ Данные не найдены для: ${folder}`);
                    }
                } catch (e) {
                    console.error(`[Queue] ❌ Ошибка для ${folder}:`, e.message);
                } finally {
                    // Удаляем защиту от дубликатов ТОЛЬКО когда закончили обработку
                    await redisClient.sRem('scrape:queued_set', folder).catch(() => {});
                }
                
                // Показываем ход дела в интерфейсе: сколько игр ещё ждёт обработки
                const left = await redisClient.lLen('scrape:queue').catch(() => 0);
                if (this.io) this.io.emit('scrape-progress', { left });

                // Пауза, чтобы не получить бан от API
                await new Promise(r => setTimeout(r, 4000));
            }
        } finally {
            this.isBackgroundScraping = false;
            if (this.io) this.io.emit('scrape-progress', { left: 0 });
        }
    }

    // Единая точка выхода через ScraperAPI: он обходит и региональные блокировки,
    // и часовые лимиты. Но каждый запрос стоит кредита (1000 в месяц), поэтому
    // зовём его только когда бесплатный путь не сработал.
    async fetchViaScraper(url, { country = '', timeoutMs = 60000 } = {}) {
        if (!process.env.SCRAPER_API_KEY) return null;
        try {
            const proxied = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}`
                + `&url=${encodeURIComponent(url)}`
                + (country ? `&country_code=${country}` : '');
            const res = await fetch(proxied, { signal: AbortSignal.timeout(timeoutMs) });
            if (!res.ok) return null;
            return await res.text();
        } catch (e) {
            return null;
        }
    }

    // Поиск RJ-кода по названию. DLsite ищет по японским названиям, поэтому путь
    // надёжен именно для оригинальных имён игр (их берём из data/System.json).
    async findRJByTitle(title) {
        const query = String(title || '').trim();
        if (query.length < 2) return null;

        const target = `https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/${encodeURIComponent(query)}/`;
        let html = null;

        // Сначала бесплатное зеркало
        try {
            const res = await fetch(`https://r.jina.ai/${target}`, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(25000),
            });
            if (res.ok) html = await res.text();
        } catch (e) {}

        // Не вышло — платный запасной путь
        if (!html || !/RJ\d{6,8}/.test(html)) {
            html = await this.fetchViaScraper(target, { country: 'jp' });
        }
        if (!html) return null;

        // Выдача отсортирована по релевантности, поэтому берём первый код
        const match = html.match(/RJ\d{6,8}/);
        if (!match) return null;

        console.log(`[DLsite] Код по названию «${query}»: ${match[0]}`);
        return match[0].toUpperCase();
    }

    // Ищем RJ-код: в имени папки, в текстовых файлах и на пару уровней вглубь —
    // у фан-релизов код часто лежит в readme внутри вложенной папки.
    async findRJCode(folderName, gamePath) {
        const rjRegex = /RJ\d{6,8}/i;
        const direct = folderName.match(rjRegex);
        if (direct) return direct[0].toUpperCase();

        const scan = async (dir, depth = 0) => {
            if (depth > 2) return null;
            let entries;
            try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return null; }

            for (const entry of entries) {
                const inName = entry.name.match(rjRegex);
                if (inName) return inName[0];

                if (entry.isFile() && /\.(txt|md|html|json|url|nfo)$/i.test(entry.name)) {
                    const full = path.join(dir, entry.name);
                    try {
                        const stats = await fsp.stat(full);
                        if (stats.size < 300000) {
                            const inFile = (await fsp.readFile(full, 'utf8')).match(rjRegex);
                            if (inFile) return inFile[0];
                        }
                    } catch (e) {}
                }
            }

            // Папки с картинками и звуком пропускаем: кода там не бывает, а файлов тысячи
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                if (/^(img|audio|movies|fonts|effects|icon|node_modules)$/i.test(entry.name)) continue;
                const found = await scan(path.join(dir, entry.name), depth + 1);
                if (found) return found;
            }
            return null;
        };

        const found = await scan(gamePath);
        return found ? found.toUpperCase() : null;
    }

    // Обложка магазина. Отдаём буфер, а не пишем файл: решение, куда её положить,
    // принимает saveGameMedia, а внутрь папки игры мы не пишем ничего.
    async fetchDLsiteCover(rjCode) {
        const numStr = rjCode.replace(/RJ/i, '');
        const dirStr = 'RJ' + String(Math.ceil(parseInt(numStr, 10) / 1000) * 1000).padStart(numStr.length, '0');
        const urls = [
            `https://img.dlsite.jp/modpub/images2/work/doujin/${dirStr}/${rjCode}_img_main.jpg`,
            `https://img.dlsite.jp/modpub/images2/work/professional/${dirStr}/${rjCode}_img_main.jpg`
        ];
        for (const url of urls) {
            try {
                const res = await fetch(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    signal: AbortSignal.timeout(20000),
                });
                if (!res.ok) continue;
                const raw = Buffer.from(await res.arrayBuffer());
                // Магазин на несуществующий код отвечает страницей-заглушкой, поэтому
                // доверяем только тому, что действительно декодируется как картинка
                const jpeg = await this.toJpeg(raw);
                if (jpeg) return jpeg;
            } catch (e) {}
        }
        return null;
    }

    // Приводим картинку к обычному JPEG. По ссылке с расширением .jpg F95 отдаёт
    // то AVIF, то WebP, а обложкой темы бывает анимация на полтора мегабайта —
    // браузер такое либо не покажет, либо покажет мультик вместо обложки.
    // ffmpeg берёт первый кадр и заодно отсеивает битые файлы: что не декодируется,
    // то и не сохраняем.
    async toJpeg(buf) {
        // Исходник кладём во временный файл: через pipe ffmpeg не читает GIF —
        // его демультиплексору нужна перемотка, и картинка молча терялась.
        const tmp = path.join(os.tmpdir(), `rpgimg_${crypto.randomBytes(8).toString('hex')}`);
        try {
            await fsp.writeFile(tmp, buf);
            const out = await new Promise((resolve) => {
                const proc = spawn('ffmpeg', [
                    '-v', 'error', '-i', tmp, '-frames:v', '1',
                    '-vf', "scale='min(1600,iw)':-2", '-q:v', '3', '-f', 'mjpeg', 'pipe:1',
                ]);
                const chunks = [];
                proc.stdout.on('data', (d) => chunks.push(d));
                proc.on('close', () => resolve(chunks.length ? Buffer.concat(chunks) : null));
                proc.on('error', () => resolve(null));
            });
            return out && out.length > 1024 ? out : null;
        } catch (e) {
            return null;
        } finally {
            await fsp.unlink(tmp).catch(() => {});
        }
    }

    // Размер кадра читаем прямо из заголовка JPEG (маркер SOF), без лишнего процесса.
    // Нужен, чтобы отличить настоящий скриншот от превью 400×250 и от значка под темой.
    jpegSize(buf) {
        for (let i = 2; i + 9 < buf.length;) {
            if (buf[i] !== 0xff) { i += 1; continue; }
            const marker = buf[i + 1];
            if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
            const len = buf.readUInt16BE(i + 2);
            const isSOF = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
            if (isSOF) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
            i += 2 + len;
        }
        return { width: 0, height: 0 };
    }

    // Грубый отпечаток картинки: уменьшаем до 16×16 в оттенках серого и сравниваем
    // каждую точку со средней яркостью. Одна и та же картинка в разных файлах даёт
    // почти одинаковый код, разные — расходятся на сотню бит. ffmpeg у нас уже есть.
    async imageFingerprint(buf) {
        const raw = await new Promise((resolve) => {
            const proc = spawn('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-vf', 'scale=16:16', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1']);
            const chunks = [];
            proc.stdout.on('data', (d) => chunks.push(d));
            proc.on('close', () => resolve(chunks.length ? Buffer.concat(chunks) : null));
            proc.on('error', () => resolve(null));
            proc.stdin.on('error', () => {});
            proc.stdin.end(buf);
        });
        if (!raw || raw.length < 64) return null;

        const mean = raw.reduce((sum, v) => sum + v, 0) / raw.length;
        return [...raw].map((v) => (v > mean ? 1 : 0));
    }

    // Картинки складываем в отдельную папку _media, а не внутрь игры: папки игр
    // мы не трогаем принципиально, да и на проде они бывают только для чтения.
    async saveGameMedia(folder, data, currentCover) {
        const result = { cover: null, screens: [] };
        const dir = path.join(this.GAMES_DIR, '_media', folder);

        try {
            await fsp.mkdir(dir, { recursive: true });
        } catch (e) {
            return result;
        }

        // Скачиваем в память и считаем отпечаток: источники любят отдавать обложку
        // ещё раз первым семплом, а платные страницы — одну и ту же заглушку.
        const seen = new Set();          // точные совпадения по содержимому
        const prints = [];               // отпечатки: ловят одну картинку в разных файлах
        const TOO_CLOSE = 6;             // расстояние, ниже которого считаем картинку повтором

        const remember = async (buf) => {
            const print = await this.imageFingerprint(buf);
            if (!print) return true;     // ffmpeg не справился — не мешаем сохранению
            const duplicate = prints.some((old) => old.reduce((n, v, i) => n + (v !== print[i] ? 1 : 0), 0) <= TOO_CLOSE);
            if (duplicate) return false;
            prints.push(print);
            return true;
        };

        // minWidth отсекает мелочь: превью форума (400 px), значки движка и баннеры
        // под шапкой темы. Настоящий кадр из игры всегда шире.
        const grab = async (url, { minWidth = 0 } = {}) => {
            try {
                const res = await fetch(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' },
                    signal: AbortSignal.timeout(30000),
                });
                if (!res.ok) return null;
                const raw = Buffer.from(await res.arrayBuffer());
                if (raw.length < 2048 || raw.length > 25 * 1024 * 1024) return null;

                const hash = crypto.createHash('md5').update(raw).digest('hex');
                if (seen.has(hash)) return null;
                seen.add(hash);

                const buf = await this.toJpeg(raw);
                if (!buf) return null;

                const { width, height } = this.jpegSize(buf);
                if (width < minWidth || height < Math.round(minWidth / 2)) return null;

                if (!await remember(buf)) return null;
                return buf;
            } catch (e) {
                return null;
            }
        };

        // Обложка: сначала магазин — она официальная и не повторяет семплы. Картинка
        // темы идёт только запасным вариантом. Свою загруженную не трогаем никогда.
        const isManual = /cover_custom/i.test(currentCover || '');
        let coverUrlUsed = false;
        if (!isManual) {
            const dest = path.join(dir, 'cover.jpg');
            let saved = data.rjCode ? await this.fetchDLsiteCover(data.rjCode) : null;

            if (!saved && data.coverUrl) {
                saved = await grab(data.coverUrl, { minWidth: 300 });
                coverUrlUsed = !!saved;
            }

            if (saved) {
                await fsp.writeFile(dest, saved);
                await remember(saved);   // чтобы тот же рисунок не приехал первым семплом
                result.cover = `_media/${folder}/cover.jpg`;
            }
        }

        // Картинка из шапки темы — такой же кадр из игры. Если обложку дал магазин,
        // она осталась неиспользованной, и в галерее не хватало одного скриншота.
        const shots = [...(data.screens || [])];
        if (data.coverUrl && !coverUrlUsed) shots.unshift(data.coverUrl);

        // Сначала собираем кадры в памяти и только потом переписываем папку: если в
        // этот раз ничего не нашлось, старая галерея останется на месте, а если
        // нашлось меньше прежнего — в папке не останется хвостов от прошлого разбора.
        const picked = [];
        for (const url of shots) {
            if (picked.length >= 6) break;
            // 500 px — граница между превью форума (400×250) и настоящей картинкой:
            // семплы магазина идут как раз 560×420, их терять нельзя
            const buf = await grab(url, { minWidth: 500 });
            if (buf) picked.push(buf);
        }

        if (picked.length) {
            for (const f of await fsp.readdir(dir).catch(() => [])) {
                if (/^\d+\.jpg$/i.test(f)) await fsp.unlink(path.join(dir, f)).catch(() => {});
            }
            for (let i = 0; i < picked.length; i += 1) {
                const name = `${i + 1}.jpg`;
                await fsp.writeFile(path.join(dir, name), picked[i]);
                result.screens.push(`_media/${folder}/${name}`);
            }
        }
        return result;
    }


    async translateText(text, targetLang = 'en') {
        if (!text) return '';
        // В адрес запроса помещается около 1300 символов, поэтому длинный текст режем на куски
        const chunks = String(text).match(/[\s\S]{1,1200}/g) || [];
        const parts = [];
        try {
            for (const chunk of chunks) {
                // client=dict-chrome-ex вместо gtx: gtx с нашего адреса отвечает 429 (нас ограничивают)
                const url = `https://translate.googleapis.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${targetLang}&q=${encodeURIComponent(chunk)}`;
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 8000);
                try {
                    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const data = await res.json();
                    // Ответ бывает двух видов: [["перевод","ja"]] и ["перевод"]
                    parts.push(data.map(item => (Array.isArray(item) ? item[0] : item)).join(''));
                } finally {
                    clearTimeout(timer);
                }
            }
            return parts.join('');
        } catch (e) {
            console.warn('[Translate] Не удалось перевести:', e.message);
            return text; // отдаём оригинал, как и раньше
        }
    }

    async fetchViaJapanProxy(url) {
        if (process.env.SCRAPER_API_KEY) {
            try {
                const scraperUrl = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&country_code=jp`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000); 
                const res = await fetch(scraperUrl, { signal: controller.signal });
                clearTimeout(timeoutId);
                const data = await res.json();
                if (data?.[0]?.work_name) return data;
            } catch (e) {}
        }

        try {
            let proxies = [];
            const sources = [
                fetch('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=JP'),
                fetch('https://www.proxy-list.download/api/v1/get?type=http&country=JP'),
                fetch('https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt'),
                fetch('https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt')
            ];
            const results = await Promise.allSettled(sources);
            for (const res of results) {
                if (res.status === 'fulfilled' && res.value.ok) {
                    const text = await res.value.text();
                    const matches = text.match(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]+\b/g);
                    if (matches) proxies.push(...matches);
                }
            }
            try {
                const geoRes = await fetch('https://proxylist.geonode.com/api/proxy-list?country=JP&protocols=http&limit=100');
                if (geoRes.ok) {
                    const geoJson = await geoRes.json();
                    if (geoJson.data) proxies.push(...geoJson.data.map(p => `${p.ip}:${p.port}`));
                }
            } catch (e) {}

            proxies = [...new Set(proxies)].sort(() => Math.random() - 0.5);
            if (proxies.length === 0) return null;

            const maxConcurrent = Math.min(30, proxies.length);
            const promises = proxies.slice(0, maxConcurrent).map((proxy) => {
                return new Promise(async (resolve, reject) => {
                    try {
                        const { stdout } = await execFilePromise('curl', ['-sS', '-L', '-m', '10', '-x', `http://${proxy}`, '-H', 'User-Agent: Mozilla/5.0', url]);
                        const data = JSON.parse(stdout); 
                        if (data?.[0]?.work_name) resolve(data);
                        else reject(new Error('Пустой ответ'));
                    } catch (e) { reject(e); }
                });
            });

            return await Promise.any(promises);
        } catch (e) {}
        return null;
    }

    async processParsedData(gameData, rjCode) {
        const tags = gameData.genres ? gameData.genres.map(g => g.name) : [];
        let description = (gameData.intro_s || gameData.intro || '').replace(/<[^>]*>?/gm, '').trim();

        const developer = gameData.maker_name || '';
        const releaseDate = gameData.regist_date ? gameData.regist_date.split(' ')[0] : '';
        const link = `https://www.dlsite.com/home/work/=/product_id/${rjCode}.html`;
        const language = 'Japanese';

        // Кадры магазина лежат прямо в ответе: адреса точные, гадать по шаблону
        // не нужно, а у работ без семплов поле пустое — значит и брать нечего
        const screens = (Array.isArray(gameData.image_samples) ? gameData.image_samples : [])
            .map(x => String(x?.url || '').replace(/^\/\//, 'https://'))
            .filter(Boolean)
            .slice(0, 6);

        if (tags.length > 0 || description || developer) {
            const translatedDesc = await this.translateText(description, 'en');
            const finalData = { 
                tags: [...new Set(tags)], 
                description: translatedDesc,
                developer,
                releaseDate,
                language,
                link,
                screens
            };
            
            // --- НОВОЕ: Сохраняем теги в Redis на 24 часа ---
            await redisClient.set(`dlsite:${rjCode}`, JSON.stringify(finalData), { EX: 86400 }).catch(()=>{}); 
            
            return finalData;
        }
        return null;
    }

    // Один запрос к посреднику: DLsite блокирует наш регион (прямой запрос уводит на google.com)
    async fetchDLsiteJson(url, timeoutMs = 5000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const text = await res.text();
            // r.jina.ai отдаёт JSON внутри текста, поэтому вырезаем массив из ответа
            const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
            const data = JSON.parse(match ? match[0] : text);
            if (!data?.[0]?.work_name) throw new Error('пустой ответ');
            return data;
        } finally {
            clearTimeout(timer);
        }
    }

    async executeFetchDLsiteTags(rjCode) {
        try {
            const cached = await redisClient.get(`dlsite:${rjCode}`);
            if (cached) {
                console.log(`[Redis] ⚡ Кэш DLsite найден для ${rjCode}`);
                return JSON.parse(cached);
            }
        } catch (e) {}

        const targetUrl = `https://www.dlsite.com/maniax/api/=/product.json?workno=${rjCode}&locale=en_US`;
        const gateways = [
            `https://r.jina.ai/${targetUrl}`,
            `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
        ];

        // Пробуем посредников ОДНОВРЕМЕННО: побеждает первый ответивший, а не сумма таймаутов
        try {
            const data = await Promise.any(gateways.map(url => this.fetchDLsiteJson(url)));
            return await this.processParsedData(data[0], rjCode);
        } catch (e) {}

        // Не вышло — платный ScraperAPI и бесплатные японские прокси: надёжно, но медленно
        const jpData = await this.fetchViaJapanProxy(targetUrl);
        if (jpData?.[0]?.work_name) return await this.processParsedData(jpData[0], rjCode);
        return null;
    }

    async fetchVNDBMetadata(query) {
        try {
            let filter = ["search", "=", query];
            if (/^v\d+$/.test(query)) {
                filter = ["id", "=", query]; 
            }
            const res = await fetch('https://api.vndb.org/kana/vn', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filters: filter, fields: "title, description, image.url, tags.name" })
            });
            const data = await res.json();
            if (data.results && data.results.length > 0) {
                const vn = data.results[0];
                
                if (!/^v\d+$/.test(query)) {
                    const vnTitle = vn.title.toLowerCase().replace(/[^a-z0-9а-яぁ-んァ-ン一-龯]/gi, '')
                    const searchTitle = query.toLowerCase().replace(/[^a-z0-9а-яぁ-んァ-ン一-龯]/gi, '')
                    if (!vnTitle.includes(searchTitle) && !searchTitle.includes(vnTitle)) {
                        return null; 
                    }
                }

                let desc = (vn.description || '').replace(/\[\/?(b|i|u|url|spoiler|quote)[^\]]*\]/gi, '').trim();
                return { 
                    coverUrl: vn.image ? vn.image.url : null, 
                    description: desc, 
                    tags: vn.tags ? vn.tags.map(t => t.name) : [],
                    releaseDate: vn.released ? vn.released.substring(0, 4) : '',
                    link: `https://vndb.org/${vn.id}`,
                    developer: '',
                    language: ''
                };
            }
        } catch (e) {}
        return null;
    }

    // Теги с F95: страница темы отдаёт их обычными ссылками вида /tags/имя/.
    // Работаем только по прямой ссылке — их поиск режет анонимные запросы по часам,
    // да и ссылку человек даёт сам, значит совпадение точное, без угадывания по названию.
    // Поиск темы по RJ-коду через поиск форума. Код живёт в тексте сообщения, а не в
    // заголовке, поэтому каталог его не находит. Форумный поиск доступен только
    // залогиненным и устроен в два шага: форма с токеном, затем страница результатов.
    async fetchF95ByForumSearch(rjCode) {
        if (!rjCode || !f95Cookie()) return null;

        const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
        // Корзинка cookie: форум выдаёт свою сессию и csrf, и токен действителен только
        // вместе с ними. Без возврата этих значений отправка формы отвечает 400.
        const jar = new Map(
            f95Cookie().split(';').map(s => s.trim().split('=')).filter(p => p[0]).map(p => [p[0], p.slice(1).join('=')])
        );
        const cookieStr = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
        const absorb = (res) => {
            for (const line of (res.headers.getSetCookie?.() || [])) {
                const [pair] = line.split(';');
                const i = pair.indexOf('=');
                if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
            }
        };

        try {
            const formRes = await fetch('https://f95zone.to/search/', {
                headers: { 'User-Agent': UA, Cookie: cookieStr() },
                signal: AbortSignal.timeout(25000),
            });
            if (!formRes.ok) return null;
            absorb(formRes);
            const token = ((await formRes.text()).match(/name="_xfToken"\s+value="([^"]+)"/) || [])[1];
            if (!token) return null;

            const res = await fetch('https://f95zone.to/search/search', {
                method: 'POST',
                headers: {
                    'User-Agent': UA,
                    Cookie: cookieStr(),
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Referer: 'https://f95zone.to/search/',
                },
                body: new URLSearchParams({ keywords: rjCode, _xfToken: token }),
                redirect: 'follow',
                signal: AbortSignal.timeout(30000),
            });
            if (!res.ok) return null;
            const html = await res.text();

            // Выдача уже отсортирована по релевантности, поэтому порядок сохраняем,
            // а отбрасываем только очевидно не те темы: просьбы о переводе, сборники,
            // обсуждения. Проверять код на странице темы бесполезно — поиск находит его
            // в сообщении, которое может лежать на десятой странице обсуждения.
            const blocks = html.split('contentRow').slice(1);
            const seen = new Set();
            const candidates = [];
            for (const block of blocks) {
                const link = (block.match(/\/threads\/[a-z0-9\-\.]+/i) || [])[0];
                if (!link || seen.has(link)) continue;
                seen.add(link);
                if (/(translation|request|resources|discussion|traduc|collection|compilation)/i.test(link)) continue;
                const engine = /RPGM|RenPy|Unity|Wolf RPG/i.test(block) ? 1 : 0;
                candidates.push({ link, engine });
            }
            // Стабильная сортировка: тема с меткой движка выигрывает у темы без неё,
            // при равенстве побеждает та, что выше в выдаче
            candidates.sort((a, b) => b.engine - a.engine);

            for (const c of candidates.slice(0, 2)) {
                const data = await this.fetchF95Metadata(`https://f95zone.to${c.link}/`);
                if (!data || !data.tags.length) continue;
                // Поиск находит код и в теме про другую игру того же автора (он ссылается
                // на свою страницу в магазине). Если в шапке есть коды и нашего среди них
                // нет — это не та игра, и её картинки с тегами брать нельзя.
                const codes = [...new Set((data.raw.match(/RJ\d{6,8}/gi) || []).map(x => x.toUpperCase()))];
                if (codes.length && !codes.includes(rjCode.toUpperCase())) {
                    console.log(`[F95] Тема ${c.link} про другой код (${codes.join(', ')}) — пропускаем`);
                    continue;
                }
                console.log(`[F95] Тема по коду ${rjCode}: ${c.link}`);
                return { tags: data.tags, link: data.link, rjCode: data.rjCode, coverUrl: data.coverUrl, screens: data.screens };
            }
        } catch (e) {}
        return null;
    }

    // Кандидаты для ручного выбора. Порога совпадения здесь нет намеренно: решает человек,
    // а он различает «ту самую» игру лучше любой формулы.
    async searchF95Candidates(query) {
        // Та же очистка и те же варианты, что и в автопоиске: «Karryn's Prison - dev»
        // их поиск не находит, а «Karryn's Prison» — находит.
        const queries = this.buildF95Queries(cleanTitle(query)).slice(0, 3);
        const found = new Map();

        for (const q of queries) {
            const url = `https://f95zone.to/sam/latest_alpha/latest_data.php?cmd=list&cat=games&page=1&rows=12&search=${encodeURIComponent(q)}`;
            const headers = { 'User-Agent': 'Mozilla/5.0' };
            if (f95Cookie()) headers.Cookie = f95Cookie();

            let data = null;
            try {
                const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
                data = await res.json();
            } catch (e) {}

            // Лимит анонимных запросов или сетевая ошибка — пробуем через ScraperAPI
            if (!data || typeof data.msg === 'string') {
                const viaScraper = await this.fetchViaScraper(url);
                try { data = viaScraper ? JSON.parse(viaScraper) : data; } catch (e) {}
            }

            for (const item of (data?.msg?.data || [])) {
                if (!found.has(item.thread_id)) found.set(item.thread_id, item);
            }
            if (found.size >= 8) break;
        }

        return [...found.values()].slice(0, 8).map(item => ({
            title: item.title,
            creator: item.creator,
            version: item.version,
            tags: (item.tags || []).length,
            rating: item.rating,
            url: `https://f95zone.to/threads/${item.thread_id}/`,
        }));
    }

    // Поиск темы по RJ-коду через поиск форума. Код живёт в тексте сообщения, а не в
    // заголовке, поэтому каталог его не находит — а форумный поиск находит. Но он
    // доступен только залогиненным, поэтому работает лишь при заданном F95_COOKIE.
    buildF95Queries(title) {
        const out = [];
        const push = (s) => {
            const clean = String(s).replace(/[^\w\s]/g, ' ').replace(/\s{2,}/g, ' ').trim();
            if (clean.length >= 4 && !out.some(x => x.toLowerCase() === clean.toLowerCase())) out.push(clean);
        };
        push(title);
        for (const sep of [':', ' - ', '~', ',']) {
            if (title.includes(sep)) push(title.split(sep)[0]);
        }
        // Их поиск спотыкается о предлоги: «Noble of Pride» не находит ничего,
        // а «Noble Pride» — находит нужную тему.
        const STOP = /^(of|the|a|an|and|in|on|for|to|de|le|la)$/i;
        const meaningful = title.split(/\s+/).filter(w => !STOP.test(w));
        if (meaningful.length >= 2) push(meaningful.join(' '));

        const words = title.split(/\s+/);
        if (words.length > 4) push(words.slice(0, 4).join(' '));
        if (words.length > 2) push(words.slice(0, 2).join(' '));
        return out;
    }

    // Автопоиск на F95 по названию. Их API ограничивает анонимные запросы по часам,
    // поэтому без F95_COOKIE пробуем меньше вариантов.
    async fetchF95ByTitle(title) {
        const hasCookie = !!f95Cookie();
        const queries = this.buildF95Queries(title).slice(0, hasCookie ? 4 : 2);
        let best = null, score = 0, usedQuery = '';

        for (const q of queries) {
            try {
                const url = `https://f95zone.to/sam/latest_alpha/latest_data.php?cmd=list&cat=games&page=1&rows=15&search=${encodeURIComponent(q)}`;
                const headers = { 'User-Agent': 'Mozilla/5.0' };
                if (hasCookie) headers.Cookie = process.env.F95_COOKIE;

                const res = await fetch(url, { headers });
                let data = await res.json();

                // Лимит анонимных запросов исчерпан — пробуем тот же запрос через ScraperAPI
                if (typeof data?.msg === 'string') {
                    const viaScraper = await this.fetchViaScraper(url);
                    try { data = viaScraper ? JSON.parse(viaScraper) : data; } catch (e) {}
                }
                if (typeof data?.msg === 'string') {
                    console.warn('[F95] Лимит исчерпан и обойти не удалось:', data.msg.slice(0, 50));
                    break;
                }
                for (const item of (data?.msg?.data || [])) {
                    const s = titleSimilarity(title, item.title);
                    if (s > score) { best = item; score = s; usedQuery = q; }
                }
                // Точное совпадение — дальше искать незачем, экономим запросы
                if (score >= 0.9) break;
            } catch (e) {
                // сеть или Cloudflare — просто пробуем следующий вариант
            }
        }

        // Порог высокий намеренно: лучше не найти ничего, чем приписать чужие теги
        if (!best || score < 0.75) return null;

        console.log(`[F95] Совпадение ${score.toFixed(2)} по запросу «${usedQuery}»: «${title}» → «${best.title}»`);
        const page = await this.fetchF95Metadata(`https://f95zone.to/threads/${best.thread_id}/`);
        if (!page) return null;
        // У каталога картинки аккуратнее, чем у разбора страницы: там обложка и семплы
        return {
            ...page,
            coverUrl: fullSizeImage(best.cover || page.coverUrl || ''),
            screens: (best.screens && best.screens.length ? best.screens : page.screens || []).slice(0, 6).map(fullSizeImage),
        };
    }

    async fetchF95Metadata(threadUrl) {
        try {
            const res = await fetch(threadUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                redirect: 'follow',
                signal: AbortSignal.timeout(30000),
            });
            if (!res.ok) return null;

            const html = await res.text();
            const tags = [...new Set(
                [...html.matchAll(/href="\/tags\/[^"]+\/"[^>]*>([^<]+)</g)].map(m => m[1].trim())
            )];
            if (!tags.length) return null;

            // В шапке темы часто стоит ссылка на DLsite — вытаскиваем код, он даст
            // описание, разработчика и дату, которых на форуме нет
            const rjCode = (html.match(/RJ\d{6,8}/i) || [])[0];

            // Картинки шапки лежат на поддоменах F95. Первая обычно и есть обложка.
            const images = [...new Set(
                (html.match(/https:\/\/(?:preview|attachments)\.f95zone\.to\/[^\s"'<)]+\.(?:jpg|jpeg|png|webp)/gi) || [])
                    .map(fullSizeImage)
            )];

            return {
                tags,
                link: res.url || threadUrl,
                raw: html,
                rjCode: rjCode ? rjCode.toUpperCase() : null,
                coverUrl: images[0] || '',
                screens: images.slice(1, 7),
            };
        } catch (e) {
            return null;
        }
    }

    async fetchSteamMetadata(query) {
        try {
            let appId = query;
            if (!/^\d+$/.test(query)) {
                const searchRes = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`, { headers: STEAM_HEADERS });
                const searchData = await searchRes.json();
                if (searchData.total > 0 && searchData.items?.length > 0) {
                    const item = searchData.items[0];
                    
                    const steamTitle = item.name.toLowerCase().replace(/[^a-z0-9а-яぁ-んァ-ン一-龯]/gi, '')
                    const searchTitle = query.toLowerCase().replace(/[^a-z0-9а-яぁ-んァ-ン一-龯]/gi, '')
                    
                    if (!steamTitle.includes(searchTitle) && !searchTitle.includes(steamTitle)) {
                        return null; 
                    }
                    appId = item.id;
                } else {
                    return null;
                }
            }
            
            const detailRes = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&cc=US&l=english`, { headers: STEAM_HEADERS });
            const detailData = await detailRes.json();
            if (detailData[appId]?.success) {
                const game = detailData[appId].data;
                const desc = (game.short_description || game.about_the_game || '').replace(/<[^>]*>?/gm, '').trim();

                // Обложка: сначала вертикальная витрина 600×900 — она по форме как
                // остальные обложки в сетке. Широкий баннер шапки оставляем запасным:
                // у карточки он выглядит полоской.
                let coverUrl = game.header_image;
                try {
                    const capsule = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
                    const head = await fetch(capsule, { method: 'HEAD', headers: STEAM_HEADERS, signal: AbortSignal.timeout(10000) });
                    if (head.ok) coverUrl = capsule;
                } catch (e) {}

                return { 
                    coverUrl, 
                    // Кадры из игры магазин отдаёт прямо в ответе, а мы их не брали —
                    // у игр из Steam галерея всегда оставалась пустой
                    screens: (game.screenshots || []).slice(0, 6).map(x => x.path_full).filter(Boolean),
                    description: desc, 
                    tags: game.genres ? game.genres.map(g => g.description) : [],
                    developer: game.developers ? game.developers.join(', ') : '',
                    releaseDate: game.release_date?.date ? (game.release_date.date.match(/\d{4}/)?.[0] || '') : '',
                    link: `https://store.steampowered.com/app/${appId}`,
                    language: 'Multi'
                };
            }
        } catch (e) {}
        return null;
    }

    async fetchUniversalMetadata(title, inputQuery) {
        const aggregatedData = {
            tags: [], description: '', coverUrl: '', screens: [], developer: '', releaseDate: '', language: '',
            links: []
        };
        let foundAny = false;

        let explicitRj = null;
        let explicitF95 = null;
        let explicitSteam = null;
        let explicitVndb = null;

        if (inputQuery) {
            if (inputQuery.match(/RJ\d{6,8}/i)) explicitRj = inputQuery.match(/RJ\d{6,8}/i)[0].toUpperCase();
            if (inputQuery.match(/app\/(\d+)/i)) explicitSteam = inputQuery.match(/app\/(\d+)/i)[1];
            if (inputQuery.match(/v(\d+)/i) && inputQuery.includes('vndb')) explicitVndb = 'v' + inputQuery.match(/v(\d+)/i)[1];
            // Сюда часто приходит не одна ссылка, а «ссылка на тему + RJ-код» одной
            // строкой (так их склеивает фоновая очередь). Целиком это не URL, и
            // запрос по нему падал — игра уходила в неточный поиск по названию.
            const f95Link = inputQuery.match(/https?:\/\/[^\s,]*f95zone\.to\/threads\/[^\s,]+/i);
            if (f95Link) explicitF95 = f95Link[0];
        }

        const searchTitle = cleanTitle(title);
        
        if (explicitF95) {
            const f95Data = await this.fetchF95Metadata(explicitF95);
            if (f95Data) {
                foundAny = true;
                // Теги F95 нормализованы, поэтому они важнее дробных жанров DLsite
                aggregatedData.tags = f95Data.tags;
                aggregatedData.links.push(f95Data.link);
                // Картинки с форума в приоритете: там оформленная обложка и семплы
                if (f95Data.coverUrl) aggregatedData.coverUrl = f95Data.coverUrl;
                if (f95Data.screens?.length) aggregatedData.screens = f95Data.screens;
                // Нашли код в шапке — дальше отработает DLsite и добавит описание
                if (!explicitRj && f95Data.rjCode) explicitRj = f95Data.rjCode;
            }
        }
        // Автопоиск на F95 по названию — первым источником, но только если теги ещё не нашлись.
        // Его словарь самый аккуратный, поэтому он в приоритете; при неуверенном совпадении
        // функция вернёт null и мы спокойно пойдём дальше по остальным источникам.
        if (!explicitF95 && !aggregatedData.tags.length && searchTitle.length >= 4) {
            const f95Auto = await this.fetchF95ByTitle(searchTitle);
            if (f95Auto) {
                foundAny = true;
                aggregatedData.tags = f95Auto.tags;
                aggregatedData.links.push(f95Auto.link);
                if (f95Auto.coverUrl) aggregatedData.coverUrl = f95Auto.coverUrl;
                if (f95Auto.screens?.length) aggregatedData.screens = f95Auto.screens;
                if (!explicitRj && f95Auto.rjCode) explicitRj = f95Auto.rjCode;
            }
        }

        // Кода нет ни в поле ввода, ни в имени папки? Для японских названий его можно
        // найти поиском по DLsite — дальше отработает обычный конвейер.
        if (!explicitRj && /[\u3040-\u30ff\u4e00-\u9fff]/.test(title)) {
            explicitRj = await this.findRJByTitle(title);
        }

        // Код известен, тегов ещё нет — ищем тему на форуме по коду (нужен F95_COOKIE).
        // Совпадение точное: код проверяется на самой странице темы.
        if (explicitRj && !aggregatedData.tags.length) {
            const byRj = await this.fetchF95ByForumSearch(explicitRj);
            if (byRj) {
                foundAny = true;
                aggregatedData.tags = byRj.tags;
                aggregatedData.links.push(byRj.link);
                if (byRj.coverUrl) aggregatedData.coverUrl = byRj.coverUrl;
                if (byRj.screens?.length) aggregatedData.screens = byRj.screens;
            }
        }

        if (explicitRj) {
            const dlsiteData = await this.executeFetchDLsiteTags(explicitRj);
            if (dlsiteData) {
                foundAny = true;
                if (!aggregatedData.tags.length) aggregatedData.tags = dlsiteData.tags || [];
                aggregatedData.description = dlsiteData.description || '';
                aggregatedData.developer = dlsiteData.developer || '';
                aggregatedData.releaseDate = dlsiteData.releaseDate || '';
                aggregatedData.language = dlsiteData.language || '';
                if (dlsiteData.link) aggregatedData.links.push(dlsiteData.link);
                // Картинки форума в приоритете, но если их нет — берём семплы магазина
                if (!aggregatedData.screens.length && dlsiteData.screens?.length) aggregatedData.screens = dlsiteData.screens;
            }
        }

        const vndbQuery = explicitVndb || searchTitle;
        if (vndbQuery && vndbQuery.length >= 3) {
            const vndbData = await this.fetchVNDBMetadata(vndbQuery);
            if (vndbData) {
                foundAny = true;
                if (vndbData.link) aggregatedData.links.push(vndbData.link);
                if (aggregatedData.tags.length === 0 && vndbData.tags) aggregatedData.tags = vndbData.tags;
                aggregatedData.coverUrl = aggregatedData.coverUrl || vndbData.coverUrl || '';
                aggregatedData.description = aggregatedData.description || vndbData.description || '';
                aggregatedData.developer = aggregatedData.developer || vndbData.developer || '';
                aggregatedData.releaseDate = aggregatedData.releaseDate || vndbData.releaseDate || '';
            }
        }

        const steamQuery = explicitSteam || searchTitle; 
        if (steamQuery && steamQuery.length >= 3) {
            const steamData = await this.fetchSteamMetadata(steamQuery);
            if (steamData) {
                foundAny = true;
                if (steamData.link) aggregatedData.links.push(steamData.link);
                if (aggregatedData.tags.length === 0 && steamData.tags) aggregatedData.tags = steamData.tags;
                
                aggregatedData.coverUrl = aggregatedData.coverUrl || steamData.coverUrl || '';
                if (!aggregatedData.screens.length && steamData.screens?.length) aggregatedData.screens = steamData.screens;
                aggregatedData.description = aggregatedData.description || steamData.description || '';
                aggregatedData.developer = aggregatedData.developer || steamData.developer || '';
                aggregatedData.releaseDate = aggregatedData.releaseDate || steamData.releaseDate || '';
                aggregatedData.language = aggregatedData.language || steamData.language || '';
            }
        }

        if (!foundAny) return null;

        aggregatedData.tags = [...new Set(aggregatedData.tags)];
        aggregatedData.link = [...new Set(aggregatedData.links)].join(',');
        // Код нужен дальше для обложки из магазина. Раньше он терялся здесь, и
        // обложка всегда приезжала с форума, даже когда DLsite был известен.
        aggregatedData.rjCode = explicitRj || null;
        
        return aggregatedData;
    }
}

module.exports = new ScraperService();