# 🎮 RPG Library v2.0

🇷🇺 [Русский](README.ru.md) | 🇩🇪 [Deutsch](README.de.md)

![Node.js](https://img.shields.io/badge/Node.js-20.x-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)

A self-hosted web service designed to catalog, store, and play browser-based RPG Maker games (MV/MZ) directly from your home server. Engineered for high performance, I/O resilience, and fully automated metadata scraping.

![App Screenshot](/rest/img/Example.png)

## ✨ Key Features

- **🌐 Web Emulator:** A built-in `rpg-fixes.js` injector intercepts NW.js calls, allowing you to play PC-exclusive RPG Maker games directly in your desktop or mobile browser.
- **☁️ Cloud Saves:** Intercepts the game's `localStorage` and automatically syncs save files to the server's SQLite database. Start playing on your PC and seamlessly continue on your smartphone.
- **📱 Mobile Adaptation:** Automatic canvas scaling without pixel distortion (PIXI smoothing), a virtual gamepad (D-Pad, Shift, Menu, Esc), and optimized fonts for touch screens.
- **🕵️‍♂️ Smart Scraper (DLsite):** Automatically detects RJ-codes. The server bypasses GDPR and Geo-blocks via API gateways and parallel cURL requests through anonymous proxies, fetching covers, tags, and translating descriptions on the fly.
- **📦 Heavy Archive Support:** Upload archives (ZIP, RAR, 7z) up to 10GB. Stream-based extraction via `7zz` (using `spawn` instead of `execFile`) prevents buffer overflows and server RAM exhaustion.

## 🛠 Tech Stack

- **Backend:** Node.js, Express, Socket.io (for real-time extraction updates).
- **Database:** SQLite (`sqlite3` precompiled).
- **Frontend:** Vanilla JS / CSS (Grid, Flexbox). Zero heavy frameworks.
- **Infrastructure:** Docker Engine, `7zip`, native `curl`.

## 🚀 Installation & Usage

This project is built for **native Docker Engine** (Linux). Using Docker Desktop is not recommended due to severe I/O performance drops when handling massive archives through a VM.

1. Clone the repository:
   ```bash
   git clone [https://github.com/Raven632/rpg-web-library.git](https://github.com/Raven632/rpg-web-library.git)
   cd rpg-web-library
   ```

2. Start the container:

   ```bash
   docker compose up -d --build
   ```

3. Open http://localhost:3000 or http://localhost (or your server's IP) in your browser.

## 📂 Directory Structure
Upon first launch, Docker will bind-mount the ./games directory to your host:

- /games — Extracted games.

- /games/library.db — The SQLite database file.

- /games/_saves — JSON files containing players' cloud saves.

- /games/_tmp_uploads — Buffer directory for heavy uploads to prevent RAM exhaustion.

## 📝 Manual editing

   If the automatic parser couldn't find the game, you can open the game's modal window on the website, click ⚙️ (Settings), and manually enter the RJ code. The server will update the metadata immediately.