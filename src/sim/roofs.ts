import { gearLabel, rollRarity, rollSlot, type Rarity } from '../data/gear';
import { Rng } from '../core/rng';
import { WEAPONS, type WeaponId } from '../data/weapons';
import type { ContextAction, Player } from './player';
import type { SimWorld } from './world';

/** Rooftops: stashes to loot (some already emptied) and paying sniper spots. */
export const ROOF_CHESTS = 60;
/** Loose loot (cash, clothes) kept on the roofs around each player. */
export const ROOF_LOOT = 6;
export const SNIPER_SPOTS = 6;
export const SNIPER_PRICE = 300;
/** A looted stash fills up again after this many seconds. */
export const CHEST_REFILL = 600;
/** Highest roof a fully charged super jump reaches from the street. */
export const MAX_ROOF = 22.5;

export interface Chest {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Tick when it is full again (0 = full now). */
  refill: number;
}

/**
 * Stashes hidden on reachable roofs and a few sniper spots on the tallest of them.
 * Positions come from the map seed (same on every device).
 */
export class RoofSystem {
  readonly chests: Chest[] = [];
  readonly spots: { x: number; y: number; z: number }[] = [];
  /** Who rents a sniper rifle, at which spot. */
  private rentals = new Map<string, number>();
  /** Every reachable roof (loot appears on them). */
  private roofs: { x: number; z: number; y: number; w: number; d: number }[] = [];

  constructor(private w: SimWorld) {
    const r = new Rng(w.map.seed ^ 0x700f);
    const roofs = w.map.buildings
      .map((b) => ({ x: b.x, z: b.z, y: b.h + b.roofH, w: b.w, d: b.d }))
      .filter((b) => b.y > 8 && b.y <= MAX_ROOF && b.w >= 8 && b.d >= 8 && Math.abs(b.x) < 470 && Math.abs(b.z) < 470);
    // sniper spots: the tallest reachable roofs, spread out over the district
    for (const b of [...roofs].sort((a, c) => c.y - a.y)) {
      if (this.spots.length >= SNIPER_SPOTS) break;
      if (this.spots.some((q) => Math.hypot(q.x - b.x, q.z - b.z) < 150)) continue;
      this.spots.push({ x: b.x, y: b.y, z: b.z });
    }
    this.roofs = roofs;
    const rest = roofs.filter((b) => !this.spots.some((q) => q.x === b.x && q.z === b.z));
    for (let i = 0; i < ROOF_CHESTS && rest.length; i++) {
      const b = rest.splice(r.int(0, rest.length - 1), 1)[0];
      // somewhere on the roof, away from the edge; about a third are already looted
      const x = b.x + r.range(-0.25, 0.25) * b.w;
      const z = b.z + r.range(-0.25, 0.25) * b.d;
      this.chests.push({ id: i, x, y: b.y, z, refill: r.chance(0.35) ? 1 : 0 });
    }
  }

  context(p: Player): ContextAction | null {
    const s = p.state;
    if (s.vehicle >= 0 || s.interior) return null;
    for (const c of this.chests) {
      if (Math.abs(s.y - c.y) < 1.6 && Math.hypot(c.x - s.x, c.z - s.z) < 1.8) return { kind: 'chest', label: 'Fouiller la cache', target: c.id };
    }
    for (let i = 0; i < this.spots.length; i++) {
      const q = this.spots[i];
      if (Math.abs(s.y - q.y) < 1.6 && Math.hypot(q.x - s.x, q.z - s.z) < 3 && this.rentals.get(s.id) !== i) {
        return { kind: 'sniper', label: `Fusil de précision · ${SNIPER_PRICE} €`, target: i };
      }
    }
    return null;
  }

  /** Open a stash: sometimes empty, sometimes a good deal. */
  open(p: Player, id: number) {
    const s = p.state;
    const w = this.w;
    const c = this.chests[id];
    if (!c || Math.hypot(c.x - s.x, c.z - s.z) > 2.5 || Math.abs(s.y - c.y) > 2) return;
    if (c.refill > 0 && w.tick < c.refill) {
      w.toast(p, '🗄 Déjà pillée… Reviens plus tard');
      return;
    }
    c.refill = w.tick + CHEST_REFILL * 60;
    w.contracts.track(p, 'crate', 1);
    w.progress.addXp(p, 20);
    const roll = w.rng.next();
    let text: string;
    if (roll < 0.25) text = 'Vide. Quelqu’un est passé avant toi';
    else if (roll < 0.6) {
      const n = w.rng.chance(0.15) ? w.rng.int(2000, 4000) : w.rng.int(300, 1200);
      s.money += n;
      w.events.push({ type: 'money', playerId: s.id, amount: n });
      text = `Une liasse : +${n.toLocaleString('fr-FR')} €`;
    } else if (roll < 0.8) {
      // rooftop finds are the good stuff: rare or better
      const g = { slot: rollSlot(() => w.rng.next()), r: Math.max(1, rollRarity(() => w.rng.next(), 0.8)) as Rarity };
      if (!w.equipGear(p, g)) w.dropGear(s.x + 0.6, s.y, s.z, g);
      text = `${gearLabel(g)} !`;
    } else {
      const options: WeaponId[] = ['pistol', 'smg', 'shotgun', 'rifle'];
      const wpn = options[w.rng.int(0, options.length - 1)];
      if (!s.weapons.includes(wpn)) s.weapons.push(wpn);
      s.ammo[wpn] += WEAPONS[wpn].ammoPack;
      text = `${WEAPONS[wpn].icon} ${WEAPONS[wpn].name} + munitions`;
    }
    w.events.push({ type: 'crate', playerId: s.id, text: `Cache du toit : ${text}`, rare: roll >= 0.75, pickup: true });
  }

  /** Rent the sniper rifle for as long as you stay on this roof. */
  rent(p: Player, spot: number) {
    const s = p.state;
    const q = this.spots[spot];
    if (!q || Math.hypot(q.x - s.x, q.z - s.z) > 4 || Math.abs(s.y - q.y) > 2) return;
    if (!this.w.law.pay(p, SNIPER_PRICE)) {
      this.w.toast(p, `Il faut ${SNIPER_PRICE} €`);
      return;
    }
    if (!s.weapons.includes('sniper')) s.weapons.push('sniper');
    s.ammo.sniper = WEAPONS.sniper.ammoPack;
    s.weapon = 'sniper';
    this.rentals.set(s.id, spot);
    this.w.toast(p, '🔭 Fusil de précision : 12 balles, portée énorme. Il reste sur ce toit.');
  }

  /** Keeps a few bundles of cash and pieces of clothing on the roofs around each player. */
  private loot() {
    const w = this.w;
    for (const p of w.players.values()) {
      const s = p.state;
      if (s.interior || s.dead) continue;
      let n = 0;
      for (const pk of w.pickups.values()) if (pk.roof && Math.hypot(pk.x - s.x, pk.z - s.z) < 150) n++;
      if (n >= ROOF_LOOT) continue;
      const near = this.roofs.filter((b) => {
        const d = Math.hypot(b.x - s.x, b.z - s.z);
        return d > 25 && d < 140;
      });
      if (!near.length) continue;
      const b = near[w.rng.int(0, near.length - 1)];
      const x = b.x + w.rng.range(-0.3, 0.3) * b.w;
      const z = b.z + w.rng.range(-0.3, 0.3) * b.d;
      const id = w.newId();
      if (w.rng.chance(0.45)) w.pickups.set(id, { id, x, y: b.y, z, kind: 'money', amount: w.rng.int(150, 600), roof: true });
      else w.pickups.set(id, { id, x, y: b.y, z, kind: 'gear', amount: 0, gear: { slot: rollSlot(() => w.rng.next()), r: rollRarity(() => w.rng.next(), 0.5) }, roof: true });
    }
  }

  update() {
    if (this.w.tick % 300 === 0) this.loot();
    if (this.w.tick % 15 !== 0) return;
    for (const [id, spot] of this.rentals) {
      const p = this.w.players.get(id);
      const q = this.spots[spot];
      const s = p?.state;
      if (s && !s.dead && Math.hypot(q.x - s.x, q.z - s.z) < 30 && s.y > q.y - 3) continue;
      this.rentals.delete(id);
      if (!s) continue;
      s.weapons = s.weapons.filter((x) => x !== 'sniper');
      s.ammo.sniper = 0;
      if (s.weapon === 'sniper') s.weapon = 'fist';
      this.w.toast(p!, '🔭 Fusil de précision rendu (tu as quitté le toit)');
    }
  }

  drop(id: string) {
    this.rentals.delete(id);
  }
}
