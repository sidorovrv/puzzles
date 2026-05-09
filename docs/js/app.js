/**
 * app.js — View routing, global init, SW registration
 */

'use strict';

const App = (() => {
  const MAX_DESCRIPTION_LENGTH = 300;

  let _puzzles = [];
  let _lifecycleBound = false;
  let _serviceWorkerListenersBound = false;
  let _reloadPendingForUpdate = false;

  function _clampDescription(value, maxLength = MAX_DESCRIPTION_LENGTH) {
    if (typeof value !== 'string') return value;

    const normalized = value.trim();
    if (normalized.length <= maxLength) return normalized;

    const boundary = normalized.lastIndexOf(' ', maxLength - 1);
    const safeBoundary = Math.floor(maxLength * 0.6);
    const endIndex = boundary >= safeBoundary ? boundary : maxLength;
    return normalized.slice(0, endIndex).trimEnd();
  }

  function _normalizePuzzles(puzzles) {
    return puzzles.map(puzzle => ({
      ...puzzle,
      description: _clampDescription(puzzle.description),
    }));
  }

  // ── Init ────────────────────────────────────────────
  async function init() {
    _bindLifecycleEvents();
    _registerServiceWorker();

    // Load puzzle catalogue
    try {
      const resp = await fetch('./data/puzzles.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      _puzzles = _normalizePuzzles(await resp.json());
    } catch (e) {
      console.error('Failed to load puzzles.json:', e);
      _showCatalogueError();
      return;
    }

    Home.init(_puzzles);
    showHome();
  }

  function _bindLifecycleEvents() {
    if (_lifecycleBound) return;
    window.addEventListener('pagehide', _persistActivePuzzle);
    _lifecycleBound = true;
  }

  function _persistActivePuzzle() {
    if (typeof PuzzleRender.saveProgress === 'function') {
      PuzzleRender.saveProgress();
    }
  }

  async function _registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    const requestUpdateActivation = worker => {
      if (!worker || !navigator.serviceWorker.controller || _reloadPendingForUpdate) return;
      _reloadPendingForUpdate = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    };

    if (!_serviceWorkerListenersBound) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!_reloadPendingForUpdate) return;
        _persistActivePuzzle();
        window.location.reload();
      });
      _serviceWorkerListenersBound = true;
    }

    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });

      if (registration.waiting) {
        requestUpdateActivation(registration.waiting);
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;

        installing.addEventListener('statechange', () => {
          if (installing.state !== 'installed') return;
          requestUpdateActivation(registration.waiting || installing);
        });
      });

      registration.update().catch(err => {
        console.warn('SW update check failed:', err);
      });
    } catch (err) {
      console.warn('SW registration failed:', err);
    }
  }

  function _showCatalogueError() {
    document.getElementById('home-category-title').textContent = 'Ошибка загрузки';

    const grid = document.getElementById('card-grid');
    grid.innerHTML = '';

    const message = document.createElement('div');
    message.className = 'empty-state';
    message.textContent = 'Не удалось загрузить каталог пазлов. Проверьте соединение и обновите страницу.';
    grid.appendChild(message);
  }

  function _setShellMode(mode) {
    const app = document.getElementById('app');
    if (!app) return;

    if (mode === 'puzzle') {
      app.classList.add('playing-puzzle');
      return;
    }

    app.classList.remove('playing-puzzle');
  }

  // ── View: Home ───────────────────────────────────────
  function showHome() {
    PuzzleRender.stop();
    _setShellMode('home');

    document.getElementById('home-view').classList.add('active');
    document.getElementById('puzzle-view').classList.remove('active');

    Home.refreshCurrentView();
  }

  // ── View: Puzzle ─────────────────────────────────────
  async function showPuzzle(puzzleId, pieceCount, options = {}) {
    const puzzle = _puzzles.find(p => p.id === puzzleId);
    if (!puzzle) return;

    const restart = Boolean(options.restart);

    _setShellMode('puzzle');
    document.getElementById('home-view').classList.remove('active');
    document.getElementById('puzzle-view').classList.add('active');

    // Update toolbar label
    document.getElementById('puzzle-title-label').textContent =
      `${puzzle.description || puzzle.title} (${pieceCount} фр.)`;

    // Load full image
    let img;
    try {
      img = await _loadImage(puzzle.imageUrl);
    } catch (e) {
      alert('Не удалось загрузить изображение. Проверьте соединение.');
      showHome();
      return;
    }

    // Load saved state unless the caller requested a clean restart.
    if (restart) {
      Storage.clearState(puzzle, pieceCount);
    }

    const saved = restart ? null : Storage.loadState(puzzle, pieceCount);

    PuzzleRender.start(puzzle, pieceCount, img, saved);
  }

  function _loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error('Image load failed: ' + url));
      img.src = url;
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { showHome, showPuzzle };
})();
