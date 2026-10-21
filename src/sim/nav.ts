import type { MapData } from '../maps/types';

/**
 * Navigation graphs derived from map data (pure, deterministic):
 *  - lanes: directed edges between intersections, right-hand traffic
 *  - sidewalks: block corners linked around each block and across streets
 */

export interface LaneNode {
  id: number;
  x: number;
  z: number;
  /** Half sizes of the intersection box. */
  hw: number;
  hd: number;
  out: number[];
}

export interface Lane {
  id: number;
  from: number;
  to: number;
  /** Lane start / end points (at the intersection edges), already offset to the right side. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Unit direction. */
  dx: number;
  dz: number;
  length: number;
  speed: number;
}

export interface LaneGraph {
  nodes: LaneNode[];
  lanes: Lane[];
}

const SPEED = { street: 11, boulevard: 14, highway: 22 };

export function buildLaneGraph(map: MapData): LaneGraph {
  const nodes: LaneNode[] = [];
  const key = (x: number, z: number) => `${Math.round(x)}:${Math.round(z)}`;
  const byKey = new Map<string, LaneNode>();
  for (const r of map.roads) {
    if (r.kind !== 'intersection') continue;
    const n: LaneNode = { id: nodes.length, x: r.x, z: r.z, hw: r.w / 2, hd: r.d / 2, out: [] };
    nodes.push(n);
    byKey.set(key(r.x, r.z), n);
  }
  const lanes: Lane[] = [];
  const findNode = (x: number, z: number) => {
    let best: LaneNode | null = null;
    let bd = 3;
    for (const n of nodes) {
      const d = Math.max(Math.abs(n.x - x) - n.hw, Math.abs(n.z - z) - n.hd);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  };
  for (const r of map.roads) {
    if (r.kind === 'intersection' || !r.axis) continue;
    const alongZ = r.axis === 'z';
    const half = (alongZ ? r.d : r.w) / 2;
    const width = alongZ ? r.w : r.d;
    // nodes at both ends of the segment
    const a = alongZ ? findNode(r.x, r.z - half - 1) : findNode(r.x - half - 1, r.z);
    const b = alongZ ? findNode(r.x, r.z + half + 1) : findNode(r.x + half + 1, r.z);
    if (!a || !b) continue;
    const off = width / 4;
    const speed = SPEED[r.kind as keyof typeof SPEED] ?? 11;
    const push = (from: LaneNode, to: LaneNode) => {
      const dx = Math.sign(to.x - from.x);
      const dz = Math.sign(to.z - from.z);
      // right-hand side: heading +z → -x side, heading +x → +z side
      const ox = alongZ ? -dz * off : 0;
      const oz = alongZ ? 0 : dx * off;
      const ax = alongZ ? r.x + ox : from.x + dx * from.hw;
      const az = alongZ ? from.z + dz * from.hd : r.z + oz;
      const bx = alongZ ? r.x + ox : to.x - dx * to.hw;
      const bz = alongZ ? to.z - dz * to.hd : r.z + oz;
      const length = Math.hypot(bx - ax, bz - az);
      const lane: Lane = { id: lanes.length, from: from.id, to: to.id, ax, az, bx, bz, dx: (bx - ax) / length, dz: (bz - az) / length, length, speed };
      lanes.push(lane);
      from.out.push(lane.id);
    };
    push(a, b);
    push(b, a);
  }
  void byKey;
  return { nodes, lanes };
}

/** Next lane after `lane` at its end node (no U-turn unless dead end). */
export function nextLane(g: LaneGraph, lane: Lane, rand: number): Lane {
  const node = g.nodes[lane.to];
  const options = node.out.map((id) => g.lanes[id]).filter((l) => l.to !== lane.from);
  if (options.length === 0) return g.lanes[node.out[0]] ?? lane;
  // Prefer going straight a bit more often
  const straight = options.find((l) => Math.abs(l.dx - lane.dx) < 0.1 && Math.abs(l.dz - lane.dz) < 0.1);
  if (straight && rand < 0.45) return straight;
  return options[Math.floor(rand * options.length) % options.length];
}

// --------------------------------------------------------------------------- sidewalks

export interface WalkNode {
  id: number;
  x: number;
  z: number;
  links: number[];
}

export function buildSidewalkGraph(map: MapData): WalkNode[] {
  const nodes: WalkNode[] = [];
  const inset = 2.2;
  for (const b of map.blocks) {
    const c = [
      [b.x0 + inset, b.z0 + inset],
      [b.x1 - inset, b.z0 + inset],
      [b.x1 - inset, b.z1 - inset],
      [b.x0 + inset, b.z1 - inset],
    ];
    const ids = c.map(([x, z]) => {
      const n: WalkNode = { id: nodes.length, x, z, links: [] };
      nodes.push(n);
      return n.id;
    });
    for (let k = 0; k < 4; k++) link(ids[k], ids[(k + 1) % 4]);
  }
  // Crosswalks: corners facing each other across a street (aligned on x or z)
  for (const a of nodes) {
    for (const b of nodes) {
      if (b.id <= a.id) continue;
      const dx = Math.abs(a.x - b.x);
      const dz = Math.abs(a.z - b.z);
      const aligned = (dx < 0.5 && dz > 6 && dz < 34) || (dz < 0.5 && dx > 6 && dx < 34);
      if (aligned && !a.links.includes(b.id) && !crossesWater(map, a, b)) link(a.id, b.id);
    }
  }
  return nodes;

  function link(i: number, j: number) {
    nodes[i].links.push(j);
    nodes[j].links.push(i);
  }
}

function crossesWater(map: MapData, a: { z: number }, b: { z: number }) {
  return map.water.some((w) => Math.min(a.z, b.z) < w.z1 + 12 && Math.max(a.z, b.z) > w.z0 - 12);
}
