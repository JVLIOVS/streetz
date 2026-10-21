import { beforeAll, describe, expect, it } from 'vitest';
import type { ActionCommand, MoveCommand } from '../src/core/commands';
import { buildParisMap } from '../src/maps/paris/layout';
import type { MapData } from '../src/maps/types';
import { buildLaneGraph, buildSidewalkGraph, nextLane } from '../src/sim/nav';
import { SimWorld } from '../src/sim/world';

let map: MapData;
beforeAll(() => {
  map = buildParisMap();
});

const move = (tick: number, extra: Partial<MoveCommand> = {}): MoveCommand => ({
  type: 'move',
  playerId: 'p1',
  tick,
  x: 0,
  y: 0,
  yaw: 0,
  sprint: false,
  jump: false,
  throttle: 0,
  handbrake: false,
  ...extra,
});
const act = (tick: number, action: ActionCommand['action']): ActionCommand => ({ type: 'action', playerId: 'p1', tick, action });

async function world(spawn?: { x: number; y: number; z: number; yaw: number }) {
  const w = await SimWorld.create(map);
  w.addPlayer('p1', spawn);
  return w;
}
const P = (w: SimWorld) => w.players.get('p1')!.state;
function run(w: SimWorld, ticks: number, cmd: (t: number) => (MoveCommand | ActionCommand)[] | null = () => null) {
  for (let i = 0; i < ticks; i++) w.step(cmd(w.tick) ?? []);
}

describe('navigation graphs', () => {
  it('builds a lane graph with right-hand lanes on every road segment', () => {
    const g = buildLaneGraph(map);
    expect(g.lanes.length).toBeGreaterThan(300);
    for (const l of g.lanes) expect(l.length).toBeGreaterThan(5);
    const l = g.lanes[10];
    const n = nextLane(g, l, 0.3);
    expect(n.from).toBe(l.to);
  });
  it('links sidewalks around blocks and across streets', () => {
    const nodes = buildSidewalkGraph(map);
    expect(nodes.length).toBe(map.blocks.length * 4);
    const crossings = nodes.filter((n) => n.links.length > 2).length;
    expect(crossings).toBeGreaterThan(nodes.length * 0.5);
  });
});

describe('living city', () => {
  it('spawns pedestrians and traffic around the player, and cars drive along lanes', async () => {
    const w = await world();
    run(w, 120);
    const ambientPeds = [...w.peds.values()].filter((p) => p.ambient);
    expect(ambientPeds.length).toBeGreaterThan(10);
    const traffic = [...w.vehicles.values()].filter((v) => v.state.driver === 'npc');
    expect(traffic.length).toBeGreaterThan(5);
    const start = new Map(traffic.map((v) => [v.state.id, { x: v.state.x, z: v.state.z }]));
    run(w, 600);
    let moved = 0;
    for (const v of traffic) {
      const s = start.get(v.state.id)!;
      if (w.vehicles.has(v.state.id) && Math.hypot(v.state.x - s.x, v.state.z - s.z) > 25) moved++;
      expect(v.state.y).toBeGreaterThan(-1);
    }
    expect(moved).toBeGreaterThan(traffic.length / 2);
    // parked cars too
    expect([...w.vehicles.values()].some((v) => v.parkedSpot >= 0)).toBe(true);
  });
});

describe('vehicles', () => {
  it('lets the player get in a parked car, drive and get out', async () => {
    const f = map.featured[0];
    const w = await world({ x: f.x, y: 0.5, z: f.z - 2.5, yaw: 0 });
    run(w, 20);
    expect(P(w).context?.kind).toBe('enter_vehicle');
    run(w, 1, (t) => [act(t, 'use')]);
    expect(P(w).vehicle).toBeGreaterThan(0);
    const v = w.vehicles.get(P(w).vehicle)!;
    const x0 = v.state.x;
    run(w, 120, (t) => [move(t, { throttle: 1 })]);
    expect(Math.abs(v.state.speed)).toBeGreaterThan(8);
    expect(Math.abs(v.state.x - x0)).toBeGreaterThan(10);
    run(w, 120, (t) => [move(t, { throttle: -1 })]);
    run(w, 1, (t) => [act(t, 'use')]);
    expect(P(w).vehicle).toBe(-1);
    expect(Math.hypot(P(w).x - v.state.x, P(w).z - v.state.z)).toBeLessThan(4);
  });

  it('carjacking throws the driver out and raises the wanted level', async () => {
    const w = await world();
    run(w, 60);
    const car = [...w.vehicles.values()].find((v) => v.state.driver === 'npc')!;
    const p = w.players.get('p1')!;
    // stop the car and stand next to it
    car.lane = -1;
    run(w, 60);
    p.teleport(car.state.x + Math.cos(car.state.yaw) * 2.2, car.state.y + 0.3, car.state.z - Math.sin(car.state.yaw) * 2.2);
    const witness = w.spawnPed(P(w).x + 6, P(w).z, { mode: 'idle' });
    witness.timer = 999;
    run(w, 2);
    expect(P(w).context?.kind).toBe('steal_vehicle');
    const peds = w.peds.size;
    run(w, 1, (t) => [act(t, 'use')]);
    expect(P(w).vehicle).toBe(car.state.id);
    expect(w.peds.size).toBe(peds + 1);
    expect(w.wanted.level).toBeGreaterThanOrEqual(1);
  });

  it('the 4x4 climbs the park hills', async () => {
    const t = map.terrain!;
    const f = map.featured[3];
    const w = await world({ x: f.x, y: 0.5, z: f.z - 2.5, yaw: 0 });
    run(w, 10);
    run(w, 1, (tk) => [act(tk, 'use')]);
    const v = w.vehicles.get(P(w).vehicle)!;
    expect(v.state.type).toBe('offroad');
    // highest point of the park
    let best = 0;
    for (let i = 0; i < t.heights.length; i++) if (t.heights[i] > t.heights[best]) best = i;
    const n = t.res + 1;
    const hx = t.x0 + ((best % n) / t.res) * t.sizeX;
    const hz = t.z0 + (Math.floor(best / n) / t.res) * t.sizeZ;
    let maxY = 0;
    for (let i = 0; i < 60 * 30; i++) {
      // simple autopilot towards the summit
      const desired = Math.atan2(-(hx - v.state.x), -(hz - v.state.z));
      let d = (desired - v.state.yaw) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      w.step([move(w.tick, { x: Math.max(-1, Math.min(1, -d * 2)), throttle: 1 })]);
      maxY = Math.max(maxY, v.state.y);
      if (Math.hypot(hx - v.state.x, hz - v.state.z) < 6) break;
    }
    expect(maxY).toBeGreaterThan(12);
  });

  it('a heavily damaged car catches fire then explodes', async () => {
    const w = await world();
    const f = map.featured[0];
    const v = [...w.vehicles.values()].find((x) => Math.hypot(x.state.x - f.x, x.state.z - f.z) < 1)!;
    v.state.health = 0;
    run(w, 60 * 5);
    expect(v.state.wrecked).toBe(true);
    expect(w.drainEvents().some((e) => e.type === 'explosion')).toBe(true);
  });
});

describe('combat', () => {
  async function withPed() {
    const w = await world();
    run(w, 5);
    const s = P(w);
    const ped = w.spawnPed(s.x, s.z - 1.2, { ambient: true, mode: 'idle' });
    ped.timer = 999;
    return { w, ped };
  }

  it('punches knock a pedestrian out, who drops money', async () => {
    const { w, ped } = await withPed();
    const money0 = P(w).money;
    for (let k = 0; k < 6 && ped.alive; k++) {
      run(w, 1, (t) => [act(t, 'attack')]);
      run(w, 30);
      ped.kvx = ped.kvz = 0;
      if (ped.state.mode === 'flee') {
        ped.state.mode = 'idle';
        ped.timer = 999;
        ped.state.x = P(w).x;
        ped.state.z = P(w).z - 1.2;
      }
    }
    expect(ped.alive).toBe(false);
    // the dropped cash is picked up by walking over it
    for (const pk of w.pickups.values()) w.players.get('p1')!.teleport(pk.x, 0.2, pk.z);
    run(w, 3);
    expect(w.pickups.size).toBe(0);
    expect(P(w).money).toBeGreaterThan(money0);
  });

  it('the pistol auto-aims, uses ammo and raises the wanted level', async () => {
    const { w, ped } = await withPed();
    ped.state.z -= 8;
    run(w, 1, (t) => [move(t, { yaw: 0 }), act(t, 'weapon')]);
    expect(P(w).weapon).toBe('pistol');
    const ammo = P(w).ammo.pistol;
    for (let k = 0; k < 4; k++) {
      run(w, 1, (t) => [act(t, 'attack')]);
      run(w, 20);
    }
    expect(ped.alive).toBe(false);
    expect(P(w).ammo.pistol).toBeLessThan(ammo);
    expect(w.wanted.level).toBeGreaterThanOrEqual(2);
  });

  it('wanted stars fade when lying low', async () => {
    const w = await world();
    w.wanted.level = 2;
    w.wanted.cooldown = 25;
    run(w, 60 * 52);
    expect(w.wanted.level).toBe(0);
  });
});

describe('buildings', () => {
  it('enter a supérette, rob it at gunpoint and walk out', async () => {
    const shop = map.interiors.find((i) => i.kind === 'shop')!;
    const fx = -Math.sin(shop.door.yaw);
    const fz = -Math.cos(shop.door.yaw);
    const w = await world({ x: shop.door.x + fx * 1.2, y: 0.3, z: shop.door.z + fz * 1.2, yaw: 0 });
    run(w, 10);
    expect(P(w).context?.kind).toBe('enter_building');
    run(w, 1, (t) => [act(t, 'use')]);
    expect(P(w).interior).toBe(shop.id);
    const room = w.rooms.get(shop.id)!;
    w.players.get('p1')!.teleport(room.counter!.x, 0.2, room.counter!.z);
    run(w, 5);
    expect(P(w).context?.kind).toBe('talk');
    run(w, 1, (t) => [act(t, 'weapon')]);
    run(w, 2);
    expect(P(w).context?.kind).toBe('rob');
    const money = P(w).money;
    run(w, 1, (t) => [act(t, 'use')]);
    run(w, 60 * 6);
    expect(P(w).money).toBeGreaterThan(money + 200);
    expect(w.wanted.level).toBeGreaterThanOrEqual(2);
    w.players.get('p1')!.teleport(room.exit.x, 0.2, room.exit.z + 0.2);
    run(w, 3);
    expect(P(w).context?.kind).toBe('exit_building');
    run(w, 1, (t) => [act(t, 'use')]);
    expect(P(w).interior).toBeNull();
    expect(Math.hypot(P(w).x - shop.door.x, P(w).z - shop.door.z)).toBeLessThan(3);
  });
});

describe('network readiness', () => {
  it('full snapshots are JSON-serializable and the sim is deterministic', async () => {
    const a = await world();
    const b = await world();
    const script = (t: number) => [move(t, { x: Math.sin(t / 30), y: 1, sprint: t % 200 > 100, jump: t % 90 === 0 }), ...(t % 50 === 0 ? [act(t, 'attack')] : [])];
    run(a, 400, script);
    run(b, 400, script);
    const sa = a.snapshot();
    expect(JSON.stringify(JSON.parse(JSON.stringify(sa)))).toBe(JSON.stringify(sa));
    expect(sa).toEqual(b.snapshot());
  });
});
