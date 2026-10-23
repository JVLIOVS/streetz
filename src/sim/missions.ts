import { DT } from '../core/loop';
import { MISSIONS, missionById, REPLAY_FACTOR, type MissionDef, type MissionStep, type MissionStepFull } from '../data/missions';
import { RESPECT } from '../data/law';
import { DON, RANKS, rankOf } from '../data/family';
import { levelOf } from '../data/progression';
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
  /** Partner bot (ped id, -1 while riding in your car), props broken this step. */
  ally: number;
  broken: number;
  allyCooldown: number;
  /** Where the carried item fell. */
  dropped: { x: number; z: number } | null;
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
    this.givers = MISSIONS.filter((m) => !m.auto).map((m) => {
      const n = w.walk[w.nearestWalkNode(m.x, m.z)];
      return { id: m.id, x: n.x, z: n.z };
    });
  }

  unlocked(p: Player, def: MissionDef) {
    return (!def.requires || p.state.missionsDone.includes(def.requires)) && levelOf(p.state.rep) >= (def.level ?? 1);
  }

  /** Rank in the Family (from the missions you finished). */
  rank(p: Player) {
    return rankOf(p.state.missionsDone, p.state.tutorialDone);
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
    const g = this.givers.find((q) => q.id === id);
    if (!def.auto && (!g || Math.hypot(g.x - s.x, g.z - s.z) > GIVER_RADIUS + 3)) return;
    if (!this.unlocked(p, def)) {
      const before = def.requires && !s.missionsDone.includes(def.requires);
      this.w.toast(p, before ? `🔒 Termine d’abord « ${missionById(def.requires!)!.name} »` : `🔒 Niveau ${def.level} requis`);
      return;
    }
    s.mission = def.id;
    const run: Run = { def, step: -1, ready: false, timer: -1, peds: [], vehicle: -1, witness: -1, dist0: 0, ambushed: false, warned: false, ally: -1, broken: 0, allyCooldown: 0, dropped: null };
    this.runs.set(s.id, run);
    if (def.partner) {
      this.spawnAlly(p, run);
      this.say(p, def.pitch);
    } else this.w.toast(p, `${def.giver} : « ${def.pitch} »`);
    this.w.events.push({ type: 'mission', playerId: s.id, name: def.name, state: 'start' });
    this.next(p);
  }

  /** `reason` set = failure (K.O., arrested, too late); none = the player gave up. */
  abort(p: Player, reason?: string) {
    const s = p.state;
    const run = this.runs.get(s.id);
    if (!run) return;
    // the prologue never fails: you get back up and carry on
    if (run.def.auto && reason) {
      if (s.dead || s.arrest > 0 || reason.includes('arrêté')) this.say(p, 'Pas grave, relève-toi. On reprend où on en était.');
      return;
    }
    reason ??= 'Mission abandonnée';
    if (run.def.auto) {
      // skipping the tutorial is fine, it never comes back
      s.tutorialDone = true;
      reason = 'Tutoriel passé';
    }
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

  /** Called by the world when a player knocks someone out. */
  onKo(p: Player) {
    const run = this.runs.get(p.state.id);
    const step = run?.def.steps[run.step];
    if (step?.kind === 'ko') this.next(p);
  }

  /** Knocked out: a carried mission item falls on the ground. */
  onDeath(p: Player) {
    const s = p.state;
    const run = this.runs.get(s.id);
    if (!run || !s.carrying) return;
    run.dropped = { x: s.x, z: s.z };
    this.w.toast(p, `📦 Tu as lâché ${s.carrying} ! Retourne le chercher`);
    s.carrying = null;
  }

  /** Called by the world when a player breaks a street prop. */
  onProp(p: Player) {
    const run = this.runs.get(p.state.id);
    const step = run?.def.steps[run.step];
    if (step?.kind !== 'break') return;
    run!.broken++;
    p.state.objective = `${step.text} (${Math.min(run!.broken, step.count)}/${step.count})`;
    if (run!.broken >= step.count) this.next(p);
  }

  /** Called by the world when a robbery is completed. */
  onRobbery(p: Player, interior: string) {
    const run = this.runs.get(p.state.id);
    const step = run?.def.steps[run.step];
    if (step?.kind !== 'rob') return;
    const d = this.w.map.interiors.find((i) => i.id === interior);
    if (d && (d.id === step.interior || d.kind === step.interior)) this.next(p);
  }

  /** Called by the world when a player parks a car in their garage. */
  onStore(p: Player) {
    const run = this.runs.get(p.state.id);
    if (run?.def.steps[run.step]?.kind === 'store') this.next(p);
  }

  update() {
    // new players: the tutorial starts by itself
    if (this.w.tick % 60 === 0) {
      for (const p of this.w.players.values()) {
        const s = p.state;
        if (!s.tutorialDone && !s.mission && !s.dead && !s.interior) this.start(p, 'tuto');
      }
    }
    for (const [id, run] of [...this.runs]) {
      const p = this.w.players.get(id);
      if (!p) {
        this.drop(id);
        continue;
      }
      if (p.state.dead) {
        // the prologue and carry steps go on after the respawn
        if (run.def.auto || run.def.steps[run.step]?.carry) continue;
        this.abort(p, 'Mission échouée : tu es K.O.');
        continue;
      }
      if (run.def.partner) this.updateAlly(p, run);
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
    const step = run.def.steps[run.step];
    s.objective = step.text;
    s.missionTimer = -1;
    s.missionTargets = [];
    s.waypoint = null;
    run.broken = 0;
    run.dropped = null;
    s.carrying = step.carry ?? null;
    if (step.give) {
      const w = step.give.weapon;
      if (!s.weapons.includes(w)) s.weapons.push(w);
      s.ammo[w] += step.give.ammo;
    }
    if (step.say) this.say(p, step.say);
  }

  /** The partner talks (subtitle + voice on the player's phone). */
  private say(p: Player, text: string) {
    const run = this.runs.get(p.state.id);
    this.w.events.push({ type: 'say', playerId: p.state.id, name: run?.def.partner ?? run?.def.giver ?? '', text, seed: 777 });
  }

  private spawnAlly(p: Player, run: Run) {
    const s = p.state;
    const fx = -Math.sin(s.facing);
    const fz = -Math.cos(s.facing);
    const ped = this.w.spawnPed(s.x - fz * 1.6 - fx, s.z + fx * 1.6 - fz, { ambient: false, mode: 'follow', facing: s.facing });
    ped.invulnerable = true;
    ped.state.look = 777;
    ped.state.temper = 'fighter';
    ped.state.money = 0;
    ped.state.weapon = 'pistol';
    run.ally = ped.state.id;
  }

  /**
   * The partner follows you on foot, rides along in your car (hidden), walks into
   * buildings with you and shoots at the cops chasing you.
   */
  private updateAlly(p: Player, run: Run) {
    const s = p.state;
    let ally = this.w.peds.get(run.ally);
    if (s.vehicle >= 0) {
      // in the car with you
      if (ally) {
        this.w.removePed(ally.state.id);
        run.ally = -1;
      }
      return;
    }
    if (!ally) {
      this.spawnAlly(p, run);
      ally = this.w.peds.get(run.ally)!;
    }
    const a = ally.state;
    const d = Math.hypot(a.x - s.x, a.z - s.z);
    if (d > 25 || (s.interior && d > 12)) {
      // catch up (doors, respawn…)
      a.x = s.x + 1.5;
      a.z = s.z + 1;
      ally.savePrev();
    }
    a.mode = 'follow';
    ally.chase.x = s.x;
    ally.chase.z = s.z;
    ally.chase.stop = 2.4;
    s.ally = a.id;
    // cover fire
    run.allyCooldown -= DT;
    if (s.wanted > 0 && run.allyCooldown <= 0) {
      let best: Ped | null = null;
      let bd = 24;
      for (const c of this.w.peds.values()) {
        if (c.state.role === 'civ' || !c.alive) continue;
        const dc = Math.hypot(c.state.x - a.x, c.state.z - a.z);
        if (dc < bd) {
          bd = dc;
          best = c;
        }
      }
      if (best) {
        run.allyCooldown = 0.9;
        a.facing = Math.atan2(-(best.state.x - a.x), -(best.state.z - a.z));
        a.action = 'shoot';
        a.actionSeq++;
        this.w.events.push({ type: 'shot', fx: a.x, fy: a.y + 1.4, fz: a.z, tx: best.state.x, ty: best.state.y + 1.1, tz: best.state.z, hit: true, w: 'pistol' });
        this.w.damagePed(best, 34, null, a.x, a.z);
      }
    }
  }

  private complete(p: Player, run: Run) {
    const s = p.state;
    const replay = s.missionsDone.includes(run.def.id);
    const rankBefore = this.rank(p);
    const money = Math.round(run.def.reward * (replay ? REPLAY_FACTOR : 1) * RANKS[rankBefore].pay);
    const rep = Math.round(run.def.rep * (replay ? REPLAY_FACTOR : 1));
    s.money += money;
    this.w.progress.addXp(p, rep);
    this.w.law.respect(p, RESPECT.mission);
    this.w.contracts.track(p, 'mission', 1);
    if (!replay) s.missionsDone.push(run.def.id);
    if (run.def.auto) s.tutorialDone = true;
    this.cleanup(run);
    this.runs.delete(s.id);
    this.reset(p);
    this.w.events.push({ type: 'money', playerId: s.id, amount: money });
    this.w.events.push({ type: 'mission', playerId: s.id, name: run.def.name, state: 'done' });
    if (run.def.auto) {
      this.w.events.push({ type: 'say', playerId: s.id, name: run.def.partner ?? run.def.giver, text: run.def.outro ?? '', seed: 777 });
      this.w.events.push({ type: 'freeRoam', playerId: s.id });
      return;
    }
    const nextDef = MISSIONS.find((m) => m.requires === run.def.id);
    this.w.toast(p, `✔ MISSION RÉUSSIE · +${money.toLocaleString('fr-FR')} € · +${rep} rep${nextDef && !replay ? ` — nouvelle mission : ${nextDef.name}${nextDef.level && levelOf(s.rep) < nextDef.level ? ` (niveau ${nextDef.level})` : ''}` : ''}`);
    const rankAfter = this.rank(p);
    if (rankAfter > rankBefore) this.promote(p, rankAfter);
  }

  /** Climbed a rank in the Family: bonus cash, a word from the Don, new perks. */
  private promote(p: Player, rank: number) {
    const s = p.state;
    const r = RANKS[rank];
    s.money += r.bonus;
    this.w.law.respect(p, 20 * rank);
    this.w.events.push({ type: 'promoted', playerId: s.id, rank, name: r.name, perk: r.perk, bonus: r.bonus });
    this.w.events.push({ type: 'say', playerId: s.id, name: DON, text: PROMOTION_LINES[rank] ?? `Tu es ${r.name} maintenant.`, seed: 4242 });
  }

  private reset(p: Player) {
    const s = p.state;
    s.mission = null;
    s.missionStep = 0;
    s.objective = '';
    s.missionTimer = -1;
    s.waypoint = null;
    s.missionTargets = [];
    s.ally = -1;
    s.carrying = null;
  }

  /** Mission entities go back to the ambient world (despawned later by the population manager). */
  private cleanup(run: Run) {
    for (const id of run.peds) this.release(this.w.peds.get(id));
    this.release(this.w.peds.get(run.witness));
    if (run.ally >= 0) this.w.removePed(run.ally);
    run.ally = -1;
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

  /** A building by id, or the closest one of that kind to (x, z). */
  private door(idOrKind: string, x = 0, z = 0): InteriorDef | undefined {
    const byId = this.w.map.interiors.find((i) => i.id === idOrKind);
    if (byId) return byId;
    let best: InteriorDef | undefined;
    let bd = Infinity;
    for (const i of this.w.map.interiors) {
      if (i.kind !== idOrKind) continue;
      const d = Math.hypot(i.door.x - x, i.door.z - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
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
    const step: MissionStepFull = run.def.steps[run.step];
    // the item you carry fell: go and pick it up first
    if (step.carry && run.dropped) {
      if (!this.tickTimer(p, run, (step as { time?: number }).time)) return;
      s.waypoint = [run.dropped.x, run.dropped.z];
      s.objective = `Récupère ${step.carry} là où tu es tombé`;
      if (!s.interior && Math.hypot(run.dropped.x - s.x, run.dropped.z - s.z) < 2.5) {
        run.dropped = null;
        s.carrying = step.carry;
        s.objective = step.text;
        this.w.toast(p, `📦 Tu as repris ${step.carry}`);
      }
      return;
    }
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
          // on the sidewalk closest to the spot, never inside a building
          const c = this.w.walk[this.w.nearestWalkNode(step.x, step.z)];
          for (let i = 0; i < step.count; i++) {
            const a = (i / step.count) * Math.PI * 2;
            const ped = this.w.spawnPed(c.x + Math.cos(a) * 3, c.z + Math.sin(a) * 3, { ambient: false, facing: a });
            const boss = i === 0 && !!step.boss;
            ped.state.temper = 'fighter';
            ped.state.maxHealth = ped.state.health = boss ? 260 + 20 * step.count : 150;
            ped.state.money = boss ? 400 + 100 * step.count : this.w.rng.int(40, 160);
            if (boss) ped.state.weapon = step.armed ? 'pistol' : 'baton';
            else if (step.armed && i % 2 === 1) ped.state.weapon = 'pistol';
            run.peds.push(ped.state.id);
          }
        }
        this.engage(p, run.peds, 22);
        const alive = run.peds.map((id) => this.w.peds.get(id)).filter((q) => q?.alive) as Ped[];
        s.missionTargets = alive.map((q) => q.state.id);
        if (alive.length === 0) return this.next(p);
        s.waypoint = [alive[0].state.x, alive[0].state.z];
        if (step.count > 1) s.objective = `${step.text} (${alive.length} restant${alive.length > 1 ? 's' : ''})`;
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
        const d = this.door(step.interior, s.x, s.z);
        s.waypoint = d ? [d.door.x, d.door.z] : null;
        // you need a weapon out to rob: hand it over if it's in the pocket
        if (run.def.auto && s.interior === d?.id && s.weapon === 'fist') {
          const gun = s.weapons.find((w) => !WEAPONS[w].melee && s.ammo[w] > 0);
          if (gun) s.weapon = gun;
          else {
            if (!s.weapons.includes('pistol')) s.weapons.push('pistol');
            s.ammo.pistol += 24;
            s.weapon = 'pistol';
          }
        }
        break;
      }
      case 'lose':
        s.waypoint = null;
        if (s.wanted === 0) this.next(p);
        break;
      case 'wanted':
        s.waypoint = null;
        if (s.wanted >= step.stars) this.next(p);
        break;
      case 'ko': {
        // point at the closest passer-by
        let best: Ped | null = null;
        let bd = 40;
        for (const ped of this.w.peds.values()) {
          if (!ped.alive || ped.state.role !== 'civ' || ped.state.mode === 'shopkeeper') continue;
          const d = Math.hypot(ped.state.x - s.x, ped.state.z - s.z);
          if (d < bd) {
            bd = d;
            best = ped;
          }
        }
        s.missionTargets = best ? [best.state.id] : [];
        s.waypoint = null;
        break;
      }
      case 'equip':
        s.waypoint = null;
        if (s.weapon === step.weapon) this.next(p);
        break;
      case 'break':
        s.waypoint = null;
        break;
      case 'drive': {
        if (s.vehicle >= 0) return this.next(p);
        let best: number | null = null;
        let bd = 80;
        for (const v of this.w.vehicles.values()) {
          if (v.state.wrecked || v.police || (v.state.driver !== 'none' && v.state.driver !== 'npc')) continue;
          const d = Math.hypot(v.state.x - s.x, v.state.z - s.z);
          if (d < bd) {
            bd = d;
            best = v.state.id;
          }
        }
        s.missionTargets = best !== null ? [best] : [];
        s.waypoint = null;
        break;
      }
      case 'store': {
        const d = this.door('hideout');
        s.waypoint = d ? [d.door.x, d.door.z] : null;
        s.objective = s.vehicle >= 0 ? step.text : 'Reprends une voiture et fonce à ta planque';
        break;
      }
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

/** What the Don says when you climb a rank. */
const PROMOTION_LINES: Record<number, string> = {
  2: 'On m’a parlé de toi. Bienvenue dans la Famille, petite main. Ne me déçois pas.',
  3: 'Tu sais te servir de tes mains et tu ne parles pas. Tu es un Soldat de la Famille, maintenant. Tu toucheras ta part.',
  4: 'Lieutenant. Un de mes hommes te suivra partout. Il donne sa vie pour toi, toi tu la donnes pour moi.',
  5: 'Capo ! Tu as ton équipe et notre avocat est à ton service. La rue commence à murmurer ton nom.',
  6: 'Mon bras droit. Il n’y a plus que moi au-dessus de toi. Une dernière chose à régler…',
  7: 'Je te passe la couronne. Tu es le Parrain. Embrasse ma main une dernière fois, puis la ville est à toi.',
};
