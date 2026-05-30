import React, { useState, useRef, useEffect } from 'react';

// Логотипы (пути относительно папки public)
const STEAM_LOGO = 'steam_logo.png';
const DLSITE_LOGO = 'dlsite_logo.png';

const ROMAN_NUMERALS = ['Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ','Ⅵ','Ⅶ','Ⅷ','Ⅸ','Ⅹ','Ⅺ','Ⅻ'];

const GameModal = ({ game, index, onClose, onUpdateGame, t, lang, showToast }) => {
  const [isActive, setIsActive] = useState(false);
  
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

  const formatDate = (ms) => {
    if (!ms) return t.never || 'Неизвестно';
    const locale = lang === 'en' ? 'en-US' : lang === 'de' ? 'de-DE' : 'ru-RU';
    return new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const formatReleaseDate = (dateStr) => {
    if (!dateStr) return '—';
    if (/^\d{4}$/.test(dateStr)) return dateStr;
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        const locale = lang === 'en' ? 'en-US' : lang === 'de' ? 'de-DE' : 'ru-RU';
        return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
      }
    } catch (e) {}
    return dateStr;
  };

  const formatSize = (bytes) => {
    if (!bytes) return 'Неизвестно';
    const mb = bytes / (1024 * 1024);
    if (mb > 1024) return (mb / 1024).toFixed(2) + ' GB';
    return mb.toFixed(2) + ' MB';
  };

  const notify = (msg, type = 'info') => {
    if (showToast) showToast(msg, type);
    else alert(msg);
  };

  const handleRjChange = (e) => {
    const val = e.target.value;
    // Ищем паттерн RJ-кода в любом вставленном тексте или ссылке
    const match = val.match(/RJ\d{6,8}/i);
    setEditRj(match ? match[0].toUpperCase() : val); // Используем твой setEditRj
  };

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(game.title || '');
  const [editRj, setEditRj] = useState('');
  const [editDeveloper, setEditDeveloper] = useState(game.developer || '');
  const [editLanguage, setEditLanguage] = useState(game.language || '');
  const [editReleaseDate, setEditReleaseDate] = useState(game.releaseDate || '');
  const [editLink, setEditLink] = useState(game.link || '');
  
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (isEditing) {
      setEditTitle(game.title || '');
      setEditDeveloper(game.developer || '');
      setEditLanguage(game.language || '');
      setEditReleaseDate(game.releaseDate || '');
      setEditLink(game.link || '');
    }
  }, [isEditing, game]);

  const handleBackup = () => {
    // Бэкенд ждет путь /export/:id (с учетом префикса роутера это /api/saves/export/)
    window.location.href = `/api/saves/export/${game.id}`; 
  };

  const handleImportSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsImporting(true);
    const formData = new FormData();
    formData.append('saves', file);
    try {
      const res = await fetch(`/api/saves/import/${game.id}`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        notify(t.import_success || 'Импорт завершен успешно!', 'success');
        onUpdateGame(index, game);
      } else {
        notify(data.error || 'Ошибка импорта', 'error');
      }
    } catch (err) {
      notify('Ошибка сети при импорте', 'error');
    } finally {
      setIsImporting(false);
      e.target.value = '';
    }
  };

  const handleCoverClick = () => {
    if (isEditing && !isUploadingCover && coverInputRef.current) {
      coverInputRef.current.click();
    }
  };

  const handleCoverChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      notify('Выберите файл изображения!', 'error');
      e.target.value = '';
      return;
    }

    setIsUploadingCover(true);
    const formData = new FormData();
    formData.append('cover', file);

    try {
      const res = await fetch(`/api/games/${game.id}/cover`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        onUpdateGame(index, { ...game, cover: data.coverPath });
        notify('Обложка успешно изменена!', 'success');
      } else {
        notify(data.error || 'Ошибка при загрузке обложки', 'error');
      }
    } catch (err) {
      notify('Ошибка соединения с сервером', 'error');
    } finally {
      setIsUploadingCover(false);
      e.target.value = ''; 
    }
  };

  const handleCoverDelete = async (e) => {
    e.stopPropagation(); 
    if (!window.confirm('Вернуть изначальную обложку?')) return;

    setIsUploadingCover(true);
    try {
      const res = await fetch(`/api/games/${game.id}/cover`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        onUpdateGame(index, { ...game, cover: data.coverPath });
        notify('Обложка сброшена!', 'success');
      } else {
        notify(data.error || 'Ошибка', 'error');
      }
    } catch (err) {
      notify('Ошибка сети', 'error');
    } finally {
      setIsUploadingCover(false);
    }
  };

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
          releaseDate: editReleaseDate,
          link: editLink
        })
      });
      const data = await res.json();
      if (data.success) {
        onUpdateGame(index, {
          ...game,
          title: editTitle,
          developer: editDeveloper,
          language: editLanguage,
          releaseDate: editReleaseDate,
          
          // ИСПРАВЛЕНО: Сначала берем агрегированные ссылки от сервера!
          link: data.game?.link || editLink, 
          
          ...(data.game?.cover && { cover: data.game.cover }),
          ...(data.game?.tags && { tags: data.game.tags }),
          ...(data.game?.description && { description: data.game.description }),
          updatedAt: Date.now()
        });
        
        setIsEditing(false);
        setEditRj('');
        notify(t.save + ' Успешно!', 'success');
      } else {
        notify(data.error || 'Ошибка при сохранении', 'error');
      }
    } catch (e) {
      notify('Ошибка соединения с сервером', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePlay = () => {
    setIsPlaying(true);
    
    // Динамически подставляем протокол (http/https) и IP-адрес/домен твоего сервера,
    // с которого зашёл пользователь, меняя в DEV-режиме только порт на бэкенд (3000)
    const playUrl = import.meta.env.DEV 
      ? `${window.location.protocol}//${window.location.hostname}${game.url}` 
      : game.url;

    setTimeout(() => { window.location.href = playUrl; }, 500);
  };

  // --- НОВАЯ ЛОГИКА ОПРЕДЕЛЕНИЯ САЙТА ДЛЯ ССЫЛКИ ---
  const renderSourceLink = () => {
    if (!game.link) return null;
    
    // Разбиваем строку по запятым на массив ссылок
    const links = game.link.split(/[, ]+/).filter(Boolean);
    
    return (
      <div style={{ display: 'flex', gap: '10px' }}>
        {links.map((url, idx) => {
          let iconSrc = '';
          if (url.includes('dlsite.com')) iconSrc = '/dlsite-logo.png';
          else if (url.includes('vndb.org')) iconSrc = '/vndb-logo.png';
          else if (url.includes('steampowered.com')) iconSrc = '/steam-logo.png';

          return (
            <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="grimoire-source-link" title={url}>
              {iconSrc ? <img src={iconSrc} alt="Source" className="grimoire-source-logo" /> : '🔗'}
            </a>
          );
        })}
      </div>
    );
  };

  const coverBase = game.cover ? (import.meta.env.DEV ? `/media/${game.cover}` : `/${game.cover}`) : null;
  // Теперь React всегда будет видеть, что картинка новая!
  const coverUrl = coverBase ? `${coverBase}?v=${game.updatedAt || game.addedAt || Date.now()}` : null;
  const roman = ROMAN_NUMERALS[index % ROMAN_NUMERALS.length] || String(index + 1);

  return (
    <div className={`modal-overlay ${isActive ? 'active' : ''}`} onClick={handleCloseModal}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        
        <div className="modal-actions-top">
          <div className={`modal-edit-toggle ${isEditing ? 'active' : ''}`} onClick={() => setIsEditing(!isEditing)} title={t.edit_meta}>⚙️</div>
          <div className="modal-close" onClick={handleCloseModal}>×</div>
        </div>

        <div className="modal-header">
          <div className={`modal-cover-wrapper ${isEditing ? 'editable' : ''}`} onClick={handleCoverClick}>
            {isEditing && game.cover && (
              <div className="cover-delete-btn" onClick={handleCoverDelete} title="Сбросить на оригинал">✖</div>
            )}
            {coverUrl ? (
              <img id="modal-cover" src={coverUrl} alt={game.title} />
            ) : (
              <div className="cover-placeholder modal-placeholder"><span className="rune">{roman}</span></div>
            )}
            {isEditing && <div className="cover-edit-overlay">{isUploadingCover ? '⏳' : '📷'}</div>}
            <input type="file" ref={coverInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleCoverChange} disabled={isUploadingCover}/>
          </div>

          <div className="modal-info">
            {isEditing ? (
              <div className="grimoire-form">
                {/* Код формы редактирования оставляй без изменений */}
                <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Название игры..." />
                <input type="text" value={editDeveloper} onChange={e => setEditDeveloper(e.target.value)} placeholder="Разработчик..." />
                <input type="text" value={editReleaseDate} onChange={e => setEditReleaseDate(e.target.value)} placeholder="Дата выпуска (ГГГГ-ММ-ДД)..." />
                <input type="text" value={editLanguage} onChange={e => setEditLanguage(e.target.value)} placeholder="Язык (RU, EN, JP)..." />
                <input type="text" value={editLink} onChange={e => setEditLink(e.target.value)} placeholder="Ссылка на источник..." />
                <input type="text" value={editRj} onChange={handleRjChange} placeholder="RJ код или полная ссылка на игру" />
                
                <div className="form-actions">
                  <button onClick={handleSave} disabled={isSaving} className="save-btn">{isSaving ? '⏳...' : t.save}</button>
                  <button onClick={() => setIsEditing(false)} className="cancel-btn">{t.cancel}</button>
                </div>
              </div>
            ) : (
              <>
                {/* --- НОВЫЙ БЛОК ЗАГОЛОВКА С ЛОГОТИПОМ НА ОДНОЙ ЛИНИИ --- */}
                <div className="modal-title-block">
                  <h2 id="modal-title">{game.title}</h2>
                </div>
                
                {/* --- ОЧИЩЕННЫЕ ОТ ССЫЛКИ СТРОКИ МЕТАДАННЫХ --- */}
                <div className="grimoire-metadata">
                  <div className="meta-row">
                    <div className="meta-item">
                      <span className="meta-label">Разработчик:</span>
                      <span className="meta-value gold">{game.developer || 'Неизвестен'}</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">Выпуск:</span>
                      <span className="meta-value gold">{formatReleaseDate(game.releaseDate)}</span>
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
                </div>

                {/* --- ЛОГОТИП ТЕПЕРЬ ЗДЕСЬ (МЕЖДУ ДАТОЙ И БЭКАПОМ) --- */}
                <div style={{ display: 'flex', justifyContent: 'left', marginBottom: '20px' }}>
                  {renderSourceLink()}
                </div>

                <div className="grimoire-actions-row">
                  <button onClick={handleBackup} className="grimoire-action-btn">{t.backup || 'Бэкап'}</button>
                  <button onClick={() => importRef.current.click()} className="grimoire-action-btn">{isImporting ? t.import_wait : t.import}</button>
                  <input type="file" ref={importRef} accept=".zip" style={{ display: 'none' }} onChange={handleImportSelect} />
                </div>

                <div className="modal-tags">
                  {game.tags && game.tags.length > 0 ? (
                    game.tags.map(tag => <span key={tag} className="tag">{tag}</span>)
                  ) : (
                    <span className="tag" style={{ opacity: 0.5, borderColor: 'transparent' }}>{"Нет тегов"}</span>
                  )}
                </div>

                {game.description && (
                  <div className="modal-description">{game.description}</div>
                )}

                <button id="modal-play-btn" onClick={handlePlay} style={{ opacity: isPlaying ? 0.7 : 1, pointerEvents: isPlaying ? 'none' : 'auto' }}>
                  <span>{isPlaying ? t.launching : t.play}</span> <span className="launch-arrow">→</span>
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