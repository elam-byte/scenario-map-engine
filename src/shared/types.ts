export type Point = { x: number; y: number };

export type WorldMeta = {
  version: 'ats-map-v1';
  unit: 'm';
  origin: 'bottom-left';
  world: { width: number; height: number };
};

export type JunctionType = '4-way' | 't-junction';

/** Each junction arm extends this many metres from the junction centre */
export const JUNCTION_ARM_LENGTH = 10;

export type Junction = {
  id: string;
  x: number;
  y: number;
  junctionType: JunctionType;
  /** Rotation in radians (multiples of π/2). For T-junction, determines which side is closed.
   *  0 = south closed, π/2 = east closed, π = north closed, 3π/2 = west closed */
  rotation: number;
  /** Lane width for this junction's arms (m). Default DEFAULT_LANE_WIDTH */
  laneWidth: number;
};

/** Lanes relative to travel direction (start → end / startAngle → endAngle) */
export type RoadLanes = {
  left: number;      // lanes to the left
  right: number;     // lanes to the right
  laneWidth: number; // meters, default 3.5, range [2.8, 4.0]
};

export type RoadLine = {
  id: string;
  kind: 'line';
  start: Point;
  end: Point;
  lanes: RoadLanes;
  speedLimit?: number; // m/s
};

export type RoadArc = {
  id: string;
  kind: 'arc';
  center: Point;
  radius: number;
  startAngle: number; // radians
  endAngle: number;   // radians
  clockwise: boolean;
  lanes: RoadLanes;
  speedLimit?: number; // m/s
};

export type Road = RoadLine | RoadArc;

export type Vehicle = {
  id: string;
  x: number;
  y: number;
  heading: number; // radians, 0 = +x, CCW positive
  length: number;  // default 3.0 m
  width: number;   // default 1.5 m
  color?: string;  // CSS hex
};

export type MapModel = {
  meta: WorldMeta;
  junctions: Junction[];
  roads: Road[];
  vehicles: Vehicle[];
};

/** Runtime message: 20 Hz snapshot from simulator */
export type WorldSnapshot = {
  t: number; // tick index
  vehicles: Array<{
    id: string;
    x: number;
    y: number;
    heading: number;
    length: number;
    width: number;
    color?: string;
  }>;
};

/** Optional command from viewer UI back to simulator */
export type VehicleCommand = {
  t: number;
  id: string;
  desired_accel: number;
  desired_steer: number;
};

export const DEFAULT_LANE_WIDTH = 3.5;
export const DEFAULT_VEHICLE_LENGTH = 3.0;
export const DEFAULT_VEHICLE_WIDTH = 1.5;
export const DEFAULT_VEHICLE_COLOR = '#22c55e';

/** Available world sizes (16:9 aspect ratio) */
export const WORLD_SIZES = [
  { width: 500,  height: 281 },
  { width: 1000, height: 562 },
] as const;
export type WorldSize = typeof WORLD_SIZES[number];
