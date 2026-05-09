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

  // Drag state
  let _dragging  = null; // { piece, startX, startY, offsetX, offsetY, fromTray }
  let _trayGesture = null;
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

  function _pointInRect(clientX, clientY, rect) {
    if (!rect) return false;

    return clientX >= rect.left && clientX <= rect.right &&
      clientY >= rect.top && clientY <= rect.bottom;
  }

  function _returnPieceToTray(piece, preferredIndex = null) {
    const tray = document.getElementById('piece-tray');
    const trayScrollLeft = tray ? tray.scrollLeft : 0;
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
    _populateTray(trayScrollLeft);
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
  function _populateTray(preserveScrollLeft = null) {
    const tray = document.getElementById('piece-tray');
    const scrollLeft = Number.isFinite(preserveScrollLeft)
      ? preserveScrollLeft
      : tray.scrollLeft;
    tray.innerHTML = '';

    const trayH = tray.clientHeight || 120;
    const displaySize = Math.min(trayH - 16, 90);

    // Sort unlocked pieces by trayIndex
    const unlocked = _trayPieces()
      .sort((a, b) => a.trayIndex - b.trayIndex);

    unlocked.forEach(piece => {
      const pc = _pieceCanvases[piece.id];
      if (!pc) return;
      const trayCanvas = document.createElement('canvas');
      const scale = displaySize / Math.max(piece.canvasW, piece.canvasH);
      const trayWidth = Math.max(1, Math.round(piece.canvasW * scale));
      const trayHeight = Math.max(1, Math.round(piece.canvasH * scale));
      trayCanvas.className = 'tray-piece';
      trayCanvas.dataset.pieceId = piece.id;
      const tc = _resizeCanvas(trayCanvas, trayWidth, trayHeight);
      tc.drawImage(pc, 0, 0, pc.width, pc.height, 0, 0, trayWidth, trayHeight);

      // Store scale for hit-testing
      trayCanvas._pieceScale = scale;

      tray.appendChild(trayCanvas);
    });

    tray.scrollLeft = Math.max(0, Math.min(
      scrollLeft,
      Math.max(tray.scrollWidth - tray.clientWidth, 0)
    ));
    _trayRect = tray.getBoundingClientRect();
  }

  // ── Timer ────────────────────────────────────────────
  function _startTimer() {
    if (_timerInterval) clearInterval(_timerInterval);
    _timerInterval = setInterval(() => { _elapsedSeconds++; }, 1000);
  }

  // ── Event binding ────────────────────────────────────
  function _bindEvents() {
    // Canvas pointer events (for pieces already on the canvas — locked pieces are immovable)
    _floatCanvas.addEventListener('pointerdown', _onCanvasPointerDown);

    // Tray pointer events
    document.getElementById('piece-tray').addEventListener('pointerdown', _onTrayPointerDown);

    // Global pointer move / up
    window.addEventListener('pointermove', _onPointerMove);
    window.addEventListener('pointerup',   _onPointerUp);
    window.addEventListener('pointercancel', _onPointerUp);
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
    _floatCanvas.removeEventListener('pointerdown', _onCanvasPointerDown);
    const tray = document.getElementById('piece-tray');
    if (tray) tray.removeEventListener('pointerdown', _onTrayPointerDown);
    window.removeEventListener('pointermove', _onPointerMove);
    window.removeEventListener('pointerup',   _onPointerUp);
    window.removeEventListener('pointercancel', _onPointerUp);
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

  // ── Pointer handlers ─────────────────────────────────
  function _onTrayPointerDown(e) {
    const el = e.target.closest('.tray-piece');
    if (!el) return;
    _refreshLayoutRects();

    const pieceId = parseInt(el.dataset.pieceId, 10);
    const piece   = _pieces[pieceId];
    if (!piece || piece.locked) return;

    const tray = document.getElementById('piece-tray');
    const trayScrollLeft = tray ? tray.scrollLeft : 0;
    const originTrayIndex = piece.trayIndex;
    const rect = el.getBoundingClientRect();
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      _trayGesture = {
        captureEl: tray,
        piece,
        originTrayIndex,
        pointerId: e.pointerId,
        rect,
        startClientX: e.clientX,
        startClientY: e.clientY,
        trayScrollLeft,
      };
      return;
    }

    e.preventDefault();
    _startTrayDrag({
      captureEl: tray,
      piece,
      originTrayIndex,
      pointerId: e.pointerId,
      rect,
      trayScrollLeft,
    }, e);
  }

  function _startTrayDrag(gesture, event) {
    const { piece, originTrayIndex, rect } = gesture;
    const tray = document.getElementById('piece-tray');
    const trayScrollLeft = tray ? tray.scrollLeft : gesture.trayScrollLeft;
    const canvasRect = _canvasRect || _floatCanvas.getBoundingClientRect();

    piece.currentX = rect.left - canvasRect.left + piece.ox;
    piece.currentY = rect.top  - canvasRect.top  + piece.oy;
    piece.location = 'board';
    piece.trayIndex = -1;

    _normalizeTrayIndices();
    _populateTray(trayScrollLeft);

    _dragging = {
      piece,
      fromTray: true,
      originTrayIndex,
      offsetX: (event.clientX - rect.left) * (piece.canvasW / rect.width) - piece.ox,
      offsetY: (event.clientY - rect.top) * (piece.canvasH / rect.height) - piece.oy,
    };
    _trayGesture = null;

    if (gesture.captureEl && typeof gesture.captureEl.setPointerCapture === 'function') {
      try {
        gesture.captureEl.setPointerCapture(gesture.pointerId);
      } catch (err) {
        // Ignore browsers that reject late pointer capture during tray promotion.
      }
    }

    _onPointerMove(event);
  }

  function _onCanvasPointerDown(e) {
    e.preventDefault();
    _refreshLayoutRects();
    const canvasRect = _canvasRect || _floatCanvas.getBoundingClientRect();
    const mx = e.clientX - canvasRect.left;
    const my = e.clientY - canvasRect.top;

    // Find topmost unlocked piece hit by pointer (reverse order = top piece first)
    const hit = _findPieceAt(mx, my);
    if (!hit) return;

    _dragging = {
      piece: hit,
      fromTray: false,
      originTrayIndex: null,
      offsetX: mx - hit.currentX,
      offsetY: my - hit.currentY,
    };
    _floatCanvas.setPointerCapture(e.pointerId);
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

  function _onPointerMove(e) {
    if (_trayGesture && !_dragging && e.pointerId === _trayGesture.pointerId) {
      const dx = e.clientX - _trayGesture.startClientX;
      const dy = e.clientY - _trayGesture.startClientY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      if (absX < TRAY_GESTURE_THRESHOLD && absY < TRAY_GESTURE_THRESHOLD) {
        return;
      }

      if (-dy >= TRAY_GESTURE_THRESHOLD && absY > absX) {
        e.preventDefault();
        _startTrayDrag(_trayGesture, e);
        return;
      }

      if (absX >= absY || dy > 0) {
        _trayGesture = null;
      }
    }

    if (!_dragging) return;
    const canvasRect = _canvasRect || _floatCanvas.getBoundingClientRect();
    const mx = e.clientX - canvasRect.left;
    const my = e.clientY - canvasRect.top;
    _dragging.piece.currentX = mx - _dragging.offsetX;
    _dragging.piece.currentY = my - _dragging.offsetY;
  }

  function _onPointerUp(e) {
    if (_trayGesture && e.pointerId === _trayGesture.pointerId) {
      if (_trayGesture.captureEl && typeof _trayGesture.captureEl.hasPointerCapture === 'function') {
        try {
          if (_trayGesture.captureEl.hasPointerCapture(e.pointerId)) {
            _trayGesture.captureEl.releasePointerCapture(e.pointerId);
          }
        } catch (err) {
          // Ignore browsers that do not keep pointer capture state here.
        }
      }
      _trayGesture = null;
    }

    if (!_dragging) return;
    _refreshLayoutRects();

    const piece = _dragging.piece;
    const fromTray = _dragging.fromTray;
    const originTrayIndex = _dragging.originTrayIndex;
    _dragging = null;

    if (_pointInRect(e.clientX, e.clientY, _trayRect)) {
      _returnPieceToTray(piece, fromTray ? originTrayIndex : _trayPieces().length);
      _autoSave(_pieces.every(candidate => candidate.locked));
      Home.refreshAfterSave();
      return;
    }

    // Check snap
    const dx = piece.currentX - piece.correctX;
    const dy = piece.currentY - piece.correctY;
    if (Math.sqrt(dx * dx + dy * dy) < SNAP_RADIUS) {
      _snapPiece(piece);
    } else {
      _autoSave(_pieces.every(candidate => candidate.locked));
      Home.refreshAfterSave();
    }
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
      const drawCtx = _dragCtx || _floatCtx;
      const offsetX = _dragCtx ? _dragOffsetX : 0;
      const offsetY = _dragCtx ? _dragOffsetY : 0;
      _drawPieceCanvas(
        drawCtx,
        piece,
        offsetX + piece.currentX - piece.ox,
        offsetY + piece.currentY - piece.oy
      );
    }

    _rafId = requestAnimationFrame(_tick);
  }

  // ── Hint ─────────────────────────────────────────────
  function _onHint() {
    const overlay = document.getElementById('hint-overlay');
    const hintImg = document.getElementById('hint-img');
    hintImg.src = _img.src;
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
    document.getElementById('piece-tray').innerHTML = '';
    document.getElementById('hint-overlay').classList.remove('active');

    _pieces = [];
    _pieceCanvases = [];
    _boardBounds = null;
    _dragging = null;
    _trayGesture = null;
    _puzzleViewRect = null;
    _canvasRect = null;
    _trayRect = null;
    _dragOffsetX = 0;
    _dragOffsetY = 0;
    _puzzle = null;
    _puzzleId = null;
    _storagePuzzleId = null;
  }

  return { start, stop, saveProgress };
})();
