# 🎮 RPG Library v2.0

🇬🇧 [English](README.md) | 🇷🇺 [Русский](README.ru.md)

[![GitHub Release](https://img.shields.io/github/v/release/Raven632/rpg-web-library?style=for-the-badge&color=blue)](https://github.com/Raven632/rpg-web-library/releases)
[![GitHub Stars](https://img.shields.io/github/stars/Raven632/rpg-web-library?style=for-the-badge&color=gold)](https://github.com/Raven632/rpg-web-library/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
![Tests: Passing](https://img.shields.io/badge/Tests-154_Lines_Passing-brightgreen?style=for-the-badge&logo=jest&logoColor=white)

![Node.js](https://img.shields.io/badge/Node.js-20.x-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

Ein Self-Hosted Webdienst zur Katalogisierung, Speicherung und Ausführung von RPG Maker-Spielen (MV/MZ) direkt über den Browser deines Heimservers. Entwickelt mit Fokus auf hohe Leistung, I/O-Stabilität und automatisches Sammeln von Metadaten.

![App Screenshot](/rest/img/Example.png)

## ✨ Hauptfunktionen

- **🌐 Web-Emulator:** Ein integrierter `rpg-fixes.js`-Injektor fängt NW.js-Aufrufe ab und ermöglicht es, PC-exklusive RPG Maker-Spiele direkt im Browser (Desktop oder Mobile) zu spielen.
- **☁️ Cloud-Spielstände:** Die `localStorage` des Spiels wird abgefangen und die Spielstände werden automatisch in der SQLite-Datenbank des Servers synchronisiert. Beginne auf dem PC und spiele nahtlos auf dem Smartphone weiter.
- **📱 Mobile Anpassung:** Automatische Canvas-Skalierung ohne Verzerrungen (PIXI smoothing), ein virtuelles Gamepad (D-Pad, Shift, Menu, Esc) und optimierte Schriftarten für Touchscreens.
- **🕵️‍♂️ Smart Scraper (DLsite):** Erkennt automatisch RJ-Codes. Der Server umgeht GDPR- und Geo-Sperren über API-Gateways und parallele cURL-Anfragen über anonyme Proxys, um Cover und Tags abzurufen und Beschreibungen "on the fly" zu übersetzen.
- **📦 Zuverlässige Archivverarbeitung:** Lade Archive (ZIP, RAR, 7z) mit bis zu 10 GB hoch. Die Stream-basierte Entpackung über `7zz` (mit `spawn` statt `execFile`) verhindert Buffer-Overflows und die Überlastung des Arbeitsspeichers (RAM).

## 🛠 Technologie-Stack

- **Backend:** Node.js, Express, Socket.io (für Echtzeit-Updates beim Entpacken).
- **Datenbank:** SQLite (`sqlite3` vorkompiliert).
- **Frontend:** Vanilla JS / CSS (Grid, Flexbox). Keine schwerfälligen Frameworks.
- **Infrastruktur:** Docker Engine, `7zip`, natives `curl`.

## 🚀 Installation & Nutzung

Dieses Projekt ist für die **native Docker Engine** (Linux) konzipiert. Die Verwendung von Docker Desktop wird nicht empfohlen, da es bei der Verarbeitung großer Archive über eine VM zu massiven Leistungseinbußen beim I/O kommt.

1. Repository klonen:
   ```bash
   git clone https://github.com/Raven632/rpg-web-library.git
   cd rpg-web-library
   ```

2. Container starten:

   ```bash
   docker compose up -d --build
   ```

3. Öffne http://localhost:3000 oder http://localhost (oder die IP deines Servers) im Browser.

## 📂 Verzeichnisstruktur
Beim ersten Start verknüpft Docker das Verzeichnis ./games mit deinem Host:

- /games — Entpackte Spiele.

- /games/library.db — Die SQLite-Datenbank.

- /games/_saves — JSON-Dateien mit den Cloud-Spielständen der Spieler.

- /games/_tmp_uploads — Puffer-Verzeichnis für große Uploads, um eine RAM-Überlastung zu vermeiden.

## 📝 Manuelle Bearbeitung

    Falls der automatische Parser das Spiel nicht finden konnte, kannst du das modale Fenster des Spiels auf der Website öffnen, auf ⚙️ (Einstellungen) klicken und den RJ-Code manuell eingeben. Der Server aktualisiert die Metadaten umgehend.