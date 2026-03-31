import type { Vehicle } from '@shared/types';
import type { Viewport } from './viewport';

const DEFAULT_VEHICLE_COLOR = '#22c55e';
const SELECTED_BORDER = '#4af';
const HEADING_TICK_COLOR = '#fff';

export function drawVehicles(
  ctx: CanvasRenderingContext2D,
  vehicles: Vehicle[],
  selectedId: string | null,
  vp: Viewport,
  dragId?: string | null,
  dragPos?: { x: number; y: number } | null,
): void {
  for (const rawV of vehicles) {
    const v = (rawV.id === dragId && dragPos) ? { ...rawV, x: dragPos.x, y: dragPos.y } : rawV;
    ctx.save();

    // Move to vehicle center and rotate. The Y-flip from setTransform means
    // a positive heading (CCW in world space) becomes a CW canvas rotation,
    // so we negate the heading here.
    ctx.translate(v.x, v.y);
    ctx.rotate(-v.heading);

    const hw = v.width / 2;
    const hl = v.length / 2;
    const color = v.color ?? DEFAULT_VEHICLE_COLOR;
    const selected = v.id === selectedId;

    // Body
    ctx.fillStyle = color;
    ctx.fillRect(-hl, -hw, v.length, v.width);

    // Border
    ctx.strokeStyle = selected ? SELECTED_BORDER : 'rgba(0,0,0,0.5)';
    ctx.lineWidth = selected ? 2 / vp.zoom : 0.5 / vp.zoom;
    ctx.strokeRect(-hl, -hw, v.length, v.width);

    // Heading tick (front of vehicle, +x direction)
    ctx.strokeStyle = HEADING_TICK_COLOR;
    ctx.lineWidth = 1 / vp.zoom;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(hl * 0.7, 0);
    ctx.stroke();

    ctx.restore();
  }
}

/**
 * Ghost vehicle preview while placing.
 */
export function drawGhostVehicle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  _zoom: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.translate(x, y);
  ctx.rotate(-heading);
  const hw = 0.75; // half of default 1.5 m
  const hl = 1.5;  // half of default 3.0 m
  ctx.fillStyle = DEFAULT_VEHICLE_COLOR;
  ctx.fillRect(-hl, -hw, hl * 2, hw * 2);
  ctx.restore();
}
