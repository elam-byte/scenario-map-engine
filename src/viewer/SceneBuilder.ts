import * as THREE from 'three';
import type { MapModel, Road, RoadLine, RoadArc, Junction } from '@shared/types';
import { JUNCTION_ARM_LENGTH } from '@shared/types';
import { sampleArc, roadHalfWidth, junctionConnectionPoints } from '@shared/geometry';

const ROAD_COLOR        = new THREE.Color('#2c2c4a');
const CENTERLINE_COLOR  = new THREE.Color('#c8a020');  // yellow — left/right divider
const LANE_EDGE_COLOR   = new THREE.Color('#ffffff');  // white — outer lane edges
const LANE_CENTER_COLOR = new THREE.Color('#888888');  // grey — per-lane dots
const JUNCTION_COLOR    = new THREE.Color('#c47a10');
const BORDER_COLOR     = new THREE.Color('#4a9eff');
const GRID_MINOR_COLOR = new THREE.Color('#ffffff').multiplyScalar(0.06);
const GRID_MAJOR_COLOR = new THREE.Color('#ffffff').multiplyScalar(0.15);

export class SceneBuilder {
  private group: THREE.Group | null = null;

  build(scene: THREE.Scene, model: MapModel): void {
    if (this.group) {
      scene.remove(this.group);
      disposeGroup(this.group);
    }

    const group = new THREE.Group();
    const { world } = model.meta;

    addGrid(group, world.width, world.height);
    addBorder(group, world.width, world.height);

    for (const road of model.roads) {
      addRoad(group, road);
    }

    for (const junction of model.junctions) {
      addJunction(group, junction);
    }

    scene.add(group);
    this.group = group;
  }

  dispose(): void {
    if (this.group) disposeGroup(this.group);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addGrid(group: THREE.Group, width: number, height: number) {
  const addLines = (step: number, color: THREE.Color) => {
    const positions: number[] = [];
    for (let x = 0; x <= width; x += step) {
      positions.push(x, 0, 0.001, x, height, 0.001);
    }
    for (let y = 0; y <= height; y += step) {
      positions.push(0, y, 0.001, width, y, 0.001);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
    group.add(new THREE.LineSegments(geo, mat));
  };
  addLines(10, GRID_MINOR_COLOR);
  addLines(100, GRID_MAJOR_COLOR);
}

function addBorder(group: THREE.Group, width: number, height: number) {
  const pts = [
    new THREE.Vector3(0,     0,      0.01),
    new THREE.Vector3(width, 0,      0.01),
    new THREE.Vector3(width, height, 0.01),
    new THREE.Vector3(0,     height, 0.01),
    new THREE.Vector3(0,     0,      0.01),
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color: BORDER_COLOR });
  group.add(new THREE.Line(geo, mat));
}

function addRoad(group: THREE.Group, road: Road) {
  if (road.kind === 'line') {
    addLineRoad(group, road);
  } else {
    addArcRoad(group, road);
  }
}

function addLineRoad(group: THREE.Group, road: RoadLine) {
  const { start, end, lanes } = road;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.01) return;

  const nx = -dy / len;
  const ny =  dx / len;
  const hw = roadHalfWidth(lanes);

  if (hw > 0) {
    const verts = [
      start.x + nx * hw, start.y + ny * hw, 0,
      end.x   + nx * hw, end.y   + ny * hw, 0,
      start.x - nx * hw, start.y - ny * hw, 0,
      end.x   - nx * hw, end.y   - ny * hw, 0,
    ];
    const indices = [0, 1, 2, 1, 3, 2];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(indices);
    const mat = new THREE.MeshBasicMaterial({ color: ROAD_COLOR, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(geo, mat));
  }

  // Lane edges
  const edgePositions: number[] = [];
  const totalLeft   = lanes.left  * lanes.laneWidth;
  const totalRight  = lanes.right * lanes.laneWidth;
  const centerOffset = (totalLeft - totalRight) / 2;

  for (let i = 0; i <= lanes.left; i++) {
    const o = centerOffset + i * lanes.laneWidth;
    edgePositions.push(start.x + nx * o, start.y + ny * o, 0.02);
    edgePositions.push(end.x   + nx * o, end.y   + ny * o, 0.02);
  }
  for (let i = 1; i <= lanes.right; i++) {
    const o = centerOffset - i * lanes.laneWidth;
    edgePositions.push(start.x + nx * o, start.y + ny * o, 0.02);
    edgePositions.push(end.x   + nx * o, end.y   + ny * o, 0.02);
  }
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
  group.add(new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: LANE_EDGE_COLOR })));

  // Centerline (yellow solid — divides left/right traffic)
  const cx = nx * centerOffset;
  const cy = ny * centerOffset;
  const clGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(start.x + cx, start.y + cy, 0.03),
    new THREE.Vector3(end.x   + cx, end.y   + cy, 0.03),
  ]);
  group.add(new THREE.Line(clGeo, new THREE.LineBasicMaterial({ color: CENTERLINE_COLOR })));

  // Per-lane center dashes (light blue dashed)
  const dashMat = new THREE.LineDashedMaterial({ color: LANE_CENTER_COLOR, dashSize: 0.6, gapSize: 2.4 });
  for (let i = 0; i < lanes.left; i++) {
    const o = centerOffset + (i + 0.5) * lanes.laneWidth;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(start.x + nx * o, start.y + ny * o, 0.025),
      new THREE.Vector3(end.x   + nx * o, end.y   + ny * o, 0.025),
    ]);
    geo.computeBoundingSphere();
    const line = new THREE.Line(geo, dashMat);
    line.computeLineDistances();
    group.add(line);
  }
  for (let i = 0; i < lanes.right; i++) {
    const o = centerOffset - (i + 0.5) * lanes.laneWidth;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(start.x + nx * o, start.y + ny * o, 0.025),
      new THREE.Vector3(end.x   + nx * o, end.y   + ny * o, 0.025),
    ]);
    const line = new THREE.Line(geo, dashMat);
    line.computeLineDistances();
    group.add(line);
  }
}

function addArcRoad(group: THREE.Group, road: RoadArc) {
  const { center, radius, startAngle, endAngle, clockwise, lanes } = road;
  // Skip degenerate (zero/tiny radius) arcs
  if (radius < 0.01) return;

  const hw           = roadHalfWidth(lanes);
  const totalLeft    = lanes.left  * lanes.laneWidth;
  const totalRight   = lanes.right * lanes.laneWidth;
  const centerOffset = (totalLeft - totalRight) / 2;

  // Sample the centerline
  const centerPts = sampleArc(center, radius + centerOffset, startAngle, endAngle, clockwise, 0.5);

  if (hw > 0 && centerPts.length >= 2) {
    const outerR  = radius + centerOffset + hw;
    const innerR  = Math.max(0, radius + centerOffset - hw);
    const outerPts = sampleArc(center, outerR, startAngle, endAngle, clockwise, 0.5);
    const innerPts = sampleArc(center, innerR, startAngle, endAngle, clockwise, 0.5);
    const n = Math.min(outerPts.length, innerPts.length);

    const verts: number[]   = [];
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      verts.push(outerPts[i].x, outerPts[i].y, 0);
      verts.push(innerPts[i].x, innerPts[i].y, 0);
      if (i < n - 1) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(indices);
    group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: ROAD_COLOR, side: THREE.DoubleSide })));
  }

  // Lane edge arcs
  const edgePositions: number[] = [];
  for (let i = 0; i <= lanes.left; i++) {
    const r   = radius + centerOffset + i * lanes.laneWidth;
    const pts = sampleArc(center, r, startAngle, endAngle, clockwise, 0.5);
    for (let j = 0; j < pts.length - 1; j++) {
      edgePositions.push(pts[j].x, pts[j].y, 0.02, pts[j + 1].x, pts[j + 1].y, 0.02);
    }
  }
  for (let i = 1; i <= lanes.right; i++) {
    const r   = Math.max(0, radius + centerOffset - i * lanes.laneWidth);
    const pts = sampleArc(center, r, startAngle, endAngle, clockwise, 0.5);
    for (let j = 0; j < pts.length - 1; j++) {
      edgePositions.push(pts[j].x, pts[j].y, 0.02, pts[j + 1].x, pts[j + 1].y, 0.02);
    }
  }
  if (edgePositions.length > 0) {
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
    group.add(new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: LANE_EDGE_COLOR })));
  }

  // Centerline (yellow solid — divides left/right traffic)
  if (centerPts.length >= 2) {
    const clPositions: number[] = [];
    for (let i = 0; i < centerPts.length - 1; i++) {
      clPositions.push(
        centerPts[i].x,     centerPts[i].y,     0.03,
        centerPts[i + 1].x, centerPts[i + 1].y, 0.03,
      );
    }
    const clGeo = new THREE.BufferGeometry();
    clGeo.setAttribute('position', new THREE.Float32BufferAttribute(clPositions, 3));
    group.add(new THREE.LineSegments(clGeo, new THREE.LineBasicMaterial({ color: CENTERLINE_COLOR })));
  }

  // Per-lane center dashes (light blue dashed)
  const dashMat = new THREE.LineDashedMaterial({ color: LANE_CENTER_COLOR, dashSize: 0.6, gapSize: 2.4 });
  const drawArcDash = (r: number) => {
    if (r <= 0) return;
    const pts = sampleArc(center, r, startAngle, endAngle, clockwise, 0.5);
    if (pts.length < 2) return;
    const vectors = pts.map((p) => new THREE.Vector3(p.x, p.y, 0.025));
    const geo = new THREE.BufferGeometry().setFromPoints(vectors);
    const line = new THREE.Line(geo, dashMat);
    line.computeLineDistances();
    group.add(line);
  };
  for (let i = 0; i < lanes.left; i++) {
    drawArcDash(radius + centerOffset + (i + 0.5) * lanes.laneWidth);
  }
  for (let i = 0; i < lanes.right; i++) {
    drawArcDash(radius + centerOffset - (i + 0.5) * lanes.laneWidth);
  }
}

function addJunction(group: THREE.Group, junction: Junction) {
  const { x, y, laneWidth } = junction;
  const hw  = laneWidth;                  // half-width of each arm
  const armL = JUNCTION_ARM_LENGTH;
  const roadMat = new THREE.MeshBasicMaterial({ color: ROAD_COLOR, side: THREE.DoubleSide });

  // --- Central pad (square covering the intersection box) ---
  const padSize = hw * 2;
  const padGeo  = new THREE.PlaneGeometry(padSize, padSize);
  const pad     = new THREE.Mesh(padGeo, roadMat);
  pad.position.set(x, y, 0);
  group.add(pad);

  // --- Arms: one quad per open direction, from pad edge to arm tip ---
  const armTips = junctionConnectionPoints(junction);
  for (const tip of armTips) {
    const dirX = tip.x - x;
    const dirY = tip.y - y;
    const len  = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len < 0.01) continue;

    const ux = dirX / len;  // unit vector along arm
    const uy = dirY / len;
    const px = -uy;         // perpendicular
    const py =  ux;

    // Arm starts at pad edge (hw from center) and extends to tip
    const s = hw;   // start offset from center
    const e = armL; // end offset from center (= arm tip distance)

    const verts = [
      x + ux * s + px * hw, y + uy * s + py * hw, 0,
      x + ux * e + px * hw, y + uy * e + py * hw, 0,
      x + ux * s - px * hw, y + uy * s - py * hw, 0,
      x + ux * e - px * hw, y + uy * e - py * hw, 0,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex([0, 1, 2, 1, 3, 2]);
    group.add(new THREE.Mesh(geo, roadMat));
  }

  // --- Junction centre dot marker ---
  const dotGeo = new THREE.CircleGeometry(1.2, 12);
  const dotMat = new THREE.MeshBasicMaterial({ color: JUNCTION_COLOR });
  const dot    = new THREE.Mesh(dotGeo, dotMat);
  dot.position.set(x, y, 0.01);
  group.add(dot);
}

function disposeGroup(group: THREE.Group) {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.LineSegments) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });
}
