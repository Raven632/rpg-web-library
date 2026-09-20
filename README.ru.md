# 🎮 RPG Library v5.0

🇬🇧 [English](README.md) | 🇩🇪 [Deutsch](README.de.md)

[![GitHub Release](https://img.shields.io/github/v/release/Raven632/rpg-web-library?style=for-the-badge&color=blue)](https://github.com/Raven632/rpg-web-library/releases)
[![GitHub Stars](https://img.shields.io/github/stars/Raven632/rpg-web-library?style=for-the-badge&color=gold)](https://github.com/Raven632/rpg-web-library/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
![Tests: Passing](https://img.shields.io/badge/Tests-12_unit_%2B_75_games-brightgreen?style=for-the-badge&logo=jest&logoColor=white)

![Node.js](https://img.shields.io/badge/Node.js-22.x-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

Локальный веб-сервис для каталогизации, хранения и запуска браузерных RPG Maker игр (MV/MZ) напрямую с вашего домашнего сервера. Проект спроектирован с упором на производительность, отказоустойчивость I/O операций и умный автоматический сбор метаданных.

![Скриншот интерфейса](/rest/img/Example.png)

## ✨ Ключевые возможности

- **🌐 Веб-эмулятор ПК-движка:** Встроенный инжектор `rpg-fixes.js` на лету подменяет вызовы NW.js, позволяя играть в ПК-версии RPG Maker игр прямо в браузере телефона.
- **☁️ Облачные сохранения:** Перехват `localStorage` игры с автоматической синхронизацией сейвов в базу данных сервера. Начните на ПК, продолжите на смартфоне.
- **🌍 Мультиязычный интерфейс:** Встроенная локализация (Русский, Английский, Немецкий) без тяжелых сторонних библиотек.
- **🧠 Универсальная очередь парсинга:** Каскадный поиск данных в фоне. Сначала сервер ищет игру на **DLsite** (по RJ-коду), если не находит — переходит к поиску на **VNDB** и **Steam** (по названию).
- **🛡️ Обход блокировок (BYOK):** Сервер автоматически собирает сотни бесплатных прокси для обхода блокировок DLsite. Для 100% стабильности поддерживается свой личный ключ (ScraperAPI).
- **📱 Мобильная адаптация:** Скейлинг холста без искажений (PIXI smoothing), виртуальный геймпад и бесконечная лента скролла (Infinite Scroll) для огромных библиотек.
- **📌 Статусы и избранное:** Отмечайте игры как «играю», «пройдено», «брошено» или «хочу сыграть», добавляйте любимые в избранное и фильтруйте библиотеку по этому.
- **🔄 Живая синхронизация:** Изменения расходятся по Socket.io — статус, поставленный с телефона, появляется на ПК за секунду, перезагружать страницу не нужно.
- **🙈 Скрытие обложек:** Одна кнопка размывает все обложки — на случай, когда на экран смотрит кто-то ещё. Выбор запоминается.
- **🔐 Защита по умолчанию:** Попытки входа ограничены, шина событий требует сессионную cookie, наружу не торчит ничего, кроме самого сайта.
- **📦 Бронебойная работа с архивами:** Загружайте архивы весом по 10 ГБ. Потоковая распаковка через `7zz` предотвращает переполнение буфера Node.js и падение сервера.

## 🛠 Технологический стек

- **Backend:** Node.js 22, Express, Socket.io (для realtime-уведомлений), Redis (кэш списка игр).
- **Database:** SQLite (`sqlite3` с предкомпиляцией) и Zero-Config безопасность.
- **Frontend:** React 19 + Vite.
- **Infrastructure:** Docker Engine, `7zip`, системный `curl`.
- **Тесты:** встроенный тест-раннер Node (модульные) и Playwright + headless Chromium (совместимость игр).

## 🚀 Установка и запуск

Проект спроектирован для работы на **нативном Docker Engine** (Linux). Использование Docker Desktop не рекомендуется из-за сильного падения I/O производительности.

1. Клонируйте репозиторий:
   ```bash
   git clone https://github.com/Raven632/rpg-web-library.git
   cd rpg-web-library
   ```

2. Создайте файл настроек:
   ```bash
   cp .env.example .env
   ```
   Все переменные описаны прямо в нём. Две стоит посмотреть сразу:
   - `SESSION_SECRET` — сгенерируйте свой: `openssl rand -hex 64`. Без него сервер создаст ключ при первом запуске и сохранит в базу.
   - `SCRAPER_API_KEY` — бесплатный ключ ScraperAPI (1000 запросов в месяц) делает сбор метаданных стабильным; без него используются нестабильные публичные прокси.

3. Запустите контейнер: 
   ```bash
   docker compose up -d --build
   ```

4. Откройте `http://localhost` (или IP сервера) в браузере — порт задаётся переменной `HTTP_PORT`. При первом запуске система предложит создать аккаунт Мастера.

## 📂 Структура директорий
При первом запуске Docker пробросит папку ./games на ваш хост.

- /games — сюда распаковываются сами игры.

- /games/library.db — файл БД (здесь же хранится пароль администратора).

- /games/_saves — JSON-файлы облачных сохранений.

- /games/_tmp_uploads — папка для буферизации тяжелых загрузок.

## 📜 История изменений

Что менялось от версии к версии — в [CHANGELOG.md](CHANGELOG.md).

## 📝 Ручное редактирование

Если парсер не нашел игру, откройте её модальное окно на сайте, нажмите ⚙️ (Настройки) и вручную введите RJ-код или правильное название. Сервер мгновенно обновит метаданные.
