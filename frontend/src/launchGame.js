// Запуск игры: отмечаем время и уходим на страницу игры.
// Общий код для модалки и блока «Продолжить»: иначе отметка времени
// разойдётся между ними при первой же правке.
export async function launchGame(game, onUpdate) {
  const lastPlayed = Date.now();
  try {
    await fetch(`/api/games/${encodeURIComponent(game.id)}/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastPlayed })
    });
    onUpdate?.({ ...game, lastPlayed });
  } catch (err) {
    // Не смогли отметить — это не повод не запускать игру
  }

  // В dev страницу отдаёт Vite (:5173), а игры — бэкенд на своём порту. localStorage
  // у другого порта свой, выбранного языка там не видно — передаём его в адресе,
  // чтобы меню и кнопки в игре были на том же языке. В проде адрес один, язык виден и так
  window.location.href = import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:${import.meta.env.VITE_BACKEND_PORT}${game.url}?lang=${localStorage.getItem('rpg_lang') || 'ru'}`
    : game.url;
}
