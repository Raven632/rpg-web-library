// ============================================================================
// [1] ИМПОРТЫ И КОНФИГУРАЦИЯ
// ============================================================================
require('dotenv').config();

// Встроенные модули Node.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const util = require('util');
const http = require('http');
const execFilePromise = util.promisify(require('child_process').execFile);

// Сторонние библиотеки (NPM)
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

// Локальные сервисы и утилиты
const dbService = require('./src/db/database.js');
const scraperService = require('./src/services/scraper.js');
const audioService = require('./src/services/audio.js');
const { authRouter, requireAuth } = require('./src/routes/auth.js');
const createGamesRouter = require('./src/routes/games.js');
const createSavesRouter = require('./src/routes/saves.js');
const { findGameFolder } = require('./src/utils/archive.js');
const { GAMES_DIR, EXTRACT_TMP, SAVES_DIR, AUDIOCACHE } = require('./src/config/index.js');

// ============================================================================
// [2] ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ И ЗАВИСИМОСТЕЙ
// ============================================================================
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Внедрение зависимостей в сервисы
scraperService.setDependencies(io, GAMES_DIR, dbService);
dbService.setDependencies(io, scraperService, GAMES_DIR);

// ============================================================================
// [3] ГЛОБАЛЬНЫЕ MIDDLEWARE И НАСТРОЙКА ПАПОК
// ============================================================================
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
// Отключаем строгие политики Helmet, чтобы игры в iframe (Cross-Origin) работали корректно
app.use(helmet({ 
    contentSecurityPolicy: false, 
    crossOriginEmbedderPolicy: false, 
    crossOriginOpenerPolicy: false, 
    originAgentCluster: false 
}));

// Лимитер запросов для API
const apiLimiter = rateLimit({ 
    windowMs: 60 * 1000, 
    max: 200, 
    message: { error: 'Слишком много запросов' } 
});
app.use('/api/', apiLimiter);

// Создание системных директорий при старте
Promise.all([
    fsp.mkdir(EXTRACT_TMP, { recursive: true }),
    fsp.mkdir(SAVES_DIR, { recursive: true }),
    fsp.mkdir(AUDIOCACHE, { recursive: true })
]).catch(err => console.error('[Init] Ошибка создания системных папок:', err));


// ============================================================================
// [4] ФОНОВЫЕ ЗАДАЧИ (КРОН)
// ============================================================================

// Авто-очистка временной папки загрузок (каждый час)
setInterval(async () => {
    try {
        const files = await fsp.readdir(EXTRACT_TMP);
        const now = Date.now();
        for (const file of files) {
            const filePath = path.join(EXTRACT_TMP, file);
            const stat = await fsp.stat(filePath);
            
            // Удаляем файлы и папки старше 24 часов (86400000 мс)
            if (now - stat.mtimeMs > 86400000) { 
                await fsp.rm(filePath, { recursive: true, force: true }).catch(()=>{});
                console.log(`[Cleanup] Удален старый временный файл: ${file}`);
            }
        }
    } catch (e) {
        console.error('[Cleanup] Ошибка очистки:', e.message);
    }
}, 60 * 60 * 1000);


// ============================================================================
// [5] API РОУТЫ (ОТКРЫТЫЕ И ЗАКРЫТЫЕ)
// ============================================================================

// --- ОТКРЫТЫЕ API ---
app.use('/api', authRouter); // Логин, логаут, проверка статуса настройки

// --- ЗАМОК АВТОРИЗАЦИИ ---
app.use('/api', requireAuth); // Все роуты ниже этой строки требуют куки `auth_token`

// --- ЗАКРЫТЫЕ API ---
app.use('/api/games', createGamesRouter(io, dbService.addGameToDB.bind(dbService), EXTRACT_TMP));
app.use('/api/saves', createSavesRouter(EXTRACT_TMP));

// Роут мониторинга хранилища (с кэшированием)
let cachedStorage = null;
let lastStorageCheck = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 час

app.get('/api/storage', async (req, res) => { 
    try {
        if (cachedStorage && (Date.now() - lastStorageCheck < CACHE_TTL)) {
            return res.json(cachedStorage);
        }

        // 1. Размер всех игр (через системную утилиту du)
        const { stdout: duOut } = await execFilePromise('du', ['-sb', GAMES_DIR]);
        const usedBytes = parseInt(duOut.split('\t')[0], 10);

        // 2. Свободное место на диске (API Node.js 20+)
        const stats = await fsp.statfs(GAMES_DIR);
        const freeBytes = stats.bavail * stats.bsize;

        cachedStorage = { used: usedBytes, free: freeBytes };
        lastStorageCheck = Date.now();

        res.json(cachedStorage);
    } catch (error) {
        console.error('[Storage] Ошибка чтения диска:', error);
        res.status(500).json({ error: 'Failed to read storage' });
    }
});


// ============================================================================
// [6] РАЗДАЧА СТАТИКИ И ПРОКСИ ИГР (ЯДРО ПЛАТФОРМЫ)
// ============================================================================

// Раздача фронтенда (React сборка в папке public)
app.use(express.static(path.join(__dirname, 'public')));

// Универсальный обработчик для запуска самих игр (Перехватывает все пути)
app.get('*', requireAuth, async (req, res, next) => {
    // Пропускаем API запросы и корень
    if (req.path.startsWith('/api/') || req.path === '/') return next();

    let reqPath = decodeURIComponent(req.path);
    let filePath = path.join(GAMES_DIR, reqPath);

    // 1. Защита от выхода за пределы папки (Path Traversal)
    const normalizedGamesDir = path.resolve(GAMES_DIR);
    const normalizedFilePath = path.resolve(filePath);
    if (normalizedFilePath !== normalizedGamesDir && !normalizedFilePath.startsWith(normalizedGamesDir + path.sep)) {
        return res.status(403).send('Доступ запрещен');
    }

    try {
        // 2. Попытка исправить регистр символов в путях (для Linux)
        if (!fs.existsSync(filePath)) {
            const dir = path.dirname(filePath);
            const baseLow = path.basename(filePath).toLowerCase();
            try {
                const match = fs.readdirSync(dir).find(f => f.toLowerCase() === baseLow);
                if (match) {
                    filePath = path.join(dir, match);
                    reqPath = path.relative(GAMES_DIR, filePath);
                }
            } catch(e) {} // Папка не существует, игнорируем
        }

        let stat;
        try { stat = await fsp.stat(filePath); } catch(e) {}

        // 3. Если запрошена директория - ищем исполняемый файл (index.html)
        if (stat && stat.isDirectory()) {
            if (!req.path.endsWith('/')) return res.redirect(req.path + '/');
            
            if (fs.existsSync(path.join(filePath, 'index.html'))) {
                filePath = path.join(filePath, 'index.html');
            } else if (fs.existsSync(path.join(filePath, 'www', 'index.html'))) {
                return res.redirect(req.path + 'www/');
            } else {
                const deepDir = await findGameFolder(filePath);
                if (deepDir) return res.redirect('/' + path.relative(GAMES_DIR, deepDir).replace(/\\/g, '/') + '/');
                return res.status(404).send(`<div style="color:red; text-align:center; padding:50px;">index.html не найден.</div>`);
            }
        }

        // 4. Оптимизация и транскодирование Аудио (Фикс для iOS Safari)
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.m4a' || ext === '.ogg') {
            const base = filePath.slice(0, -4);
            const ua = req.headers['user-agent'] || '';
            const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && ua.includes('Mobile'));
            
            // Ищем альтернативные форматы или зашифрованные файлы (.rpgmvo)
            const pathsToTry = ext === '.m4a' 
                ? [filePath, base + '.ogg', filePath + '_', base + '.rpgmvo', base + '.rpgmvm'] 
                : [filePath, base + '.m4a', filePath + '_', base + '.rpgmvm', base + '.rpgmvo']; 

            let sourcePath = null;
            for (const p of pathsToTry) {
                try { await fsp.access(p); sourcePath = p; break; } catch {}
            }

            if (sourcePath) {
                const isEncrypted = sourcePath.endsWith('.rpgmvo') || sourcePath.endsWith('.rpgmvm');
                // Если это iOS и формат не поддерживается - конвертируем на лету в m4a
                if (isIOS && (isEncrypted || sourcePath.endsWith('.ogg'))) {
                    try {
                        const gameFolder = reqPath.split('/').filter(Boolean)[0];
                        const readyPath = await audioService.ensureM4aFromSource(sourcePath, path.join(GAMES_DIR, gameFolder));
                        res.type('audio/mp4');
                        res.setHeader('Cache-Control', 'public, max-age=86400');
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        return res.sendFile(readyPath);
                    } catch (err) { filePath = sourcePath; } 
                } else {
                    filePath = sourcePath;
                }
            }
        }

        // 5. Инъекция патчей в HTML и JS файлы игр
        let finalStat;
        try { finalStat = await fsp.stat(filePath); } catch(e) {}

        if (finalStat && finalStat.isFile()) {
            
            // Патчим index.html: убираем CSP и вставляем наш скрипт-эмулятор rpg-fixes.js
            if (filePath.endsWith('index.html')) {
                let html = await fsp.readFile(filePath, 'utf8');
                html = html.replace(/<meta[^>]+http-equiv=['"]?Content-Security-Policy['"]?[^>]*>/gi, '');
                html = html.replace(/(<body[^>]*>)/i, '$1<script src="/rpg-fixes.js?v=' + Date.now() + '"></script>');
                res.setHeader('Content-Type', 'text/html');
                res.setHeader('Access-Control-Allow-Origin', '*');
                return res.send(html);
            }

            // Патчим JS плагины: заменяем import.meta для обхода ошибок Webpack
            if (filePath.endsWith('.js') && finalStat.size < 5 * 1024 * 1024) {
                let jsContent = await fsp.readFile(filePath, 'utf8');
                if (jsContent.includes('import.meta')) {
                    jsContent = jsContent.replace(/\bimport\.meta\b/g, "window.__import_meta");
                    res.setHeader('Content-Type', 'application/javascript');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    return res.send(jsContent);
                }
            }

            // Отдаем любые другие файлы "как есть"
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.sendFile(filePath);
        }
    } catch(e) {
        // Ошибки ФС просто прокидываем дальше (к 404 странице)
    }

    // === ИСПРАВЛЕНИЕ БАГА "ПРОПАВШИЕ ФАЙЛЫ И ШРИФТЫ" (404) ===
    const reqExt = path.extname(reqPath).toLowerCase();
    
    // 1. Сейвы и конфиги -> отдаем пустой объект, чтобы не ломать плагины
    if (['.json', '.rpgsave', '.rmmzsave'].includes(reqExt)) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        return res.status(404).send('{}'); 
    }
    
    // 2. Стили (шрифты) -> отдаем пустой CSS, чтобы браузер не ругался на MIME type
    if (reqExt === '.css') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'text/css');
        return res.status(404).send(''); 
    }
    
    // 3. Остальные файлы (картинки, аудио, шрифты) -> просто отдаем пустоту
    if (['.js', '.png', '.jpg', '.m4a', '.ogg', '.ttf', '.woff', '.woff2'].includes(reqExt)) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(404).send(''); 
    }
    // ===========================================
    next();
});


// ============================================================================
// [7] ЗАПУСК СЕРВЕРА И ФАЙЛОВЫЙ ВОТЧЕР
// ============================================================================

if (require.main === module) {
    dbService.init(GAMES_DIR).then(async () => {
        
        // Первичная синхронизация базы при старте
        await dbService.syncDatabase();

        // Запуск HTTP и WebSocket сервера
        const PORT = process.env.PORT || 3000;
        const srv = server.listen(PORT, () => {
            console.log(`🚀 RPG API: Сервер запущен на порту ${PORT}`);
        });
        
        // Отключаем таймауты для поддержки долгих загрузок больших архивов
        srv.timeout = 0; srv.requestTimeout = 0; srv.keepAliveTimeout = 0;

        // Настройка "наблюдателя" (Watcher) за папкой игр для автообновления библиотеки
        let syncTimer = null;
        let syncInProgress = false;
        let pendingSync = false;
        let lastReadyCount = (await dbService.get().get('SELECT COUNT(*) as c FROM games WHERE ready = 1'))?.c || 0;

        async function runSyncSafely(reason = 'watcher') {
            if (syncInProgress) { pendingSync = true; return; }
            syncInProgress = true;
            try {
                await dbService.syncDatabase();
                const newReadyCount = (await dbService.get().get('SELECT COUNT(*) as c FROM games WHERE ready = 1'))?.c || 0;
                
                // Если количество игр изменилось, уведомляем фронтенд
                if (newReadyCount !== lastReadyCount) {
                    const diff = newReadyCount - lastReadyCount;
                    lastReadyCount = newReadyCount;
                    io.emit('scrape-success', { message: diff > 0 ? `✅ Добавлено готовых игр: ${diff}` : '🔄 Библиотека обновлена' });
                }
                console.log('[Watcher] ✅ Синхронизация завершена');
            } catch (e) { 
                console.error('[Watcher] ❌ Ошибка синхронизации:', e); 
            } finally {
                syncInProgress = false;
                // Если пока мы синкали, файлы снова изменились — запускаем еще раз
                if (pendingSync) { pendingSync = false; setTimeout(() => runSyncSafely('pending'), 300); }
            }
        }

        // Прослушиваем изменения директории (игнорируя служебные папки)
        fs.watch(GAMES_DIR, { persistent: true }, (eventType, filename) => {
            if (!filename || ['_tmp_uploads', '_saves', 'node_modules', '.audio-cache'].includes(filename)) return;
            
            // Используем Debounce (5 сек), чтобы не запускать синк на каждый скопированный файл
            clearTimeout(syncTimer);
            syncTimer = setTimeout(() => runSyncSafely(`fs.watch:${eventType}:${filename}`), 5000);
        });

        console.log(`[Watcher] 👀 Наблюдение за ${GAMES_DIR} включено`);
    }).catch(console.error);
}

module.exports = { app };