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

      {/* Стили — в классе .lang-switcher: инлайновые перебивали медиазапрос,
          и на телефоне селект наезжал на заголовок */}
      <select
        value={currentLang}
        onChange={(e) => onLangChange(e.target.value)}
        className="sort-box lang-switcher"
      >
        <option value="en">English</option>
        <option value="de">Deutsch</option>
        <option value="ru">Русский</option>
      </select>
    </header>
  );
};

export default Header;