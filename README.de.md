# 🎮 RPG Library v4.0

🇬🇧 [English](README.md) | 🇷🇺 [Русский](README.ru.md)

[![GitHub Release](https://img.shields.io/github/v/release/Raven632/rpg-web-library?style=for-the-badge&color=blue)](https://github.com/Raven632/rpg-web-library/releases)
[![GitHub Stars](https://img.shields.io/github/stars/Raven632/rpg-web-library?style=for-the-badge&color=gold)](https://github.com/Raven632/rpg-web-library/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
![Tests: Passing](https://img.shields.io/badge/Tests-154_Lines_Passing-brightgreen?style=for-the-badge&logo=jest&logoColor=white)

![Node.js](https://img.shields.io/badge/Node.js-20.x-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

Ein Self-Hosted Webdienst zur Katalogisierung, Speicherung und Ausführung von RPG Maker-Spielen (MV/MZ) direkt über den Browser deines Heimservers. Entwickelt mit Fokus auf hohe Leistung, I/O-Stabilität und intelligente automatische Metadatenerfassung.

![App Screenshot](/rest/img/Example.png)

## ✨ Hauptfunktionen

- **🌐 Web-Emulator:** Ein integrierter `rpg-fixes.js`-Injektor fängt NW.js-Aufrufe ab und ermöglicht es, PC-exklusive RPG Maker-Spiele direkt im Browser (Desktop oder Mobile) zu spielen.
- **☁️ Cloud-Spielstände:** Die `localStorage` des Spiels wird abgefangen und die Spielstände werden automatisch in der SQLite-Datenbank des Servers synchronisiert. Beginne auf dem PC und spiele nahtlos auf dem Smartphone weiter.
- **🌍 Mehrsprachige Benutzeroberfläche (i18n):** Native Unterstützung für Deutsch, Englisch und Russisch ohne schwere externe Bibliotheken.
- **🧠 Intelligenter universeller Scraper:** Der Server nutzt eine kaskadierende Suchlogik im Hintergrund. Zuerst wird auf **DLsite** (nach RJ-Code) gesucht. Wird nichts gefunden, greift er auf **VNDB** und **Steam** (nach Spieltitel) zurück.
- **🛡️ Geo-Sperren umgehen (BYOK-Support):** Sammelt automatisch Hunderte von kostenlosen Proxys, um DLsite-Sperren zu umgehen. Für 100%ige Stabilität wird "Bring Your Own Key" via ScraperAPI unterstützt.
- **📱 Mobile Anpassung & Infinite Scroll:** Automatische Canvas-Skalierung, ein virtuelles Gamepad und flüssiges Endlos-Scrollen für große Bibliotheken.
- **📦 Zuverlässige Archivverarbeitung:** Lade Archive (ZIP, RAR, 7z) mit bis zu 10 GB hoch. Die Stream-basierte Entpackung über `7zz` verhindert Buffer-Overflows und Serverabstürze.

## 🛠 Technologie-Stack

- **Backend:** Node.js, Express, Socket.io (für Echtzeit-Updates).
- **Datenbank:** SQLite (`sqlite3` vorkompiliert) mit Zero-Config-Sicherheit.
- **Frontend:** Vanilla JS / CSS. Keine schwerfälligen Frameworks.
- **Infrastruktur:** Docker Engine, `7zip`, natives `curl`.

## 🚀 Installation & Nutzung

Dieses Projekt ist für die **native Docker Engine** (Linux) konzipiert. Die Verwendung von Docker Desktop wird nicht empfohlen, da es zu massiven Leistungseinbußen beim I/O kommt.

1. Repository klonen:
   ```bash
   git clone [https://github.com/Raven632/rpg-web-library.git](https://github.com/Raven632/rpg-web-library.git)
   cd rpg-web-library
   ```
2. (Optional, aber empfohlen) Zuverlässiges Scraping einrichten:
   Benenne .env.example in .env um. Hole dir einen kostenlosen API-Key von ScraperAPI (1000 Anfragen/Monat frei) und trage ihn unter SCRAPER_API_KEY ein. Ohne Key nutzt der Server instabile öffentliche Proxys.

3. Container starten:

   ```bash
   docker compose up -d --build
   ```

4. Öffne http://localhost:3000 (oder die IP deines Servers) im Browser. Beim ersten Start wirst du aufgefordert, einen Master-Account zu erstellen.

## 📂 Verzeichnisstruktur
Beim ersten Start verknüpft Docker das Verzeichnis ./games mit deinem Host:

- /games — Entpackte Spiele.

- /games/library.db — Die SQLite-Datenbank (enthält auch deine Admin-Zugangsdaten).

- /games/_saves — JSON-Dateien mit den Cloud-Spielständen.

- /games/_tmp_uploads — Puffer-Verzeichnis für große Uploads.

## 📝 Manuelle Bearbeitung

   Falls der Parser das Spiel nicht finden konnte, öffne das modale Fenster des Spiels, klicke auf ⚙️ (Einstellungen) und gib den RJ-Code oder den korrekten Titel manuell ein. Der Server aktualisiert die Metadaten umgehend.