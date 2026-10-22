import { DT } from '../core/loop';
import { CHAOS_CASH, CHAOS_MAX_MULT, CHAOS_POINTS, CHAOS_STEP, CHAOS_WINDOW, CHAOS_XP, XP_FOR, levelOf, levelReward, unlocksAt } from '../data/progression';
import type { Ped } from './peds';
import type { Player } from './player';
import type { Vehicle } from './vehicle';
import type { SimWorld } from './world';

/** Per-player scratch for stunt detection (not serialized). */
interface Stunt {
  chain: number;
  drift: number;
  air: number;
}

/**
 * XP, level-ups and the chaos combo: every bit of mayhem feeds a multiplier that is
 * cashed in (money + XP) after a few quiet seconds. Also detects car stunts.
 */
export class ProgressSystem {
  private stunts = new Map<string, Stunt>();

  constructor(private w: SimWorld) {}

  private stunt(id: string) {
    let s = this.stunts.get(id);
    if (!s) this.stunts.set(id, (s = { chain: 0, drift: 0, air: 0 }));
    return s;
  }

  addXp(p: Player, amount: number) {
    const s = p.state;
    if (amount <= 0) return;
    const before = levelOf(s.rep);
    s.rep += Math.round(amount);
    const after = levelOf(s.rep);
    for (let l = before + 1; l <= after; l++) {
      const cash = levelReward(l);
      s.money += cash;
      const unlocks = unlocksAt(l);
      this.w.events.push({ type: 'levelup', playerId: s.id, level: l, unlocks, cash });
      this.w.toast(p, `⭐ NIVEAU ${l} ! +${cash.toLocaleString('fr-FR')} €${unlocks.length ? ` · Débloqué : ${unlocks.join(', ')}` : ''}`);
    }
  }

  /** Adds mayhem to the combo. `label` shows a popup (stunts, big hits). */
  chaos(p: Player, points: number, label?: string) {
    const s = p.state;
    if (s.dead) return;
    const st = this.stunt(s.id);
    st.chain++;
    s.chaosMult = Math.min(CHAOS_MAX_MULT, 1 + Math.floor(st.chain / CHAOS_STEP));
    const gained = points * s.chaosMult;
    s.chaos += gained;
    s.chaosTimer = CHAOS_WINDOW;
    if (label) this.w.events.push({ type: 'chaos', playerId: s.id, label, points: gained });
  }

  /** Arrested or K.O.: the combo is lost. */
  breakCombo(p: Player) {
    const s = p.state;
    if (s.chaos > 0) this.w.events.push({ type: 'chaosEnd', playerId: s.id, score: Math.round(s.chaos), cash: 0, mult: s.chaosMult });
    s.chaos = 0;
    s.chaosMult = 1;
    s.chaosTimer = 0;
    this.stunt(s.id).chain = 0;
  }

  update() {
    for (const p of this.w.players.values()) {
      const s = p.state;
      if (s.dead) {
        if (s.chaos > 0) this.breakCombo(p);
        continue;
      }
      this.stunts1(p);
      if (s.chaosTimer <= 0) continue;
      s.chaosTimer -= DT;
      if (s.chaosTimer > 0) continue;
      // cash in
      const score = Math.round(s.chaos);
      const cash = Math.round(score * CHAOS_CASH);
      s.money += cash;
      this.w.events.push({ type: 'chaosEnd', playerId: s.id, score, cash, mult: s.chaosMult });
      this.w.contracts.track(p, 'chaos', score, true);
      this.addXp(p, score * CHAOS_XP);
      s.chaos = 0;
      s.chaosMult = 1;
      s.chaosTimer = 0;
      this.stunt(s.id).chain = 0;
    }
  }

  /** Car stunts: long drifts and big jumps. */
  private stunts1(p: Player) {
    const s = p.state;
    const st = this.stunt(s.id);
    const v = s.vehicle >= 0 ? this.w.vehicles.get(s.vehicle) : undefined;
    if (!v || v.state.wrecked) {
      st.drift = 0;
      st.air = 0;
      return;
    }
    const vs = v.state;
    // sideways speed = drift
    const fx = -Math.sin(vs.yaw);
    const fz = -Math.cos(vs.yaw);
    const side = Math.abs(vs.vx * fz - vs.vz * fx);
    if (v.grounded && side > 3.2 && Math.abs(vs.speed) > 7) {
      st.drift += DT;
      if (st.drift >= 1) {
        st.drift -= 1;
        this.chaos(p, CHAOS_POINTS.drift, 'DÉRAPAGE');
        this.w.contracts.track(p, 'drift', 1);
      }
    } else st.drift = Math.max(0, st.drift - DT * 2);
    if (!v.grounded) st.air += DT;
    else {
      if (st.air > 0.7) {
        this.chaos(p, Math.round(CHAOS_POINTS.jump * st.air), `SAUT ${st.air.toFixed(1).replace('.', ',')} s`);
        this.w.contracts.track(p, 'jump', 1);
      }
      st.air = 0;
    }
  }

  onKo(p: Player, ped: Ped) {
    const cop = ped.state.role !== 'civ';
    this.chaos(p, cop ? CHAOS_POINTS.cop : CHAOS_POINTS.ko, cop ? 'FLIC K.O.' : 'K.O.');
    this.addXp(p, cop ? XP_FOR.cop : XP_FOR.ko);
    this.w.contracts.track(p, cop ? 'cop' : 'ko', 1);
  }

  onProp(p: Player) {
    this.chaos(p, CHAOS_POINTS.prop);
    this.w.contracts.track(p, 'prop', 1);
  }

  onExplode(p: Player, v: Vehicle) {
    this.chaos(p, v.police ? CHAOS_POINTS.explode * 2 : CHAOS_POINTS.explode, 'BOUM !');
    this.addXp(p, XP_FOR.explode);
    this.w.contracts.track(p, 'explode', 1);
  }

  onHeliDown(p: Player) {
    this.chaos(p, CHAOS_POINTS.heli, 'HÉLICO ABATTU');
    this.addXp(p, XP_FOR.heli);
  }

  onRobbery(p: Player, small: boolean) {
    this.addXp(p, small ? XP_FOR.robbery_shop : XP_FOR.robbery_big);
    this.w.contracts.track(p, 'rob', 1);
  }

  onEscape(p: Player, stars: number) {
    this.addXp(p, XP_FOR.escape * stars);
    this.w.contracts.track(p, 'escape', 1);
  }

  drop(id: string) {
    this.stunts.delete(id);
  }
}
