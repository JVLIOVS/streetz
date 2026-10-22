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
