import React from 'react';
import { formatPlaytime } from '../formatPlaytime';

const ROMAN_NUMERALS = ['Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ','Ⅵ','Ⅶ','Ⅷ','Ⅸ','Ⅹ','Ⅺ','Ⅻ'];

import { getCoverUrl } from '../coverUrl';
import { languageBadge, languageLine } from '../formatLanguage';

const GameCard = ({ game, index, onClick, onRate, onToggleFavorite, t, lang }) => {
  const coverUrl = getCoverUrl(game);
  const roman = ROMAN_NUMERALS[index % ROMAN_NUMERALS.length] || String(index + 1);
  const name = game.displayTitle || game.title;
  // Пустая строка означает «меньше минуты» — тогда не рисуем даже значок
  const played = formatPlaytime(game.playtime, t);
  const language = languageBadge(game, lang);

  return (
    <div
      className="game-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <div className="card-corner-tl"></div>
      
      {/* Корзины здесь больше нет: она стояла вплотную к «Избранному», а при наведении
          поворачивалась боком и была похожа на видеокамеру. Удаление — в окне игры */}

      <div
        className={`card-fav ${game.favorite ? 'active' : ''}`}
        title={game.favorite ? t.fav_del : t.fav_add}
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(game.id, !game.favorite); }}
      >
        ★
      </div>

      <div className="card-cover">
        <div className={`card-rating ${game.rating > 0 ? 'has-rating' : ''}`}>
          {[1, 2, 3, 4, 5].map(star => (
            <span 
              key={star} 
              className={`star ${star <= (game.rating || 0) ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onRate(game.id, star); }}
            >
              ★
            </span>
          ))}
        </div>

        {coverUrl ? (
          <img src={coverUrl} alt={name} loading="lazy" />
        ) : (
          <div className="cover-placeholder">
            <span className="rune">{roman}</span>
            <span className="folder-name">{game.id}</span>
          </div>
        )}
        <div className="card-cover-overlay"></div>
        {/* Язык по тексту самой игры; при наведении — все языки, как в окне игры */}
        {language && <span className="card-lang" title={languageLine(game, t, lang)}>{language}</span>}
      </div>

      {/* Раньше здесь стояли «ТОМ 01» — номер по дате добавления, который менялся
          с каждой новой игрой, — и «Подробнее →», хотя открывает игру вся карточка.
          Теперь под названием то, что полезно видеть в сетке: версия, статус, время */}
      <div className="card-info">
        <h3 className="card-title" title={name}>{name}</h3>
        <div className="card-meta">
          {game.version && <span className="card-version">v{game.version}</span>}
          {game.status && <span className={`status-badge ${game.status}`}>{t[`status_${game.status}`]}</span>}
          {played && <span className="card-playtime">⏱ {played}</span>}
          {!game.scraped && <span className="card-pending" title={t.meta_line_new}>⏳</span>}
        </div>
      </div>

      <div className="card-corner-br"></div>
    </div>
  );
};

export default GameCard;
