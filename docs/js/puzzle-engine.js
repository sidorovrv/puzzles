/**
 * puzzle-engine.js — Piece generation, tab shapes, scatter, PRNG
 */

'use strict';

const PuzzleEngine = (() => {
  // ── PRNG: mulberry32 ─────────────────────────────────
  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s += 0x6D2B79F5;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── Seed hash ────────────────────────────────────────
  function hashSeed(puzzleId, pieceCount) {
    const str = puzzleId + '_' + pieceCount;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }

  // ── Grid dimensions ──────────────────────────────────
  function gridDims(pieceCount, imageAspectRatio = 1) {
    const safeCount = Number.isInteger(pieceCount) && pieceCount > 0 ? pieceCount : 1;
    const targetAspect = Number.isFinite(imageAspectRatio) && imageAspectRatio > 0
      ? imageAspectRatio
      : 1;
    let best = null;
    const maxFactor = Math.floor(Math.sqrt(safeCount));

    for (let factor = 1; factor <= maxFactor; factor++) {
      if (safeCount % factor !== 0) continue;

      const pair = safeCount / factor;
      considerCandidate(pair, factor);
      if (factor !== pair) {
        considerCandidate(factor, pair);
      }
    }

    return best
      ? { cols: best.cols, rows: best.rows }
      : { cols: safeCount, rows: 1 };

    function considerCandidate(cols, rows) {
      const cellAspect = (targetAspect * rows) / cols;
      const squareError = Math.abs(Math.log(cellAspect));
      const balanceError = Math.abs(cols - rows);

      if (!best ||
        squareError < best.squareError - 1e-9 ||
        (Math.abs(squareError - best.squareError) <= 1e-9 && balanceError < best.balanceError) ||
        (Math.abs(squareError - best.squareError) <= 1e-9 && balanceError === best.balanceError && cols > best.cols)) {
        best = { cols, rows, squareError, balanceError };
      }
    }
  }

  // ── Tab direction for each edge ──────────────────────
  // Returns +1 (tab out) or -1 (tab in).
  // Each shared edge must have opposite signs on each side.
  // Stored in a flat array indexed by edge key.
  // Horizontal edges (between row r and r+1, column c): key = `h_${r}_${c}`
  // Vertical edges (between col c and c+1, row r): key = `v_${r}_${c}`
  function buildEdgeMap(cols, rows, rng) {
    const edges = {};
    // Horizontal internal edges (top face of piece [r+1][c] = bottom face of [r][c])
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        edges[`h_${r}_${c}`] = rng() < 0.5 ? 1 : -1;
      }
    }
    // Vertical internal edges (right face of piece [r][c] = left face of [r][c+1])
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        edges[`v_${r}_${c}`] = rng() < 0.5 ? 1 : -1;
      }
    }
    return edges;
  }

  // ── Generate pieces ──────────────────────────────────
  /**
   * @param {number} cols
   * @param {number} rows
   * @param {Function} rng
   * @param {number} cellW  width of one cell in board coords
   * @param {number} cellH  height of one cell in board coords
   * @param {number} imageCellW  width of one cell in source-image coords
   * @param {number} imageCellH  height of one cell in source-image coords
   * @returns {Object[]} pieces
   */
  function generatePieces(cols, rows, rng, cellW, cellH, imageCellW = cellW, imageCellH = cellH) {
    const edgeMap = buildEdgeMap(cols, rows, rng);
    const pieces = [];
    let id = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Tab directions: top, right, bottom, left (+1 = out, -1 = in, 0 = flat border)
        const top    = r === 0        ? 0 : edgeMap[`h_${r-1}_${c}`];
        const bottom = r === rows - 1 ? 0 : -edgeMap[`h_${r}_${c}`];
        const left   = c === 0        ? 0 : edgeMap[`v_${r}_${c-1}`];
        const right  = c === cols - 1 ? 0 : -edgeMap[`v_${r}_${c}`];

        pieces.push({
          id,
          col: c,
          row: r,
          imageX: c * imageCellW,
          imageY: r * imageCellH,
          correctX: c * cellW,
          correctY: r * cellH,
          currentX: 0,
          currentY: 0,
          locked: false,
          tabs: { top, right, bottom, left },
        });
        id++;
      }
    }
    return pieces;
  }

  // ── Scatter pieces into tray ─────────────────────────
  /**
   * Assign random tray slot positions.
   * The tray is a horizontal strip; we just store a random offset
   * so pieces can be laid out left-to-right with some jitter.
   * Actual pixel positions are computed by puzzle-render.js.
   */
  function scatterPieces(pieces, rng) {
    // Shuffle piece order in the tray using Fisher-Yates
    const order = pieces.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    // Assign tray index
    order.forEach((pieceIdx, trayIdx) => {
      pieces[pieceIdx].trayIndex = trayIdx;
    });
  }

  // ── Clip piece image ─────────────────────────────────
  const BLEED = 12; // px extra around the piece for tabs

  /**
   * Draw one puzzle piece (with tab shape) onto an offscreen canvas.
   * Returns the canvas.
   *
   * @param {CanvasImageSource} img  - full puzzle image
   * @param {Object} piece
   * @param {number} cellW  - piece width in destination pixels
   * @param {number} cellH  - piece height in destination pixels
   * @param {Object} renderOptions
   * @returns {HTMLCanvasElement}
   */
  function clipPieceImage(img, piece, cellW, cellH, renderOptions = {}) {
    const TAB_SIZE = Math.min(cellW, cellH) * 0.22; // protrusion length
    const canvasW = cellW + BLEED * 2 + TAB_SIZE * 2;
    const canvasH = cellH + BLEED * 2 + TAB_SIZE * 2;
    const imageX = Number.isFinite(piece.imageX) ? piece.imageX : 0;
    const imageY = Number.isFinite(piece.imageY) ? piece.imageY : 0;
    const sourceImageW = img.naturalWidth || img.width || 1;
    const sourceImageH = img.naturalHeight || img.height || 1;
    const sourceX = Number.isFinite(renderOptions.sourceX) ? renderOptions.sourceX : 0;
    const sourceY = Number.isFinite(renderOptions.sourceY) ? renderOptions.sourceY : 0;
    const sourceW = Number.isFinite(renderOptions.sourceWidth) && renderOptions.sourceWidth > 0
      ? renderOptions.sourceWidth
      : sourceImageW;
    const sourceH = Number.isFinite(renderOptions.sourceHeight) && renderOptions.sourceHeight > 0
      ? renderOptions.sourceHeight
      : sourceImageH;
    const displayW = Number.isFinite(renderOptions.displayWidth) && renderOptions.displayWidth > 0
      ? renderOptions.displayWidth
      : sourceW;
    const displayH = Number.isFinite(renderOptions.displayHeight) && renderOptions.displayHeight > 0
      ? renderOptions.displayHeight
      : sourceH;
    const dpr = Number.isFinite(renderOptions.dpr) && renderOptions.dpr > 0
      ? renderOptions.dpr
      : Math.max(1, window.devicePixelRatio || 1);
    const scaleX = displayW / sourceW;
    const scaleY = displayH / sourceH;

    const offscreen = document.createElement('canvas');
    offscreen.width  = Math.max(1, Math.ceil(canvasW * dpr));
    offscreen.height = Math.max(1, Math.ceil(canvasH * dpr));
    const ctx = offscreen.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Origin inside offscreen where (0,0) of the cell sits
    const ox = BLEED + TAB_SIZE;
    const oy = BLEED + TAB_SIZE;

    // Build clip path for this piece
    ctx.save();
    ctx.beginPath();
    _buildPiecePath(ctx, piece.tabs, cellW, cellH, ox, oy, TAB_SIZE);
    ctx.clip();

    // Draw the fitted image at its display size so the clipped piece lines up with
    // the same coordinate space used by piece geometry, independent of canvas offsets.
    ctx.drawImage(
      img,
      ox - (sourceX + imageX) * scaleX,
      oy - (sourceY + imageY) * scaleY,
      sourceImageW * scaleX,
      sourceImageH * scaleY
    );

    // Thin border
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    _buildPiecePath(ctx, piece.tabs, cellW, cellH, ox, oy, TAB_SIZE);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Store rendering metadata on the piece
    piece.canvasW = canvasW;
    piece.canvasH = canvasH;
    piece.canvasPixelW = offscreen.width;
    piece.canvasPixelH = offscreen.height;
    piece.ox = ox; // offset from canvas corner to piece cell origin
    piece.oy = oy;

    return offscreen;
  }

  /**
   * Build the bezier tab path for a piece.
   * All coords relative to offscreen canvas (ox, oy = cell origin).
   */
  function _buildPiecePath(ctx, tabs, cellW, cellH, ox, oy, TAB_SIZE) {
    ctx.moveTo(ox, oy);

    // Top edge (left → right)
    _drawEdge(ctx, ox, oy, ox + cellW, oy, -tabs.top, TAB_SIZE, 'h');

    // Right edge (top → bottom)
    _drawEdge(ctx, ox + cellW, oy, ox + cellW, oy + cellH, tabs.right, TAB_SIZE, 'v');

    // Bottom edge (right → left)
    _drawEdge(ctx, ox + cellW, oy + cellH, ox, oy + cellH, tabs.bottom, TAB_SIZE, 'h');

    // Left edge (bottom → top)
    _drawEdge(ctx, ox, oy + cellH, ox, oy, -tabs.left, TAB_SIZE, 'v');

    ctx.closePath();
  }

  /**
   * Draw one edge with a sinusoidal bump tab using cubic bezier.
   * dir: +1 = bump outward, -1 = bump inward, 0 = straight.
   * axis: 'h' = horizontal edge, 'v' = vertical edge.
   */
  function _drawEdge(ctx, x1, y1, x2, y2, dir, TAB_SIZE, axis) {
    if (dir === 0) {
      ctx.lineTo(x2, y2);
      return;
    }

    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const len = axis === 'h' ? Math.abs(x2 - x1) : Math.abs(y2 - y1);
    const bump = TAB_SIZE * dir;
    const neck = len * 0.15; // width of the tab neck relative to edge length

    if (axis === 'h') {
      // Horizontal edge: bump is in Y direction
      const sign = (x2 > x1) ? 1 : -1;
      ctx.lineTo(mx - neck * sign, y1);
      ctx.bezierCurveTo(
        mx - neck * sign, y1 + bump * 0.5,
        mx - neck * sign, y1 + bump,
        mx, y1 + bump
      );
      ctx.bezierCurveTo(
        mx + neck * sign, y1 + bump,
        mx + neck * sign, y1 + bump * 0.5,
        mx + neck * sign, y1
      );
      ctx.lineTo(x2, y2);
    } else {
      // Vertical edge: bump is in X direction
      const sign = (y2 > y1) ? 1 : -1;
      ctx.lineTo(x1, my - neck * sign);
      ctx.bezierCurveTo(
        x1 + bump * 0.5, my - neck * sign,
        x1 + bump, my - neck * sign,
        x1 + bump, my
      );
      ctx.bezierCurveTo(
        x1 + bump, my + neck * sign,
        x1 + bump * 0.5, my + neck * sign,
        x1, my + neck * sign
      );
      ctx.lineTo(x2, y2);
    }
  }

  return {
    mulberry32,
    hashSeed,
    gridDims,
    generatePieces,
    scatterPieces,
    clipPieceImage,
    BLEED,
  };
})();
