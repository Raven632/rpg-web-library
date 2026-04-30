import React, { useRef, useState } from 'react';

const Toolbar = ({ 
  searchQuery, setSearchQuery, availableTags, selectedTag, setSelectedTag,
  currentSort, setCurrentSort, onUploadSuccess, socketMessage, t, showToast
}) => {
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadState, setUploadState] = useState({ active: false, progress: 0, text: '' });

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files[0]; if (file) uploadFile(file); };
  const handleFileSelect = (e) => { const file = e.target.files[0]; if (file) uploadFile(file); e.target.value = ''; };

  const uploadFile = (file) => {
    if (!file.name.toLowerCase().match(/\.(zip|7z|rar)$/)) {
      showToast(t.wrong_ext, 'error');
      return;
    }

    const formData = new FormData();
    formData.append('game', file);
    setUploadState({ active: true, progress: 0, text: t.up_trans(file.name) });

    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 90);
        setUploadState(prev => ({ 
          ...prev, progress: percent, 
          text: t.up_prog((e.loaded / 1024 / 1024).toFixed(1), (e.total / 1024 / 1024).toFixed(1)) 
        }));
      }
    });

    xhr.addEventListener('load', () => {
      setUploadState(prev => ({ ...prev, progress: 100 }));
      try {
        const data = JSON.parse(xhr.responseText);
        if (data.success) {
          showToast(data.message, 'success');
          setUploadState(prev => ({ ...prev, text: `✓ ${data.message}` }));
          setTimeout(() => { setUploadState({ active: false, progress: 0, text: '' }); onUploadSuccess(); }, 2000);
        } else {
          showToast(data.error, 'error');
          setUploadState(prev => ({ ...prev, text: `✗ ${data.error}` }));
          setTimeout(() => setUploadState({ active: false, progress: 0, text: '' }), 4000);
        }
      } catch(e) {
        showToast(t.up_err, 'error');
        setUploadState(prev => ({ ...prev, text: t.up_err }));
        setTimeout(() => setUploadState({ active: false, progress: 0, text: '' }), 4000);
      }
    });

    xhr.addEventListener('error', () => {
      showToast(t.up_int, 'error');
      setUploadState({ active: true, progress: 0, text: t.up_int });
      setTimeout(() => setUploadState({ active: false, progress: 0, text: '' }), 4000);
    });

    xhr.open('POST', '/api/games/upload');
    xhr.send(formData);
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
        <option value="recent">{t.sort_rec}</option>
        <option value="rating_desc">{t.sort_rat}</option>
        <option value="name">{t.sort_alp}</option>
      </select>

      <div 
        className={`upload-btn ${isDragging ? 'drag-over' : ''}`} 
        onClick={() => fileInputRef.current.click()} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
        style={uploadState.active ? { pointerEvents: 'none', opacity: 0.5 } : {}}
      >
        <svg viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>
        {t.add_game}
      </div>

      <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".zip,.7z,.rar" onChange={handleFileSelect} />

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