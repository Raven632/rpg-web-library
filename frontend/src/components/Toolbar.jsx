import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const Toolbar = ({ 
  searchQuery, setSearchQuery, availableTags, selectedTag, setSelectedTag,
  currentSort, setCurrentSort, onUploadSuccess, socketMessage, t, showToast,
  blurCovers, setBlurCovers, statusFilter, setStatusFilter, canUpload
}) => {
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadState, setUploadState] = useState({ active: false, progress: 0, text: '', name: '' });

  const handleFileSelect = (e) => { const file = e.target.files[0]; if (file) uploadFile(file); e.target.value = ''; };

  // Обработчики ниже вешаются на окно один раз, а uploadFile пересоздаётся на каждом
  // рендере (в нём язык, тосты, колбэки). Через ref они всегда зовут свежую версию,
  // иначе после смены языка загрузка писала бы сообщения на старом.
  const uploadFileRef = useRef(null);
  const uploadActiveRef = useRef(false);

  // Архив можно бросить в любое место страницы, а не только на кнопку: кнопка
  // на телефоне и на широком экране — маленькая цель, а при прокрутке её вообще не видно.
  useEffect(() => {
    if (!canUpload) return undefined;

    // dragenter и dragleave приходят на каждый дочерний элемент по пути курсора.
    // Без счётчика оверлей мигал бы на каждой границе карточки.
    let depth = 0;
    // Картинку со страницы тоже можно потащить, и браузер тоже назовёт её «файлом».
    // Такие перетаскивания начинаются внутри документа — их отличаем по dragstart.
    let internal = false;

    const hasFiles = (e) => !internal && Array.from(e.dataTransfer?.types || []).includes('Files');

    const onStart = () => { internal = true; };
    const onEnd = () => { internal = false; };
    const onEnter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setIsDragging(true);
    };
    const onOver = (e) => {
      if (!hasFiles(e)) return;
      // Без preventDefault браузер не разрешит бросить файл и просто откроет его во вкладке
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsDragging(false);
    };
    const onDrop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setIsDragging(false);
      if (uploadActiveRef.current) {
        showToast(t.up_busy, 'error');
        return;
      }
      const file = e.dataTransfer.files[0];
      if (file) uploadFileRef.current(file);
    };

    window.addEventListener('dragstart', onStart);
    window.addEventListener('dragend', onEnd);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragstart', onStart);
      window.removeEventListener('dragend', onEnd);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [canUpload, showToast, t]);

  const uploadFile = async (file) => {
    if (!file.name.toLowerCase().match(/\.(zip|7z|rar)$/i)) {
      showToast(t.wrong_ext, 'error');
      return;
    }

    const CHUNK_SIZE = 50 * 1024 * 1024; // 50 Мегабайт
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    
    // Создаем уникальный ID для этой загрузки (чтобы бэкенд знал, какие куски клеить)
    const uploadId = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 7);
    
    setUploadState({ active: true, progress: 0, text: t.up_trans(file.name), name: file.name });

    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const params = new URLSearchParams({
          uploadId,
          chunkIndex: i,
          totalChunks,
          offset: start,
          totalSize: file.size,
          originalName: file.name,
        });

        // --- ДОБАВЛЯЕМ СИСТЕМУ ПОВТОРОВ (RETRY) ---
        let chunkSuccess = false;
        let retries = 0;

        while (!chunkSuccess && retries < 3) {
          try {
            const data = await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open('POST', `/api/games/upload-chunk?${params}`);
              xhr.setRequestHeader('Content-Type', 'application/octet-stream');
              
              xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                  const loadedBytes = (i * CHUNK_SIZE) + e.loaded;
                  const percent = Math.round((loadedBytes / file.size) * 90);
                  setUploadState(prev => ({ 
                    ...prev, progress: percent, 
                    text: t.up_prog((loadedBytes / 1024 / 1024).toFixed(1), (file.size / 1024 / 1024).toFixed(1)) 
                  }));
                }
              });

              xhr.addEventListener('load', () => {
                if (xhr.status >= 400) reject(new Error(t.up_err));
                else resolve(JSON.parse(xhr.responseText));
              });

              xhr.addEventListener('error', () => reject(new Error(t.up_int)));
              xhr.send(chunk);
            });

            // Если ошибки не было, выходим из цикла retry
            chunkSuccess = true;

            if (data.finished) {
              setUploadState(prev => ({ ...prev, progress: 100, text: `✓ ${data.message}` }));
              showToast(data.message, 'success');
              setTimeout(() => { setUploadState({ active: false, progress: 0, text: '', name: '' }); onUploadSuccess(); }, 2000);
            }
          } catch (err) {
            retries++;
            console.warn(`[Upload] Ошибка куска ${i}. Попытка ${retries} из 3...`);
            if (retries >= 3) throw err; // Если 3 раза не вышло - крашим всю загрузку
            await new Promise(r => setTimeout(r, 2000)); // Ждем 2 секунды перед повтором
          }
        }
      }
    } catch (err) {
      showToast(err.message, 'error');
      setUploadState(prev => ({ ...prev, text: `✗ ${err.message}` }));
      setTimeout(() => setUploadState({ active: false, progress: 0, text: '', name: '' }), 4000);
    }
  };
  uploadFileRef.current = uploadFile;
  uploadActiveRef.current = uploadState.active;

  return (
    <div className="controls-zone">
      <div className="search-box">
        <svg className="search-icon" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        <input type="text" placeholder={t.search} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
      </div>

      <select className="sort-box" value={selectedTag} onChange={(e) => setSelectedTag(e.target.value)}>
        <option value="all">{t.all_genres}</option>
        {availableTags.map(tag => <option key={tag.name} value={tag.name}>{tag.name} ({tag.count})</option>)}
      </select>

      <select className="sort-box" value={currentSort} onChange={(e) => setCurrentSort(e.target.value)}>
        <option value="newest">{t.sort_new}</option>
        <option value="oldest">{t.sort_old}</option>
        <option value="recent">{t.sort_rec}</option>
        <option value="playtime">{t.sort_playtime}</option>
        <option value="rating_desc">{t.sort_rat}</option>
        <option value="name">{t.sort_alp}</option>
        <option value="size_desc">{t.sort_size_desc}</option>
        <option value="size_asc">{t.sort_size_asc}</option>
      </select>

      {/* Кнопка без текста, поэтому смысл — в подсказке и в aria-label:
          иначе назначение приходится угадывать, а экранный диктор читает «кнопка» */}
      <button
        type="button"
        className={`cover-toggle ${blurCovers ? 'active' : ''}`}
        onClick={() => setBlurCovers(v => !v)}
        title={blurCovers ? t.covers_show : t.covers_hide}
        aria-label={blurCovers ? t.covers_show : t.covers_hide}
        aria-pressed={blurCovers}
      >
        {blurCovers ? (
          <svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2z"/></svg>
        ) : (
          <svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
        )}
      </button>

      <div 
        className="upload-btn" 
        onClick={() => fileInputRef.current.click()}
        style={uploadState.active ? { pointerEvents: 'none', opacity: 0.5 } : {}}
      >
        <svg viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>
        {t.add_game}
      </div>

      <div className="filter-chips">
        {[
          ['all', t.filter_all],
          ['fav', `★ ${t.filter_fav}`],
          ['playing', t.status_playing],
          ['done', t.status_done],
          ['dropped', t.status_dropped],
          ['wish', t.status_wish],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`chip ${statusFilter === key ? 'active' : ''}`}
            onClick={() => setStatusFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".zip,.7z,.rar,application/zip,application/x-rar-compressed,application/vnd.rar,application/x-7z-compressed,application/octet-stream" onChange={handleFileSelect}/>

      {/* Оверлей и карточка загрузки рисуются прямо в body: бросить архив можно
          с любого места страницы, и ход загрузки должен быть виден там же,
          а не в панели, до которой надо прокручивать */}
      {isDragging && !uploadState.active && createPortal(
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-frame">
            <svg className="drop-overlay-icon" viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>
            <div className="drop-overlay-title">{t.drop_title}</div>
            <div className="drop-overlay-hint">{t.drop_hint}</div>
          </div>
        </div>,
        document.body
      )}

      {uploadState.active && createPortal(
        <div className="upload-card" role="status" aria-live="polite">
          <div className="upload-card-head">
            <svg className="upload-card-icon" viewBox="0 0 24 24"><path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/></svg>
            <div className="upload-card-text">
              <div className="upload-card-name" title={uploadState.name}>{uploadState.name}</div>
              <div className="upload-card-status">{socketMessage || uploadState.text}</div>
            </div>
            <div className="upload-card-pct">{uploadState.progress}%</div>
          </div>
          <div className="upload-card-track">
            <div className="progress-bar" style={{ width: `${uploadState.progress}%` }}></div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default Toolbar;
