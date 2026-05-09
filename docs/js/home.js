/**
 * home.js — Category sidebar, image grid, difficulty modal
 */

'use strict';

const Home = (() => {
  let _puzzles = [];         // full puzzles.json array
  let _categoryPuzzles = new Map();
  let _currentCategory = null;
  let _modalPuzzle = null;
  let _selectedCount = 24;

  const CATEGORY_LABELS = {
    nature: 'Природа',
    animals: 'Животные',
    architecture: 'Архитектура',
    plants: 'Растения',
    carnivora: 'Хищники',
    mammals: 'Млекопитающие',
    architecture_exteriors: 'Архитектурные фасады',
    landmarks: 'Достопримечательности',
    food: 'Еда',
    space: 'Космос',
    objects: 'Предметы',
  };

  // ── Init ────────────────────────────────────────────

  function init(puzzles) {
    _puzzles = puzzles;
    _categoryPuzzles = new Map();
    _buildSidebar();
    _bindModal();
    // Show first category by default
    const firstCat = _uniqueCategories()[0];
    if (firstCat) selectCategory(firstCat);
  }

  // ── Sidebar ─────────────────────────────────────────

  function _uniqueCategories() {
    return [...new Set(_puzzles.map(p => p.category))];
  }

  function _buildSidebar() {
    const nav = document.getElementById('sidebar-nav');
    nav.innerHTML = '';

    _uniqueCategories().forEach(cat => {
      const item = document.createElement('div');
      item.className = 'nav-item';
      item.dataset.category = cat;
      item.textContent = CATEGORY_LABELS[cat] || cat;
      item.addEventListener('click', () => selectCategory(cat));
      nav.appendChild(item);
    });

    // Divider + Мои пазлы
    const divider = document.createElement('div');
    divider.className = 'nav-divider';
    nav.appendChild(divider);

    const myItem = document.createElement('div');
    myItem.id = 'my-puzzles-item';
    myItem.className = 'nav-item';
    myItem.textContent = 'Мои пазлы';
    myItem.addEventListener('click', () => selectMyPuzzles());
    nav.appendChild(myItem);

    _refreshMyPuzzlesVisibility();
  }

  function _refreshMyPuzzlesVisibility() {
    const el = document.getElementById('my-puzzles-item');
    if (!el) return;
    const hasSaves = Storage.getAllSaves().length > 0;
    el.classList.toggle('visible', hasSaves);
  }

  function _setActiveNav(key) {
    document.querySelectorAll('.nav-item').forEach(el => {
      const isActive = (el.dataset.category === key) ||
                       (key === '__my' && el.id === 'my-puzzles-item');
      el.classList.toggle('active', isActive);
    });
  }

  // ── Category selection ───────────────────────────────

  function selectCategory(cat) {
    _currentCategory = cat;
    _setActiveNav(cat);
    document.getElementById('home-category-title').textContent =
      CATEGORY_LABELS[cat] || cat;
    const filtered = _getCategoryPuzzles(cat);
    _renderGrid(filtered);
  }

  function _getCategoryPuzzles(category) {
    if (_categoryPuzzles.has(category)) {
      return _categoryPuzzles.get(category);
    }

    const shuffled = _shufflePuzzles(_puzzles.filter(puzzle => puzzle.category === category));
    _categoryPuzzles.set(category, shuffled);
    return shuffled;
  }

  function _shufflePuzzles(puzzles) {
    const shuffled = [...puzzles];

    for (let index = shuffled.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }

    return shuffled;
  }

  function selectMyPuzzles() {
    _currentCategory = '__my';
    _setActiveNav('__my');
    document.getElementById('home-category-title').textContent = 'Мои пазлы';
    const saves = Storage.getAllSaves();
    const savedIds = new Set(saves.map(save => save.storagePuzzleId));
    const myPuzzles = _puzzles.filter(puzzle => savedIds.has(Storage.getPuzzleStorageId(puzzle)));
    _renderGrid(myPuzzles, true);
  }

  // ── Card Grid ────────────────────────────────────────

  function _renderGrid(puzzles, forMyPuzzles = false) {
    const grid = document.getElementById('card-grid');
    grid.innerHTML = '';

    if (puzzles.length === 0) {
      grid.innerHTML = '<p style="color:var(--color-text-secondary);grid-column:1/-1">Нет пазлов</p>';
      return;
    }

    puzzles.forEach(puzzle => {
      const card = _buildCard(puzzle, forMyPuzzles);
      grid.appendChild(card);
    });
  }

  function _preferredSaveForPuzzle(puzzle) {
    const storagePuzzleId = Storage.getPuzzleStorageId(puzzle);
    const saves = Storage.getAllSaves().filter(save => save.storagePuzzleId === storagePuzzleId);
    if (!saves.length) return null;

    const inProgress = saves.filter(save => !save.completed);
    const pool = inProgress.length ? inProgress : saves;

    return pool.reduce((best, candidate) => {
      const bestRatio = best.lockedCount / Math.max(best.pieceCount, 1);
      const candidateRatio = candidate.lockedCount / Math.max(candidate.pieceCount, 1);

      if (candidateRatio !== bestRatio) {
        return candidateRatio > bestRatio ? candidate : best;
      }

      if (candidate.lockedCount !== best.lockedCount) {
        return candidate.lockedCount > best.lockedCount ? candidate : best;
      }

      return candidate.pieceCount > best.pieceCount ? candidate : best;
    });
  }

  function _buildCard(puzzle, forMyPuzzles) {
    // Find best save for this puzzle (most recent / most progress)
    const bestSave = _preferredSaveForPuzzle(puzzle);

    const card = document.createElement('div');
    card.className = 'puzzle-card';
    card.addEventListener('click', () => openDifficultyModal(puzzle));

    const img = document.createElement('img');
    img.src = puzzle.thumbUrl;
    img.alt = puzzle.description || puzzle.title;
    img.loading = 'lazy';
    card.appendChild(img);

    if (bestSave) {
      if (bestSave.completed) {
        const star = document.createElement('div');
        star.className = 'star-badge';
        star.textContent = '⭐';
        card.appendChild(star);
      } else {
        const pct = Math.round((bestSave.lockedCount / bestSave.pieceCount) * 100);
        const star = document.createElement('div');
        star.className = 'star-badge';
        star.style.fontSize = '0.65rem';
        star.style.color = '#fff';
        star.textContent = `${pct}%`;
        card.appendChild(star);
      }
    }

    const body = document.createElement('div');
    body.className = 'puzzle-card-body';

    const title = document.createElement('div');
    title.className = 'puzzle-card-title';
    title.textContent = puzzle.description || puzzle.title;
    body.appendChild(title);

    if (bestSave && !bestSave.completed) {
      const pct = Math.round((bestSave.lockedCount / bestSave.pieceCount) * 100);
      const wrap = document.createElement('div');
      wrap.className = 'progress-bar-wrap';
      const fill = document.createElement('div');
      fill.className = 'progress-bar-fill';
      fill.style.width = pct + '%';
      wrap.appendChild(fill);
      body.appendChild(wrap);

      const lbl = document.createElement('div');
      lbl.className = 'progress-label';
      lbl.textContent = `${bestSave.lockedCount} / ${bestSave.pieceCount} фр.`;
      body.appendChild(lbl);
    }

    card.appendChild(body);
    return card;
  }

  // ── Difficulty Modal ─────────────────────────────────

  function openDifficultyModal(puzzle) {
    _modalPuzzle = puzzle;
    const preferredSave = _preferredSaveForPuzzle(puzzle);
    _selectedCount = preferredSave ? preferredSave.pieceCount : 24;

    document.getElementById('modal-preview-img').src = puzzle.thumbUrl;
    document.getElementById('modal-title').textContent = puzzle.description || puzzle.title;

    _updateModalButtons();

    document.getElementById('modal-overlay').classList.add('active');
  }

  function _updateModalButtons() {
    const counts = [24, 64, 100, 144];
    const btns = document.querySelectorAll('.piece-count-btn');

    btns.forEach(btn => {
      const count = parseInt(btn.dataset.count, 10);
      btn.classList.toggle('selected', count === _selectedCount);
    });

    // Show save info for selected count
    const save = Storage.loadState(_modalPuzzle, _selectedCount);
    const infoEl = document.getElementById('modal-save-info');
    const startBtn = document.getElementById('modal-start-btn');

    if (save) {
      if (save.completed) {
        infoEl.textContent = `Завершён за ${Storage.formatTime(save.elapsedSeconds)}`;
        startBtn.textContent = 'Начать заново';
      } else {
        infoEl.textContent = `Время: ${Storage.formatTime(save.elapsedSeconds)} · ${save.lockedCount} / ${save.pieceCount} фр.`;
        startBtn.textContent = 'Продолжить';
      }
    } else {
      infoEl.textContent = '';
      startBtn.textContent = 'Начать';
    }
  }

  function _bindModal() {
    document.getElementById('modal-close-btn').addEventListener('click', _closeModal);
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('modal-overlay')) _closeModal();
    });

    document.querySelectorAll('.piece-count-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _selectedCount = parseInt(btn.dataset.count, 10);
        _updateModalButtons();
      });
    });

    document.getElementById('modal-start-btn').addEventListener('click', () => {
      if (!_modalPuzzle) return;
      const puzzleId = _modalPuzzle.id;
      const count    = _selectedCount;
      const save = Storage.loadState(_modalPuzzle, count);
      const restart = Boolean(save && save.completed);
      _closeModal();
      App.showPuzzle(puzzleId, count, { restart });
    });
  }

  function _closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
    _modalPuzzle = null;
  }

  // Called after a save occurs so sidebar updates
  function refreshAfterSave() {
    _refreshMyPuzzlesVisibility();
    // If currently on My Puzzles, re-render it
    if (_currentCategory === '__my') selectMyPuzzles();
  }

  // Called when returning to home — re-render current view to pick up new save data
  function refreshCurrentView() {
    _refreshMyPuzzlesVisibility();
    if (_currentCategory === '__my') {
      selectMyPuzzles();
    } else if (_currentCategory) {
      selectCategory(_currentCategory);
    }
  }

  return { init, selectCategory, selectMyPuzzles, openDifficultyModal, refreshAfterSave, refreshCurrentView };
})();
