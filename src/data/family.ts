import { MISSIONS } from './missions';

/**
 * La Famille: the solo story is a climb through a crime family's ranks. Every story
 * mission belongs to a rank (`family` field in missions.ts); finishing all the jobs
 * of your rank promotes you. The rank is derived from the missions you finished, so
 * it needs nothing new in the save and can't drift from it.
 */
export interface Rank {
  name: string;
  icon: string;
  /** What the promotion brings, as shown to the player. */
  perk: string;
  /** Cash handed over on promotion. */
  bonus: number;
  /** Mission and contract rewards multiplier. */
  pay: number;
  /** Bodyguards the Family lends you. */
  guards: number;
  /** "Ta part": cash every PAY_EVERY seconds of play. */
  salary: number;
  /** The Family lawyer: fines and bail multiplier. */
  lawyer: number;
}

export const FAMILY_NAME = 'la Famille Corvi';
export const DON = 'Don Corvi';
/** Seconds of play between two salary payments. */
export const PAY_EVERY = 600;

export const RANKS: Rank[] = [
  { name: 'Inconnu', icon: '·', perk: '', bonus: 0, pay: 1, guards: 0, salary: 0, lawyer: 1 },
  { name: 'Guetteur', icon: '👁', perk: 'Les premiers boulots de la Famille', bonus: 0, pay: 1, guards: 0, salary: 0, lawyer: 1 },
  { name: 'Petite main', icon: '✋', perk: '+10 % sur les missions et contrats', bonus: 1000, pay: 1.1, guards: 0, salary: 0, lawyer: 1 },
  { name: 'Soldat', icon: '🔫', perk: 'Ta part : 250 € toutes les 10 min · +20 % sur les missions', bonus: 2500, pay: 1.2, guards: 0, salary: 250, lawyer: 1 },
  { name: 'Lieutenant', icon: '🎖', perk: 'Un garde du corps te suit · 500 € / 10 min', bonus: 5000, pay: 1.3, guards: 1, salary: 500, lawyer: 1 },
  { name: 'Capo', icon: '💼', perk: 'Deux gardes du corps · l’avocat de la Famille : amendes et cautions -30 %', bonus: 10000, pay: 1.4, guards: 2, salary: 900, lawyer: 0.7 },
  { name: 'Bras droit', icon: '🗡', perk: 'Trois gardes du corps · 1 500 € / 10 min · amendes -50 %', bonus: 20000, pay: 1.5, guards: 3, salary: 1500, lawyer: 0.5 },
  { name: 'Parrain', icon: '👑', perk: 'La ville t’appartient : 3 000 € / 10 min · 4 gardes · +75 % sur les missions', bonus: 50000, pay: 1.75, guards: 4, salary: 3000, lawyer: 0.4 },
];
export const MAX_RANK = RANKS.length - 1;

/** Story missions of a rank (finishing them all promotes you). */
export const jobsOfRank = (rank: number) => MISSIONS.filter((m) => m.family === rank);

/** Rank from the finished missions (the prologue makes you Guetteur). */
export function rankOf(done: readonly string[], prologue: boolean): number {
  if (!prologue && !done.includes('tuto')) return 0;
  let rank = 1;
  while (rank < MAX_RANK) {
    const jobs = jobsOfRank(rank);
    if (!jobs.length || !jobs.every((m) => done.includes(m.id))) break;
    rank++;
  }
  return rank;
}

/** Jobs of your rank done / total (progress towards the next grade). */
export function rankProgress(done: readonly string[], rank: number): { done: number; total: number } {
  const jobs = jobsOfRank(rank);
  return { done: jobs.filter((m) => done.includes(m.id)).length, total: jobs.length };
}
