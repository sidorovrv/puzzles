/**
 * puzzle-render.js — Canvas rendering, drag/drop, snap, confetti, hint
 */

'use strict';

const PuzzleRender = (() => {
  // ── State ────────────────────────────────────────────
  let _puzzle      = null;
  let _puzzleId    = null;
  let _storagePuzzleId = null;
  let _pieceCount  = null;
  let _pieces      = [];
  let _pieceCanvases = []; // offscreen canvas per piece (index = piece.id)
  let _img         = null;
  let _cols        = 0;
  let _rows        = 0;
  let _cellW       = 0;
  let _cellH       = 0;
  let _seed        = 0;
  let _startedAt   = 0;
  let _elapsedSeconds = 0;
  let _timerInterval  = null;

  // Snap radius (px, in assembled-canvas coordinate space)
  const SNAP_RADIUS = 28;
  const TRAY_GESTURE_THRESHOLD = 10;
  const TRAY_ITEM_GAP = 12;
  const TOUCH_LISTENER_OPTIONS = (() => {
    let supportsPassive = false;

    try {
      const options = {};
      Object.defineProperty(options, 'passive', {
        get() {
          supportsPassive = true;
          return false;
        },
      });
      window.addEventListener('test-passive', null, options);
      window.removeEventListener('test-passive', null, options);
    } catch (err) {
      supportsPassive = false;
    }

    return supportsPassive ? { passive: false } : false;
  })();

  // Canvas elements
  let _assembledCanvas = null;
  let _floatCanvas     = null;
  let _dragCanvas      = null;
  let _assembledCtx    = null;
  let _floatCtx        = null;
  let _dragCtx         = null;
  let _canvasW         = 0;
  let _canvasH         = 0;
  let _dragCanvasW     = 0;
  let _dragCanvasH     = 0;
  let _boardBounds     = null;
  let _puzzleViewRect  = null;
  let _canvasRect      = null;
  let _trayRect        = null;
  let _dragOffsetX     = 0;
  let _dragOffsetY     = 0;
  let _pixelRatio      = 1;
  let _squareImageCrop = null;
  let _hintImageSrc    = '';

  // Drag state
  let _dragging  = null; // { piece, startX, startY, offsetX, offsetY, fromTray }
  let _trayGesture = null;
  let _trayPageIndex = 0;
  let _trayPageCount = 0;
  let _activeTouchId = null;
  let _rafId     = null;
  let _resizeRafId = null;

  // ── Public: start ────────────────────────────────────
  /**
   * @param {Object} puzzle
   * @param {number} pieceCount
   * @param {HTMLImageElement} img
   * @param {Object|null} savedState
   */
  function start(puzzle, pieceCount, img, savedState) {
    _puzzle = puzzle;
    _puzzleId = puzzle && typeof puzzle.id === 'string' ? puzzle.id : '';
    _storagePuzzleId = Storage.getPuzzleStorageId(puzzle || _puzzleId);
    _pieceCount = pieceCount;
    _img = img;

    const naturalWidth = img.naturalWidth || img.width || 1;
    const naturalHeight = img.naturalHeight || img.height || 1;
    const sourceSize = Math.max(1, Math.min(naturalWidth, naturalHeight));
    const sourceX = Math.max(0, (naturalWidth - sourceSize) / 2);
    const sourceY = Math.max(0, (naturalHeight - sourceSize) / 2);
    _squareImageCrop = { x: sourceX, y: sourceY, size: sourceSize };
    _hintImageSrc = '';
    const { cols, rows } = PuzzleEngine.gridDims(pieceCount, 1);
    _cols = cols;
    _rows = rows;

    _setupCanvases();

    // Compute cell size in displayed pixels (fit image into canvas)
    const stagePadding = Math.max(24, Math.min(56, Math.min(_canvasW, _canvasH) * 0.05));
    const availableW = Math.max(_canvasW - stagePadding * 2, 160);
    const availableH = Math.max(_canvasH - stagePadding * 2, 160);
    const ratio = Math.min(availableW / sourceSize, availableH / sourceSize);
    const imgW = sourceSize * ratio;
    const imgH = sourceSize * ratio;
    _cellW = imgW / cols;
    _cellH = imgH / rows;
    const sourceCellW = sourceSize / cols;
    const sourceCellH = sourceSize / rows;

    // Seed & PRNG
    _seed = Number.isFinite(savedState && savedState.seed)
      ? savedState.seed
      : PuzzleEngine.hashSeed(_storagePuzzleId || _puzzleId, pieceCount);
    const rng = PuzzleEngine.mulberry32(_seed);

    // Generate pieces
    _pieces = PuzzleEngine.generatePieces(cols, rows, rng, _cellW, _cellH, sourceCellW, sourceCellH);

    // Correct positions are centered on the canvas
    const offsetX = (_canvasW - imgW) / 2;
    const offsetY = (_canvasH - imgH) / 2;
    _boardBounds = {
      x: offsetX,
      y: offsetY,
      width: imgW,
      height: imgH,
    };

    _pieces.forEach(p => {
      p.correctX += offsetX;
      p.correctY += offsetY;
    });

    // Build piece image canvases
    _pieceCanvases = _pieces.map(p =>
      PuzzleEngine.clipPieceImage(img, p, _cellW, _cellH, {
        sourceX,
        sourceY,
        sourceWidth: sourceSize,
        sourceHeight: sourceSize,
        displayWidth: imgW,
        displayHeight: imgH,
        dpr: _pixelRatio,
      })
    );

    _pieces.forEach((piece, index) => {
      piece.locked = false;
      piece.location = 'tray';
      piece.trayIndex = index;
      piece.currentX = piece.correctX;
      piece.currentY = piece.correctY;
    });

    if (savedState) {
      _restoreState(savedState);
      _startedAt      = savedState.startedAt;
      _elapsedSeconds = savedState.elapsedSeconds;
    } else {
      PuzzleEngine.scatterPieces(_pieces, rng);
      _startedAt      = Math.floor(Date.now() / 1000);
      _elapsedSeconds = 0;
    }

    _rebuildAssembledCanvas();
    _populateTray();
    _bindEvents();
    _startTimer();
    _tick();
  }

  // ── Canvas setup ─────────────────────────────────────
  function _setupCanvases() {
    _assembledCanvas = document.getElementById('assembled-canvas');
    _floatCanvas     = document.getElementById('float-canvas');
    _dragCanvas      = document.getElementById('drag-canvas');
    const area       = document.getElementById('canvas-area');
    const puzzleView = document.getElementById('puzzle-view');

    const w = area.clientWidth;
    const h = area.clientHeight;
    _canvasW = w;
    _canvasH = h;
    _pixelRatio = _getPixelRatio();

    _assembledCtx = _resizeCanvas(_assembledCanvas, w, h);
    _floatCtx = _resizeCanvas(_floatCanvas, w, h);

    if (_dragCanvas && puzzleView) {
      _dragCanvasW = puzzleView.clientWidth;
      _dragCanvasH = puzzleView.clientHeight;
      _dragCtx = _resizeCanvas(_dragCanvas, _dragCanvasW, _dragCanvasH);
    } else {
      _dragCanvasW = 0;
      _dragCanvasH = 0;
      _dragCtx = null;
    }

    _refreshLayoutRects();
  }

  function _refreshLayoutRects() {
    const puzzleView = document.getElementById('puzzle-view');
    const tray = document.getElementById('piece-tray');

    _puzzleViewRect = puzzleView ? puzzleView.getBoundingClientRect() : null;
    _canvasRect = _floatCanvas ? _floatCanvas.getBoundingClientRect() : null;
    _trayRect = tray ? tray.getBoundingClientRect() : null;

    if (_puzzleViewRect && _canvasRect) {
      _dragOffsetX = _canvasRect.left - _puzzleViewRect.left;
      _dragOffsetY = _canvasRect.top - _puzzleViewRect.top;
    } else {
      _dragOffsetX = 0;
      _dragOffsetY = 0;
    }
  }

  function _getPixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  }

  function _resizeCanvas(canvas, cssWidth, cssHeight) {
    if (!canvas) return null;

    canvas.width = Math.max(1, Math.round(cssWidth * _pixelRatio));
    canvas.height = Math.max(1, Math.round(cssHeight * _pixelRatio));
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';

    const ctx = canvas.getContext('2d');
    ctx.setTransform(_pixelRatio, 0, 0, _pixelRatio, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return ctx;
  }

  function _clearDragLayer() {
    if (_dragCtx) {
      _dragCtx.clearRect(0, 0, _dragCanvasW, _dragCanvasH);
    }
  }

  function _clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function _getTrayElements() {
    return {
      tray: document.getElementById('piece-tray'),
      viewport: document.getElementById('piece-tray-viewport'),
      track: document.getElementById('piece-tray-track'),
      prevBtn: document.getElementById('piece-tray-prev'),
      nextBtn: document.getElementById('piece-tray-next'),
    };
  }

  function _buildTrayEntries(unlocked, maxPageWidth, displaySize) {
    const safeWidth = Math.max(maxPageWidth, 1);

    return unlocked.reduce((entries, piece) => {
      const pc = _pieceCanvases[piece.id];
      if (!pc) return entries;

      const baseScale = displaySize / Math.max(piece.canvasW, piece.canvasH);
      const widthScale = safeWidth / Math.max(piece.canvasW, 1);
      const scale = Math.min(baseScale, widthScale);

      entries.push({
        piece,
        pc,
        scale,
        trayWidth: Math.max(1, Math.round(piece.canvasW * scale)),
        trayHeight: Math.max(1, Math.round(piece.canvasH * scale)),
      });
      return entries;
    }, []);
  }

  function _buildTrayPages(entries, maxPageWidth) {
    if (!entries.length) {
      return [{ start: 0, end: 0 }];
    }

    const safeWidth = Math.max(maxPageWidth, 1);
    const pages = [];
    let start = 0;
    let used = 0;

    entries.forEach((entry, index) => {
      const nextUsed = used === 0
        ? entry.trayWidth
        : used + TRAY_ITEM_GAP + entry.trayWidth;

      if (used !== 0 && nextUsed > safeWidth) {
        pages.push({ start, end: index });
        start = index;
        used = entry.trayWidth;
        return;
      }

      used = nextUsed;
    });

    pages.push({ start, end: entries.length });
    return pages;
  }

  function _findTrayPageIndexForPiece(pages, entries, pieceId) {
    if (pieceId == null) return -1;

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      for (let index = page.start; index < page.end; index++) {
        if (entries[index].piece.id === pieceId) {
          return pageIndex;
        }
      }
    }

    return -1;
  }

  function _syncTrayPager(pageCount) {
    const { prevBtn, nextBtn } = _getTrayElements();
    if (prevBtn) {
      prevBtn.disabled = pageCount <= 1 || _trayPageIndex <= 0;
    }
    if (nextBtn) {
      nextBtn.disabled = pageCount <= 1 || _trayPageIndex >= pageCount - 1;
    }
  }

  function _changeTrayPage(delta) {
    if (_trayPageCount <= 1) return;

    const nextPageIndex = _clamp(_trayPageIndex + delta, 0, _trayPageCount - 1);
    if (nextPageIndex === _trayPageIndex) return;

    _trayPageIndex = nextPageIndex;
    _populateTray();
  }

  function _showPreviousTrayPage() {
    _changeTrayPage(-1);
  }

  function _showNextTrayPage() {
    _changeTrayPage(1);
  }

  function _renderTrayEntry(track, entry) {
    const trayCanvas = document.createElement('canvas');
    trayCanvas.className = 'tray-piece';
    trayCanvas.dataset.pieceId = entry.piece.id;

    const tc = _resizeCanvas(trayCanvas, entry.trayWidth, entry.trayHeight);
    tc.drawImage(
      entry.pc,
      0,
      0,
      entry.pc.width,
      entry.pc.height,
      0,
      0,
      entry.trayWidth,
      entry.trayHeight
    );

    trayCanvas._pieceScale = entry.scale;
    track.appendChild(trayCanvas);
  }

  function _getPieceBounds(piece, currentX = piece.currentX, currentY = piece.currentY) {
    const left = currentX - piece.ox;
    const top = currentY - piece.oy;

    return {
      left,
      top,
      right: left + piece.canvasW,
      bottom: top + piece.canvasH,
      width: piece.canvasW,
      height: piece.canvasH,
    };
  }

  function _constrainPieceToPlayArea(piece, targetX, targetY, { allowBottomOverflow = false } = {}) {
    const minX = piece.ox;
    const maxX = Math.max(minX, _canvasW - (piece.canvasW - piece.ox));
    const minY = piece.oy;
    const maxY = Math.max(minY, _canvasH - (piece.canvasH - piece.oy));

    return {
      x: _clamp(targetX, minX, maxX),
      y: allowBottomOverflow ? Math.max(targetY, minY) : _clamp(targetY, minY, maxY),
    };
  }

  function _drawPieceCanvas(ctx, piece, x, y, width = piece.canvasW, height = piece.canvasH) {
    const pc = _pieceCanvases[piece.id];
    if (!pc || !ctx) return;

    ctx.drawImage(
      pc,
      0,
      0,
      pc.width,
      pc.height,
      Math.round(x),
      Math.round(y),
      width,
      height
    );
  }

  function _getSquareHintSrc() {
    if (_hintImageSrc) return _hintImageSrc;
    if (!_img || !_squareImageCrop) return _img ? _img.src : '';

    const hintSize = Math.max(
      1,
      Math.round(
        Math.min(
          _squareImageCrop.size,
          Math.max(_canvasW, _canvasH) * _pixelRatio,
          1600
        )
      )
    );
    const canvas = document.createElement('canvas');
    canvas.width = hintSize;
    canvas.height = hintSize;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      _img,
      _squareImageCrop.x,
      _squareImageCrop.y,
      _squareImageCrop.size,
      _squareImageCrop.size,
      0,
      0,
      hintSize,
      hintSize
    );

    _hintImageSrc = canvas.toDataURL();
    return _hintImageSrc;
  }

  function _pointInRect(clientX, clientY, rect) {
    if (!rect) return false;

    return clientX >= rect.left && clientX <= rect.right &&
      clientY >= rect.top && clientY <= rect.bottom;
  }

  function _returnPieceToTray(piece, preferredIndex = null) {
    const trayPieces = _trayPieces()
      .filter(candidate => candidate.id !== piece.id)
      .sort((a, b) => a.trayIndex - b.trayIndex);
    const insertAt = Number.isInteger(preferredIndex)
      ? Math.max(0, Math.min(preferredIndex, trayPieces.length))
      : trayPieces.length;

    trayPieces.forEach(candidate => {
      if (candidate.trayIndex >= insertAt) {
        candidate.trayIndex += 1;
      }
    });

    piece.location = 'tray';
    piece.trayIndex = insertAt;
    piece.currentX = piece.correctX;
    piece.currentY = piece.correctY;

    _normalizeTrayIndices();
    _populateTray({ focusPieceId: piece.id });
  }

  // ── Restore saved state ──────────────────────────────
  function _restoreState(state) {
    state.pieces.forEach(saved => {
      const p = _pieces[saved.id];
      if (!p) return;
      if (saved.locked || saved.location === 'locked') {
        p.currentX = p.correctX;
        p.currentY = p.correctY;
        p.locked = true;
        p.location = 'locked';
        p.trayIndex = -1;
        return;
      }

      p.locked = false;
      if (saved.location === 'board' && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        p.location = 'board';
        p.currentX = saved.x;
        p.currentY = saved.y;
        p.trayIndex = -1;
        return;
      }

      p.location = 'tray';
      p.trayIndex = Number.isInteger(saved.trayIndex) && saved.trayIndex >= 0
        ? saved.trayIndex
        : p.trayIndex;
    });

    _normalizeTrayIndices();
  }

  function _trayPieces() {
    return _pieces.filter(piece => piece.location === 'tray');
  }

  function _boardPieces() {
    return _pieces.filter(piece => piece.location === 'board');
  }

  function _normalizeTrayIndices() {
    _trayPieces()
      .sort((a, b) => a.trayIndex - b.trayIndex)
      .forEach((piece, index) => {
        piece.trayIndex = index;
      });
  }

  function _captureState(completed = false) {
    return {
      seed: _seed,
      startedAt: _startedAt,
      elapsedSeconds: _elapsedSeconds,
      lockedCount: _pieces.filter(piece => piece.locked).length,
      completed,
      pieces: _pieces.map(piece => ({
        id: piece.id,
        locked: piece.locked,
        location: piece.location,
        trayIndex: piece.location === 'tray' ? piece.trayIndex : undefined,
        x: piece.location === 'board' ? piece.currentX : undefined,
        y: piece.location === 'board' ? piece.currentY : undefined,
      })),
    };
  }

  function _scaleStateForCanvas(state, prevCanvasW, prevCanvasH, nextCanvasW, nextCanvasH) {
    if (!prevCanvasW || !prevCanvasH || !nextCanvasW || !nextCanvasH) return state;

    const scaleX = nextCanvasW / prevCanvasW;
    const scaleY = nextCanvasH / prevCanvasH;

    return {
      ...state,
      pieces: state.pieces.map(piece => {
        if (piece.location !== 'board' || !Number.isFinite(piece.x) || !Number.isFinite(piece.y)) {
          return piece;
        }

        return {
          ...piece,
          x: piece.x * scaleX,
          y: piece.y * scaleY,
        };
      }),
    };
  }

  function _restartWithState(state) {
    const puzzle = _puzzle;
    const pieceCount = _pieceCount;
    const img = _img;
    const completed = state.completed;

    stop();
    start(puzzle, pieceCount, img, state);
    _autoSave(completed);
  }

  // ── Assembled canvas rebuild ─────────────────────────
  function _rebuildAssembledCanvas() {
    _assembledCtx.clearRect(0, 0, _canvasW, _canvasH);
    _drawBoardGuide();
    _pieces.filter(p => p.locked).forEach(p => _drawLockedPiece(p));
  }

  function _drawBoardGuide() {
    if (!_assembledCtx || !_boardBounds) return;

    const { x, y, width, height } = _boardBounds;

    _assembledCtx.save();
    _assembledCtx.fillStyle = '#eceff2';
    _assembledCtx.fillRect(x, y, width, height);
    _assembledCtx.restore();
  }

  function _traceRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function _drawLockedPiece(piece) {
    _drawPieceCanvas(
      _assembledCtx,
      piece,
      piece.correctX - piece.ox,
      piece.correctY - piece.oy
    );
  }

  // ── Piece tray ───────────────────────────────────────
  function _populateTray(options = {}) {
    const { focusPieceId = null } = options;
    const { tray, viewport, track } = _getTrayElements();
    if (!tray || !viewport || !track) return;

    track.innerHTML = '';

    const trayH = viewport.clientHeight || tray.clientHeight || 120;
    const displaySize = Math.min(Math.max(trayH - 8, 48), 90);
    const maxPageWidth = Math.max(viewport.clientWidth - 2, 120);

    // Sort unlocked pieces by trayIndex
    const unlocked = _trayPieces()
      .sort((a, b) => a.trayIndex - b.trayIndex);

    const entries = _buildTrayEntries(unlocked, maxPageWidth, displaySize);
    const pages = _buildTrayPages(entries, maxPageWidth);

    _trayPageCount = pages.length;

    if (focusPieceId != null) {
      const pageIndex = _findTrayPageIndexForPiece(pages, entries, focusPieceId);
      if (pageIndex !== -1) {
        _trayPageIndex = pageIndex;
      }
    }

    _trayPageIndex = _clamp(_trayPageIndex, 0, Math.max(_trayPageCount - 1, 0));

    const currentPage = pages[_trayPageIndex] || pages[0];
    for (let index = currentPage.start; index < currentPage.end; index++) {
      _renderTrayEntry(track, entries[index]);
    }

    _syncTrayPager(_trayPageCount);
    _trayRect = tray.getBoundingClientRect();
  }

  // ── Timer ────────────────────────────────────────────
  function _startTimer() {
    if (_timerInterval) clearInterval(_timerInterval);
    _timerInterval = setInterval(() => { _elapsedSeconds++; }, 1000);
  }

  function _closestByClass(target, className, root) {
    let element = target;

    while (element && element !== root) {
      if (element.nodeType === 1 && element.classList && element.classList.contains(className)) {
        return element;
      }

      element = element.parentNode;
    }

    if (element && element.nodeType === 1 && element.classList && element.classList.contains(className)) {
      return element;
    }

    return null;
  }

  function _normalizeLegacyInput(event, inputType, inputId, clientX, clientY, target) {
    return {
      target: target || event.target,
      clientX,
      clientY,
      inputId,
      inputType,
      preventDefault() {
        event.preventDefault();
      },
    };
  }

  function _findTouchById(touchList, identifier) {
    if (!touchList) return null;

    for (let index = 0; index < touchList.length; index++) {
      if (touchList[index].identifier === identifier) {
        return touchList[index];
      }
    }

    return null;
  }

  function _beginTrayGesture(piece, rect, inputId, clientX, clientY) {
    _trayGesture = {
      piece,
      originTrayIndex: piece.trayIndex,
      inputId,
      rect,
      startClientX: clientX,
      startClientY: clientY,
    };
  }

  function _startCanvasDragAt(clientX, clientY) {
    _refreshLayoutRects();
    const canvasRect = _canvasRect || _floatCanvas.getBoundingClientRect();
    const mx = clientX - canvasRect.left;
    const my = clientY - canvasRect.top;

    const hit = _findPieceAt(mx, my);
    if (!hit) return false;

    _dragging = {
      piece: hit,
      fromTray: false,
      originTrayIndex: null,
      offsetX: mx - hit.currentX,
      offsetY: my - hit.currentY,
    };

    return true;
  }

  function _updateDraggingPosition(clientX, clientY) {
    if (!_dragging) return;

    const canvasRect = _canvasRect || _floatCanvas.getBoundingClientRect();
    const mx = clientX - canvasRect.left;
    const my = clientY - canvasRect.top;
    const nextPosition = _constrainPieceToPlayArea(
      _dragging.piece,
      mx - _dragging.offsetX,
      my - _dragging.offsetY,
      { allowBottomOverflow: _dragging.fromTray }
    );
    _dragging.piece.currentX = nextPosition.x;
    _dragging.piece.currentY = nextPosition.y;
  }

  function _finishDragging(clientX, clientY) {
    if (!_dragging) return;

    _refreshLayoutRects();

    const piece = _dragging.piece;
    const fromTray = _dragging.fromTray;
    const originTrayIndex = _dragging.originTrayIndex;
    _dragging = null;

    if (_pointInRect(clientX, clientY, _trayRect)) {
      _returnPieceToTray(piece, fromTray ? originTrayIndex : _trayPieces().length);
      _autoSave(_pieces.every(candidate => candidate.locked));
      Home.refreshAfterSave();
      return;
    }

    const pieceBounds = _getPieceBounds(piece);
    if (fromTray && pieceBounds.bottom > _canvasH) {
      _returnPieceToTray(piece, originTrayIndex);
      _autoSave(_pieces.every(candidate => candidate.locked));
      Home.refreshAfterSave();
      return;
    }

    const dx = piece.currentX - piece.correctX;
    const dy = piece.currentY - piece.correctY;
    if (Math.sqrt(dx * dx + dy * dy) < SNAP_RADIUS) {
      _snapPiece(piece);
    } else {
      _autoSave(_pieces.every(candidate => candidate.locked));
      Home.refreshAfterSave();
    }
  }

  function _onCanvasTouchStart(event) {
    if (_activeTouchId !== null) return;

    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch) return;

    if (!_startCanvasDragAt(touch.clientX, touch.clientY)) {
      return;
    }

    event.preventDefault();
    _activeTouchId = touch.identifier;
  }

  function _onTrayTouchStart(event) {
    if (_activeTouchId !== null) return;

    const { track } = _getTrayElements();
    const pieceEl = _closestByClass(event.target, 'tray-piece', track);
    if (!pieceEl) return;

    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch) return;

    const pieceId = parseInt(pieceEl.dataset.pieceId, 10);
    const piece = _pieces[pieceId];
    if (!piece || piece.locked) return;

    _refreshLayoutRects();
    _activeTouchId = touch.identifier;
    _beginTrayGesture(
      piece,
      pieceEl.getBoundingClientRect(),
      touch.identifier,
      touch.clientX,
      touch.clientY
    );
  }

  function _onTouchMove(event) {
    if (_activeTouchId === null) return;

    const touch = _findTouchById(event.touches, _activeTouchId) ||
      _findTouchById(event.changedTouches, _activeTouchId);
    if (!touch) return;

    if (_trayGesture && !_dragging) {
      const dx = touch.clientX - _trayGesture.startClientX;
      const dy = touch.clientY - _trayGesture.startClientY;
      const distance = Math.hypot(dx, dy);

      if (distance < TRAY_GESTURE_THRESHOLD) {
        return;
      }

      event.preventDefault();
      _startTrayDrag(_trayGesture, {
        clientX: touch.clientX,
        clientY: touch.clientY,
      });
      return;
    }

    if (!_dragging) return;

    event.preventDefault();
    _updateDraggingPosition(touch.clientX, touch.clientY);
  }

  function _onTouchEnd(event) {
    if (_activeTouchId === null) return;

    const touch = _findTouchById(event.changedTouches, _activeTouchId);
    if (!touch) return;

    if (_trayGesture && !_dragging) {
      _trayGesture = null;
      _activeTouchId = null;
      return;
    }

    if (_dragging) {
      event.preventDefault();
      _finishDragging(touch.clientX, touch.clientY);
    }

    _activeTouchId = null;
  }

  function _onCanvasMouseDown(event) {
    _onCanvasMouseStart(_normalizeLegacyInput(
      event,
      'mouse',
      1,
      event.clientX,
      event.clientY,
      event.target
    ));
  }

  function _onTrayMouseDown(event) {
    _onTrayMouseStart(_normalizeLegacyInput(
      event,
      'mouse',
      1,
      event.clientX,
      event.clientY,
      event.target
    ));
  }

  function _onMouseMove(event) {
    _onMouseMoveInternal(_normalizeLegacyInput(
      event,
      'mouse',
      1,
      event.clientX,
      event.clientY,
      event.target
    ));
  }

  function _onMouseUp(event) {
    _onMouseUpInternal(_normalizeLegacyInput(
      event,
      'mouse',
      1,
      event.clientX,
      event.clientY,
      event.target
    ));
  }

  // ── Event binding ────────────────────────────────────
  function _bindEvents() {
    const { track, prevBtn, nextBtn } = _getTrayElements();

    _floatCanvas.addEventListener('touchstart', _onCanvasTouchStart, TOUCH_LISTENER_OPTIONS);
    if (track) track.addEventListener('touchstart', _onTrayTouchStart, TOUCH_LISTENER_OPTIONS);
    document.addEventListener('touchmove', _onTouchMove, TOUCH_LISTENER_OPTIONS);
    document.addEventListener('touchend', _onTouchEnd, TOUCH_LISTENER_OPTIONS);
    document.addEventListener('touchcancel', _onTouchEnd, TOUCH_LISTENER_OPTIONS);

    _floatCanvas.addEventListener('mousedown', _onCanvasMouseDown);
    if (track) track.addEventListener('mousedown', _onTrayMouseDown);
    window.addEventListener('mousemove', _onMouseMove);
    window.addEventListener('mouseup', _onMouseUp);

    if (prevBtn) prevBtn.addEventListener('click', _showPreviousTrayPage);
    if (nextBtn) nextBtn.addEventListener('click', _showNextTrayPage);

    window.addEventListener('resize', _onResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', _onResize);
    }

    // Toolbar buttons
    document.getElementById('back-btn').addEventListener('click', _onBack);
    document.getElementById('hint-btn').addEventListener('click', _onHint);
  }

  function _unbindEvents() {
    if (!_floatCanvas) return; // never started — nothing was bound
    const { track, prevBtn, nextBtn } = _getTrayElements();

    _floatCanvas.removeEventListener('touchstart', _onCanvasTouchStart, TOUCH_LISTENER_OPTIONS);
    if (track) track.removeEventListener('touchstart', _onTrayTouchStart, TOUCH_LISTENER_OPTIONS);
    document.removeEventListener('touchmove', _onTouchMove, TOUCH_LISTENER_OPTIONS);
    document.removeEventListener('touchend', _onTouchEnd, TOUCH_LISTENER_OPTIONS);
    document.removeEventListener('touchcancel', _onTouchEnd, TOUCH_LISTENER_OPTIONS);

    _floatCanvas.removeEventListener('mousedown', _onCanvasMouseDown);
    if (track) track.removeEventListener('mousedown', _onTrayMouseDown);
    window.removeEventListener('mousemove', _onMouseMove);
    window.removeEventListener('mouseup', _onMouseUp);

    if (prevBtn) prevBtn.removeEventListener('click', _showPreviousTrayPage);
    if (nextBtn) nextBtn.removeEventListener('click', _showNextTrayPage);

    _activeTouchId = null;
    window.removeEventListener('resize', _onResize);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', _onResize);
    }
    const backBtn = document.getElementById('back-btn');
    if (backBtn) backBtn.removeEventListener('click', _onBack);
    const hintBtn = document.getElementById('hint-btn');
    if (hintBtn) hintBtn.removeEventListener('click', _onHint);
  }

  function _onResize() {
    if (_resizeRafId) cancelAnimationFrame(_resizeRafId);

    _resizeRafId = requestAnimationFrame(() => {
      _resizeRafId = null;

      if (!_img || !_pieces.length) return;

      const area = document.getElementById('canvas-area');
      if (!area) return;

      const nextCanvasW = area.clientWidth;
      const nextCanvasH = area.clientHeight;
      const nextPixelRatio = _getPixelRatio();
      if (!nextCanvasW || !nextCanvasH) return;
      if (nextCanvasW === _canvasW && nextCanvasH === _canvasH && nextPixelRatio === _pixelRatio) return;

      const state = _captureState(_pieces.every(piece => piece.locked));
      const scaledState = _scaleStateForCanvas(state, _canvasW, _canvasH, nextCanvasW, nextCanvasH);
      _restartWithState(scaledState);
    });
  }

  // ── Mouse helpers ────────────────────────────────────
  function _onTrayMouseStart(e) {
    const { track } = _getTrayElements();
    const el = _closestByClass(e.target, 'tray-piece', track);
    if (!el) return;
    _refreshLayoutRects();

    const pieceId = parseInt(el.dataset.pieceId, 10);
    const piece   = _pieces[pieceId];
    if (!piece || piece.locked) return;

    const rect = el.getBoundingClientRect();
    e.preventDefault();
    _startTrayDrag({
      piece,
      originTrayIndex: piece.trayIndex,
      rect,
    }, e);
  }

  function _startTrayDrag(gesture, event) {
    const { piece, originTrayIndex, rect } = gesture;
    const canvasRect = _canvasRect || _floatCanvas.getBoundingClientRect();

    piece.currentX = rect.left - canvasRect.left + piece.ox;
    piece.currentY = rect.top  - canvasRect.top  + piece.oy;
    piece.location = 'board';
    piece.trayIndex = -1;

    _normalizeTrayIndices();
    _populateTray();

    _dragging = {
      piece,
      fromTray: true,
      originTrayIndex,
      offsetX: (event.clientX - rect.left) * (piece.canvasW / rect.width) - piece.ox,
      offsetY: (event.clientY - rect.top) * (piece.canvasH / rect.height) - piece.oy,
    };
    _trayGesture = null;

    _updateDraggingPosition(event.clientX, event.clientY);
  }

  function _onCanvasMouseStart(e) {
    e.preventDefault();
    if (!_startCanvasDragAt(e.clientX, e.clientY)) return;
  }

  function _findPieceAt(mx, my) {
    const unlocked = _boardPieces();
    for (let i = unlocked.length - 1; i >= 0; i--) {
      const p  = unlocked[i];
      const px = p.currentX - p.ox;
      const py = p.currentY - p.oy;
      if (mx >= px && mx <= px + p.canvasW && my >= py && my <= py + p.canvasH) {
        return p;
      }
    }
    return null;
  }

  function _onMouseMoveInternal(e) {
    if (_trayGesture && !_dragging && e.inputId === _trayGesture.inputId) {
      const dx = e.clientX - _trayGesture.startClientX;
      const dy = e.clientY - _trayGesture.startClientY;
      const distance = Math.hypot(dx, dy);

      if (distance < TRAY_GESTURE_THRESHOLD) {
        return;
      }

      e.preventDefault();
      _startTrayDrag(_trayGesture, e);
      return;
    }

    if (!_dragging) return;
    _updateDraggingPosition(e.clientX, e.clientY);
  }

  function _onMouseUpInternal(e) {
    if (_trayGesture && e.inputId === _trayGesture.inputId) {
      _trayGesture = null;
    }

    _finishDragging(e.clientX, e.clientY);
  }

  function _snapPiece(piece) {
    piece.currentX = piece.correctX;
    piece.currentY = piece.correctY;
    piece.locked   = true;
    piece.location = 'locked';
    piece.trayIndex = -1;

    // Draw onto assembled canvas
    _drawLockedPiece(piece);

    // Remove from tray DOM if it happens to still be there
    const trayEl = document.querySelector(`[data-piece-id="${piece.id}"]`);
    if (trayEl) trayEl.remove();

    _autoSave();
    Home.refreshAfterSave();

    // Check completion
    if (_pieces.every(p => p.locked)) {
      _onComplete();
    }
  }

  // ── Draw loop ────────────────────────────────────────
  function _tick() {
    _floatCtx.clearRect(0, 0, _canvasW, _canvasH);
    _clearDragLayer();

    const boardPieces = _boardPieces();
    boardPieces.filter(piece => !_dragging || piece.id !== _dragging.piece.id).forEach(p => {
      _drawPieceCanvas(
        _floatCtx,
        p,
        p.currentX - p.ox,
        p.currentY - p.oy
      );
    });

    if (_dragging && _dragging.piece.location === 'board') {
      const piece = _dragging.piece;
      _drawPieceCanvas(
        _floatCtx,
        piece,
        piece.currentX - piece.ox,
        piece.currentY - piece.oy
      );
    }

    _rafId = requestAnimationFrame(_tick);
  }

  // ── Hint ─────────────────────────────────────────────
  function _onHint() {
    const overlay = document.getElementById('hint-overlay');
    const hintImg = document.getElementById('hint-img');
    hintImg.src = _getSquareHintSrc();
    overlay.classList.add('active');
    setTimeout(() => {
      overlay.classList.remove('active');
    }, 3000);
  }

  // ── Back ─────────────────────────────────────────────
  function _onBack() {
    _autoSave(_pieces.every(piece => piece.locked));
    App.showHome();
  }

  // ── Completion ───────────────────────────────────────
  function _onComplete() {
    _autoSave(true);
    _startConfetti();
  }

  // ── Auto-save ────────────────────────────────────────
  function _autoSave(completed = false) {
    Storage.saveState(_puzzle || _puzzleId, _pieceCount, _captureState(completed));
  }

  function saveProgress() {
    if (!_puzzleId || !_pieceCount || !_pieces.length) return;
    _autoSave(_pieces.every(piece => piece.locked));
  }

  // ── Confetti ─────────────────────────────────────────
  function _startConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    canvas.width  = _canvasW;
    canvas.height = _canvasH;
    canvas.style.display = 'block';
    const ctx    = canvas.getContext('2d');
    const COLORS = ['#4CAF50','#FFD700','#FF5722','#2196F3','#E91E63','#9C27B0','#00BCD4'];
    const N      = 120;

    const particles = Array.from({ length: N }, () => ({
      x: Math.random() * _canvasW,
      y: Math.random() * _canvasH * -0.5,
      w: 6 + Math.random() * 8,
      h: 6 + Math.random() * 8,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 4,
      angle: Math.random() * Math.PI * 2,
      va: (Math.random() - 0.5) * 0.15,
    }));

    const start = performance.now();
    const DURATION = 2800;

    function frame(now) {
      const elapsed = now - start;
      ctx.clearRect(0, 0, _canvasW, _canvasH);
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.va;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (elapsed < DURATION) {
        requestAnimationFrame(frame);
      } else {
        ctx.clearRect(0, 0, _canvasW, _canvasH);
        canvas.style.display = 'none';
      }
    }
    requestAnimationFrame(frame);
  }

  // ── Stop / cleanup ───────────────────────────────────
  function stop() {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    if (_resizeRafId) { cancelAnimationFrame(_resizeRafId); _resizeRafId = null; }
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    _unbindEvents();

    // Clear canvases
    if (_assembledCtx) _assembledCtx.clearRect(0, 0, _canvasW, _canvasH);
    if (_floatCtx)     _floatCtx.clearRect(0, 0, _canvasW, _canvasH);
    _clearDragLayer();
    const { track } = _getTrayElements();
    if (track) track.innerHTML = '';
    document.getElementById('hint-overlay').classList.remove('active');

    _pieces = [];
    _pieceCanvases = [];
    _boardBounds = null;
    _dragging = null;
    _trayGesture = null;
    _trayPageIndex = 0;
    _trayPageCount = 0;
    _puzzleViewRect = null;
    _canvasRect = null;
    _trayRect = null;
    _dragOffsetX = 0;
    _dragOffsetY = 0;
    _squareImageCrop = null;
    _hintImageSrc = '';
    _puzzle = null;
    _puzzleId = null;
    _storagePuzzleId = null;
  }

  return { start, stop, saveProgress };
})();
