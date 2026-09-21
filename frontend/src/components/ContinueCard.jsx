import React from 'react';
import { getCoverUrl } from '../coverUrl';
import { formatPlaytime } from '../formatPlaytime';
import { launchGame } from '../launchGame';

const ContinueCard = ({ game, t, onUpdateGame }) => {
  if (!game) return null;
  const cover = getCoverUrl(game);
  const played = formatPlaytime(game.playtime, t);

  return (
    <section className="continue-block">
      <div className="continue-cover">
        {cover && <img src={cover} alt={game.title} />}
      </div>
      <div className="continue-info">
        <span className="continue-label">{t.continue_label}</span>
        <h2 className="continue-title">{game.title}</h2>
        <div className="continue-meta">
          {played && <span>⏱ {played}</span>}
          {game.progress?.level != null && <span>{t.progress_level} {game.progress.level}</span>}
          {game.status && <span className={`status-badge ${game.status}`}>{t[`status_${game.status}`]}</span>}
        </div>
        <button type="button" className="continue-btn" onClick={() => launchGame(game, onUpdateGame)}>
          {t.play} <span className="launch-arrow">→</span>
        </button>
      </div>
    </section>
  );
};

export default ContinueCard;