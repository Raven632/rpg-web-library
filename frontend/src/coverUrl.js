// Обложка всегда лежит по одному адресу (<id>/cover.jpg), меняется только содержимое файла.
// Браузер не перезапрашивает картинку с тем же адресом, поэтому добавляем метку версии:
// изменился адрес — картинка перезагрузится.
export function getCoverUrl(game) {
    if (!game.cover) return null;
    const base = import.meta.env.DEV ? `/media/${game.cover}` : `/${game.cover}`;
    return `${base}?v=${game.updatedAt || game.addedAt || 0}`;
}