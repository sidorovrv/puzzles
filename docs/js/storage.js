/**
 * storage.js — localStorage + IndexedDB wrappers
 * All keys are prefixed with 'fp_' (family puzzles).
 */

const Storage = (() => {
  // ── localStorage helpers ─────────────────────────

  function lsGet(key, fallback = null) {
    try {
      const v = localStorage.getItem('fp_' + key);
      if (v === null) return fallback;
      return JSON.parse(v);
    } catch { return fallback; }
  }

  function lsSet(key, value) {
    try {
      localStorage.setItem('fp_' + key, JSON.stringify(value));
    } catch (e) {
      console.warn('localStorage write failed:', e);
    }
  }

  function lsDel(key) {
    localStorage.removeItem('fp_' + key);
  }

  // ── Profile helpers ──────────────────────────────

  function getProfile() {
    return lsGet('profile', null);
  }

  function saveProfile(profile) {
    lsSet('profile', profile);
  }

  function getCoins() {
    return lsGet('coins', 0);
  }

  function setCoins(n) {
    lsSet('coins', n);
  }

  function addCoins(n) {
    setCoins(getCoins() + n);
  }

  function getStreak() {
    return lsGet('streak', { count: 0, lastDate: null });
  }

  function setStreak(data) {
    lsSet('streak', data);
  }

  function getProgress(puzzleId, difficulty) {
    return lsGet(`prog_${puzzleId}_${difficulty}`, null);
  }

  function setProgress(puzzleId, difficulty, data) {
    lsSet(`prog_${puzzleId}_${difficulty}`, data);
  }

  function getAllProgress() {
    const result = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('fp_prog_')) {
        try { result.push(JSON.parse(localStorage.getItem(k))); } catch { /* skip */ }
      }
    }
    return result;
  }

  function getUnlocked() {
    return lsGet('unlocked', []);
  }

  function unlockPuzzle(puzzleId) {
    const list = getUnlocked();
    if (!list.includes(puzzleId)) {
      list.push(puzzleId);
      lsSet('unlocked', list);
    }
  }

  function isUnlocked(puzzleId, puzzle) {
    if (!puzzle.unlockCost || puzzle.unlockCost === 0) return true;
    return getUnlocked().includes(puzzleId);
  }

  // ── IndexedDB for large puzzle states ────────────

  let _db = null;

  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('family-puzzles', 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('puzzle-states')) {
          db.createObjectStore('puzzle-states', { keyPath: 'key' });
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function savePuzzleState(puzzleId, difficulty, state) {
    return openDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('puzzle-states', 'readwrite');
        tx.objectStore('puzzle-states').put({ key: `${puzzleId}_${difficulty}`, ...state });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    });
  }

  function loadPuzzleState(puzzleId, difficulty) {
    return openDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('puzzle-states', 'readonly');
        const req = tx.objectStore('puzzle-states').get(`${puzzleId}_${difficulty}`);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    });
  }

  function deletePuzzleState(puzzleId, difficulty) {
    return openDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('puzzle-states', 'readwrite');
        tx.objectStore('puzzle-states').delete(`${puzzleId}_${difficulty}`);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    });
  }

  // ── Export / Import ──────────────────────────────

  async function exportAll() {
    const progress = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('fp_')) {
        try { progress[k] = JSON.parse(localStorage.getItem(k)); } catch { /* skip */ }
      }
    }

    // Also include IndexedDB states
    const db = await openDB();
    const states = await new Promise((resolve, reject) => {
      const tx = db.transaction('puzzle-states', 'readonly');
      const req = tx.objectStore('puzzle-states').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    return { ls: progress, idb: states, exportedAt: Date.now() };
  }

  async function importAll(data) {
    if (!data || typeof data !== 'object') throw new Error('Неверный формат файла');

    // Restore localStorage
    if (data.ls) {
      for (const [k, v] of Object.entries(data.ls)) {
        if (k.startsWith('fp_')) {
          localStorage.setItem(k, JSON.stringify(v));
        }
      }
    }

    // Restore IndexedDB
    if (Array.isArray(data.idb) && data.idb.length > 0) {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('puzzle-states', 'readwrite');
        const store = tx.objectStore('puzzle-states');
        data.idb.forEach(item => store.put(item));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  return {
    lsGet, lsSet, lsDel,
    getProfile, saveProfile,
    getCoins, setCoins, addCoins,
    getStreak, setStreak,
    getProgress, setProgress, getAllProgress,
    getUnlocked, unlockPuzzle, isUnlocked,
    savePuzzleState, loadPuzzleState, deletePuzzleState,
    exportAll, importAll,
  };
})();
