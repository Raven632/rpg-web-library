require('dotenv').config();
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

// --- Модули проекта ---
const { GAMES_DIR, EXTRACT_TMP, SAVES_DIR, AUDIOCACHE } = require('./src/config/index.js');
const dbService = require('./src/db/database.js');
const scraperService = require('./src/services/scraper.js');

// --- Роутеры ---
const { authRouter, requireAuth } = require('./src/routes/auth.js');
const createGamesRouter = require('./src/routes/games.js');
const createSavesRouter = require('./src/routes/saves.js');
const staticRouter = require('./src/routes/static.js'); // Убедись, что этот файл существует!

// --- Инициализация ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// --- Базовые Middleware ---
app.use(compression());
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 200, message: { error: 'Слишком много запросов' } }));

// Создаем системные папки
[EXTRACT_TMP, SAVES_DIR, AUDIOCACHE].forEach(dir => fs.mkdirSync(dir, { recursive: true }));

// --- Подключение Роутов ---
app.use('/api', authRouter);
app.use('/api', requireAuth); 
app.use('/api/games', createGamesRouter(io, (f, p) => dbService.addGameToDB(f, p), EXTRACT_TMP));
app.use('/api/saves', createSavesRouter(EXTRACT_TMP));
app.use(express.static(require('path').join(__dirname, 'public')));
app.use('/', staticRouter);

// ============================================================================
// ЗАПУСК СЕРВЕРА
// ============================================================================
if (require.main === module) {
    // Внедряем зависимости в сервисы (решает проблему циклического импорта)
    scraperService.setDependencies(io, GAMES_DIR);
    dbService.setDependencies(io, scraperService, GAMES_DIR);

    dbService.init(GAMES_DIR).then(async () => {
        await dbService.syncDatabase();

        const srv = server.listen(3000, () => console.log('🚀 RPG API: Модульная архитектура запущена!'));
        srv.timeout = 0; srv.requestTimeout = 0; srv.keepAliveTimeout = 0;

        let syncTimer = null;
        let syncInProgress = false;
        let pendingSync = false;
        let lastReadyCount = (await dbService.get().get('SELECT COUNT(*) as c FROM games WHERE ready = 1'))?.c || 0;

        async function runSyncSafely() {
            if (syncInProgress) { pendingSync = true; return; }
            syncInProgress = true;
            try {
                await dbService.syncDatabase();
                const newReadyCount = (await dbService.get().get('SELECT COUNT(*) as c FROM games WHERE ready = 1'))?.c || 0;
                if (newReadyCount !== lastReadyCount) {
                    io.emit('scrape-success', { message: newReadyCount > lastReadyCount ? `✅ Добавлено готовых игр: ${newReadyCount - lastReadyCount}` : '🔄 Библиотека обновлена' });
                    lastReadyCount = newReadyCount;
                }
            } catch (e) { 
                console.error('[Watcher] ❌ Ошибка синхронизации:', e); 
            } finally {
                syncInProgress = false;
                if (pendingSync) { pendingSync = false; setTimeout(runSyncSafely, 300); }
            }
        }

        fs.watch(GAMES_DIR, { persistent: true }, (eventType, filename) => {
            if (!filename || ['_tmp_uploads', '_saves', 'node_modules', '.audio-cache'].includes(filename)) return;
            clearTimeout(syncTimer);
            syncTimer = setTimeout(runSyncSafely, 5000);
        });

    }).catch(console.error);
}

module.exports = { app };