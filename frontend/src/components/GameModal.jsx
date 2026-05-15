import React, { useState, useRef, useEffect } from 'react';

const ROMAN_NUMERALS = ['Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ','Ⅵ','Ⅶ','Ⅷ','Ⅸ','Ⅹ','Ⅺ','Ⅻ'];

const GameModal = ({ game, index, onClose, onUpdateGame, t, lang, showToast }) => {
  const [isActive, setIsActive] = useState(false);
  
  // Рефы для скрытых инпутов файлов
  const importRef = useRef(null);
  const coverInputRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsActive(true), 10);
    return () => clearTimeout(timer);
  }, []);

  const handleCloseModal = () => {
    setIsActive(false);
    setTimeout(onClose, 300);
  };

  // Красивое форматирование даты
  const formatDate = (ms) => {
    if (!ms) return t.never || 'Неизвестно';
    const locale = lang === 'en' ? 'en-US' : lang === 'de' ? 'de-DE' : 'ru-RU';
    return new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  };

  // Форматирование размера игры (байты в МБ/ГБ)
  const formatSize = (bytes) => {
    if (!bytes) return 'Неизвестно';
    const mb = bytes / (1024 * 1024);
    if (mb > 1024) return (mb / 1024).toFixed(2) + ' GB';
    return mb.toFixed(2) + ' MB';
  };

  // Состояния редактирования
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(game.title || '');
  const [editRj, setEditRj] = useState(''); // RJ код используем только для парсинга
  
  // Новые метаданные
  const [editDeveloper, setEditDeveloper] = useState(game.developer || '');
  const [editLanguage, setEditLanguage] = useState(game.language || '');
  const [editLink, setEditLink] = useState(game.link || '');

  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // --- ЗАГРУЗКА КАСТОМНОЙ ОБЛОЖКИ ---
  const handleCoverChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Выберите картинку!', 'error');
      return;
    }

    setIsUploadingCover(true);
    const formData = new FormData();
    formData.append('cover', file);

    try {
      const res = await fetch(`/api/games/${game.id}/cover`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      
      if (data.success) {
        // Обновляем обложку на лету без перезагрузки
        onUpdateGame(index, { ...game, cover: data.coverPath });
        showToast('Обложка успешно изменена!', 'success');
      } else {
        showToast(data.error || 'Ошибка загрузки', 'error');
      }
    } catch (err) {
      showToast('Ошибка соединения', 'error');
    } finally {
      setIsUploadingCover(false);
    }
  };

  // --- СОХРАНЕНИЕ МЕТАДАННЫХ ---
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/games/${game.id}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          title: editTitle, 
          rjCode: editRj,
          developer: editDeveloper,
          language: editLanguage,
          link: editLink
        })
      });
      const data = await res.json();
      if (data.success) {
        onUpdateGame(index, data.game);
        setIsEditing(false);
        showToast(t.save + ' Успешно!', 'success');
      }
    } catch (e) {
      showToast('Ошибка при сохранении', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePlay = () => {
    setIsPlaying(true);
    setTimeout(() => { window.location.href = game.url; }, 500);
  };

  const coverUrl = game.cover ? (import.meta.env.DEV ? `/media/${game.cover}?v=${Date.now()}` : `/${game.cover}?v=${Date.now()}`) : null;
  const roman = ROMAN_NUMERALS[index % ROMAN_NUMERALS.length] || String(index + 1);

  return (
    <div className={`modal-overlay ${isActive ? 'active' : ''}`} onClick={handleCloseModal}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        
        {/* Кнопка закрытия и настройки */}
        <div className="modal-actions-top">
          <div className={`modal-edit-toggle ${isEditing ? 'active' : ''}`} onClick={() => setIsEditing(!isEditing)} title={t.edit_meta}>⚙️</div>
          <div className="modal-close" onClick={handleCloseModal}>×</div>
        </div>

        <div className="modal-header">
          {/* ОБЛОЖКА */}
          <div className="modal-cover-wrapper" style={{ position: 'relative' }}>
            {coverUrl ? (
              <img id="modal-cover" src={coverUrl} alt={game.title} />
            ) : (
              <div className="cover-placeholder modal-placeholder">
                <span className="rune">{roman}</span>
              </div>
            )}
            
            {/* Оверлей для смены обложки в режиме редактирования */}
            {isEditing && (
              <div 
                className="cover-edit-overlay" 
                onClick={() => coverInputRef.current.click()}
              >
                {isUploadingCover ? '⏳ Загрузка...' : '📷 Изменить'}
              </div>
            )}
            <input type="file" ref={coverInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleCoverChange} />
          </div>

          {/* ИНФОРМАЦИЯ */}
          <div className="modal-info">
              {isEditing ? (
                <div className="grimoire-form">
                  {/* Твоя форма редактирования */}
                  <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Название..." />
                  <input type="text" value={editDeveloper} onChange={e => setEditDeveloper(e.target.value)} placeholder="Разработчик..." />
                  <input type="text" value={editLanguage} onChange={e => setEditLanguage(e.target.value)} placeholder="Язык (RU, JP, EN)..." />
                  <input type="text" value={editLink} onChange={e => setEditLink(e.target.value)} placeholder="Ссылка на источник..." />
                  <input type="text" value={editRj} onChange={e => setEditRj(e.target.value)} placeholder="RJ-код для скрейпинга..." />
                  
                  <div className="form-actions">
                    <button onClick={handleSave} className="save-btn">{t.save}</button>
                    <button onClick={() => setIsEditing(false)} className="cancel-btn">{t.cancel}</button>
                  </div>
                </div>
              ) : (
                <>
                  <h2 id="modal-title">{game.title}</h2>
                  
                  {/* КРАСИВАЯ ПАНЕЛЬ МЕТАДАННЫХ */}
                  <div className="grimoire-metadata">
                    <div className="meta-row">
                      <div className="meta-item">
                        <span className="meta-label">Разработчик:</span>
                        <span className="meta-value gold">{game.developer || 'Неизвестен'}</span>
                      </div>
                      <div className="meta-item">
                        <span className="meta-label">Язык:</span>
                        <span className="meta-value gold">{game.language || '—'}</span>
                      </div>
                    </div>
                    
                    <div className="meta-row">
                      <div className="meta-item">
                        <span className="meta-label">Размер:</span>
                        <span className="meta-value">{formatSize(game.size)}</span>
                      </div>
                      <div className="meta-item">
                        <span className="meta-label">Прибытие:</span>
                        <span className="meta-value">{formatDate(game.addedAt)}</span>
                      </div>
                    </div>

                    {game.link && (
                      <a href={game.link} target="_blank" rel="noreferrer" className="grimoire-link-btn">
                        <span className="rune">⚡</span> {t.link || 'Открыть в источнике'} ↗
                      </a>
                    )}
                  </div>

                  <div className="modal-tags">
                    {game.tags?.map(tag => <span key={tag} className="tag">{tag}</span>)}
                  </div>

                  {game.description && (
                    <div className="modal-description">{game.description}</div>
                  )}

                  <button id="modal-play-btn" onClick={handlePlay}>
                    <span>{isPlaying ? t.launching : t.play}</span>
                    <span className="launch-arrow">→</span>
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