const multer = require('multer');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { UPLOAD_TMP } = require('../config/index.js'); // Импортируем путь из нашего нового конфига

const uploadLimiter = rateLimit({ 
    windowMs: 60 * 1000, 
    max: 5, 
    message: { error: 'Слишком много загрузок' } 
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_TMP),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '';
        cb(null, `archive_${Date.now()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB limit
    fileFilter: (req, file, cb) => {
        if (file.originalname.match(/\.(zip|7z|rar)$/i)) cb(null, true);
        else cb(new Error('Поддерживаются только ZIP, 7z и RAR!'));
    }
});

module.exports = { upload, uploadLimiter };