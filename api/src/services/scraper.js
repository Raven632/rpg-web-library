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
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 8000); 
                    const res = await fetch(gateway, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    const data = await res.json();
                    if (data?.[0]?.work_name) return await this.processParsedData(data[0], rjCode);
                } catch (e) {}
            }
        }
        const jpUrl = `https://www.dlsite.com/maniax/api/=/product.json?workno=${rjCode}&locale=en_US`;
        const jpData = await this.fetchViaJapanProxy(jpUrl);
        if (jpData?.[0]?.work_name) return await this.processParsedData(jpData[0], rjCode);
        return null;
    }

    async fetchVNDBMetadata(title) {
        try {
            const res = await fetch('https://api.vndb.org/kana/vn', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filters: ["search", "=", title], fields: "title, description, image.url, tags.name" })
            });
            const data = await res.json();
            if (data.results && data.results.length > 0) {
                const vn = data.results[0];
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

    async fetchSteamMetadata(title) {
        try {
            const searchRes = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=US`);
            const searchData = await searchRes.json();
            if (searchData.total > 0 && searchData.items?.length > 0) {
                const appId = searchData.items[0].id;
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
            }
        } catch (e) {}
        return null;
    }

    async fetchUniversalMetadata(title, rjCode) {
        // Создаем "каркас" для итоговых данных
        const aggregatedData = {
            tags: [],
            description: '',
            coverUrl: '',
            developer: '',
            releaseDate: '',
            link: '',
            language: ''
        };

        let foundAny = false;

        // 1. DLsite (Наивысший приоритет для японских игр)
        if (rjCode) {
            const dlsiteData = await this.executeFetchDLsiteTags(rjCode);
            if (dlsiteData) {
                foundAny = true;
                // Добавляем теги
                if (dlsiteData.tags) aggregatedData.tags.push(...dlsiteData.tags);
                // Заполняем основные поля
                aggregatedData.description = dlsiteData.description || '';
                aggregatedData.developer = dlsiteData.developer || '';
                aggregatedData.releaseDate = dlsiteData.releaseDate || '';
                aggregatedData.link = dlsiteData.link || '';
                aggregatedData.language = dlsiteData.language || '';
            }
        }

        // Очищаем название для поиска по VNDB и Steam
        const cleanTitle = title.replace(/v\d+\.\d+/gi, '').replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
        
        if (cleanTitle && cleanTitle.length >= 3) {
            
            // 2. VNDB (База визуальных новелл)
            const vndbData = await this.fetchVNDBMetadata(cleanTitle);
            if (vndbData) {
                foundAny = true;
                if (vndbData.tags) aggregatedData.tags.push(...vndbData.tags);
                
                // Дополняем пустые поля (если DLsite их не нашел, используем VNDB)
                aggregatedData.coverUrl = aggregatedData.coverUrl || vndbData.coverUrl || '';
                aggregatedData.description = aggregatedData.description || vndbData.description || '';
                aggregatedData.developer = aggregatedData.developer || vndbData.developer || '';
                aggregatedData.releaseDate = aggregatedData.releaseDate || vndbData.releaseDate || '';
                aggregatedData.link = aggregatedData.link || vndbData.link || '';
            }

            // 3. Steam (Самая большая база игр)
            const steamData = await this.fetchSteamMetadata(cleanTitle);
            if (steamData) {
                foundAny = true;
                if (steamData.tags) aggregatedData.tags.push(...steamData.tags);
                
                // Дополняем пустые поля (если ни DLsite, ни VNDB их не нашли)
                aggregatedData.coverUrl = aggregatedData.coverUrl || steamData.coverUrl || '';
                aggregatedData.description = aggregatedData.description || steamData.description || '';
                aggregatedData.developer = aggregatedData.developer || steamData.developer || '';
                aggregatedData.releaseDate = aggregatedData.releaseDate || steamData.releaseDate || '';
                aggregatedData.link = aggregatedData.link || steamData.link || '';
                aggregatedData.language = aggregatedData.language || steamData.language || '';
            }
            
            // Здесь в будущем можно добавить шаг 4: IGDB или RAWG API, 
            // они будут так же докидывать свои данные в aggregatedData.
        }

        // Если ни одна из трех баз ничего не нашла
        if (!foundAny) return null;

        // МАГИЯ АГРЕГАЦИИ: Убираем дубликаты тегов (например, если и Steam, и DLsite выдали тег "RPG")
        // Используем Set (множество), которое физически не может хранить одинаковые значения
        aggregatedData.tags = [...new Set(aggregatedData.tags)];
        
        return aggregatedData;
    }
}

module.exports = new ScraperService();