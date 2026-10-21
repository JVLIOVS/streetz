/**
 * "Paris" prototype map — a fictional district inspired by Paris (~1 km²).
 * Everything is generated deterministically from a seed so every client
 * (and later the server) gets exactly the same city.
 *
 *            z = -500 (south)                      z = +500 (north)
 *   ┌───────────────── périphérique (ring road at ±465) ─────────────────┐
 *   │ cités (SW)        haussmann grid        river z∈[130,200] + quays    │
 *   │                   commercial (E)        park with hills (NE)         │
 *   └─────────────────────────────────────────────────────────────────────┘
 */
import { Rng } from '../../core/rng';
import {
  BUILDING_STYLE,
  type BlockDef,
  type BuildingDef,
  type FountainDef,
  type InteriorDef,
  type ParkingSpot,
  type PropDef,
  type MapData,
  type PoiDef,
  type RoadDef,
  type SolidDef,
  type TerrainDef,
  type TreeDef,
  type ZoneDef,
} from '../types';
import { terrainHeight, terrainSlope } from '../terrain';

const HALF = 500;
const RING = 465;
const RING_W = 22;
const SIDEWALK = 4;

interface Line {
  c: number;
  w: number;
  kind: 'street' | 'boulevard' | 'highway';
}

/** Streets running along z (constant x). */
const XS: Line[] = [
  { c: -RING, w: RING_W, kind: 'highway' },
  { c: -380, w: 12, kind: 'street' },
  { c: -305, w: 12, kind: 'street' },
  { c: -230, w: 24, kind: 'boulevard' },
  { c: -155, w: 12, kind: 'street' },
  { c: -80, w: 12, kind: 'street' },
  { c: 0, w: 26, kind: 'boulevard' },
  { c: 80, w: 12, kind: 'street' },
  { c: 155, w: 12, kind: 'street' },
  { c: 230, w: 24, kind: 'boulevard' },
  { c: 305, w: 12, kind: 'street' },
  { c: 380, w: 12, kind: 'street' },
  { c: RING, w: RING_W, kind: 'highway' },
];

/** Streets running along x (constant z). 120 / 210 are the quay roads on each bank. */
const ZS: Line[] = [
  { c: -RING, w: RING_W, kind: 'highway' },
  { c: -380, w: 12, kind: 'street' },
  { c: -305, w: 12, kind: 'street' },
  { c: -230, w: 24, kind: 'boulevard' },
  { c: -155, w: 12, kind: 'street' },
  { c: -80, w: 12, kind: 'street' },
  { c: 0, w: 26, kind: 'boulevard' },
  { c: 60, w: 12, kind: 'street' },
  { c: 120, w: 16, kind: 'street' },
  { c: 210, w: 16, kind: 'street' },
  { c: 290, w: 12, kind: 'street' },
  { c: 370, w: 12, kind: 'street' },
  { c: RING, w: RING_W, kind: 'highway' },
];

// River and quays
export const RIVER = { z0: 140, z1: 190, waterY: -4.5, quayY: -3.5, quayZ0: 130, quayZ1: 200 };
/** x positions of the streets that cross the river on a bridge. */
const BRIDGES = [-RING, -230, 0, 230, RING];

export const PARK = { x0: 161, z0: 218, x1: RING - RING_W / 2, z1: RING - RING_W / 2 };
const CITES = { x0: -RING, z0: -RING, x1: -218, z1: -218 };
const COMMERCIAL = { x0: 40, z0: -240, x1: 270, z1: -15 };

const PALETTE = {
  haussmann: [0xf4e4c6, 0xefdbb6, 0xf6ecd6, 0xead2a8, 0xf2dfbd, 0xf8e8cf],
  mansard: [0x4c5a78, 0x55658a, 0x5f6f92, 0x48546d],
  cites: [0xe6dccb, 0xd9cfbf, 0xf0d9a8, 0xcfd8de, 0xe9c9b5],
  shop: [0xff6b6b, 0x4ecdc4, 0xffd166, 0x6a8cff, 0xf78fb3, 0x95e06c, 0xffa94d],
  flatRoof: [0x8d8f99, 0x9a9ca6, 0x7f828c],
};

const COLORS = {
  sidewalk: 0xd9d1c1,
  quay: 0xc7b9a0,
  stone: 0xbfae91,
  riverbed: 0x3d5a63,
  plaza: 0xe8dcc4,
  grass: 0x7ccf5a,
  wall: 0xb9b4aa,
};

function inRect(x: number, z: number, r: { x0: number; z0: number; x1: number; z1: number }) {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

function crossesRiver(z0: number, z1: number) {
  return z0 < RIVER.quayZ1 && z1 > RIVER.quayZ0;
}

export function buildParisMap(seed = 1789): MapData {
  const rng = new Rng(seed);
  const buildings: BuildingDef[] = [];
  const roads: RoadDef[] = [];
  const solids: SolidDef[] = [];
  const trees: TreeDef[] = [];
  const fountains: FountainDef[] = [];
  const pois: PoiDef[] = [];
  const blocks: BlockDef[] = [];
  const interiors: InteriorDef[] = [];
  const parking: ParkingSpot[] = [];
  const props: PropDef[] = [];
  const INTERIOR_SIZE: Record<InteriorDef['kind'], [number, number]> = {
    shop: [14, 12],
    bank: [24, 18],
    jewelry: [14, 12],
    police: [18, 14],
    hospital: [18, 14],
    hideout: [14, 12],
  };
  const SHOP_NAMES = ['Supérette Miam', 'Proxi Lune', 'Épicerie Chez Momo', '8 à Minuit', 'Mini Prix Bellevue'];
  const addInterior = (kind: InteriorDef['kind'], name: string, sign: string, signColor: number, door: InteriorDef['door']) => {
    const [w, d] = INTERIOR_SIZE[kind];
    const id = `${kind}-${interiors.length}`;
    interiors.push({ id, kind, name, door, origin: { x: 1100 + interiors.length * 50, z: 0 }, w, d, sign, signColor });
    return id;
  };

  // ---------------------------------------------------------------- ground
  const groundSlab = (z0: number, z1: number, top: number, kind: SolidDef['kind'], color: number) => {
    const thick = 4;
    solids.push({ x: 0, y: top - thick / 2, z: (z0 + z1) / 2, sx: HALF * 2, sy: thick, sz: z1 - z0, color, kind });
  };
  groundSlab(-HALF, RIVER.quayZ0, 0, 'ground', COLORS.sidewalk);
  groundSlab(RIVER.quayZ0, RIVER.z0, RIVER.quayY, 'quay', COLORS.quay);
  groundSlab(RIVER.z0, RIVER.z1, -10, 'riverbed', COLORS.riverbed);
  groundSlab(RIVER.z1, RIVER.quayZ1, RIVER.quayY, 'quay', COLORS.quay);
  groundSlab(RIVER.quayZ1, HALF, 0, 'ground', COLORS.sidewalk);

  // Ramps from street level down to the quays (gentle slope, walkable and drivable).
  const ramp = (xHigh: number, xLow: number, zc: number) => {
    const len = Math.abs(xHigh - xLow);
    const drop = -RIVER.quayY;
    const angle = Math.atan2(drop, len) * Math.sign(xLow - xHigh);
    const thick = 1;
    const cx = (xHigh + xLow) / 2;
    // Top surface goes from y=0 at xHigh to quayY at xLow; offset the center down by half thickness.
    solids.push({
      x: cx,
      y: RIVER.quayY / 2 - thick / 2,
      z: zc,
      sx: Math.hypot(len, drop),
      sy: thick,
      sz: 9.6,
      rotZ: -angle,
      color: COLORS.stone,
      kind: 'ramp',
    });
  };
  const RAMP_GAPS: [number, number][] = [
    [-116, -108],
    [108, 116],
  ];
  for (const zc of [(RIVER.quayZ0 + RIVER.z0) / 2, (RIVER.z1 + RIVER.quayZ1) / 2]) {
    ramp(-108, -150, zc);
    ramp(108, 150, zc);
  }

  // Map boundary: concrete sound walls just outside the ring road.
  const wallH = 8;
  for (const s of [-1, 1]) {
    solids.push({ x: 0, y: wallH / 2, z: s * 492, sx: HALF * 2, sy: wallH, sz: 4, color: COLORS.wall, kind: 'wall' });
    solids.push({ x: s * 492, y: wallH / 2, z: 0, sx: 4, sy: wallH, sz: HALF * 2, color: COLORS.wall, kind: 'wall' });
  }

  // ---------------------------------------------------------------- roads
  const parkHas = (x: number, z: number) => inRect(x, z, PARK);

  // Intersections
  for (const lx of XS) {
    for (const lz of ZS) {
      if (parkHas(lx.c, lz.c) && lx.kind !== 'highway' && lz.kind !== 'highway') continue;
      roads.push({ x: lx.c, z: lz.c, w: lx.w, d: lz.w, axis: null, kind: 'intersection', y: 0 });
    }
  }
  // Segments of streets along z (between consecutive ZS lines)
  for (const lx of XS) {
    for (let j = 0; j < ZS.length - 1; j++) {
      const a = ZS[j].c + ZS[j].w / 2;
      const b = ZS[j + 1].c - ZS[j + 1].w / 2;
      const cz = (a + b) / 2;
      if (lx.kind !== 'highway' && parkHas(lx.c, cz)) continue;
      const bridge = crossesRiver(a, b);
      if (bridge && !BRIDGES.includes(lx.c)) continue;
      roads.push({ x: lx.c, z: cz, w: lx.w, d: b - a, axis: 'z', kind: lx.kind, y: 0 });
      if (bridge) addBridge(lx.c, lx.w, a, b);
    }
  }
  // Segments of streets along x (between consecutive XS lines)
  for (const lz of ZS) {
    for (let i = 0; i < XS.length - 1; i++) {
      const a = XS[i].c + XS[i].w / 2;
      const b = XS[i + 1].c - XS[i + 1].w / 2;
      const cx = (a + b) / 2;
      if (lz.kind !== 'highway' && parkHas(cx, lz.c)) continue;
      roads.push({ x: cx, z: lz.c, w: b - a, d: lz.w, axis: 'x', kind: lz.kind, y: 0 });
    }
  }

  function addBridge(x: number, roadW: number, z0: number, z1: number) {
    const w = roadW + SIDEWALK * 2;
    const deckT = 1.0;
    const len = z1 - z0 + 4;
    const zc = (z0 + z1) / 2;
    solids.push({ x, y: -deckT / 2, z: zc, sx: w, sy: deckT, sz: len, color: COLORS.stone, kind: 'bridge' });
    for (const s of [-1, 1]) {
      solids.push({ x: x + s * (w / 2 - 0.4), y: 0.55, z: zc, sx: 0.8, sy: 1.1, sz: len, color: COLORS.stone, kind: 'parapet' });
    }
    // Two piers standing in the water
    for (const pz of [RIVER.z0 + 16, RIVER.z1 - 16]) {
      solids.push({ x, y: -5.5, z: pz, sx: w * 0.6, sy: 9, sz: 5, color: COLORS.stone, kind: 'wall' });
    }
  }

  // Quay-side parapets along both banks (street level), open at bridges and ramp tops.
  const gaps: [number, number][] = [...RAMP_GAPS];
  for (const bx of BRIDGES) {
    const w = XS.find((l) => l.c === bx)!.w / 2 + SIDEWALK;
    gaps.push([bx - w, bx + w]);
  }
  gaps.sort((a, b) => a[0] - b[0]);
  for (const zEdge of [RIVER.quayZ0 - 0.4, RIVER.quayZ1 + 0.4]) {
    let a = -HALF;
    for (const [g0, g1] of [...gaps, [HALF, HALF] as [number, number]]) {
      if (g0 - a > 1) {
        solids.push({ x: (a + g0) / 2, y: 0.5, z: zEdge, sx: g0 - a, sy: 1, sz: 0.8, color: COLORS.stone, kind: 'parapet' });
      }
      a = Math.max(a, g1);
    }
  }

  // ---------------------------------------------------------------- blocks
  const placeCenters = [
    { x: -40, z: -40, name: 'Place des Lilas' },
    { x: -190, z: 90, name: 'Place du Marché-Vieux' },
    { x: 115, z: 250, name: 'Square Montclair' },
  ];

  interface Special {
    x: number;
    z: number;
    kind: PoiDef['kind'];
    id: string;
    name: string;
    color: number;
    h: number;
  }
  const specials: Special[] = [
    { x: -40, z: -117, kind: 'police', id: 'police', name: 'Commissariat Central', color: 0x3f6fd8, h: 16 },
    { x: -190, z: 30, kind: 'hospital', id: 'hospital', name: 'Hôpital Sainte-Aube', color: 0xf5f7fa, h: 24 },
    { x: 340, z: -340, kind: 'garage', id: 'garage', name: 'Garage Turbo Max', color: 0xff8c2a, h: 9 },
    { x: 115, z: -117, kind: 'bank', id: 'bank', name: 'Banque Lumière', color: 0xe9e0c9, h: 22 },
    { x: 190, z: -117, kind: 'jewelry', id: 'jewelry', name: 'Bijouterie Saphir', color: 0x7a4fd6, h: 12 },
    { x: -340, z: -340, kind: 'hideout', id: 'hideout', name: 'La Planque', color: 0x8a6d4f, h: 10 },
    { x: -420, z: 420, kind: 'airport', id: 'airport', name: 'Aéroport Porte-d’Or', color: 0xcfe6ff, h: 14 },
  ];

  const blockContains = (bx0: number, bz0: number, bx1: number, bz1: number, p: { x: number; z: number }) =>
    p.x >= bx0 && p.x <= bx1 && p.z >= bz0 && p.z <= bz1;

  for (let i = 0; i < XS.length - 1; i++) {
    for (let j = 0; j < ZS.length - 1; j++) {
      // Asphalt-free block rectangle, then sidewalk inset
      const x0 = XS[i].c + XS[i].w / 2;
      const x1 = XS[i + 1].c - XS[i + 1].w / 2;
      const z0 = ZS[j].c + ZS[j].w / 2;
      const z1 = ZS[j + 1].c - ZS[j + 1].w / 2;
      if (crossesRiver(z0, z1)) continue;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      if (inRect(cx, cz, PARK)) continue;
      const bx0 = x0 + SIDEWALK;
      const bx1 = x1 - SIDEWALK;
      const bz0 = z0 + SIDEWALK;
      const bz1 = z1 - SIDEWALK;

      const place = placeCenters.find((p) => blockContains(x0, z0, x1, z1, p));
      const special = specials.find((p) => blockContains(x0, z0, x1, z1, p));
      const kind: BlockDef['kind'] = place ? 'place' : special ? 'special' : inRect(cx, cz, CITES) ? 'cites' : inRect(cx, cz, COMMERCIAL) ? 'commercial' : 'haussmann';
      blocks.push({ x0, z0, x1, z1, kind });
      streetFurniture(x0, z0, x1, z1, kind);
      if (place) makePlace(bx0, bz0, bx1, bz1, place.name);
      else if (special) makeSpecial(bx0, bz0, bx1, bz1, special);
      else if (kind === 'cites') fillCites(bx0, bz0, bx1, bz1);
      else if (kind === 'commercial') fillCommercial(bx0, bz0, bx1, bz1);
      else fillHaussmann(bx0, bz0, bx1, bz1);
    }
  }

  function pushBuilding(x0: number, z0: number, x1: number, z1: number, h: number, roofH: number, style: number, color: number, roofColor: number) {
    buildings.push({
      x: (x0 + x1) / 2,
      z: (z0 + z1) / 2,
      w: x1 - x0,
      d: z1 - z0,
      h,
      roofH,
      style: style as BuildingDef['style'],
      color,
      roofColor,
    });
  }

  /** Split [a, b] in segments of roughly [minLen, maxLen]. */
  function split(a: number, b: number, minLen: number, maxLen: number): number[] {
    const cuts = [a];
    let p = a;
    while (b - p > maxLen) {
      p += rng.range(minLen, maxLen);
      if (b - p < minLen) break;
      cuts.push(p);
    }
    cuts.push(b);
    return cuts;
  }

  function haussmannRow(x0: number, z0: number, x1: number, z1: number, alongX: boolean) {
    const cuts = alongX ? split(x0, x1, 14, 26) : split(z0, z1, 14, 26);
    for (let k = 0; k < cuts.length - 1; k++) {
      const h = rng.range(16, 21.5);
      const color = rng.pick(PALETTE.haussmann);
      const roof = rng.pick(PALETTE.mansard);
      const roofH = rng.range(3, 4.2);
      if (alongX) pushBuilding(cuts[k], z0, cuts[k + 1], z1, h, roofH, BUILDING_STYLE.haussmann, color, roof);
      else pushBuilding(x0, cuts[k], x1, cuts[k + 1], h, roofH, BUILDING_STYLE.haussmann, color, roof);
    }
  }

  function fillHaussmann(x0: number, z0: number, x1: number, z1: number) {
    const D = 13;
    const w = x1 - x0;
    const d = z1 - z0;
    if (w < 2 * D + 8 || d < 2 * D + 8) {
      // Narrow block: a single row of buildings
      haussmannRow(x0, z0, x1, z1, w >= d);
      return;
    }
    // Perimeter block with an inner courtyard
    haussmannRow(x0, z0, x1, z0 + D, true);
    haussmannRow(x0, z1 - D, x1, z1, true);
    haussmannRow(x0, z0 + D, x0 + D, z1 - D, false);
    haussmannRow(x1 - D, z0 + D, x1, z1 - D, false);
  }

  function fillCites(x0: number, z0: number, x1: number, z1: number) {
    solids.push(grass(x0, z0, x1, z1));
    const w = x1 - x0;
    const d = z1 - z0;
    const color = () => rng.pick(PALETTE.cites);
    const roof = () => rng.pick(PALETTE.flatRoof);
    if (rng.chance(0.5)) {
      // Two long "barres"
      const along = w > d;
      const len = (along ? w : d) - 10;
      const h = rng.range(22, 34);
      if (along) {
        pushBuilding(x0 + 5, z0 + 4, x0 + 5 + len, z0 + 16, h, 1.2, BUILDING_STYLE.tower, color(), roof());
        pushBuilding(x0 + 5, z1 - 16, x0 + 5 + len, z1 - 4, h * rng.range(0.8, 1.1), 1.2, BUILDING_STYLE.tower, color(), roof());
      } else {
        pushBuilding(x0 + 4, z0 + 5, x0 + 16, z0 + 5 + len, h, 1.2, BUILDING_STYLE.tower, color(), roof());
        pushBuilding(x1 - 16, z0 + 5, x1 - 4, z0 + 5 + len, h * rng.range(0.8, 1.1), 1.2, BUILDING_STYLE.tower, color(), roof());
      }
    } else {
      // One tall tower plus a low bar
      const tx = x0 + w * 0.3;
      const tz = z0 + d * 0.35;
      pushBuilding(tx - 9, tz - 9, tx + 9, tz + 9, rng.range(42, 58), 1.5, BUILDING_STYLE.tower, color(), roof());
      pushBuilding(x0 + 6, z1 - 15, x1 - 6, z1 - 4, rng.range(14, 20), 1.2, BUILDING_STYLE.tower, color(), roof());
    }
    // A few trees in the open space
    for (let k = 0; k < 4; k++) {
      const tx = rng.range(x0 + 3, x1 - 3);
      const tz = rng.range(z0 + 3, z1 - 3);
      if (!buildings.some((b) => Math.abs(b.x - tx) < b.w / 2 + 2 && Math.abs(b.z - tz) < b.d / 2 + 2)) {
        trees.push({ x: tx, y: 0, z: tz, s: rng.range(0.9, 1.3) });
      }
    }
  }

  function fillCommercial(x0: number, z0: number, x1: number, z1: number) {
    const along = x1 - x0 >= z1 - z0;
    const cuts = along ? split(x0, x1, 12, 22) : split(z0, z1, 12, 22);
    const depth = Math.min(20, (along ? z1 - z0 : x1 - x0) / 2 - 2);
    for (let k = 0; k < cuts.length - 1; k++) {
      for (const side of [0, 1]) {
        const h = rng.range(7, 13);
        const c = rng.pick(PALETTE.shop);
        const r = rng.pick(PALETTE.flatRoof);
        if (along) {
          const za = side === 0 ? z0 : z1 - depth;
          pushBuilding(cuts[k], za, cuts[k + 1], za + depth, h, 0.8, BUILDING_STYLE.shop, c, r);
        } else {
          const xa = side === 0 ? x0 : x1 - depth;
          pushBuilding(xa, cuts[k], xa + depth, cuts[k + 1], h, 0.8, BUILDING_STYLE.shop, c, r);
        }
      }
    }
    // The first street-facing shop of the block is an enterable supérette
    const name = SHOP_NAMES[interiors.length % SHOP_NAMES.length];
    const mid = (cuts[0] + cuts[1]) / 2;
    const door = along ? { x: mid, z: z0, yaw: 0 } : { x: x0, z: mid, yaw: Math.PI / 2 };
    const id = addInterior('shop', name, name.toUpperCase(), 0x7dff7a, door);
    pois.push({ id, kind: 'shop', name, x: door.x, z: door.z });
  }

  function makeSpecial(x0: number, z0: number, x1: number, z1: number, s: Special) {
    const m = 6;
    const style = BUILDING_STYLE.landmark;
    if (s.kind === 'garage' || s.kind === 'hideout') {
      // Low building + open yard
      pushBuilding(x0 + m, z0 + m, x1 - m, z0 + (z1 - z0) * 0.5, s.h, 1, style, s.color, 0x6b6e78);
      solids.push(plaza(x0, z0, x1, z1, 0x9ea3ab));
    } else if (s.kind === 'airport') {
      pushBuilding(x0 + m, z0 + m, x1 - m, z0 + 22, s.h, 2, style, s.color, 0xe0e4ea);
      solids.push(plaza(x0, z0, x1, z1, 0xa7adb6));
    } else {
      pushBuilding(x0 + m, z0 + m, x1 - m, z1 - m, s.h, s.kind === 'bank' ? 3 : 1.5, style, s.color, s.kind === 'bank' ? 0x3c4a66 : 0x8d8f99);
      solids.push(plaza(x0, z0, x1, z1, COLORS.plaza));
    }
    // Entrance on the south facade (towards -z)
    const door = { x: (x0 + x1) / 2, z: z0 + m, yaw: 0 };
    const enterable: Partial<Record<Special['kind'], [string, number]>> = {
      bank: ['BANQUE LUMIÈRE', 0x7de3ff],
      jewelry: ['BIJOUTERIE SAPHIR', 0xd59bff],
      police: ['POLICE', 0x5aa2ff],
      hospital: ['HÔPITAL', 0xff5d6c],
      hideout: ['LA PLANQUE', 0xffd23f],
    };
    const e = enterable[s.kind];
    if (e) addInterior(s.kind as InteriorDef['kind'], s.name, e[0], e[1], door);
    pois.push({ id: s.id, kind: s.kind, name: s.name, x: door.x, z: door.z - 1 });
  }

  /** Street lights, hydrants, bins and benches along the sidewalk of a block. */
  function streetFurniture(x0: number, z0: number, x1: number, z1: number, kind: BlockDef['kind']) {
    const inset = 0.9;
    const edges: { a: [number, number]; b: [number, number]; yaw: number }[] = [
      { a: [x0, z0 + inset], b: [x1, z0 + inset], yaw: -Math.PI / 2 },
      { a: [x0, z1 - inset], b: [x1, z1 - inset], yaw: Math.PI / 2 },
      { a: [x0 + inset, z0], b: [x0 + inset, z1], yaw: 0 },
      { a: [x1 - inset, z0], b: [x1 - inset, z1], yaw: Math.PI },
    ];
    for (const e of edges) {
      const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
      const n = Math.max(1, Math.floor(len / 26));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const x = e.a[0] + (e.b[0] - e.a[0]) * t;
        const z = e.a[1] + (e.b[1] - e.a[1]) * t;
        props.push({ kind: 'streetlight', x, z, yaw: e.yaw });
      }
      // a hydrant or a bin here and there
      const t = rng.range(0.15, 0.85);
      const px = e.a[0] + (e.b[0] - e.a[0]) * t;
      const pz = e.a[1] + (e.b[1] - e.a[1]) * t;
      if (rng.chance(0.35)) props.push({ kind: 'hydrant', x: px, z: pz, yaw: e.yaw });
      else if (rng.chance(0.4)) props.push({ kind: 'trash', x: px, z: pz, yaw: e.yaw });
    }
    if (kind === 'cites' && rng.chance(0.7)) props.push({ kind: 'dumpster', x: x0 + 6, z: z1 - 6, yaw: 0 });
  }

  function makePlace(x0: number, z0: number, x1: number, z1: number, name: string) {
    solids.push(plaza(x0, z0, x1, z1, COLORS.plaza));
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    fountains.push({ x: cx, z: cz, r: 5 });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const r = 9;
      props.push({ kind: 'bench', x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, yaw: -a + Math.PI / 2 });
      props.push({ kind: 'bush', x: cx + Math.cos(a + 0.4) * (r + 2), z: cz + Math.sin(a + 0.4) * (r + 2), yaw: a });
    }
    pois.push({ id: `fountain-${fountains.length}`, kind: 'fountain', name, x: cx, z: cz });
    // Ring of trees around the fountain
    const n = 10;
    const r = Math.min(x1 - x0, z1 - z0) / 2 - 4;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      trees.push({ x: cx + Math.cos(a) * r, y: 0, z: cz + Math.sin(a) * r, s: rng.range(1, 1.25) });
    }
  }

  function plaza(x0: number, z0: number, x1: number, z1: number, color: number): SolidDef {
    return { x: (x0 + x1) / 2, y: 0.02, z: (z0 + z1) / 2, sx: x1 - x0, sy: 0.04, sz: z1 - z0, color, kind: 'plaza', noCollide: true };
  }

  function grass(x0: number, z0: number, x1: number, z1: number): SolidDef {
    return { ...plaza(x0, z0, x1, z1, COLORS.grass), kind: 'grass' };
  }

  // ---------------------------------------------------------------- boulevard trees
  for (const lx of XS) {
    if (lx.kind !== 'boulevard') continue;
    for (let z = -440; z <= 440; z += 14) {
      if (crossesRiver(z - 6, z + 6)) continue;
      if (ZS.some((l) => Math.abs(l.c - z) < l.w / 2 + 3)) continue;
      if (inRect(lx.c, z, PARK)) continue;
      for (const s of [-1, 1]) trees.push({ x: lx.c + s * (lx.w / 2 + 2), y: 0, z, s: rng.range(0.85, 1.05) });
    }
  }
  for (const lz of ZS) {
    if (lz.kind !== 'boulevard') continue;
    for (let x = -440; x <= 440; x += 14) {
      if (XS.some((l) => Math.abs(l.c - x) < l.w / 2 + 3)) continue;
      for (const s of [-1, 1]) trees.push({ x, y: 0, z: lz.c + s * (lz.w / 2 + 2), s: rng.range(0.85, 1.05) });
    }
  }

  // ---------------------------------------------------------------- park terrain
  const terrain = buildParkTerrain(rng);
  for (let k = 0; k < 160; k++) {
    const x = rng.range(PARK.x0 + 6, PARK.x1 - 6);
    const z = rng.range(PARK.z0 + 6, PARK.z1 - 6);
    const y = terrainHeight(terrain, x, z);
    // Fewer trees on the steep slopes so the 4x4 has room
    if (terrainSlope(terrain, x, z) > 0.45) continue;
    trees.push({ x, y, z, s: rng.range(1, 1.6) });
  }

  // ---------------------------------------------------------------- parking & traffic lights
  for (const r of roads) {
    if (r.kind !== 'street' && r.kind !== 'boulevard') continue;
    const along = r.axis === 'z' ? r.d : r.w;
    const width = r.axis === 'z' ? r.w : r.d;
    const off = width / 2 - 1.0;
    for (let t = 9; t < along - 9; t += 7) {
      for (const side of [-1, 1]) {
        if (!rng.chance(0.3)) continue;
        if (r.axis === 'z') {
          // Driving +z keeps to the -x side: cars parked there face +z (yaw π)
          parking.push({ x: r.x + side * off, z: r.z - r.d / 2 + t, yaw: side < 0 ? Math.PI : 0 });
        } else {
          parking.push({ x: r.x - r.w / 2 + t, z: r.z + side * off, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
        }
      }
    }
  }
  // Traffic lights on every city intersection (4 corners on boulevards, 2 elsewhere)
  for (const r of roads) {
    if (r.kind !== 'intersection' || r.w > 21.5 && r.w < 22.5 || r.d > 21.5 && r.d < 22.5) continue;
    if (inRect(r.x, r.z, PARK)) continue;
    const big = r.w >= 20 || r.d >= 20;
    const corners = big ? [[-1, -1], [1, -1], [-1, 1], [1, 1]] : [[-1, -1], [1, 1]];
    for (const [sx, sz] of corners) {
      props.push({ kind: 'trafficlight', x: r.x + sx * (r.w / 2 + 1), z: r.z + sz * (r.d / 2 + 1), yaw: Math.atan2(sx, sz) });
    }
  }
  // Parisian bollards guarding the sidewalk corners
  for (const b of blocks) {
    if (b.kind === 'cites') continue;
    for (const [cx, cz, dx, dz] of [
      [b.x0, b.z0, 1, 1],
      [b.x1, b.z0, -1, 1],
      [b.x0, b.z1, 1, -1],
      [b.x1, b.z1, -1, -1],
    ]) {
      for (const t of [3.5, 5]) {
        props.push({ kind: 'bollard', x: cx + dx * t, z: cz + dz * 0.45, yaw: 0 });
        props.push({ kind: 'bollard', x: cx + dx * 0.45, z: cz + dz * t, yaw: 0 });
      }
    }
  }

  // Keep entrances clear of street furniture
  for (let i = props.length - 1; i >= 0; i--) {
    if (interiors.some((d) => Math.hypot(d.door.x - props[i].x, d.door.z - props[i].z) < 3.5)) props.splice(i, 1);
  }

  // Hand-placed vehicles next to the spawn square and at the park entrance; keep their lanes clear
  const FEATURED = [
    { type: 'sports', x: -58, z: -75, yaw: -Math.PI / 2 },
    { type: 'offroad', x: -75, z: -50, yaw: 0 },
    { type: 'moto', x: -75, z: -28, yaw: 0 },
    { type: 'offroad', x: 178, z: 217, yaw: -Math.PI / 2 },
  ];
  for (let i = parking.length - 1; i >= 0; i--) {
    if (FEATURED.some((f) => Math.hypot(f.x - parking[i].x, f.z - parking[i].z) < 30)) parking.splice(i, 1);
  }

  const zones: ZoneDef[] = [
    { id: 'cites', name: 'Cité des Tilleuls', kind: 'cites', ...CITES },
    { id: 'commercial', name: 'Quartier Saphir', kind: 'commercial', ...COMMERCIAL },
    { id: 'park', name: 'Parc des Buttes-Rouges', kind: 'park', ...PARK },
    { id: 'river', name: 'Quais de la Lune', kind: 'river', x0: -HALF, z0: RIVER.quayZ0, x1: HALF, z1: RIVER.quayZ1 },
    { id: 'center', name: 'Belleplace', kind: 'haussmann', x0: -218, z0: -218, x1: 40, z1: RIVER.quayZ0 },
    { id: 'north', name: 'Rive Haute', kind: 'haussmann', x0: -RING, z0: RIVER.quayZ1, x1: PARK.x0, z1: RING },
  ];

  return {
    id: 'paris',
    name: 'Paris — Belleplace',
    half: HALF,
    seed,
    spawn: { x: -40, y: 1, z: -52, yaw: Math.PI },
    buildings,
    roads,
    solids,
    terrain,
    water: [{ x0: -HALF, z0: RIVER.z0, x1: HALF, z1: RIVER.z1, y: RIVER.waterY }],
    trees,
    fountains,
    pois,
    zones,
    blocks,
    interiors,
    parking,
    props,
    featured: FEATURED,
    killY: RIVER.waterY - 1.5,
  };
}

// ---------------------------------------------------------------- terrain helpers

function buildParkTerrain(rng: Rng): TerrainDef {
  const res = 48;
  const sizeX = PARK.x1 - PARK.x0;
  const sizeZ = PARK.z1 - PARK.z0;
  const heights = new Float32Array((res + 1) * (res + 1));
  const bumps = [
    { u: 0.3, v: 0.35, a: 14, s: 0.16 },
    { u: 0.68, v: 0.62, a: 20, s: 0.12 }, // the steep "butte" for the off-roader
    { u: 0.55, v: 0.2, a: 8, s: 0.1 },
    { u: 0.22, v: 0.75, a: 10, s: 0.12 },
  ];
  for (let k = 0; k < 4; k++) bumps.push({ u: rng.range(0.15, 0.85), v: rng.range(0.15, 0.85), a: rng.range(3, 6), s: rng.range(0.05, 0.08) });
  for (let iz = 0; iz <= res; iz++) {
    for (let ix = 0; ix <= res; ix++) {
      const u = ix / res;
      const v = iz / res;
      let h = 0;
      for (const b of bumps) {
        const du = u - b.u;
        const dv = v - b.v;
        h += b.a * Math.exp(-(du * du + dv * dv) / (2 * b.s * b.s));
      }
      // Fade to 0 at the park border so it meets the sidewalks
      const edge = Math.min(u, 1 - u, v, 1 - v) / 0.1;
      const fade = edge >= 1 ? 1 : edge * edge * (3 - 2 * edge);
      heights[iz * (res + 1) + ix] = h * fade;
    }
  }
  return { x0: PARK.x0, z0: PARK.z0, sizeX, sizeZ, res, heights };
}

export { terrainHeight, terrainSlope };
