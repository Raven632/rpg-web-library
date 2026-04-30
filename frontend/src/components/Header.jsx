import React from 'react';

const Header = ({ currentLang, onLangChange, t }) => {
  return (
    <header style={{ position: 'relative' }}>
      <div className="header-ornament">
        <div className="ornament-line"></div>
        <div className="ornament-diamond"></div>
        <div className="ornament-line"></div>
      </div>
      <h1>RPG Library</h1>
      <p className="subtitle">{t.subtitle}</p>

      {/* Возвращаем жесткие стили позиционирования, чтобы кнопка не растягивалась */}
      <select 
        value={currentLang} 
        onChange={(e) => onLangChange(e.target.value)}
        className="sort-box"
        style={{
          position: 'absolute',
          right: '20px',
          top: '47px',
          minWidth: 'auto',
          width: 'auto', // Жестко запрещаем растягиваться
          padding: '10px 15px',
          fontSize: '0.75rem'
        }}
      >
        <option value="en">English</option>
        <option value="de">Deutsch</option>
        <option value="ru">Русский</option>
      </select>
    </header>
  );
};

export default Header;