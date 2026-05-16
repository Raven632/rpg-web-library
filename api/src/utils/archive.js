const { spawn } = require('child_process');
const fsp = require('fs').promises;
const path = require('path');

function spawnExtract(cmd, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', d => { if (stderr.length < 50000) stderr += d.toString(); });
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Exit code ${code}. Stderr: ${stderr.slice(0, 2000)}`)));
        proc.on('error', err => reject(new Error(`Запуск ${cmd} не удался: ${err.message}`)));
    });
}

async function findGameFolder(dir, depth = 0) {
    if (depth > 10) return null;
    const items = await fsp.readdir(dir, { withFileTypes: true });
    if (items.some(i => i.isDirectory() && i.name.toLowerCase() === 'www')) return path.join(dir, items.find(i => i.name.toLowerCase() === 'www').name);
    if (items.some(i => i.isFile() && i.name.toLowerCase() === 'index.html')) return dir;
    for (const item of items) {
        if (item.isDirectory()) {
            const found = await findGameFolder(path.join(dir, item.name), depth + 1);
            if (found) return found;
        }
    }
    return null;
}

// --- НОВОЕ: Функция подсчета размера папки ---
async function getFolderSize(dirPath) {
    let totalSize = 0;
    try {
        const items = await fsp.readdir(dirPath, { withFileTypes: true });
        for (const item of items) {
            const fullPath = path.join(dirPath, item.name);
            if (item.isDirectory()) {
                totalSize += await getFolderSize(fullPath); // Рекурсия для подпапок
            } else {
                const stat = await fsp.stat(fullPath);
                totalSize += stat.size; // Плюсуем байты
            }
        }
    } catch (e) {
        // Игнорируем системные файлы, к которым нет доступа
    }
    return totalSize;
}

module.exports = { spawnExtract, findGameFolder, getFolderSize };