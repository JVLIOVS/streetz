/** Generic A* over a small graph (sidewalk corners, intersections). */
export function astar(
  count: number,
  neighbors: (i: number) => number[],
  pos: (i: number) => { x: number; z: number },
  from: number,
  to: number,
  maxExpand = 2000,
): number[] {
  if (from === to) return [to];
  const g = new Float64Array(count).fill(Infinity);
  const f = new Float64Array(count).fill(Infinity);
  const came = new Int32Array(count).fill(-1);
  const closed = new Uint8Array(count);
  const open: number[] = [from];
  const goal = pos(to);
  const h = (i: number) => {
    const p = pos(i);
    return Math.hypot(p.x - goal.x, p.z - goal.z);
  };
  g[from] = 0;
  f[from] = h(from);
  let expanded = 0;
  while (open.length && expanded++ < maxExpand) {
    // small graphs: a linear scan for the best open node is fine
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
    const cur = open[bi];
    open.splice(bi, 1);
    if (cur === to) {
      const path = [cur];
      let c = cur;
      while (came[c] >= 0) path.push((c = came[c]));
      return path.reverse();
    }
    closed[cur] = 1;
    const pc = pos(cur);
    for (const n of neighbors(cur)) {
      if (closed[n]) continue;
      const pn = pos(n);
      const ng = g[cur] + Math.hypot(pn.x - pc.x, pn.z - pc.z);
      if (ng < g[n]) {
        g[n] = ng;
        f[n] = ng + h(n);
        came[n] = cur;
        if (!open.includes(n)) open.push(n);
      }
    }
  }
  return [];
}
