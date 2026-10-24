/**
 * Your character grows with your level: every stage brings a new power, and from
 * level 15 you can AWAKEN (a short transformation with a golden aura, spiky hair,
 * energy blasts, later a beam and flight). Original names: inspired by the classic
 * martial-arts anime transformations, but no character, name or attack taken from them.
 */

export interface Stage {
  level: number;
  name: string;
  icon: string;
  /** Shown when you reach it. */
  perk: string;
  /** Sprint button gives a speed burst. */
  dash: boolean;
  /** Damage taken (multiplier, stacks with clothes and endurance). */
  toughness: number;
  /** Cars don't throw you around any more, impacts hurt much less. */
  sturdy: boolean;
  /** Awakening available, its length (s) and what it gives. */
  awaken: number;
  beam: boolean;
  flight: boolean;
  /** Aura color while awakened. */
  aura: number;
}

export const STAGES: Stage[] = [
  { level: 1, name: 'Petit nouveau', icon: '🙂', perk: '', dash: false, toughness: 1, sturdy: false, awaken: 0, beam: false, flight: false, aura: 0xffd23f },
  { level: 5, name: 'Nerveux', icon: '💨', perk: 'Appuie sur SPRINT : un bond de vitesse (dash)', dash: true, toughness: 1, sturdy: false, awaken: 0, beam: false, flight: false, aura: 0xffd23f },
  { level: 10, name: 'Costaud', icon: '🪨', perk: 'Les voitures ne te renversent plus, -15 % de dégâts reçus', dash: true, toughness: 0.85, sturdy: true, awaken: 0, beam: false, flight: false, aura: 0xffd23f },
  { level: 15, name: 'Éveillé', icon: '⚡', perk: 'ÉVEIL : transforme-toi (aura dorée, +30 % vitesse et dégâts) et lance des boules d’énergie', dash: true, toughness: 0.8, sturdy: true, awaken: 40, beam: false, flight: false, aura: 0xffd23f },
  { level: 25, name: 'Éveil II', icon: '🔥', perk: 'Éveil plus long, maintiens le bouton d’énergie : le RAYON qui traverse tout', dash: true, toughness: 0.72, sturdy: true, awaken: 60, beam: true, flight: false, aura: 0xffb428 },
  { level: 40, name: 'Éveil ultime', icon: '🌀', perk: 'Pendant l’Éveil tu VOLES (maintiens SAUT), aura bleue', dash: true, toughness: 0.6, sturdy: true, awaken: 90, beam: true, flight: true, aura: 0x6fd8ff },
];

export function stageOf(level: number): number {
  let i = 0;
  while (i + 1 < STAGES.length && level >= STAGES[i + 1].level) i++;
  return i;
}

/** Transformation cinematic length (s): you can't be hurt during it. */
export const AWAKEN_CHARGE = 2.4;
/** Seconds before you can awaken again after it ends. */
export const AWAKEN_COOLDOWN = 75;
/** While awakened. */
export const AWAKEN_SPEED = 1.3;
export const AWAKEN_DAMAGE = 1.3;

/** Dash: burst speed (m/s), length (s) and cooldown (s). */
export const DASH_SPEED = 19;
export const DASH_TIME = 0.22;
export const DASH_COOLDOWN = 2.2;

/** Energy ball: range, blast radius, damage, cooldown. */
export const BALL = { range: 45, radius: 3.2, damage: 70, cooldown: 1.1 };
/** Beam: range, half width, damage, cooldown. */
export const BEAM = { range: 70, width: 1.6, damage: 150, cooldown: 5 };
