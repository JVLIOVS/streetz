import { DT } from '../core/loop';
import { PAY_EVERY, RANKS } from '../data/family';
import type { Ped } from './peds';
import type { Player } from './player';
import type { SimWorld } from './world';

/** Per-player runtime (authority only, not serialized: guards are ordinary peds). */
interface Crew {
  guards: number[];
  /** Seconds before a knocked-out guard is replaced. */
  respawn: number;
  pay: number;
  cooldown: number[];
  off: boolean;
}

const GUARD_RANGE = 26;

/**
 * Perks of your rank in the Family: bodyguards who follow you and shoot whoever
 * attacks you, your share of the Family business, the lawyer's discount, better pay.
 */
export class FamilySystem {
  private crews = new Map<string, Crew>();

  constructor(private w: SimWorld) {}

  private crew(id: string) {
    let c = this.crews.get(id);
    if (!c) this.crews.set(id, (c = { guards: [], respawn: 0, pay: 0, cooldown: [], off: false }));
    return c;
  }

  rank(p: Player) {
    return this.w.missions.rank(p);
  }

  /** Mission / contract rewards multiplier. */
  pay(p: Player) {
    return RANKS[this.rank(p)].pay;
  }

  /** Fines and bail multiplier (the Family lawyer). */
  lawyer(p: Player) {
    return RANKS[this.rank(p)].lawyer;
  }

  /** Send the bodyguards home / call them back. */
  toggleGuards(p: Player) {
    const c = this.crew(p.state.id);
    if (!RANKS[this.rank(p)].guards) {
      this.w.toast(p, '🎖 Les gardes du corps arrivent au grade de Lieutenant');
      return;
    }
    c.off = !c.off;
    this.w.toast(p, c.off ? '🕶 Tes gardes rentrent à la base' : '🕶 Tes gardes arrivent');
  }

  guardsOn(p: Player) {
    return !this.crew(p.state.id).off;
  }

  update() {
    for (const p of this.w.players.values()) {
      const s = p.state;
      const r = RANKS[this.rank(p)];
      const c = this.crew(s.id);
      // your share, paid while you play
      if (r.salary > 0 && !s.dead) {
        c.pay += DT;
        if (c.pay >= PAY_EVERY) {
          c.pay = 0;
          s.money += r.salary;
          this.w.events.push({ type: 'money', playerId: s.id, amount: r.salary });
          this.w.toast(p, `💼 Ta part de la Famille : +${r.salary.toLocaleString('fr-FR')} €`);
        }
      }
      this.updateGuards(p, c, r.guards);
    }
    for (const id of this.crews.keys()) if (!this.w.players.has(id)) this.drop(id);
  }

  drop(id: string) {
    const c = this.crews.get(id);
    if (c) for (const g of c.guards) this.w.removePed(g);
    this.crews.delete(id);
  }

  private updateGuards(p: Player, c: Crew, want: number) {
    const s = p.state;
    // no guards in a car, indoors, during a mission with a partner, in jail or knocked out
    const away = c.off || s.vehicle >= 0 || !!s.interior || s.dead || s.ally >= 0;
    c.guards = c.guards.filter((id) => {
      const g = this.w.peds.get(id);
      if (g && g.alive && !away) return true;
      if (g) this.w.removePed(id);
      if (g && !g.alive) c.respawn = 45;
      return false;
    });
    if (away) return;
    if (c.respawn > 0) c.respawn -= DT;
    if (c.guards.length < want && c.respawn <= 0 && this.w.tick % 30 === 0) c.guards.push(this.spawnGuard(p, c.guards.length));
    c.guards.forEach((id, i) => this.guard(p, c, this.w.peds.get(id)!, i));
  }

  private spawnGuard(p: Player, i: number) {
    const s = p.state;
    const a = s.facing + Math.PI * (0.75 + 0.5 * (i % 2)) + i * 0.3;
    const ped = this.w.spawnPed(s.x - Math.sin(a) * 2, s.z - Math.cos(a) * 2, { ambient: false, mode: 'follow', facing: s.facing });
    ped.state.look = 9100 + i;
    ped.state.temper = 'fighter';
    ped.state.maxHealth = ped.state.health = 400;
    ped.state.money = 0;
    ped.state.weapon = 'pistol';
    ped.guardOf = s.id;
    return ped.state.id;
  }

  private guard(p: Player, c: Crew, g: Ped, i: number) {
    const s = p.state;
    const gs = g.state;
    const d = Math.hypot(gs.x - s.x, gs.z - s.z);
    if (d > 30) {
      // left behind (jump, fast run): catch up
      const a = s.facing + Math.PI + (i - 1) * 0.6;
      gs.x = s.x - Math.sin(a) * 2.2;
      gs.z = s.z - Math.cos(a) * 2.2;
      gs.y = this.w.groundY(gs.x, gs.z);
      g.savePrev();
    }
    gs.mode = 'follow';
    // a loose formation behind you
    const a = s.facing + Math.PI + (i - (c.guards.length - 1) / 2) * 0.7;
    g.chase.x = s.x - Math.sin(a) * 2.2;
    g.chase.z = s.z - Math.cos(a) * 2.2;
    g.chase.stop = 0.6;
    c.cooldown[i] = (c.cooldown[i] ?? 0) - DT;
    if (c.cooldown[i] > 0) return;
    const t = this.threat(p, gs.x, gs.z);
    if (!t) return;
    c.cooldown[i] = this.w.rng.range(0.8, 1.3);
    gs.facing = Math.atan2(-(t.state.x - gs.x), -(t.state.z - gs.z));
    gs.action = 'shoot';
    gs.actionSeq++;
    const hit = this.w.rng.chance(0.75);
    this.w.events.push({ type: 'shot', fx: gs.x, fy: gs.y + 1.4, fz: gs.z, tx: t.state.x, ty: t.state.y + 1.1, tz: t.state.z, hit, w: 'pistol' });
    if (hit) this.w.damagePed(t, 30, null, gs.x, gs.z);
  }

  /** Who the guards shoot: anyone fighting you, and the cops once they come to take you down. */
  private threat(p: Player, x: number, z: number): Ped | null {
    const s = p.state;
    const cops = this.w.police.aggressive(s) && s.wanted > 0;
    let best: Ped | null = null;
    let bd = GUARD_RANGE;
    for (const q of this.w.peds.values()) {
      if (!q.alive || q.invulnerable || q.guardOf) continue;
      const qs = q.state;
      const hostile = (qs.mode === 'fight' && qs.target === s.id) || (cops && qs.role !== 'civ');
      if (!hostile) continue;
      const d = Math.hypot(qs.x - x, qs.z - z);
      if (d < bd && (d < 3 || this.w.castStatic(x, 1.4, z, (qs.x - x) / d, 0, (qs.z - z) / d, d) >= d - 0.6)) {
        bd = d;
        best = q;
      }
    }
    return best;
  }
}
