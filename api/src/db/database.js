const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;

// ============================================================================
// МОДУЛЬ БАЗЫ ДАННЫХ (database.js)
// ============================================================================

class DatabaseService {
    constructor() {
        this.db = null;
        this.sessionToken = '';
    }

    async init(gamesDir) {
        // Подключаемся к файлу базы данных
        this.db = await open({ 
            filename: path.join(gamesDir, 'library.db'), 
            driver: sqlite3.Database 
        });
        
        // 1. Создаем таблицы, если их нет
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS games (
                id TEXT PRIMARY KEY, title TEXT, cover TEXT, tags TEXT, description TEXT,
                rating INTEGER DEFAULT 0, lastPlayed INTEGER DEFAULT 0, addedAt INTEGER DEFAULT 0, 
                scraped INTEGER DEFAULT 0, ready INTEGER DEFAULT 0
            )
        `);
        await this.db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');

        // 2. Блок безопасности Zero-Config (Генерация Session Token)
        let tokenRow = await this.db.get('SELECT value FROM settings WHERE key = "session_secret"');
        if (!tokenRow) {
            this.sessionToken = crypto.randomBytes(64).toString('hex');
            await this.db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['session_secret', this.sessionToken]);
            console.log('🛡️ [DB Security] Сгенерирован уникальный ключ сессии.');
        } else {
            this.sessionToken = tokenRow.value;
        }

        // 3. Миграции (на всякий случай)
        try { await this.db.exec('ALTER TABLE games ADD COLUMN ready INTEGER DEFAULT 0'); } catch (_) {}
        try { 
            await this.db.run('UPDATE games SET ready = 1 WHERE ready = 0 AND (title IS NOT NULL OR cover IS NOT NULL)'); 
        } catch (e) {}

        console.log('🗄️ [DB] База данных успешно инициализирована.');
        return this.db;
    }

    // Геттер для получения инстанса БД в других модулях
    get() {
        if (!this.db) throw new Error('База данных еще не инициализирована!');
        return this.db;
    }

    // Геттер для токена сессии (понадобится для роутов авторизации)
    getSessionToken() {
        return this.sessionToken;
    }

    // Метод для добавления новой игры в базу
    async addGame(folder, gamePath, title, cover, rjCode = null) {
        const stat = await fsp.stat(gamePath);
        
        await this.db.run(
            `INSERT OR REPLACE INTO games (id, title, cover, tags, description, rating, lastPlayed, addedAt, scraped, ready)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [folder, title, cover, '[]', '', 0, 0, stat.birthtimeMs || stat.mtimeMs || Date.now(), 0, 1]
        );
        return true;
    }
}

// Экспортируем ЕДИНСТВЕННЫЙ экземпляр (Паттерн Singleton)
const dbService = new DatabaseService();
module.exports = dbService;