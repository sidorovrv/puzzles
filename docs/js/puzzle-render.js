/**
 * puzzle-render.js — Canvas rendering loop, touch/pointer drag, snap logic,
 *                    auto-save, completion detection.
 * All UI text in Russian.
 */

(async function() {

  // ── Parse URL params ─────────────────────────────
  const params   = new URLSearchParams(location.search);
  const puzzleId = params.get('id');
  const difficulty = parseInt(params.get('diff') || '144');

  if (!puzzleId) { window.location.href = 'home.html'; return; }

  // ── Load puzzle metadata ──────────────────────────
  const resp    = await fetch('data/puzzles.json');
  const allPuzzles = await resp.json();
  const puzzleMeta = allPuzzles.find(p => p.id === puzzleId);
  if (!puzzleMeta) { window.location.href = 'home.html'; return; }

  document.getElementById('puzzle-title').textContent =
    `${puzzleMeta.title} (${difficulty} шт.)`;

  // ── Canvas setup ──────────────────────────────────
  const wrapper = document.getElementById('canvas-wrapper');
  const canvas  = document.getElementById('puzzle-canvas');
  const ctx     = canvas.getContext('2d');

  function resizeCanvas() {
    canvas.width  = wrapper.clientWidth;
    canvas.height = wrapper.clientHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', () => { resizeCanvas(); renderAll(); });

  // ── Load image ────────────────────────────────────
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = puzzleMeta.file;
  await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });

  // Compute puzzle display area (centred, 4:3 aspect)
  const PUZZLE_W = Math.min(canvas.width  * 0.55, 720);
  const PUZZLE_H = Math.min(canvas.height * 0.75, PUZZLE_W * 0.75);
  const PUZZLE_X = (canvas.width  - PUZZLE_W) / 2;
  const PUZZLE_Y = (canvas.height - PUZZLE_H) / 2;

  // ── Generate or restore pieces ────────────────────
  const { cols, rows } = PuzzleEngine.GRID_DIMS[difficulty];
  const totalPieces = cols * rows;
  const SNAP_RADIUS = Math.min(PUZZLE_W / cols, PUZZLE_H / rows) * 0.45;

  let pieces;
  const savedState = await Storage.loadPuzzleState(puzzleId, difficulty);

  if (savedState && savedState.pieces && savedState.pieces.length === totalPieces) {
    // Restore
    pieces = PuzzleEngine.generatePieces(puzzleId, difficulty, PUZZLE_W, PUZZLE_H);
    savedState.pieces.forEach((sp, i) => {
      pieces[i].currentX = sp.x;
      pieces[i].currentY = sp.y;
      pieces[i].locked   = sp.locked;
    });
  } else {
    // Fresh start — scatter all pieces
    pieces = PuzzleEngine.generatePieces(puzzleId, difficulty, PUZZLE_W, PUZZLE_H);
    // Offset scatter positions so they appear around the canvas, not the assembled area
    pieces.forEach(p => {
      if (!p.locked) {
        // Random position in "scatter zone" outside the puzzle area
        p.currentX = Math.random() * canvas.width;
        p.currentY = Math.random() * canvas.height;
      }
    });
  }

  // Pre-render piece canvases
  const pieceCanvases = pieces.map(p =>
    PuzzleEngine.renderPieceToCanvas(p, img, PUZZLE_W, PUZZLE_H)
  );

  // ── Tray ──────────────────────────────────────────
  const tray    = document.getElementById('piece-tray');
  let _selectedTrayIdx = -1;

  function buildTray() {
    tray.innerHTML = '';
    pieces.forEach((p, i) => {
      if (p.locked) return;
      const div = document.createElement('div');
      div.className = 'tray-piece';
      div.dataset.idx = i;
      const pc = pieceCanvases[i];
      // Draw piece thumbnail
      const tCanvas = document.createElement('canvas');
      tCanvas.width  = 80;
      tCanvas.height = 80;
      const tc = tCanvas.getContext('2d');
      const scale = Math.min(80 / pc.width, 80 / pc.height);
      const tw = pc.width * scale;
      const th = pc.height * scale;
      tc.drawImage(pc, (80 - tw)/2, (80 - th)/2, tw, th);
      div.appendChild(tCanvas);
      div.addEventListener('click', () => selectTrayPiece(i));
      tray.appendChild(div);
    });
  }

  function selectTrayPiece(idx) {
    _selectedTrayIdx = idx;
    tray.querySelectorAll('.tray-piece').forEach(el => {
      el.classList.toggle('selected', parseInt(el.dataset.idx) === idx);
    });
  }

  buildTray();

  // ── Rendering ─────────────────────────────────────

  const BLEED = Math.min(PUZZLE_W / cols, PUZZLE_H / rows) * 0.25;

  // Declare drag state here so renderAll() can safely reference it
  let _dragging  = null;
  let _dragOffX  = 0;
  let _dragOffY  = 0;

  function renderAll() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw puzzle area border
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(PUZZLE_X, PUZZLE_Y, PUZZLE_W, PUZZLE_H);
    ctx.restore();

    // Draw all pieces (locked first, then free on top)
    const sorted = [...pieces].sort((a, b) => (a.locked ? -1 : 1) - (b.locked ? -1 : 1));
    sorted.forEach(p => {
      if (p === _dragging) return; // drawn last
      drawPiece(p, false);
    });

    // Draw dragging piece on top
    if (_dragging) drawPiece(_dragging, true);
  }

  function drawPiece(p, highlighted) {
    const pc = pieceCanvases[p.id];
    let dx, dy;

    if (p.locked) {
      dx = PUZZLE_X + p.correctX - BLEED;
      dy = PUZZLE_Y + p.correctY - BLEED;
    } else {
      dx = p.currentX - BLEED;
      dy = p.currentY - BLEED;
    }

    if (highlighted) {
      ctx.save();
      ctx.shadowColor = '#4CAF50';
      ctx.shadowBlur  = 16;
    }
    ctx.drawImage(pc, dx, dy);
    if (highlighted) ctx.restore();
  }

  renderAll();

  // ── Progress bar ──────────────────────────────────

  function updateProgress() {
    const locked = pieces.filter(p => p.locked).length;
    const pct = (locked / totalPieces) * 100;
    document.getElementById('progress-bar').style.width = pct + '%';
    Storage.setProgress(puzzleId, difficulty, { puzzleId, difficulty, lockedCount: locked, totalPieces });
  }
  updateProgress();

  // ── Drag & drop (pointer events) ──────────────────

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup',   onUp);
  canvas.addEventListener('pointercancel', onUp);

  function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width  / rect.width),
      y: (e.clientY - rect.top)  * (canvas.height / rect.height),
    };
  }

  function onDown(e) {
    e.preventDefault();
    const { x, y } = getCanvasPos(e);

    // If a tray piece is selected, place it on canvas
    if (_selectedTrayIdx >= 0) {
      const p = pieces[_selectedTrayIdx];
      if (p && !p.locked) {
        p.currentX = x;
        p.currentY = y;
        _dragging  = p;
        _dragOffX  = 0;
        _dragOffY  = 0;
        _selectedTrayIdx = -1;
        tray.querySelectorAll('.tray-piece').forEach(el => el.classList.remove('selected'));
        canvas.setPointerCapture(e.pointerId);
        renderAll();
        return;
      }
    }

    // Otherwise pick up piece from canvas
    const hit = hitTest(x, y);
    if (hit) {
      _dragging = hit;
      _dragOffX = x - hit.currentX;
      _dragOffY = y - hit.currentY;
      canvas.setPointerCapture(e.pointerId);
    }
  }

  function onMove(e) {
    if (!_dragging) return;
    e.preventDefault();
    const { x, y } = getCanvasPos(e);
    _dragging.currentX = x - _dragOffX;
    _dragging.currentY = y - _dragOffY;
    renderAll();
  }

  function onUp(e) {
    if (!_dragging) return;
    e.preventDefault();
    trySnap(_dragging);
    _dragging = null;
    renderAll();
    buildTray();
    updateProgress();
    scheduleAutoSave();
    checkCompletion();
  }

  function hitTest(x, y) {
    // Search from top (last rendered) to bottom; skip locked pieces
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      if (p.locked) continue;
      const BLEED2 = BLEED;
      const px = p.currentX - BLEED2;
      const py = p.currentY - BLEED2;
      const pw = pieceCanvases[p.id].width;
      const ph = pieceCanvases[p.id].height;
      if (x >= px && x <= px + pw && y >= py && y <= py + ph) return p;
    }
    return null;
  }

  // ── Snap logic ────────────────────────────────────

  function trySnap(p) {
    const targetX = PUZZLE_X + p.correctX;
    const targetY = PUZZLE_Y + p.correctY;
    const dx = p.currentX - targetX;
    const dy = p.currentY - targetY;
    const dist = Math.sqrt(dx*dx + dy*dy);

    if (dist < SNAP_RADIUS) {
      p.locked = true;
      playSnapSound();
    }
  }

  // ── Auto-save ──────────────────────────────────────

  let _saveTimer = null;
  function scheduleAutoSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(saveState, 30_000);
  }
  setInterval(saveState, 30_000);

  function saveState() {
    const state = {
      key: `${puzzleId}_${difficulty}`,
      puzzleId,
      difficulty,
      savedAt: Date.now(),
      pieces: pieces.map(p => ({ id: p.id, x: p.currentX, y: p.currentY, locked: p.locked })),
    };
    Storage.savePuzzleState(puzzleId, difficulty, state);
  }

  // ── Completion ────────────────────────────────────

  function checkCompletion() {
    if (pieces.every(p => p.locked)) {
      Storage.deletePuzzleState(puzzleId, difficulty);
      document.getElementById('completion-overlay').classList.remove('hidden');
      startConfetti();
    }
  }

  document.getElementById('btn-completion-home').addEventListener('click', () => {
    window.location.href = 'home.html';
  });


  // ── Hint ──────────────────────────────────────────

  const hintOverlay = document.getElementById('hint-overlay');
  hintOverlay.style.backgroundImage = `url('${puzzleMeta.file}')`;
  let _hintTimer = null;

  document.getElementById('btn-hint').addEventListener('click', () => {
    hintOverlay.classList.remove('hidden');
    clearTimeout(_hintTimer);
    _hintTimer = setTimeout(() => hintOverlay.classList.add('hidden'), 3000);
  });

  // ── Zoom ─────────────────────────────────────────
  // Simple scale transform on canvas context

  let _zoom = 1.0;
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2.5;
  const ZOOM_STEP = 0.2;

  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    _zoom = Math.min(ZOOM_MAX, _zoom + ZOOM_STEP);
    canvas.style.transform = `scale(${_zoom})`;
    canvas.style.transformOrigin = 'top left';
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    _zoom = Math.max(ZOOM_MIN, _zoom - ZOOM_STEP);
    canvas.style.transform = `scale(${_zoom})`;
    canvas.style.transformOrigin = 'top left';
  });

  // ── Back button ────────────────────────────────────

  document.getElementById('btn-back').addEventListener('click', () => {
    saveState();
    window.location.href = 'home.html';
  });

  // ── Snap sound ────────────────────────────────────

  let _snapAudioCtx = null;
  function playSnapSound() {
    try {
      if (!_snapAudioCtx) _snapAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx2 = _snapAudioCtx;
      const osc = ctx2.createOscillator();
      const gain = ctx2.createGain();
      osc.connect(gain);
      gain.connect(ctx2.destination);
      osc.frequency.setValueAtTime(880, ctx2.currentTime);
      gain.gain.setValueAtTime(0.15, ctx2.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx2.currentTime + 0.12);
      osc.start(ctx2.currentTime);
      osc.stop(ctx2.currentTime + 0.12);
    } catch { /* audio not critical */ }
  }

  // ── Confetti ──────────────────────────────────────

  function startConfetti() {
    const cc = document.getElementById('confetti-canvas');
    cc.width  = window.innerWidth;
    cc.height = window.innerHeight;
    const cx  = cc.getContext('2d');

    const particles = Array.from({ length: 120 }, () => ({
      x: Math.random() * cc.width,
      y: -20,
      vx: (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 4,
      color: ['#4CAF50','#FFC107','#2196F3','#E91E63','#FF5722'][Math.floor(Math.random()*5)],
      size: 8 + Math.random() * 8,
      spin: (Math.random() - 0.5) * 0.2,
      angle: Math.random() * Math.PI * 2,
    }));

    let frame = 0;
    function draw() {
      cx.clearRect(0, 0, cc.width, cc.height);
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.spin;
        p.vy += 0.08;
        cx.save();
        cx.translate(p.x, p.y);
        cx.rotate(p.angle);
        cx.fillStyle = p.color;
        cx.fillRect(-p.size/2, -p.size/4, p.size, p.size/2);
        cx.restore();
      });
      frame++;
      if (frame < 180) requestAnimationFrame(draw);
      else cx.clearRect(0, 0, cc.width, cc.height);
    }
    draw();
  }

})();
