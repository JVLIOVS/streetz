/**
 * Player progression: XP (saved as `rep`), levels 1–100 and what each level unlocks.
 * Everything a level gates is listed here so the shop, the HUD and the sim agree.
 */

export const MAX_LEVEL = 100;
/** New players start with the first bar already a quarter full (endowed progress). */
export const START_XP = 30;

/** XP needed to go from `level` to `level + 1`. */
export const xpToNext = (level: number) => 80 + 40 * level;

export function levelOf(xp: number): number {
  let level = 1;
  let need = xpToNext(1);
  while (level < MAX_LEVEL && xp >= need) {
    xp -= need;
    level++;
    need = xpToNext(level);
  }
  return level;
}

/** Progress inside the current level: XP earned in it and XP the level needs. */
export function levelProgress(xp: number): { level: number; cur: number; need: number } {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level++;
  }
  return { level, cur: xp, need: xpToNext(level) };
}

/** Cash bonus when reaching `level`. */
export const levelReward = (level: number) => 150 + 50 * level;

/** Item keys use the same syntax as the `buy` command: weapon:x, armor, car:x, home:x, biz:x, cloth:x. */
export const UNLOCKS: { level: number; item: string; label: string }[] = [
  { level: 2, item: 'weapon:baton', label: 'Matraque' },
  { level: 2, item: 'car:moto', label: 'Scooter (concession)' },
  { level: 3, item: 'weapon:bat', label: 'Batte de baseball' },
  { level: 3, item: 'car:compact', label: 'Citadine (concession)' },
  { level: 4, item: 'weapon:pistol', label: 'Pistolet' },
  { level: 4, item: 'cloth:cap_gold', label: 'Casquette dorée' },
  { level: 5, item: 'armor', label: 'Gilet pare-balles' },
  { level: 5, item: 'biz:atelier', label: 'Business : atelier de pièces' },
  { level: 6, item: 'car:wagon', label: 'Break (concession)' },
  { level: 6, item: 'cloth:leather', label: 'Veste en cuir' },
  { level: 6, item: 'weapon:sabre', label: 'Sabre' },
  { level: 8, item: 'weapon:shotgun', label: 'Fusil à pompe' },
  { level: 8, item: 'cloth:tee_gold', label: 'Maillot doré' },
  { level: 9, item: 'home:apartment_rive', label: 'Appartement Résidence de la Rive' },
  { level: 9, item: 'weapon:chainsaw', label: 'Tronçonneuse' },
  { level: 10, item: 'car:offroad', label: '4×4 (concession)' },
  { level: 10, item: 'item:jetpack', label: 'Jetpack (concession)' },
  { level: 11, item: 'weapon:smg', label: 'Mitraillette' },
  { level: 12, item: 'weapon:flamer', label: 'Lance-flammes' },
  { level: 12, item: 'biz:imprimerie', label: 'Business : imprimerie de faux billets' },
  { level: 14, item: 'car:sports', label: 'Berline sport (concession)' },
  { level: 15, item: 'car:minicopter', label: 'Mini-hélico (concession)' },
  { level: 16, item: 'weapon:rifle', label: "Fusil d'assaut" },
  { level: 18, item: 'home:apartment_loft', label: 'Loft des Buttes' },
  { level: 20, item: 'biz:garage', label: 'Business : garage clandestin' },
];

/** Level needed for a shop item (1 when not gated). */
export function requiredLevel(item: string): number {
  return UNLOCKS.find((u) => u.item === item)?.level ?? 1;
}

/** What `level` unlocks (labels), for the level-up toast. */
export const unlocksAt = (level: number) => UNLOCKS.filter((u) => u.level === level).map((u) => u.label);

/** Next unlock after `level` (the "next goal" shown on the HUD). */
export const nextUnlock = (level: number) => UNLOCKS.find((u) => u.level > level);

// ------------------------------------------------------------------ chaos combo

/** Seconds without mayhem before the combo is cashed in. */
export const CHAOS_WINDOW = 4.5;
/** Events needed per multiplier step (×1 → ×5). */
export const CHAOS_STEP = 4;
export const CHAOS_MAX_MULT = 5;
/** Cash-in: € and XP per chaos point. */
export const CHAOS_CASH = 0.5;
export const CHAOS_XP = 0.12;

/** Chaos points (and XP for single actions) per kind of mayhem. */
export const CHAOS_POINTS = {
  hit: 5,
  ko: 40,
  cop: 90,
  prop: 15,
  explode: 120,
  heli: 500,
  drift: 30,
  jump: 60,
  near: 25,
} as const;

export const XP_FOR = {
  ko: 12,
  cop: 30,
  explode: 20,
  heli: 150,
  robbery_shop: 40,
  robbery_big: 120,
  escape: 50,
} as const;
