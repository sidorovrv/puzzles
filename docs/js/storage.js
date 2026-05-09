/**
 * storage.js — localStorage + IndexedDB wrappers
 */

const Storage = (() => {
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

  return {
    getProgress, setProgress, getAllProgress,
    savePuzzleState, loadPuzzleState, deletePuzzleState,
  };
})();
