import type { Point, RoadLanes, Junction, MapModel } from './types';
import { JUNCTION_ARM_LENGTH } from './types';

// ---------------------------------------------------------------------------
// Basic math
// ---------------------------------------------------------------------------

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function snapToGrid(pt: Point, gridSize: number): Point {
  return {
    x: Math.round(pt.x / gridSize) * gridSize,
    y: Math.round(pt.y / gridSize) * gridSize,
  };
}

export function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// Road geometry helpers
// ---------------------------------------------------------------------------

export function roadHalfWidth(lanes: RoadLanes): number {
  return ((lanes.left + lanes.right) * lanes.laneWidth) / 2;
}

// ---------------------------------------------------------------------------
// Line segment geometry
// ---------------------------------------------------------------------------

/** Squared distance from point p to segment (a, b). */
export function squaredDistanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return ex * ex + ey * ey;
  }
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq, 0, 1);
  const cx = a.x + t * dx - p.x;
  const cy = a.y + t * dy - p.y;
  return cx * cx + cy * cy;
}

export function distanceToLineSegment(p: Point, a: Point, b: Point): number {
  return Math.sqrt(squaredDistanceToSegment(p, a, b));
}

// ---------------------------------------------------------------------------
// Arc geometry
// ---------------------------------------------------------------------------

/**
 * Normalise an angle to [0, 2π).
 */
export function normaliseAngle(a: number): number {
  a = a % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a;
}

/**
 * Check whether angle `theta` lies within the arc swept from `startAngle` to
 * `endAngle` in the direction specified by `clockwise`.
 */
export function angleInArc(
  theta: number,
  startAngle: number,
  endAngle: number,
  clockwise: boolean,
): boolean {
  const s = normaliseAngle(startAngle);
  const e = normaliseAngle(endAngle);
  const t = normaliseAngle(theta);

  if (!clockwise) {
    // CCW: sweep from s increasing to e
    if (s <= e) return t >= s && t <= e;
    // wraps around
    return t >= s || t <= e;
  } else {
    // CW: sweep from s decreasing to e
    if (s >= e) return t <= s && t >= e;
    // wraps around
    return t <= s || t >= e;
  }
}

/**
 * Distance from point `p` to an arc (not the full circle).
 * If `p` projects onto the arc, returns the radial distance.
 * Otherwise returns the distance to the nearer endpoint.
 */
export function distanceToArc(
  p: Point,
  center: Point,
  radius: number,
  startAngle: number,
  endAngle: number,
  clockwise: boolean,
): number {
  const theta = Math.atan2(p.y - center.y, p.x - center.x);

  if (angleInArc(theta, startAngle, endAngle, clockwise)) {
    return Math.abs(distance(p, center) - radius);
  }

  // Nearest endpoint
  const pStart: Point = {
    x: center.x + radius * Math.cos(startAngle),
    y: center.y + radius * Math.sin(startAngle),
  };
  const pEnd: Point = {
    x: center.x + radius * Math.cos(endAngle),
    y: center.y + radius * Math.sin(endAngle),
  };
  return Math.min(distance(p, pStart), distance(p, pEnd));
}

/**
 * Total angle swept by an arc (always positive).
 */
export function arcSweep(
  startAngle: number,
  endAngle: number,
  clockwise: boolean,
): number {
  const s = normaliseAngle(startAngle);
  const e = normaliseAngle(endAngle);
  if (!clockwise) {
    return s <= e ? e - s : 2 * Math.PI - s + e;
  } else {
    return s >= e ? s - e : 2 * Math.PI - e + s;
  }
}

/**
 * Compute arc parameters from a center point, a start point, and an end point.
 * The radius is determined by the distance from center to startPt.
 */
export function arcFromThreePoints(
  center: Point,
  startPt: Point,
  endPt: Point,
  _clockwise: boolean,  // stored on the road; not needed to derive angles
): { radius: number; startAngle: number; endAngle: number } {
  const radius = distance(center, startPt);
  const startAngle = Math.atan2(startPt.y - center.y, startPt.x - center.x);
  const endAngle = Math.atan2(endPt.y - center.y, endPt.x - center.x);
  return { radius, startAngle, endAngle };
}

/**
 * Sample points along an arc at approximately `step` metre intervals.
 * Returns an array of world-space points.
 */
export function sampleArc(
  center: Point,
  radius: number,
  startAngle: number,
  endAngle: number,
  clockwise: boolean,
  step = 0.5,
): Point[] {
  const sweep = arcSweep(startAngle, endAngle, clockwise);
  const numSteps = Math.max(2, Math.ceil((sweep * radius) / step));
  const points: Point[] = [];
  const dir = clockwise ? -1 : 1;
  for (let i = 0; i <= numSteps; i++) {
    const angle = startAngle + dir * (sweep * i) / numSteps;
    points.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Junction connection points
// ---------------------------------------------------------------------------

/** Index (0–3) of the closed side based on rotation: 0=south,1=east,2=north,3=west */
export function closedSideIndex(rotation: number): number {
  const idx = Math.round((rotation / (Math.PI / 2)) % 4);
  return ((idx % 4) + 4) % 4;
}

/**
 * Returns the arm-tip connection points of a junction (10 m from centre).
 * 4-way: 4 points. T-junction: 3 points (closed side excluded).
 * Order: south, east, north, west.
 */
export function junctionConnectionPoints(j: Junction): Point[] {
  const L = JUNCTION_ARM_LENGTH;
  const allTips: Point[] = [
    { x: j.x,     y: j.y - L }, // south (rotation=0 → closed)
    { x: j.x + L, y: j.y     }, // east  (rotation=π/2 → closed)
    { x: j.x,     y: j.y + L }, // north (rotation=π → closed)
    { x: j.x - L, y: j.y     }, // west  (rotation=3π/2 → closed)
  ];
  if (j.junctionType === '4-way') return allTips;
  const closedIdx = closedSideIndex(j.rotation);
  return allTips.filter((_, i) => i !== closedIdx);
}

/**
 * Snap a point to the nearest junction connection point if within `threshold`.
 * Returns the snapped point, or null if no junction is close enough.
 */
export function snapToJunction(
  pt: Point,
  junctions: Junction[],
  threshold: number,
): Point | null {
  let best: Point | null = null;
  let bestDist = threshold;
  for (const j of junctions) {
    const connPts = junctionConnectionPoints(j);
    for (const cp of connPts) {
      const d = distance(pt, cp);
      if (d < bestDist) {
        bestDist = d;
        best = cp;
      }
    }
  }
  return best;
}

/**
 * Check if a point is inside a junction's cross/T-shaped region.
 * Covers the centre box plus each open arm (10 m from centre).
 */
export function pointInJunction(pt: Point, j: Junction): boolean {
  const hw = j.laneWidth; // half road width = one lane
  const L = JUNCTION_ARM_LENGTH;
  const dx = pt.x - j.x;
  const dy = pt.y - j.y;
  // Centre intersection box
  if (Math.abs(dx) <= hw && Math.abs(dy) <= hw) return true;
  const ci = closedSideIndex(j.rotation); // 0=south,1=east,2=north,3=west
  // South arm (dir: dy < 0)
  if (ci !== 0 && Math.abs(dx) <= hw && dy >= -L && dy <= 0) return true;
  // East arm (dir: dx > 0)
  if (ci !== 1 && Math.abs(dy) <= hw && dx >= 0 && dx <= L) return true;
  // North arm (dir: dy > 0)
  if (ci !== 2 && Math.abs(dx) <= hw && dy >= 0 && dy <= L) return true;
  // West arm (dir: dx < 0)
  if (ci !== 3 && Math.abs(dy) <= hw && dx >= -L && dx <= 0) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Snapping to general features (Junctions & Roads)
// ---------------------------------------------------------------------------

/**
 * Returns all connection points for a given map model:
 * - Junction connection points
 * - Road start and end points
 */
export function getFeatureConnectionPoints(model: MapModel): Point[] {
  const points: Point[] = [];
  
  for (const j of model.junctions) {
    points.push(...junctionConnectionPoints(j));
  }
  
  for (const r of model.roads) {
    if (r.kind === 'line') {
      points.push(r.start, r.end);
    } else if (r.kind === 'arc') {
      points.push({
        x: r.center.x + r.radius * Math.cos(r.startAngle),
        y: r.center.y + r.radius * Math.sin(r.startAngle)
      }, {
        x: r.center.x + r.radius * Math.cos(r.endAngle),
        y: r.center.y + r.radius * Math.sin(r.endAngle)
      });
    }
  }
  
  return points;
}

/**
 * Snap a point to the nearest feature connection point if within `threshold`.
 * Returns the snapped point, or null if no feature is close enough.
 */
export function snapToFeatures(
  pt: Point,
  model: MapModel,
  threshold: number,
): Point | null {
  const points = getFeatureConnectionPoints(model);
  let best: Point | null = null;
  let bestDist = threshold;
  
  for (const cp of points) {
    const d = distance(pt, cp);
    if (d < bestDist) {
      bestDist = d;
      best = cp;
    }
  }
  
  return best;
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/**
 * Test if point `p` lies inside an axis-aligned rectangle centred at `center`
 * with given `halfWidth` and `halfHeight`, rotated by `angle` radians.
 */
export function pointInOrientedRect(
  p: Point,
  center: Point,
  halfLength: number,
  halfWidth: number,
  angle: number,  // heading in world space (CCW from +x)
): boolean {
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const lx = p.x - center.x;
  const ly = p.y - center.y;
  const rx = lx * cos - ly * sin;
  const ry = lx * sin + ly * cos;
  return Math.abs(rx) <= halfLength && Math.abs(ry) <= halfWidth;
}
