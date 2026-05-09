/**
 * storage.js — localStorage helpers
 * Key pattern: save_<stablePuzzleId>_<pieceCount>
 */

'use strict';

const Storage = (() => {
  const SCHEMA_VERSION = 4;
  const SUPPORTED_SCHEMA_VERSIONS = new Set([3, 4]);
  const SAVE_KEY_PREFIX = 'save_';

  function _key(puzzleId, pieceCount) {
    return `save_${puzzleId}_${pieceCount}`;
  }

  function _extractPageId(value) {
    if (Number.isInteger(value) && value >= 0) {
      return String(value);
    }

    if (typeof value !== 'string') return '';

    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^\d+$/.test(trimmed)) return trimmed;

    const match = trimmed.match(/(?:^|_)(\d+)$/);
    return match ? match[1] : '';
  }

  function _hashString(value) {
    const input = String(value || '');
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36);
  }

  function _normalizeIdentityUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return '';

    try {
      const url = new URL(value, window.location.href);
      url.search = '';
      url.hash = '';
      return `${url.origin}${url.pathname}`;
    } catch (_) {
      return value.trim();
    }
  }

  function _buildStoragePuzzleId(rawPuzzleId, sourcePageId, sourcePageUrl, imageUrl) {
    const pageId = _extractPageId(sourcePageId) || _extractPageId(rawPuzzleId);
    if (pageId) {
      return `page_${pageId}`;
    }

    const normalizedSourceUrl = _normalizeIdentityUrl(sourcePageUrl);
    if (normalizedSourceUrl) {
      return `source_${_hashString(normalizedSourceUrl)}`;
    }

    const normalizedImageUrl = _normalizeIdentityUrl(imageUrl);
    if (normalizedImageUrl) {
      return `image_${_hashString(normalizedImageUrl)}`;
    }

    return rawPuzzleId || '';
  }

  function _getPuzzleIdentity(puzzleRef) {
    if (!puzzleRef) {
      return { puzzleId: '', storagePuzzleId: '', candidateIds: [] };
    }

    const rawPuzzleId = typeof puzzleRef === 'string'
      ? puzzleRef
      : (typeof puzzleRef.id === 'string'
        ? puzzleRef.id
        : (typeof puzzleRef.puzzleId === 'string' ? puzzleRef.puzzleId : ''));

    const explicitStoragePuzzleId = typeof puzzleRef === 'object' && typeof puzzleRef.storagePuzzleId === 'string'
      ? puzzleRef.storagePuzzleId.trim()
      : '';

    const sourcePageId = typeof puzzleRef === 'object' ? puzzleRef.sourcePageId : undefined;
    const sourcePageUrl = typeof puzzleRef === 'object' ? puzzleRef.sourcePageUrl : '';
    const imageUrl = typeof puzzleRef === 'object' ? puzzleRef.imageUrl : '';

    const storagePuzzleId = explicitStoragePuzzleId ||
      _buildStoragePuzzleId(rawPuzzleId, sourcePageId, sourcePageUrl, imageUrl);

    const candidateIds = new Set();
    if (storagePuzzleId) candidateIds.add(storagePuzzleId);
    const pageId = _extractPageId(sourcePageId) || _extractPageId(rawPuzzleId);
    if (pageId) candidateIds.add(`page_${pageId}`);
    if (rawPuzzleId) candidateIds.add(rawPuzzleId);

    return {
      puzzleId: rawPuzzleId || storagePuzzleId,
      storagePuzzleId: storagePuzzleId || rawPuzzleId,
      candidateIds: [...candidateIds],
    };
  }

  function _hasOverlappingIdentity(candidatesA, candidatesB) {
    if (!Array.isArray(candidatesA) || !Array.isArray(candidatesB)) return false;

    const setB = new Set(candidatesB.filter(Boolean));
    return candidatesA.some(candidate => Boolean(candidate) && setB.has(candidate));
  }

  function _toFiniteNumber(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
  }

  function _toNonNegativeInteger(value, fallback = 0) {
    return Number.isInteger(value) && value >= 0 ? value : fallback;
  }

  function _countLockedPieces(pieces) {
    return Array.isArray(pieces)
      ? pieces.filter(piece => piece && piece.locked).length
      : 0;
  }

  function _hasMeaningfulProgress(record) {
    if (!record || !Array.isArray(record.pieces)) return false;
    if (record.completed) return true;

    return record.pieces.some(piece =>
      piece && (piece.locked || piece.location === 'board')
    );
  }

  function _normalizePieceRecord(piece) {
    if (!piece || !Number.isInteger(piece.id) || piece.id < 0) return null;

    const locked = Boolean(piece.locked || piece.location === 'locked');
    if (locked) {
      return {
        id: piece.id,
        locked: true,
        location: 'locked',
      };
    }

    if (piece.location === 'board' && Number.isFinite(piece.x) && Number.isFinite(piece.y)) {
      return {
        id: piece.id,
        locked: false,
        location: 'board',
        x: piece.x,
        y: piece.y,
      };
    }

    return {
      id: piece.id,
      locked: false,
      location: 'tray',
      trayIndex: _toNonNegativeInteger(piece.trayIndex, piece.id),
    };
  }

  function _normalizeRecord(record, puzzleRef = null, expectedPieceCount = null) {
    if (!record || typeof record !== 'object') return null;

    const pieceCount = Number.isInteger(expectedPieceCount)
      ? expectedPieceCount
      : _toNonNegativeInteger(record.pieceCount, -1);
    if (pieceCount < 0 || _toNonNegativeInteger(record.pieceCount, -1) !== pieceCount) return null;

    if (!SUPPORTED_SCHEMA_VERSIONS.has(_toNonNegativeInteger(record.schemaVersion, -1))) {
      return null;
    }

    const expectedIdentity = puzzleRef ? _getPuzzleIdentity(puzzleRef) : null;
    const recordIdentity = _getPuzzleIdentity(record);
    if (expectedIdentity && !_hasOverlappingIdentity(expectedIdentity.candidateIds, recordIdentity.candidateIds)) {
      return null;
    }

    const normalizedPieces = [];
    const seenIds = new Set();
    if (Array.isArray(record.pieces)) {
      record.pieces.forEach(piece => {
        const normalized = _normalizePieceRecord(piece);
        if (!normalized || seenIds.has(normalized.id)) return;
        seenIds.add(normalized.id);
        normalizedPieces.push(normalized);
      });
    }

    const lockedCount = _countLockedPieces(normalizedPieces);
    const completed = Boolean(record.completed) ||
      (pieceCount > 0 && lockedCount === pieceCount);

    return {
      schemaVersion: SCHEMA_VERSION,
      puzzleId: (expectedIdentity && expectedIdentity.puzzleId) || recordIdentity.puzzleId,
      storagePuzzleId: (expectedIdentity && expectedIdentity.storagePuzzleId) || recordIdentity.storagePuzzleId,
      pieceCount,
      seed: _toFiniteNumber(record.seed),
      startedAt: _toNonNegativeInteger(record.startedAt),
      elapsedSeconds: _toNonNegativeInteger(record.elapsedSeconds),
      lockedCount,
      completed,
      pieces: normalizedPieces,
    };
  }

  function _iterSaveEntries(matcher) {
    const entries = [];

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(SAVE_KEY_PREFIX)) continue;

        const raw = localStorage.getItem(key);
        if (!raw) continue;

        try {
          const parsed = JSON.parse(raw);
          const record = matcher(parsed, key);
          if (record && _hasMeaningfulProgress(record)) {
            entries.push({ key, record });
          }
        } catch (_) {}
      }
    } catch (e) {
      console.warn('Storage._iterSaveEntries failed:', e);
    }

    return entries;
  }

  function _matchingSaveEntries(puzzleRef, pieceCount) {
    return _iterSaveEntries(parsed => _normalizeRecord(parsed, puzzleRef, pieceCount));
  }

  function _selectPreferredEntry(entries) {
    if (!Array.isArray(entries) || !entries.length) return null;

    return entries.reduce((best, candidate) => {
      if (!best) return candidate;

      if (candidate.record.lockedCount !== best.record.lockedCount) {
        return candidate.record.lockedCount > best.record.lockedCount ? candidate : best;
      }

      if (candidate.record.completed !== best.record.completed) {
        return candidate.record.completed ? candidate : best;
      }

      if (candidate.record.elapsedSeconds !== best.record.elapsedSeconds) {
        return candidate.record.elapsedSeconds > best.record.elapsedSeconds ? candidate : best;
      }

      return candidate;
    }, null);
  }

  function _removeSaveKeys(keys, keepKey = '') {
    const uniqueKeys = [...new Set((keys || []).filter(Boolean))];
    uniqueKeys.forEach(key => {
      if (key === keepKey) return;
      try {
        localStorage.removeItem(key);
      } catch (e) {
        console.warn('Storage.removeItem failed:', e);
      }
    });
  }

  /**
   * Save puzzle state.
   * @param {Object|string} puzzleRef
   * @param {number} pieceCount
   * @param {Object} state - { seed, startedAt, elapsedSeconds, lockedCount, completed, pieces }
   */
  function saveState(puzzleRef, pieceCount, state) {
    const identity = _getPuzzleIdentity(puzzleRef);
    const stableKey = _key(identity.storagePuzzleId, pieceCount);
    const pieces = Array.isArray(state.pieces)
      ? state.pieces.map(_normalizePieceRecord).filter(Boolean)
      : [];
    const lockedCount = _countLockedPieces(pieces);
    const record = {
      schemaVersion: SCHEMA_VERSION,
      puzzleId: identity.puzzleId,
      storagePuzzleId: identity.storagePuzzleId,
      pieceCount,
      seed: _toFiniteNumber(state.seed),
      startedAt: _toNonNegativeInteger(state.startedAt),
      elapsedSeconds: _toNonNegativeInteger(state.elapsedSeconds),
      lockedCount,
      completed: Boolean(state.completed) || (pieceCount > 0 && lockedCount === pieceCount),
      pieces,
    };

    try {
      const matchingEntries = _matchingSaveEntries(puzzleRef, pieceCount);

      if (!_hasMeaningfulProgress(record)) {
        _removeSaveKeys([stableKey, ...matchingEntries.map(entry => entry.key)]);
        return;
      }

      localStorage.setItem(stableKey, JSON.stringify(record));
      _removeSaveKeys(matchingEntries.map(entry => entry.key), stableKey);
    } catch (e) {
      console.warn('Storage.saveState failed:', e);
    }
  }

  /**
   * Load puzzle state.
   * @param {Object|string} puzzleRef
   * @param {number} pieceCount
   * @returns {Object|null}
   */
  function loadState(puzzleRef, pieceCount) {
    try {
      const identity = _getPuzzleIdentity(puzzleRef);
      const stableKey = _key(identity.storagePuzzleId, pieceCount);
      const matchingEntries = _matchingSaveEntries(puzzleRef, pieceCount);
      const preferredEntry = _selectPreferredEntry(matchingEntries);
      if (!preferredEntry) return null;

      const normalized = {
        ...preferredEntry.record,
        schemaVersion: SCHEMA_VERSION,
        puzzleId: identity.puzzleId || preferredEntry.record.puzzleId,
        storagePuzzleId: identity.storagePuzzleId || preferredEntry.record.storagePuzzleId,
      };

      localStorage.setItem(stableKey, JSON.stringify(normalized));
      _removeSaveKeys(matchingEntries.map(entry => entry.key), stableKey);
      return normalized;
    } catch (e) {
      console.warn('Storage.loadState failed:', e);
      return null;
    }
  }

  function clearState(puzzleRef, pieceCount) {
    try {
      const identity = _getPuzzleIdentity(puzzleRef);
      const matchingEntries = _matchingSaveEntries(puzzleRef, pieceCount);
      _removeSaveKeys([
        _key(identity.storagePuzzleId, pieceCount),
        ...matchingEntries.map(entry => entry.key),
      ]);
    } catch (e) {
      console.warn('Storage.clearState failed:', e);
    }
  }

  /**
   * Return all saves as an array.
   * @returns {Object[]}
   */
  function getAllSaves() {
    const deduped = new Map();
    const entries = _iterSaveEntries(parsed => _normalizeRecord(parsed));

    entries.forEach(entry => {
      const dedupeKey = `${entry.record.storagePuzzleId}_${entry.record.pieceCount}`;
      const existing = deduped.get(dedupeKey);
      const preferred = _selectPreferredEntry(existing ? [existing, entry] : [entry]);
      deduped.set(dedupeKey, preferred);
    });

    return [...deduped.values()].map(entry => entry.record);
  }

  function getPuzzleStorageId(puzzleRef) {
    return _getPuzzleIdentity(puzzleRef).storagePuzzleId;
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

  return { saveState, loadState, clearState, getAllSaves, getPuzzleStorageId, formatTime, SCHEMA_VERSION };
})();
