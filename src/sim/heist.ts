import { DT } from '../core/loop';
import { HEIST } from '../data/social';
import type { InteriorDef } from '../maps/types';
import type { ContextAction, Player } from './player';
import type { SimWorld } from './world';

interface Crew {
  members: string[];
  /** Members at the start (the take is split between them). */
  size: number;
  step: 'gather' | 'drill' | 'escape';
  progress: number;
  /** Members still carrying a bag (escape). */
  bags: Set<string>;
}

/**
 * Co-op bank heist for 2+ players: everybody gets into the bank, at least two drill
 * the vault together while the police storms in, then each one carries a bag of cash
 * to the drop-off point. A player knocked out on the way drops half of their bag.
 */
export class HeistSystem {
  readonly spot: { x: number; z: number };
  private crew: Crew | null = null;
  private readyAt = 0;

  constructor(private w: SimWorld) {
    const n = w.walk[w.nearestWalkNode(HEIST.x, HEIST.z)];
    this.spot = { x: n.x, z: n.z };
  }

  private get bank(): InteriorDef | undefined {
    return this.w.map.interiors.find((i) => i.kind === 'bank');
  }

  /** Where the drillers stand, in front of the vault door. */
  private vault() {
    const b = this.bank!;
    return { x: b.origin.x + b.w / 2 - 3, z: b.origin.z - b.d / 2 + 1.8 };
  }

  isMember(p: Player) {
    return !!this.crew?.members.includes(p.state.id);
  }

  context(p: Player): ContextAction | null {
    const s = p.state;
    if (s.mission || s.vehicle >= 0 || s.interior || Math.hypot(this.spot.x - s.x, this.spot.z - s.z) > 3) return null;
    if (this.crew) return { kind: 'heist', label: '⏳ Braquage en cours', target: HEIST.id };
    return { kind: 'heist', label: this.w.players.size < HEIST.minPlayers ? '🔒 Coop · 2 joueurs' : `Braquage coop · ${HEIST.name}`, target: HEIST.id };
  }

  start(p: Player) {
    const w = this.w;
    if (this.crew) return w.toast(p, 'Un braquage est déjà en cours');
    if (w.tick < this.readyAt) return w.toast(p, `La banque est sur ses gardes : reviens dans ${Math.ceil((this.readyAt - w.tick) / 3600)} min`);
    const members = [...w.players.values()].filter(
      (o) => !o.state.dead && !o.state.mission && !o.state.interior && Math.hypot(o.state.x - this.spot.x, o.state.z - this.spot.z) < HEIST.gatherRadius,
    );
    if (members.length < HEIST.minPlayers) return w.toast(p, `Il faut au moins ${HEIST.minPlayers} joueurs sur le point rouge pour ce braquage`);
    this.crew = { members: members.map((m) => m.state.id), size: members.length, step: 'gather', progress: 0, bags: new Set() };
    for (const m of members) {
      m.state.mission = HEIST.id;
      m.state.missionStep = 0;
      w.toast(m, `💰 ${HEIST.name} : ${members.length} braqueurs, ${HEIST.total.toLocaleString('fr-FR')} € à partager !`);
      w.events.push({ type: 'mission', playerId: m.state.id, name: HEIST.name, state: 'start' });
    }
  }

  /** A member gives up (✕) or disconnects. */
  leave(p: Player, reason = 'Tu as lâché ta bande') {
    const c = this.crew;
    if (!c || !this.isMember(p)) return;
    c.members = c.members.filter((id) => id !== p.state.id);
    c.bags.delete(p.state.id);
    this.reset(p);
    this.w.toast(p, `✖ ${reason}`);
    this.w.events.push({ type: 'mission', playerId: p.state.id, name: HEIST.name, state: 'fail' });
    if (c.members.length === 0) this.finish();
  }

  private reset(p: Player) {
    const s = p.state;
    s.mission = null;
    s.objective = '';
    s.waypoint = null;
    s.robbery = -1;
    s.missionTimer = -1;
  }

  private finish() {
    for (const id of this.crew?.members ?? []) {
      const p = this.w.players.get(id);
      if (p) this.reset(p);
    }
    this.crew = null;
    this.readyAt = this.w.tick + HEIST.cooldown * 60;
  }

  update() {
    const c = this.crew;
    const w = this.w;
    if (!c) return;
    const bank = this.bank;
    if (!bank) return this.finish();
    // drop members who left the game or got knocked out
    for (const id of [...c.members]) {
      const p = w.players.get(id);
      if (!p) {
        c.members = c.members.filter((m) => m !== id);
        continue;
      }
      if (p.state.dead) {
        if (c.bags.has(id)) {
          // the bag falls on the street: half of the share, anyone can grab it
          const share = Math.round(HEIST.total / c.size / 2);
          const pid = w.newId();
          w.pickups.set(pid, { id: pid, x: p.state.x, y: p.state.y, z: p.state.z, kind: 'money', amount: share });
        }
        this.leave(p, 'K.O. : ta part du butin est perdue');
      }
    }
    if (!this.crew) return;
    const members = c.members.map((id) => w.players.get(id)!).filter(Boolean);
    if (members.length === 0) return this.finish();
    if (c.step === 'gather') {
      const inside = members.filter((m) => m.state.interior === bank.id).length;
      for (const m of members) {
        m.state.objective = `Entrez tous dans la banque (${inside}/${members.length})`;
        m.state.waypoint = [bank.door.x, bank.door.z];
      }
      if (inside === members.length) {
        c.step = 'drill';
        // the alarm goes off
        for (const m of members) w.alarm(m);
      }
    } else if (c.step === 'drill') {
      const v = this.vault();
      const near = members.filter((m) => m.state.interior === bank.id && Math.hypot(m.state.x - v.x, m.state.z - v.z) < 4).length;
      if (near >= HEIST.minPlayers) c.progress += (DT * (near / HEIST.minPlayers)) / HEIST.drillTime;
      for (const m of members) {
        m.state.objective = near >= HEIST.minPlayers ? `Percez le coffre, tenez la position ! (${near} au coffre)` : `Il faut être au moins ${HEIST.minPlayers} au coffre (au fond à droite)`;
        m.state.robbery = Math.min(1, c.progress);
        m.state.waypoint = [bank.door.x, bank.door.z];
      }
      if (c.progress >= 1) {
        c.step = 'escape';
        for (const m of members) {
          c.bags.add(m.state.id);
          m.state.robbery = -1;
          w.toast(m, '💰 Le coffre est ouvert ! Chacun son sac : direction le point de dépôt €');
        }
      }
    } else {
      const drop = w.contracts.fence;
      for (const m of members) {
        const s = m.state;
        s.objective = 'Ramène ton sac au point de dépôt € (vert sur la carte)';
        s.waypoint = [drop.x, drop.z];
        if (c.bags.has(s.id) && !s.interior && Math.hypot(drop.x - s.x, drop.z - s.z) < 9) {
          c.bags.delete(s.id);
          const share = Math.round(HEIST.total / c.size);
          s.money += share;
          s.week.heists++;
          w.events.push({ type: 'money', playerId: s.id, amount: share });
          w.events.push({ type: 'mission', playerId: s.id, name: HEIST.name, state: 'done' });
          w.toast(m, `✔ BRAQUAGE RÉUSSI · ta part : ${share.toLocaleString('fr-FR')} €`);
          w.progress.addXp(m, HEIST.xp);
          c.members = c.members.filter((id) => id !== s.id);
          this.reset(m);
        }
      }
      if (c.members.length === 0) this.finish();
    }
  }
}
