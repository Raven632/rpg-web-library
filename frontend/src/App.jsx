import { useState, useEffect, useMemo, useRef } from 'react'
import { io } from 'socket.io-client'
import Header from './components/Header'
import Toolbar from './components/Toolbar'
import GameCard from './components/GameCard'
import GameModal from './components/GameModal'
import LoginModal from './components/LoginModal'
import Toast from './components/Toast'
import { locales } from './components/locales'
import StorageMonitor from './components/StorageMonitor';
import ContinueCard from './components/ContinueCard';
import StatsModal from './components/StatsModal';

const socket = io();

function App() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState(localStorage.getItem('rpg_lang') || 'ru');
  // Скрытие обложек: помним выбор между заходами, как и язык
  const [blurCovers, setBlurCovers] = useState(() => localStorage.getItem('rpg_blur') === '1');
  const [statsOpen, setStatsOpen] = useState(false);
  // Сколько игр ещё ждёт сбора метаданных — приходит с сервера по сокету
  const [scrapeLeft, setScrapeLeft] = useState(0);
  
  useEffect(() => {
    localStorage.setItem('rpg_lang', lang);
  }, [lang]);
  
  useEffect(() => {
    localStorage.setItem('rpg_blur', blurCovers ? '1' : '0');
  }, [blurCovers]);

  const t = locales[lang] || locales['ru'];

  const [searchQuery, setSearchQuery] = useState(() => sessionStorage.getItem('rpg_search') || '');
  const [selectedTag, setSelectedTag] = useState(() => sessionStorage.getItem('rpg_tag') || 'all');
  const [currentSort, setCurrentSort] = useState(() => sessionStorage.getItem('rpg_sort') || 'newest');
  const [statusFilter, setStatusFilter] = useState(() => sessionStorage.getItem('rpg_status') || 'all');

  useEffect(() => {
    sessionStorage.setItem('rpg_search', searchQuery);
    sessionStorage.setItem('rpg_tag', selectedTag);
    sessionStorage.setItem('rpg_sort', currentSort);
    sessionStorage.setItem('rpg_status', statusFilter);
  }, [searchQuery, selectedTag, currentSort, statusFilter]);

  const [socketMessage, setSocketMessage] = useState('');
  const [selectedGame, setSelectedGame] = useState(null);
  const [authMode, setAuthMode] = useState(null);
    // Вошёл ли пользователь: виджеты, которым нужен вход (StorageMonitor), показываем только после него
  const [isAuthed, setIsAuthed] = useState(false);

  // --- ЛЕНИВАЯ ЗАГРУЗКА (PAGINATION) ---
  const [page, setPage] = useState(1);
  const itemsPerPage = 24;
  const loaderRef = useRef(null);

  // Сбрасываем страницу на первую при любом изменении фильтров
  useEffect(() => {
    setPage(1);
  }, [searchQuery, selectedTag, currentSort, statusFilter]);

  const [toast, setToast] = useState({ message: '', type: 'success', visible: false });
  const toastTimerRef = useRef(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type, visible: true });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast(prev => ({ ...prev, visible: false }));
    }, 4000);
  };

  const fetchGames = async ({ silent = false } = {}) => {
    // Тихое обновление — без индикатора: данные приехали сами, пользователь ничего не ждёт
    if (!silent) setLoading(true);
    try {
      const statusRes = await fetch('/api/setup/status');
      const statusData = await statusRes.json();

      if (!statusData.initialized) {
        setAuthMode('setup');
        setIsAuthed(false);
        setLoading(false);
        return;
      }

      const response = await fetch('/api/games');
      if (response.status === 401) {
        setAuthMode('login');
        setIsAuthed(false);
        setLoading(false);
        return;
      }

      const data = await response.json();
      setGames(data);
      // Игру могли изменить или удалить с другого устройства, пока окно открыто
      setSelectedGame(prev => {
        if (!prev) return null;
        const fresh = data.find(g => g.id === prev.game.id);
        return fresh ? { ...prev, game: fresh } : null;
      });
      setAuthMode(null);
      setIsAuthed(true);
    } catch (error) {
      console.error("Ошибка загрузки игр:", error);
    } finally {
      setLoading(false);
    }
  };

  // События от сервера прилетают пачкой: игра добавлена, посчитан размер, найдены теги.
  // Обновляем список один раз, через 800 мс после последнего события.
  const refetchTimer = useRef(null);
  const scheduleRefetch = () => {
    clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => fetchGames({ silent: true }), 800);
  };

  useEffect(() => {
    fetchGames();
    socket.on('upload-status', (data) => setSocketMessage(data.message));
    socket.on('scrape-success', (data) => {
      showToast(data.message, 'success');
      scheduleRefetch();
    });

    // Кто-то изменил библиотеку с другого устройства — тихо подтягиваем список
    socket.on('library-changed', () => scheduleRefetch());
    socket.on('scrape-progress', ({ left }) => setScrapeLeft(left));

    const handleVisibilityChange = () => {
      if (!document.hidden) fetchGames({ silent: true });
    };
    const handlePageShow = (event) => {
      if (event.persisted) fetchGames({ silent: true });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      clearTimeout(refetchTimer.current);
      socket.off('upload-status');
      socket.off('scrape-success');
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      socket.off('library-changed');
      socket.off('scrape-progress');      
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

  // Правим поле сразу на экране и следом отправляем на сервер.
  // Ждать ответ нельзя: звезда «моргала» бы на каждый клик.
  const patchGame = async (id, patch) => {
    setGames(prev => prev.map(g => g.id === id ? { ...g, ...patch } : g));
    setSelectedGame(prev => prev && prev.game.id === id ? { ...prev, game: { ...prev.game, ...patch } } : prev);
    try {
      await fetch(`/api/games/${encodeURIComponent(id)}/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
    } catch (err) {
      showToast(t.err_net, 'error');
    }
  };

  const handleUpdateGame = (index, updatedGame) => {
    // 1. Обновляем игру в общем списке (чтобы на главной странице обложка поменялась)
    setGames(prev => prev.map(g => g.id === updatedGame.id ? updatedGame : g));
    
    // 2. КРИТИЧЕСКИ ВАЖНО: Обновляем снимок в выбранной игре, чтобы модалка сразу перерисовала обложку!
    setSelectedGame(prev => prev ? { ...prev, game: updatedGame } : null);
  };

  const handleRescan = async () => {
    try {
      const res = await fetch('/api/games/rescan', { method: 'POST' });
      const data = await res.json();
      if (data.queued) showToast(t.rescan_queued(data.queued), 'success');
      else if (data.skipped) showToast(t.rescan_skipped(data.skipped), 'error');
      else showToast(t.rescan_none, 'error');
    } catch (err) {
      showToast(t.err_net, 'error');
    }
  };

  const availableTags = useMemo(() => {
    const tagCounts = {};
    games.forEach(g => {
      if (g.tags && g.tags.length > 0) {
        g.tags.forEach(tg => { tagCounts[tg] = (tagCounts[tg] || 0) + 1; });
      }
    });
    return Object.keys(tagCounts)
      // Теги-одиночки только засоряют список. Найти такую игру по-прежнему можно поиском,
      // а выбранный тег оставляем всегда — иначе он исчезнет из списка прямо под курсором.
      .filter(tag => tagCounts[tag] >= 2 || tag === selectedTag)
      .sort((a, b) => a.localeCompare(b))
      .map(tag => ({ name: tag, count: tagCounts[tag] }));
  }, [games, selectedTag]);

  // Последняя запущенная игра. Прячем блок, когда человек ищет или фильтрует:
  // он уже знает, что хочет найти, и большая карточка только мешает.
  const continueGame = useMemo(() => {
    if (searchQuery || selectedTag !== 'all' || statusFilter !== 'all') return null;
    return [...games].filter(g => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed)[0] || null;
  }, [games, searchQuery, selectedTag, statusFilter]);

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

    // Фильтруем по статусу
    if (statusFilter === 'fav') {
      result = result.filter(g => g.favorite);
    } else if (statusFilter !== 'all') {
      result = result.filter(g => g.status === statusFilter);
    }
        // При равных значениях упорядочиваем по id: иначе порядок одинаковых игр «прыгает»
    const byId = (a, b) => a.id.localeCompare(b.id);
    result = [...result].sort((a, b) => {
      switch (currentSort) {
        case 'newest':      return (b.addedAt || 0) - (a.addedAt || 0) || byId(a, b);
        case 'oldest':      return (a.addedAt || 0) - (b.addedAt || 0) || byId(a, b);
        case 'recent':      return (b.lastPlayed || 0) - (a.lastPlayed || 0) || byId(a, b);
        case 'rating_desc': return (b.rating || 0) - (a.rating || 0) || byId(a, b);
        case 'name':        return (a.title || a.id).localeCompare(b.title || b.id);
        case 'size_desc':   return (b.size || 0) - (a.size || 0) || byId(a, b);
        case 'size_asc':    return (a.size || 0) - (b.size || 0) || byId(a, b);
        case 'playtime':    return (b.playtime || 0) - (a.playtime || 0) || byId(a, b);
        default:            return 0;
      }
    });
    return result;
  }, [games, searchQuery, selectedTag, currentSort, statusFilter]);

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
    <div className={`app-container${blurCovers ? ' covers-hidden' : ''}`}>
      <Header currentLang={lang} onLangChange={setLang} t={t} />

      {isAuthed && <StorageMonitor t={t} />}
      {isAuthed && (
        <div className="tool-row">
          <button type="button" className="stats-btn" onClick={() => setStatsOpen(true)}>📊 {t.stats}</button>
          <button type="button" className="stats-btn" onClick={handleRescan}>🔄 {t.rescan}</button>
        </div>
      )}
      {scrapeLeft > 0 && <div className="scrape-progress">{t.scrape_left(scrapeLeft)}</div>}
      
      <Toolbar 
        blurCovers={blurCovers} setBlurCovers={setBlurCovers}
        searchQuery={searchQuery} setSearchQuery={setSearchQuery} 
        availableTags={availableTags} selectedTag={selectedTag} setSelectedTag={setSelectedTag}
        currentSort={currentSort} setCurrentSort={setCurrentSort}
        onUploadSuccess={() => { setSocketMessage(''); fetchGames(); }}
        socketMessage={socketMessage}
        t={t}
        showToast={showToast}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
      />
      
      <main className="content">
        {!loading && (
          <ContinueCard
            game={continueGame}
            t={t}
            onUpdateGame={(updated) => setGames(prev => prev.map(g => g.id === updated.id ? updated : g))}
          />
        )}
        {loading ? (
          // Пустые «тома» вместо надписи: сетка та же, поэтому карточки не сдвигают вёрстку
          <div className="library">
            {Array.from({ length: 8 }, (_, i) => <div key={i} className="card-skeleton" />)}
          </div>
        ) : (
          <>
            <div className="library">
              {visibleGames.map((game, index) => (
                <GameCard 
                  key={game.id} game={game} index={index}
                  onClick={() => setSelectedGame({ game, index })} 
                  onDelete={handleDeleteGame} onRate={handleRateGame}
                  onToggleFavorite={(id, value) => patchGame(id, { favorite: value })}
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
      
      {statsOpen && <StatsModal games={games} t={t} lang={lang} onClose={() => setStatsOpen(false)} />}

      {selectedGame && (
        <GameModal 
          game={selectedGame.game} index={selectedGame.index} 
          onClose={() => setSelectedGame(null)} onUpdateGame={handleUpdateGame}
          t={t} lang={lang}
          showToast={showToast}
          onPatch={patchGame}
        />
      )}

      <Toast message={toast.message} type={toast.type} visible={toast.visible} />
    </div>
  )
}

export default App