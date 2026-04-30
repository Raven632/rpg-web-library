const express = require('express');
const bcrypt = require('bcrypt');
const dbService = require('../db/database.js');

const router = express.Router();

// Middleware для защиты маршрутов токеном
function requireAuth(req, res, next) {
    if (req.cookies.auth_token !== dbService.getSessionToken()) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    next();
}

router.get('/setup/status', async (req, res) => {
    const adminSet = await dbService.get().get('SELECT value FROM settings WHERE key = "admin_user"');
    res.json({ initialized: !!adminSet });
});

router.post('/setup/init', async (req, res) => {
    const adminSet = await dbService.get().get('SELECT value FROM settings WHERE key = "admin_user"');
    if (adminSet) return res.status(403).json({ error: 'Сервер уже настроен!' });

    const { username, password } = req.body;
    if (!username || !password || username.length < 3 || password.length < 4) {
        return res.status(400).json({ error: 'Слишком короткий логин или пароль' });
    }

    const hashedPass = await bcrypt.hash(password, 10);
    await dbService.get().run('INSERT INTO settings (key, value) VALUES (?, ?)', ['admin_user', username]);
    await dbService.get().run('INSERT INTO settings (key, value) VALUES (?, ?)', ['admin_pass', hashedPass]);
    res.json({ success: true });
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const dbUser = await dbService.get().get('SELECT value FROM settings WHERE key = "admin_user"');
    const dbPass = await dbService.get().get('SELECT value FROM settings WHERE key = "admin_pass"');

    if (dbUser && dbPass && username === dbUser.value) {
        if (await bcrypt.compare(password, dbPass.value)) {
            // Выдаем куку сессии на 30 дней
            res.cookie('auth_token', dbService.getSessionToken(), { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
            return res.json({ success: true });
        }
    }
    res.status(401).json({ error: 'Неверный логин или пароль' });
});

router.post('/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ success: true });
});

module.exports = { authRouter: router, requireAuth };