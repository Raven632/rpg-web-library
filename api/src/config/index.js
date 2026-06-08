require('dotenv').config();
const path = require('path');

const GAMES_DIR = process.env.GAMES_DIR || path.join(__dirname, '..', '..', '..', 'games');

// Теперь любую системную папку можно переопределить через .env!
const EXTRACT_TMP = process.env.EXTRACT_TMP || path.join(GAMES_DIR, '_tmp_uploads'); 
const UPLOAD_TMP = EXTRACT_TMP; 
const SAVES_DIR = process.env.SAVES_DIR || path.join(GAMES_DIR, '_saves');
const AUDIOCACHE = process.env.AUDIOCACHE || path.join(GAMES_DIR, '.audio-cache');

module.exports = {
    GAMES_DIR,
    EXTRACT_TMP,
    UPLOAD_TMP,
    SAVES_DIR,
    AUDIOCACHE
};