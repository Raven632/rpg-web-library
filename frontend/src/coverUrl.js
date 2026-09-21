// Файлы игр в dev отдаёт бэкенд на своём порту, и Vite проксирует их через /media,
// а в проде они лежат на том же адресе, что и сайт. Разница спрятана здесь.
export function getMediaUrl(relPath) {
    if (!relPath) return null;
    return import.meta.env.DEV ? `/media/${relPath}` : `/${relPath}`;
}

// Обложка всегда лежит по одному адресу, меняется только содержимое файла.
// Браузер не перезапрашивает картинку с тем же адресом, поэтому добавляем метку версии:
// изменился адрес — картинка перезагрузится.
export function getCoverUrl(game) {
    if (!game.cover) return null;
    return `${getMediaUrl(game.cover)}?v=${game.updatedAt || game.addedAt || 0}`;
}
