/**
 * home.js — Puzzle browser: categories, grid, progress badges, difficulty modal,
 * settings, install banner, gamification display.
 * All UI text in Russian.
 */

const DIFFICULTIES = [64, 100, 144, 225, 400];

const CATEGORIES = [
  { id: 'all',       label: 'Все пазлы',   icon: '🔷' },
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
  // Load puzzles
  const resp = await fetch('data/puzzles.json');
  _puzzles = await resp.json();

  renderFeatured();
  renderGrid('main-grid', _puzzles.slice(0, 12));
  renderCategoriesSidebar();
  renderCategoriesGrid('all');
  renderMyPuzzles();

  // Update coin display
  updateCoinDisplay();

  // Tab switching
  document.querySelectorAll('.bottom-nav__tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Difficulty modal
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-start').addEventListener('click', startPuzzle);
  document.getElementById('difficulty-row').addEventListener('click', e => {
    const btn = e.target.closest('.diff-btn');
    if (!btn) return;
    _selectedDiff = parseInt(btn.dataset.diff);
    updateDiffButtons();
  });

  // Settings
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('btn-export').addEventListener('click', doExport);
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file-input').click());
  document.getElementById('import-file-input').addEventListener('change', doImport);
  document.getElementById('btn-reset-pin').addEventListener('click', showResetPin);

  // Trophy (streak)
  document.getElementById('btn-trophy').addEventListener('click', showStreak);

  // Install banner
  showInstallBannerIfNeeded();
  document.getElementById('install-banner-close').addEventListener('click', () => {
    document.getElementById('install-banner').classList.add('hidden');
    Storage.lsSet('install_banner_dismissed', true);
  });

  // Settings username
  const profile = Storage.getProfile();
  if (profile) {
    document.getElementById('settings-username').textContent = `Вы вошли как: ${profile.name}`;
  }
}

// ── Coin display ──────────────────────────────────────────────────────────────

function updateCoinDisplay() {
  const el = document.getElementById('coin-count');
  if (el) el.textContent = Storage.getCoins().toLocaleString('ru-RU');
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function switchTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.bottom-nav__tab').forEach(b => b.classList.remove('active'));

  const panel = document.getElementById(`tab-${tabId}`);
  if (panel) panel.classList.remove('hidden');

  const btn = document.querySelector(`.bottom-nav__tab[data-tab="${tabId}"]`);
  if (btn) btn.classList.add('active');

  const titles = { main: 'Главная', categories: 'Категории', my: 'Мои пазлы' };
  document.getElementById('top-bar-title').textContent = titles[tabId] || '';
}

// ── Featured row ──────────────────────────────────────────────────────────────

function renderFeatured() {
  const row = document.getElementById('featured-row');
  if (!row) return;

  const daily = getDailyPuzzle();

  row.innerHTML = `
    <div class="featured-card featured-card--daily" data-puzzle-id="${daily.id}">
      <div class="featured-card__label">Пазл дня</div>
      <div class="featured-card__title">${formatDate()}</div>
      <img class="featured-card__thumb" src="${daily.thumb}" alt="${daily.title}" onerror="this.style.display='none'">
    </div>
    <div class="featured-card featured-card--collection">
      <div class="featured-card__label">Коллекция</div>
      <div class="featured-card__title">Природа</div>
    </div>
  `;

  row.querySelector('[data-puzzle-id]').addEventListener('click', () => openModal(daily));
}

function formatDate() {
  return new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function getDailyPuzzle() {
  const free = _puzzles.filter(p => p.unlockCost === 0);
  const dayIndex = Math.floor(Date.now() / 86400000) % free.length;
  return free[dayIndex];
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
  const unlocked = Storage.isUnlocked(p.id, p);
  const coins = Storage.getCoins();
  const canUnlock = !unlocked && coins >= p.unlockCost;

  let badge = '';
  if (pct !== null && pct < 100) badge = `<div class="puzzle-card__badge">${pct}%</div>`;
  if (pct === 100) badge = `<div class="puzzle-card__badge puzzle-card__badge--gold">⭐</div>`;

  let lock = '';
  if (!unlocked) {
    lock = `<div class="puzzle-card__lock">🔒</div>`;
  }

  return `
    <div class="puzzle-card" data-puzzle-id="${p.id}">
      <img src="${p.thumb}" alt="${p.title}" loading="lazy" onerror="this.style.display='none'">
      ${badge}
      ${lock}
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
      // update active state
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
  imgEl.style.display = '';
  imgEl.onerror = () => { imgEl.style.display = 'none'; };
  imgEl.src = puzzle.file;
  imgEl.alt = puzzle.title;
  document.getElementById('modal-puzzle-title').textContent = puzzle.title;

  renderDiffButtons();
  updateDiffButtons();
  updateModalReward();

  // Handle unlock requirement
  const unlocked = Storage.isUnlocked(puzzle.id, puzzle);
  const startBtn = document.getElementById('modal-start');
  if (!unlocked) {
    const coins = Storage.getCoins();
    if (coins >= puzzle.unlockCost) {
      startBtn.textContent = `Разблокировать за 🪙 ${puzzle.unlockCost.toLocaleString('ru-RU')}`;
      startBtn.disabled = false;
    } else {
      startBtn.textContent = `Нужно 🪙 ${puzzle.unlockCost.toLocaleString('ru-RU')}`;
      startBtn.disabled = true;
    }
  } else {
    startBtn.textContent = 'Начать';
    startBtn.disabled = false;
  }

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
  updateModalReward();
}

function updateModalReward() {
  if (!_activePuzzle) return;
  const reward = _activePuzzle.coinReward[String(_selectedDiff)] || 0;
  document.getElementById('modal-reward').textContent = reward.toLocaleString('ru-RU');
}

function startPuzzle() {
  if (!_activePuzzle) return;

  // Unlock if needed
  const unlocked = Storage.isUnlocked(_activePuzzle.id, _activePuzzle);
  if (!unlocked) {
    const coins = Storage.getCoins();
    if (coins >= _activePuzzle.unlockCost) {
      Storage.addCoins(-_activePuzzle.unlockCost);
      Storage.unlockPuzzle(_activePuzzle.id);
      updateCoinDisplay();
    } else {
      return; // button should be disabled, but guard anyway
    }
  }

  const id   = _activePuzzle.id;
  const diff = _selectedDiff;
  closeModal();
  const url = `puzzle.html?id=${id}&diff=${diff}`;
  window.location.href = url;
}

// ── Settings ──────────────────────────────────────────────────────────────────

function openSettings() {
  document.getElementById('settings-modal').classList.remove('hidden');
}
function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
}

async function doExport() {
  try {
    const data = await Storage.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `puzzles-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Ошибка экспорта: ' + e.message);
  }
}

async function doImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await Storage.importAll(data);
    alert('Прогресс успешно восстановлен! Перезагрузите приложение.');
    location.reload();
  } catch (err) {
    alert('Ошибка импорта: ' + err.message);
  }
  e.target.value = '';
}

function showResetPin() {
  closeSettings();
  Auth.deauthenticate();
  // Redirect to PIN screen in "change PIN" mode — for simplicity, force re-setup
  Storage.lsDel('profile');
  window.location.href = 'index.html';
}

function showStreak() {
  const streak = Storage.getStreak();
  const msg = streak.count > 0
    ? `Текущая серия: ${streak.count} ${dayWord(streak.count)} подряд! 🔥`
    : 'У вас пока нет серии. Сыграйте сегодня!';
  alert(msg);
}

function dayWord(n) {
  if (n % 10 === 1 && n % 100 !== 11) return 'день';
  if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return 'дня';
  return 'дней';
}

// ── Install banner ────────────────────────────────────────────────────────────

function showInstallBannerIfNeeded() {
  const dismissed = Storage.lsGet('install_banner_dismissed', false);
  const isStandalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;

  if (!isStandalone && !dismissed) {
    document.getElementById('install-banner').classList.remove('hidden');
  }
}
