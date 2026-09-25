const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const { statusOfRow, planNext } = require('../utils/scrapeplan.js');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const { invalidateGamesList } = require('../utils/cache.js');
const { detectGameLanguages } = require('../utils/gamelang.js');

class DatabaseService {
    constructor() {
        this.db = null;
        this.sessionToken = '';
        this.io = null;
        this.scraperService = null;
        this.GAMES_DIR = '';
        this.textLangRunning = false;
        this.textLangAgain = false;
    }

    setDependencies(io, scraperService, gamesDir) {
        this.io = io;
        this.scraperService = scraperService;
        this.GAMES_DIR = gamesDir;
    }

    async init(gamesDir) {
        this.db = await open({ filename: path.join(gamesDir, 'library.db'), driver: sqlite3.Database });
        
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS games (
                id TEXT PRIMARY KEY, title TEXT, cover TEXT, tags TEXT, description TEXT,
                rating INTEGER DEFAULT 0, lastPlayed INTEGER DEFAULT 0, addedAt INTEGER DEFAULT 0, 
                scraped INTEGER DEFAULT 0, ready INTEGER DEFAULT 0
            )
        `);
        await this.db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');

        // 1. Пытаемся взять ключ из .env (Правильный путь для production)
        if (process.env.SESSION_SECRET) {
            this.sessionToken = process.env.SESSION_SECRET;
        } else {
            // 2. Иначе — случайный ключ, один раз сгенерированный и сохраненный в БД
            let tokenRow = await this.db.get('SELECT value FROM settings WHERE key = "session_secret"');
            if (!tokenRow) {
                this.sessionToken = crypto.randomBytes(64).toString('hex');
                await this.db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['session_secret', this.sessionToken]);
            } else {
                this.sessionToken = tokenRow.value;
            }
        }

        try { await this.db.exec('ALTER TABLE games ADD COLUMN developer TEXT DEFAULT ""'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN language TEXT DEFAULT ""'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN releaseDate TEXT DEFAULT ""'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN link TEXT DEFAULT ""'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN size INTEGER DEFAULT 0'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN version TEXT DEFAULT "1.0.0"'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN status TEXT DEFAULT ""'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN favorite INTEGER DEFAULT 0'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN playtime INTEGER DEFAULT 0'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN progress TEXT DEFAULT ""'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN screens TEXT DEFAULT ""'); } catch(e){}

        // Состояние поиска метаданных. Раньше «нашли / не нашли» было размазано по
        // трём местам: флаг scraped здесь, пометка «не найдено» и сама очередь в Redis.
        // Теперь всё в одной строке таблицы, и очередь — это просто «чей срок подошёл».
        let metaAdded = false;
        try { await this.db.exec("ALTER TABLE games ADD COLUMN meta_status TEXT DEFAULT 'new'"); metaAdded = true; } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN meta_attempts INTEGER DEFAULT 0'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN meta_checked_at INTEGER DEFAULT 0'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN meta_retry_at INTEGER'); } catch(e){}
        try { await this.db.exec("ALTER TABLE games ADD COLUMN meta_error TEXT DEFAULT ''"); } catch(e){}
        // Поля, которые человек поправил руками: автопоиск их больше не трогает
        try { await this.db.exec("ALTER TABLE games ADD COLUMN meta_locked TEXT DEFAULT '[]'"); } catch(e){}
        if (metaAdded) await this.migrateMetaStatus();

        // Язык по тексту самой игры (см. utils/gamelang.js). NULL — ещё не считали,
        // пустая строка — посчитали, но текста не нашлось
        let textLangAdded = false;
        try { await this.db.exec('ALTER TABLE games ADD COLUMN text_lang TEXT'); textLangAdded = true; } catch(e){}
        // Поле language раньше заполнял автопоиск: DLsite про любую игру пишет «Japanese»,
        // даже про русский перевод, а Steam — «Multi». Теперь в нём только ручная правка,
        // найденное на сайтах стираем один раз
        if (textLangAdded) {
            await this.db.run(`UPDATE games SET language = '' WHERE COALESCE(meta_locked, '') NOT LIKE '%"language"%'`);
        }
        
        console.log('🗄️ [DB] База данных инициализирована.');
        return this.db;
    }

    get() {
        if (!this.db) throw new Error('База данных еще не инициализирована!');
        return this.db;
    }

    // Разовый перенос старого состояния в новые колонки. Игры с тегами, ссылкой и
    // картинками считаются готовыми; «не найденные» получают первую попытку завтра,
    // а не прямо сейчас — иначе обновление запустило бы разом обход всей библиотеки.
    async migrateMetaStatus() {
        const rows = await this.db.all('SELECT id, tags, description, link, screens, scraped FROM games');
        const now = Date.now();
        for (const row of rows) {
            let status = statusOfRow(row);
            let plan = planNext(status, 0, now);
            if (!row.scraped && status === 'not_found') {
                status = 'new';
                plan = { attempts: 0, retryAt: now };
            }
            await this.db.run(
                'UPDATE games SET meta_status = ?, meta_attempts = ?, meta_retry_at = ? WHERE id = ?',
                [status, plan.attempts, plan.retryAt, row.id]
            );
        }
        console.log(`🗄️ [DB] Состояние метаданных перенесено: ${rows.length} игр`);
    }

    // До init() токен пустой — requireAuth в этом случае никого не пускает
    getSessionToken() { return this.sessionToken; }

    // Ключ сессии один на весь сервер, поэтому «выйти» по-настоящему — это сменить
    // его: старая кука перестаёт работать сразу и везде, включая устройство, которое
    // потерялось. Если ключ задан в .env, он там и остаётся: после перезапуска
    // значение всё равно вернётся из конфига, и смена была бы обманом.
    async rotateSessionToken() {
        if (process.env.SESSION_SECRET) return false;
        this.sessionToken = crypto.randomBytes(64).toString('hex');
        await this.db.run(
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            ['session_secret', this.sessionToken]
        );
        return true;
    }

    async addGameToDB(folder, gamePath) {
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

        const rjCode = await this.scraperService.findRJCode(folder, gamePath);
        if (rjCode && !cover) {
            // Обложку магазина кладём в _media рядом с папками игр: внутрь самой игры
            // мы не пишем ничего, иначе её содержимое перестаёт быть тем, что скачал автор
            const buf = await this.scraperService.fetchDLsiteCover(rjCode);
            if (buf) {
                try {
                    const dir = path.join(path.dirname(gamePath), '_media', folder);
                    await fsp.mkdir(dir, { recursive: true });
                    await fsp.writeFile(path.join(dir, 'cover.jpg'), buf);
                    cover = `_media/${folder}/cover.jpg`;
                } catch (e) {}
            }
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

        await this.db.run(
            `INSERT OR REPLACE INTO games (id, title, cover, tags, description, rating, lastPlayed, addedAt, scraped, ready)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [folder, title, cover, '[]', '', 0, 0, stat.birthtimeMs || stat.mtimeMs || Date.now(), 0, 1]
        );
        
        // Библиотека изменилась — кэш списка больше не актуален
        await invalidateGamesList();

        if (this.io) this.io.emit('scrape-success', { message: `✅ Игра "${title}" добавлена в библиотеку!` });

        // Новая игра сразу «созрела» для поиска — воркер возьмёт её первой
        this.scraperService.requestScrape([folder]);
        // INSERT OR REPLACE обнулил text_lang — и у новой игры, и у перезалитой поверх
        this.fillTextLang().catch(e => console.error('[Lang]', e.message));
    }

    // Досчитывает язык игр, у которых его ещё нет. Одна игра — доли секунды, но вся
    // библиотека — полминуты чтения карт, поэтому фоном, а не в запросе.
    // Повторный вызов во время прохода не теряется: проход просто повторится
    async fillTextLang() {
        if (this.textLangRunning) { this.textLangAgain = true; return; }
        this.textLangRunning = true;
        try {
            do {
                this.textLangAgain = false;
                const rows = await this.db.all('SELECT id FROM games WHERE text_lang IS NULL AND ready = 1');
                for (const { id } of rows) {
                    const found = await detectGameLanguages(path.join(this.GAMES_DIR, id)).catch(() => null);
                    await this.db.run('UPDATE games SET text_lang = ? WHERE id = ?', [found ? JSON.stringify(found) : '', id]);
                }
                if (rows.length) {
                    console.log(`[Lang] Язык определён: ${rows.length} игр`);
                    await invalidateGamesList();
                }
            } while (this.textLangAgain);
        } finally {
            this.textLangRunning = false;
        }
    }

    async syncDatabase() {
        const entries = await fsp.readdir(this.GAMES_DIR);
        const existingGames = await this.db.all('SELECT id FROM games');
        const dbIds = existingGames.map(g => g.id);

        for (const folder of entries) {
            const gamePath = path.join(this.GAMES_DIR, folder);
            try { 
                const stat = await fsp.stat(gamePath); 
                if (!stat.isDirectory() || ['node_modules', '_saves', '_tmp_uploads', '_media', '.audio-cache'].includes(folder)) continue;
                if (!dbIds.includes(folder)) await this.addGameToDB(folder, gamePath);
            } catch(e) { continue; }
        }

        for (const id of dbIds) {
            if (!entries.includes(id) || ['_saves', '_tmp_uploads', '_media', 'node_modules', '.audio-cache'].includes(id)) {
                await this.db.run('DELETE FROM games WHERE id = ?', [id]);
                await invalidateGamesList();
            }
        }
    }
}

module.exports = new DatabaseService();
