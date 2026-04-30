import { useState, useEffect, useMemo, useRef } from 'react'
import { io } from 'socket.io-client'
import Header from './components/Header'
import Toolbar from './components/Toolbar'
import GameCard from './components/GameCard'
import GameModal from './components/GameModal'
import LoginModal from './components/LoginModal'
import Toast from './components/Toast'
import { locales } from './components/locales'

const socket = io();

function App() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState(localStorage.getItem('rpg_lang') || 'ru');
  
  useEffect(() => {
    localStorage.setItem('rpg_lang', lang);
  }, [lang]);

  const t = locales[lang] || locales['ru'];

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('all');
  const [currentSort, setCurrentSort] = useState('newest');
  const [socketMessage, setSocketMessage] = useState('');
  const [selectedGame, setSelectedGame] = useState(null);
  const [authMode, setAuthMode] = useState(null);

  // --- ЛЕНИВАЯ ЗАГРУЗКА (PAGINATION) ---
  const [page, setPage] = useState(1);
  const itemsPerPage = 24;
  const loaderRef = useRef(null);

  // Сбрасываем страницу на первую при любом изменении фильтров
  useEffect(() => {
    setPage(1);
  }, [searchQuery, selectedTag, currentSort]);

  const [toast, setToast] = useState({ message: '', type: 'success', visible: false });
  const toastTimerRef = useRef(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type, visible: true });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast(prev => ({ ...prev, visible: false }));
    }, 4000);
  };

  const fetchGames = async () => {
    setLoading(true);
    try {
      const statusRes = await fetch('/api/setup/status');
      const statusData = await statusRes.json();

      if (!statusData.initialized) {
        setAuthMode('setup');
        setLoading(false);
        return;
      }

      const response = await fetch('/api/games');
      if (response.status === 401) {
        setAuthMode('login');
        setLoading(false);
        return;
      }

      const data = await response.json();
      setGames(data);
      setAuthMode(null);
    } catch (error) {
      console.error("Ошибка загрузки игр:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGames();
    socket.on('upload-status', (data) => setSocketMessage(data.message));
    socket.on('scrape-success', (data) => {
      showToast(data.message, 'success');
      fetchGames(); 
    });

    const handleVisibilityChange = () => {
      if (!document.hidden) fetchGames();
    };
    const handlePageShow = (event) => {
      if (event.persisted) fetchGames();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      socket.off('upload-status');
      socket.off('scrape-success');
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  const handleDeleteGame = async (game) => {
    if (!window.confirm(t.burn_confirm(game.title))) return;

    try {
      const res = await fetch(`/api/games/${encodeURIComponent(game.id)}`, { method: 'DELETE' });
      const data = await res.json();
      
      if (data.success) {
        setGames(prevGames => prevGames.filter(g => g.id !== game.id));
        showToast(lang === 'ru' ? 'Том обратился в пепел' : 'Scroll turned to ashes', 'success');
      } else {
        showToast(`Ошибка: ${data.error}`, 'error');
      }
    } catch (err) {
      showToast(t.burn_err, 'error');
    }
  };

  const handleRateGame = async (id, ratingValue) => {
    setGames(prevGames => prevGames.map(g => g.id === id ? { ...g, rating: ratingValue } : g));
    try {
      await fetch(`/api/games/${encodeURIComponent(id)}/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: ratingValue })
      });
    } catch (err) {}
  };

  const handleUpdateGame = (updatedGame) => {
    setGames(prevGames => prevGames.map(g => g.id === updatedGame.id ? updatedGame : g));
    setSelectedGame(prev => ({ ...prev, game: updatedGame })); 
  };

  const availableTags = useMemo(() => {
    const tagCounts = {};
    games.forEach(g => {
      if (g.tags && g.tags.length > 0) {
        g.tags.forEach(tg => { tagCounts[tg] = (tagCounts[tg] || 0) + 1; });
      }
    });
    return Object.keys(tagCounts)
      .sort((a, b) => a.localeCompare(b))
      .map(tag => ({ name: tag, count: tagCounts[tag] }));
  }, [games]);

  const processedGames = useMemo(() => {
    let result = games;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(game => {
        const matchTitle = game.title?.toLowerCase().includes(query) || game.id.toLowerCase().includes(query);
        const matchTags = game.tags?.some(tag => tag.toLowerCase().includes(query));
        return matchTitle || matchTags;
      });
    }
    if (selectedTag !== 'all') {
      result = result.filter(g => g.tags && g.tags.includes(selectedTag));
    }
    result = [...result].sort((a, b) => {
      if (currentSort === 'newest') return b.addedAt - a.addedAt;
      if (currentSort === 'recent') return b.lastPlayed - a.lastPlayed;
      if (currentSort === 'rating_desc') return (b.rating || 0) - (a.rating || 0);
      if (currentSort === 'name') return a.title.localeCompare(b.title);
      return 0;
    });
    return result;
  }, [games, searchQuery, selectedTag, currentSort]);

  // Высчитываем, какие игры показывать на текущей странице
  const visibleGames = processedGames.slice(0, page * itemsPerPage);

  // Настройка IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const target = entries[0];
      // Подгружаем следующую страницу, если элемент пересек границу видимости
      if (target.isIntersecting && processedGames.length > page * itemsPerPage) {
        setPage(p => p + 1);
      }
    }, { rootMargin: '400px' });

    if (loaderRef.current) observer.observe(loaderRef.current);
    return () => { if (loaderRef.current) observer.unobserve(loaderRef.current); };
  }, [processedGames.length, page, itemsPerPage]);

  return (
    <div className="app-container">
      <Header currentLang={lang} onLangChange={setLang} t={t} />
      
      <Toolbar 
        searchQuery={searchQuery} setSearchQuery={setSearchQuery} 
        availableTags={availableTags} selectedTag={selectedTag} setSelectedTag={setSelectedTag}
        currentSort={currentSort} setCurrentSort={setCurrentSort}
        onUploadSuccess={() => { setSocketMessage(''); fetchGames(); }}
        socketMessage={socketMessage}
        t={t}
        showToast={showToast}
      />
      
      <main className="content">
        {loading ? (
          <div className="loading">
            <div className="loading-dots">
               {t.loading}<span>.</span><span>.</span><span>.</span>
            </div>
          </div>
        ) : (
          <>
            <div className="library">
              {visibleGames.map((game, index) => (
                <GameCard 
                  key={game.id} game={game} index={index}
                  onClick={() => setSelectedGame({ game, index })} 
                  onDelete={handleDeleteGame} onRate={handleRateGame}
                  t={t}
                />
              ))}
              {processedGames.length === 0 && (
                <div className="empty-state">{t.not_found}</div>
              )}
            </div>
            
            {/* Невидимый блок-якорь для Observer'а */}
            <div ref={loaderRef} style={{ height: '20px' }}></div>

            {processedGames.length > 0 && (
              <div className="library-info">
                {t.shown(Math.min(page * itemsPerPage, processedGames.length), games.length)}
              </div>
            )}
          </>
        )}
      </main>
      
      {authMode && (
        <LoginModal 
          mode={authMode} 
          onSuccess={() => { setAuthMode(null); fetchGames(); }} 
          t={t}
          showToast={showToast}
        />
      )}

      {selectedGame && (
        <GameModal 
          game={selectedGame.game} index={selectedGame.index} 
          onClose={() => setSelectedGame(null)} onUpdateGame={handleUpdateGame}
          t={t} lang={lang}
          showToast={showToast}
        />
      )}

      <Toast message={toast.message} type={toast.type} visible={toast.visible} />
    </div>
  )
}

export default App