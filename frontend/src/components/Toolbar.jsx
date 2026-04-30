import React, { useRef, useState } from 'react';

const Toolbar = ({ 
  searchQuery, setSearchQuery, 
  availableTags, selectedTag, setSelectedTag,
  currentSort, setCurrentSort,
  onUploadSuccess, socketMessage // Новые пропсы для загрузки
}) => {
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadState, setUploadState] = useState({ active: false, progress: 0, text: '' });

  // Эффекты перетаскивания
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) uploadFile(file);
    e.target.value = ''; // Сбрасываем инпут
  };

  // Главная функция загрузки (как в твоем оригинале, но React-way)
  const uploadFile = (file) => {
    if (!file.name.toLowerCase().match(/\.(zip|7z|rar)$/)) {
      alert('Сервер принимает только архивы ZIP, 7z или RAR!');
      return;
    }

    const formData = new FormData();
    formData.append('game', file);

    setUploadState({ active: true, progress: 0, text: `Передача ${file.name}...` });

    const xhr = new XMLHttpRequest();

    // Отслеживаем передачу файла (до 90%)
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 90);
        setUploadState(prev => ({ 
          ...prev, 
          progress: percent, 
          text: `Передача маны: ${(e.loaded / 1024 / 1024).toFixed(1)} / ${(e.total / 1024 / 1024).toFixed(1)} MB` 
        }));
      }
    });

    // Ответ от сервера
    xhr.addEventListener('load', () => {
      setUploadState(prev => ({ ...prev, progress: 100 }));
      try {
        const data = JSON.parse(xhr.responseText);
        if (data.success) {
          setUploadState(prev => ({ ...prev, text: `✓ ${data.message}` }));
          setTimeout(() => {
            setUploadState({ active: false, progress: 0, text: '' });
            onUploadSuccess(); // Командуем React обновить список игр
          }, 2000);
        } else {
          setUploadState(prev => ({ ...prev, text: `✗ ${data.error}` }));
          setTimeout(() => setUploadState({ active: false, progress: 0, text: '' }), 4000);
        }
      } catch(e) {
        setUploadState(prev => ({ ...prev, text: '✗ Ошибка сервера' }));
        setTimeout(() => setUploadState({ active: false, progress: 0, text: '' }), 4000);
      }
    });

    xhr.addEventListener('error', () => {
      setUploadState({ active: true, progress: 0, text: '✗ Ритуал прерван (ошибка сети)' });
      setTimeout(() => setUploadState({ active: false, progress: 0, text: '' }), 4000);
    });

    // Важно: в нашем новом бэкенде роут загрузки находится в games.js
    xhr.open('POST', '/api/games/upload');
    xhr.send(formData);
  };

  return (
    <div className="controls-zone">
      {/* --- Поиск и фильтры (оставляем без изменений) --- */}
      <div className="search-box">
        <svg className="search-icon" viewBox="0 0 24 24">
          <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
        </svg>
        <input type="text" placeholder="Поиск по названию или тегам..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
      </div>

      <select className="sort-box" value={selectedTag} onChange={(e) => setSelectedTag(e.target.value)}>
        <option value="all">Все жанры</option>
        {availableTags.map(tag => <option key={tag.name} value={tag.name}>{tag.name} ({tag.count})</option>)}
      </select>

      <select className="sort-box" value={currentSort} onChange={(e) => setCurrentSort(e.target.value)}>
        <option value="newest">Новые поступления</option>
        <option value="recent">Недавно запущенные</option>
        <option value="rating_desc">По оценке (Сначала лучшие)</option>
        <option value="name">По алфавиту</option>
      </select>

      {/* --- НОВАЯ КНОПКА ЗАГРУЗКИ (DRAG & DROP) --- */}
      <div 
        className={`upload-btn ${isDragging ? 'drag-over' : ''}`} 
        onClick={() => fileInputRef.current.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={uploadState.active ? { pointerEvents: 'none', opacity: 0.5 } : {}}
      >
        <svg viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>
        Добавить игру
      </div>

      {/* Скрытый инпут для файлов */}
      <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".zip,.7z,.rar" onChange={handleFileSelect} />

      {/* Прогресс-бар появляется только если активна загрузка */}
      {uploadState.active && (
        <div className="progress-wrap" style={{ display: 'block' }}>
          <div className="progress-bar" style={{ width: `${uploadState.progress}%` }}></div>
          <div className="progress-text">
            {/* Если есть сообщение от сокета (бэкенда), показываем его. Иначе — статус файла */}
            {socketMessage || uploadState.text}
          </div>
        </div>
      )}
    </div>
  );
};

export default Toolbar;