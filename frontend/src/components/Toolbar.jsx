import React, { useRef, useState } from 'react';

const Toolbar = ({ 
  searchQuery, setSearchQuery, availableTags, selectedTag, setSelectedTag,
  currentSort, setCurrentSort, onUploadSuccess, socketMessage, t, showToast,
  blurCovers, setBlurCovers, statusFilter, setStatusFilter
}) => {
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadState, setUploadState] = useState({ active: false, progress: 0, text: '' });

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files[0]; if (file) uploadFile(file); };
  const handleFileSelect = (e) => { const file = e.target.files[0]; if (file) uploadFile(file); e.target.value = ''; };

  const uploadFile = async (file) => {
    if (!file.name.toLowerCase().match(/\.(zip|7z|rar)$/i)) {
      showToast(t.wrong_ext, 'error');
      return;
    }

    const CHUNK_SIZE = 50 * 1024 * 1024; // 50 Мегабайт
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    
    // Создаем уникальный ID для этой загрузки (чтобы бэкенд знал, какие куски клеить)
    const uploadId = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 7);
    
    setUploadState({ active: true, progress: 0, text: t.up_trans(file.name) });

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
              setTimeout(() => { setUploadState({ active: false, progress: 0, text: '' }); onUploadSuccess(); }, 2000);
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
      setTimeout(() => setUploadState({ active: false, progress: 0, text: '' }), 4000);
    }
  };

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

      <button
        type="button"
        className={`cover-toggle ${blurCovers ? 'active' : ''}`}
        onClick={() => setBlurCovers(v => !v)}
      >
        {blurCovers ? (
          <svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2z"/></svg>
        ) : (
          <svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
        )}
        <span className="cover-toggle-label">{blurCovers ? t.covers_show : t.covers_hide}</span>
      </button>

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

      <div 
        className={`upload-btn ${isDragging ? 'drag-over' : ''}`} 
        onClick={() => fileInputRef.current.click()} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
        style={uploadState.active ? { pointerEvents: 'none', opacity: 0.5 } : {}}
      >
        <svg viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>
        {t.add_game}
      </div>

      <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".zip,.7z,.rar,application/zip,application/x-rar-compressed,application/vnd.rar,application/x-7z-compressed,application/octet-stream" onChange={handleFileSelect}/>

      {uploadState.active && (
        <div className="progress-wrap" style={{ display: 'block' }}>
          <div className="progress-bar" style={{ width: `${uploadState.progress}%` }}></div>
          <div className="progress-text">{socketMessage || uploadState.text}</div>
        </div>
      )}
    </div>
  );
};

export default Toolbar;
