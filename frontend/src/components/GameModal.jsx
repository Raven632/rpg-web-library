import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

import { getCoverUrl, getMediaUrl } from '../coverUrl';

import { formatPlaytime } from '../formatPlaytime';

import { launchGame } from '../launchGame';

import { IconEdit, IconDownload, IconUpload } from './icons';

import { describeMeta } from '../formatRetry';

// Логотипы (пути относительно папки public)
const STEAM_LOGO = 'steam_logo.png';
const DLSITE_LOGO = 'dlsite_logo.png';

const ROMAN_NUMERALS = ['Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ','Ⅵ','Ⅶ','Ⅷ','Ⅸ','Ⅹ','Ⅺ','Ⅻ'];
const GameModal = ({ game, index, onClose, onUpdateGame, onPatch, onTagClick, t, lang, showToast }) => {
  const [isActive, setIsActive] = useState(false);
  // Номер раскрытой картинки или null. Раньше кадр открывался новой вкладкой —
  // игру при этом приходилось терять из виду и возвращаться назад руками.
  const [lightbox, setLightbox] = useState(null);
  
  const importRef = useRef(null);
  const coverInputRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsActive(true), 10);
    return () => clearTimeout(timer);
  }, []);

  // Обработчик живёт только пока картинка раскрыта: Esc закрывает просмотрщик,
  // а не всё окно игры, стрелки листают кадры по кругу
  useEffect(() => {
    if (lightbox === null) return undefined;
    const total = game.screens?.length || 0;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null);
      else if (e.key === 'ArrowRight' && total) setLightbox(i => (i + 1) % total);
      else if (e.key === 'ArrowLeft' && total) setLightbox(i => (i - 1 + total) % total);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, game.screens]);

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
  // «Искать сейчас» нажата: запоминаем время последней проверки на момент нажатия.
  // Пока оно не сменилось, воркер ещё не записал новый итог — поиск идёт.
  // Вычисляем, а не сбрасываем эффектом: так не бывает лишнего прохода рендера.
  const [queuedFrom, setQueuedFrom] = useState(null);
  const searchQueued = queuedFrom !== null && (game.meta?.checkedAt || 0) === queuedFrom;

  const handleRescrape = async () => {
    setQueuedFrom(game.meta?.checkedAt || 0);
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(game.id)}/rescrape`, { method: 'POST' });
      if (!res.ok) throw new Error();
    } catch {
      setQueuedFrom(null);
      showToast?.(t.err_net, 'error');
    }
  };
  const [editTitle, setEditTitle] = useState(game.title || '');
  const [editRj, setEditRj] = useState('');
  // Кандидаты с F95 для ручного выбора: автомат ошибается на непохожих названиях,
  // а человек узнаёт свою игру с первого взгляда
  const [f95List, setF95List] = useState([]);
  const [f95Busy, setF95Busy] = useState(false);
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
        notify(t.import_success, 'success');
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
        // Сервер возвращает итог целиком: что человек ввёл, что нашлось и состояние поиска
        onUpdateGame(index, { ...game, ...(data.game || {}), updatedAt: Date.now() });

        // Раньше при неудаче здесь всё равно писалось «Успешно», хотя сервер в этот
        // момент стирал теги. Теперь данные не трогаются, а человек узнаёт, что поиск
        // ничего не дал. Молчим, если он искать и не просил — просто поправил поле.
        const askedToSearch = !!editRj || editLink !== (game.link || '');
        if (!data.found && askedToSearch) {
          notify(data.failed?.length ? t.edit_unreachable(data.failed.join(', ')) : t.edit_not_found, 'error');
        } else {
          notify(t.saved_ok, 'success');
        }
        setIsEditing(false);
        setEditRj('');
      } else {
        notify(data.error || 'Ошибка при сохранении', 'error');
      }
    } catch (e) {
      notify('Ошибка соединения с сервером', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const searchF95 = async () => {
    setF95Busy(true);
    try {
      const q = (editTitle || game.title || '').trim();
      const res = await fetch(`/api/games/${encodeURIComponent(game.id)}/f95-search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setF95List(data.items || []);
      if (!data.items || data.items.length === 0) showToast(t.f95_none, 'error');
    } catch (err) {
      showToast(t.err_net, 'error');
    } finally {
      setF95Busy(false);
    }
  };

  const handlePlay = async () => {
    setIsPlaying(true);
    await launchGame(game, (updated) => onUpdateGame(index, updated));
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
          else if (url.includes('f95zone.to')) iconSrc = '/f95-logo.png';

          return (
            <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="grimoire-source-link" title={url}>
              {iconSrc ? <img src={iconSrc} alt="Source" className="grimoire-source-logo" /> : '🔗'}
            </a>
          );
        })}
      </div>
    );
  };

  const coverUrl = getCoverUrl(game);
  const roman = ROMAN_NUMERALS[index % ROMAN_NUMERALS.length] || String(index + 1);

  return (
    <div className={`modal-overlay ${isActive ? 'active' : ''}`} onClick={handleCloseModal}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        
        {/* В углу остаётся только крестик — его там ищут по привычке в любом окне.
            Шестерёнка висела рядом и заезжала на длинное название: теперь это
            обычная кнопка «Изменить» в ряду с остальными действиями над игрой */}
        <div className="modal-actions-top">
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
                <input type="text" value={editRj} onChange={handleRjChange} placeholder="RJ-код или ссылка: DLsite, Steam, VNDB, F95zone" />
                <button type="button" className="chip f95-search-btn" onClick={searchF95} disabled={f95Busy}>
                  🔎 {f95Busy ? t.checking : t.f95_search}
                </button>
                {f95List.length > 0 && (
                  <div className="f95-list">
                    {f95List.map(item => (
                      <button type="button" key={item.url} className="f95-item"
                        onClick={() => { setEditRj(item.url); setF95List([]); }}>
                        <span className="f95-title">{item.title}</span>
                        <span className="f95-meta">{item.creator} · {t.f95_tags(item.tags)}{item.rating ? ` · ★${item.rating}` : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
                
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
                      <span className="meta-label">{t.meta_dev}</span>
                      <span className="meta-value gold">{game.developer || t.meta_unknown}</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">{t.meta_release}</span>
                      <span className="meta-value gold">{formatReleaseDate(game.releaseDate)}</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">{t.meta_lang}</span>
                      <span className="meta-value gold">{game.language || '—'}</span>
                    </div>
                  </div>

                  <div className="meta-row">
                    <div className="meta-item">
                      <span className="meta-label">{t.meta_size}</span>
                      <span className="meta-value">{formatSize(game.size)}</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">{t.meta_added}</span>
                      <span className="meta-value">{formatDate(game.addedAt)}</span>
                    </div>
                  </div>
                </div>

                {/* --- ЛОГОТИП ТЕПЕРЬ ЗДЕСЬ (МЕЖДУ ДАТОЙ И БЭКАПОМ) --- */}
                <div style={{ display: 'flex', justifyContent: 'left', marginBottom: '20px' }}>
                  {renderSourceLink()}
                </div> 

                {/* Если метаданные не полные — видно, почему и что будет дальше. Раньше
                    это было не узнать: пометки «не найдено» жили в Redis и никуда не выводились */}
                {(() => {
                  const info = describeMeta(game.meta, t, lang);
                  if (!info) return null;
                  const busy = info.searching || searchQueued;
                  return (
                    <div className={`meta-status ${game.meta.status}`}>
                      <div className="meta-status-text">
                        <b>{busy ? t.meta_line_new : info.text}</b>
                        {!busy && info.details && <span>{info.details}</span>}
                        {!busy && game.meta.status !== 'partial' && <span className="meta-status-hint">{t.meta_manual_hint}</span>}
                      </div>
                      {!busy && (
                        <button type="button" className="meta-status-btn" onClick={handleRescrape}>{t.meta_search_now}</button>
                      )}
                    </div>
                  );
                })()}

                {formatPlaytime(game.playtime, t) && (
                  <div className="modal-progress">
                    <span className="meta-label">{t.playtime}</span> <b>{formatPlaytime(game.playtime, t)}</b>
                    {game.progress?.level != null && <> · <span className="meta-label">{t.progress_level}</span> <b>{game.progress.level}</b></>}
                    {game.progress?.gold != null && <> · <span className="meta-label">{t.progress_gold}</span> <b>{game.progress.gold.toLocaleString(lang === 'en' ? 'en-US' : lang === 'de' ? 'de-DE' : 'ru-RU')}</b></>}
                  </div>
                )}

                <div className="status-row">
                  <button
                    type="button"
                    className={`chip ${game.favorite ? 'active' : ''}`}
                    onClick={() => onPatch(game.id, { favorite: !game.favorite })}
                  >
                    ★ {t.filter_fav}
                  </button>
                  {['playing', 'done', 'dropped', 'wish'].map(key => (
                    <button
                      key={key}
                      type="button"
                      className={`chip ${game.status === key ? 'active' : ''}`}
                      onClick={() => onPatch(game.id, { status: game.status === key ? '' : key })}
                    >
                      {t[`status_${key}`]}
                    </button>
                  ))}
                </div>

                <div className="grimoire-actions-row">
                  <button onClick={() => setIsEditing(true)} className="grimoire-action-btn" title={t.edit_meta}><IconEdit />{t.edit_btn}</button>
                  <button onClick={handleBackup} className="grimoire-action-btn"><IconDownload />{t.backup}</button>
                  <button onClick={() => importRef.current.click()} className="grimoire-action-btn"><IconUpload />{isImporting ? t.import_wait : t.import}</button>
                  <input type="file" ref={importRef} accept=".zip" style={{ display: 'none' }} onChange={handleImportSelect} />
                </div>

                <div className="modal-tags">
                  {game.tags && game.tags.length > 0 ? (
                    game.tags.map(tag => (
                      // Тег — кнопка, а не текст: клик уводит в библиотеку, отфильтрованную
                      // по нему. Раньше «а что ещё есть такого же» приходилось искать руками
                      // в выпадающем списке, хотя ответ был прямо перед глазами.
                      <button
                        key={tag}
                        type="button"
                        className="tag tag-link"
                        onClick={() => onTagClick?.(tag)}
                        title={t.tag_filter_by(tag)}
                      >
                        {tag}
                      </button>
                    ))
                  ) : (
                    <span className="tag" style={{ opacity: 0.5, borderColor: 'transparent' }}>{t.no_tags}</span>
                  )}
                </div>

                {game.screens && game.screens.length > 0 && (
                  <div className="game-screens">
                    {game.screens.map((src, i) => (
                      <button key={src} type="button" className="screen-thumb" onClick={() => setLightbox(i)} title={t.screens_open}>
                        <img src={getMediaUrl(src)} alt={`${game.title} — ${i + 1}`} loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}

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

      {/* Просмотрщик рисуем прямо в body: у окна игры есть backdrop-filter, а он
          становится точкой отсчёта для position: fixed внутри — картинка выросла бы
          не во весь экран, а в рамку окна за вычетом его отступов */}
      {lightbox !== null && game.screens?.length > 0 && createPortal(
        <div className="lightbox" onClick={(e) => { e.stopPropagation(); setLightbox(null); }}>
          <button type="button" className="lightbox-close" onClick={(e) => { e.stopPropagation(); setLightbox(null); }}>×</button>

          {game.screens.length > 1 && (
            <>
              <button
                type="button"
                className="lightbox-nav prev"
                onClick={(e) => { e.stopPropagation(); setLightbox(i => (i - 1 + game.screens.length) % game.screens.length); }}
              >‹</button>
              <button
                type="button"
                className="lightbox-nav next"
                onClick={(e) => { e.stopPropagation(); setLightbox(i => (i + 1) % game.screens.length); }}
              >›</button>
            </>
          )}

          {/* Клик по самой картинке не закрывает: промахнуться мимо мелкой кнопки легко */}
          <img
            src={getMediaUrl(game.screens[lightbox])}
            alt={`${game.title} — ${lightbox + 1}`}
            onClick={(e) => e.stopPropagation()}
          />

          {game.screens.length > 1 && (
            <div className="lightbox-counter">{lightbox + 1} / {game.screens.length}</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

export default GameModal;
