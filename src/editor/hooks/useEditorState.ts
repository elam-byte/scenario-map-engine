import { useState, useCallback } from 'react';
import type { Point, Junction, Road, Vehicle } from '@shared/types';

export type ClipboardItem =
  | { kind: 'junction'; entity: Junction }
  | { kind: 'vehicle';  entity: Vehicle }
  | { kind: 'road';     entity: Road };

export type Tool =
  | 'select'
  | 'draw-line'
  | 'draw-arc'
  | 'place-junction'
  | 'place-t-junction'
  | 'place-vehicle';

export type LineGesture = {
  phase: 'start-placed';
  start: Point;
};

export type ArcGesture =
  | { phase: 'center-placed'; center: Point }
  | { phase: 'start-placed'; center: Point; startPt: Point; clockwise: boolean };

export type DragState = {
  id: string;
  entityType: 'junction' | 'vehicle' | 'road';
  startWorld: Point;    // world point where drag started
  entityOrigin: Point;  // entity position at drag start
  currentWorld: Point;  // latest drag position (updated each mousemove)
};

export type EditorState = {
  tool: Tool;
  selectedId: string | null;
  lineGesture: LineGesture | null;
  arcGesture: ArcGesture | null;
  hoverPoint: Point | null;
  hoverSnapped: boolean; // true when hoverPoint is snapped to a feature (not just grid)
  dragState: DragState | null;
  clipboard: ClipboardItem | null;
};

export type EditorStateActions = {
  setTool: (t: Tool) => void;
  setSelectedId: (id: string | null) => void;
  setLineGesture: (g: LineGesture | null) => void;
  setArcGesture: (g: ArcGesture | null) => void;
  setHoverPoint: (p: Point | null, snapped?: boolean) => void;
  cancelGesture: () => void;
  startDrag: (drag: DragState) => void;
  updateDrag: (currentWorld: Point) => void;
  endDrag: () => void;
  setClipboard: (item: ClipboardItem | null) => void;
};

export function useEditorState(): [EditorState, EditorStateActions] {
  const [tool, setToolRaw] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lineGesture, setLineGesture] = useState<LineGesture | null>(null);
  const [arcGesture, setArcGesture] = useState<ArcGesture | null>(null);
  const [hoverPoint, setHoverPointRaw] = useState<Point | null>(null);
  const [hoverSnapped, setHoverSnapped] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardItem | null>(null);

  const setTool = useCallback((t: Tool) => {
    setToolRaw(t);
    setLineGesture(null);
    setArcGesture(null);
    setSelectedId(null);
    setDragState(null);
  }, []);

  const cancelGesture = useCallback(() => {
    setLineGesture(null);
    setArcGesture(null);
  }, []);

  const setHoverPoint = useCallback((p: Point | null, snapped = false) => {
    setHoverPointRaw(p);
    setHoverSnapped(snapped);
  }, []);

  const startDrag = useCallback((drag: DragState) => {
    setDragState(drag);
  }, []);

  const updateDrag = useCallback((currentWorld: Point) => {
    setDragState((prev) => prev ? { ...prev, currentWorld } : null);
  }, []);

  const endDrag = useCallback(() => {
    setDragState(null);
  }, []);

  const state: EditorState = {
    tool, selectedId, lineGesture, arcGesture,
    hoverPoint, hoverSnapped, dragState, clipboard,
  };
  const actions: EditorStateActions = {
    setTool,
    setSelectedId,
    setLineGesture,
    setArcGesture,
    setHoverPoint,
    cancelGesture,
    startDrag,
    updateDrag,
    endDrag,
    setClipboard,
  };

  return [state, actions];
}
