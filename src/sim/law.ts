import { DT } from '../core/loop';
import { CHECK_EVERY, FINE_PRICES, FINE_REFUSE_DIST, FINE_WAIT, JAIL_CASH_SEIZED, MAX_FINES, MINOR_CRIMES, NOTORIETY, RESPECT, SKILL_MAX, SKILLS, skillPoints, type SkillId } from '../data/law';
import { levelOf } from '../data/progression';
import { WEAPON_ORDER, WEAPONS, type WeaponId } from '../data/weapons';
import type { Ped } from './peds';
import type { ContextAction, Player } from './player';
import type { SimWorld } from './world';

/** An officer walking up to a player to fine / check them. */
interface Stop {
  cop: number;
  /** 'fine': you owe money; 'check': random ID check (fine if you carry a gun). */
  kind: 'fine' | 'check';
  /** Seconds left to pay once the officer is next to you (-1 = still walking). */
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
    if (!spot || Math.hypot(s.x - spot.x, s.z - spot.z) > 3.5) return;
    const [op, amt] = arg.split(':');
    if (op === 'deposit') {
      const n = amt === 'all' ? s.money : Math.min(s.money, Number(amt) || 0);
      s.money -= n;
      s.bank += n;
      if (n > 0) this.w.toast(p, `🏦 ${n.toLocaleString('fr-FR')} € à l’abri à la banque`);
    } else if (op === 'withdraw') {
      const n = amt === 'all' ? s.bank : Math.min(s.bank, Number(amt) || 0);
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
    return p.state.skills[id] ?? 0;
  }

  // ------------------------------------------------------------------ fines & checks

  /**
   * Called before a crime raises the stars. Returns true if it becomes a fine instead
   * (minor offence, first star, fines left).
   */
  fineInstead(p: Player, kind: string): boolean {
    const s = p.state;
    if (s.wanted > 0 || s.fines >= MAX_FINES || !(MINOR_CRIMES as readonly string[]).includes(kind) || this.stops.has(s.id)) return false;
    s.wanted = 1;
    s.fine = FINE_PRICES[s.fines];
    this.stops.set(s.id, { cop: -1, kind: 'fine', wait: -1, delay: 5 });
    this.w.events.push({ type: 'wanted', playerId: s.id, level: 1 });
    this.w.toast(p, `👮 Infraction : un agent arrive pour une amende de ${s.fine.toLocaleString('fr-FR')} €`);
    return true;
  }

  /** Is this officer busy fining someone? (the normal police AI leaves him alone) */
  isStopCop(ped: Ped) {
    for (const st of this.stops.values()) if (st.cop === ped.state.id) return true;
    return false;
  }

  context(p: Player): ContextAction | null {
    const st = this.stops.get(p.state.id);
    if (!st || st.wait < 0 || p.state.fine <= 0) return null;
    return { kind: 'fine', label: `Payer l’amende · ${p.state.fine.toLocaleString('fr-FR')} €`, target: p.state.fine };
  }

  payFine(p: Player) {
    const s = p.state;
    const st = this.stops.get(s.id);
    if (!st || s.fine <= 0) return;
    if (!this.pay(p, s.fine)) {
      this.w.toast(p, 'Pas assez d’argent pour l’amende…');
      return;
    }
    this.w.toast(p, `Amende payée : -${s.fine.toLocaleString('fr-FR')} € (${s.fines + 1}/${MAX_FINES})${s.fines + 1 >= MAX_FINES ? ' — la prochaine fois, ce sera la poursuite' : ''}`);
    s.fines++;
    s.fine = 0;
    this.notoriety(p, NOTORIETY.fine);
    this.endStop(p, true);
    this.w.clearWanted(p);
  }

  private endStop(p: Player, leave: boolean) {
    const st = this.stops.get(p.state.id);
    if (!st) return;
    this.stops.delete(p.state.id);
    const cop = this.w.peds.get(st.cop);
    if (cop?.police) {
      if (leave) cop.police.leaving = true;
      cop.state.weapon = 'baton';
    }
  }

  /** You refused: it becomes a chase. */
  private refuse(p: Player, why: string) {
    const s = p.state;
    s.fine = 0;
    this.endStop(p, false);
    s.wanted = Math.max(2, s.wanted);
    this.w.police.reported(p, s.x, s.z);
    this.w.events.push({ type: 'wanted', playerId: s.id, level: s.wanted });
    this.w.toast(p, `🚨 ${why} : la police te poursuit`);
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

  update() {
    const w = this.w;
    for (const p of w.players.values()) {
      const s = p.state;
      // the record slowly fades
      s.notoriety = Math.max(0, s.notoriety - (NOTORIETY.decayPerMin / 60) * DT);
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
      // the stop is over if things escalated, or you got away / knocked out
      if (s.dead || (st.kind === 'fine' && (s.wanted === 0 || s.wanted > 1)) || (st.kind === 'check' && s.wanted > 0)) {
        if (st.kind === 'fine' && s.wanted === 0) s.fine = 0;
        this.endStop(p, s.wanted === 0 || s.dead);
        continue;
      }
      if (st.delay > 0) {
        st.delay -= DT;
        continue;
      }
      let cop = w.peds.get(st.cop);
      if (!cop || !cop.alive) {
        if (st.cop >= 0) {
          // you knocked the officer out
          if (st.kind === 'fine') this.refuse(p, 'Agent agressé');
          else this.endStop(p, false);
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
      if (st.wait < 0) {
        // walk up calmly
        if (d > 2) w.moveWalker(cop, ((s.x - cs.x) / d) * 2.6, ((s.z - cs.z) / d) * 2.6);
        else if (s.vehicle < 0) {
          st.wait = FINE_WAIT;
          if (st.kind === 'check') {
            const gun = s.weapons.some((x) => !WEAPONS[x].melee && s.ammo[x] > 0);
            if (!gun) {
              w.toast(p, '👮 « Contrôle de routine… C’est bon, circulez. »');
              this.notoriety(p, -2);
              this.endStop(p, true);
              continue;
            }
            st.kind = 'fine';
            s.fine = FINE_PRICES[Math.min(s.fines, MAX_FINES - 1)];
            s.wanted = 1;
            w.events.push({ type: 'wanted', playerId: s.id, level: 1 });
            w.toast(p, `👮 « Port d’arme ? Amende : ${s.fine.toLocaleString('fr-FR')} €. Vous payez ou on vous embarque. »`);
          } else w.toast(p, `👮 « Infraction constatée. Amende : ${s.fine.toLocaleString('fr-FR')} €. »`);
        }
        continue;
      }
      // waiting for the money
      st.wait -= DT;
      if (d > FINE_REFUSE_DIST) this.refuse(p, 'Refus d’obtempérer');
      else if (st.wait <= 0) this.refuse(p, 'Amende pas payée');
      else if (d > 2.5) w.moveWalker(cop, ((s.x - cs.x) / d) * 3, ((s.z - cs.z) / d) * 3);
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

  // ------------------------------------------------------------------ prison & death

  /** Busted: a night in the cell. Firearms confiscated, half the cash you carry seized. */
  jail(p: Player) {
    const s = p.state;
    const seized = Math.floor(s.money * JAIL_CASH_SEIZED);
    s.money -= seized;
    const lost: string[] = [];
    for (const wpn of WEAPON_ORDER) {
      if (WEAPONS[wpn].melee || !s.weapons.includes(wpn)) continue;
      lost.push(WEAPONS[wpn].name);
      s.ammo[wpn] = 0;
    }
    s.weapons = s.weapons.filter((x) => WEAPONS[x].melee);
    s.weapon = 'fist';
    s.fine = 0;
    this.endStop(p, true);
    this.notoriety(p, NOTORIETY.arrest);
    this.respect(p, RESPECT.arrested);
    this.w.events.push({ type: 'jail', playerId: s.id, seized, lost });
    return seized;
  }

  /**
   * Knocked out: everything you carry falls on the ground where you dropped (cash, your
   * weapons, a mission item). Anyone can grab it, you included if you hurry back.
   */
  onDeath(p: Player, by?: Player) {
    const s = p.state;
    const w = this.w;
    if (s.money > 0) {
      const id = w.newId();
      w.pickups.set(id, { id, x: s.x + 0.5, y: s.y, z: s.z, kind: 'money', amount: s.money });
      s.money = 0;
    }
    let k = 0;
    for (const wpn of [...s.weapons] as WeaponId[]) {
      if (wpn === 'fist') continue;
      const spec = WEAPONS[wpn];
      const id = w.newId();
      const a = (k++ / 3) * Math.PI;
      w.pickups.set(id, { id, x: s.x + Math.cos(a) * 1.2, y: s.y, z: s.z + Math.sin(a) * 1.2, kind: 'weapon', amount: spec.melee ? 0 : s.ammo[wpn], weapon: wpn });
      s.ammo[wpn] = 0;
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
