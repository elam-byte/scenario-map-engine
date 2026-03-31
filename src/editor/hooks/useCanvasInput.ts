import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { MapModel, RoadLine, RoadArc, Junction, Vehicle } from '@shared/types';
import {
  DEFAULT_LANE_WIDTH,
  DEFAULT_VEHICLE_LENGTH,
  DEFAULT_VEHICLE_WIDTH,
  DEFAULT_VEHICLE_COLOR,
} from '@shared/types';
import type { Viewport } from '../renderer/viewport';
import { canvasToWorld, zoomAtPoint, panByPixels } from '../renderer/viewport';
import type { EditorState, EditorStateActions, ArcGesture, DragState } from './useEditorState';
import type { MapAction } from '../store/mapReducer';
import {
  snapToGrid,
  distanceToLineSegment,
  distanceToArc,
  roadHalfWidth,
  pointInOrientedRect,
  pointInJunction,
  arcFromThreePoints,
  snapToFeatures,
} from '@shared/geometry';

const SNAP_GRID = 1; // metres
const HIT_THRESHOLD_WORLD = 3; // metres
const FEATURE_SNAP_THRESHOLD = 6; // metres — snap to junction arm tips and road endpoints

/** Tools that get feature-snapping on hover */
const SNAP_TOOLS = new Set(['draw-line', 'draw-arc', 'place-junction', 'place-t-junction', 'place-vehicle']);

let idCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}

const PASTE_OFFSET = 5; // metres

/** Returns an ID guaranteed to be higher than any existing ID number in the model. */
function nextUniqueId(prefix: string, model: MapModel): string {
  const all = [
    ...model.junctions.map((j) => j.id),
    ...model.roads.map((r) => r.id),
    ...model.vehicles.map((v) => v.id),
  ];
  let max = idCounter;
  for (const id of all) {
    const m = id.match(/-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  idCounter = max + 1;
  return `${prefix}-${idCounter}`;
}

function getCanvasPoint(canvas: HTMLCanvasElement, e: MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio ?? 1;
  return {
    x: (e.clientX - rect.left) * dpr,
    y: (e.clientY - rect.top) * dpr,
  };
}

function getEntityOrigin(id: string, model: MapModel): { pt: { x: number; y: number }; type: DragState['entityType'] } | null {
  const j = model.junctions.find((j) => j.id === id);
  if (j) return { pt: { x: j.x, y: j.y }, type: 'junction' };
  const v = model.vehicles.find((v) => v.id === id);
  if (v) return { pt: { x: v.x, y: v.y }, type: 'vehicle' };
  const r = model.roads.find((r) => r.id === id);
  if (r) {
    const pt = r.kind === 'line' ? r.start : r.center;
    return { pt, type: 'road' };
  }
  return null;
}

function hitTestEntities(
  worldPt: { x: number; y: number },
  model: MapModel,
): string | null {
  const t = HIT_THRESHOLD_WORLD;

  // Junctions — use cross/T shape hit test
  for (const j of model.junctions) {
    if (pointInJunction(worldPt, j)) return j.id;
    // Also check a small threshold around the junction center
    if (Math.abs(worldPt.x - j.x) <= t && Math.abs(worldPt.y - j.y) <= t) return j.id;
  }

  // Vehicles
  for (const v of model.vehicles) {
    if (pointInOrientedRect(worldPt, v, v.length / 2 + t / 2, v.width / 2 + t / 2, v.heading)) {
      return v.id;
    }
  }

  // Roads
  for (const road of model.roads) {
    const hw = roadHalfWidth(road.lanes) + t;
    if (road.kind === 'line') {
      if (distanceToLineSegment(worldPt, road.start, road.end) <= hw) return road.id;
    } else {
      if (distanceToArc(worldPt, road.center, road.radius, road.startAngle, road.endAngle, road.clockwise) <= hw) {
        return road.id;
      }
    }
  }

  return null;
}

export function useCanvasInput(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  viewportRef: RefObject<Viewport>,
  setViewport: (vp: Viewport) => void,
  model: MapModel,
  editorState: EditorState,
  editorActions: EditorStateActions,
  dispatch: (action: MapAction) => void,
) {
  const panRef  = useRef<{ lastX: number; lastY: number } | null>(null);
  const dragRef = useRef<{
    id: string;
    entityType: DragState['entityType'];
    startWorld: { x: number; y: number };
    entityOrigin: { x: number; y: number };
  } | null>(null);

  // Keep stable refs to avoid stale closures in event listeners
  const stateRef = useRef(editorState);
  const modelRef = useRef(model);
  stateRef.current = editorState;
  modelRef.current = model;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const vp = viewportRef.current;
      if (!vp) return;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const canvasPt = getCanvasPoint(canvas, e as unknown as MouseEvent);
      setViewport(zoomAtPoint(vp, canvasPt, factor));
    };

    const onMouseDown = (e: MouseEvent) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const canvasPt = getCanvasPoint(canvas, e);

      // Pan: middle mouse button or Alt+left
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        panRef.current = { lastX: canvasPt.x, lastY: canvasPt.y };
        e.preventDefault();
        return;
      }

      // Drag-to-move in select mode
      if (e.button === 0 && stateRef.current.tool === 'select') {
        const rawWorld = canvasToWorld(canvasPt, vp);
        const model = modelRef.current;
        const state = stateRef.current;
        const hitId = hitTestEntities(rawWorld, model);
        if (hitId && hitId === state.selectedId) {
          const info = getEntityOrigin(hitId, model);
          if (info) {
            dragRef.current = {
              id: hitId,
              entityType: info.type,
              startWorld: rawWorld,
              entityOrigin: info.pt,
            };
            editorActions.startDrag({
              id: hitId,
              entityType: info.type,
              startWorld: rawWorld,
              entityOrigin: info.pt,
              currentWorld: rawWorld,
            });
            e.preventDefault();
            return;
          }
        }
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const canvasPt = getCanvasPoint(canvas, e);

      // Pan
      if (panRef.current) {
        const dx = canvasPt.x - panRef.current.lastX;
        const dy = canvasPt.y - panRef.current.lastY;
        panRef.current = { lastX: canvasPt.x, lastY: canvasPt.y };
        setViewport(panByPixels(vp, dx, dy));
        return;
      }

      const rawWorld = canvasToWorld(canvasPt, vp);

      // Drag
      if (dragRef.current) {
        editorActions.updateDrag(rawWorld);
        return;
      }

      const state = stateRef.current;
      const model = modelRef.current;

      let hoverPt = rawWorld;
      let snapped = false;
      if (SNAP_TOOLS.has(state.tool)) {
        const featureSnap = snapToFeatures(rawWorld, model, FEATURE_SNAP_THRESHOLD);
        if (featureSnap) {
          hoverPt = featureSnap;
          snapped = true;
        } else {
          hoverPt = snapToGrid(rawWorld, SNAP_GRID);
        }
      } else {
        hoverPt = snapToGrid(rawWorld, SNAP_GRID);
      }

      editorActions.setHoverPoint(hoverPt, snapped);
    };

    const onMouseUp = (e: MouseEvent) => {
      if (panRef.current) {
        panRef.current = null;
        return;
      }

      if (dragRef.current) {
        const vp = viewportRef.current;
        if (!vp) { dragRef.current = null; editorActions.endDrag(); return; }
        const canvasPt = getCanvasPoint(canvas, e);
        const rawWorld = canvasToWorld(canvasPt, vp);
        const { id, entityType, startWorld, entityOrigin } = dragRef.current;
        const dx = rawWorld.x - startWorld.x;
        const dy = rawWorld.y - startWorld.y;
        const newX = entityOrigin.x + dx;
        const newY = entityOrigin.y + dy;

        if (entityType === 'junction') {
          dispatch({ type: 'UPDATE_JUNCTION', id, patch: { x: newX, y: newY } });
        } else if (entityType === 'vehicle') {
          dispatch({ type: 'UPDATE_VEHICLE', id, patch: { x: newX, y: newY } });
        } else {
          dispatch({ type: 'MOVE_ROAD', id, dx, dy });
        }

        dragRef.current = null;
        editorActions.endDrag();
      }
    };

    const onClick = (e: MouseEvent) => {
      if (e.altKey) return; // was pan
      // Skip clicks that were drag releases
      if (dragRef.current) return;
      const vp = viewportRef.current;
      if (!vp) return;
      const canvasPt = getCanvasPoint(canvas, e);
      const rawWorld = canvasToWorld(canvasPt, vp);
      const worldPt  = snapToGrid(rawWorld, SNAP_GRID);
      const state    = stateRef.current;
      const model    = modelRef.current;

      const featureSnap = snapToFeatures(rawWorld, model, FEATURE_SNAP_THRESHOLD);
      const snapWorldPt = featureSnap ?? worldPt;

      switch (state.tool) {
        case 'select': {
          const id = hitTestEntities(rawWorld, model);
          editorActions.setSelectedId(id);
          break;
        }

        case 'draw-line': {
          if (!state.lineGesture) {
            editorActions.setLineGesture({ phase: 'start-placed', start: snapWorldPt });
          } else {
            const { start } = state.lineGesture;
            const road: RoadLine = {
              id: nextId('r'),
              kind: 'line',
              start,
              end: snapWorldPt,
              lanes: { left: 1, right: 1, laneWidth: DEFAULT_LANE_WIDTH },
            };
            dispatch({ type: 'ADD_ROAD', road });
            editorActions.setLineGesture(null);
          }
          break;
        }

        case 'draw-arc': {
          const gesture = state.arcGesture as ArcGesture | null;
          if (!gesture) {
            editorActions.setArcGesture({ phase: 'center-placed', center: worldPt });
          } else if (gesture.phase === 'center-placed') {
            editorActions.setArcGesture({
              phase: 'start-placed',
              center: gesture.center,
              startPt: snapWorldPt,
              clockwise: e.shiftKey,
            });
          } else if (gesture.phase === 'start-placed') {
            const { center, startPt, clockwise } = gesture;
            const { radius, startAngle, endAngle } = arcFromThreePoints(center, startPt, snapWorldPt, clockwise);
            const road: RoadArc = {
              id: nextId('r'),
              kind: 'arc',
              center,
              radius,
              startAngle,
              endAngle,
              clockwise,
              lanes: { left: 1, right: 1, laneWidth: DEFAULT_LANE_WIDTH },
            };
            dispatch({ type: 'ADD_ROAD', road });
            editorActions.setArcGesture(null);
          }
          break;
        }

        case 'place-junction': {
          const junction: Junction = {
            id: nextId('j'), x: snapWorldPt.x, y: snapWorldPt.y,
            junctionType: '4-way', rotation: 0, laneWidth: DEFAULT_LANE_WIDTH,
          };
          dispatch({ type: 'ADD_JUNCTION', junction });
          break;
        }

        case 'place-t-junction': {
          const junction: Junction = {
            id: nextId('j'), x: snapWorldPt.x, y: snapWorldPt.y,
            junctionType: 't-junction', rotation: 0, laneWidth: DEFAULT_LANE_WIDTH,
          };
          dispatch({ type: 'ADD_JUNCTION', junction });
          break;
        }

        case 'place-vehicle': {
          const vehicle: Vehicle = {
            id: nextId('v'),
            x: snapWorldPt.x,
            y: snapWorldPt.y,
            heading: 0,
            length: DEFAULT_VEHICLE_LENGTH,
            width: DEFAULT_VEHICLE_WIDTH,
            color: DEFAULT_VEHICLE_COLOR,
          };
          dispatch({ type: 'ADD_VEHICLE', vehicle });
          break;
        }
      }
    };

    const onMouseLeave = () => {
      editorActions.setHoverPoint(null);
      panRef.current = null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const state = stateRef.current;
      const model = modelRef.current;

      if (e.key === 'Escape') {
        editorActions.cancelGesture();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedId) {
          dispatch({ type: 'DELETE_ENTITY', id: state.selectedId });
          editorActions.setSelectedId(null);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        dispatch({ type: 'UNDO' });
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        dispatch({ type: 'REDO' });
        return;
      }

      // Copy
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (!state.selectedId) return;
        const j = model.junctions.find((j) => j.id === state.selectedId);
        if (j) { editorActions.setClipboard({ kind: 'junction', entity: j }); return; }
        const v = model.vehicles.find((v) => v.id === state.selectedId);
        if (v) { editorActions.setClipboard({ kind: 'vehicle', entity: v }); return; }
        const r = model.roads.find((r) => r.id === state.selectedId);
        if (r) { editorActions.setClipboard({ kind: 'road', entity: r }); return; }
        return;
      }

      // Paste
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        const cb = state.clipboard;
        if (!cb) return;
        const o = PASTE_OFFSET;
        if (cb.kind === 'junction') {
          const id = nextUniqueId('j', model);
          const j = { ...cb.entity, id, x: cb.entity.x + o, y: cb.entity.y + o };
          dispatch({ type: 'ADD_JUNCTION', junction: j });
          editorActions.setSelectedId(id);
        } else if (cb.kind === 'vehicle') {
          const id = nextUniqueId('v', model);
          const v = { ...cb.entity, id, x: cb.entity.x + o, y: cb.entity.y + o };
          dispatch({ type: 'ADD_VEHICLE', vehicle: v });
          editorActions.setSelectedId(id);
        } else if (cb.kind === 'road') {
          const id = nextUniqueId('r', model);
          const r = cb.entity;
          if (r.kind === 'line') {
            dispatch({ type: 'ADD_ROAD', road: {
              ...r, id,
              start: { x: r.start.x + o, y: r.start.y + o },
              end:   { x: r.end.x   + o, y: r.end.y   + o },
            }});
          } else {
            dispatch({ type: 'ADD_ROAD', road: {
              ...r, id,
              center: { x: r.center.x + o, y: r.center.y + o },
            }});
          }
          editorActions.setSelectedId(id);
        }
        return;
      }
    };

    canvas.addEventListener('wheel',      onWheel,     { passive: false });
    canvas.addEventListener('mousedown',  onMouseDown);
    canvas.addEventListener('mousemove',  onMouseMove);
    canvas.addEventListener('mouseup',    onMouseUp);
    canvas.addEventListener('click',      onClick);
    canvas.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('keydown',    onKeyDown);

    return () => {
      canvas.removeEventListener('wheel',      onWheel);
      canvas.removeEventListener('mousedown',  onMouseDown);
      canvas.removeEventListener('mousemove',  onMouseMove);
      canvas.removeEventListener('mouseup',    onMouseUp);
      canvas.removeEventListener('click',      onClick);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('keydown',    onKeyDown);
    };
  }, [canvasRef, viewportRef, setViewport, editorActions, dispatch]);
  // Note: model and editorState are read via refs to avoid re-attaching listeners
}
