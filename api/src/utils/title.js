// Поисковые API ищут по названию буквально: «v1.02», «| TL: DazedAnon» или подчёркивания
// из имени папки убивают совпадение. Приводим название к виду, пригодному для поиска.
function cleanTitle(raw) {
    let t = String(raw || '');
    t = t.split('|')[0];                                   // «… | TL: DazedAnon», «… | Перевод: …»
    t = t.replace(/~[^~]+~/g, ' ');                        // японские подзаголовки в тильдах
    t = t.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ');
    t = t.replace(/\bRJ\d{6,8}\b/gi, ' ');
    t = t.replace(/_+/g, ' ');                             // названия, собранные из имени папки

    // Метки версий и релизов срезаем ТОЛЬКО с хвоста: «Trial» в середине — часть названия,
    //  не должно превратиться в 
    const TAIL = /(?:[\s\-–—,~]+)?\b(?:o?v(?:er)?\.?\s?\d[\w.]*|\d+(?:\.\d+)+|final|full|dlcs?|uncen(?:sored)?|censored|compressed|repack|steam|dev|demo|patched?|tl|cracked|eng(?:lish)?)\b[\s\-–—,~]*$/i;
    let prev;
    do { prev = t; t = t.replace(TAIL, '').trim(); } while (t !== prev);

    return t.replace(/\s{2,}/g, ' ').trim();
}

module.exports = { cleanTitle };
