const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;

class DatabaseService {
    constructor() {
        this.db = null;
        this.sessionToken = '';
        this.io = null;
        this.scraperService = null;
        this.GAMES_DIR = '';
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

        let tokenRow = await this.db.get('SELECT value FROM settings WHERE key = "session_secret"');
        if (!tokenRow) {
            this.sessionToken = crypto.randomBytes(64).toString('hex');
            await this.db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['session_secret', this.sessionToken]);
        } else {
            this.sessionToken = tokenRow.value;
        }

        try { await this.db.exec('ALTER TABLE games ADD COLUMN ready INTEGER DEFAULT 0'); } catch (_) {}
        try { await this.db.run('UPDATE games SET ready = 1 WHERE ready = 0 AND (title IS NOT NULL OR cover IS NOT NULL)'); } catch (e) {}

        console.log('🗄️ [DB] База данных инициализирована.');
        return this.db;
    }

    get() {
        if (!this.db) throw new Error('База данных еще не инициализирована!');
        return this.db;
    }

    getSessionToken() { return this.sessionToken; }

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
            if (await this.scraperService.fetchDLsiteCover(rjCode, path.join(gamePath, 'cover.jpg'))) cover = `${folder}/cover.jpg`;
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

        if (this.io) this.io.emit('scrape-success', { message: `✅ Игра "${title}" добавлена в библиотеку!` });

        // Отправляем в фоновую очередь парсера
        this.scraperService.queueScrape(folder);
    }

    async syncDatabase() {
        const entries = await fsp.readdir(this.GAMES_DIR);
        const existingGames = await this.db.all('SELECT id FROM games');
        const dbIds = existingGames.map(g => g.id);

        for (const folder of entries) {
            const gamePath = path.join(this.GAMES_DIR, folder);
            try { 
                const stat = await fsp.stat(gamePath); 
                if (!stat.isDirectory() || ['node_modules', '_saves', '_tmp_uploads', '.audio-cache'].includes(folder)) continue;
                if (!dbIds.includes(folder)) await this.addGameToDB(folder, gamePath);
            } catch(e) { continue; }
        }

        for (const id of dbIds) {
            if (!entries.includes(id) || ['_saves', '_tmp_uploads', 'node_modules', '.audio-cache'].includes(id)) {
                await this.db.run('DELETE FROM games WHERE id = ?', [id]);
            }
        }
    }
}

module.exports = new DatabaseService();