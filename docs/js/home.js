/**
 * home.js — Puzzle browser: categories, grid, progress badges, difficulty modal.
 */

const DIFFICULTIES = [64, 100, 144, 225, 400];

const CATEGORIES = [
  { id: 'all',       label: 'Все',         icon: '🔷' },
  { id: 'nature',    label: 'Природа',     icon: '🌿' },
  { id: 'animals',   label: 'Животные',    icon: '🐾' },
  { id: 'landmarks', label: 'Архитектура', icon: '🗼' },
  { id: 'food',      label: 'Еда',         icon: '🍕' },
  { id: 'objects',   label: 'Предметы',    icon: '📷' },
  { id: 'art',       label: 'Живопись',    icon: '🖼️' },
];

let _puzzles = [];
let _selectedDiff = 144;
let _activePuzzle = null;
let _activeCategory = 'all';

async function initHome() {
  const resp = await fetch('data/puzzles.json');
  _puzzles = await resp.json();

  renderCategoriesSidebar();
  renderCategoriesGrid('all');
  renderMyPuzzles();

  document.querySelectorAll('.bottom-nav__tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-start').addEventListener('click', startPuzzle);
  document.getElementById('difficulty-row').addEventListener('click', e => {
    const btn = e.target.closest('.diff-btn');
    if (!btn) return;
    _selectedDiff = parseInt(btn.dataset.diff);
    updateDiffButtons();
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function switchTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.bottom-nav__tab').forEach(b => b.classList.remove('active'));

  const panel = document.getElementById(`tab-${tabId}`);
  if (panel) panel.classList.remove('hidden');

  const btn = document.querySelector(`.bottom-nav__tab[data-tab="${tabId}"]`);
  if (btn) btn.classList.add('active');

  if (tabId === 'my') renderMyPuzzles();
}

// ── Grid rendering ────────────────────────────────────────────────────────────

function renderGrid(containerId, puzzleList) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = puzzleList.map(p => puzzleCardHTML(p)).join('');
  el.querySelectorAll('.puzzle-card').forEach(card => {
    card.addEventListener('click', () => {
      const p = _puzzles.find(x => x.id === card.dataset.puzzleId);
      if (p) openModal(p);
    });
  });
}

function puzzleCardHTML(p) {
  const prog = Storage.getProgress(p.id, _selectedDiff);
  const pct  = prog ? Math.round((prog.lockedCount / prog.totalPieces) * 100) : null;

  let badge = '';
  if (pct !== null && pct < 100) badge = `<div class="puzzle-card__badge">${pct}%</div>`;
  if (pct === 100) badge = `<div class="puzzle-card__badge puzzle-card__badge--gold">⭐</div>`;

  return `
    <div class="puzzle-card" data-puzzle-id="${p.id}">
      ${p.thumb ? `<img src="${p.thumb}" alt="${p.title}" loading="lazy" onerror="this.style.display='none'">` : ''}
      ${badge}
    </div>
  `;
}

// ── Categories ────────────────────────────────────────────────────────────────

function renderCategoriesSidebar() {
  const sidebar = document.getElementById('categories-sidebar');
  if (!sidebar) return;
  sidebar.innerHTML = CATEGORIES.map(c => `
    <button class="category-item${c.id === _activeCategory ? ' active' : ''}" data-cat="${c.id}">
      <span class="category-item__icon">${c.icon}</span>
      <span>${c.label}</span>
    </button>
  `).join('');

  sidebar.querySelectorAll('.category-item').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeCategory = btn.dataset.cat;
      sidebar.querySelectorAll('.category-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCategoriesGrid(_activeCategory);
    });
  });
}

function renderCategoriesGrid(category) {
  const filtered = category === 'all' ? _puzzles : _puzzles.filter(p => p.category === category);
  renderGrid('categories-grid', filtered);
}

// ── My Puzzles ────────────────────────────────────────────────────────────────

function renderMyPuzzles() {
  const allProgress = Storage.getAllProgress();
  const startedIds = new Set(allProgress.map(s => s.puzzleId));
  const started = _puzzles.filter(p => startedIds.has(p.id));

  const empty = document.getElementById('my-empty');
  if (started.length === 0) {
    if (empty) empty.classList.remove('hidden');
    renderGrid('my-grid', []);
  } else {
    if (empty) empty.classList.add('hidden');
    renderGrid('my-grid', started);
  }
}

// ── Difficulty modal ──────────────────────────────────────────────────────────

function openModal(puzzle) {
  _activePuzzle = puzzle;
  _selectedDiff = 144;

  const imgEl = document.getElementById('modal-img');
  if (puzzle.file) {
    imgEl.style.display = '';
    imgEl.onerror = () => { imgEl.style.display = 'none'; };
    imgEl.src = puzzle.file;
    imgEl.alt = puzzle.title;
  } else {
    imgEl.style.display = 'none';
    imgEl.src = '';
  }
  document.getElementById('modal-puzzle-title').textContent = puzzle.title;

  renderDiffButtons();
  updateDiffButtons();
  document.getElementById('difficulty-modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('difficulty-modal').classList.add('hidden');
  _activePuzzle = null;
}

function renderDiffButtons() {
  const row = document.getElementById('difficulty-row');
  row.innerHTML = DIFFICULTIES.map(d => `
    <button class="diff-btn${d === _selectedDiff ? ' active' : ''}" data-diff="${d}">
      ${d}<span>шт.</span>
    </button>
  `).join('');
}

function updateDiffButtons() {
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.diff) === _selectedDiff);
  });
}

function startPuzzle() {
  const puzzle = _activePuzzle;
  if (!puzzle) return;
  _activePuzzle = null;
  const diff = _selectedDiff;
  closeModal();
  window.location.href = `puzzle.html?id=${puzzle.id}&diff=${diff}`;
}
