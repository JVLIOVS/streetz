import { GEAR_SLOTS, bagKeeps } from '../data/gear';
import { DT } from '../core/loop';
import { BAIL_PER_STAR, CHECK_EVERY, STASH_MINUTES, fineFor, MAX_FICHES, NOTORIETY, OFFER_WAIT, RESPECT, SKILL_MAX, SKILLS, skillPoints, type SkillId } from '../data/law';
import { levelOf } from '../data/progression';
import { WEAPONS, type WeaponId } from '../data/weapons';
import type { Ped } from './peds';
import type { Player } from './player';
import type { SimWorld } from './world';

/** An officer walking up to a player to fine / check them. */
interface Stop {
  cop: number;
  /** Random ID check (trouble if you carry a gun). */
  kind: 'check';
  wait: number;
  delay: number;
}

/**
 * Law & consequences: fines for minor offences (5 max, ever pricier), random police
 * checks for known criminals, prison, losing what you carry when knocked out, the
 * criminal record, respect and the bank account.
 */
export class LawSystem {
  private stops = new Map<string, Stop>();
  private nextCheck = new Map<string, number>();

  constructor(private w: SimWorld) {}

  // ------------------------------------------------------------------ money

  /** Pays with the cash you carry first, then by card from the bank. */
  pay(p: Player, price: number): boolean {
    const s = p.state;
    if (s.money + s.bank < price) return false;
    const cash = Math.min(s.money, price);
    s.money -= cash;
    s.bank -= price - cash;
    return true;
  }

  /** `deposit:all`, `withdraw:N` or `withdraw:all` (at the bank counter or the hideout laptop). */
  bankOp(p: Player, arg: string) {
    const s = p.state;
    const room = s.interior ? this.w.rooms.get(s.interior) : undefined;
    const def = s.interior ? this.w.map.interiors.find((i) => i.id === s.interior) : undefined;
    const spot = def?.kind === 'bank' ? room?.counter : def?.kind === 'hideout' ? room?.office : null;
    const safe = this.w.base.atSafe(p);
    if (!safe && (!spot || Math.hypot(s.x - spot.x, s.z - spot.z) > 3.5)) return;
    const [op, amt] = arg.split(':');
    if (op === 'deposit') {
      const n = amt === 'all' ? s.money : Math.min(s.money, positive(amt));
      s.money -= n;
      s.bank += n;
      if (n > 0) this.w.toast(p, `🏦 ${n.toLocaleString('fr-FR')} € à l’abri à la banque`);
    } else if (op === 'withdraw') {
      const n = amt === 'all' ? s.bank : Math.min(s.bank, positive(amt));
      s.bank -= n;
      s.money += n;
    }
  }

  // ------------------------------------------------------------------ respect, record

  respect(p: Player, n: number) {
    const s = p.state;
    const before = s.respect;
    s.respect = Math.max(0, s.respect + n);
    if (before < RESPECT.feared && s.respect >= RESPECT.feared) this.w.toast(p, '👑 Respect : les durs du quartier n’osent plus te répondre');
  }

  notoriety(p: Player, n: number) {
    const s = p.state;
    const before = s.notoriety;
    s.notoriety = Math.max(0, Math.min(100, s.notoriety + n));
    if (before < NOTORIETY.checks && s.notoriety >= NOTORIETY.checks) this.w.toast(p, '📁 Ton casier s’alourdit : la police va te contrôler plus souvent');
    else if (before < NOTORIETY.feared && s.notoriety >= NOTORIETY.feared) this.w.toast(p, '📁 Tout le quartier te connaît : les passants t’évitent');
  }

  /** XP bonus from respect. */
  xpFactor(p: Player) {
    return 1 + Math.min(1, p.state.respect / RESPECT.xpFull);
  }

  // ------------------------------------------------------------------ skills

  /** Spends a skill point. */
  skill(p: Player, id: string) {
    const s = p.state;
    const sk = SKILLS.find((k) => k.id === id);
    if (!sk || s.skills[sk.id] >= SKILL_MAX || skillPoints(levelOf(s.rep), s.skills) <= 0) return;
    s.skills[sk.id]++;
    this.w.toast(p, `${sk.icon} ${sk.name} ${s.skills[sk.id]}/${SKILL_MAX}`);
  }

  level(p: Player, id: SkillId) {
    // never trust a stored value: 0..SKILL_MAX
    return Math.max(0, Math.min(SKILL_MAX, Number(p.state.skills[id]) || 0));
  }

  // ------------------------------------------------------------------ police deal, checks, prison

  /** Is this officer busy with a random check? (the normal police AI leaves him alone) */
  isStopCop(ped: Ped) {
    for (const st of this.stops.values()) if (st.cop === ped.state.id) return true;
    return false;
  }

  /** Fiché 3 times: no more deals, the police comes to neutralize you. */
  fiche(p: Player) {
    return p.state.fines >= MAX_FICHES;
  }

  /** Pay the fine offered by the officers: stars cleared, one more fiche. */
  payFine(p: Player) {
    const s = p.state;
    if (s.fine <= 0) return;
    if (!this.pay(p, s.fine)) {
      this.w.toast(p, 'Pas assez d’argent pour l’amende… (refuse ou rends-toi)');
      return;
    }
    s.fines++;
    this.w.toast(p, `Amende payée : -${s.fine.toLocaleString('fr-FR')} € · fiché ${s.fines}/${MAX_FICHES}${this.fiche(p) ? ' — la prochaine fois, ils viennent te neutraliser' : ''}`);
    s.fine = 0;
    this.notoriety(p, NOTORIETY.fine);
    this.w.clearWanted(p);
  }

  /** Say no to the deal: it becomes a real chase. */
  refuse(p: Player, why = 'Tu refuses l’amende') {
    const s = p.state;
    if (s.fine <= 0) return;
    s.fine = 0;
    s.refused = true;
    s.wanted = Math.min(5, Math.max(2, s.wanted + 1));
    s.resist = 8;
    this.w.police.reported(p, s.x, s.z);
    this.w.events.push({ type: 'wanted', playerId: s.id, level: s.wanted });
    this.w.toast(p, `🚨 ${why} : la police te poursuit`);
  }

  /** Hands up: prison, but you keep your stuff. */
  surrender(p: Player) {
    if (!p.state.canSurrender || p.state.wanted <= 0) return;
    this.w.arrest(p);
  }

  private nearestCop(x: number, z: number, r: number): Ped | null {
    let best: Ped | null = null;
    let bd = r;
    for (const ped of this.w.peds.values()) {
      if (ped.state.role === 'civ' || !ped.alive) continue;
      const d = Math.hypot(ped.state.x - x, ped.state.z - z);
      if (d < bd) {
        bd = d;
        best = ped;
      }
    }
    return best;
  }

  /** The officers offer a fine when they reach you (wanted ≤ 3, not fiché 3 times, not resisting). */
  private updateDeal(p: Player) {
    const s = p.state;
    if (s.wanted === 0) {
      s.fine = 0;
      s.refused = false;
    }
    const near = s.wanted > 0 && !s.dead && !!this.nearestCop(s.x, s.z, 30);
    const car = s.vehicle >= 0 ? this.w.vehicles.get(s.vehicle) : undefined;
    let policeCar = false;
    if (s.wanted > 0) for (const v of this.w.vehicles.values()) if (v.police && !v.state.wrecked && Math.hypot(v.state.x - s.x, v.state.z - s.z) < 40) policeCar = true;
    s.canSurrender = s.wanted > 0 && !s.dead && !s.interior && (near || policeCar);
    if (s.dead || s.interior || s.wanted === 0) return;
    if (s.fine > 0) {
      s.fineTimer -= DT;
      if (!this.nearestCop(s.x, s.z, 12)) this.refuse(p, 'Tu as filé');
      else if (s.fineTimer <= 0) this.refuse(p, 'Pas de réponse');
      return;
    }
    if (s.refused || this.fiche(p) || s.wanted > 3 || this.w.police.aggressive(s)) return;
    const still = car ? Math.abs(car.state.speed) < 1.5 : s.speed < 3;
    if (!still || !this.nearestCop(s.x, s.z, car ? 4 : 3)) return;
    s.fine = Math.round(fineFor(s.wanted, s.fines) * this.w.family.lawyer(p));
    s.fineTimer = OFFER_WAIT;
    this.w.events.push({ type: 'deal', playerId: s.id, fine: s.fine });
  }

  update() {
    const w = this.w;
    for (const p of w.players.values()) {
      const s = p.state;
      // the record slowly fades
      s.notoriety = Math.max(0, s.notoriety - (NOTORIETY.decayPerMin / 60) * DT);
      this.updateDeal(p);
      // is any of your dropped stuff still on the ground?
      if (s.stash && w.tick % 30 === 0) {
        let left = false;
        for (const pk of w.pickups.values()) if (pk.owner === s.id) left = true;
        if (!left) s.stash = null;
      }
      // random checks for known criminals
      if (s.notoriety >= NOTORIETY.checks && s.wanted === 0 && !s.interior && !s.dead && s.vehicle < 0 && !this.stops.has(s.id)) {
        const at = this.nextCheck.get(s.id) ?? w.tick + w.rng.range(...CHECK_EVERY) * 60;
        this.nextCheck.set(s.id, at);
        if (w.tick >= at) {
          this.nextCheck.set(s.id, w.tick + w.rng.range(...CHECK_EVERY) * 60);
          this.stops.set(s.id, { cop: -1, kind: 'check', wait: -1, delay: 0 });
        }
      }
      const st = this.stops.get(s.id);
      if (!st) continue;
      if (s.dead || s.wanted > 0 || s.interior) {
        this.endStop(p);
        continue;
      }
      let cop = w.peds.get(st.cop);
      if (!cop || !cop.alive) {
        if (st.cop >= 0) {
          this.endStop(p);
          continue;
        }
        const c = this.spawnCop(p);
        if (!c) continue;
        cop = c;
        st.cop = c.state.id;
      }
      const cs = cop.state;
      const d = Math.hypot(s.x - cs.x, s.z - cs.z);
      cs.facing = Math.atan2(-(s.x - cs.x), -(s.z - cs.z));
      if (d > 2) {
        w.moveWalker(cop, ((s.x - cs.x) / d) * 2.6, ((s.z - cs.z) / d) * 2.6);
        continue;
      }
      // the check itself
      const gun = s.weapons.some((x) => !WEAPONS[x].melee && x !== 'sniper' && s.ammo[x] > 0);
      if (gun) {
        w.toast(p, '👮 « Contrôle. Port d’arme illégal ! »');
        s.wanted = 1;
        w.police.reported(p, s.x, s.z);
        w.events.push({ type: 'wanted', playerId: s.id, level: 1 });
        // the officer becomes a normal unit: the deal is offered right away
        st.cop = -2;
      } else {
        w.toast(p, '👮 « Contrôle de routine… C’est bon, circulez. »');
        this.notoriety(p, -2);
      }
      this.endStop(p);
    }
    // known criminals scare passers-by
    if (w.tick % 30 === 0) {
      for (const p of w.players.values()) {
        const s = p.state;
        if (s.notoriety < NOTORIETY.feared || s.interior) continue;
        for (const ped of w.peds.values()) {
          if (ped.state.role !== 'civ' || ped.state.temper === 'fighter' || ped.state.mode !== 'walk') continue;
          if (Math.hypot(ped.state.x - s.x, ped.state.z - s.z) < 7 && w.rng.chance(0.3)) ped.scare(s.x, s.z, false);
        }
      }
    }
  }

  private endStop(p: Player) {
    const st = this.stops.get(p.state.id);
    if (!st) return;
    this.stops.delete(p.state.id);
    const cop = this.w.peds.get(st.cop);
    if (cop?.police) {
      cop.state.weapon = 'baton';
      if (p.state.wanted === 0) cop.police.leaving = true;
    }
  }

  private spawnCop(p: Player): Ped | null {
    const s = p.state;
    const nodes = this.w.walk.filter((n) => {
      const d = Math.hypot(n.x - s.x, n.z - s.z);
      return d > 25 && d < 45;
    });
    if (!nodes.length) return null;
    const n = nodes[this.w.rng.int(0, nodes.length - 1)];
    const ped = this.w.spawnPed(n.x, n.z, { mode: 'police' });
    ped.state.role = 'cop';
    ped.state.weapon = 'none';
    ped.state.temper = 'fighter';
    ped.state.maxHealth = ped.state.health = 110;
    ped.ambient = true;
    ped.police = { target: s.id, cooldown: 1, leaving: false };
    return ped;
  }

  /** Prison (you surrendered): bail paid if you can, one more fiche, but you keep your stuff. */
  jail(p: Player) {
    const s = p.state;
    const bail = Math.round(BAIL_PER_STAR * Math.max(1, s.wanted) * this.w.family.lawyer(p));
    const paid = this.pay(p, bail) ? bail : 0;
    s.fines++;
    s.fine = 0;
    s.refused = false;
    this.endStop(p);
    this.notoriety(p, NOTORIETY.arrest);
    this.respect(p, RESPECT.arrested);
    this.w.events.push({ type: 'jail', playerId: s.id, seized: paid, lost: [] });
    return paid;
  }

  /**
   * Knocked out: everything you carry falls on the ground where you dropped (cash, your
   * weapons, a mission item). Anyone can grab it, you included if you hurry back.
   */
  onDeath(p: Player, by?: Player) {
    const s = p.state;
    const w = this.w;
    const owner = s.id;
    const until = w.tick + STASH_MINUTES * 3600;
    let dropped = false;
    // the bag keeps part of your cash
    const kept = Math.floor(s.money * bagKeeps(s.gear));
    if (s.money - kept > 0) {
      const id = w.newId();
      w.pickups.set(id, { id, x: s.x + 0.5, y: s.y, z: s.z, kind: 'money', amount: s.money - kept, owner, until });
      s.money = kept;
      dropped = true;
    }
    // and your clothes: you get back up in your underwear
    let g = 0;
    for (const slot of GEAR_SLOTS) {
      const r = s.gear[slot];
      if (r === undefined) continue;
      const a = Math.PI + (g++ / 4) * Math.PI;
      w.dropGear(s.x + Math.cos(a) * 1.4, s.y, s.z + Math.sin(a) * 1.4, { slot, r }, owner, until);
      dropped = true;
    }
    s.gear = {};
    let k = 0;
    for (const wpn of [...s.weapons] as WeaponId[]) {
      if (wpn === 'fist' || wpn === 'sniper') continue;
      const spec = WEAPONS[wpn];
      const id = w.newId();
      const a = (k++ / 3) * Math.PI;
      w.pickups.set(id, { id, x: s.x + Math.cos(a) * 1.2, y: s.y, z: s.z + Math.sin(a) * 1.2, kind: 'weapon', amount: spec.melee ? 0 : s.ammo[wpn], weapon: wpn, owner, until });
      s.ammo[wpn] = 0;
      dropped = true;
    }
    // your stuff stays there a while, marked on your map; anybody close can grab it
    if (dropped) {
      s.stash = [s.x, s.z];
      w.toast(p, `🎒 Ton stuff est resté par terre : il est marqué sur ta carte (${STASH_MINUTES} min). D’autres peuvent le prendre !`);
    }
    s.weapons = ['fist'];
    s.weapon = 'fist';
    if (by) this.respect(p, RESPECT.koByPlayer);
  }

  drop(id: string) {
    this.stops.delete(id);
    this.nextCheck.delete(id);
  }
}

/** An amount typed or sent by a client: a whole number ≥ 0 (a negative deposit would create money). */
const positive = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
