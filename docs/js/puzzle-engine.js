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
  function gridDims(pieceCount) {
    // Find cols x rows closest to square, matching pieceCount
    const sqrt = Math.round(Math.sqrt(pieceCount));
    // Prefer landscape-ish
    for (let cols = sqrt + 2; cols >= 1; cols--) {
      if (pieceCount % cols === 0) {
        return { cols, rows: pieceCount / cols };
      }
    }
    return { cols: sqrt, rows: Math.ceil(pieceCount / sqrt) };
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
   * @param {number} cellW  width of one cell in image coords
   * @param {number} cellH  height of one cell in image coords
   * @returns {Object[]} pieces
   */
  function generatePieces(cols, rows, rng, cellW, cellH) {
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
   * @param {HTMLImageElement} img  - full puzzle image
   * @param {Object} piece
   * @param {number} cellW  - piece width in destination pixels
   * @param {number} cellH  - piece height in destination pixels
   * @param {number} imgW   - full image display width
   * @param {number} imgH   - full image display height
   * @returns {HTMLCanvasElement}
   */
  function clipPieceImage(img, piece, cellW, cellH, imgW, imgH) {
    const TAB_SIZE = Math.min(cellW, cellH) * 0.22; // protrusion length
    const canvasW = cellW + BLEED * 2 + TAB_SIZE * 2;
    const canvasH = cellH + BLEED * 2 + TAB_SIZE * 2;

    const offscreen = document.createElement('canvas');
    offscreen.width  = Math.ceil(canvasW);
    offscreen.height = Math.ceil(canvasH);
    const ctx = offscreen.getContext('2d');

    // Origin inside offscreen where (0,0) of the cell sits
    const ox = BLEED + TAB_SIZE;
    const oy = BLEED + TAB_SIZE;

    // Build clip path for this piece
    ctx.save();
    ctx.beginPath();
    _buildPiecePath(ctx, piece.tabs, cellW, cellH, ox, oy, TAB_SIZE);
    ctx.clip();

    // Scale ratio: img displayed size → natural size
    const scaleX = img.naturalWidth  / imgW;
    const scaleY = img.naturalHeight / imgH;

    ctx.drawImage(
      img,
      piece.correctX * scaleX,        // source x
      piece.correctY * scaleY,        // source y
      cellW * scaleX + (TAB_SIZE * 2 + BLEED * 2) * scaleX,  // source w (with bleed)
      cellH * scaleY + (TAB_SIZE * 2 + BLEED * 2) * scaleY,  // source h (with bleed)
      0, 0,
      canvasW, canvasH
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
    piece.canvasW = offscreen.width;
    piece.canvasH = offscreen.height;
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
    _drawEdge(ctx, ox, oy, ox + cellW, oy, tabs.top, TAB_SIZE, 'h');

    // Right edge (top → bottom)
    _drawEdge(ctx, ox + cellW, oy, ox + cellW, oy + cellH, tabs.right, TAB_SIZE, 'v');

    // Bottom edge (right → left)
    _drawEdge(ctx, ox + cellW, oy + cellH, ox, oy + cellH, tabs.bottom, TAB_SIZE, 'h');

    // Left edge (bottom → top)
    _drawEdge(ctx, ox, oy + cellH, ox, oy, tabs.left, TAB_SIZE, 'v');

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
