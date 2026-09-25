import React, { useEffect, useState } from 'react';
import { formatRetry } from '../formatRetry';

const GB = 1073741824;
const fmtSize = (bytes) => (bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.round(bytes / 1048576)} MB`);

// Раздел показываем только если в нём что-то есть: пустые заголовки создают
// ощущение, что проверка не отработала
const Section = ({ title, hint, count, children }) => {
  if (!count) return null;
  return (
    <>
      <h3 className="stats-section">{title} <span className="audit-count">{count}</span></h3>
      {hint && <div className="audit-hint">{hint}</div>}
      {children}
    </>
  );
};

// Ревизия библиотеки: то, чего по списку игр не видно. Считает сервер, здесь —
// только показ и переход к игре, чтобы найденное можно было сразу починить.
const AuditModal = ({ t, lang, onClose, onOpenGame }) => {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  // Итог кнопки «Искать ещё раз» по каждой группе: null → ещё не жали, число → поставлено
  const [retried, setRetried] = useState({});

  useEffect(() => {
    // Окно могут закрыть раньше, чем придёт ответ: тогда setState уже некуда писать
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/games/audit');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (alive) setData(json);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Escape закрывает окно — как и в остальных окнах библиотеки
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const openGame = (id) => { onClose(); onOpenGame(id); };

  const list = (items, limit = 12) => (
    <>
      <div className="audit-list">
        {items.slice(0, limit).map(item => (
          <button key={item.id} type="button" className="audit-item" onClick={() => openGame(item.id)}>
            <span className="audit-item-name">{item.title || item.id}</span>
            {item.size > 0 && <span className="audit-item-size">{fmtSize(item.size)}</span>}
          </button>
        ))}
      </div>
      {items.length > limit && <div className="audit-more">{t.audit_more(items.length - limit)}</div>}
    </>
  );

  // Что будет с игрой дальше: когда следующая попытка, или что автопоиск сдался
  const metaNote = (item) => {
    const parts = [];
    if (item.status === 'error' && item.error) parts.push(t.meta_failed(item.error));
    parts.push(item.retryAt ? t.meta_next(formatRetry(item.retryAt, lang)) : t.meta_stopped);
    return parts.join(' · ');
  };

  const metaList = (items, limit = 12) => (
    <>
      <div className="audit-list">
        {items.slice(0, limit).map(item => (
          <button key={item.id} type="button" className="audit-item" onClick={() => openGame(item.id)}>
            <span className="audit-item-name">{item.title || item.id}</span>
            <span className="audit-item-size">{metaNote(item)}</span>
          </button>
        ))}
      </div>
      {items.length > limit && <div className="audit-more">{t.audit_more(items.length - limit)}</div>}
    </>
  );

  // Поиск заново для всей группы: срок у игр «подходит» сразу, воркер берёт их по одной
  const retry = async (scope) => {
    setRetried(prev => ({ ...prev, [scope]: 'busy' }));
    try {
      const res = await fetch('/api/games/rescan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      const json = await res.json();
      setRetried(prev => ({ ...prev, [scope]: res.ok ? (json.queued || 0) : null }));
    } catch {
      setRetried(prev => ({ ...prev, [scope]: null }));
    }
  };

  const retryButton = (scope, count) => {
    const state = retried[scope];
    if (typeof state === 'number') return <div className="audit-retry-done">{t.rescan_queued(state)}</div>;
    return (
      <button type="button" className="audit-retry" disabled={state === 'busy'} onClick={() => retry(scope)}>
        {t.audit_retry_all(count)}
      </button>
    );
  };

  const nothing = data
    && !data.broken.length && !data.duplicates.length && !data.missing.length
    && !data.partial.length && !data.never.length && !data.orphans.length;

  return (
    <div className="modal-overlay active" onClick={onClose}>
      <div className="stats-content" onClick={e => e.stopPropagation()}>
        <div className="modal-actions-top"><div className="modal-close" onClick={onClose}>×</div></div>
        <h2 className="stats-title">{t.audit}</h2>

        {!data && !failed && <div className="audit-hint">{t.audit_loading}</div>}
        {failed && <div className="audit-hint">{t.audit_error}</div>}

        {data && (
          <>
            <div className="audit-hint">{t.audit_checked(data.total)}</div>
            {data.pending > 0 && <div className="audit-hint">{t.audit_pending(data.pending)}</div>}
            {nothing && <div className="audit-clean">{t.audit_clean}</div>}

            <Section title={t.audit_broken} hint={t.audit_broken_hint} count={data.broken.length}>
              {list(data.broken)}
            </Section>

            <Section title={t.audit_dupes} hint={t.audit_dupes_hint} count={data.duplicates.length}>
              {data.duplicates.map(group => (
                <div key={group.map(g => g.id).join('|')} className="audit-group">
                  {group.map(item => (
                    <button key={item.id} type="button" className="audit-item" onClick={() => openGame(item.id)}>
                      <span className="audit-item-name">{item.title || item.id}</span>
                      <span className="audit-item-size">{item.size > 0 ? fmtSize(item.size) : item.id}</span>
                    </button>
                  ))}
                </div>
              ))}
            </Section>

            <Section title={t.audit_missing} hint={t.audit_missing_hint} count={data.missing.length}>
              {metaList(data.missing)}
              {retryButton('missing', data.missing.length)}
            </Section>

            <Section title={t.audit_partial} hint={t.audit_partial_hint} count={data.partial.length}>
              {metaList(data.partial)}
              {retryButton('partial', data.partial.length)}
            </Section>

            <Section title={t.audit_orphans} hint={t.audit_orphans_hint} count={data.orphans.length}>
              <div className="audit-list">
                {data.orphans.map(o => (
                  <div key={`${o.kind}:${o.id}`} className="audit-item audit-item-static">
                    <span className="audit-item-name">{o.id}</span>
                    <span className="audit-item-size">{o.kind === 'saves' ? t.audit_orphan_saves : t.audit_orphan_media}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title={t.audit_never} count={data.never.length}>
              {list(data.never)}
            </Section>

            <Section title={t.audit_heavy} count={data.heavy.length}>
              {list(data.heavy, 10)}
            </Section>
          </>
        )}
      </div>
    </div>
  );
};

export default AuditModal;
