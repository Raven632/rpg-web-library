import React, { useState } from 'react';

const LoginModal = ({ mode, onSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Определяем, мы создаем первого Мастера или просто логинимся
  const isSetup = mode === 'setup';
  const headerText = isSetup ? 'Первая Настройка' : 'Хранилище';
  const btnText = isSetup ? 'Создать Мастера' : 'Открыть Врата';
  const endpoint = isSetup ? '/api/setup/init' : '/api/login';

  const handleSubmit = async () => {
    if (!username || !password) {
      setError('Заполните все поля');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (data.success) {
        if (isSetup) {
          alert('Мастер успешно создан! Теперь введите эти данные для входа.');
          window.location.reload(); // Перезагружаем страницу для нормального входа
        } else {
          onSuccess(); // Командуем App.jsx, что мы вошли, грузи игры!
        }
      } else {
        setError(data.error || 'Магия отвергла вас');
      }
    } catch (err) {
      setError('Связь с сервером потеряна');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    // z-index: 9999 чтобы перекрыть вообще всё
    <div className="modal-overlay active" style={{ zIndex: 9999, background: 'rgba(0,0,0,0.95)' }}>
      <div className="modal-content" style={{ maxWidth: '350px', padding: '40px', textAlign: 'center', margin: 'auto' }}>
        <h2 style={{ fontFamily: "'Cinzel', serif", color: 'var(--gold)', marginBottom: '25px' }}>
          {headerText}
        </h2>
        
        <input
          type="text"
          placeholder="Имя мастера..."
          value={username}
          onChange={e => setUsername(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          style={{ width: '100%', padding: '15px', marginBottom: '15px', background: 'rgba(20,18,26,0.9)', color: 'var(--text)', border: '1px solid var(--gold-dim)', borderRadius: '4px', fontFamily: "'Cinzel', serif", fontSize: '1rem', outline: 'none', textAlign: 'center' }}
        />
        
        <input
          type="password"
          placeholder="Тайное слово..."
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          style={{ width: '100%', padding: '15px', marginBottom: '25px', background: 'rgba(20,18,26,0.9)', color: 'var(--text)', border: '1px solid var(--gold-dim)', borderRadius: '4px', fontFamily: "'Cinzel', serif", fontSize: '1rem', outline: 'none', textAlign: 'center' }}
        />
        
        <button
          onClick={handleSubmit}
          disabled={isLoading}
          style={{ width: '100%', padding: '15px', background: 'var(--gold-dim)', color: '#000', border: 'none', borderRadius: '4px', cursor: 'pointer', fontFamily: "'Cinzel', serif", fontWeight: 'bold', fontSize: '1.1rem', transition: 'background 0.3s', opacity: isLoading ? 0.7 : 1 }}
        >
          {isLoading ? 'Проверка...' : btnText}
        </button>
        
        {error && (
          <div style={{ color: '#f44', marginTop: '15px', fontSize: '0.9rem' }}>{error}</div>
        )}
      </div>
    </div>
  );
};

export default LoginModal;