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
import type { EditorState, EditorStateActions, ArcGesture } from './useEditorState';
import type { MapAction } from '../store/mapReducer';
import {
  snapToGrid,
  distanceToLineSegment,
  distanceToArc,
  roadHalfWidth,
  pointInOrientedRect,
  arcFromThreePoints,
  snapToFeatures,
} from '@shared/geometry';
import { JUNCTION_HALF } from '@shared/types';

const SNAP_GRID = 1; // metres
const HIT_THRESHOLD_WORLD = 3; // metres
const JUNCTION_SNAP_THRESHOLD = 6; // metres — snap road endpoints to junction edges

let idCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}

function getCanvasPoint(canvas: HTMLCanvasElement, e: MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio ?? 1;
  return {
    x: (e.clientX - rect.left) * dpr,
    y: (e.clientY - rect.top) * dpr,
  };
}

function hitTestEntities(
  worldPt: { x: number; y: number },
  model: MapModel,
): string | null {
  const t = HIT_THRESHOLD_WORLD;

  // Junctions first — 10m square hit area
  for (const j of model.junctions) {
    const h = JUNCTION_HALF + t;
    if (Math.abs(worldPt.x - j.x) <= h && Math.abs(worldPt.y - j.y) <= h) return j.id;
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
  const panRef = useRef<{ lastX: number; lastY: number } | null>(null);
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
      const state = stateRef.current;
      const model = modelRef.current;
      
      let hoverPt = rawWorld;
      if (state.tool === 'draw-line' || state.tool === 'draw-arc') {
        hoverPt = snapToFeatures(rawWorld, model, JUNCTION_SNAP_THRESHOLD) ?? snapToGrid(rawWorld, SNAP_GRID);
      } else {
        hoverPt = snapToGrid(rawWorld, SNAP_GRID);
      }
      
      editorActions.setHoverPoint(hoverPt);
    };

    const onMouseUp = (_e: MouseEvent) => {
      if (panRef.current) {
        panRef.current = null;
      }
    };

    const onClick = (e: MouseEvent) => {
      if (e.altKey) return; // was pan
      const vp = viewportRef.current;
      if (!vp) return;
      const canvasPt = getCanvasPoint(canvas, e);
      const rawWorld = canvasToWorld(canvasPt, vp);
      const worldPt = snapToGrid(rawWorld, SNAP_GRID);
      const state = stateRef.current;
      const model = modelRef.current;
      
      const snapWorldPt = snapToFeatures(rawWorld, model, JUNCTION_SNAP_THRESHOLD) ?? worldPt;

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
            id: nextId('j'), x: worldPt.x, y: worldPt.y,
            junctionType: '4-way', rotation: 0,
          };
          dispatch({ type: 'ADD_JUNCTION', junction });
          break;
        }

        case 'place-t-junction': {
          const junction: Junction = {
            id: nextId('j'), x: worldPt.x, y: worldPt.y,
            junctionType: 't-junction', rotation: 0,
          };
          dispatch({ type: 'ADD_JUNCTION', junction });
          break;
        }

        case 'place-vehicle': {
          const vehicle: Vehicle = {
            id: nextId('v'),
            x: worldPt.x,
            y: worldPt.y,
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
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [canvasRef, viewportRef, setViewport, editorActions, dispatch]);
  // Note: model and editorState are read via refs to avoid re-attaching listeners
}
