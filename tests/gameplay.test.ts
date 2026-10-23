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
const act = (tick: number, action: ActionCommand['action'], arg?: string): ActionCommand => ({ type: 'action', playerId: 'p1', tick, action, arg });
/** Give the test player a pistol with some bullets (players start bare-handed). */
const arm = (w: SimWorld) => {
  const s = w.players.get('p1')!.state;
  if (!s.weapons.includes('pistol')) s.weapons.push('pistol');
  s.ammo.pistol = 48;
};

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
    const cash = [...w.pickups.values()].filter((pk) => pk.kind === 'money');
    for (const pk of cash) w.players.get('p1')!.teleport(pk.x, 0.2, pk.z);
    run(w, 3);
    expect(cash.every((pk) => !w.pickups.has(pk.id))).toBe(true);
    expect(P(w).money).toBeGreaterThan(money0);
  });

  it('the pistol auto-aims, uses ammo and raises the wanted level', async () => {
    const { w, ped } = await withPed();
    ped.state.z -= 8;
    arm(w);
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
    arm(w);
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

describe('shops, wardrobe and garage', () => {
  async function inside(kind: string) {
    const def = map.interiors.find((i) => i.kind === kind)!;
    const fx = -Math.sin(def.door.yaw);
    const fz = -Math.cos(def.door.yaw);
    const w = await world({ x: def.door.x + fx * 1.2, y: 0.3, z: def.door.z + fz * 1.2, yaw: 0 });
    P(w).rep = 1e6; // everything unlocked
    run(w, 5);
    run(w, 1, (t) => [act(t, 'use')]);
    expect(P(w).interior).toBe(def.id);
    return { w, room: w.rooms.get(def.id)! };
  }

  it('buys weapons, ammo and a vest at the gun shop', async () => {
    const { w, room } = await inside('gunshop');
    P(w).money = 5000;
    w.players.get('p1')!.teleport(room.counter!.x, 0.2, room.counter!.z);
    run(w, 3);
    expect(P(w).context?.kind).toBe('shop');
    run(w, 1, (t) => [act(t, 'buy', 'weapon:pistol'), act(t, 'buy', 'weapon:bat'), act(t, 'buy', 'armor')]);
    expect(P(w).weapons).toEqual(expect.arrayContaining(['pistol', 'bat']));
    expect(P(w).ammo.pistol).toBe(36);
    expect(P(w).armor).toBe(100);
    run(w, 1, (t) => [act(t, 'buy', 'ammo:pistol')]);
    expect(P(w).ammo.pistol).toBe(72);
    expect(P(w).money).toBe(5000 - 600 - 280 - 400 - 120);
  });

  it('refuses purchases outside the shop or without money', async () => {
    const w = await world();
    run(w, 1, (t) => [act(t, 'buy', 'weapon:pistol')]);
    expect(P(w).weapons).not.toContain('pistol');
    const g = await inside('gunshop');
    g.w.players.get('p1')!.teleport(g.room.counter!.x, 0.2, g.room.counter!.z);
    P(g.w).money = 10;
    run(g.w, 1, (t) => [act(t, 'buy', 'weapon:smg')]);
    expect(P(g.w).weapons).not.toContain('smg');
  });

  it('clothes bought are worn, and can be changed at the hideout wardrobe', async () => {
    const c = await inside('clothes');
    c.w.players.get('p1')!.teleport(c.room.counter!.x, 0.2, c.room.counter!.z);
    run(c.w, 1, (t) => [act(t, 'buy', 'cloth:hoodie_red')]);
    expect(P(c.w).clothes).toContain('hoodie_red');
    expect(P(c.w).outfit.top).toBe(0xe63946);
    const h = await inside('hideout');
    P(h.w).clothes = ['tee_gold'];
    h.w.players.get('p1')!.teleport(h.room.wardrobe!.x, 0.2, h.room.wardrobe!.z);
    run(h.w, 3);
    expect(P(h.w).context?.kind).toBe('wardrobe');
    run(h.w, 1, (t) => [act(t, 'wear', 'tee_gold')]);
    expect(P(h.w).outfit.top).toBe(0xffc93c);
  });

  it('a car parked at the hideout is kept in the garage and can be taken out', async () => {
    const def = map.interiors.find((i) => i.kind === 'hideout')!;
    const fx = -Math.sin(def.door.yaw);
    const fz = -Math.cos(def.door.yaw);
    const w = await world({ x: def.door.x + fx * 6, y: 0.4, z: def.door.z + fz * 6, yaw: 0 });
    run(w, 3);
    const v = w.spawnVehicle('sports', def.door.x + fx * 6 + 2.2, 0.3, def.door.z + fz * 6, 0, 'none', false);
    run(w, 2);
    run(w, 1, (t) => [act(t, 'use')]);
    expect(P(w).vehicle).toBe(v.state.id);
    run(w, 2);
    expect(P(w).context?.kind).toBe('store_vehicle');
    run(w, 1, (t) => [act(t, 'use')]);
    expect(P(w).garage.map((g) => g.type)).toEqual(['sports']);
    expect(w.vehicles.has(v.state.id)).toBe(false);
    // walk in, take it out from the garage terminal
    w.players.get('p1')!.teleport(def.door.x + fx * 1.2, 0.3, def.door.z + fz * 1.2);
    run(w, 2);
    run(w, 1, (t) => [act(t, 'use')]);
    const room = w.rooms.get(def.id)!;
    w.players.get('p1')!.teleport(room.garage!.x, 0.2, room.garage!.z);
    run(w, 2);
    expect(P(w).context?.kind).toBe('garage');
    run(w, 1, (t) => [act(t, 'garage_out', '0')]);
    expect(P(w).interior).toBeNull();
    expect(P(w).vehicle).toBeGreaterThan(0);
    expect(P(w).garage.length).toBe(0);
  });

  it('apartments can be bought', async () => {
    const def = map.interiors.find((i) => i.kind === 'apartment')!;
    const fx = -Math.sin(def.door.yaw);
    const fz = -Math.cos(def.door.yaw);
    const w = await world({ x: def.door.x + fx * 1.2, y: 0.3, z: def.door.z + fz * 1.2, yaw: 0 });
    P(w).rep = 1e6;
    run(w, 3);
    expect(P(w).context?.kind).toBe('buy_home');
    P(w).money = 100000;
    run(w, 1, (t) => [act(t, 'use')]);
    expect(P(w).homes).toContain(def.id);
    run(w, 2);
    expect(P(w).context?.kind).toBe('enter_building');
  });
});

describe('missions', () => {
  const giver = (w: SimWorld, id: string) => w.missions.givers.find((g) => g.id === id)!;
  async function at(id: string, done: string[] = []) {
    const g0 = buildParisMap();
    const w = await SimWorld.create(g0);
    const gv = w.missions.givers.find((g) => g.id === id)!;
    w.addPlayer('p1', { x: gv.x, y: 0.5, z: gv.z, yaw: 0 });
    P(w).missionsDone = done;
    run(w, 3);
    return w;
  }
  const tp = (w: SimWorld, x: number, z: number) => {
    w.teleportPlayer(w.players.get('p1')!, x, 0.5, z);
    run(w, 3);
  };

  it('a marker offers the first mission; locked ones say so', async () => {
    const w = await at('colis');
    expect(P(w).context?.kind).toBe('mission');
    const w2 = await at('casse');
    expect(P(w2).context?.label).toContain('🔒');
    run(w2, 1, (t) => [act(t, 'use')]);
    expect(P(w2).mission).toBeNull();
  });

  it('timed delivery: pick up, deliver before the clock runs out, get paid', async () => {
    const w = await at('colis');
    const money = P(w).money;
    run(w, 1, (t) => [act(t, 'use')]);
    expect(P(w).mission).toBe('colis');
    expect(P(w).waypoint).not.toBeNull();
    const [x, z] = P(w).waypoint!;
    tp(w, x, z);
    expect(P(w).missionStep).toBe(1);
    run(w, 30);
    expect(P(w).missionTimer).toBeGreaterThan(80);
    expect(P(w).missionTimer).toBeLessThan(90);
    const [dx, dz] = P(w).waypoint!;
    tp(w, dx, dz + 2);
    expect(P(w).mission).toBeNull();
    expect(P(w).missionsDone).toContain('colis');
    expect(P(w).money).toBe(money + 600);
    expect(P(w).rep).toBe(30);
  });

  it('runs out of time', async () => {
    const w = await at('colis');
    w.density = { peds: 0, traffic: 0, parkedRadius: 0 };
    run(w, 1, (t) => [act(t, 'use')]);
    tp(w, ...P(w).waypoint!);
    run(w, 60 * 91);
    expect(P(w).mission).toBeNull();
    expect(P(w).missionsDone).not.toContain('colis');
  });

  it('elimination: thugs fight back; knocking them all out (with help or not) completes the step', async () => {
    const w = await at('dette', ['colis']);
    run(w, 1, (t) => [act(t, 'use')]);
    tp(w, ...P(w).waypoint!);
    run(w, 5);
    expect(P(w).missionStep).toBe(1);
    const thugs = P(w).missionTargets.map((id) => w.peds.get(id)!);
    expect(thugs.length).toBe(3);
    run(w, 30);
    expect(thugs.some((t) => t.state.mode === 'fight')).toBe(true);
    // another player (or anyone) can take them down
    for (const t of thugs) w.damagePed(t, 999, null, t.state.x, t.state.z);
    run(w, 2);
    expect(P(w).missionStep).toBe(2);
    tp(w, ...P(w).waypoint!);
    expect(P(w).missionsDone).toContain('dette');
  });

  it('escort: the witness follows; if killed the mission fails', async () => {
    const w = await at('temoin', ['colis', 'dette']);
    run(w, 1, (t) => [act(t, 'use')]);
    const wid = P(w).missionTargets[0];
    const witness = w.peds.get(wid)!;
    expect(witness.state.mode).toBe('follow');
    const d0 = Math.hypot(witness.state.x - P(w).x, witness.state.z - P(w).z);
    // walk away: the witness keeps up
    run(w, 120, (t) => [move(t, { y: 1, sprint: false })]);
    expect(Math.hypot(witness.state.x - P(w).x, witness.state.z - P(w).z)).toBeLessThan(d0 + 4);
    w.damagePed(witness, 999, null, 0, 0);
    run(w, 2);
    expect(P(w).mission).toBeNull();
  });

  it('escort reaches the police station', async () => {
    const w = await at('temoin', ['colis', 'dette']);
    run(w, 1, (t) => [act(t, 'use')]);
    const witness = w.peds.get(P(w).missionTargets[0])!;
    const [x, z] = P(w).waypoint!;
    // move both next to the station
    witness.state.x = x + 2;
    witness.state.z = z + 2;
    tp(w, x + 3, z + 2);
    run(w, 60);
    expect(P(w).missionsDone).toContain('temoin');
  });

  it('chase: a stolen car flees through traffic; wrecking it completes the mission', async () => {
    const w = await at('rodeo', ['colis', 'dette', 'temoin']);
    run(w, 1, (t) => [act(t, 'use')]);
    const car = w.vehicles.get(P(w).missionTargets[0])!;
    expect(car.state.driver).toBe('npc');
    const x0 = car.state.x;
    const z0 = car.state.z;
    run(w, 120);
    expect(Math.hypot(car.state.x - x0, car.state.z - z0)).toBeGreaterThan(10);
    car.state.health = car.spec.health * 0.3;
    run(w, 2);
    expect(car.state.driver).toBe('none');
    car.state.health = 0;
    run(w, 2);
    expect(P(w).missionsDone).toContain('rodeo');
  });

  it('heist: get armed, rob the bank, lose the police, hide', async () => {
    const w = await at('casse', ['colis', 'dette', 'temoin', 'rodeo']);
    run(w, 1, (t) => [act(t, 'use')]);
    expect(P(w).missionStep).toBe(0);
    arm(w);
    run(w, 2);
    expect(P(w).missionStep).toBe(1);
    // rob the bank
    const bank = map.interiors.find((i) => i.kind === 'bank')!;
    tp(w, bank.door.x, bank.door.z + 1.5);
    run(w, 1, (t) => [act(t, 'use')]);
    expect(P(w).interior).toBe(bank.id);
    const room = w.rooms.get(bank.id)!;
    tp(w, room.counter!.x, room.counter!.z);
    P(w).weapon = 'pistol';
    run(w, 3);
    expect(P(w).context?.kind).toBe('rob');
    run(w, 1, (t) => [act(t, 'use')]);
    run(w, 60 * 11);
    expect(P(w).missionStep).toBe(2);
    expect(P(w).wanted).toBeGreaterThanOrEqual(3);
    w.clearWanted(w.players.get('p1')!);
    run(w, 2);
    expect(P(w).missionStep).toBe(3);
    const home = map.interiors.find((i) => i.kind === 'hideout')!;
    P(w).interior = null;
    tp(w, home.door.x, home.door.z + 2);
    expect(P(w).missionsDone).toContain('casse');
    expect(P(w).rep).toBeGreaterThanOrEqual(150);
    void giver;
  });
});

describe('progression', () => {
  it('levels: XP curve, level-up rewards and gated purchases', async () => {
    const { levelOf, xpToNext } = await import('../src/data/progression');
    expect(levelOf(0)).toBe(1);
    expect(levelOf(xpToNext(1))).toBe(2);
    const w = await world();
    run(w, 2);
    const s = P(w);
    s.rep = 0;
    const money = s.money;
    w.progress.addXp(w.players.get('p1')!, xpToNext(1) + xpToNext(2));
    expect(levelOf(s.rep)).toBe(3);
    expect(s.money).toBeGreaterThan(money);
    expect(w.drainEvents().filter((e) => e.type === 'levelup').length).toBe(2);
  });

  it('chaos combo: mayhem builds a multiplier, then cashes in money and XP', async () => {
    const w = await world();
    w.density = { peds: 0, traffic: 0, parkedRadius: 0 };
    run(w, 2);
    const p = w.players.get('p1')!;
    const s = P(w);
    const money = s.money;
    const xp = s.rep;
    for (let i = 0; i < 9; i++) w.progress.onProp(p);
    expect(s.chaosMult).toBe(3);
    expect(s.chaos).toBeGreaterThan(9 * 15);
    run(w, 60 * 5);
    expect(s.chaos).toBe(0);
    expect(s.money).toBeGreaterThan(money);
    expect(s.rep).toBeGreaterThan(xp);
  });

  it('knocking someone out gives XP and chaos', async () => {
    const w = await world();
    run(w, 2);
    const ped = w.spawnPed(P(w).x + 1, P(w).z, { mode: 'idle' });
    const xp = P(w).rep;
    w.damagePed(ped, 999, w.players.get('p1')!, P(w).x, P(w).z);
    expect(P(w).rep).toBeGreaterThan(xp);
    expect(P(w).chaos).toBeGreaterThan(0);
  });
});

describe('daily contracts, streak and fence', () => {
  it('the same 3 contracts for everyone each day, new ones the next day', async () => {
    const { dailyContracts } = await import('../src/data/contracts');
    expect(dailyContracts(20000).map((c) => c.text)).toEqual(dailyContracts(20000).map((c) => c.text));
    expect(dailyContracts(20000).length).toBe(3);
    expect(dailyContracts(20000).map((c) => c.text)).not.toEqual(dailyContracts(20001).map((c) => c.text));
  });

  it('progress pays out, finishing all gives a bonus; login streak rewards', async () => {
    const w = await world();
    w.day = 20000;
    run(w, 31);
    const s = P(w);
    expect(s.contracts.length).toBe(3);
    expect(s.streak).toBe(1);
    const p = w.players.get('p1')!;
    const money = s.money;
    for (const c of s.contracts) w.contracts.track(p, c.stat, c.goal, c.stat === 'chaos');
    expect(s.contracts.every((c) => c.progress >= c.goal)).toBe(true);
    const total = s.contracts.reduce((a, c) => a + c.cash, 0);
    expect(s.money).toBeGreaterThanOrEqual(money + total + 1500);
    // next day: new contracts, streak 2
    w.day = 20001;
    run(w, 31);
    expect(s.streak).toBe(2);
    expect(s.contracts.every((c) => c.progress === 0)).toBe(true);
    // a missed day slips back one step instead of resetting
    w.day = 20005;
    run(w, 31);
    expect(s.streak).toBe(1);
  });

  it('the fence buys the car he ordered', async () => {
    const w = await world();
    run(w, 31);
    const s = P(w);
    const f = w.contracts.fence;
    const type = s.fenceOrder!;
    const v = w.spawnVehicle(type, f.x, 0.3, f.z, 0, 'none', false);
    w.teleportPlayer(w.players.get('p1')!, f.x + 2, 0.5, f.z);
    run(w, 2);
    // get in
    s.vehicle = -1;
    run(w, 1, (t) => [act(t, 'use')]);
    expect(s.vehicle).toBe(v.state.id);
    run(w, 2);
    expect(s.context?.kind).toBe('fence');
    const money = s.money;
    run(w, 1, (t) => [act(t, 'use')]);
    expect(s.vehicle).toBe(-1);
    expect(w.vehicles.has(v.state.id)).toBe(false);
    expect(s.money).toBeGreaterThan(money + 200);
  });
});

describe('surprises', () => {
  it('a surprise crate gives a reward when walked over', async () => {
    const w = await world();
    run(w, 2);
    const s = P(w);
    const before = { money: s.money, armor: s.armor, xp: s.rep };
    w.pickups.set(9999, { id: 9999, x: s.x, y: s.y, z: s.z, kind: 'crate', amount: 0 });
    run(w, 2);
    expect(w.pickups.has(9999)).toBe(false);
    expect(s.rep).toBeGreaterThan(before.xp);
    expect(w.drainEvents().some((e) => e.type === 'crate')).toBe(true);
  });

  it('crates appear around players over time', async () => {
    const w = await world();
    w.density = { peds: 0, traffic: 0, parkedRadius: 0 };
    run(w, 60 * 20);
    expect([...w.pickups.values()].filter((p) => p.kind === 'crate').length).toBeGreaterThan(0);
  });
});

describe('tutorial', () => {
  it('starts by itself for new players: K.O., steal a car, park it at the hideout', async () => {
    const w = await world();
    const s = P(w);
    s.tutorialDone = false;
    run(w, 61);
    expect(s.mission).toBe('tuto');
    const ped = w.spawnPed(s.x + 1, s.z, { mode: 'idle' });
    w.damagePed(ped, 999, w.players.get('p1')!, s.x, s.z);
    run(w, 2);
    expect(s.missionStep).toBe(1);
    const home = map.interiors.find((i) => i.kind === 'hideout')!;
    const v = w.spawnVehicle('compact', home.door.x, 0.3, home.door.z + 6, 0, 'none', false);
    w.teleportPlayer(w.players.get('p1')!, home.door.x + 2.2, 0.5, home.door.z + 6);
    run(w, 3);
    run(w, 1, (t) => [act(t, 'use')]);
    expect(s.vehicle).toBe(v.state.id);
    run(w, 3);
    expect(s.missionStep).toBe(2);
    expect(s.context?.kind).toBe('store_vehicle');
    run(w, 1, (t) => [act(t, 'use')]);
    expect(s.tutorialDone).toBe(true);
    expect(s.garage.length).toBe(1);
    expect(s.mission).toBeNull();
  });

  it('can be skipped', async () => {
    const w = await world();
    P(w).tutorialDone = false;
    run(w, 61);
    run(w, 1, (t) => [act(t, 'mission', 'abort')]);
    expect(P(w).tutorialDone).toBe(true);
    run(w, 120);
    expect(P(w).mission).toBeNull();
  });
});

describe('hideout businesses', () => {
  it('produce cash over (real) time, capped at 8 h, collected at the hideout laptop', async () => {
    const def = map.interiors.find((i) => i.kind === 'hideout')!;
    const fx = -Math.sin(def.door.yaw);
    const fz = -Math.cos(def.door.yaw);
    const w = await world({ x: def.door.x + fx * 1.2, y: 0.3, z: def.door.z + fz * 1.2, yaw: 0 });
    const s = P(w);
    s.rep = 1e6;
    s.money = 10000;
    w.now = 1_000_000;
    run(w, 3);
    run(w, 1, (t) => [act(t, 'use')]);
    expect(s.interior).toBe(def.id);
    const room = w.rooms.get(def.id)!;
    w.teleportPlayer(w.players.get('p1')!, room.office!.x, 0.3, room.office!.z);
    run(w, 3);
    expect(s.context?.kind).toBe('business');
    run(w, 1, (t) => [act(t, 'buy', 'biz:atelier')]);
    expect(s.biz.length).toBe(1);
    expect(s.money).toBe(2000);
    w.now += 2 * 3600;
    run(w, 1, (t) => [act(t, 'collect', 'atelier')]);
    expect(s.money).toBe(2800);
    w.now += 30 * 3600; // way past the cap
    run(w, 1, (t) => [act(t, 'collect', 'atelier')]);
    expect(s.money).toBe(2800 + 400 * 8);
  });
});

describe('multiplayer social', () => {
  async function two() {
    const w = await world();
    w.addPlayer('p2', { ...map.spawn, x: map.spawn.x + 1.5 });
    run(w, 3);
    return { w, a: w.players.get('p1')!, b: w.players.get('p2')! };
  }

  it('a 4-star player gets a bounty; the hunter who knocks them out cashes it', async () => {
    const { w, a, b } = await two();
    b.state.wanted = 4;
    run(w, 2);
    expect(b.state.bounty).toBeGreaterThan(0);
    const prize = b.state.bounty;
    const money = a.state.money;
    w.damagePlayer(b, 999, a);
    expect(b.state.bounty).toBe(0);
    expect(a.state.money).toBeGreaterThanOrEqual(money + prize);
    expect(a.state.week.bounties).toBe(1);
  });

  it('surviving the bounty pays double', async () => {
    const { w, b } = await two();
    b.state.wanted = 4;
    run(w, 2);
    const prize = b.state.bounty;
    const money = b.state.money;
    b.state.bountyTimer = 0.01;
    run(w, 2);
    expect(b.state.money).toBeGreaterThanOrEqual(money + prize * 2);
  });

  it('no bounty in solo', async () => {
    const w = await world();
    run(w, 2);
    P(w).wanted = 5;
    run(w, 2);
    expect(P(w).bounty).toBe(0);
  });

  it('crews: found, join next to a member, no friendly fire', async () => {
    const { w, a, b } = await two();
    run(w, 1, (t) => [act(t, 'crew', 'create:Les Loups')]);
    expect(a.state.crew?.name).toBe('LES LOUPS');
    run(w, 2);
    expect(b.state.context?.kind).toBe('crew_join');
    w.step([{ type: 'action', playerId: 'p2', tick: w.tick, action: 'use' }]);
    expect(b.state.crew?.name).toBe('LES LOUPS');
    expect(w.social.friendly(a, b)).toBe(true);
  });

  it('co-op heist: needs two players, drill together, each one carries a share to the drop-off', async () => {
    const { w, a, b } = await two();
    w.density = { peds: 0, traffic: 0, parkedRadius: 0 };
    const spot = w.heist.spot;
    for (const p of [a, b]) w.teleportPlayer(p, spot.x + (p === a ? 0 : 1.5), 0.5, spot.z);
    run(w, 3);
    expect(a.state.context?.kind).toBe('heist');
    run(w, 1, (t) => [act(t, 'heist')]);
    expect(a.state.mission).toBe('coffre');
    expect(b.state.mission).toBe('coffre');
    // both walk into the bank
    const bank = map.interiors.find((i) => i.kind === 'bank')!;
    const room = w.rooms.get(bank.id)!;
    for (const p of [a, b]) {
      p.state.interior = bank.id;
      w.teleportPlayer(p, room.spawn.x, 0.3, room.spawn.z);
    }
    run(w, 3);
    expect(a.state.wanted).toBeGreaterThanOrEqual(3);
    // to the vault
    const vx = bank.origin.x + bank.w / 2 - 3;
    const vz = bank.origin.z - bank.d / 2 + 1.8;
    for (const p of [a, b]) w.teleportPlayer(p, vx + (p === a ? 0.5 : -0.5), 0.3, vz);
    for (const p of [a, b]) w.clearWanted(p);
    run(w, 60 * 31);
    expect(a.state.objective).toContain('dépôt');
    // out to the drop-off
    const drop = w.contracts.fence;
    const money = a.state.money;
    for (const p of [a, b]) {
      p.state.interior = null;
      w.teleportPlayer(p, drop.x, 0.5, drop.z + (p === a ? 0 : 2));
    }
    run(w, 3);
    expect(a.state.mission).toBeNull();
    expect(a.state.money).toBeGreaterThanOrEqual(money + 12000);
    expect(a.state.week.heists).toBe(1);
  });
});
