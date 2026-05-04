# Jigsaw Puzzle Game � Design Document

## Overview

A browser-based jigsaw puzzle game for two parents (one iPad each), deployed as a static site
on GitHub Pages. All logic runs client-side. No server is required.

---

## Constraints

| Constraint | Decision |
|---|---|
| Hosting | GitHub Pages (static, no server) |
| Region | Russia � no Google, Facebook, Twitter dependencies |
| Users | 2, each on their own iPad |
| Device | iPad only (landscape & portrait) |
| Complexity | Minimal � no build pipeline, no npm || Language | Russian only — all UI text in Russian || Images | Generic royalty-free, bundled with the app |

---

## Authentication & Persistence

### The core problem

The requirement is:
- Prevent a stranger who finds the URL from casually opening the app (light access control)
- Keep each parent's progress forever � across browser updates, iOS updates, even clearing Safari history
- Ideally cross-browser too

The hard constraint: **GitHub Pages is static-only � no server, no database.**

---

### Storage durability analysis

| Storage method | Survives "Clear History" | Survives iOS update | Cross-browser |
|---|---|---|---|
| `localStorage` (Safari) | No | Yes (usually) | No |
| `IndexedDB` (Safari) | No | Yes (usually) | No |
| **PWA (Add to Home Screen)** | **Yes** | **Yes** | **N/A � standalone** |
| `localStorage` inside PWA | Yes | Yes | Yes (it IS the browser) |

**iOS PWA storage is in a separate container from Safari.** "Clear History and Website Data" in
Settings does not touch it. iOS updates do not clear it. It is the most durable client-side
storage available without a server.

---

### Decision: PWA + 4-digit PIN

**Each parent adds the app to their iPad Home Screen as a PWA.** This turns it into a standalone
app with isolated, persistent storage. They never need to open Safari again � the icon on their
home screen IS the app.

```
First launch
  Set your name and a 4-digit PIN
  Progress stored in PWA localStorage (durable, isolated)

Every subsequent launch
  Enter 4-digit PIN  ->  Home screen
```

- PIN stored as SHA-256 hash (Web Crypto API � no library needed).
- The PIN stops casual stumbling. Ten wrong attempts trigger a 30-second lockout.
- Since each parent has their own iPad, there are no profiles � the device IS the profile.
- Name is just a display label ("Hi, ����!").

**"Add to Home Screen" prompt:** On first visit in Safari, a sticky banner explains:
"Tap Share -> Add to Home Screen for the best experience and persistent saves."
The app works fine in Safari too, but PWA mode is recommended for durability.

---

### Belt-and-suspenders: Export / Import save

Settings contains "Export save" (downloads a JSON file) and "Import save" (reads it back).
Use case: getting a new iPad, or AirDropping a backup to yourself. This is the only "cloud sync"
story � deliberately low-tech.

---

### Future upgrade path (if ever needed)

A free **Supabase** project (anonymous auth + one table) can be added later without changing
the rest of the codebase � only `storage.js` would gain a cloud sync layer.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Language | Vanilla JS (ES2020) | No build step, no dependencies |
| Styling | CSS custom properties + Grid/Flexbox | Clean, fast, matches screenshot UI |
| Rendering | HTML5 Canvas | Hardware-accelerated on iPad |
| Storage | `localStorage` + `IndexedDB` (inside PWA) | Persistent, no backend |
| PWA | Web App Manifest + Service Worker | Offline, home screen install |
| Deployment | GitHub Pages (`/docs` folder on `main`) | Free, accessible from Russia |

**Total JS target: under 60 KB unminified. Zero npm packages. Zero CDN calls.**
Everything is local so the app works fully offline after first load.

---

## File Structure

```
/docs/                          <- GitHub Pages root
  index.html                    <- PIN screen (or first-time setup)
  home.html                     <- Main puzzle browser
  puzzle.html                   <- Active puzzle solver
  manifest.json                 <- PWA manifest
  sw.js                         <- Service Worker (cache-first, offline)
  css/
    variables.css               <- Color tokens, spacing, border-radius
    app.css                     <- Layout, nav, cards, modals
    puzzle.css                  <- Canvas wrapper, piece tray
  js/
    storage.js                  <- localStorage + IndexedDB wrappers
    auth.js                     <- PIN setup, PIN verify, SHA-256 hash, lockout
    puzzle-engine.js            <- Piece generation, tab shapes, snap logic
    puzzle-render.js            <- Canvas draw loop, drag/drop, touch events
    home.js                     <- Puzzle browser, categories, progress badges
    app.js                      <- Page routing, global init, SW registration
  images/
    puzzles/
      nature/                   <- 5 images
      animals/                  <- 5 images
      landmarks/                <- 5 images
      food/                     <- 5 images
      objects/                  <- 5 images
    icons/                      <- App icon 192x192 and 512x512 for PWA
  data/
    puzzles.json                <- Metadata: id, title, category, file, coinReward, unlockCost
```

---

## UI Screens

### 1. PIN Screen (`index.html`)

Shown on every cold launch (a `sessionStorage` flag skips it within the same session).

```
+---------------------------------------+
|                                       |
|         Puzzle  Family Puzzles        |
|                                       |
|   Hi, ����!  Enter your PIN:          |
|                                       |
|       [ 1 ]  [ 2 ]  [ 3 ]            |
|       [ 4 ]  [ 5 ]  [ 6 ]            |
|       [ 7 ]  [ 8 ]  [ 9 ]            |
|              [ 0 ]                    |
|                                       |
+---------------------------------------+
```

- Large tap targets (iPad-friendly, min 72px).
- First launch: "Welcome! Set your name and a 4-digit PIN."

---

### 2. Home Screen (`home.html`)

Matches screenshots:

- **Top bar:** coin counter, trophy icon, settings gear
- **Featured row:** horizontal-scroll cards (Daily Puzzle, unlockable Collection)
- **Puzzle grid:** 2-column rounded thumbnail cards
- **Lock icon** on coin-gated puzzles
- **Progress badge** ("47%") on in-progress puzzles
- **Bottom nav tabs:** Main | Daily | Categories | My Puzzles

---

### 3. Categories (`home.html` � categories tab)

- **Left panel (30% width):** category list with icon + label, active row highlighted
- **Right panel (70% width):** 3-column thumbnail grid, filters reactively on tap

Categories: All Puzzles, Nature, Animals, Landmarks, Food, Objects, Art

---

### 4. My Puzzles (`home.html` � my puzzles tab)

- Grid of all puzzles the parent has started or completed
- Completion percentage badge on each
- 100% = gold star overlay

---

### 5. Difficulty Modal (overlay)

Matches screenshot:

```
+------------------------------------------+
|  [Cancel]                                |
|                                          |
|  [Puzzle preview image � full width]     |
|   "Tournament stars  * 40"               |
|                                          |
|  Select Difficulty                       |
|  Reward:  900 coins                      |
|                                          |
|   [64]  [100]  [ 144 ]  [225]  [400]    |
|                  Pieces                  |
|                                          |
|  [           Start           ]           |
+------------------------------------------+
```

Coin rewards:

| Pieces | Reward |
|--------|--------|
| 64     | 120    |
| 100    | 300    |
| 144    | 900    |
| 225    | 3,000  |
| 400    | 13,500 |

---

### 6. Puzzle Solver (`puzzle.html`)

```
+----------------------------------------------------+
| [<-]  Mountains (144 pcs)          [eye]  [+/-]   |  top bar
|                                                    |
|                                                    |
|              [ Main canvas area ]                 |  assembled pieces
|              [ drag & drop zone ]                 |
|                                                    |
|                                                    |
+----------------------------------------------------+
| [piece] [piece] [piece] [piece] ->->               |  scrollable tray
+----------------------------------------------------+
```

- **Touch:** tap piece in tray to select, tap canvas to place; or drag directly.
- **Snap:** piece locks when dropped within ~24 px of correct position.
- **Rotation:** long-press a piece in tray to rotate 90 degrees.
- **Hint:** tap eye icon -> faded reference image overlays canvas for 3 seconds.
- **Auto-save:** every 30 s + on every successful snap.
- **Complete:** confetti animation, coins awarded, progress badge updated.

---

## Puzzle Engine

### Piece Generation

```
Source image (800 x 600 px WebP)
  -> Grid: cols x rows  (e.g. 12 x 12 = 144 pieces)
  -> Each shared edge assigned tab direction (in/out) from piece index (deterministic)
  -> Each piece clipped on offscreen canvas with ~10 px bleed for tabs
  -> Pieces scattered randomly using seeded PRNG
```

Tab shape: smooth sinusoidal bump, ~30% of edge length, ~20% protrusion. Classic jigsaw look.

### Seeded randomness

Initial scatter uses mulberry32 PRNG. Seed = hash(puzzleId + difficulty).
Same puzzle + difficulty always produces the same layout, so save/resume only needs piece positions.

### Snap logic

```
On pointerup:
  for each unplaced piece:
    if distance(current_pos, correct_pos) < snapRadius:
      lock piece at correct position
      merge with any adjacent locked group
      play snap sound (short tick, ~5 KB WAV)
      auto-save
```

Locked pieces are rendered onto the "assembled" canvas layer and cannot be moved again.

### Save format (IndexedDB, one record per puzzle+difficulty)

```json
{
  "puzzleId": "nature_mountains",
  "difficulty": 144,
  "seed": 4829201,
  "startedAt": 1714870000,
  "elapsedSeconds": 1842,
  "lockedCount": 37,
  "pieces": [
    { "id": 0, "x": 340.5, "y": 120.0, "rotation": 0, "locked": true },
    { "id": 1, "x": 80.0,  "y": 900.3, "rotation": 0, "locked": false }
  ]
}
```

---

## Bundled Image Set (~25 images)

All images: **800 x 600 px, WebP, ~80 KB each** (~2 MB total).
Source: Unsplash / Pixabay (CC0, no attribution required).

| Category | Images |
|---|---|
| Nature | mountains, forest lake, ocean cliff, sunset field, waterfall |
| Animals | orange cat, dog, fox, owl, polar bear |
| Landmarks | Eiffel Tower, Kremlin, Colosseum, Great Wall, Taj Mahal |
| Food | pizza, fruit bowl, coffee & croissant, layered cake, sushi |
| Objects | flower bouquet, stack of books, colored pencils, old camera, ceramic cups |

---

## Gamification (lightweight)

| Feature | Notes |
|---|---|
| Coins | Awarded on completion per table above. Stored in `localStorage`. |
| Daily puzzle | One fixed puzzle per calendar day from rotation in `puzzles.json`. Resets at midnight local time. |
| Locked puzzles | ~30% of puzzles require a coin threshold to unlock. Grinding easy puzzles unlocks harder ones. |
| Completion badge | Shown as percentage on thumbnail. 100% gets a gold star. |
| Streak counter | Days-in-a-row, shown on home screen. |

No tournaments or leaderboards (require a backend).

---

## PWA Configuration

`manifest.json`:
```json
{
  "name": "Family Puzzles",
  "short_name": "Puzzles",
  "start_url": "/family-puzzles/",
  "display": "standalone",
  "background_color": "#f5f5f7",
  "theme_color": "#4CAF50",
  "icons": [
    { "src": "images/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "images/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

`sw.js`: cache-first strategy, pre-caches all assets on install.
On SW update, the new version takes over on next open and refreshes the cache.

---

## Deployment

```
Repository:   github.com/<user>/family-puzzles   (can be private)
Branch:       main
Pages source: main, /docs folder
URL:          https://<user>.github.io/family-puzzles/
```

Steps:
1. Push all files under `/docs/` to `main`.
2. Enable GitHub Pages in repo Settings -> Pages -> Source: main, /docs.
3. On each iPad: open URL in Safari -> Share -> "Add to Home Screen".
4. Each parent taps their home screen icon -> sets name + PIN -> done.

A private repository is fine � GitHub Pages still serves the site publicly by URL,
but the PIN provides the access gate.

---

## Out of Scope

- Server, database, or any backend API
- Custom photo upload
- Multiplayer / real-time
- Cloud sync (upgrade path documented above)
- Phone layout
- Tournaments or leaderboards

---

## Implementation Phases

| Phase | Deliverables |
|---|---|
| 1 � Shell | `index.html`, `home.html`, `puzzle.html`, CSS variables, PWA manifest + SW stub, routing |
| 2 � Auth | PIN setup, PIN verify, SHA-256 hash, session flag, lockout |
| 3 � Browser | `puzzles.json` (25 entries), category filter, progress badges, difficulty modal |
| 4 � Engine | Piece generation, tab shapes, scatter, Canvas render, touch drag, snap |
| 5 � Persistence | IndexedDB save/resume, auto-save, export/import JSON |
| 6 � Gamification | Coins, daily puzzle, locked gates, streak counter |
| 7 � Polish | Confetti, snap sound, hint overlay, "Add to Home Screen" banner, app icons |
| 8 � Images | Source + resize 25 images to WebP 800x600 |
