# Jigsaw Puzzle Game — Design Document

## Overview

A browser-based jigsaw puzzle game deployed as a static site on GitHub Pages.
All logic runs client-side. No server, no authentication, no accounts.

---

## Constraints

| Constraint | Decision |
|---|---|
| Hosting | GitHub Pages (static, no server) |
| Region | Russia — no Google, Facebook, Twitter dependencies |
| Device | iPad (landscape & portrait) |
| Complexity | Minimal — no build pipeline, no npm |
| Language | Russian — all UI text in Russian |
| Images | Fetched from the web on demand, not bundled in the repo — ever |

---

## Persistence

Progress is stored in `localStorage` (one entry per puzzle + piece-count combination).
No login, no PIN, no accounts. The device is the identity.

Stored per puzzle session:
- Which pieces are locked and their positions
- Elapsed time
- Started / completed flag

On next visit the user can continue any in-progress puzzle or review completed ones from
the **"Мои пазлы"** section.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Language | Vanilla JS (ES2020) | No build step, no dependencies |
| Styling | CSS custom properties + Grid/Flexbox | Clean, fast |
| Rendering | HTML5 Canvas | Hardware-accelerated on iPad |
| Storage | `localStorage` | Simple, sufficient |
| PWA | Web App Manifest + Service Worker | Home screen install, offline shell |
| Images | Fetched from Wikimedia Commons (`upload.wikimedia.org`) at runtime | Zero repo bloat; accessible from Russia; permanent CC/PD URLs |
| Deployment | GitHub Pages (`/docs` folder on `main`) | Free, accessible from Russia |

**Zero npm packages. Zero CDN calls for code.** Image URLs point to royalty-free hosts;
the fetched image is cached in the browser cache automatically.

---

## File Structure

```
/docs/                          <- GitHub Pages root
  index.html                    <- Single-page app shell (home + puzzle in one page)
  manifest.json                 <- PWA manifest
  sw.js                         <- Service Worker (caches app shell; images cached on fetch)
  css/
    variables.css               <- Color tokens, spacing, border-radius
    app.css                     <- Layout, sidebar, cards, modals
    puzzle.css                  <- Canvas wrapper, piece tray
  js/
    storage.js                  <- localStorage helpers (save/load puzzle state)
    puzzle-engine.js            <- Piece generation, tab shapes, snap logic
    puzzle-render.js            <- Canvas draw loop, drag/drop, touch events
    home.js                     <- Category sidebar, image grid, progress badges
    app.js                      <- View routing, global init, SW registration
  data/
    puzzles.json                <- Metadata: id, title, category, imageUrl, thumbUrl
```

---

## UI Layout (single page, no navigation)

The app is one HTML page. The left sidebar is always visible; the right area shows
either the **image browser** or the **active puzzle solver**.

```
+------------------+--------------------------------------------+
|                  |                                            |
|   SIDEBAR        |   CONTENT AREA                             |
|   (fixed width)  |   (image grid  OR  puzzle canvas)          |
|                  |                                            |
|  Все пазлы       |                                            |
|  Природа         |                                            |
|  Животные        |                                            |
|  Достопримеча-   |                                            |
|  тельности       |                                            |
|  Еда             |                                            |
|  Предметы        |                                            |
|                  |                                            |
|  ────────────    |                                            |
|  Мои пазлы       |                                            |
|                  |                                            |
+------------------+--------------------------------------------+
```

- Sidebar width: ~220 px, fixed; content area fills the rest.
- Active category row is highlighted.
- "Мои пазлы" is pinned at the bottom of the sidebar, separated by a divider.
  It is only visible when at least one puzzle has been started.

---

## Screens / Views

### 1. Image Browser (default view)

Shown when a category is selected in the sidebar.

- **3-column thumbnail grid** of puzzles in that category.
- Each card shows: thumbnail image, title in Russian.
- In-progress puzzles show a progress bar (e.g. "47 / 144 фр.").
- Completed puzzles show a gold star overlay.
- Tapping a card opens the **Difficulty Modal**.

### 2. Difficulty Modal (overlay)

```
+------------------------------------------+
|  [x Закрыть]                             |
|                                          |
|  [Preview image - full width]            |
|  "Горы"                                  |
|                                          |
|  Выберите сложность:                     |
|                                          |
|   [ 24 ]  [ 64 ]  [ 100 ]  [ 144 ]      |
|                  Фрагментов             |
|                                          |
|  [           Начать           ]          |
+------------------------------------------+
```

- Piece counts: **24, 64, 100, 144** (iPad-friendly range).
- If a save exists for this puzzle + piece count, button label changes to
  **"Продолжить"** and shows elapsed time.
- Tapping Start/Continue closes the modal and switches the content area to the Puzzle Solver.

### 3. Puzzle Solver (replaces content area)

```
+----------------------------------------------------+
| [<- Назад]  Горы (144 фр.)            [Подсказка] |
|                                                    |
|                                                    |
|              [ Main canvas area ]                  |
|              [ assembled pieces ]                  |
|                                                    |
|                                                    |
+----------------------------------------------------+
| [piece] [piece] [piece] [piece] [piece] ->->       |  scrollable tray
+----------------------------------------------------+
```

- **<- Назад** returns to the image browser (progress is auto-saved first).
- **Подсказка:** tapping overlays a faded reference image for 3 seconds.
- **Touch:** drag a piece from the tray onto the canvas; or tap piece then tap target.
- **Snap:** piece locks when released within ~24 px of its correct position.
- **Auto-save:** on every successful snap and when navigating away.
- **Complete:** brief confetti animation, puzzle marked done in localStorage.

### 4. Мои пазлы (sidebar category)

Shows a grid of all puzzles that have been started or completed, across all categories.
- In-progress puzzles show their progress bar.
- Completed puzzles show a gold star.
- Tapping opens the Difficulty Modal (pre-selected to the saved piece count).

---

## Image Loading Strategy

Images are **never bundled in the repository**. Each entry in `puzzles.json` carries two URLs.

### Image Source Policy

All image URLs must resolve from within Russia without a VPN. Permitted sources, in order of preference:

| Source | Domain | Why |  
|---|---|---|
| Wikimedia Commons | `upload.wikimedia.org` | Not blocked in Russia; permanent URLs; CC/PD licensed |
| Yandex.Disk public link | `downloader.disk.yandex.ru` | Russian CDN; zero geo-risk |

Unsplash (`images.unsplash.com`) and Pixabay (`cdn.pixabay.com`) are **banned from this project** — both are intermittently blocked or throttled in Russia. If a URL from a permitted source breaks, replace the URL in `puzzles.json`; that is a content update, not an engineering change.

```json
{
  "id": "nature_mountains",
  "title": "Горы",
  "category": "nature",
  "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/x/xx/File.jpg/1200px-File.jpg",
  "thumbUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/x/xx/File.jpg/400px-File.jpg"
}
```

- **Thumbnails** are loaded when the image grid is rendered (no lazy-loading needed for 25 items).
- **Full image** is fetched once when the user starts a puzzle; the browser caches it via
  normal HTTP caching. Subsequent sessions use the cached copy.
- The Service Worker uses a **cache-first** strategy for puzzle images:
  on first fetch the image is stored in a named Cache; subsequent plays are instant and offline.
- No image is downloaded until the user explicitly chooses it.

---

## Puzzle Engine

### Piece Generation

```
Fetch full image  (from URL or cache)
  -> Draw onto offscreen canvas at target resolution
  -> Grid: cols x rows  (e.g. 12 x 12 = 144 pieces)
  -> Each shared edge assigned tab direction (in/out) deterministically from piece index
  -> Each piece clipped to offscreen canvas with ~10 px bleed for tabs
  -> Pieces scattered randomly using seeded PRNG (seed = puzzleId + pieceCount)
```

Tab shape: smooth sinusoidal bump, ~30% of edge length, ~20% protrusion.

### Seeded randomness

Uses the **mulberry32** PRNG. Seed = simple hash of `puzzleId + pieceCount`.
Same puzzle + piece count always produces the same initial scatter, so a save only needs
to store current piece positions (not the full layout).

### Snap logic

```
On pointerup:
  if distance(dropped_pos, correct_pos) < snapRadius:
    lock piece at correct position
    merge with any adjacent locked group
    auto-save
```

Locked pieces are painted onto a persistent "assembled" canvas layer and are immovable.

### Save format (localStorage, key = save_<stablePuzzleId>_<pieceCount>)

`stablePuzzleId` is derived from the source image identity, not the current catalogue
category. That keeps saves attached to the same Wikimedia image even if `puzzles.json`
is regenerated and the visible `puzzleId` changes.

```json
{
  "puzzleId": "animals_23241619",
  "storagePuzzleId": "page_23241619",
  "pieceCount": 144,
  "seed": 4829201,
  "startedAt": 1714870000,
  "elapsedSeconds": 1842,
  "lockedCount": 37,
  "completed": false,
  "pieces": [
    { "id": 0, "x": 340.5, "y": 120.0, "locked": true },
    { "id": 1, "x": 80.0,  "y": 900.3, "locked": false }
  ]
}
```

---

## Image Catalogue (~25 images)

Stored as entries in `data/puzzles.json` with Wikimedia Commons URLs (CC/public domain).
No image files are downloaded to the repository — ever.

| Category | Subjects |
|---|---|
| Природа | горы, лесное озеро, океанский утёс, закат в поле, водопад |
| Животные | рыжий кот, собака, лиса, сова, белый медведь |
| Достопримечательности | Эйфелева башня, Кремль, Колизей, Великая стена, Тадж-Махал |
| Еда | пицца, фруктовая тарелка, кофе и круассан, торт, суши |
| Предметы | букет цветов, стопка книг, цветные карандаши, старый фотоаппарат, керамические кружки |

---

## PWA Configuration

`manifest.json`:
```json
{
  "name": "Семейные пазлы",
  "short_name": "Пазлы",
  "start_url": "/puzzles/",
  "display": "standalone",
  "background_color": "#f5f5f7",
  "theme_color": "#4CAF50",
  "icons": [
    { "src": "images/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "images/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

`sw.js`: pre-caches app shell (HTML, CSS, JS, manifest) on install.
Puzzle images are cached on first fetch (cache-first for subsequent requests).

---

## Deployment

```
Repository:   github.com/<user>/puzzles
Branch:       main
Pages source: main, /docs folder
URL:          https://<user>.github.io/puzzles/
```

Steps:
1. Push all files under `/docs/` to `main`.
2. Enable GitHub Pages in repo Settings -> Pages -> Source: main, /docs.
3. Open the URL in Safari on each iPad -> Share -> "Add to Home Screen" (optional but recommended).

---

## Implementation Phases

| Phase | Deliverables |
|---|---|
| 1 — Shell | `index.html`, sidebar, content area, CSS variables, PWA manifest + SW stub |
| 2 — Browser | `puzzles.json` (25 entries with URLs), category sidebar, thumbnail grid, lazy image load |
| 3 — Modal | Difficulty modal, piece-count selector, "Продолжить" detection from localStorage |
| 4 — Engine | Piece generation, tab shapes, scatter, Canvas render, touch drag, snap |
| 5 — Persistence | localStorage save/resume on snap and on back-navigation |
| 6 — Мои пазлы | Sidebar section aggregating all started/completed puzzles |
| 7 — Polish | Confetti on completion, hint overlay, image caching via Service Worker |
