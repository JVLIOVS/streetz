/**
 * Map data contract. A map is pure data (no three.js, no Rapier): the sim builds
 * colliders from it and the renderer builds meshes from it.
 * Units: meters. Ground level y = 0. Boxes are centered on (x, z); y is the base unless noted.
 */

export type BuildingStyle = 0 | 1 | 2 | 3; // see BUILDING_STYLE
export const BUILDING_STYLE = { haussmann: 0, tower: 1, shop: 2, landmark: 3 } as const;

export interface BuildingDef {
  x: number;
  z: number;
  /** Footprint along x and z, wall height (roof excluded). */
  w: number;
  d: number;
  h: number;
  /** Mansard / roof block height on top of the walls. */
  roofH: number;
  style: BuildingStyle;
  color: number;
  roofColor: number;
}

export type RoadKind = 'street' | 'boulevard' | 'highway' | 'intersection';

export interface RoadDef {
  x: number;
  z: number;
  /** Size along x / z. */
  w: number;
  d: number;
  /** Direction of travel: 'x' or 'z'; intersections have none. */
  axis: 'x' | 'z' | null;
  kind: RoadKind;
  /** y of the asphalt surface (bridges are at 0 too, quays are lower). */
  y: number;
}

/** Generic solid box: ground slabs, quays, bridges, ramps, walls, parapets. y is the center. */
export interface SolidDef {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  /** Rotation around Z (ramps along x) and Y, radians. */
  rotZ?: number;
  rotY?: number;
  color: number;
  kind: 'ground' | 'quay' | 'riverbed' | 'bridge' | 'ramp' | 'wall' | 'parapet' | 'plaza' | 'grass';
  /** Purely visual (no collider) — e.g. grass patches lying on a ground slab. */
  noCollide?: boolean;
}

export interface TerrainDef {
  /** Min corner and size of the heightfield, in world space. */
  x0: number;
  z0: number;
  sizeX: number;
  sizeZ: number;
  /** Grid resolution (cells). heights has (res+1)^2 samples, row-major: heights[iz * (res+1) + ix]. */
  res: number;
  heights: Float32Array;
}

export interface TreeDef {
  x: number;
  y: number;
  z: number;
  s: number;
}

export interface FountainDef {
  x: number;
  z: number;
  r: number;
}

export type PoiKind =
  | 'police'
  | 'hospital'
  | 'garage'
  | 'bank'
  | 'jewelry'
  | 'shop'
  | 'airport'
  | 'hideout'
  | 'fountain'
  | 'gunshop'
  | 'clothes'
  | 'dealer'
  | 'apartment';

export interface PoiDef {
  id: string;
  kind: PoiKind;
  name: string;
  x: number;
  z: number;
}

export type ZoneKind = 'haussmann' | 'cites' | 'commercial' | 'park' | 'river' | 'ring';

export interface ZoneDef {
  id: string;
  name: string;
  kind: ZoneKind;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface WaterDef {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
}

/** Asphalt-free city block (sidewalk included). Pedestrians walk around it. */
export interface BlockDef {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  kind: 'haussmann' | 'cites' | 'commercial' | 'place' | 'special';
}

export type InteriorKind = 'shop' | 'bank' | 'jewelry' | 'police' | 'hospital' | 'hideout' | 'gunshop' | 'clothes' | 'dealer' | 'apartment';

/**
 * Enterable building. The room itself is built off-map at `origin` (x > 1000) and
 * the player is teleported through the door.
 */
export interface InteriorDef {
  id: string;
  kind: InteriorKind;
  name: string;
  /** Door on the facade; yaw = direction you face when walking out (0 = -z). */
  door: { x: number; z: number; yaw: number };
  origin: { x: number; z: number };
  w: number;
  d: number;
  sign: string;
  signColor: number;
}

export interface ParkingSpot {
  x: number;
  z: number;
  yaw: number;
}

export type PropKind = 'streetlight' | 'trafficlight' | 'bench' | 'trash' | 'hydrant' | 'dumpster' | 'bush' | 'bollard';

export interface PropDef {
  kind: PropKind;
  x: number;
  z: number;
  yaw: number;
}

export interface MapData {
  id: string;
  name: string;
  /** Half extent: the map covers [-half, half] on x and z. */
  half: number;
  seed: number;
  spawn: { x: number; y: number; z: number; yaw: number };
  buildings: BuildingDef[];
  roads: RoadDef[];
  solids: SolidDef[];
  terrain: TerrainDef | null;
  water: WaterDef[];
  trees: TreeDef[];
  fountains: FountainDef[];
  pois: PoiDef[];
  zones: ZoneDef[];
  blocks: BlockDef[];
  interiors: InteriorDef[];
  parking: ParkingSpot[];
  props: PropDef[];
  /** Hand-placed vehicles (always present): type ids from src/data/vehicles.ts. */
  featured: { type: string; x: number; z: number; yaw: number }[];
  /** Below this y the player is considered drowned / out of the world. */
  killY: number;
}
