import type { Junction } from '@shared/types';
import { JUNCTION_ARM_LENGTH } from '@shared/types';
import { closedSideIndex } from '@shared/geometry';
import type { Viewport } from './viewport';

const SURFACE_COLOR   = 'rgba(60,60,80,0.85)';
const EDGE_COLOR      = 'rgba(255,255,255,0.75)';
const CENTER_COLOR    = '#f59e0b';
const SELECTED_COLOR  = '#4af';
const DASH_COLOR      = '#facc15';

/** Definition of the 4 possible arms: index matches closedSideIndex convention */
const ARM_DIRS = [
  // south: dy goes negative
  { dx: 0, dy: -1, perpX: 1, perpY: 0 },
  // east: dx goes positive
  { dx: 1, dy:  0, perpX: 0, perpY: 1 },
  // north: dy goes positive
  { dx: 0, dy:  1, perpX: 1, perpY: 0 },
  // west: dx goes negative
  { dx: -1, dy: 0, perpX: 0, perpY: 1 },
];

/**
 * Draw a single junction as a cross (4-way) or T-shape (t-junction).
 */
function drawOneJunction(
  ctx: CanvasRenderingContext2D,
  j: Junction,
  selected: boolean,
  vp: Viewport,
  alpha = 1,
): void {
  const hw  = j.laneWidth;   // half road width (one lane each side)
  const L   = JUNCTION_ARM_LENGTH;
  const ci  = j.junctionType === 't-junction' ? closedSideIndex(j.rotation) : -1;
  const lw  = 0.15 / vp.zoom; // thin pixel-independent line width
  const accentColor = selected ? SELECTED_COLOR : CENTER_COLOR;

  ctx.save();
  ctx.globalAlpha = alpha;

  // ── 1. Fill road surface ─────────────────────────────────────────────────
  ctx.fillStyle = SURFACE_COLOR;

  // Centre box
  ctx.fillRect(j.x - hw, j.y - hw, hw * 2, hw * 2);

  // Arms
  for (let i = 0; i < 4; i++) {
    if (i === ci) continue;
    const { dx, dy, perpX, perpY } = ARM_DIRS[i];
    // Rectangle from the centre towards the arm tip
    ctx.fillRect(
      j.x + dx * 0 - perpX * hw,
      j.y + dy * 0 - perpY * hw,
      dx !== 0 ? dx * L : perpX * hw * 2,
      dy !== 0 ? dy * L : perpY * hw * 2,
    );
  }

  // ── 2. White edge lines ──────────────────────────────────────────────────
  ctx.strokeStyle = EDGE_COLOR;
  ctx.lineWidth   = lw;

  for (let i = 0; i < 4; i++) {
    if (i === ci) continue;
    const { dx, dy, perpX, perpY } = ARM_DIRS[i];
    const tipX = j.x + dx * L;
    const tipY = j.y + dy * L;

    // Left edge
    ctx.beginPath();
    ctx.moveTo(j.x - perpX * hw, j.y - perpY * hw);
    ctx.lineTo(tipX - perpX * hw, tipY - perpY * hw);
    ctx.stroke();

    // Right edge
    ctx.beginPath();
    ctx.moveTo(j.x + perpX * hw, j.y + perpY * hw);
    ctx.lineTo(tipX + perpX * hw, tipY + perpY * hw);
    ctx.stroke();

    // Stop line at arm tip (perpendicular)
    ctx.beginPath();
    ctx.moveTo(tipX - perpX * hw, tipY - perpY * hw);
    ctx.lineTo(tipX + perpX * hw, tipY + perpY * hw);
    ctx.stroke();
  }

  // ── 3. Dashed yellow centrelines ─────────────────────────────────────────
  ctx.strokeStyle  = DASH_COLOR;
  ctx.lineWidth    = lw;
  ctx.setLineDash([1.2, 0.8]);

  for (let i = 0; i < 4; i++) {
    if (i === ci) continue;
    const { dx, dy } = ARM_DIRS[i];
    ctx.beginPath();
    ctx.moveTo(j.x + dx * hw * 0.5, j.y + dy * hw * 0.5); // just past centre box edge
    ctx.lineTo(j.x + dx * L,        j.y + dy * L);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // ── 4. Selection / accent border on centre box ───────────────────────────
  ctx.strokeStyle = accentColor;
  ctx.lineWidth   = (selected ? 0.3 : 0.15) / vp.zoom;
  ctx.strokeRect(j.x - hw, j.y - hw, hw * 2, hw * 2);

  // ── 5. Connection-point indicators at arm tips ───────────────────────────
  ctx.fillStyle = accentColor;
  for (let i = 0; i < 4; i++) {
    if (i === ci) continue;
    const { dx, dy } = ARM_DIRS[i];
    ctx.beginPath();
    ctx.arc(j.x + dx * L, j.y + dy * L, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function drawJunctions(
  ctx: CanvasRenderingContext2D,
  junctions: Junction[],
  selectedId: string | null,
  vp: Viewport,
  dragId?: string | null,
  dragPos?: { x: number; y: number } | null,
): void {
  for (const j of junctions) {
    if (j.id === dragId && dragPos) {
      // Draw at dragged position
      drawOneJunction(ctx, { ...j, x: dragPos.x, y: dragPos.y }, j.id === selectedId, vp);
    } else {
      drawOneJunction(ctx, j, j.id === selectedId, vp);
    }
  }
}

/**
 * Ghost junction preview while placing.
 */
export function drawGhostJunction(
  ctx: CanvasRenderingContext2D,
  pt: { x: number; y: number },
  vp: Viewport,
  junctionType: '4-way' | 't-junction' = '4-way',
  rotation = 0,
  laneWidth = 3.5,
): void {
  const ghost: Junction = {
    id: '',
    x: pt.x,
    y: pt.y,
    junctionType,
    rotation,
    laneWidth,
  };
  drawOneJunction(ctx, ghost, false, vp, 0.45);
}
