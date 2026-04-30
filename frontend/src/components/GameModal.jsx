import React, { useState, useRef, useEffect } from 'react';

const ROMAN_NUMERALS = ['Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ','Ⅵ','Ⅶ','Ⅷ','Ⅸ','Ⅹ','Ⅺ','Ⅻ'];

const formatDate = (ms) => {
  if (!ms) return 'Никогда';
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
};

const GameModal = ({ game, index, onClose, onUpdateGame }) => {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsActive(true), 10);
    return () => clearTimeout(timer);
  }, []);

  const handleCloseModal = () => {
    setIsActive(false);
    setTimeout(onClose, 300);
  };

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(game.title || '');
  const [editRj, setEditRj] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const importRef = useRef(null);

  const coverUrl = game.cover ? (import.meta.env.DEV ? `/media/${game.cover}` : `/${game.cover}`) : null;
  const roman = ROMAN_NUMERALS[index % ROMAN_NUMERALS.length] || String(index + 1);
  const volumeStr = String(game.number || index + 1).padStart(2, '0');

  // Запуск игры
  const handlePlay = async () => {
    setIsPlaying(true);
    const newLastPlayed = Date.now();
    try {
      await fetch(`/api/games/${encodeURIComponent(game.id)}/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastPlayed: newLastPlayed })
      });
      onUpdateGame({ ...game, lastPlayed: newLastPlayed });
    } catch (err) {} finally {
      const playUrl = import.meta.env.DEV ? `http://${window.location.hostname}/${game.id}/` : `/${game.id}/`;
      window.location.href = playUrl;
      setTimeout(() => setIsPlaying(false), 1000);
    }
  };

  // ✅ БЭКАП: Совпадает с router.get('/export/:id') в saves.js
  const handleBackup = () => {
    window.location.href = `/api/saves/export/${encodeURIComponent(game.id)}`;
  };

  // ✅ ИМПОРТ: Совпадает с router.post('/import/:id') в saves.js
  const handleImportSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsImporting(true);
    const formData = new FormData();
    formData.append('saves', file);

    try {
      const res = await fetch(`/api/saves/import/${encodeURIComponent(game.id)}`, {
        method: 'POST',
        body: formData
      });
      
      const data = await res.json();

      if (res.ok && data.success) {
        alert(data.message);
      } else {
        alert(`Ошибка импорта: ${data.error || 'Неизвестная ошибка сервера'}`);
      }
    } catch (err) {
      alert('Связь с сервером прервана при импорте. Проверьте сеть.');
    } finally {
      setIsImporting(false);
      e.target.value = ''; 
    }
  };

  // ✅ РЕДАКТИРОВАНИЕ: Починено (возвращен правильный путь /api/games/:id/edit)
  const handleSaveEdit = async () => {
    setIsSaving(true);
    setEditStatus(editRj ? 'Связь с серверами... (~15 сек)' : 'Сохранение...');

    try {
      const res = await fetch(`/api/games/${encodeURIComponent(game.id)}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle, rjCode: editRj })
      });
      
      const data = await res.json();

      if (data.success) {
        if (data.warning) alert(`Внимание: ${data.warning}`);
        onUpdateGame({
          ...game,
          title: data.title,
          cover: data.cover ? `${data.cover}?t=${Date.now()}` : null,
          tags: data.tags,
          description: data.description
        });
        setIsEditing(false);
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Сеть недоступна при сохранении метаданных.');
    } finally {
      setIsSaving(false);
      setEditStatus('');
    }
  };

  return (
    <div className={`modal-overlay ${isActive ? 'active' : ''}`} onClick={handleCloseModal}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-close" onClick={handleCloseModal}>×</div>
        
        <div className="modal-header">
          <div className="modal-cover-wrapper">
            {coverUrl ? (
              <img id="modal-cover" src={coverUrl} alt={game.title} />
            ) : (
              <div className="cover-placeholder">
                <span className="rune">{roman}</span>
                <span className="folder-name">{game.id}</span>
              </div>
            )}
          </div>

          <div className="modal-info">
            <div id="modal-number">Том {volumeStr}</div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '25px' }}>
              {!isEditing ? (
                <>
                  <h2 id="modal-title" style={{ marginBottom: 0 }}>{game.title}</h2>
                  <button 
                    id="modal-edit-btn" 
                    style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '1.5rem', transition: 'color 0.2s' }}
                    title="Редактировать метаданные"
                    onClick={() => setIsEditing(true)}
                  >⚙️</button>
                </>
              ) : (
                <div id="modal-edit-form" style={{ width: '100%', background: 'rgba(0,0,0,0.4)', padding: '15px', border: '1px solid rgba(201,168,76,0.3)', borderRadius: '6px', boxShadow: 'inset 0 0 20px rgba(0,0,0,0.8)' }}>
                  <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Название игры" style={{ width: '100%', padding: '10px', marginBottom: '10px', background: 'rgba(20,18,26,0.9)', color: 'var(--text)', border: '1px solid var(--gold-dim)', borderRadius: '4px', fontFamily: "'Cinzel', serif", fontSize: '1rem', outline: 'none' }} />
                  <input type="text" value={editRj} onChange={e => setEditRj(e.target.value)} placeholder="RJ-код (например: RJ123456) — Оставьте пустым, если не нужно" style={{ width: '100%', padding: '10px', marginBottom: '15px', background: 'rgba(20,18,26,0.9)', color: 'var(--text)', border: '1px solid var(--gold-dim)', borderRadius: '4px', fontFamily: "'Cinzel', serif", outline: 'none' }} />
                  
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={handleSaveEdit} disabled={isSaving} style={{ flex: 1, padding: '10px', background: 'var(--gold-dim)', color: '#000', border: 'none', borderRadius: '4px', cursor: 'pointer', fontFamily: "'Cinzel', serif", fontWeight: 'bold', opacity: isSaving ? 0.5 : 1 }}>
                      💾 Сохранить
                    </button>
                    <button onClick={() => setIsEditing(false)} disabled={isSaving} style={{ padding: '10px 15px', background: 'none', color: 'var(--text-dim)', border: '1px solid var(--text-dim)', borderRadius: '4px', cursor: 'pointer', fontFamily: "'Cinzel', serif" }}>
                      Отмена
                    </button>
                  </div>
                  {editStatus && <div style={{ fontSize: '0.8rem', color: 'var(--gold-light)', marginTop: '12px', textAlign: 'center', animation: 'blink 1.5s infinite' }}>{editStatus}</div>}
                </div>
              )}
            </div>

            {!isEditing && (
              <>
                <div className="modal-meta">
                  <span><b>Свиток получен:</b> {formatDate(game.addedAt)}</span>
                  <span><b>Последний ритуал:</b> {formatDate(game.lastPlayed)}</span>
                </div>

                <div style={{ display: 'flex', gap: '10px', marginBottom: '25px' }}>
                  <button onClick={handleBackup} style={{ flex: 1, padding: '10px', background: 'rgba(20,18,26,0.8)', color: 'var(--text)', border: '1px solid var(--gold-dim)', borderRadius: '4px', cursor: 'pointer', fontFamily: "'Cinzel', serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    📦 Бэкап
                  </button>
                  <button onClick={() => importRef.current.click()} style={{ flex: 1, padding: '10px', background: 'rgba(20,18,26,0.8)', color: 'var(--text)', border: '1px solid var(--gold-dim)', borderRadius: '4px', cursor: 'pointer', fontFamily: "'Cinzel', serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    📥 {isImporting ? 'Ожидайте...' : 'Импорт'}
                  </button>
                  <input type="file" ref={importRef} accept=".zip" style={{ display: 'none' }} onChange={handleImportSelect} />
                </div>

                <div className="modal-tags">
                  {game.tags && game.tags.length > 0 ? (
                    game.tags.map(tag => <span key={tag} className="tag">{tag}</span>)
                  ) : (
                    <span className="tag" style={{ opacity: 0.5, borderColor: 'transparent' }}>Теги не расшифрованы</span>
                  )}
                </div>

                {game.description && (
                  <div className="modal-description">{game.description}</div>
                )}

                <button id="modal-play-btn" onClick={handlePlay} style={{ opacity: isPlaying ? 0.7 : 1, pointerEvents: isPlaying ? 'none' : 'auto' }}>
                  <span>{isPlaying ? 'Запуск...' : 'Играть'}</span> <span className="launch-arrow">→</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GameModal;