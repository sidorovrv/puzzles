/**
 * puzzle-render.js — Canvas rendering, drag/drop, snap, confetti, hint
 */

'use strict';

const PuzzleRender = (() => {
  // ── State ────────────────────────────────────────────
  let _puzzleId    = null;
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

  // Canvas elements
  let _assembledCanvas = null;
  let _floatCanvas     = null;
  let _assembledCtx    = null;
  let _floatCtx        = null;
  let _canvasW         = 0;
  let _canvasH         = 0;

  // Drag state
  let _dragging  = null; // { piece, startX, startY, offsetX, offsetY, fromTray }
  let _rafId     = null;

  // ── Public: start ────────────────────────────────────
  /**
   * @param {string} puzzleId
   * @param {number} pieceCount
   * @param {HTMLImageElement} img
   * @param {Object|null} savedState
   */
  function start(puzzleId, pieceCount, img, savedState) {
    _puzzleId   = puzzleId;
    _pieceCount = pieceCount;
    _img        = img;

    const { cols, rows } = PuzzleEngine.gridDims(pieceCount);
    _cols = cols;
    _rows = rows;

    _setupCanvases();

    // Compute cell size in displayed pixels (fit image into canvas)
    const ratio = Math.min(_canvasW / img.naturalWidth, _canvasH / img.naturalHeight);
    const imgW = img.naturalWidth  * ratio;
    const imgH = img.naturalHeight * ratio;
    _cellW = imgW / cols;
    _cellH = imgH / rows;

    // Seed & PRNG
    _seed = PuzzleEngine.hashSeed(puzzleId, pieceCount);
    const rng = PuzzleEngine.mulberry32(_seed);

    // Generate pieces
    _pieces = PuzzleEngine.generatePieces(cols, rows, rng, _cellW, _cellH);

    // Correct positions are centered on the canvas
    const offsetX = (_canvasW - imgW) / 2;
    const offsetY = (_canvasH - imgH) / 2;
    _pieces.forEach(p => {
      p.correctX += offsetX;
      p.correctY += offsetY;
    });

    // Build piece image canvases
    _pieceCanvases = _pieces.map(p =>
      PuzzleEngine.clipPieceImage(img, p, _cellW, _cellH, imgW, imgH)
    );

    if (savedState) {
      _restoreState(savedState);
      _startedAt      = savedState.startedAt;
      _elapsedSeconds = savedState.elapsedSeconds;
    } else {
      PuzzleEngine.scatterPieces(_pieces, rng);
      _startedAt      = Math.floor(Date.now() / 1000);
      _elapsedSeconds = 0;
      _autoSave();
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
    const area       = document.getElementById('canvas-area');

    const w = area.clientWidth;
    const h = area.clientHeight;
    _canvasW = w;
    _canvasH = h;

    [_assembledCanvas, _floatCanvas].forEach(c => {
      c.width  = w;
      c.height = h;
      c.style.width  = w + 'px';
      c.style.height = h + 'px';
    });

    _assembledCtx = _assembledCanvas.getContext('2d');
    _floatCtx     = _floatCanvas.getContext('2d');
  }

  // ── Restore saved state ──────────────────────────────
  function _restoreState(state) {
    state.pieces.forEach(saved => {
      const p = _pieces[saved.id];
      if (!p) return;
      p.currentX = saved.x;
      p.currentY = saved.y;
      p.locked   = saved.locked;
      if (p.locked) p.trayIndex = -1; // not in tray
    });
    // Assign tray indices for unlocked pieces
    const unlocked = _pieces.filter(p => !p.locked);
    unlocked.forEach((p, i) => { if (p.trayIndex === undefined || p.trayIndex === -1) p.trayIndex = i; });
  }

  // ── Assembled canvas rebuild ─────────────────────────
  function _rebuildAssembledCanvas() {
    _assembledCtx.clearRect(0, 0, _canvasW, _canvasH);
    _pieces.filter(p => p.locked).forEach(p => _drawLockedPiece(p));
  }

  function _drawLockedPiece(piece) {
    const pc = _pieceCanvases[piece.id];
    if (!pc) return;
    _assembledCtx.drawImage(
      pc,
      Math.round(piece.correctX - piece.ox),
      Math.round(piece.correctY - piece.oy)
    );
  }

  // ── Piece tray ───────────────────────────────────────
  function _populateTray() {
    const tray = document.getElementById('piece-tray');
    tray.innerHTML = '';

    const trayH = tray.clientHeight || 120;
    const displaySize = Math.min(trayH - 16, 90);

    // Sort unlocked pieces by trayIndex
    const unlocked = _pieces.filter(p => !p.locked)
      .sort((a, b) => a.trayIndex - b.trayIndex);

    unlocked.forEach(piece => {
      const pc = _pieceCanvases[piece.id];
      const trayCanvas = document.createElement('canvas');
      const scale = displaySize / Math.max(pc.width, pc.height);
      trayCanvas.width  = Math.round(pc.width  * scale);
      trayCanvas.height = Math.round(pc.height * scale);
      trayCanvas.className = 'tray-piece';
      trayCanvas.dataset.pieceId = piece.id;
      const tc = trayCanvas.getContext('2d');
      tc.drawImage(pc, 0, 0, trayCanvas.width, trayCanvas.height);

      // Store scale for hit-testing
      trayCanvas._pieceScale = scale;

      tray.appendChild(trayCanvas);
    });
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

    // Toolbar buttons
    document.getElementById('back-btn').addEventListener('click', _onBack);
    document.getElementById('hint-btn').addEventListener('click', _onHint);
  }

  function _unbindEvents() {
    _floatCanvas.removeEventListener('pointerdown', _onCanvasPointerDown);
    document.getElementById('piece-tray').removeEventListener('pointerdown', _onTrayPointerDown);
    window.removeEventListener('pointermove', _onPointerMove);
    window.removeEventListener('pointerup',   _onPointerUp);
    document.getElementById('back-btn').removeEventListener('click', _onBack);
    document.getElementById('hint-btn').removeEventListener('click', _onHint);
  }

  // ── Pointer handlers ─────────────────────────────────
  function _onTrayPointerDown(e) {
    const el = e.target.closest('.tray-piece');
    if (!el) return;
    e.preventDefault();

    const pieceId = parseInt(el.dataset.pieceId, 10);
    const piece   = _pieces[pieceId];
    if (!piece || piece.locked) return;

    const rect = el.getBoundingClientRect();
    const canvasRect = _floatCanvas.getBoundingClientRect();

    // Place piece onto float canvas at a sensible starting position
    piece.currentX = rect.left - canvasRect.left + piece.ox;
    piece.currentY = rect.top  - canvasRect.top  + piece.oy;

    // Remove from tray DOM (it will be shown on float canvas while dragging)
    el.remove();

    _dragging = {
      piece,
      fromTray: true,
      offsetX: (e.clientX - rect.left) * (piece.canvasW / rect.width)  - piece.ox,
      offsetY: (e.clientY - rect.top)  * (piece.canvasH / rect.height) - piece.oy,
    };
    _floatCanvas.setPointerCapture(e.pointerId);
  }

  function _onCanvasPointerDown(e) {
    e.preventDefault();
    const canvasRect = _floatCanvas.getBoundingClientRect();
    const mx = e.clientX - canvasRect.left;
    const my = e.clientY - canvasRect.top;

    // Find topmost unlocked piece hit by pointer (reverse order = top piece first)
    const hit = _findPieceAt(mx, my);
    if (!hit) return;

    _dragging = {
      piece: hit,
      fromTray: false,
      offsetX: mx - hit.currentX,
      offsetY: my - hit.currentY,
    };
    _floatCanvas.setPointerCapture(e.pointerId);
  }

  function _findPieceAt(mx, my) {
    const unlocked = _pieces.filter(p => !p.locked);
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
    if (!_dragging) return;
    const canvasRect = _floatCanvas.getBoundingClientRect();
    const mx = e.clientX - canvasRect.left;
    const my = e.clientY - canvasRect.top;
    _dragging.piece.currentX = mx - _dragging.offsetX;
    _dragging.piece.currentY = my - _dragging.offsetY;
  }

  function _onPointerUp(e) {
    if (!_dragging) return;
    const piece = _dragging.piece;
    const fromTray = _dragging.fromTray;
    _dragging = null;

    // Check snap
    const dx = piece.currentX - piece.correctX;
    const dy = piece.currentY - piece.correctY;
    if (Math.sqrt(dx * dx + dy * dy) < SNAP_RADIUS) {
      _snapPiece(piece);
    } else {
      // Return to tray if from tray and not snapped, or keep on canvas
      if (fromTray) {
        // Keep on canvas — user placed it; it will be draggable from canvas now
      }
      // Just leave at currentX/Y on canvas
    }
  }

  function _snapPiece(piece) {
    piece.currentX = piece.correctX;
    piece.currentY = piece.correctY;
    piece.locked   = true;

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

    _pieces.filter(p => !p.locked).forEach(p => {
      const pc = _pieceCanvases[p.id];
      if (!pc) return;
      _floatCtx.drawImage(
        pc,
        Math.round(p.currentX - p.ox),
        Math.round(p.currentY - p.oy)
      );
    });

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
    _autoSave();
    _stop();
    App.showHome();
  }

  // ── Completion ───────────────────────────────────────
  function _onComplete() {
    _autoSave(true);
    _startConfetti();
  }

  // ── Auto-save ────────────────────────────────────────
  function _autoSave(completed = false) {
    Storage.saveState(_puzzleId, _pieceCount, {
      seed: _seed,
      startedAt: _startedAt,
      elapsedSeconds: _elapsedSeconds,
      lockedCount: _pieces.filter(p => p.locked).length,
      completed,
      pieces: _pieces.map(p => ({
        id: p.id,
        x: p.currentX,
        y: p.currentY,
        locked: p.locked,
      })),
    });
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
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    _unbindEvents();

    // Clear canvases
    if (_assembledCtx) _assembledCtx.clearRect(0, 0, _canvasW, _canvasH);
    if (_floatCtx)     _floatCtx.clearRect(0, 0, _canvasW, _canvasH);
    document.getElementById('piece-tray').innerHTML = '';
    document.getElementById('hint-overlay').classList.remove('active');

    _pieces = [];
    _pieceCanvases = [];
    _dragging = null;
  }

  return { start, stop };
})();
