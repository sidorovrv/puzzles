/**
 * app.js — View routing, global init, SW registration
 */

'use strict';

const App = (() => {
  let _puzzles = [];

  // ── Init ────────────────────────────────────────────
  async function init() {
    // Register Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(err => {
        console.warn('SW registration failed:', err);
      });
    }

    // Load puzzle catalogue
    try {
      const resp = await fetch('./data/puzzles.json');
      _puzzles = await resp.json();
    } catch (e) {
      console.error('Failed to load puzzles.json:', e);
      return;
    }

    Home.init(_puzzles);
    showHome();
  }

  // ── View: Home ───────────────────────────────────────
  function showHome() {
    PuzzleRender.stop();

    document.getElementById('home-view').classList.add('active');
    document.getElementById('puzzle-view').classList.remove('active');

    Home.refreshCurrentView();
  }

  // ── View: Puzzle ─────────────────────────────────────
  async function showPuzzle(puzzleId, pieceCount) {
    const puzzle = _puzzles.find(p => p.id === puzzleId);
    if (!puzzle) return;

    document.getElementById('home-view').classList.remove('active');
    document.getElementById('puzzle-view').classList.add('active');

    // Update toolbar label
    document.getElementById('puzzle-title-label').textContent =
      `${puzzle.title} (${pieceCount} фр.)`;

    // Load full image
    let img;
    try {
      img = await _loadImage(puzzle.imageUrl);
    } catch (e) {
      alert('Не удалось загрузить изображение. Проверьте соединение.');
      showHome();
      return;
    }

    // Load saved state
    const saved = Storage.loadState(puzzleId, pieceCount);

    PuzzleRender.start(puzzleId, pieceCount, img, saved);
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
