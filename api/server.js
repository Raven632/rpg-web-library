const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const multer = require('multer');
const https = require('https');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

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

// ── Вспомогательные функции ────────────────────────────────────────
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

// ── УМНЫЙ ПАРСЕР МЕТАДАННЫХ ─────────────────────────────────────
async function getGameMetadata(folder, gamePath) {
    const metaPath = path.join(gamePath, 'meta.json');
    const checkExists = async (p) => { try { await fsp.access(p); return true; } catch { return false; } };

    try {
        if (await checkExists(metaPath)) {
            const metaRaw = await fsp.readFile(metaPath, 'utf8');
            const meta = JSON.parse(metaRaw);
            if (meta.scraped) return meta;
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
            if (pName && !pName.toLowerCase().includes('rmmz') && pName.toLowerCase() !== 'rpgmaker') {
                title = pName;
            }
        } catch(e) {}
    }

    if (!title) {
        title = folder.replace(/\[?RJ\d{6,8}\]?/gi, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!title || title.toLowerCase() === 'game') title = folder;
    }

    let cover = null;

    if (await checkExists(path.join(gamePath, 'cover.jpg'))) cover = `${folder}/cover.jpg`;
    else if (await checkExists(path.join(gamePath, 'cover.png'))) cover = `${folder}/cover.png`;

    const rjCode = await findRJCode(folder, gamePath);
    
    if (rjCode && !cover) {
        const coverDest = path.join(gamePath, 'cover.jpg');
        const success = await fetchDLsiteCover(rjCode, coverDest);
        if (success) { cover = `${folder}/cover.jpg`; }
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

    const finalMeta = { title, cover, scraped: true };
    await fsp.writeFile(metaPath, JSON.stringify(finalMeta, null, 2), 'utf8').catch(()=>{});

    return finalMeta;
}

// ── API РОУТЫ ──────────────────────────────────────────────────────
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
                games.push({ id: folder, title: meta.title, cover: meta.cover, url: `/${folder}/`, number: games.length + 1 });
            } catch(e) {}
        }
        res.json(games);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

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

// ── РАЗДАЧА СТАТИКИ И ИГР С АВТО-ЛОКАТОРОМ ──────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', async (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/') return next();

    let reqPath = decodeURIComponent(req.path);
    let filePath = path.join(GAMES_DIR, reqPath);

    try {
        let stat;
        try { stat = await fsp.stat(filePath); } catch(e) {}

        // 1. АВТО-ЛОКАТОР: Если пользователь запросил папку, ищем внутри неё игру
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
                    // Глубокий поиск (если папка вложена еще глубже)
                    const deepDir = await findGameFolder(filePath);
                    if (deepDir) {
                        const relPath = path.relative(GAMES_DIR, deepDir).replace(/\\/g, '/');
                        return res.redirect('/' + relPath + '/');
                    } else {
                        // Игры физически нет
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

        // 2. Фоллбэк аудио
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

        // 3. Выдача файла
        let finalStat;
        try { finalStat = await fsp.stat(filePath); } catch(e) {}

        if (finalStat && finalStat.isFile()) {
            if (filePath.endsWith('index.html')) {
                let html = await fsp.readFile(filePath, 'utf8');
                // 🔥 ВЫРЕЗАЕМ ЗЛУЮ ЗАЩИТУ CSP, чтобы геймпад работал
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

app.listen(3000, () => console.log('🚀 RPG API: Auto-Locator Mode Ready!'));