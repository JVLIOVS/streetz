import { describe, expect, it } from 'vitest';
import { CommandQueue, type MoveCommand } from '../src/core/commands';
import { DT, FixedLoop } from '../src/core/loop';
import { Rng } from '../src/core/rng';
import { defaultSave, loadSave, writeSave } from '../src/core/save';

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('stays in [0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('FixedLoop', () => {
  it('runs 60 sim ticks per second whatever the frame rate', () => {
    let steps = 0;
    const loop = new FixedLoop(() => steps++, () => {});
    let t = 0;
    loop.frame(t);
    for (let i = 0; i < 30; i++) loop.frame((t += 1000 / 30)); // 30 FPS for 1 s
    expect(steps).toBeGreaterThanOrEqual(59);
    expect(steps).toBeLessThanOrEqual(61);
  });
  it('gives an interpolation alpha in [0, 1)', () => {
    let alpha = -1;
    const loop = new FixedLoop(() => {}, (a) => (alpha = a));
    loop.frame(0);
    loop.frame(DT * 1000 * 1.5);
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);
  });
  it('does not spiral after a long hitch', () => {
    let steps = 0;
    const loop = new FixedLoop(() => steps++, () => {});
    loop.frame(0);
    loop.frame(10_000);
    expect(steps).toBeLessThanOrEqual(5);
  });
});

describe('CommandQueue', () => {
  it('drains commands up to a tick and keeps the rest', () => {
    const q = new CommandQueue();
    const mk = (tick: number): MoveCommand => ({ type: 'move', playerId: 'p', tick, x: 0, y: 1, yaw: 0, sprint: false, jump: false, throttle: 0, handbrake: false });
    q.push(mk(1));
    q.push(mk(2));
    q.push(mk(5));
    expect(q.drain(2).map((c) => c.tick)).toEqual([1, 2]);
    expect(q.size).toBe(1);
  });
  it('commands survive a JSON round trip (network-ready)', () => {
    const c: MoveCommand = { type: 'move', playerId: 'p', tick: 3, x: 0.5, y: -1, yaw: 1.2, sprint: true, jump: false, throttle: 0, handbrake: false };
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });
});

describe('save', () => {
  it('round-trips and falls back to defaults on garbage', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const s = defaultSave();
    s.profile.money = 1234;
    writeSave(s, storage);
    expect(loadSave(storage).profile.money).toBe(1234);
    store.set('streetz.save', '{oops');
    expect(loadSave(storage)).toEqual(defaultSave());
  });
});

describe('security: untrusted network input', () => {
  it('a hostile profile is cut down to known items and sane numbers', async () => {
    const { sanitize } = await import('../src/core/save');
    const p = sanitize({
      money: 1e15,
      rep: Infinity,
      weapons: ['pistol', 'nuke', '__proto__'] as never,
      ammo: { pistol: 1e9, nuke: 5, constructor: 3 } as never,
      clothes: ['<img onerror=alert(1)>'],
      missions: ['casse', 'hack'],
      garage: [{ type: 'tank', paint: 1 }, { type: 'sports', paint: 'x' }] as never,
      skills: { force: 99, magic: 5 } as never,
      crew: { name: '<b>evil</b>crewname', color: NaN },
      outfit: { top: 'red', hairStyle: 'x' } as never,
      week: { best: -5, kos: 'a' } as never,
    });
    expect(p.money).toBe(10_000_000);
    expect(Number.isFinite(p.rep)).toBe(true);
    expect(p.weapons).toEqual(['fist', 'pistol']);
    expect(p.ammo).toEqual({ pistol: 9999 });
    expect(p.clothes).toEqual([]);
    expect(p.missions).toEqual(['casse']);
    expect(p.garage).toEqual([{ type: 'sports', paint: 0 }]);
    expect(p.skills.force).toBe(10);
    expect(p.crew!.name).not.toMatch(/[<>]/);
    expect(p.outfit).toEqual({ top: 0 });
    expect(p.week.best).toBe(0);
  });

  it('reports with NaN / out-of-world positions / healing damage are refused; actions are whitelisted', async () => {
    const { validReport, cleanActions, cleanName, RateLimiter } = await import('../src/net/validate');
    const ok = { x: 1, y: 0, z: 2, vx: 0, vz: 0, f: 0, yaw: 0, anim: 'idle', g: true, sp: 0, tp: 0 };
    expect(validReport(ok)).toBe(true);
    expect(validReport({ ...ok, x: NaN })).toBe(false);
    expect(validReport({ ...ok, z: 1e9 })).toBe(false);
    expect(validReport({ ...ok, anim: 'dance' })).toBe(false);
    const v = { id: 3, x: 1, y: 0, z: 1, yaw: 0, pitch: 0, roll: 0, vx: 0, vz: 0, speed: 0, steer: 0 };
    expect(validReport({ ...ok, v: { ...v, dmg: 2 } })).toBe(true);
    expect(validReport({ ...ok, v: { ...v, dmg: -500 } })).toBe(false);
    const acts = cleanActions([{ k: 'attack' }, { k: 'eval', arg: 'x' }, { k: 'buy', arg: 'a'.repeat(500) }, ...Array(20).fill({ k: 'use' })]);
    expect(acts.map((a) => a.k)).toEqual(['attack', 'buy', 'use', 'use', 'use']);
    expect(acts[1].arg!.length).toBe(48);
    expect(cleanName('<script>‮Bob')).toBe('scriptBob');
    expect(cleanName(42)).toBe('Joueur');
    const rl = new RateLimiter(3);
    expect([1, 2, 3, 4].map(() => rl.allow('a', 0))).toEqual([true, true, true, false]);
    expect(rl.allow('a', 1500)).toBe(true);
  });
});

describe('security: bounds', () => {
  it('every interior room fits in the area accepted from guests', async () => {
    const { buildParisMap } = await import('../src/maps/paris/layout');
    const { validReport } = await import('../src/net/validate');
    for (const i of buildParisMap().interiors) {
      const r = { x: i.origin.x + i.w, y: 0, z: i.origin.z + i.d, vx: 0, vz: 0, f: 0, yaw: 0, anim: 'idle', g: true, sp: 0, tp: 0 };
      expect(validReport(r)).toBe(true);
    }
  });

  it('a negative bank deposit does not create money', async () => {
    const { SimWorld } = await import('../src/sim/world');
    const { buildParisMap } = await import('../src/maps/paris/layout');
    const map = buildParisMap();
    const w = await SimWorld.create(map);
    const p = w.addPlayer('p1');
    const bank = map.interiors.find((i) => i.kind === 'bank')!;
    p.state.interior = bank.id;
    const c = w.rooms.get(bank.id)!.counter!;
    p.state.x = c.x;
    p.state.z = c.z;
    p.state.money = 100;
    w.law.bankOp(p, 'deposit:-1000000');
    w.law.bankOp(p, 'withdraw:-1000000');
    expect(p.state.money).toBe(100);
    expect(p.state.bank).toBe(0);
  });
});
