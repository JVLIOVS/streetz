import { DT } from '../core/loop';
import { MISSIONS, missionById, REPLAY_FACTOR, type MissionDef, type MissionStep } from '../data/missions';
import { WEAPONS } from '../data/weapons';
import type { InteriorDef } from '../maps/types';
import type { Ped } from './peds';
import type { ContextAction, Player } from './player';
import type { SimWorld } from './world';

/** Where a mission is picked up (snapped onto the sidewalk graph). */
export interface MissionGiver {
  id: string;
  x: number;
  z: number;
}

/** Runtime data of a mission in progress (authority only). */
interface Run {
  def: MissionDef;
  step: number;
  /** Has the current step spawned its entities yet? */
  ready: boolean;
  timer: number;
  peds: number[];
  vehicle: number;
  witness: number;
  /** Escort: distance at the start (ambush halfway), ambush done. */
  dist0: number;
  ambushed: boolean;
  warned: boolean;
}

const GIVER_RADIUS = 2.6;

/**
 * Runs story missions for every player. Mission entities are regular world entities
 * (non-ambient so they don't despawn): anybody can fight the thugs, kill the witness
 * or wreck the target car, which is how players help or sabotage each other.
 */
export class MissionSystem {
  readonly givers: MissionGiver[];
  private runs = new Map<string, Run>();

  constructor(private w: SimWorld) {
    this.givers = MISSIONS.map((m) => {
      const n = w.walk[w.nearestWalkNode(m.x, m.z)];
      return { id: m.id, x: n.x, z: n.z };
    });
  }

  unlocked(p: Player, def: MissionDef) {
    return !def.requires || p.state.missionsDone.includes(def.requires);
  }

  /** "Mission" button when standing on a mission start marker. */
  context(p: Player): ContextAction | null {
    const s = p.state;
    if (s.mission) return null;
    for (const g of this.givers) {
      if (Math.hypot(g.x - s.x, g.z - s.z) > GIVER_RADIUS) continue;
      const def = missionById(g.id)!;
      return { kind: 'mission', label: this.unlocked(p, def) ? `Mission · ${def.name}` : '🔒 Mission', target: def.id };
    }
    return null;
  }

  start(p: Player, id: string) {
    const def = missionById(id);
    const s = p.state;
    if (!def || s.mission || s.dead) return;
    const g = this.givers.find((q) => q.id === id)!;
    if (Math.hypot(g.x - s.x, g.z - s.z) > GIVER_RADIUS + 3) return;
    if (!this.unlocked(p, def)) {
      this.w.toast(p, `🔒 Termine d’abord « ${missionById(def.requires!)!.name} »`);
      return;
    }
    s.mission = def.id;
    this.runs.set(s.id, { def, step: -1, ready: false, timer: -1, peds: [], vehicle: -1, witness: -1, dist0: 0, ambushed: false, warned: false });
    this.w.toast(p, `${def.giver} : « ${def.pitch} »`);
    this.w.events.push({ type: 'mission', playerId: s.id, name: def.name, state: 'start' });
    this.next(p);
  }

  abort(p: Player, reason = 'Mission abandonnée') {
    const s = p.state;
    const run = this.runs.get(s.id);
    if (!run) return;
    this.cleanup(run);
    this.runs.delete(s.id);
    this.reset(p);
    this.w.toast(p, `✖ ${reason}`);
    this.w.events.push({ type: 'mission', playerId: s.id, name: run.def.name, state: 'fail' });
  }

  /** Player left the game. */
  drop(id: string) {
    const run = this.runs.get(id);
    if (run) this.cleanup(run);
    this.runs.delete(id);
  }

  /** Called by the world when a robbery is completed. */
  onRobbery(p: Player, interior: string) {
    const run = this.runs.get(p.state.id);
    const step = run?.def.steps[run.step];
    if (step?.kind === 'rob' && this.door(step.interior)?.id === interior) this.next(p);
  }

  update() {
    for (const [id, run] of [...this.runs]) {
      const p = this.w.players.get(id);
      if (!p) {
        this.drop(id);
        continue;
      }
      if (p.state.dead) {
        this.abort(p, 'Mission échouée : tu es K.O.');
        continue;
      }
      this.updateStep(p, run);
    }
  }

  // ------------------------------------------------------------------ steps

  private next(p: Player) {
    const run = this.runs.get(p.state.id)!;
    run.step++;
    run.ready = false;
    run.timer = -1;
    const s = p.state;
    if (run.step >= run.def.steps.length) {
      this.complete(p, run);
      return;
    }
    s.missionStep = run.step;
    s.objective = run.def.steps[run.step].text;
    s.missionTimer = -1;
    s.missionTargets = [];
    s.waypoint = null;
  }

  private complete(p: Player, run: Run) {
    const s = p.state;
    const replay = s.missionsDone.includes(run.def.id);
    const money = Math.round(run.def.reward * (replay ? REPLAY_FACTOR : 1));
    const rep = Math.round(run.def.rep * (replay ? REPLAY_FACTOR : 1));
    s.money += money;
    s.rep += rep;
    if (!replay) s.missionsDone.push(run.def.id);
    this.cleanup(run);
    this.runs.delete(s.id);
    this.reset(p);
    this.w.events.push({ type: 'money', playerId: s.id, amount: money });
    this.w.events.push({ type: 'mission', playerId: s.id, name: run.def.name, state: 'done' });
    const nextDef = MISSIONS.find((m) => m.requires === run.def.id);
    this.w.toast(p, `✔ MISSION RÉUSSIE · +${money.toLocaleString('fr-FR')} € · +${rep} rep${nextDef && !replay ? ` — nouvelle mission : ${nextDef.name}` : ''}`);
  }

  private reset(p: Player) {
    const s = p.state;
    s.mission = null;
    s.missionStep = 0;
    s.objective = '';
    s.missionTimer = -1;
    s.waypoint = null;
    s.missionTargets = [];
  }

  /** Mission entities go back to the ambient world (despawned later by the population manager). */
  private cleanup(run: Run) {
    for (const id of run.peds) this.release(this.w.peds.get(id));
    this.release(this.w.peds.get(run.witness));
    const v = this.w.vehicles.get(run.vehicle);
    if (v) {
      v.ambient = true;
      v.rush = 1;
    }
    run.peds = [];
    run.witness = -1;
    run.vehicle = -1;
  }

  private release(ped: Ped | undefined) {
    if (!ped) return;
    ped.ambient = true;
    if (ped.alive && ped.state.mode === 'follow') {
      ped.state.mode = 'walk';
      ped.to = ped.from = this.w.nearestWalkNode(ped.state.x, ped.state.z);
    }
  }

  private door(idOrKind: string): InteriorDef | undefined {
    return this.w.map.interiors.find((i) => i.id === idOrKind) ?? this.w.map.interiors.find((i) => i.kind === idOrKind);
  }

  /** Countdown shared by goto / door steps. Returns false when time is up. */
  private tickTimer(p: Player, run: Run, time?: number) {
    if (!time) return true;
    if (run.timer < 0) run.timer = time;
    run.timer -= DT;
    p.state.missionTimer = Math.max(0, run.timer);
    if (run.timer <= 0) {
      this.abort(p, 'Mission échouée : trop tard !');
      return false;
    }
    return true;
  }

  private updateStep(p: Player, run: Run) {
    const s = p.state;
    const step: MissionStep = run.def.steps[run.step];
    switch (step.kind) {
      case 'goto': {
        s.waypoint = [step.x, step.z];
        if (!this.tickTimer(p, run, step.time)) return;
        if (!s.interior && Math.hypot(step.x - s.x, step.z - s.z) < (step.r ?? 6)) this.next(p);
        break;
      }
      case 'door': {
        const d = this.door(step.interior);
        if (!d) return this.next(p);
        s.waypoint = [d.door.x, d.door.z];
        if (!this.tickTimer(p, run, step.time)) return;
        if (s.interior === d.id || (!s.interior && Math.hypot(d.door.x - s.x, d.door.z - s.z) < 5)) this.next(p);
        break;
      }
      case 'kill': {
        if (!run.ready) {
          run.ready = true;
          for (let i = 0; i < step.count; i++) {
            const a = (i / step.count) * Math.PI * 2;
            const ped = this.w.spawnPed(step.x + Math.cos(a) * 3, step.z + Math.sin(a) * 3, { ambient: false, facing: a });
            const boss = i === 0 && !!step.boss;
            ped.state.temper = 'fighter';
            ped.state.maxHealth = ped.state.health = boss ? 260 : 150;
            ped.state.money = boss ? 400 : this.w.rng.int(40, 160);
            if (boss) ped.state.weapon = 'baton';
            run.peds.push(ped.state.id);
          }
        }
        this.engage(p, run.peds, 22);
        const alive = run.peds.map((id) => this.w.peds.get(id)).filter((q) => q?.alive) as Ped[];
        s.missionTargets = alive.map((q) => q.state.id);
        if (alive.length === 0) return this.next(p);
        s.waypoint = [alive[0].state.x, alive[0].state.z];
        break;
      }
      case 'escort':
        this.escort(p, run, step);
        break;
      case 'destroy':
        this.destroy(p, run, step);
        break;
      case 'armed': {
        const gun = this.door('gunshop');
        s.waypoint = gun ? [gun.door.x, gun.door.z] : null;
        if (s.weapons.some((w) => !WEAPONS[w].melee && s.ammo[w] > 0)) this.next(p);
        break;
      }
      case 'rob': {
        const d = this.door(step.interior);
        s.waypoint = d ? [d.door.x, d.door.z] : null;
        break;
      }
      case 'lose':
        s.waypoint = null;
        if (s.wanted === 0) this.next(p);
        break;
    }
  }

  /** Mission thugs attack the player once they're close. */
  private engage(p: Player, ids: number[], radius: number) {
    const s = p.state;
    for (const id of ids) {
      const ped = this.w.peds.get(id);
      if (!ped?.alive || ped.state.mode === 'fight' || ped.state.mode === 'stun') continue;
      if (s.vehicle < 0 && !s.interior && Math.hypot(ped.state.x - s.x, ped.state.z - s.z) < radius) {
        ped.state.mode = 'fight';
        ped.state.target = s.id;
      }
    }
  }

  private escort(p: Player, run: Run, step: Extract<MissionStep, { kind: 'escort' }>) {
    const s = p.state;
    if (!run.ready) {
      run.ready = true;
      const fx = -Math.sin(s.facing);
      const fz = -Math.cos(s.facing);
      const ped = this.w.spawnPed(s.x - fx * 1.5, s.z - fz * 1.5, { ambient: false, mode: 'follow' });
      ped.state.temper = 'coward';
      ped.state.money = 0;
      run.witness = ped.state.id;
      run.dist0 = Math.hypot(step.x - ped.state.x, step.z - ped.state.z);
    }
    const ped = this.w.peds.get(run.witness);
    if (!ped || !ped.alive) return this.abort(p, 'Mission échouée : le témoin est mort');
    const ws = ped.state;
    s.missionTargets = [ws.id];
    const d = Math.hypot(ws.x - s.x, ws.z - s.z);
    if (d > 70) return this.abort(p, 'Mission échouée : tu as perdu le témoin');
    const toDest = Math.hypot(step.x - ws.x, step.z - ws.z);
    if (toDest < 4) {
      this.w.removePed(ws.id);
      run.witness = -1;
      return this.next(p);
    }
    // thugs show up halfway, between the witness and the destination
    if (!run.ambushed && toDest < run.dist0 * 0.6) {
      run.ambushed = true;
      const ax = ws.x + ((step.x - ws.x) / toDest) * 22;
      const az = ws.z + ((step.z - ws.z) / toDest) * 22;
      for (let i = 0; i < step.ambush; i++) {
        const n = this.w.walk[this.w.nearestWalkNode(ax + (i - 1) * 3, az + (i % 2) * 3)];
        const t = this.w.spawnPed(n.x + i * 0.8, n.z, { ambient: false });
        t.state.temper = 'fighter';
        t.state.maxHealth = t.state.health = 140;
        run.peds.push(t.state.id);
      }
      this.w.toast(p, 'Embuscade ! Protège le témoin');
    }
    const thugs = run.peds.map((id) => this.w.peds.get(id)).filter((q) => q?.alive) as Ped[];
    this.engage(p, run.peds, 30);
    s.missionTargets = [ws.id, ...thugs.map((q) => q.state.id)];
    // thugs passing next to the witness rough them up
    let danger = false;
    for (const t of thugs) {
      const dt = Math.hypot(t.state.x - ws.x, t.state.z - ws.z);
      if (dt < 15) danger = true;
      if (dt < 1.6 && this.w.tick % 50 === 0) this.w.damagePed(ped, 9, null, t.state.x, t.state.z);
    }
    if (!ped.alive) return;
    if (danger) {
      ws.mode = 'cower';
      ped.timer = 1;
    } else if (ws.mode === 'cower' || ws.mode === 'walk' || ws.mode === 'flee') ws.mode = 'follow';
    ped.chase.x = s.vehicle >= 0 ? ws.x : s.x;
    ped.chase.z = s.vehicle >= 0 ? ws.z : s.z;
    ped.chase.stop = 2;
    if (s.vehicle >= 0 && !run.warned) {
      run.warned = true;
      this.w.toast(p, 'Le témoin refuse de monter : à pied !');
    }
    s.objective = d > 25 ? 'Attends le témoin, il est à la traîne !' : step.text;
    s.waypoint = [step.x, step.z];
  }

  private destroy(p: Player, run: Run, step: Extract<MissionStep, { kind: 'destroy' }>) {
    const s = p.state;
    if (!run.ready) {
      run.ready = true;
      // a lane 50–110 m away, preferably not on the ring road
      const lanes = this.w.lanes.lanes.filter((l) => {
        const d = Math.hypot((l.ax + l.bx) / 2 - s.x, (l.az + l.bz) / 2 - s.z);
        return d > 50 && d < 110 && l.speed < 20 && l.length > 20;
      });
      const lane = lanes.length ? lanes[this.w.rng.int(0, lanes.length - 1)] : this.w.lanes.lanes[0];
      const t = lane.length * 0.4;
      const v = this.w.spawnVehicle(step.vehicle, lane.ax + lane.dx * t, 0.3, lane.az + lane.dz * t, Math.atan2(-lane.dx, -lane.dz), 'npc', false);
      v.lane = lane.id;
      v.rush = 1.7;
      v.state.paint = 0;
      run.vehicle = v.state.id;
    }
    const v = this.w.vehicles.get(run.vehicle);
    if (!v || v.state.wrecked || v.state.health <= 0) return this.next(p);
    // badly damaged: the thief bails out and runs
    if (v.state.driver === 'npc' && v.state.health < v.spec.health * 0.35) {
      v.state.driver = 'none';
      v.lane = -1;
      const rx = Math.cos(v.state.yaw);
      const rz = -Math.sin(v.state.yaw);
      const ped = this.w.spawnPed(v.state.x - rx * (v.spec.width / 2 + 0.9), v.state.z - rz * (v.spec.width / 2 + 0.9));
      ped.to = ped.from = this.w.nearestWalkNode(ped.state.x, ped.state.z);
      ped.scare(s.x, s.z, false);
      this.w.toast(p, 'Le voleur s’enfuit à pied : achève la voiture !');
    }
    s.missionTargets = [v.state.id];
    s.waypoint = [v.state.x, v.state.z];
  }
}
