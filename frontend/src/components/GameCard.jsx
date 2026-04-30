import React from 'react';

const ROMAN_NUMERALS = ['Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ','Ⅵ','Ⅶ','Ⅷ','Ⅸ','Ⅹ','Ⅺ','Ⅻ'];

const GameCard = ({ game, index, onClick, onDelete, onRate, t }) => {
  const coverUrl = game.cover ? (import.meta.env.DEV ? `/media/${game.cover}` : `/${game.cover}`) : null;
  const roman = ROMAN_NUMERALS[index % ROMAN_NUMERALS.length] || String(index + 1);
  const volumeStr = String(game.number || index + 1).padStart(2, '0');

  return (
    <div className="game-card" onClick={onClick}>
      <div className="card-corner-tl"></div>
      
      <div 
        className="card-delete" 
        title={t.burn}
        onClick={(e) => { e.stopPropagation(); onDelete(game); }}
      >
        <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
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
          <img src={coverUrl} alt={game.title} loading="lazy" />
        ) : (
          <div className="cover-placeholder">
            <span className="rune">{roman}</span>
            <span className="folder-name">{game.id}</span>
          </div>
        )}
        <div className="card-cover-overlay"></div>
      </div>

      <div className="card-info">
        <div className="card-number">
          <span>{t.vol} {volumeStr}</span>
          {!game.scraped && <span style={{color: 'var(--gold-light)'}}>⏳</span>}
        </div>
        <h3 className="card-title">{game.title}</h3>
        
        <div className="card-launch">
          {t.details} <span className="launch-arrow">→</span>
        </div>
      </div>

      <div className="card-corner-br"></div>
    </div>
  );
};

export default GameCard;