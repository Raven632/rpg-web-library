import React from 'react';
import HeaderMenu from './HeaderMenu';

const Header = ({ currentLang, onLangChange, t, menuItems, children }) => {
  return (
    <header style={{ position: 'relative' }}>
      <div className="header-ornament">
        <div className="ornament-line"></div>
        <div className="ornament-diamond"></div>
        <div className="ornament-line"></div>
      </div>
      <h1>RPG Library</h1>
      <p className="subtitle">{t.subtitle}</p>

      {/* Занятое место — это справка, а не действие: показываем строкой в углу,
          без рамки и без отдельного блока по центру страницы */}
      {children && <div className="header-aside">{children}</div>}

      {/* Язык и меню редких действий живут вместе: на широком экране прижаты к
          колонке контента, на телефоне встают в поток под заголовком */}
      <div className="header-actions">
        <select
          value={currentLang}
          onChange={(e) => onLangChange(e.target.value)}
          className="sort-box lang-switcher"
        >
          <option value="en">English</option>
          <option value="de">Deutsch</option>
          <option value="ru">Русский</option>
        </select>

        {menuItems?.length > 0 && <HeaderMenu items={menuItems} label={t.menu_more} />}
      </div>
    </header>
  );
};

export default Header;
