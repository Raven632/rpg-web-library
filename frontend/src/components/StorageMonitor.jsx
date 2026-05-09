import React, { useState, useEffect } from 'react';

export default function StorageMonitor() {
    const [storage, setStorage] = useState(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        // Стучимся к нашему бэкенду
        fetch('/api/storage')
            .then(res => {
                if (!res.ok) throw new Error('Network response was not ok');
                return res.json();
            })
            .then(data => setStorage(data))
            .catch(err => {
                console.error('Ошибка мониторинга:', err);
                setError(true);
            });
    }, []);

    // Красивый стиль для виджета (Glassmorphism)
    const widgetStyle = {
        background: 'rgba(20, 25, 30, 0.8)',
        border: '1px solid rgba(0, 255, 204, 0.3)',
        color: '#00ffcc',
        padding: '12px 20px',
        borderRadius: '12px',
        fontFamily: 'monospace',
        fontSize: '14px',
        display: 'inline-block',
        boxShadow: '0 8px 16px rgba(0,0,0,0.4)',
        backdropFilter: 'blur(8px)',
        margin: '15px'
    };

    if (error) return <div style={widgetStyle}>⚠️ Ошибка связи с диском</div>;
    if (!storage) return <div style={widgetStyle}>💾 Сканирование диска...</div>;

    // Конвертируем байты в гигабайты
    const formatGB = (bytes) => (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';

    return (
        <div style={widgetStyle}>
            <div style={{ marginBottom: '5px' }}>
                <span style={{ opacity: 0.7 }}>📦 Игры:</span> 
                <strong style={{ marginLeft: '10px', float: 'right' }}>{formatGB(storage.used)}</strong>
            </div>
            <div>
                <span style={{ opacity: 0.7 }}>💿 Свободно:</span> 
                <strong style={{ marginLeft: '10px', float: 'right' }}>{formatGB(storage.free)}</strong>
            </div>
        </div>
    );
}