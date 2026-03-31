import type { MapModel, Road, Junction, Vehicle, RoadLanes } from '@shared/types';

export type MapAction =
  | { type: 'NEW_WORLD'; world: { width: number; height: number } }
  | { type: 'ADD_ROAD'; road: Road }
  | { type: 'ADD_JUNCTION'; junction: Junction }
  | { type: 'ADD_VEHICLE'; vehicle: Vehicle }
  | { type: 'DELETE_ENTITY'; id: string }
  | { type: 'UPDATE_ROAD_LANES'; id: string; lanes: RoadLanes }
  | { type: 'MOVE_ROAD'; id: string; dx: number; dy: number }
  | { type: 'SET_ROAD_LENGTH'; id: string; length: number }
  | { type: 'UPDATE_VEHICLE'; id: string; patch: Partial<Vehicle> }
  | { type: 'UPDATE_JUNCTION'; id: string; patch: Partial<Junction> }
  | { type: 'IMPORT_MAP'; model: MapModel }
  | { type: 'UNDO' }
  | { type: 'REDO' };

export type HistoryState = {
  past: MapModel[];
  present: MapModel;
  future: MapModel[];
};

export function makeEmptyMap(width = 500, height = 281): MapModel {
  return {
    meta: {
      version: 'ats-map-v1',
      unit: 'm',
      origin: 'bottom-left',
      world: { width, height },
    },
    junctions: [],
    roads: [],
    vehicles: [],
  };
}

export function makeInitialHistory(): HistoryState {
  return { past: [], present: makeEmptyMap(), future: [] };
}

function push(history: HistoryState, next: MapModel): HistoryState {
  return {
    past: [...history.past, history.present],
    present: next,
    future: [],
  };
}

function applyPresent(history: HistoryState, fn: (m: MapModel) => MapModel): HistoryState {
  return push(history, fn(history.present));
}

export function mapReducer(state: HistoryState, action: MapAction): HistoryState {
  switch (action.type) {
    case 'NEW_WORLD':
      return push(state, makeEmptyMap(action.world.width, action.world.height));

    case 'ADD_ROAD':
      return applyPresent(state, (m) => ({ ...m, roads: [...m.roads, action.road] }));

    case 'ADD_JUNCTION':
      return applyPresent(state, (m) => ({ ...m, junctions: [...m.junctions, action.junction] }));

    case 'ADD_VEHICLE':
      return applyPresent(state, (m) => ({ ...m, vehicles: [...m.vehicles, action.vehicle] }));

    case 'DELETE_ENTITY':
      return applyPresent(state, (m) => ({
        ...m,
        roads: m.roads.filter((r) => r.id !== action.id),
        junctions: m.junctions.filter((j) => j.id !== action.id),
        vehicles: m.vehicles.filter((v) => v.id !== action.id),
      }));

    case 'UPDATE_ROAD_LANES':
      return applyPresent(state, (m) => ({
        ...m,
        roads: m.roads.map((r) =>
          r.id === action.id ? { ...r, lanes: action.lanes } : r,
        ),
      }));

    case 'MOVE_ROAD': {
      const { id, dx, dy } = action;
      return applyPresent(state, (m) => ({
        ...m,
        roads: m.roads.map((r) => {
          if (r.id !== id) return r;
          if (r.kind === 'line') {
            return {
              ...r,
              start: { x: r.start.x + dx, y: r.start.y + dy },
              end:   { x: r.end.x   + dx, y: r.end.y   + dy },
            };
          }
          return { ...r, center: { x: r.center.x + dx, y: r.center.y + dy } };
        }),
      }));
    }

    case 'SET_ROAD_LENGTH': {
      const { id, length } = action;
      if (length <= 0) return state;
      return applyPresent(state, (m) => ({
        ...m,
        roads: m.roads.map((r) => {
          if (r.id !== id) return r;
          if (r.kind === 'line') {
            const dx = r.end.x - r.start.x;
            const dy = r.end.y - r.start.y;
            const cur = Math.sqrt(dx * dx + dy * dy);
            if (cur === 0) return r;
            const scale = length / cur;
            return { ...r, end: { x: r.start.x + dx * scale, y: r.start.y + dy * scale } };
          }
          // arc: fix center + startAngle, adjust endAngle for desired arc length
          const newSweep = length / r.radius;
          const dir = r.clockwise ? -1 : 1;
          return { ...r, endAngle: r.startAngle + dir * newSweep };
        }),
      }));
    }

    case 'UPDATE_VEHICLE':
      return applyPresent(state, (m) => ({
        ...m,
        vehicles: m.vehicles.map((v) =>
          v.id === action.id ? { ...v, ...action.patch } : v,
        ),
      }));

    case 'UPDATE_JUNCTION':
      return applyPresent(state, (m) => ({
        ...m,
        junctions: m.junctions.map((j) =>
          j.id === action.id ? { ...j, ...action.patch } : j,
        ),
      }));

    case 'IMPORT_MAP':
      return push(state, action.model);

    case 'UNDO': {
      if (state.past.length === 0) return state;
      const past = [...state.past];
      const present = past.pop()!;
      return { past, present, future: [state.present, ...state.future] };
    }

    case 'REDO': {
      if (state.future.length === 0) return state;
      const [present, ...future] = state.future;
      return { past: [...state.past, state.present], present, future };
    }

    default:
      return state;
  }
}
