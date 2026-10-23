import { DT } from '../core/loop';
import { WEAPONS } from '../data/weapons';
import { COOL_TIME, HIDE_TIME, POLICE_LEVELS, REINFORCE_EVERY, RESPONSE_DELAY, searchRadius } from '../data/police';
import type { Ped, PedRole } from './peds';
import type { Player } from './player';
import { angleDiff } from './player';
import { astar } from './pathfind';
import type { Vehicle } from './vehicle';
import type { SimWorld } from './world';

/** Serializable police helicopter. */
export interface HeliState {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  /** Seconds since it was shot down (falling / burning), -1 while flying. */
  down: number;
  army: boolean;
  rotor: number;
}

export class Heli {
  prev = { x: 0, y: 0, z: 0, yaw: 0 };
  target: string | null = null;
  orbit = 0;
  cooldown = 2;
  vx = 0;
  vz = 0;
  vy = 0;
  net: { x: number; y: number; z: number; yaw: number } | null = null;
  /** Player who last shot it (credited when it goes down). */
  lastHitBy: string | null = null;
  constructor(public state: HeliState) {
    this.savePrev();
  }
  savePrev() {
    Object.assign(this.prev, { x: this.state.x, y: this.state.y, z: this.state.z, yaw: this.state.yaw });
  }
}

const UNIT_HEALTH: Record<Exclude<PedRole, 'civ'>, number> = { cop: 110, swat: 160, soldier: 200 };

/**
 * Police response: dispatches officers, cars, helicopters, roadblocks and the army
 * according to each wanted player's stars, runs their AI, and handles losing the cops
 * (leave the search zone and stay unseen) or getting arrested.
 */
export class PoliceSystem {
  readonly helis = new Map<number, Heli>();
  /** Tick when the next unit may arrive, per wanted player. */
  private arrival = new Map<string, number>();
  /** Route per unit (walk-graph or lane-graph node ids) and when to recompute it. */
  private routes = new Map<number, { path: number[]; repath: number; los: number; seen: boolean; stuck: number; side: number }>();

  constructor(private w: SimWorld) {}

  private route(id: number) {
    let r = this.routes.get(id);
    if (!r) this.routes.set(id, (r = { path: [], repath: 0, los: 0, seen: false, stuck: 0, side: 0 }));
    return r;
  }

  /** Clear line of sight between two ground points (checked a few times per second). */
  private lineOfSight(id: number, ax: number, az: number, bx: number, bz: number, d: number) {
    const r = this.route(id);
    r.los -= DT;
    if (r.los <= 0) {
      r.los = 0.25;
      r.seen = d < 3 || this.w.castStatic(ax, 1.4, az, (bx - ax) / d, 0, (bz - az) / d, d) >= d - 0.6;
    }
    return r.seen;
  }

  /** Next point to run to on the sidewalks towards (tx, tz). */
  private walkStep(id: number, x: number, z: number, tx: number, tz: number): { x: number; z: number } {
    const w = this.w;
    const r = this.route(id);
    r.repath -= DT;
    if (r.repath <= 0 || r.path.length === 0) {
      r.repath = 1.2;
      const from = w.nearestWalkNode(x, z);
      const to = w.nearestWalkNode(tx, tz);
      r.path = astar(w.walk.length, (i) => w.walk[i].links, (i) => w.walk[i], from, to);
      // already between the first two corners: don't walk back to the first one
      if (r.path.length > 1) {
        const a = w.walk[r.path[0]];
        const b = w.walk[r.path[1]];
        if (Math.hypot(b.x - x, b.z - z) < Math.hypot(b.x - a.x, b.z - a.z)) r.path.shift();
      }
    }
    while (r.path.length > 1) {
      const n = w.walk[r.path[0]];
      if (Math.hypot(n.x - x, n.z - z) > 1.5) break;
      r.path.shift();
    }
    const n = r.path.length ? w.walk[r.path[0]] : null;
    return n && Math.hypot(n.x - x, n.z - z) > 1.5 ? n : { x: tx, z: tz };
  }

  /** Next point to drive to on the street graph towards (tx, tz). */
  private driveStep(id: number, x: number, z: number, tx: number, tz: number): { x: number; z: number } {
    const w = this.w;
    const g = w.lanes;
    const r = this.route(id);
    r.repath -= DT;
    const nearest = (px: number, pz: number) => {
      let best = 0;
      let bd = Infinity;
      for (const n of g.nodes) {
        const d = Math.hypot(n.x - px, n.z - pz);
        if (d < bd) {
          bd = d;
          best = n.id;
        }
      }
      return best;
    };
    if (r.repath <= 0 || r.path.length === 0) {
      r.repath = 1.5;
      r.path = astar(g.nodes.length, (i) => g.nodes[i].out.map((l) => g.lanes[l].to), (i) => g.nodes[i], nearest(x, z), nearest(tx, tz));
      if (r.path.length > 1) {
        const a = g.nodes[r.path[0]];
        const b = g.nodes[r.path[1]];
        if (Math.hypot(b.x - x, b.z - z) < Math.hypot(b.x - a.x, b.z - a.z)) r.path.shift();
      }
    }
    while (r.path.length > 1) {
      const n = g.nodes[r.path[0]];
      if (Math.hypot(n.x - x, n.z - z) > 9) break;
      r.path.shift();
    }
    const n = r.path.length ? g.nodes[r.path[0]] : null;
    return n && Math.hypot(n.x - x, n.z - z) > 9 ? n : { x: tx, z: tz };
  }

  get units(): Ped[] {
    return [...this.w.peds.values()].filter((p) => p.state.role !== 'civ');
  }

  update() {
    const w = this.w;
    for (const p of w.players.values()) this.updateWanted(p);
    for (const ped of w.peds.values()) if (ped.state.role !== 'civ' && ped.alive && ped.state.mode === 'police' && !w.law.isStopCop(ped)) this.copAI(ped);
    for (const v of w.vehicles.values()) if (v.police && !v.state.wrecked) this.carAI(v);
    for (const h of [...this.helis.values()]) this.heliAI(h);
    if (w.tick % 30 === 0) {
      this.dispatch();
      for (const id of this.routes.keys()) if (!w.peds.has(id) && !w.vehicles.has(id)) this.routes.delete(id);
    }
  }

  // ------------------------------------------------------------------ wanted / escape

  /** Is any unit close enough (with line of sight) to see the player? */
  private sees(p: Player): boolean {
    const s = p.state;
    for (const h of this.helis.values()) if (h.state.down < 0 && Math.hypot(h.state.x - s.x, h.state.z - s.z) < 70) return true;
    for (const ped of this.w.peds.values()) {
      if (ped.state.role === 'civ' || !ped.alive) continue;
      const d = Math.hypot(ped.state.x - s.x, ped.state.z - s.z);
      if (d < 45 && (d < 8 || this.w.castStatic(ped.state.x, 1.6, ped.state.z, (s.x - ped.state.x) / d, 0, (s.z - ped.state.z) / d, d) >= d - 0.5)) return true;
    }
    for (const v of this.w.vehicles.values()) {
      if (!v.police || v.state.wrecked) continue;
      if (Math.hypot(v.state.x - s.x, v.state.z - s.z) < 50) return true;
    }
    return false;
  }

  /**
   * Below 4 stars the police tries to arrest you: officers get out of their cars and
   * only open fire if you resist (gun out near them, hitting officers). From 4 stars on,
   * or while resisting, they shoot and ram.
   */
  aggressive(s: { wanted: number; resist: number }) {
    return s.wanted >= 4 || s.resist > 0;
  }

  /** A crime was reported at (x, z): the search restarts from there. */
  reported(p: Player, x: number, z: number) {
    const s = p.state;
    s.searchX = x;
    s.searchZ = z;
    s.searchR = searchRadius(s.wanted);
    s.wantedSeen = true;
    p.unseen = 0;
  }

  private updateWanted(p: Player) {
    const s = p.state;
    if (s.wanted <= 0 || s.dead) {
      s.wantedSeen = false;
      s.arrest = Math.max(0, s.arrest - DT * 2);
      return;
    }
    s.searchR = searchRadius(s.wanted);
    if (s.resist > 0) s.resist = Math.max(0, s.resist - DT);
    // a gun out in front of officers counts as resisting
    if (s.wanted >= 2 && !WEAPONS[s.weapon].melee && s.vehicle < 0) {
      for (const ped of this.w.peds.values()) {
        if (ped.state.role !== 'civ' && ped.alive && Math.hypot(ped.state.x - s.x, ped.state.z - s.z) < 15) {
          if (s.resist <= 0) this.w.toast(p, '⚠ Arme sortie devant la police : ils vont tirer !');
          s.resist = 6;
          break;
        }
      }
    }
    if (this.sees(p)) {
      s.wantedSeen = true;
      s.searchX = s.x;
      s.searchZ = s.z;
      p.unseen = 0;
    } else {
      s.wantedSeen = false;
      p.unseen += DT;
      const out = Math.hypot(s.x - s.searchX, s.z - s.searchZ) > s.searchR;
      if (out && p.unseen > HIDE_TIME) {
        this.w.progress.onEscape(p, s.wanted);
        this.w.clearWanted(p, 'Tu as semé la police !');
      }
      else if (!out && p.unseen > COOL_TIME) {
        s.wanted--;
        p.unseen = 0;
        this.w.events.push({ type: 'wanted', playerId: s.id, level: s.wanted });
        if (s.wanted === 0) this.w.clearWanted(p, 'La police a abandonné les recherches');
      }
    }
    // arrest: an officer holds you (on foot and not running, or at the door of a
    // stopped car: you get pulled out). Up to 3 stars, unless you resist.
    let holding = false;
    const car = s.vehicle >= 0 ? this.w.vehicles.get(s.vehicle) : undefined;
    const still = car ? Math.abs(car.state.speed) < 1.5 : s.speed < 2.6;
    if (s.wanted <= 3 && !this.aggressive(s) && still) {
      for (const ped of this.w.peds.values()) {
        if (ped.state.role === 'civ' || !ped.alive || this.w.law.isStopCop(ped)) continue;
        if (Math.hypot(ped.state.x - s.x, ped.state.z - s.z) < (car ? 3.2 : 1.6)) {
          holding = true;
          break;
        }
      }
    }
    s.arrest = holding ? s.arrest + DT / 1.6 : Math.max(0, s.arrest - DT);
    if (s.arrest >= 1) this.w.arrest(p);
  }

  // ------------------------------------------------------------------ dispatch

  private dispatch() {
    const w = this.w;
    // (a player waiting for a fine only gets the one officer)
    const wantedPlayers = [...w.players.values()].filter((p) => p.state.wanted > 0 && p.state.fine <= 0 && !p.state.dead && !p.state.interior);
    // Units with nobody to chase go home (removed out of sight)
    for (const ped of [...w.peds.values()]) {
      if (ped.state.role === 'civ' || !ped.police || w.law.isStopCop(ped)) continue;
      const pol = ped.police;
      const t = pol.target ? w.players.get(pol.target) : undefined;
      if (!t || t.state.wanted === 0) pol.leaving = true;
      const near = [...w.players.values()].some((p) => Math.hypot(p.state.x - ped.state.x, p.state.z - ped.state.z) < (pol.leaving ? 50 : 220));
      if (!near || (!ped.alive && ped.timer > 30)) w.removePed(ped.state.id);
    }
    for (const v of [...w.vehicles.values()]) {
      if (!v.police) continue;
      const t = v.police.target ? w.players.get(v.police.target) : undefined;
      const near = [...w.players.values()].some((p) => Math.hypot(p.state.x - v.state.x, p.state.z - v.state.z) < (t && t.state.wanted > 0 ? 260 : 70));
      if (!t || t.state.wanted === 0) v.state.siren = false;
      if (!near) w.removeVehicle(v.state.id);
    }
    for (const h of [...this.helis.values()]) {
      const t = h.target ? w.players.get(h.target) : undefined;
      if (h.state.down < 0 && (!t || t.state.wanted < 3)) h.target = null; // flies away
      const far = ![...w.players.values()].some((p) => Math.hypot(p.state.x - h.state.x, p.state.z - h.state.z) < 260);
      if (far || h.state.down > 20) this.helis.delete(h.state.id);
    }

    for (const id of [...this.arrival.keys()]) if (!w.players.get(id)?.state.wanted) this.arrival.delete(id);
    for (const p of wantedPlayers) {
      const lvl = POLICE_LEVELS[Math.min(5, p.state.wanted)];
      const id = p.state.id;
      // the first units need time to get there, then reinforcements come one by one
      const at = this.arrival.get(id);
      if (at === undefined) {
        this.arrival.set(id, w.tick + RESPONSE_DELAY[Math.min(5, p.state.wanted)] * 60);
        continue;
      }
      if (w.tick < at) continue;
      this.arrival.set(id, w.tick + REINFORCE_EVERY * 60);
      const cops = [...w.peds.values()].filter((c) => c.police?.target === id && c.alive && !c.police.leaving).length;
      const cars = [...w.vehicles.values()].filter((v) => v.police?.target === id && !v.police.block && !v.state.wrecked).length;
      const helis = [...this.helis.values()].filter((h) => h.target === id && h.state.down < 0).length;
      if (cops < lvl.cops) this.spawnCop(p, lvl.unit);
      if (cars < lvl.cars) this.spawnCar(p, lvl.unit === 'soldier' ? 'army' : 'police');
      if (helis < lvl.helis) this.spawnHeli(p, lvl.unit === 'soldier');
      if (lvl.roadblocks && w.tick % 1200 === 0) this.roadblock(p);
    }
  }

  private makeUnit(ped: Ped, role: Exclude<PedRole, 'civ'>, target: string, level: number) {
    const s = ped.state;
    s.role = role;
    s.weapon = level <= 1 ? 'baton' : role === 'cop' ? 'pistol' : 'rifle';
    s.mode = 'police';
    s.maxHealth = s.health = UNIT_HEALTH[role];
    s.money = this.w.rng.int(20, 120);
    s.temper = 'fighter';
    ped.ambient = true;
    ped.police = { target, cooldown: this.w.rng.range(0.5, 1.5), leaving: false };
  }

  private spawnCop(p: Player, role: Exclude<PedRole, 'civ'>) {
    const w = this.w;
    const s = p.state;
    // a sidewalk node 50–90 m away (they come running from around the corner)
    const nodes = w.walk.filter((n) => {
      const d = Math.hypot(n.x - s.x, n.z - s.z);
      return d > 50 && d < 90;
    });
    if (nodes.length === 0) return;
    const n = nodes[w.rng.int(0, nodes.length - 1)];
    const ped = w.spawnPed(n.x, n.z, { mode: 'police' });
    this.makeUnit(ped, role, s.id, s.wanted);
  }

  private spawnCar(p: Player, type: 'police' | 'army') {
    const w = this.w;
    const s = p.state;
    const lanes = w.lanes.lanes.filter((l) => {
      const d = Math.hypot((l.ax + l.bx) / 2 - s.x, (l.az + l.bz) / 2 - s.z);
      return d > 70 && d < 140;
    });
    if (lanes.length === 0) return;
    const l = lanes[w.rng.int(0, lanes.length - 1)];
    const t = l.length * 0.5;
    const x = l.ax + l.dx * t;
    const z = l.az + l.dz * t;
    if ([...w.vehicles.values()].some((v) => Math.hypot(v.state.x - x, v.state.z - z) < 8)) return;
    const v = w.spawnVehicle(type, x, 0.3, z, Math.atan2(-l.dx, -l.dz), 'police', false);
    v.state.siren = true;
    v.police = { target: s.id, stuck: 0, reverse: 0, dropped: false, block: false };
  }

  private spawnHeli(p: Player, army: boolean) {
    const w = this.w;
    const s = p.state;
    const a = w.rng.range(0, Math.PI * 2);
    const id = w.newId();
    const h = new Heli({ id, x: s.x + Math.cos(a) * 140, y: 45, z: s.z + Math.sin(a) * 140, yaw: 0, health: army ? 320 : 220, down: -1, army, rotor: 0 });
    h.target = s.id;
    h.orbit = a;
    this.helis.set(id, h);
  }

  /** Two cars parked across the road ahead of the suspect, with officers behind. */
  private roadblock(p: Player) {
    const w = this.w;
    const s = p.state;
    const sp = Math.hypot(s.vx, s.vz);
    const dir = sp > 2 ? Math.atan2(-s.vx, -s.vz) : s.facing;
    const ax = s.x - Math.sin(dir) * 80;
    const az = s.z - Math.cos(dir) * 80;
    let best: { x: number; z: number; hw: number; hd: number } | null = null;
    let bd = 40;
    for (const n of w.lanes.nodes) {
      const d = Math.hypot(n.x - ax, n.z - az);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    if (!best) return;
    for (const k of [-1, 1]) {
      const x = best.x + k * 2.6;
      const z = best.z;
      if ([...w.vehicles.values()].some((v) => Math.hypot(v.state.x - x, v.state.z - z) < 4)) continue;
      const v = w.spawnVehicle(s.wanted >= 5 ? 'army' : 'police', x, 0.3, z, dir + Math.PI / 2, 'police', false);
      v.state.siren = true;
      v.police = { target: s.id, stuck: 0, reverse: 0, dropped: true, block: true };
      const ped = w.spawnPed(x - Math.sin(dir) * 3, z - Math.cos(dir) * 3, { mode: 'police' });
      this.makeUnit(ped, s.wanted >= 5 ? 'soldier' : 'swat', s.id, s.wanted);
    }
    w.toast(p, 'Barrage de police devant !');
  }

  // ------------------------------------------------------------------ AI

  private copAI(ped: Ped) {
    const w = this.w;
    const s = ped.state;
    const pol = ped.police!;
    if (pol.cooldown > 0) pol.cooldown -= DT;
    const t = pol.target ? w.players.get(pol.target) : undefined;
    if (!t || pol.leaving || t.state.dead || t.state.interior) {
      // walk away from the scene
      const away = t ? Math.atan2(s.x - t.state.x, s.z - t.state.z) : s.facing;
      w.moveWalker(ped, Math.sin(away) * 1.6, Math.cos(away) * 1.6);
      return;
    }
    const ts = t.state;
    const lvl = POLICE_LEVELS[Math.min(5, Math.max(1, ts.wanted))];
    const dx = ts.x - s.x;
    const dz = ts.z - s.z;
    const d = Math.hypot(dx, dz) || 0.01;
    if (!this.lineOfSight(s.id, s.x, s.z, ts.x, ts.z, d) || d > 40) {
      // no line of sight: run along the sidewalks around the blocks
      const n = this.walkStep(s.id, s.x, s.z, ts.x, ts.z);
      const nx = n.x - s.x;
      const nz = n.z - s.z;
      const nd = Math.hypot(nx, nz) || 0.01;
      s.facing = Math.atan2(-nx, -nz);
      this.run(ped, (nx / nd) * 5.4, (nz / nd) * 5.4);
      return;
    }
    s.facing = Math.atan2(-dx, -dz);
    const aggressive = lvl.shoot && this.aggressive(ts);
    if (s.weapon === 'baton' && aggressive) s.weapon = s.role === 'cop' ? 'pistol' : 'rifle';
    if (!aggressive) {
      // close in to grab the suspect (or to the door of their car)
      const stop = ts.vehicle >= 0 ? 2.2 : 1.0;
      const sp = d > stop ? Math.min(5.4, (d - stop) / DT) : 0;
      this.run(ped, (dx / d) * sp, (dz / d) * sp);
      if (d < 1.7 && pol.cooldown <= 0 && ts.speed > 2.6) {
        // baton swing at a suspect who keeps running
        s.actionSeq++;
        s.action = 'punch';
        pol.cooldown = 1.1;
        w.damagePlayer(t, 6);
        w.events.push({ type: 'punch', x: ts.x, y: ts.y + 1.3, z: ts.z });
      }
      return;
    }
    // armed: keep a firing distance, shoot when the line is clear
    const want = ts.vehicle >= 0 ? 12 : 10;
    const sp = d > want + 4 ? 5.2 : d < want - 3 ? -2.5 : 0;
    this.run(ped, (dx / d) * sp, (dz / d) * sp);
    if (pol.cooldown <= 0 && d < 45) {
      pol.cooldown = s.role === 'cop' ? w.rng.range(0.9, 1.5) : w.rng.range(0.35, 0.7);
      if (w.castStatic(s.x, s.y + 1.4, s.z, dx / d, (ts.y - s.y) / d, dz / d, d) < d - 0.6) return;
      this.shoot(s.x, s.y + 1.35, s.z, t, lvl.accuracy * Math.min(1, 10 / d), lvl.damage);
      s.actionSeq++;
      s.action = 'shoot';
    }
  }

  /** Moves an officer; if blocked (tree, bin, car…) sidestep for a moment. */
  private run(ped: Ped, vx: number, vz: number) {
    const s = ped.state;
    const r = this.route(s.id);
    if (r.side > 0) {
      r.side -= DT;
      // walk sideways (perpendicular), then resume
      this.w.moveWalker(ped, -vz * 0.8 + vx * 0.3, vx * 0.8 + vz * 0.3);
      return;
    }
    const x0 = s.x;
    const z0 = s.z;
    this.w.moveWalker(ped, vx, vz);
    const want = Math.hypot(vx, vz) * DT;
    const got = Math.hypot(s.x - x0, s.z - z0);
    r.stuck = want > 0.02 && got < want * 0.3 ? r.stuck + DT : Math.max(0, r.stuck - DT);
    if (r.stuck > 0.4) {
      r.stuck = 0;
      r.side = 0.7;
      r.repath = 0;
    }
  }

  /** A police shot at a player: hit roll, damage, tracer. */
  private shoot(fx: number, fy: number, fz: number, t: Player, chance: number, damage: number) {
    const w = this.w;
    const ts = t.state;
    const moving = Math.hypot(ts.vx, ts.vz) > 4 ? 0.65 : 1;
    const inCar = ts.vehicle >= 0 ? 0.75 : 1;
    const hit = w.rng.chance(chance * moving * inCar);
    const miss = hit ? 0 : 1.5;
    const tx = ts.x + w.rng.range(-miss, miss);
    const tz = ts.z + w.rng.range(-miss, miss);
    w.events.push({ type: 'shot', fx, fy, fz, tx, ty: ts.y + 1.1, tz, hit });
    if (!hit) return;
    if (ts.vehicle >= 0) {
      const v = w.vehicles.get(ts.vehicle);
      if (v) v.state.health -= damage * 0.8;
      if (w.rng.chance(0.35)) w.damagePlayer(t, damage * 0.6);
    } else w.damagePlayer(t, damage);
  }

  private carAI(v: Vehicle) {
    const w = this.w;
    const s = v.state;
    const pol = v.police!;
    const t = pol.target ? w.players.get(pol.target) : undefined;
    if (pol.block || !t || t.state.wanted === 0) {
      v.input = { throttle: 0, steer: 0, handbrake: true };
      return;
    }
    const ts = t.state;
    // aim a bit ahead of a moving target; follow the streets until it is in sight
    let tx = ts.x + ts.vx * 0.6;
    let tz = ts.z + ts.vz * 0.6;
    const direct = Math.hypot(tx - s.x, tz - s.z);
    if (direct > 35 || !this.lineOfSight(s.id, s.x, s.z, tx, tz, direct)) {
      const n = this.driveStep(s.id, s.x, s.z, tx, tz);
      tx = n.x;
      tz = n.z;
    }
    const d = Math.hypot(ts.x - s.x, ts.z - s.z);
    const desired = Math.atan2(-(tx - s.x), -(tz - s.z));
    const diff = angleDiff(s.yaw, desired);
    const calm = !this.aggressive(ts);
    const suspectStill = ts.vehicle < 0 || ts.speed < 2;
    if ((suspectStill && (d < (calm ? 18 : 16) || (d < 40 && Math.abs(s.speed) < 4 && pol.stuck > 0.5))) || (calm && ts.vehicle >= 0 && d < 9)) {
      // stop next to the suspect and let the officers out
      v.input = { throttle: s.speed > 1 ? -1 : 0, steer: 0, handbrake: s.speed < 2 };
      if (!pol.dropped && Math.abs(s.speed) < 3) {
        pol.dropped = true;
        const role = s.type === 'army' ? 'soldier' : ts.wanted >= 4 ? 'swat' : 'cop';
        for (const k of [-1, 1]) {
          const ped = w.spawnPed(s.x + Math.cos(s.yaw) * k * 2, s.z - Math.sin(s.yaw) * k * 2, { mode: 'police' });
          this.makeUnit(ped, role, ts.id, ts.wanted);
        }
      }
      return;
    }
    if (pol.reverse > 0) {
      pol.reverse -= DT;
      v.input = { throttle: -1, steer: diff > 0 ? 1 : -1, handbrake: false };
      return;
    }
    v.input = { throttle: Math.abs(diff) > 2.2 ? 0.5 : 1, steer: Math.max(-1, Math.min(1, -diff * 2.2)), handbrake: Math.abs(diff) > 1.2 && s.speed > 12 };
    // not allowed to ram below 4 stars: slow down when closing in, keep a distance
    if (calm && d < 40) {
      const limit = Math.max(ts.vehicle >= 0 ? Math.abs(ts.speed) * 0.9 : 0, (d - 12) * 1.1);
      if (s.speed > limit + 1) v.input.throttle = -1;
      else if (s.speed > limit) v.input.throttle = 0;
    }
    if (Math.abs(s.speed) < 1) {
      pol.stuck += DT;
      if (pol.stuck > 2.2 && !(ts.vehicle < 0 && d < 40)) {
        pol.stuck = 0;
        pol.reverse = 1.3;
      }
    } else pol.stuck = 0;
  }

  private heliAI(h: Heli) {
    const w = this.w;
    const s = h.state;
    h.savePrev();
    s.rotor += DT * (s.down < 0 ? 40 : 15);
    if (s.down >= 0) {
      // shot down: spin and fall, explode on the ground
      s.down += DT;
      h.vy -= 20 * DT;
      s.y += h.vy * DT;
      s.x += h.vx * DT;
      s.z += h.vz * DT;
      s.yaw += 4 * DT;
      const g = w.groundY(s.x, s.z);
      if (s.y <= g + 1 && h.vy < 0) {
        s.y = g + 1;
        h.vy = 0;
        h.vx *= 0.3;
        h.vz *= 0.3;
        if (s.down < 50) {
          w.blast(s.x, s.y, s.z, 9, 140);
          s.down = 50; // burning wreck
        }
      }
      return;
    }
    if (s.health <= 0) {
      s.down = 0;
      const by = h.lastHitBy ? w.players.get(h.lastHitBy) : undefined;
      if (by) w.progress.onHeliDown(by);
      return;
    }
    const t = h.target ? w.players.get(h.target) : undefined;
    let gx: number;
    let gz: number;
    if (t) {
      h.orbit += DT * 0.35;
      gx = t.state.x + Math.cos(h.orbit) * 28;
      gz = t.state.z + Math.sin(h.orbit) * 28;
    } else {
      // leaving
      gx = s.x + Math.sin(s.yaw) * 100;
      gz = s.z + Math.cos(s.yaw) * 100;
    }
    const dx = gx - s.x;
    const dz = gz - s.z;
    const d = Math.hypot(dx, dz) || 0.01;
    const sp = Math.min(24, d * 0.8);
    const k = 1 - Math.exp(-1.5 * DT);
    h.vx += ((dx / d) * sp - h.vx) * k;
    h.vz += ((dz / d) * sp - h.vz) * k;
    s.x += h.vx * DT;
    s.z += h.vz * DT;
    const alt = w.groundY(s.x, s.z) + 34;
    s.y += (alt - s.y) * (1 - Math.exp(-1 * DT));
    if (t) {
      const look = Math.atan2(-(t.state.x - s.x), -(t.state.z - s.z));
      s.yaw += angleDiff(s.yaw, look) * (1 - Math.exp(-2 * DT));
      // the gunner opens fire from 4 stars
      h.cooldown -= DT;
      if (t.state.wanted >= 4 && h.cooldown <= 0 && !t.state.interior) {
        h.cooldown = w.rng.range(0.6, 1.2);
        this.shoot(s.x, s.y - 1, s.z, t, 0.35, s.army ? 9 : 7);
      }
    }
  }
}
