/**
 * storage.js — localStorage helpers
 * Key pattern: save_<puzzleId>_<pieceCount>
 */

'use strict';

const Storage = (() => {
  function _key(puzzleId, pieceCount) {
    return `save_${puzzleId}_${pieceCount}`;
  }

  /**
   * Save puzzle state.
   * @param {string} puzzleId
   * @param {number} pieceCount
   * @param {Object} state - { seed, startedAt, elapsedSeconds, lockedCount, completed, pieces }
   */
  function saveState(puzzleId, pieceCount, state) {
    const record = {
      puzzleId,
      pieceCount,
      seed: state.seed,
      startedAt: state.startedAt,
      elapsedSeconds: state.elapsedSeconds,
      lockedCount: state.lockedCount,
      completed: state.completed,
      pieces: state.pieces, // [{ id, x, y, locked }, ...]
    };
    try {
      localStorage.setItem(_key(puzzleId, pieceCount), JSON.stringify(record));
    } catch (e) {
      console.warn('Storage.saveState failed:', e);
    }
  }

  /**
   * Load puzzle state.
   * @param {string} puzzleId
   * @param {number} pieceCount
   * @returns {Object|null}
   */
  function loadState(puzzleId, pieceCount) {
    try {
      const raw = localStorage.getItem(_key(puzzleId, pieceCount));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('Storage.loadState failed:', e);
      return null;
    }
  }

  /**
   * Return all saves as an array.
   * @returns {Object[]}
   */
  function getAllSaves() {
    const saves = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('save_')) {
          const raw = localStorage.getItem(key);
          if (raw) {
            try { saves.push(JSON.parse(raw)); } catch (_) {}
          }
        }
      }
    } catch (e) {
      console.warn('Storage.getAllSaves failed:', e);
    }
    return saves;
  }

  /**
   * Format elapsed seconds as mm:ss.
   * @param {number} secs
   * @returns {string}
   */
  function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  return { saveState, loadState, getAllSaves, formatTime };
})();
