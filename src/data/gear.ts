/**
 * Gear ("le stuff"): you spawn in your underwear and dress up with what you find:
 * on the ground, on people you knock out, in crates and rooftop stashes, or at the
 * clothes shop. Every piece has a slot and a rarity; knocked out, you lose it all
 * (it stays where you fell, like your cash and weapons).
 *
 * The wardrobe outfits (src/data/shop.ts) stay cosmetic: they set the colors and
 * style of the pieces you wear. No gear in a slot = bare skin there.
 */

export type GearSlot = 'head' | 'top' | 'legs' | 'feet' | 'hands' | 'vest' | 'bag';
export const GEAR_SLOTS: GearSlot[] = ['head', 'top', 'legs', 'feet', 'hands', 'vest', 'bag'];

/** 0 commun · 1 rare · 2 épique · 3 légendaire */
export type Rarity = 0 | 1 | 2 | 3;
export const RARITY = [
  { name: 'Commun', color: '#b8b5c8', hex: 0xb8b5c8 },
  { name: 'Rare', color: '#3fa7ff', hex: 0x3fa7ff },
  { name: 'Épique', color: '#b56cff', hex: 0xb56cff },
  { name: 'Légendaire', color: '#ffb428', hex: 0xffb428 },
] as const;

export interface GearDef {
  slot: GearSlot;
  name: string;
  icon: string;
  /** What the stat means, with `{v}` replaced by the value for a rarity. */
  stat: string;
  /** Stat value by rarity (meaning depends on the slot, see below). */
  values: [number, number, number, number];
  /** Look of the piece when no wardrobe outfit overrides it. */
  color: number;
}

/**
 * head/top/legs: % of damage taken removed · feet: % running speed · hands: % melee damage
 * vest: armor points · bag: % of your cash kept when you are knocked out
 */
export const GEAR: Record<GearSlot, GearDef> = {
  head: { slot: 'head', name: 'Casquette', icon: '🧢', stat: '-{v} % de dégâts', values: [3, 5, 7, 10], color: 0x222831 },
  top: { slot: 'top', name: 'Sweat', icon: '👕', stat: '-{v} % de dégâts', values: [4, 7, 10, 14], color: 0x4a5568 },
  legs: { slot: 'legs', name: 'Pantalon', icon: '👖', stat: '-{v} % de dégâts', values: [3, 5, 7, 10], color: 0x2f4f8f },
  feet: { slot: 'feet', name: 'Baskets', icon: '👟', stat: '+{v} % de vitesse', values: [4, 7, 10, 14], color: 0xf5f5f5 },
  hands: { slot: 'hands', name: 'Gants', icon: '🧤', stat: '+{v} % de dégâts au corps à corps', values: [6, 12, 18, 26], color: 0x111111 },
  vest: { slot: 'vest', name: 'Gilet pare-balles', icon: '🦺', stat: '{v} points d’armure', values: [25, 50, 75, 100], color: 0x3d4a2f },
  bag: { slot: 'bag', name: 'Sacoche', icon: '👜', stat: 'garde {v} % de ton cash si tu tombes', values: [15, 30, 45, 60], color: 0x6b4423 },
};

/** Fancier names by rarity, so a legendary piece feels like one. */
const NAMES: Record<GearSlot, [string, string, string, string]> = {
  head: ['Casquette', 'Bob de marque', 'Casque de moto', 'Couronne de rue'],
  top: ['T-shirt', 'Sweat à capuche', 'Blouson en cuir', 'Veste en vison'],
  legs: ['Jogging', 'Jean renforcé', 'Cargo tactique', 'Pantalon en kevlar'],
  feet: ['Claquettes', 'Baskets', 'Runners pro', 'Sneakers dorées'],
  hands: ['Mitaines', 'Gants de boxe', 'Poing américain', 'Gants en acier'],
  vest: ['Gilet léger', 'Gilet pare-balles', 'Plaque lourde', 'Armure du Parrain'],
  bag: ['Banane', 'Sacoche', 'Sac à dos', 'Valise blindée'],
};

export interface GearItem {
  slot: GearSlot;
  r: Rarity;
}
export type Gear = Partial<Record<GearSlot, Rarity>>;

export const gearName = (g: GearItem) => NAMES[g.slot][g.r];
export const gearValue = (g: GearItem) => GEAR[g.slot].values[g.r];
export const gearStat = (g: GearItem) => GEAR[g.slot].stat.replace('{v}', String(gearValue(g)));
export const gearLabel = (g: GearItem) => `${GEAR[g.slot].icon} ${gearName(g)} (${RARITY[g.r].name})`;

/** Total damage reduction from clothes (head + top + legs), as a factor (0.69 = -31 %). */
export function defenseFactor(gear: Gear): number {
  let pct = 0;
  for (const slot of ['head', 'top', 'legs'] as const) if (gear[slot] !== undefined) pct += GEAR[slot].values[gear[slot]!];
  return 1 - Math.min(40, pct) / 100;
}
export const speedBonus = (gear: Gear) => (gear.feet !== undefined ? GEAR.feet.values[gear.feet] / 100 : 0);
export const meleeBonus = (gear: Gear) => (gear.hands !== undefined ? GEAR.hands.values[gear.hands] / 100 : 0);
export const vestArmor = (gear: Gear) => (gear.vest !== undefined ? GEAR.vest.values[gear.vest] : 0);
export const bagKeeps = (gear: Gear) => (gear.bag !== undefined ? GEAR.bag.values[gear.bag] / 100 : 0);

/** Rarity roll: `luck` 0 (street) … 1 (rooftop stash, boss). */
export function rollRarity(rnd: () => number, luck = 0): Rarity {
  const x = rnd() * (1 - luck * 0.6);
  return x < 0.03 ? 3 : x < 0.13 ? 2 : x < 0.4 ? 1 : 0;
}

/** First things to find: the starter slots appear more often on the ground. */
export function rollSlot(rnd: () => number): GearSlot {
  const weights: [GearSlot, number][] = [
    ['legs', 4],
    ['feet', 4],
    ['top', 4],
    ['head', 2],
    ['vest', 2],
    ['hands', 2],
    ['bag', 2],
  ];
  let x = rnd() * weights.reduce((a, [, w]) => a + w, 0);
  for (const [slot, w] of weights) if ((x -= w) < 0) return slot;
  return 'legs';
}

/** Common pieces sold at the clothes shop (a quick way to get dressed). */
export const GEAR_PRICES: Record<GearSlot, number> = { head: 120, top: 180, legs: 160, feet: 200, hands: 300, vest: 900, bag: 400 };

/** Ground loot spawned around each player: a few pieces always within reach. */
export const GROUND_GEAR_PER_PLAYER = 7;
/** Chance that someone you knock out drops a piece of clothing. */
export const PED_GEAR_DROP = 0.3;
