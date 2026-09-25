// Быстрый фильтр по статусу. Живёт в одной строке с «Продолжить», а не отдельным
// рядом под поиском: справа от чипов было пустое место шириной в полэкрана
const StatusChips = ({ value, onChange, t }) => (
  <div className="filter-chips">
    {[
      ['all', t.filter_all],
      ['fav', `★ ${t.filter_fav}`],
      ['playing', t.status_playing],
      ['done', t.status_done],
      ['dropped', t.status_dropped],
      ['wish', t.status_wish],
    ].map(([key, label]) => (
      <button
        key={key}
        type="button"
        className={`chip ${value === key ? 'active' : ''}`}
        aria-pressed={value === key}
        onClick={() => onChange(key)}
      >
        {label}
      </button>
    ))}
  </div>
);

export default StatusChips;
