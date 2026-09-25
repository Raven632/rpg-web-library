// Поисковые API ищут по названию буквально: «v1.02», «| TL: DazedAnon» или подчёркивания
// из имени папки убивают совпадение. Приводим название к виду, пригодному для поиска.
function cleanTitle(raw) {
    let t = String(raw || '');
    t = t.split('|')[0];                                   // «… | TL: DazedAnon», «… | Перевод: …»
    t = t.replace(/~[^~]+~/g, ' ');                        // японские подзаголовки в тильдах
    t = t.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ');
    t = t.replace(/\bRJ\d{6,8}\b/gi, ' ');
    t = t.replace(/_+/g, ' ');                             // названия, собранные из имени папки

    // Метки версий и релизов срезаем ТОЛЬКО с хвоста: «Trial» в середине — часть названия.
    // «Version 1.3», «Production Version 1.4», «Complete» — тоже хвосты: срезаются за
    // два прохода цикла ниже (сначала число, потом слово).
    //  не должно превратиться в 
    const TAIL = /(?:[\s\-–—,~]+)?\b(?:o?v(?:er)?\.?\s?\d[\w.]*|\d+(?:\.\d+)+|(?:product(?:ion)?\s+)?version|complete|final|full|dlcs?|uncen(?:sored)?|censored|compressed|repack|steam|dev|demo|patched?|tl|cracked|eng(?:lish)?)\b[\s\-–—,~]*$/i;
    let prev;
    do { prev = t; t = t.replace(TAIL, '').trim(); } while (t !== prev);

    return t.replace(/\s{2,}/g, ' ').trim();
}

// ——— Название для показа в библиотеке ———
// Для поиска выше срезаем всё подряд, а здесь только мусор: версии, «| TL: …»,
// «(Перевод: …)», «Steam 04/17/2342». Подзаголовок в тильдах — часть названия, он остаётся.

// Версия может стоять и в середине: «Героический гарем демонесс 1.13 ov1.0.1 | Перевод…»,
// «Fallen Priestess 1.3.0 Steam 04/17/2342». После неё идёт только служебное
// «EN1.12» — версия английского издания; «2.0.0v» — буква v после номера, а не часть его
const VERSION_AT = /(?:^|[\s\-–—,~(（])(?:o?v(?:er)?\.?[\s-]?(\d+(?:\.\d+)*[a-uw-z]?)|(?:en|eng|jp|jpn|ru|rus|cn)?(\d+(?:\.\d+)+[a-uw-z]?))(?=$|[\s\-–—,~)）]|v\b)/i;
const DISPLAY_TAIL = /[\s\-–—,~:]*\b(?:(?:product(?:ion)?\s+)?version|steam|uncen(?:sored)?|censored|compressed|repack|cracked|windows|win|pc|eng(?:lish)?|rus|full|complete|final|dev|tl|patched?|dlcs?)\s*$/i;
const EDGES = /^[\s\-–—,:|・]+|[\s\-–—,:|・]+$/g;

function tidyTitle(raw) {
    const source = String(raw || '');
    // Скобки в названиях игр здесь всегда служебные: «（ver1.19）», «(TL by O&M's)»,
    // а у Listaria в квадратных — подсказки управления вместо названия
    let t = source.replace(/\[[^\]]*\]|［[^］]*］|\([^)]*\)|（[^）]*）|【[^】]*】/g, ' ');
    t = t.split('|')[0];
    t = t.replace(/\bRJ\d{6,8}\b/gi, ' ').replace(/_/g, ' ');
    const cut = t.search(VERSION_AT);
    if (cut >= 0) t = t.slice(0, cut);
    let prev;
    do { prev = t; t = t.replace(DISPLAY_TAIL, ''); } while (t !== prev);
    // «Freya s Potion Shop»: апостроф пропал ещё в имени папки (Freya_s)
    t = t.replace(/(\p{L}) s\b/gu, "$1's");
    t = t.replace(/\s{2,}/g, ' ').replace(EDGES, '').trim();
    // Тильда в конце — либо закрывает подзаголовок «~Even Fallen…~» (тогда их чётное
    // число, оставляем), либо осталась висеть после отрезанной версии
    if (/[~～]$/.test(t) && (t.match(/[~～]/g) || []).length % 2) t = t.replace(/[\s~～]+$/, '');
    return t || source.trim();
}

// Иероглифы без единого латинского слова — такое название большинству не прочесть.
// «・» и «ー» встречаются и в английских названиях японских игр, их не считаем
const isCjkOnly = (s) => /[぀-ゟ゠-ヺ一-鿿가-힯]/.test(s) && !/[A-Za-zА-Яа-яЁё]{3}/.test(s);

// Имя папки обычно английское: «Stigma_of_Corruption_Nightbound_Courier_v1.26-Uncen»
function titleFromFolderName(folder) {
    let f = String(folder || '');
    if (/^\[?RJ\d{6,8}\]?$/i.test(f)) return '';
    f = f.replace(/\[?RJ\d{6,8}\]?/gi, ' ').replace(/_/g, ' ');
    // Папка-слаг «nightmare-knight-2.01-rus» — дефисы вместо пробелов
    if (!/\s/.test(f.trim())) f = f.replace(/-/g, ' ');
    const t = tidyTitle(f);
    return t === t.toLowerCase() ? t.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()) : t;
}

// Адрес темы F95 — тоже название: …/threads/fallenmage-v1-0-0-other-side-of-the-sky.288905/
function titleFromF95Link(link) {
    const m = String(link || '').match(/f95zone\.to\/threads\/([a-z0-9-]+?)(?:\.\d+)?\/?(?=[,\s]|$)/i);
    if (!m) return '';
    const words = [];
    for (const w of m[1].split('-')) {
        if (/^(?:v?\d+|final|completed?|demo|ep\d+)$/i.test(w)) break;
        words.push(w.charAt(0).toUpperCase() + w.slice(1));
    }
    return words.join(' ');
}

// title — что показывать; original — японское название, если его заменили английским
function presentTitle(raw, { folder = '', link = '' } = {}) {
    const tidy = tidyTitle(raw);
    if (isCjkOnly(tidy)) {
        const english = titleFromFolderName(folder) || titleFromF95Link(link);
        if (english && !isCjkOnly(english)) return { title: english, original: tidy };
    }
    // Игра называет себя сокращённо («Dancer» вместо «My Girlfriend Advanced to the
    // Dancer Class…»), а полное название осталось в имени папки
    if (!/\s/.test(tidy) && tidy.length <= 8) {
        const fromFolder = titleFromFolderName(folder);
        if (fromFolder.split(' ').length >= 3 && new RegExp(`\\b${tidy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(fromFolder)) {
            return { title: fromFolder, original: '' };
        }
    }
    return { title: tidy, original: '' };
}

// Версия для плашки: из названия, а если там нет — из имени папки. «v1» из названия
// уступает «1.03» из папки: номер с точкой почти всегда точнее
function extractVersion(title, folder) {
    // После «|» у переводов идёт своя версия («Версия перевода: 1.0») — это не версия игры
    const found = [String(title || '').split('|')[0], folder].map((s) => {
        const m = String(s || '').replace(/_/g, ' ').match(VERSION_AT);
        return m ? (m[1] || m[2]) : '';
    }).filter(Boolean);
    return found.find((v) => v.includes('.')) || found[0] || '';
}

module.exports = { cleanTitle, tidyTitle, presentTitle, extractVersion };
