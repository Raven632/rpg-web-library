import { useState, useEffect, useMemo } from 'react'
import { io } from 'socket.io-client'
import Header from './components/Header'
import Toolbar from './components/Toolbar'
import GameCard from './components/GameCard'
import GameModal from './components/GameModal'
import LoginModal from './components/LoginModal'

const socket = io();

function App() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState(localStorage.getItem('rpg_lang') || 'ru');
  
  // Состояния для фильтров и поиска
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('all');
  const [currentSort, setCurrentSort] = useState('newest');
  const [socketMessage, setSocketMessage] = useState('');
  const [selectedGame, setSelectedGame] = useState(null);
  const [authMode, setAuthMode] = useState(null);

  // Загрузка игр
  const fetchGames = async () => {
    setLoading(true);
    try {
      // 1. Сначала проверяем статус (пустая база или нет)
      const statusRes = await fetch('/api/setup/status');
      const statusData = await statusRes.json();

      if (!statusData.initialized) {
        setAuthMode('setup'); // Показываем окно "Создать Мастера"
        setLoading(false);
        return;
      }

      // 2. Если база готова, пробуем получить игры
      const response = await fetch('/api/games');
      
      if (response.status === 401) {
        setAuthMode('login'); // Нет токена -> Показываем окно "Хранилище"
        setLoading(false);
        return;
      }

      // 3. Токен есть, всё ок!
      const data = await response.json();
      setGames(data);
      setAuthMode(null); // Прячем модалку авторизации
    } catch (error) {
      console.error("Ошибка загрузки игр:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGames();

    // Слушаем WebSockets
    socket.on('upload-status', (data) => {
      setSocketMessage(data.message);
    });

    socket.on('scrape-success', (data) => {
      console.log('Скрейпинг успешен:', data.message);
      fetchGames(); // Автоматически обновляем библиотеку, когда парсер нашел обложку!
    });

    // Очистка при размонтировании
    return () => {
      socket.off('upload-status');
      socket.off('scrape-success');
    };
  }, []);

  // --- ЛОГИКА ДЛЯ БЭКЕНДА ---

  // Удаление игры
  const handleDeleteGame = async (game) => {
    // Вызываем стандартное окно браузера, как в оригинале
    if (!window.confirm(`Сжечь том "${game.title}"?\nЭто заклинание необратимо!`)) return;

    try {
      const res = await fetch(`/api/games/${encodeURIComponent(game.id)}`, { method: 'DELETE' });
      const data = await res.json();
      
      if (data.success) {
        // Мгновенно удаляем игру из React-состояния без перезагрузки страницы!
        setGames(prevGames => prevGames.filter(g => g.id !== game.id));
      } else {
        alert(`Ошибка: ${data.error}`);
      }
    } catch (err) {
      alert('Магия дала сбой (Ошибка сети)');
    }
  };

  // Выставление рейтинга
  const handleRateGame = async (id, ratingValue) => {
    // "Оптимистичное обновление": мы сразу меняем звезды на экране, не дожидаясь ответа сервера
    setGames(prevGames => prevGames.map(g => g.id === id ? { ...g, rating: ratingValue } : g));
  
    try {
      await fetch(`/api/games/${encodeURIComponent(id)}/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: ratingValue })
      });
    } catch (err) {
      console.error("Ошибка сохранения рейтинга:", err);
    }
  };

  const handleUpdateGame = (updatedGame) => {
    setGames(prevGames => prevGames.map(g => g.id === updatedGame.id ? updatedGame : g));
    
    setSelectedGame(prev => ({ ...prev, game: updatedGame })); 
  };

  // --- ЛОГИКА ФИЛЬТРАЦИИ И СОРТИРОВКИ ---

  // 1. Собираем уникальные теги из всех игр (React будет пересчитывать это сам!)
  const availableTags = useMemo(() => {
    const tagCounts = {};
    games.forEach(g => {
      if (g.tags && g.tags.length > 0) {
        g.tags.forEach(t => {
          tagCounts[t] = (tagCounts[t] || 0) + 1;
        });
      }
    });
    // Сортируем по алфавиту и возвращаем массив объектов {name: 'Fantasy', count: 5}
    return Object.keys(tagCounts)
      .sort((a, b) => a.localeCompare(b))
      .map(tag => ({ name: tag, count: tagCounts[tag] }));
  }, [games]);

  // 2. Применяем поиск, фильтр по тегам и сортировку
  const processedGames = useMemo(() => {
    let result = games;

    // Поиск по тексту
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(game => {
        const matchTitle = game.title?.toLowerCase().includes(query) || game.id.toLowerCase().includes(query);
        const matchTags = game.tags?.some(tag => tag.toLowerCase().includes(query));
        return matchTitle || matchTags;
      });
    }

    // Фильтр по жанру
    if (selectedTag !== 'all') {
      result = result.filter(g => g.tags && g.tags.includes(selectedTag));
    }

    // Сортировка
    result = [...result].sort((a, b) => {
      if (currentSort === 'newest') return b.addedAt - a.addedAt;
      if (currentSort === 'recent') return b.lastPlayed - a.lastPlayed;
      if (currentSort === 'rating_desc') return (b.rating || 0) - (a.rating || 0);
      if (currentSort === 'name') return a.title.localeCompare(b.title);
      return 0;
    });

    return result;
  }, [games, searchQuery, selectedTag, currentSort]);

  return (
    <div className="app-container">
      <Header currentLang={lang} onLangChange={setLang} />
      
      {/* Передаем новые пропсы в Toolbar */}
      <Toolbar 
        searchQuery={searchQuery} 
        setSearchQuery={setSearchQuery} 
        availableTags={availableTags}
        selectedTag={selectedTag}
        setSelectedTag={setSelectedTag}
        currentSort={currentSort}
        setCurrentSort={setCurrentSort}
        onUploadSuccess={() => {
          setSocketMessage(''); // Очищаем текст
          fetchGames();         // Обновляем игры
        }}
        socketMessage={socketMessage}
      />
      
      <main className="content">
        {loading ? (
          <div className="loading">
            <div className="loading-dots">
               Загрузка<span>.</span><span>.</span><span>.</span>
            </div>
          </div>
        ) : (
          <>
            <div className="library">
              {processedGames.map((game, index) => (
                <GameCard 
                  key={game.id} 
                  game={game} 
                  index={index}
                  onClick={() => setSelectedGame({ game, index })} 
                  onDelete={handleDeleteGame}
                  onRate={handleRateGame}
                />
              ))}
              
              {processedGames.length === 0 && (
                <div className="empty-state">
                  По вашему запросу ничего не найдено...
                </div>
              )}
            </div>
            
            {/* Информация о количестве игр */}
            {processedGames.length > 0 && (
              <div className="library-info">
                Показано {processedGames.length} из {games.length} свитков
              </div>
            )}
          </>
        )}
      </main>
      
      {/* Модалка логина / первой настройки */}
      {authMode && (
        <LoginModal 
          mode={authMode} 
          onSuccess={() => {
            setAuthMode(null); // Прячем логин
            fetchGames();      // И заново грузим игры (теперь куки установлены!)
          }} 
        />
      )}

      {/* Рендерим модалку, только если выбрана игра */}
      {selectedGame && (
        <GameModal 
          game={selectedGame.game} 
          index={selectedGame.index} 
          onClose={() => setSelectedGame(null)} 
          onUpdateGame={handleUpdateGame}
        />
      )}
    </div>
  )
}

export default App