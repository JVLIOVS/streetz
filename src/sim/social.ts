import { DT } from '../core/loop';
import {
  BOUNTY_BASE,
  BOUNTY_COOLDOWN,
  BOUNTY_MIN_STARS,
  BOUNTY_PER_STAR,
  BOUNTY_TIME,
  CREW_BONUS,
  CREW_NEAR,
  CREW_PRICE,
  cleanCrewName,
  crewColor,
} from '../data/social';
import type { ContextAction, Player } from './player';
import type { SimWorld } from './world';

/**
 * Player-vs-player and crews: bounties on very wanted players (hunters cash them in,
 * survivors double them), crews (tag, no friendly fire, bonus when together).
 */
export class SocialSystem {
  /** Tick until which a player can't get a new bounty. */
  private cooldown = new Map<string, number>();

  constructor(private w: SimWorld) {}

  private all(text: string, except?: string) {
    for (const p of this.w.players.values()) if (p.state.id !== except) this.w.toast(p, text);
  }

  update() {
    const w = this.w;
    const multi = w.players.size > 1;
    for (const p of w.players.values()) {
      const s = p.state;
      if (s.bounty > 0) {
        s.bountyTimer -= DT;
        if (s.bountyTimer <= 0) {
          // survived the hunt
          const prize = s.bounty * 2;
          s.money += prize;
          w.events.push({ type: 'money', playerId: s.id, amount: prize });
          w.progress.addXp(p, 150);
          this.all(`🎯 ${s.name} a survécu à la chasse et empoche ${prize.toLocaleString('fr-FR')} € !`);
          this.endBounty(p);
        }
        continue;
      }
      if (!multi || s.dead || s.wanted < BOUNTY_MIN_STARS || w.tick < (this.cooldown.get(s.id) ?? 0)) continue;
      s.bounty = BOUNTY_BASE + BOUNTY_PER_STAR * (s.wanted - BOUNTY_MIN_STARS);
      s.bountyTimer = BOUNTY_TIME;
      w.events.push({ type: 'bounty', playerId: s.id, amount: s.bounty });
      this.w.toast(p, `🎯 Ta tête est mise à prix : ${s.bounty.toLocaleString('fr-FR')} €. Survis 3 min pour toucher le double !`);
      this.all(`🎯 PRIME : ${s.name} vaut ${s.bounty.toLocaleString('fr-FR')} € — mets-le K.O. !`, s.id);
    }
  }

  private endBounty(p: Player) {
    p.state.bounty = 0;
    p.state.bountyTimer = 0;
    this.cooldown.set(p.state.id, this.w.tick + BOUNTY_COOLDOWN * 60);
  }

  /** Crewmates can't hurt each other. */
  friendly(a: Player, b: Player) {
    return !!a.state.crew && !!b.state.crew && a.state.crew.name === b.state.crew.name;
  }

  /** A player knocked out another one. */
  onPlayerKo(victim: Player, by: Player) {
    const v = victim.state;
    const s = by.state;
    s.week.pvp++;
    this.w.progress.chaos(by, 150, 'JOUEUR K.O.');
    this.w.progress.addXp(by, 40);
    if (v.bounty > 0) {
      const prize = v.bounty;
      s.money += prize;
      s.week.bounties++;
      this.w.events.push({ type: 'money', playerId: s.id, amount: prize });
      this.w.progress.addXp(by, 200);
      this.all(`🎯 ${s.name} a encaissé la prime sur ${v.name} : ${prize.toLocaleString('fr-FR')} € !`);
      this.endBounty(victim);
    }
  }

  /** Chaos cash-in bonus when a crewmate is close. */
  crewBonus(p: Player): number {
    const s = p.state;
    if (!s.crew) return 1;
    for (const o of this.w.players.values()) {
      if (o !== p && !o.state.dead && this.friendly(p, o) && Math.hypot(o.state.x - s.x, o.state.z - s.z) < CREW_NEAR) return CREW_BONUS;
    }
    return 1;
  }

  /** "Join [CREW]" when standing next to a player who has one. */
  context(p: Player): ContextAction | null {
    const s = p.state;
    if (s.crew) return null;
    for (const o of this.w.players.values()) {
      const os = o.state;
      if (o === p || !os.crew || os.dead || os.interior !== s.interior || Math.hypot(os.x - s.x, os.z - s.z) > 2.6) continue;
      return { kind: 'crew_join', label: `Rejoindre [${os.crew.name}]`, target: os.id };
    }
    return null;
  }

  /** `create:NAME`, `join:<playerId>` or `leave`. */
  crew(p: Player, arg: string) {
    const s = p.state;
    const [cmd, rest = ''] = arg.split(/:(.*)/s);
    if (cmd === 'create') {
      const name = cleanCrewName(rest);
      if (!name) return this.w.toast(p, 'Nom de crew : 2 à 12 lettres ou chiffres');
      if (s.money < CREW_PRICE) return this.w.toast(p, `Il faut ${CREW_PRICE} € pour fonder un crew`);
      s.money -= CREW_PRICE;
      s.crew = { name, color: crewColor(name) };
      this.w.toast(p, `Crew [${name}] fondé ! Les autres joueurs peuvent le rejoindre en venant te voir.`);
    } else if (cmd === 'join') {
      const o = this.w.players.get(rest);
      if (!o?.state.crew || s.crew || Math.hypot(o.state.x - s.x, o.state.z - s.z) > 4) return;
      s.crew = { ...o.state.crew };
      this.w.toast(p, `Bienvenue dans [${s.crew.name}] : pas de tirs entre vous, +25 % de chaos ensemble`);
      this.w.toast(o, `${s.name} a rejoint ton crew [${s.crew.name}] !`);
    } else if (cmd === 'leave' && s.crew) {
      this.w.toast(p, `Tu as quitté [${s.crew.name}]`);
      s.crew = null;
    }
  }

  drop(id: string) {
    this.cooldown.delete(id);
  }
}
