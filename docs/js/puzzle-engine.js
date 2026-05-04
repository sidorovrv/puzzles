/**
 * puzzle-engine.js — Piece generation, jigsaw tab shapes, seeded PRNG.
 * Pure logic — no DOM.
 */

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────

function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function makeSeed(puzzleId, difficulty) {
  let h = 0;
  const s = puzzleId + '_' + difficulty;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

// ── Grid dimensions for each difficulty ──────────────────────────────────────

const GRID_DIMS = {
  64:  { cols: 8,  rows: 8  },
  100: { cols: 10, rows: 10 },
  144: { cols: 12, rows: 12 },
  225: { cols: 15, rows: 15 },
  400: { cols: 20, rows: 20 },
};

// ── Tab shape builder ─────────────────────────────────────────────────────────
// Generates points along an edge from (x0,y0) to (x1,y1) with a jigsaw tab.
// dir: +1 = tab sticks out to the "right" of the direction, -1 = inward

function edgePath(ctx, x0, y0, x1, y1, dir) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx*dx + dy*dy);
  // Perpendicular
  const nx = -dy / len;
  const ny =  dx / len;

  const notch = 0.3;    // tab starts/ends at 30%/70% of edge
  const bump  = 0.22;   // protrusion as fraction of edge length

  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;

  // Control points for the sinusoidal bump
  const t1x = x0 + dx * notch;
  const t1y = y0 + dy * notch;
  const t2x = x0 + dx * (0.5 - notch * 0.5);
  const t2y = y0 + dy * (0.5 - notch * 0.5);
  const tipX = mx + nx * len * bump * dir;
  const tipY = my + ny * len * bump * dir;
  const t3x = x0 + dx * (0.5 + notch * 0.5);
  const t3y = y0 + dy * (0.5 + notch * 0.5);
  const t4x = x0 + dx * (1 - notch);
  const t4y = y0 + dy * (1 - notch);

  ctx.lineTo(t1x, t1y);
  ctx.bezierCurveTo(
    t1x + nx * len * bump * dir * 0.2, t1y + ny * len * bump * dir * 0.2,
    t2x + nx * len * bump * dir,        t2y + ny * len * bump * dir,
    tipX, tipY
  );
  ctx.bezierCurveTo(
    t3x + nx * len * bump * dir,        t3y + ny * len * bump * dir,
    t4x + nx * len * bump * dir * 0.2, t4y + ny * len * bump * dir * 0.2,
    x1, y1
  );
}

// ── Piece descriptor generation ───────────────────────────────────────────────
//
// Returns an array of piece descriptors. Each descriptor contains:
//   id, row, col,
//   tabs: { top, right, bottom, left }   — +1 = outward, -1 = inward, 0 = flat (edge)
//   correctX, correctY  — position in assembled puzzle (canvas coords)
//   currentX, currentY  — current scatter position
//   rotation            — 0 (no rotation implemented in basic mode)
//   locked              — false initially

function generatePieces(puzzleId, difficulty, canvasW, canvasH) {
  const { cols, rows } = GRID_DIMS[difficulty];
  const rng = mulberry32(makeSeed(puzzleId, difficulty));

  const pieceW = canvasW / cols;
  const pieceH = canvasH / rows;

  // Pre-assign tab directions for every shared edge
  // Horizontal edges (between row r and r+1 at column c): hTabs[r][c]
  // Vertical edges   (between col c and c+1 at row r):    vTabs[r][c]

  const hTabs = Array.from({ length: rows - 1 }, () =>
    Array.from({ length: cols }, () => (rng() < 0.5 ? 1 : -1))
  );
  const vTabs = Array.from({ length: rows }, () =>
    Array.from({ length: cols - 1 }, () => (rng() < 0.5 ? 1 : -1))
  );

  const pieces = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = r * cols + c;

      // Tabs relative to THIS piece: outward = +1, inward = -1
      const top    = r === 0         ? 0 :  hTabs[r-1][c];        // top edge
      const bottom = r === rows - 1  ? 0 : -hTabs[r][c];          // bottom = opposite of shared edge
      const left   = c === 0         ? 0 :  vTabs[r][c-1];
      const right  = c === cols - 1  ? 0 : -vTabs[r][c];

      const correctX = c * pieceW;
      const correctY = r * pieceH;

      // Scatter into a wide area around the canvas
      const scatterW = canvasW * 1.6;
      const scatterH = canvasH * 1.6;
      const currentX = rng() * scatterW - scatterW * 0.3;
      const currentY = rng() * scatterH - scatterH * 0.3;

      pieces.push({
        id, row: r, col: c,
        tabs: { top, right, bottom, left },
        correctX, correctY,
        currentX, currentY,
        rotation: 0,
        locked: false,
        pieceW, pieceH,
      });
    }
  }

  return pieces;
}

// ── Render a single piece to an offscreen canvas ──────────────────────────────
// Returns an ImageBitmap (or canvas) clipped to the jigsaw shape.
// srcImg: HTMLImageElement, imgW/imgH: natural dimensions of source image
// piece: descriptor from generatePieces

function renderPieceToCanvas(piece, srcImg, displayW, displayH) {
  const BLEED = Math.min(piece.pieceW, piece.pieceH) * 0.25;
  const oc = new OffscreenCanvas
    ? new OffscreenCanvas(piece.pieceW + BLEED * 2, piece.pieceH + BLEED * 2)
    : (() => { const c = document.createElement('canvas'); c.width = piece.pieceW + BLEED * 2; c.height = piece.pieceH + BLEED * 2; return c; })();

  const ctx = oc.getContext('2d');
  const pw = piece.pieceW;
  const ph = piece.pieceH;
  const ox = BLEED; // offset so clipping has room for tabs
  const oy = BLEED;

  // Build clip path
  ctx.beginPath();
  ctx.moveTo(ox, oy);

  // Top edge
  if (piece.tabs.top === 0) {
    ctx.lineTo(ox + pw, oy);
  } else {
    edgePath(ctx, ox, oy, ox + pw, oy, piece.tabs.top);
  }

  // Right edge
  if (piece.tabs.right === 0) {
    ctx.lineTo(ox + pw, oy + ph);
  } else {
    edgePath(ctx, ox + pw, oy, ox + pw, oy + ph, piece.tabs.right);
  }

  // Bottom edge (reversed direction)
  if (piece.tabs.bottom === 0) {
    ctx.lineTo(ox, oy + ph);
  } else {
    edgePath(ctx, ox + pw, oy + ph, ox, oy + ph, piece.tabs.bottom);
  }

  // Left edge (reversed direction)
  if (piece.tabs.left === 0) {
    ctx.lineTo(ox, oy);
  } else {
    edgePath(ctx, ox, oy + ph, ox, oy, piece.tabs.left);
  }

  ctx.closePath();

  // Subtle drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur  = 6;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  ctx.clip();

  // Draw the slice of the source image
  const scaleX = displayW / srcImg.naturalWidth;
  const scaleY = displayH / srcImg.naturalHeight;

  ctx.drawImage(
    srcImg,
    piece.correctX / scaleX,                    // sx
    piece.correctY / scaleY,                    // sy
    pw / scaleX,                                // sw
    ph / scaleY,                                // sh
    ox,                                         // dx
    oy,                                         // dy
    pw,                                         // dw
    ph                                          // dh
  );
  ctx.restore();

  // Subtle border on piece edge
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  if (piece.tabs.top === 0) ctx.lineTo(ox + pw, oy); else edgePath(ctx, ox, oy, ox + pw, oy, piece.tabs.top);
  if (piece.tabs.right === 0) ctx.lineTo(ox + pw, oy + ph); else edgePath(ctx, ox + pw, oy, ox + pw, oy + ph, piece.tabs.right);
  if (piece.tabs.bottom === 0) ctx.lineTo(ox, oy + ph); else edgePath(ctx, ox + pw, oy + ph, ox, oy + ph, piece.tabs.bottom);
  if (piece.tabs.left === 0) ctx.lineTo(ox, oy); else edgePath(ctx, ox, oy + ph, ox, oy, piece.tabs.left);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  return oc;
}

// Expose
window.PuzzleEngine = {
  generatePieces,
  renderPieceToCanvas,
  GRID_DIMS,
};
