import React from 'react';

const Header = ({ currentLang, onLangChange }) => {
  return (
    <header>
      <div className="header-ornament">
        <div className="ornament-line"></div>
        <div className="ornament-diamond"></div>
        <div className="ornament-line"></div>
      </div>
      <h1>RPG Library</h1>
      <p className="subtitle">Ваша личная коллекция приключений</p>

      {/* Комбинируем стили: sort-box дает золото и стрелку, lang-switcher ставит в угол */}
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