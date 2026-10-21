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
  // Squares: a loop around the fountain, linked to the block corners
  for (const b of map.blocks) {
    if (b.kind !== 'place') continue;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const ring: number[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const n: WalkNode = { id: nodes.length, x: cx + Math.cos(a) * 12, z: cz + Math.sin(a) * 12, links: [] };
      nodes.push(n);
      ring.push(n.id);
    }
    for (let k = 0; k < 6; k++) link(ring[k], ring[(k + 1) % 6]);
    for (const c of nodes.filter((n) => !ring.includes(n.id) && n.x > b.x0 && n.x < b.x1 && n.z > b.z0 && n.z < b.z1)) {
      let best = ring[0];
      for (const r of ring) if (Math.hypot(nodes[r].x - c.x, nodes[r].z - c.z) < Math.hypot(nodes[best].x - c.x, nodes[best].z - c.z)) best = r;
      link(c.id, best);
    }
  }
  // Park: a coarse grid of paths over the hills, connected to the nearest sidewalks
  if (map.terrain) {
    const t = map.terrain;
    const n = 4;
    const grid: number[][] = [];
    const corners = nodes.length;
    for (let i = 0; i < n; i++) {
      grid.push([]);
      for (let j = 0; j < n; j++) {
        const node: WalkNode = { id: nodes.length, x: t.x0 + 25 + (i / (n - 1)) * (t.sizeX - 50), z: t.z0 + 25 + (j / (n - 1)) * (t.sizeZ - 50), links: [] };
        nodes.push(node);
        grid[i].push(node.id);
      }
    }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if (i + 1 < n) link(grid[i][j], grid[i + 1][j]);
        if (j + 1 < n) link(grid[i][j], grid[i][j + 1]);
      }
    for (const id of grid.flat()) {
      const p = nodes[id];
      let best = -1;
      let bd = 45;
      for (let k = 0; k < corners; k++) {
        const d = Math.hypot(nodes[k].x - p.x, nodes[k].z - p.z);
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      if (best >= 0) link(id, best);
    }
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
