// Язык игры для карточки и окна. Данные приходят с сервера как { main, langs, original }:
// langs — все языки с настоящим текстом (главный первым), original — на каком её делали.
// Названия языков берём у браузера: Intl.DisplayNames знает их на любом языке интерфейса.
const names = new Map();

export function languageName(code, lang) {
  const key = `${lang}:${code}`;
  if (!names.has(key)) {
    let name = code.toUpperCase();
    try {
      name = new Intl.DisplayNames([lang], { type: 'language' }).of(code) || name;
    } catch {
      // Браузер без Intl.DisplayNames — остаётся код языка, «RU»
    }
    names.set(key, name);
  }
  return names.get(key);
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// full — для окна игры: «Русский · перевод с японского», «Китайский, английский, японский».
// short — плашка на карточке: «RU ← JA», «ZH · EN · JA».
// Ручная правка из «Изменить» главнее найденного: её показываем как есть
export function describeLanguage(game, t, lang) {
  if (game.language) return { full: game.language, short: game.language, translated: false };

  const info = game.textLang;
  if (!info?.langs?.length) return null;

  // Перевод — когда языка оригинала среди языков игры нет вовсе. Если есть
  // (японский и английский на выбор), это многоязычное издание, а не перевод
  const translated = !!info.original && !info.langs.includes(info.original);
  const list = info.langs.map((code) => languageName(code, lang));
  let full = capitalize(list.join(', '));
  if (translated) full += ` · ${t.lang_translated_from(languageName(info.original, lang))}`;

  const codes = info.langs.map((code) => code.toUpperCase());
  let short = codes.slice(0, 3).join(' · ') + (codes.length > 3 ? ` +${codes.length - 3}` : '');
  if (translated) short += ` ← ${info.original.toUpperCase()}`;

  return { full, short, translated };
}
