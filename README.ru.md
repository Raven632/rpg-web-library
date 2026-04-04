# 🎮 RPG Library v2.0

🇬🇧 [English](README.md) | 🇩🇪 [Deutsch](README.de.md)

[![GitHub Release](https://img.shields.io/github/v/release/Raven632/rpg-web-library?style=for-the-badge&color=blue)](https://github.com/Raven632/rpg-web-library/releases)
[![GitHub Stars](https://img.shields.io/github/stars/Raven632/rpg-web-library?style=for-the-badge&color=gold)](https://github.com/Raven632/rpg-web-library/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

![Node.js](https://img.shields.io/badge/Node.js-20.x-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

Локальный веб-сервис для каталогизации, хранения и запуска браузерных RPG Maker игр (MV/MZ) напрямую с вашего домашнего сервера. Проект спроектирован с упором на производительность, отказоустойчивость I/O операций и автоматический сбор метаданных.

![Скриншот интерфейса](/rest/img/Example.png)

## ✨ Ключевые возможности

- **🌐 Веб-эмулятор ПК-движка:** Встроенный инжектор `rpg-fixes.js` на лету подменяет вызовы NW.js, позволяя играть в ПК-версии RPG Maker игр прямо в браузере мобильного телефона или планшета.
- **☁️ Облачные сохранения:** Перехват `localStorage` игры с автоматической синхронизацией сейвов в базу данных сервера. Вы можете начать играть на ПК, а продолжить с того же места на смартфоне.
- **📱 Мобильная адаптация:** Автоматический скейлинг холста без искажений (PIXI smoothing), виртуальный геймпад (D-Pad, Shift, Menu, Esc) и увеличение шрифтов для сенсорных экранов.
- **🕵️‍♂️ Смарт-скрейпер (DLsite):** Автоматическое распознавание RJ-кодов игр. Сервер обходит европейские блокировки (GDPR) и Geo-блокировки авторов через API-шлюзы и параллельные запросы к японским прокси (через `cURL`), вытягивая обложки, теги и переводя описание на лету.
- **📦 Бронебойная работа с архивами:** Загружайте архивы (ZIP, RAR, 7z) весом по 5-10 ГБ. Потоковая распаковка через `7zz` (с использованием `spawn` вместо `execFile`) предотвращает переполнение буфера Node.js и оперативной памяти сервера.

## 🛠 Технологический стек

- **Backend:** Node.js, Express, Socket.io (для realtime-уведомлений о распаковке).
- **Database:** SQLite (`sqlite3` с предкомпиляцией).
- **Frontend:** Vanilla JS / CSS (Grid, Flexbox). Без тяжелых фреймворков.
- **Infrastructure:** Docker Engine, `7zip`, системный `curl`.

## 🚀 Установка и запуск

Проект спроектирован для работы на **нативном Docker Engine** (Linux). Использование Docker Desktop не рекомендуется из-за сильного падения I/O производительности при работе с большими архивами через виртуальную машину.

1. Клонируйте репозиторий:

   ```bash
   git clone https://github.com/Raven632/rpg-web-library
   cd rpg-web-library
   ```

2. Запустите контейнер: 

   ```bash
   docker compose up -d --build
   ```

3. Откройте http://localhost:3000 or http://localhost (или IP вашего сервера) в браузере.

## 📂 Структура директорий
При первом запуске Docker пробросит папку ./games на ваш хост.

- /games — сюда распаковываются сами игры.

- /games/library.db — файл базы данных (создается автоматически).

- /games/_saves — JSON-файлы облачных сохранений игроков.

- /games/_tmp_uploads — папка для буферизации тяжелых загрузок (позволяет избежать раздувания docker.raw и перегрузки RAM).

## 📝 Ручное редактирование

Если автоматический парсер не нашел игру, вы можете открыть модальное окно игры на сайте, нажать на ⚙️ (Настройки) и вручную ввести RJ-код. Сервер мгновенно обновит метаданные.