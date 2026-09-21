# Changelog

All notable changes to this project are documented here.
Versions before v5.0 are listed at [Releases](https://github.com/Raven632/rpg-web-library/releases).

## [Unreleased]

### Added

- **Universal metadata lookup.** A game is matched through F95zone (a pasted thread link,
  catalog search by title, forum search by RJ code), DLsite, VNDB and Steam, in that order.
  ScraperAPI is used as a fallback when the free path hits a rate limit or a region block.
- **Manual F95 picker** in the game window for titles the search cannot match on its own.
- **Game images** — a cover and up to six in-game screenshots. Covers come from the store
  by RJ code, screenshots from the forum, with the store's own samples and Steam
  screenshots as fallbacks. Everything is stored in `_media`, never inside a game folder.
- **Sign-out button**, which until now had a route but no way to reach it.

### Changed

- **"Fetch missing metadata"** also queues games that have no images, and no longer skips
  games that a previous sweep remembered as a miss: the button is pressed by hand, usually
  right after the parser was improved.
- **Titles are cleaned before searching** — version tails such as `v1.2`, `-uncen` or
  `Steam` are stripped, which is what makes matching by name work at all.
- **Nothing is written inside game folders any more.** Scraped covers used to land next to
  the game's own files; they now go to `_media` like the rest of the media.
- **Line endings are LF everywhere**, enforced by `.gitattributes`. Mixed CRLF and LF made
  a one-line edit show up as a rewritten file.
- **Icons** are real 32 / 180 / 192 / 512 px files instead of one 623 KB image served for
  every size; 1.8 MB of unreferenced duplicates removed.

### Fixed

- **Steam returned nothing at all** — the store answers `success: false` for adult titles
  without age-gate cookies, so the whole Steam branch was silently dead.
- **Images saved as `.jpg` were not JPEG.** F95 serves AVIF or WebP over the same URL, and
  a thread's cover can be a 1.6 MB animation; every image is now re-encoded through ffmpeg.
- **Forum previews (400×250) were saved as screenshots** instead of the full-size originals.
- **Repeating images** in a gallery — near-identical pictures are dropped by a perceptual
  hash, not only by an exact byte match.
- **A thread about a different game by the same author** could be matched by RJ code; the
  code is now verified against the thread itself.
- **Imported desktop saves never appeared in the game**, and MZ saves (`.rmmzsave`) were
  deleted as foreign files; both formats are renamed to the keys the engine asks for.
- **One oddly named save file emptied the whole save list** for that game.
- **A partial `/edit` request wiped the title** and other fields it did not carry.
- **The background scrape queue** resumes after a restart instead of waiting for a new task.

### Security

- **Signing out rotates the server session key**, so the cookie stops working everywhere at
  once and open sockets are dropped. Before, logout only cleared the cookie in that one
  browser.

## [5.0] — 2026-09-20

### Security

- **Auth bypass removed.** The hardcoded fallback session token is gone; the token is
  either taken from `SESSION_SECRET` or generated once and stored in the database.
- **Path traversal blocked.** Game ids containing `.`, `..` or slashes are rejected by a
  shared `router.param` validator, so a crafted `DELETE /api/games/..` can no longer
  reach the library root.
- **Redis is no longer published.** The cache is reachable only over the internal Docker
  network.
- **Login brute force.** `/api/login` and `/api/setup/init` allow 10 failed attempts per
  15 minutes per address; successful logins do not consume the budget.
- **Request body limit** lowered from 50 MB to 1 MB — bodies are parsed before
  authentication, so any unauthenticated client could tie up server memory.
- **Socket.io requires the session cookie.** Browsers do not apply CORS to WebSockets, so
  `cors: { origin: '*' }` left the event bus open to any page; connections are now checked
  in `allowRequest`.
- **Node 20 → Node 22 LTS** (Node 20 left support in April 2026).

### Added

- **Game status** — playing / finished / dropped / want to play — with a badge on the card
  and a filter row in the toolbar.
- **Favorites** with a star on the card and its own filter.
- **Live sync across devices.** Any change to the library is broadcast over Socket.io, so a
  status set on the phone appears on the desktop without a reload.
- **Hide covers** toggle that blurs every cover on the page; the choice is remembered.
- **Sorting** by oldest first and by size, with a stable order for equal values.
- **Last played** is now recorded when a game is launched, which makes "recently played"
  work.
- **Disk usage widget** in the header.
- **Automated compatibility check** (Playwright + headless Chromium) that opens every game
  and reports the scene it reached.
- **Pull-based deployment and backups** as systemd timers.

### Changed

- **Games list is cached in Redis** and invalidated on every change to the library.
- **Uploads stream to disk** instead of being buffered and re-written, which removes the
  I/O amplification on multi-gigabyte archives.
- **Scraper** now queries mirrors in parallel: metadata lookup dropped from ~26 s to ~1.2 s.
- **Japanese descriptions** are translated again (the Google endpoint had changed).
- **Covers get a cache-busting URL**, so a replaced cover updates on the main page too.
- **Background refresh is debounced** and silent, so a burst of server events causes a
  single request.
- Design pass: loading skeletons, keyboard focus styles, larger touch targets, mobile
  layout fixes, and no sticky `:hover` on touch devices.

### Fixed

- Games that hung on launch because of a `JSON.parse` patch in `rpg-fixes.js`.
- Missing languages in games that read files through `fs`.
- Audio that stopped after the phone screen was locked.
- Video playback on iOS, the on-screen D-Pad, and Steam/Greenworks stubs.
- Unit tests no longer depend on the environment's cookie name, and the dev container
  runs the current test file instead of the copy baked into the image.
