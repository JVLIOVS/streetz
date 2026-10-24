import { DT } from '../core/loop';
import { OP_COOLDOWN, OP_CREW_BONUS, OP_INVITE, OP_LEVEL, OP_TIME, OPS, opByKind, type OpDef } from '../data/ops';
import { levelOf } from '../data/progression';
import type { Ped } from './peds';
import type { Player } from './player';
import type { SimWorld } from './world';

interface Op {
  id: number;
  def: OpDef;
  leader: string;
  /** Crew id/name for a crew job, null when open to everybody. */
  crew: string | null;
  members: Set<string>;
  timer: number;
  x: number;
  z: number;
  peds: number[];
  /** Main target: the boss / the VIP. */
  boss: number;
  vehicle: number;
  robbed: number;
}

const crewKey = (p: Player) => p.state.crew?.id ?? p.state.crew?.name ?? null;

/**
 * Crew jobs and open jobs: any player launches one; for a crew job every crew member
 * in the game joins at once, an open job is offered to everybody (a "Rejoindre" button).
 * Members share the objective (same targets, same waypoint) and each one is paid.
 */
export class OpsSystem {
  private ops = new Map<number, Op>();
  private nextId = 1;
  private cooldown = new Map<string, number>();

  constructor(private w: SimWorld) {}

  /** Jobs going on (for the launch menu and invitations). */
  list() {
    return [...this.ops.values()].map((o) => ({ id: o.id, name: o.def.name, icon: o.def.icon, open: !o.crew, members: o.members.size, leader: o.leader }));
  }

  memberOf(p: Player): Op | undefined {
    for (const o of this.ops.values()) if (o.members.has(p.state.id)) return o;
    return undefined;
  }

  /** `start:<kind>:<crew|open>`, `join:<id>`, `leave`. */
  command(p: Player, arg: string) {
    const [op, a, b] = arg.split(':');
    if (op === 'start') this.start(p, a, b === 'crew');
    else if (op === 'join') this.join(p, Number(a));
    else if (op === 'leave') this.leave(p);
  }

  private canJoin(p: Player) {
    const s = p.state;
    return !s.dead && !s.mission && !this.memberOf(p);
  }

  start(p: Player, kind: string, crew: boolean) {
    const w = this.w;
    const s = p.state;
    const def = opByKind(kind);
    if (!def) return;
    if (levelOf(s.rep) < OP_LEVEL) return w.toast(p, `🔒 Lancer une mission : niveau ${OP_LEVEL}`);
    if (!this.canJoin(p)) return w.toast(p, 'Termine d’abord ta mission en cours');
    if (crew && !s.crew) return w.toast(p, 'Il te faut un crew (menu pause) pour une mission de crew');
    const wait = Math.ceil(((this.cooldown.get(s.id) ?? 0) - w.tick) / 60);
    if (wait > 0) return w.toast(p, `Prochaine mission dans ${wait} s`);
    this.cooldown.set(s.id, w.tick + OP_COOLDOWN * 60);
    // a spot 70–150 m away, on a sidewalk, outdoors
    const ox = s.interior ? (w.map.interiors.find((i) => i.id === s.interior)?.door.x ?? s.x) : s.x;
    const oz = s.interior ? (w.map.interiors.find((i) => i.id === s.interior)?.door.z ?? s.z) : s.z;
    const ring = w.walk.filter((n) => {
      const d = Math.hypot(n.x - ox, n.z - oz);
      return d > 70 && d < 150 && n.links.length > 0;
    });
    const spot = ring.length ? ring[w.rng.int(0, ring.length - 1)] : w.walk[w.nearestWalkNode(ox, oz)];
    const o: Op = { id: this.nextId++, def, leader: s.id, crew: crew ? crewKey(p) : null, members: new Set(), timer: OP_TIME, x: spot.x, z: spot.z, peds: [], boss: -1, vehicle: -1, robbed: 0 };
    this.ops.set(o.id, o);
    this.setup(o);
    this.add(o, p);
    for (const other of w.players.values()) {
      if (other === p) continue;
      if (o.crew && crewKey(other) === o.crew && this.canJoin(other)) {
        this.add(o, other);
        w.toast(other, `📣 ${s.name} lance une mission de crew : ${def.icon} ${def.name} !`);
      } else if (!o.crew) {
        other.state.opInvite = { id: o.id, text: `📣 ${s.name} lance ${def.icon} ${def.name} · mission ouverte`, until: w.tick + OP_INVITE * 60 };
      }
    }
  }

  join(p: Player, id: number) {
    const o = this.ops.get(id);
    p.state.opInvite = null;
    if (!o || !this.canJoin(p)) return;
    if (o.crew && crewKey(p) !== o.crew) return this.w.toast(p, 'Mission réservée à un autre crew');
    this.add(o, p);
    for (const m of o.members) {
      const mp = this.w.players.get(m);
      if (mp && mp !== p) this.w.toast(mp, `➕ ${p.state.name} vous rejoint`);
    }
  }

  private add(o: Op, p: Player) {
    const s = p.state;
    o.members.add(s.id);
    s.opInvite = null;
    s.mission = `op:${o.id}`;
    s.missionStep = 0;
    this.w.toast(p, `${o.def.icon} ${o.def.name}${o.crew ? ' (crew)' : ' (ouverte)'} : ${o.def.pitch}`);
    this.w.events.push({ type: 'mission', playerId: s.id, name: o.def.name, state: 'start' });
  }

  /** ✕ on the objective, knocked out for good, disconnected. */
  leave(p: Player, reason = 'Tu as quitté la mission') {
    const o = this.memberOf(p);
    if (!o) return;
    o.members.delete(p.state.id);
    this.clear(p);
    this.w.toast(p, `✖ ${reason}`);
    this.w.events.push({ type: 'mission', playerId: p.state.id, name: o.def.name, state: 'fail' });
    if (o.members.size === 0) this.finish(o, false);
  }

  drop(id: string) {
    for (const o of this.ops.values()) {
      o.members.delete(id);
      if (o.members.size === 0) this.finish(o, false);
    }
    this.cooldown.delete(id);
  }

  private clear(p: Player) {
    const s = p.state;
    s.mission = null;
    s.objective = '';
    s.waypoint = null;
    s.missionTargets = [];
    s.missionTimer = -1;
  }

  /** Called by the world when a robbery is completed. */
  onRobbery(p: Player) {
    const o = this.memberOf(p);
    if (o?.def.kind === 'razzia') o.robbed++;
  }

  // ---------------------------------------------------------------- the jobs

  private thug(x: number, z: number, health: number, armed: boolean): Ped {
    const ped = this.w.spawnPed(x, z, { ambient: false });
    ped.state.temper = 'fighter';
    ped.state.maxHealth = ped.state.health = health;
    ped.state.money = this.w.rng.int(60, 200);
    ped.state.weapon = armed ? 'pistol' : this.w.rng.chance(0.5) ? 'bat' : 'knife';
    return ped;
  }

  private setup(o: Op) {
    const w = this.w;
    const n = Math.max(1, w.players.size);
    if (o.def.kind === 'rue') {
      const count = 4 + Math.min(6, n * 2);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        o.peds.push(this.thug(o.x + Math.cos(a) * 4, o.z + Math.sin(a) * 4, i === 0 ? 320 : 150, i % 2 === 0).state.id);
      }
      o.boss = o.peds[0];
    } else if (o.def.kind === 'cible') {
      const vip = w.spawnPed(o.x, o.z, { ambient: false, mode: 'walk' });
      vip.state.vip = true;
      vip.state.maxHealth = vip.state.health = 380;
      vip.state.money = 2500;
      vip.to = vip.from = w.nearestWalkNode(o.x, o.z);
      o.boss = vip.state.id;
      for (let i = 0; i < 3; i++) {
        const g = this.thug(o.x + (i - 1) * 1.5, o.z + 1.5, 200, true);
        g.state.mode = 'follow';
        o.peds.push(g.state.id);
      }
    } else if (o.def.kind === 'convoi') {
      const lanes = w.lanes.lanes.filter((l) => Math.hypot((l.ax + l.bx) / 2 - o.x, (l.az + l.bz) / 2 - o.z) < 60 && l.length > 20);
      const lane = lanes.length ? lanes[w.rng.int(0, lanes.length - 1)] : w.lanes.lanes[0];
      const v = w.spawnVehicle('offroad', lane.ax + lane.dx * lane.length * 0.3, 0.3, lane.az + lane.dz * lane.length * 0.3, Math.atan2(-lane.dx, -lane.dz), 'npc', false);
      v.lane = lane.id;
      v.rush = 1.5;
      v.state.health = v.spec.health * 3;
      v.state.paint = 6;
      o.vehicle = v.state.id;
    }
  }

  update() {
    const w = this.w;
    for (const p of w.players.values()) if (p.state.opInvite && w.tick > p.state.opInvite.until) p.state.opInvite = null;
    // walking by an open job: you are offered to join
    if (w.tick % 30 === 0)
      for (const o of this.ops.values()) {
        if (o.crew) continue;
        for (const p of w.players.values()) {
          if (p.state.opInvite || !this.canJoin(p) || Math.hypot(p.state.x - o.x, p.state.z - o.z) > 60) continue;
          p.state.opInvite = { id: o.id, text: `📣 Mission ouverte ici : ${o.def.icon} ${o.def.name} (${o.members.size} dans le coup)`, until: w.tick + OP_INVITE * 60 };
        }
      }
    for (const o of [...this.ops.values()]) {
      o.timer -= DT;
      if (o.timer <= 0) {
        this.finish(o, false, 'Trop tard : la mission est ratée');
        continue;
      }
      let done = false;
      let text = '';
      let way: [number, number] | null = [o.x, o.z];
      let targets: number[] = [];
      if (o.def.kind === 'rue' || o.def.kind === 'cible') {
        const alive = o.peds.map((id) => w.peds.get(id)).filter((q) => q?.alive) as Ped[];
        const boss = w.peds.get(o.boss);
        // guards stay with the VIP, everybody fights the members who come close
        for (const q of alive) {
          if (o.def.kind === 'cible' && boss?.alive && q.state.mode === 'follow') {
            q.chase.x = boss.state.x + 1;
            q.chase.z = boss.state.z + 1;
            q.chase.stop = 1.5;
          }
          if (q.state.mode === 'fight') continue;
          for (const m of o.members) {
            const ms = w.players.get(m)?.state;
            if (ms && !ms.dead && ms.vehicle < 0 && !ms.interior && Math.hypot(ms.x - q.state.x, ms.z - q.state.z) < 20) {
              q.state.mode = 'fight';
              q.state.target = m;
              break;
            }
          }
        }
        if (o.def.kind === 'rue') {
          targets = alive.map((q) => q.state.id);
          done = alive.length === 0;
          text = `Mettez K.O. la bande (${alive.length} restant${alive.length > 1 ? 's' : ''})`;
          if (alive[0]) way = [alive[0].state.x, alive[0].state.z];
        } else {
          done = !boss?.alive;
          targets = boss ? [boss.state.id, ...alive.map((q) => q.state.id)] : [];
          text = 'Mettez le caïd K.O. (diamant doré)';
          if (boss) way = [boss.state.x, boss.state.z];
        }
      } else if (o.def.kind === 'convoi') {
        const v = w.vehicles.get(o.vehicle);
        done = !v || v.state.wrecked || v.state.health <= 0;
        if (v) {
          targets = [v.state.id];
          way = [v.state.x, v.state.z];
        }
        text = 'Arrêtez le 4×4 blindé : détruisez-le';
      } else if (o.def.kind === 'razzia') {
        done = o.robbed >= 2;
        text = `Braquez des supérettes (${o.robbed}/2)`;
        way = null;
      }
      for (const m of o.members) {
        const s = w.players.get(m)?.state;
        if (!s) continue;
        s.objective = `${o.def.icon} ${text} · ${o.members.size} dans le coup`;
        s.waypoint = way;
        s.missionTargets = targets;
        s.missionTimer = o.timer;
      }
      if (done) this.finish(o, true);
    }
  }

  private finish(o: Op, success: boolean, reason?: string) {
    const w = this.w;
    this.ops.delete(o.id);
    for (const id of o.peds) {
      const q = w.peds.get(id);
      if (q) q.ambient = true;
    }
    const v = w.vehicles.get(o.vehicle);
    if (v) v.ambient = true;
    const b = w.peds.get(o.boss);
    if (b) b.ambient = true;
    for (const m of o.members) {
      const p = w.players.get(m);
      if (!p) continue;
      this.clear(p);
      if (!success) {
        w.toast(p, `✖ ${reason ?? 'Mission annulée'}`);
        w.events.push({ type: 'mission', playerId: m, name: o.def.name, state: 'fail' });
        continue;
      }
      const cash = Math.round(o.def.reward * w.family.pay(p) * (o.crew ? OP_CREW_BONUS : 1));
      p.state.money += cash;
      w.progress.addXp(p, o.def.xp);
      w.law.respect(p, 5);
      w.events.push({ type: 'money', playerId: m, amount: cash });
      w.events.push({ type: 'mission', playerId: m, name: o.def.name, state: 'done' });
      w.toast(p, `✔ ${o.def.icon} ${o.def.name} réussie à ${o.members.size} · +${cash.toLocaleString('fr-FR')} € · +${o.def.xp} XP`);
    }
  }
}

export { OPS };
