import { beforeAll, describe, expect, it } from 'vitest';
import type { MoveCommand } from '../src/core/commands';
import { buildParisMap } from '../src/maps/paris/layout';
import type { MapData } from '../src/maps/types';
import { SimWorld } from '../src/sim/world';

const move = (tick: number, x: number, y: number, extra: Partial<MoveCommand> = {}): MoveCommand => ({
  type: 'move',
  playerId: 'p1',
  tick,
  x,
  y,
  yaw: 0,
  sprint: false,
  jump: false,
  throttle: 0,
  handbrake: false,
  ...extra,
});

let map: MapData;
beforeAll(() => {
  map = buildParisMap();
});

async function world(spawn?: { x: number; y: number; z: number; yaw: number }) {
  const w = await SimWorld.create(map);
  w.addPlayer('p1', spawn);
  return w;
}

function run(w: SimWorld, ticks: number, cmd: (t: number) => MoveCommand | null) {
  for (let i = 0; i < ticks; i++) {
    const c = cmd(w.tick);
    w.step(c ? [c] : []);
  }
}

describe('SimWorld', () => {
  it('lands the player on the ground', async () => {
    const w = await world();
    run(w, 60, () => null);
    const p = w.players.get('p1')!.state;
    expect(p.grounded).toBe(true);
    expect(p.y).toBeGreaterThan(-0.2);
    expect(p.y).toBeLessThan(0.3);
  });

  it('walks forward relative to the camera yaw', async () => {
    const w = await world();
    run(w, 30, () => null);
    const z0 = w.players.get('p1')!.state.z;
    run(w, 60, (t) => move(t, 0, 1)); // yaw 0 → forward is -z
    const p = w.players.get('p1')!.state;
    expect(z0 - p.z).toBeGreaterThan(3);
    expect(p.anim).toBe('run');

    const w2 = await world();
    run(w2, 30, () => null);
    const x0 = w2.players.get('p1')!.state.x;
    run(w2, 60, (t) => move(t, 0, 1, { yaw: -Math.PI / 2 })); // camera looking +x
    expect(w2.players.get('p1')!.state.x - x0).toBeGreaterThan(3);
  });

  it('has three gaits: walk < run < sprint', async () => {
    const dist = async (x: number, y: number, sprint: boolean) => {
      const w = await world();
      run(w, 20, () => null);
      const z0 = w.players.get('p1')!.state.z;
      run(w, 90, (t) => move(t, x, y, { sprint }));
      return { d: Math.abs(w.players.get('p1')!.state.z - z0), anim: w.players.get('p1')!.state.anim };
    };
    const walk = await dist(0, 0.45, false);
    const runG = await dist(0, 1, false);
    const sprint = await dist(0, 1, true);
    expect(walk.anim).toBe('walk');
    expect(runG.anim).toBe('run');
    expect(sprint.anim).toBe('sprint');
    expect(runG.d).toBeGreaterThan(walk.d * 1.8);
    expect(sprint.d).toBeGreaterThan(runG.d * 1.3);
  });

  it('jumps and comes back down', async () => {
    const w = await world();
    run(w, 30, () => null);
    const y0 = w.players.get('p1')!.state.y;
    w.step([move(w.tick, 0, 0, { jump: true })]);
    let maxY = y0;
    for (let i = 0; i < 90; i++) {
      w.step([]);
      maxY = Math.max(maxY, w.players.get('p1')!.state.y);
    }
    expect(maxY - y0).toBeGreaterThan(1);
    expect(w.players.get('p1')!.state.grounded).toBe(true);
  });

  it('cannot walk through a building', async () => {
    const b = map.buildings.find((b) => b.style === 0 && b.h > 15)!;
    // Start 3 m south of the building's south face, walk north (+z)
    const w = await world({ x: b.x, y: 0.5, z: b.z - b.d / 2 - 3, yaw: Math.PI });
    run(w, 180, (t) => move(t, 0, 1, { yaw: Math.PI }));
    const p = w.players.get('p1')!.state;
    expect(p.z).toBeLessThan(b.z - b.d / 2);
  });

  it('stands on the park hills (heightfield matches terrain data)', async () => {
    const t = map.terrain!;
    // highest sample
    let best = 0;
    for (let i = 0; i < t.heights.length; i++) if (t.heights[i] > t.heights[best]) best = i;
    const n = t.res + 1;
    const x = t.x0 + ((best % n) / t.res) * t.sizeX;
    const z = t.z0 + (Math.floor(best / n) / t.res) * t.sizeZ;
    const top = t.heights[best];
    const w = await world({ x, y: top + 3, z, yaw: 0 });
    run(w, 90, () => null);
    const p = w.players.get('p1')!.state;
    expect(Math.abs(p.y - top)).toBeLessThan(0.6);
  });

  it('respawns a player who falls in the river', async () => {
    const w = await world({ x: -60, y: 2, z: 165, yaw: 0 });
    run(w, 120, () => null);
    expect(w.drainEvents().some((e) => e.type === 'respawn')).toBe(true);
    expect(w.players.get('p1')!.state.z).toBeCloseTo(map.spawn.z, 0);
  });

  it('camera ray hits buildings', async () => {
    const w = await world();
    const b = map.buildings[0];
    const d = w.castStatic(b.x, 5, b.z - b.d / 2 - 10, 0, 0, 1, 50);
    expect(d).toBeGreaterThan(9);
    expect(d).toBeLessThan(11);
  });

  it('produces a JSON-serializable snapshot', async () => {
    const w = await world();
    run(w, 10, (t) => move(t, 1, 0));
    const snap = w.snapshot();
    expect(JSON.stringify(JSON.parse(JSON.stringify(snap)))).toBe(JSON.stringify(snap));
    expect(snap.players[0].id).toBe('p1');
  });

  it('is deterministic for the same inputs', async () => {
    const a = await world();
    const b = await world();
    const script = (t: number) => move(t, Math.sin(t / 20), 1, { sprint: t % 100 > 50, jump: t % 70 === 0 });
    run(a, 300, script);
    run(b, 300, script);
    expect(a.snapshot()).toEqual(b.snapshot());
  });
});
