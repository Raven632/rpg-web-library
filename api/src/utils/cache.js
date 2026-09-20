const { createClient } = require('redis');

// Один общий клиент Redis на всё приложение: раньше их было два (games.js и scraper.js)
const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' });
// Без обработчика 'error' любой разрыв связи с Redis роняет весь процесс
redisClient.on('error', (err) => console.error('❌ [Redis] Ошибка:', err.message));
redisClient.connect().then(() => console.log('📦 [Redis] Подключён')).catch(console.error);

const GAMES_LIST_KEY = 'api:games:list';

// Список игр закэширован на 5 минут. Любое изменение библиотеки обязано сбросить кэш,
// иначе изменение увидят с задержкой до 5 минут.
async function invalidateGamesList() {
    try {
        await redisClient.del(GAMES_LIST_KEY);
    } catch (e) {
        console.error('❌ [Redis] Не удалось сбросить кэш списка:', e.message);
    }
}

module.exports = { redisClient, invalidateGamesList, GAMES_LIST_KEY };