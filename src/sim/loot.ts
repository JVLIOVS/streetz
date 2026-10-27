import { DT } from '../core/loop';
import { rollRarity, rollSlot } from '../data/gear';
import { WEAPONS, type WeaponId } from '../data/weapons';
import type { LootKind } from './interiors';
import type { ContextAction, Player } from './player';
import type { SimWorld } from './world';

interface LootRule {
  label: string;
  /** Seconds to grab / crack it (stay close). */
  time: number;
  /** Stars it brings (the clerk / the officers see you). */
  wanted: number;
}

const RULES: Record<LootKind, LootRule> = {
  register: { label: '💵 Vider la caisse', time: 1.5, wanted: 1 },
  safe: { label: '🔐 Forcer le coffre', time: 6, wanted: 2 },
  shelf: { label: '🛒 Se servir', time: 1, wanted: 1 },
  case: { label: '💎 Casser la vitrine', time: 1.5, wanted: 2 },
  ammo: { label: '📦 Voler des munitions', time: 2.5, wanted: 2 },
  rack: { label: '👕 Piquer des fringues', time: 1.5, wanted: 1 },
  armory: { label: '🔫 Forcer l’armurerie', time: 8, wanted: 4 },
  evidence: { label: '🗄 Coffre des scellés', time: 7, wanted: 3 },
  boxes: { label: '🏦 Coffres de dépôt', time: 5, wanted: 3 },
};

/** A looted spot is empty for this long (seconds). */
export const LOOT_REFILL = 480;

/**
 * Things to grab inside buildings: the shop register and its back-room safe, jewelry
 * display cases, bank deposit boxes, the gunshop's ammo, clothes racks, and at the
 * police station the armory and the evidence safe. Each one takes a few seconds next
 * to it and brings the police.
 */
export class LootSystem {
  /** `${room}:${index}` → tick when it is full again. */
  private empty = new Map<string, number>();
  private busy = new Map<string, { room: string; i: number; t: number }>();

  constructor(private w: SimWorld) {}

  private spot(room: string, i: number) {
    return this.w.rooms.get(room)?.loot[i];
  }

  context(p: Player): ContextAction | null {
    const s = p.state;
    if (!s.interior) return null;
    const room = this.w.rooms.get(s.interior);
    if (!room) return null;
    for (let i = 0; i < room.loot.length; i++) {
      const l = room.loot[i];
      if (Math.hypot(l.x - s.x, l.z - s.z) > 1.4) continue;
      const left = (this.empty.get(`${s.interior}:${i}`) ?? 0) - this.w.tick;
      return { kind: 'loot', label: left > 0 ? `Vide (${Math.ceil(left / 3600)} min)` : RULES[l.kind].label, target: i };
    }
    return null;
  }

  /** "Use" next to a loot spot: start grabbing / cracking it. */
  start(p: Player, i: number) {
    const s = p.state;
    const l = s.interior ? this.spot(s.interior, i) : undefined;
    if (!l || this.busy.has(s.id)) return;
    const key = `${s.interior}:${i}`;
    if ((this.empty.get(key) ?? 0) > this.w.tick) return this.w.toast(p, 'Déjà vidé… reviens plus tard');
    this.busy.set(s.id, { room: s.interior!, i, t: 0 });
    s.action = 'interact';
    s.actionSeq++;
    // the alarm goes off right away (everybody inside saw you)
    this.w.raiseWanted(p, RULES[l.kind].wanted);
  }

  update() {
    for (const [id, b] of this.busy) {
      const p = this.w.players.get(id);
      const l = this.spot(b.room, b.i);
      const s = p?.state;
      if (!p || !s || !l || s.dead || s.interior !== b.room || Math.hypot(l.x - s.x, l.z - s.z) > 2.2) {
        this.busy.delete(id);
        if (p && s && !s.dead) {
          s.robbery = -1;
          this.w.toast(p, 'Interrompu !');
        }
        continue;
      }
      const rule = RULES[l.kind];
      b.t += DT;
      s.robbery = Math.min(1, b.t / rule.time);
      if (b.t < rule.time) continue;
      this.busy.delete(id);
      s.robbery = -1;
      this.empty.set(`${b.room}:${b.i}`, this.w.tick + LOOT_REFILL * 60);
      this.reward(p, l.kind);
    }
  }

  private cash(p: Player, lo: number, hi: number, what: string) {
    const n = this.w.rng.int(lo, hi);
    p.state.money += n;
    this.w.events.push({ type: 'money', playerId: p.state.id, amount: n });
    this.w.toast(p, `${what} : +${n.toLocaleString('fr-FR')} €`);
  }

  private gun(p: Player, options: WeaponId[]) {
    const s = p.state;
    const w = options[this.w.rng.int(0, options.length - 1)];
    const fresh = !s.weapons.includes(w);
    if (fresh) s.weapons.push(w);
    s.ammo[w] += WEAPONS[w].ammoPack;
    this.w.events.push({ type: 'crate', playerId: s.id, text: `${WEAPONS[w].icon} ${WEAPONS[w].name}${fresh ? '' : ''} + ${WEAPONS[w].ammoPack} balles`, rare: fresh, pickup: true });
  }

  private reward(p: Player, kind: LootKind) {
    const w = this.w;
    const s = p.state;
    w.progress.addXp(p, kind === 'armory' || kind === 'evidence' ? 80 : kind === 'safe' || kind === 'boxes' ? 40 : 10);
    switch (kind) {
      case 'register':
        return this.cash(p, 90, 260, '💵 La caisse');
      case 'safe':
        return this.cash(p, 600, 1500, '🔐 Le coffre');
      case 'shelf':
        s.health = Math.min(100, s.health + 30);
        return w.toast(p, '🥤 Snacks et boissons : +30 santé');
      case 'case':
        return this.cash(p, 450, 1000, '💎 Bijoux revendus');
      case 'boxes':
        return this.cash(p, 1200, 2800, '🏦 Coffres de dépôt');
      case 'evidence':
        return this.cash(p, 1800, 3500, '🗄 Liasses saisies');
      case 'ammo': {
        const guns = s.weapons.filter((x) => !WEAPONS[x].melee);
        if (!guns.length) return this.gun(p, ['pistol']);
        for (const g of guns) s.ammo[g] += WEAPONS[g].ammoPack;
        return w.toast(p, '📦 Munitions pour toutes tes armes');
      }
      case 'armory':
        return this.gun(p, ['smg', 'shotgun', 'rifle']);
      case 'rack': {
        const g = { slot: rollSlot(() => w.rng.next()), r: rollRarity(() => w.rng.next(), 0.3) };
        if (!w.equipGear(p, g)) w.dropGear(s.x, s.y, s.z + 0.5, g);
        return;
      }
    }
  }

  drop(id: string) {
    this.busy.delete(id);
  }
}
