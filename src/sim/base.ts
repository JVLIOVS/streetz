import { levelOf } from '../data/progression';
import { LOCKER_SIZE, MAX_MODULES, MODULES, TRAINING_COOLDOWN, TRAINING_XP, UPGRADE_PRICE, moduleById, type ModuleDef, type Placed } from '../data/base';
import { GEAR_SLOTS, gearLabel, type GearSlot, type Rarity } from '../data/gear';
import { jobsOfRank } from '../data/family';
import type { InteriorDef } from '../maps/types';
import type { RoomLayout } from './interiors';
import type { ContextAction, Player } from './player';
import type { SimWorld } from './world';

// ---------------------------------------------------------------- pure placement rules (also used by the renderer)

/** Footprint size once rotated. */
export const footprint = (m: ModuleDef, r: number): [number, number] => (r % 2 === 0 ? [m.w, m.d] : [m.d, m.w]);

/** World position of a module's footprint center. */
export function moduleCenter(def: InteriorDef, m: ModuleDef, p: Placed): { x: number; z: number } {
  const [w, d] = footprint(m, p.r);
  return { x: def.origin.x - def.w / 2 + p.x + w / 2, z: def.origin.z - def.d / 2 + p.z + d / 2 };
}

/** Grid cells kept free: the way in, the wardrobe, the garage terminal, the laptop. */
export function reservedCells(def: InteriorDef, room: RoomLayout): Set<number> {
  const out = new Set<number>();
  const x0 = def.origin.x - def.w / 2;
  const z0 = def.origin.z - def.d / 2;
  const keep = (px: number, pz: number, r: number) => {
    for (let x = 0; x < def.w; x++)
      for (let z = 0; z < def.d; z++) if (Math.abs(x0 + x + 0.5 - px) < r && Math.abs(z0 + z + 0.5 - pz) < r) out.add(x * 100 + z);
  };
  keep(room.exit.x, room.exit.z, 2.2);
  keep(room.spawn.x, room.spawn.z, 1.6);
  for (const q of [room.wardrobe, room.garage, room.office]) if (q) keep(q.x, q.z, 1.6);
  // the furniture already built in (wardrobe cabinet, terminal, desk) sits against the walls
  if (room.wardrobe) keep(room.wardrobe.x + 1.1, room.wardrobe.z, 1.6);
  if (room.garage) keep(room.garage.x - 1, room.garage.z, 1.2);
  if (room.office) keep(room.office.x, room.office.z - 1.3, 1.6);
  return out;
}

/** Can module `p` go there (inside, not on reserved cells, not on another module)? */
export function canPlace(def: InteriorDef, room: RoomLayout, base: readonly Placed[], p: Placed, ignore = -1): boolean {
  const m = moduleById(p.m);
  if (!m) return false;
  const [w, d] = footprint(m, p.r);
  if (p.x < 0 || p.z < 0 || p.x + w > def.w || p.z + d > def.d) return false;
  const reserved = reservedCells(def, room);
  for (let x = p.x; x < p.x + w; x++) for (let z = p.z; z < p.z + d; z++) if (reserved.has(x * 100 + z)) return false;
  return base.every((o, i) => {
    if (i === ignore) return true;
    const om = moduleById(o.m);
    if (!om) return true;
    const [ow, od] = footprint(om, o.r);
    return p.x >= o.x + ow || o.x >= p.x + w || p.z >= o.z + od || o.z >= p.z + d;
  });
}

/** The grid cell in front of a position (where the build preview goes). */
export function cellInFront(def: InteriorDef, m: ModuleDef, r: number, x: number, z: number, facing: number): { x: number; z: number } {
  const [w, d] = footprint(m, r);
  const ahead = 1.2 + Math.max(w, d) / 2;
  const cx = x - Math.sin(facing) * ahead - (def.origin.x - def.w / 2);
  const cz = z - Math.cos(facing) * ahead - (def.origin.z - def.d / 2);
  return { x: Math.round(cx - w / 2), z: Math.round(cz - d / 2) };
}

/** Index of the module whose footprint you stand next to (closest center within 1.6 m of its edge). */
export function moduleNear(def: InteriorDef, base: readonly Placed[], x: number, z: number, onlyUseful = false): number {
  let best = -1;
  let bd = Infinity;
  base.forEach((p, i) => {
    const m = moduleById(p.m);
    if (!m || (onlyUseful && !m.use)) return;
    const c = moduleCenter(def, m, p);
    const [w, d] = footprint(m, p.r);
    const dx = Math.max(0, Math.abs(x - c.x) - w / 2);
    const dz = Math.max(0, Math.abs(z - c.z) - d / 2);
    const dist = Math.hypot(dx, dz);
    if (dist < 1.3 && dist < bd) {
      bd = dist;
      best = i;
    }
  });
  return best;
}

// ---------------------------------------------------------------- the system

const USE_LABEL: Record<string, string> = {
  bed: '🛏 Dormir',
  locker: '🧳 Coffre à stuff',
  bench: '🛠 Établi',
  board: '📌 Prochain coup',
  training: '🥊 S’entraîner',
};

/**
 * Building in your hideout and using what you built. The hideout room is shared in
 * multiplayer, so modules have no colliders and each player sees and uses their own.
 */
export class BaseSystem {
  private trained = new Map<string, number>();

  constructor(private w: SimWorld) {}

  private home(p: Player): { def: InteriorDef; room: RoomLayout } | null {
    const s = p.state;
    if (!s.interior) return null;
    const def = this.w.map.interiors.find((i) => i.id === s.interior);
    if (!def || def.kind !== 'hideout') return null;
    return { def, room: this.w.rooms.get(def.id)! };
  }

  /** Context button next to a useful module. */
  context(p: Player): ContextAction | null {
    const h = this.home(p);
    if (!h) return null;
    const s = p.state;
    const i = moduleNear(h.def, s.base, s.x, s.z, true);
    if (i < 0) return null;
    const use = moduleById(s.base[i].m)!.use!;
    if (use === 'safe') return { kind: 'bank', label: `🔐 Mon compte · ${s.bank.toLocaleString('fr-FR')} €`, target: h.def.id };
    if (use === 'locker') return { kind: 'locker', label: USE_LABEL.locker, target: i };
    if (use === 'bench') return { kind: 'bench', label: USE_LABEL.bench, target: i };
    return { kind: 'module', label: USE_LABEL[use], target: i };
  }

  /** Standing next to your safe counts as the bank counter. */
  atSafe(p: Player): boolean {
    const h = this.home(p);
    if (!h) return false;
    const i = moduleNear(h.def, p.state.base, p.state.x, p.state.z, true);
    return i >= 0 && moduleById(p.state.base[i].m)!.use === 'safe';
  }

  /** "Use" on a bed / board / punching bag. */
  use(p: Player, index: number) {
    const s = p.state;
    const placed = s.base[index];
    const m = placed && moduleById(placed.m);
    if (!m?.use || !this.home(p)) return;
    switch (m.use) {
      case 'bed':
        s.health = 100;
        this.w.toast(p, '🛏 Bien dormi : santé au max');
        break;
      case 'board': {
        const rank = this.w.missions.rank(p);
        const job = jobsOfRank(rank).find((j) => !s.missionsDone.includes(j.id)) ?? jobsOfRank(rank + 1)[0];
        const giver = job && this.w.missions.givers.find((g) => g.id === job.id);
        if (!job || !giver) {
          this.w.toast(p, '📌 Plus rien au tableau : la ville est à toi');
          break;
        }
        s.waypoint = [giver.x, giver.z];
        this.w.toast(p, `📌 Prochain coup : « ${job.name} » avec ${job.giver}${job.level && levelOf(s.rep) < job.level ? ` (niveau ${job.level} requis)` : ''} — marqué sur ta carte`);
        break;
      }
      case 'training': {
        const last = this.trained.get(s.id) ?? -1e9;
        const wait = Math.ceil((last + TRAINING_COOLDOWN * 60 - this.w.tick) / 3600);
        if (wait > 0) {
          this.w.toast(p, `🥊 Repose-toi encore ${wait} min`);
          break;
        }
        this.trained.set(s.id, this.w.tick);
        s.action = 'punch';
        s.actionSeq++;
        this.w.progress.addXp(p, TRAINING_XP);
        this.w.toast(p, `🥊 Bonne séance : +${TRAINING_XP} XP`);
        break;
      }
    }
  }

  /** Build commands: `place:<module>:<x>:<z>:<r>`, `remove:<index>`. */
  build(p: Player, arg: string) {
    const h = this.home(p);
    if (!h) return;
    const s = p.state;
    const [op, a, b, c, d] = arg.split(':');
    if (op === 'remove') {
      const i = Number(a);
      const placed = s.base[i];
      if (!Number.isInteger(i) || !placed) return;
      const m = moduleById(placed.m);
      s.base = s.base.filter((_, k) => k !== i);
      // taking a piece down gives its price back (free to rearrange)
      if (m) {
        s.money += m.price;
        this.w.toast(p, `${m.icon} ${m.name} rangé · +${m.price.toLocaleString('fr-FR')} €`);
      }
      return;
    }
    if (op !== 'place') return;
    const m = moduleById(a);
    const placed: Placed = { m: a, x: Math.floor(Number(b)), z: Math.floor(Number(c)), r: ((Math.floor(Number(d)) % 4) + 4) % 4 };
    if (!m || !Number.isFinite(placed.x) || !Number.isFinite(placed.z) || !Number.isFinite(placed.r)) return;
    if (s.base.length >= MAX_MODULES) return this.w.toast(p, `Planque pleine (${MAX_MODULES} éléments)`);
    if (levelOf(s.rep) < m.level) return this.w.toast(p, `🔒 ${m.name} : niveau ${m.level}`);
    if (!canPlace(h.def, h.room, s.base, placed)) return this.w.toast(p, 'Pas de place ici');
    if (!this.w.law.pay(p, m.price)) return this.w.toast(p, `Pas assez d'argent (${m.price.toLocaleString('fr-FR')} €)`);
    s.base = [...s.base, placed];
    this.w.toast(p, `${m.icon} ${m.name} posé`);
  }

  /** Locker: `store:<slot>` (put a worn piece away), `take:<index>` (wear it; the worn one goes in). */
  locker(p: Player, arg: string) {
    const h = this.home(p);
    const s = p.state;
    if (!h || !s.context || s.context.kind !== 'locker') return;
    const [op, a] = arg.split(':');
    if (op === 'store') {
      const slot = a as GearSlot;
      const r = s.gear[slot];
      if (!GEAR_SLOTS.includes(slot) || r === undefined) return;
      if (s.locker.length >= LOCKER_SIZE) return this.w.toast(p, `Coffre plein (${LOCKER_SIZE} pièces)`);
      const { [slot]: _, ...rest } = s.gear;
      s.gear = rest;
      s.locker = [...s.locker, { slot, r }];
      this.w.toast(p, `🧳 ${gearLabel({ slot, r })} rangé`);
    } else if (op === 'take') {
      const i = Number(a);
      const item = s.locker[i];
      if (!Number.isInteger(i) || !item) return;
      const worn = s.gear[item.slot];
      s.locker = s.locker.filter((_, k) => k !== i);
      if (worn !== undefined) s.locker = [...s.locker, { slot: item.slot, r: worn }];
      s.gear = { ...s.gear, [item.slot]: item.r };
      this.w.toast(p, `${gearLabel(item)} porté`);
    }
  }

  /** Workbench: upgrade a worn piece by one rarity. */
  upgrade(p: Player, slot: string) {
    const s = p.state;
    if (!this.home(p) || !s.context || s.context.kind !== 'bench') return;
    const r = s.gear[slot as GearSlot];
    if (!GEAR_SLOTS.includes(slot as GearSlot) || r === undefined || r >= 3) return;
    const price = UPGRADE_PRICE[r];
    if (!this.w.law.pay(p, price)) return this.w.toast(p, `Pas assez d'argent (${price.toLocaleString('fr-FR')} €)`);
    const up = (r + 1) as Rarity;
    s.gear = { ...s.gear, [slot]: up };
    this.w.events.push({ type: 'crate', playerId: s.id, text: `🛠 ${gearLabel({ slot: slot as GearSlot, r: up })}`, rare: up >= 2, pickup: true });
  }

  drop(id: string) {
    this.trained.delete(id);
  }
}

/** For the build catalog: everything, sorted useful first. */
export const CATALOG = [...MODULES].sort((a, b) => Number(!!b.use) - Number(!!a.use));
