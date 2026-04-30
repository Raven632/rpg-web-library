require('dotenv').config();
const path = require('path');

// Поскольку этот файл лежит в api/src/config, поднимаемся на 3 уровня вверх (.. / .. / ..) до корня проекта
const GAMES_DIR = process.env.GAMES_DIR || path.join(__dirname, '..', '..', '..', 'games');
const EXTRACT_TMP = path.join(GAMES_DIR, '_tmp_uploads'); 
const UPLOAD_TMP = EXTRACT_TMP; 
const SAVES_DIR = path.join(GAMES_DIR, '_saves');
const AUDIOCACHE = path.join(GAMES_DIR, '.audio-cache');

module.exports = {
    GAMES_DIR,
    EXTRACT_TMP,
    UPLOAD_TMP,
    SAVES_DIR,
    AUDIOCACHE
};