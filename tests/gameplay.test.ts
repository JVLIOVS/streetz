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
    expect(nodes.length).toBeGreaterThanOrEqual(map.blocks.length * 4);
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
    // most cars get somewhere (some wait for pedestrians crossing)
    expect(moved).toBeGreaterThanOrEqual(traffic.length * 0.4);
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
    expect(P(w).wanted).toBeGreaterThanOrEqual(1);
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
    expect(P(w).wanted).toBeGreaterThanOrEqual(2);
  });

  it('wanted stars fade when lying low', async () => {
    const w = await world();
    P(w).wanted = 2;
    P(w).wantedCooldown = 25;
    run(w, 60 * 52);
    expect(P(w).wanted).toBe(0);
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
    expect(P(w).wanted).toBeGreaterThanOrEqual(2);
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

describe('fights', () => {
  async function arena(temper: 'fighter' | 'coward' | 'scared') {
    const w = await world();
    run(w, 5);
    for (const id of [...w.peds.keys()]) if (w.peds.get(id)!.ambient) w.removePed(id);
    w.density.peds = 0;
    const s = P(w);
    const ped = w.spawnPed(s.x + 2.8, s.z, { mode: 'idle' });
    ped.timer = 999;
    ped.state.temper = temper;
    return { w, ped };
  }

  it('melee locks on and lunges at a target out of reach', async () => {
    const { w, ped } = await arena('coward');
    const h = ped.state.health;
    run(w, 1, (t) => [act(t, 'attack')]);
    run(w, 15);
    expect(ped.state.health).toBeLessThan(h);
    expect(w.players.get('p1')!.state.lastHit).toBe(ped.state.id);
  });

  it('fighters hit back, cowards run away', async () => {
    const a = await arena('fighter');
    run(a.w, 1, (t) => [act(t, 'attack')]);
    run(a.w, 60 * 4);
    expect(P(a.w).health).toBeLessThan(100);
    const b = await arena('coward');
    run(b.w, 1, (t) => [act(t, 'attack')]);
    run(b.w, 60);
    expect(b.ped.state.mode).toBe('flee');
  });

  it('you can beat someone until they drop all their cash', async () => {
    const { w, ped } = await arena('scared');
    ped.state.money = 321;
    for (let k = 0; k < 12 && ped.alive; k++) {
      ped.state.x = P(w).x + 1.5;
      ped.state.z = P(w).z;
      run(w, 1, (t) => [act(t, 'attack')]);
      run(w, 30);
    }
    expect(ped.alive).toBe(false);
    const cash = [...w.pickups.values()].reduce((a, p) => a + p.amount, 0) + (P(w).money - 500);
    expect(cash).toBe(321);
  });
});

describe('destruction', () => {
  it('a car plows through street furniture and knocks a lamp post over', async () => {
    const w = await world();
    const i = map.props.findIndex((p) => p.kind === 'streetlight');
    const p = map.props[i];
    // drive a car straight into the lamp post
    const v = w.spawnVehicle('sports', p.x + 12, 0.3, p.z, -Math.PI / 2 + Math.PI, 'p1', false);
    w.players.get('p1')!.state.vehicle = v.state.id;
    w.players.get('p1')!.collider.setEnabled(false);
    run(w, 120, (t) => [move(t, { throttle: 1 })]);
    expect(w.props.broken.has(i)).toBe(true);
    run(w, 120);
    expect(w.props.broken.get(i)!.tilt).toBeGreaterThan(1.4);
  });

  it('bullets and kicks break fragile props; hydrants spray', async () => {
    const i = map.props.findIndex((p) => p.kind === 'hydrant');
    const h = map.props[i];
    const w = await world({ x: h.x, y: 0.3, z: h.z + 1.4, yaw: 0 });
    for (const id of [...w.peds.keys()]) w.removePed(id);
    w.density.peds = 0;
    run(w, 10, (t) => [move(t, { yaw: 0 })]);
    w.players.get('p1')!.state.facing = 0;
    run(w, 1, (t) => [act(t, 'attack')]);
    run(w, 20);
    expect(w.props.broken.has(i)).toBe(true);
    expect(w.props.broken.get(i)!.spray).toBeGreaterThan(0);
  });

  it('broken props are part of the snapshot', async () => {
    const w = await world();
    w.breakProp(0, 5, 0);
    run(w, 30);
    expect(w.snapshot().props.map((p) => p.id)).toContain(0);
  });
});

describe('police', () => {
  async function wanted(level: number) {
    const w = await world();
    run(w, 10);
    const p = w.players.get('p1')!;
    p.state.wanted = level;
    w.police.reported(p, p.state.x, p.state.z);
    return { w, p };
  }
  const units = (w: SimWorld) => [...w.peds.values()].filter((x) => x.state.role !== 'civ');

  it('one star: officers come on foot and arrest you if you stand still', async () => {
    const { w } = await wanted(1);
    run(w, 60 * 2);
    expect(units(w).length).toBeGreaterThanOrEqual(1);
    expect(units(w)[0].state.weapon).toBe('baton');
    const money = P(w).money;
    let busted = false;
    for (let i = 0; i < 60 * 40 && !busted; i++) {
      w.step([]);
      busted = w.events.some((e) => e.type === 'busted');
      w.events = [];
    }
    expect(busted).toBe(true);
    expect(P(w).wanted).toBe(0);
    expect(P(w).money).toBeLessThan(money);
  });

  it('two stars: armed officers and patrol cars; they shoot', async () => {
    const { w } = await wanted(2);
    let cars = false;
    let pistols = false;
    let hurt = false;
    for (let i = 0; i < 60 * 15; i++) {
      w.step([]);
      cars ||= [...w.vehicles.values()].some((v) => v.police && v.state.siren);
      pistols ||= units(w).some((u) => u.state.weapon === 'pistol');
      hurt ||= P(w).health < 100;
    }
    expect(cars).toBe(true);
    expect(pistols).toBe(true);
    expect(hurt).toBe(true);
  });

  it('three stars bring a helicopter, five stars the army', async () => {
    const a = await wanted(3);
    run(a.w, 60 * 2);
    expect(a.w.police.helis.size).toBeGreaterThanOrEqual(1);
    const b = await wanted(5);
    run(b.w, 60 * 4);
    expect(units(b.w).some((u) => u.state.role === 'soldier') || [...b.w.vehicles.values()].some((v) => v.state.type === 'army')).toBe(true);
  });

  it('leaving the search zone and hiding loses the police', async () => {
    const { w, p } = await wanted(2);
    run(w, 30);
    // teleport far away from everybody (outside the search zone)
    for (const u of units(w)) w.removePed(u.state.id);
    for (const v of [...w.vehicles.values()]) if (v.police) w.removeVehicle(v.state.id);
    w.police.helis.clear();
    p.teleport(300, 0.5, -300);
    let lost = false;
    for (let i = 0; i < 60 * 12 && !lost; i++) {
      // keep removing newly dispatched units so nobody sees us
      for (const u of units(w)) w.removePed(u.state.id);
      for (const v of [...w.vehicles.values()]) if (v.police) w.removeVehicle(v.state.id);
      w.step([]);
      lost = P(w).wanted === 0;
    }
    expect(lost).toBe(true);
  });

  it('a repaint at the garage clears the stars', async () => {
    const g = map.pois.find((q) => q.kind === 'garage')!;
    const w = await world({ x: g.x, y: 0.5, z: g.z - 4, yaw: 0 });
    run(w, 5);
    const v = w.spawnVehicle('compact', g.x + 3, 0.3, g.z - 4, 0, 'none', false);
    w.players.get('p1')!.teleport(v.state.x + 2, 0.4, v.state.z);
    run(w, 3);
    run(w, 1, (t) => [act(t, 'use')]);
    expect(P(w).vehicle).toBe(v.state.id);
    P(w).wanted = 2;
    run(w, 2);
    expect(P(w).context?.kind).toBe('repaint');
    const money = P(w).money;
    run(w, 1, (t) => [act(t, 'use')]);
    expect(P(w).wanted).toBe(0);
    expect(P(w).money).toBe(money - 300);
  });
});
