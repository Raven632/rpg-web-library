const fsp = require('fs').promises;
const path = require('path');
const util = require('util');
const { execFile } = require('child_process');
const execFilePromise = util.promisify(execFile);

const TAGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const dlsiteTagCache = new Map();

class ScraperService {
    constructor() {
        this.backgroundScrapeQueue = [];
        this.queuedScrapes = new Set();
        this.isBackgroundScraping = false;
        this.io = null;
        this.GAMES_DIR = '';
        this.dbService = null; // <-- Добавили слот для базы
    }

    setDependencies(io, gamesDir, dbService) { // <-- Принимаем базу
        this.io = io;
        this.GAMES_DIR = gamesDir;
        this.dbService = dbService; // <-- Сохраняем
    }

    queueScrape(folder) {
        if (!this.queuedScrapes.has(folder)) {
            this.queuedScrapes.add(folder);
            this.backgroundScrapeQueue.push(folder);
            this.processBackgroundScrape();
        }
    }

    async processBackgroundScrape() {
        if (this.isBackgroundScraping || this.backgroundScrapeQueue.length === 0) return;
        this.isBackgroundScraping = true;
        
        while (this.backgroundScrapeQueue.length > 0) {
            const folder = this.backgroundScrapeQueue.shift();
            
            try {
                console.log(`[Queue] ⏳ Фоновый парсинг для: ${folder}`);
                const gamePath = path.join(this.GAMES_DIR, folder);
                
                const rjCode = await this.findRJCode(folder, gamePath);
                
                let title = folder.replace(/\[?RJ\d{6,8}\]?/gi, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim() || folder;
                try {
                    const sys = JSON.parse(await fsp.readFile(path.join(gamePath, 'data', 'System.json'), 'utf8'));
                    if (sys.gameTitle && !sys.gameTitle.toLowerCase().includes('rmmz')) title = sys.gameTitle;
                } catch(e) {}

                const scrapedData = await this.fetchUniversalMetadata(title, rjCode);
                
                if (scrapedData && (scrapedData.tags?.length > 0 || scrapedData.description)) {
                    const tagsJson = JSON.stringify(scrapedData.tags || []);
                    const desc = scrapedData.description || '';

                    // Используем this.dbService вместо глобального импорта
                    await this.dbService.get().run('UPDATE games SET tags = ?, description = ?, scraped = 1 WHERE id = ?', [tagsJson, desc, folder]);
                    
                    if (scrapedData.coverUrl) {
                        const current = await this.dbService.get().get('SELECT cover FROM games WHERE id = ?', [folder]);
                        if (!current?.cover) {
                            if (await this.downloadRemoteCover(scrapedData.coverUrl, path.join(gamePath, 'cover.jpg'))) {
                                await this.dbService.get().run('UPDATE games SET cover = ? WHERE id = ?', [`${folder}/cover.jpg`, folder]);
                            }
                        }
                    }

                    if (this.io) this.io.emit('scrape-success', { message: `✅ Данные для "${title}" успешно загружены!` });
                    console.log(`[Queue] ✅ Успешно обновлено: ${folder}`);
                } else {
                    await this.dbService.get().run('UPDATE games SET scraped = 1 WHERE id = ?', [folder]);
                    console.log(`[Queue] ⚠️ Данные не найдены для: ${folder}`);
                }
            } catch (e) {
                console.error(`[Queue] ❌ Ошибка для ${folder}:`, e.message);
            } finally {
                this.queuedScrapes.delete(folder); 
            }
            
            await new Promise(r => setTimeout(r, 4000));
        }
        this.isBackgroundScraping = false;
    }

    async findRJCode(folderName, gamePath) {
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

    async fetchDLsiteCover(rjCode, destPath) {
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

    async downloadRemoteCover(url, destPath) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (res.ok) {
                await fsp.writeFile(destPath, Buffer.from(await res.arrayBuffer()));
                return true;
            }
        } catch (e) {}
        return false;
    }

    async translateText(text, targetLang = 'en') {
        if (!text) return '';
        try {
            const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`);
            const data = await res.json();
            return data[0].map(item => item[0]).join('');
        } catch (e) { return text; }
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

        if (tags.length > 0 || description || developer) {
            const translatedDesc = await this.translateText(description, 'en');
            const finalData = { 
                tags: [...new Set(tags)], 
                description: translatedDesc,
                developer,
                releaseDate,
                language,
                link
            };
            dlsiteTagCache.set(rjCode, { data: finalData, expiresAt: Date.now() + TAGS_CACHE_TTL_MS }); 
            return finalData;
        }
        return null;
    }

    async executeFetchDLsiteTags(rjCode) {
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
                    const res = await fetch(gateway, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    const text = await res.text(); // сначала text, не json
                    console.log(`[DLsite] Gateway ${gateway} → status ${res.status}, body начало: ${text.slice(0, 200)}`);
                    const data = JSON.parse(text);
                    if (data?.[0]?.work_name) return await this.processParsedData(data[0], rjCode);
                } catch (e) {
                    console.log(`[DLsite] Gateway FAIL:`, e.message);
                }
            }
        }
        const jpUrl = `https://www.dlsite.com/maniax/api/=/product.json?workno=${rjCode}&locale=en_US`;
        const jpData = await this.fetchViaJapanProxy(jpUrl);
        if (jpData?.[0]?.work_name) return await this.processParsedData(jpData[0], rjCode);
        return null;
    }

    async fetchVNDBMetadata(query) {
        try {
            let filter = ["search", "=", query];
            // Если передан точный ID (например v1234)
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
                
                // УМНАЯ СТРОГАЯ ПРОВЕРКА: удаляем все спецсимволы и пробелы
                if (!/^v\d+$/.test(query)) {
                    // Оставляем только буквы (в т.ч. русские) и цифры
                    const vnTitle = vn.title.toLowerCase().replace(/[^a-z0-9а-яぁ-んァ-ン一-龯]/gi, '')
                    const searchTitle = query.toLowerCase().replace(/[^a-z0-9а-яぁ-んァ-ン一-龯]/gi, '')
                    if (!vnTitle.includes(searchTitle) && !searchTitle.includes(vnTitle)) {
                        return null; // Защита от левых новелл
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

    async fetchSteamMetadata(query) {
        try {
            let appId = query;
            // Если передан не просто ID (цифры), а название игры - ищем через поиск
            if (!/^\d+$/.test(query)) {
                const searchRes = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`);
                const searchData = await searchRes.json();
                if (searchData.total > 0 && searchData.items?.length > 0) {
                    const item = searchData.items[0];
                    
                    // УМНАЯ СТРОГАЯ ПРОВЕРКА: удаляем все пробелы, апострофы и дефисы
                    const steamTitle = item.name.toLowerCase().replace(/[^a-z0-9а-яぁ-んァ-ン一-龯]/gi, '')
                    const searchTitle = query.toLowerCase().replace(/[^a-z0-9а-яぁ-んァ-ン一-龯]/gi, '')
                    
                    if (!steamTitle.includes(searchTitle) && !searchTitle.includes(steamTitle)) {
                        return null; // Название не совпадает - это ложное срабатывание, отменяем!
                    }
                    appId = item.id;
                } else {
                    return null;
                }
            }
            
            const detailRes = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`);
            const detailData = await detailRes.json();
            if (detailData[appId]?.success) {
                const game = detailData[appId].data;
                const desc = (game.short_description || game.about_the_game || '').replace(/<[^>]*>?/gm, '').trim();
                return { 
                    coverUrl: game.header_image, 
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
            tags: [], description: '', coverUrl: '', developer: '', releaseDate: '', language: '',
            links: []
        };
        let foundAny = false;

        let explicitRj = null;
        let explicitSteam = null;
        let explicitVndb = null;

        if (inputQuery) {
            if (inputQuery.match(/RJ\d{6,8}/i)) explicitRj = inputQuery.match(/RJ\d{6,8}/i)[0].toUpperCase();
            if (inputQuery.match(/app\/(\d+)/i)) explicitSteam = inputQuery.match(/app\/(\d+)/i)[1];
            if (inputQuery.match(/v(\d+)/i) && inputQuery.includes('vndb')) explicitVndb = 'v' + inputQuery.match(/v(\d+)/i)[1];
        }

        const cleanTitle = title.replace(/v\d+\.\d+/gi, '').replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();

        // 1. DLSITE (Король метаданных)
        if (explicitRj) {
            const dlsiteData = await this.executeFetchDLsiteTags(explicitRj);
            if (dlsiteData) {
                foundAny = true;
                aggregatedData.tags = dlsiteData.tags || []; 
                aggregatedData.description = dlsiteData.description || '';
                aggregatedData.developer = dlsiteData.developer || '';
                aggregatedData.releaseDate = dlsiteData.releaseDate || '';
                aggregatedData.language = dlsiteData.language || '';
                if (dlsiteData.link) aggregatedData.links.push(dlsiteData.link);
            }
        }

        // 2. STEAM (Ищем ВСЕГДА, чтобы забрать ссылку)
        const steamQuery = explicitSteam || cleanTitle; 
        if (steamQuery && steamQuery.length >= 3) {
            const steamData = await this.fetchSteamMetadata(steamQuery);
            if (steamData) {
                foundAny = true;
                // Ссылку забираем в любом случае!
                if (steamData.link) aggregatedData.links.push(steamData.link);
                
                // А вот теги берем, ТОЛЬКО если DLsite их не нашел
                if (aggregatedData.tags.length === 0 && steamData.tags) aggregatedData.tags = steamData.tags;
                
                aggregatedData.coverUrl = aggregatedData.coverUrl || steamData.coverUrl || '';
                aggregatedData.description = aggregatedData.description || steamData.description || '';
                aggregatedData.developer = aggregatedData.developer || steamData.developer || '';
                aggregatedData.releaseDate = aggregatedData.releaseDate || steamData.releaseDate || '';
                aggregatedData.language = aggregatedData.language || steamData.language || '';
            }
        }

        // 3. VNDB (Ищем ВСЕГДА, чтобы забрать ссылку)
        const vndbQuery = explicitVndb || cleanTitle;
        if (vndbQuery && vndbQuery.length >= 3) {
            const vndbData = await this.fetchVNDBMetadata(vndbQuery);
            if (vndbData) {
                foundAny = true;
                // Ссылку забираем в любом случае!
                if (vndbData.link) aggregatedData.links.push(vndbData.link);
                
                if (aggregatedData.tags.length === 0 && vndbData.tags) aggregatedData.tags = vndbData.tags;
                aggregatedData.coverUrl = aggregatedData.coverUrl || vndbData.coverUrl || '';
                aggregatedData.description = aggregatedData.description || vndbData.description || '';
                aggregatedData.developer = aggregatedData.developer || vndbData.developer || '';
                aggregatedData.releaseDate = aggregatedData.releaseDate || vndbData.releaseDate || '';
            }
        }

        if (!foundAny) return null;

        aggregatedData.tags = [...new Set(aggregatedData.tags)];
        aggregatedData.link = [...new Set(aggregatedData.links)].join(',');
        
        return aggregatedData;
    }
}

module.exports = new ScraperService();