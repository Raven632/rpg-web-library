# 🎮 RPG Library v5.0

🇷🇺 [Русский](README.ru.md) | 🇩🇪 [Deutsch](README.de.md)

[![GitHub Release](https://img.shields.io/github/v/release/Raven632/rpg-web-library?style=for-the-badge&color=blue)](https://github.com/Raven632/rpg-web-library/releases)
[![GitHub Stars](https://img.shields.io/github/stars/Raven632/rpg-web-library?style=for-the-badge&color=gold)](https://github.com/Raven632/rpg-web-library/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
![Tests: Passing](https://img.shields.io/badge/Tests-12_unit_%2B_75_games-brightgreen?style=for-the-badge&logo=jest&logoColor=white)

![Node.js](https://img.shields.io/badge/Node.js-22.x-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

A self-hosted web service designed to catalog, store, and play browser-based RPG Maker games (MV/MZ) directly from your home server. Engineered for high performance, I/O resilience, and fully automated metadata scraping.

![App Screenshot](/rest/img/Example.png)

## ✨ Key Features

- **🌐 Web Emulator:** A built-in `rpg-fixes.js` injector intercepts NW.js calls, allowing you to play PC-exclusive RPG Maker games directly in your desktop or mobile browser.
- **☁️ Cloud Saves:** Intercepts the game's `localStorage` and automatically syncs save files to the server's SQLite database. Start playing on your PC and seamlessly continue on your smartphone.
- **🌍 Multi-language UI (i18n):** Native support for English, Russian, and German right out of the box. 
- **🧠 Universal Smart Scraper:** The server uses a cascading search logic running in a background queue. It first searches **DLsite** (by RJ-code), and if not found, it falls back to **VNDB** and **Steam** (by game title).
- **🛡️ Bypass Geo-Blocks (BYOK Support):** Automatically aggregates hundreds of free public proxies to bypass DLsite region blocks. For 100% stability, it supports **Bring Your Own Key** (BYOK) via ScraperAPI.
- **📱 Mobile Adaptation & Infinite Scroll:** Automatic canvas scaling without pixel distortion (PIXI smoothing), a virtual gamepad, and smooth infinite scrolling for large libraries.
- **📌 Statuses & Favorites:** Mark games as playing, finished, dropped or "want to play", star the ones you love, and filter the library by either.
- **🔄 Live Sync:** Any change is pushed over Socket.io — a status set on your phone shows up on the desktop within a second, without reloading.
- **🙈 Hide Covers:** One button blurs every cover on the page, for when someone else is looking at your screen. The choice is remembered.
- **🔐 Hardened by Default:** Login attempts are rate-limited, the event bus requires the session cookie, and nothing but the site itself is exposed.
- **📦 Heavy Archive Support:** Upload archives (ZIP, RAR, 7z) up to 10GB. Stream-based extraction via `7zz` prevents buffer overflows and server RAM exhaustion.

## 🛠 Tech Stack

- **Backend:** Node.js 22, Express, Socket.io (for real-time updates), Redis (games list cache).
- **Database:** SQLite (`sqlite3` precompiled) with Zero-Config security.
- **Frontend:** React 19 + Vite.
- **Infrastructure:** Docker Engine, `7zip`, native `curl`.
- **Tests:** Node test runner (unit) and Playwright + headless Chromium (game compatibility).

## 🚀 Installation & Usage

This project is built for **native Docker Engine** (Linux). Using Docker Desktop is not recommended due to severe I/O performance drops when handling massive archives through a VM.

1. Clone the repository:
   ```bash
   git clone https://github.com/Raven632/rpg-web-library.git
   cd rpg-web-library
   ```
      
2. Create your configuration:
   ```bash
   cp .env.example .env
   ```
   Every setting is documented inside the file. Two deserve a look right away:
   - `SESSION_SECRET` — generate your own with `openssl rand -hex 64`. Without it the server creates one on first start and keeps it in the database.
   - `SCRAPER_API_KEY` — a free ScraperAPI key (1000 requests/month) makes metadata lookups reliable; left empty, the server falls back to unstable public proxies.

3. Start the container:
   ```bash
   docker compose up -d --build
   ```
      
4. Open `http://localhost` (or your server's IP) in a browser — the port is the one you set in `HTTP_PORT`. On first launch you will be prompted to create a Master Account.

## 📂 Directory Structure
Upon first launch, Docker will bind-mount the ./games directory to your host:

- /games — Extracted games.

- /games/library.db — The SQLite database file (contains your admin credentials).

- /games/_saves — JSON files containing players' cloud saves.

- /games/_tmp_uploads — Buffer directory for heavy uploads to prevent RAM exhaustion.

## 📜 Changelog

See [CHANGELOG.md](CHANGELOG.md) for what changed in each version.

## 📝 Manual Editing

If the automatic parser couldn't find the game, you can open the game's modal window on the website, click ⚙️ (Settings), and manually enter the RJ code or title. The server will update the metadata immediately.