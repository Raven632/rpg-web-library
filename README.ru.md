# 🎮 RPG Library v4.0

🇬🇧 [English](README.md) | 🇩🇪 [Deutsch](README.de.md)

[![GitHub Release](https://img.shields.io/github/v/release/Raven632/rpg-web-library?style=for-the-badge&color=blue)](https://github.com/Raven632/rpg-web-library/releases)
[![GitHub Stars](https://img.shields.io/github/stars/Raven632/rpg-web-library?style=for-the-badge&color=gold)](https://github.com/Raven632/rpg-web-library/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
![Tests: Passing](https://img.shields.io/badge/Tests-154_Lines_Passing-brightgreen?style=for-the-badge&logo=jest&logoColor=white)

![Node.js](https://img.shields.io/badge/Node.js-20.x-43853D?style=for-the-badge&logo=node.js&logoColor=white)
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
- **📦 Бронебойная работа с архивами:** Загружайте архивы весом по 10 ГБ. Потоковая распаковка через `7zz` предотвращает переполнение буфера Node.js и падение сервера.

## 🛠 Технологический стек

- **Backend:** Node.js, Express, Socket.io (для realtime-уведомлений).
- **Database:** SQLite (`sqlite3` с предкомпиляцией) и Zero-Config безопасность.
- **Frontend:** Чистый Vanilla JS / CSS. Без тяжелых фреймворков.
- **Infrastructure:** Docker Engine, `7zip`, системный `curl`.

## 🚀 Установка и запуск

Проект спроектирован для работы на **нативном Docker Engine** (Linux). Использование Docker Desktop не рекомендуется из-за сильного падения I/O производительности.

1. Клонируйте репозиторий:
   ```bash
   git clone [https://github.com/Raven632/rpg-web-library](https://github.com/Raven632/rpg-web-library)
   cd rpg-web-library
   ```

2. (Опционально, но рекомендуется) Настройте стабильный парсинг обложек:
   Переименуйте файл .env.example в .env. Получите бесплатный ключ на ScraperAPI (дают 1000 запросов/мес) и вставьте его в SCRAPER_API_KEY. Без ключа сервер будет использовать нестабильные публичные прокси.

3. Запустите контейнер: 
   ```bash
   docker compose up -d --build
   ```

4. Откройте http://localhost:3000 в браузере. При первом запуске система предложит создать аккаунт Мастера.

## 📂 Структура директорий
При первом запуске Docker пробросит папку ./games на ваш хост.

- /games — сюда распаковываются сами игры.

- /games/library.db — файл БД (здесь же хранится пароль администратора).

- /games/_saves — JSON-файлы облачных сохранений.

- /games/_tmp_uploads — папка для буферизации тяжелых загрузок.

## 📝 Ручное редактирование

Если парсер не нашел игру, откройте её модальное окно на сайте, нажмите ⚙️ (Настройки) и вручную введите RJ-код или правильное название. Сервер мгновенно обновит метаданные.