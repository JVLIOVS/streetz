/**
 * Crew jobs ("opérations"): anybody can launch one, for their crew (every member online
 * joins) or open to everybody in the game. They are generated around the launcher, so
 * they can be played again and again. Rewards are paid to each member at the end.
 */

export type OpKind = 'rue' | 'convoi' | 'razzia' | 'cible';

export interface OpDef {
  kind: OpKind;
  name: string;
  icon: string;
  pitch: string;
  /** Paid to every member (before the Family / crew bonuses). */
  reward: number;
  xp: number;
}

export const OPS: OpDef[] = [
  { kind: 'rue', name: 'Guerre de rue', icon: '🥊', pitch: 'Une bande rivale tient un coin de rue : mettez-les tous K.O.', reward: 1200, xp: 150 },
  { kind: 'convoi', name: 'Convoi blindé', icon: '🚐', pitch: 'Un 4×4 blindé transporte du cash : arrêtez-le, détruisez-le', reward: 1800, xp: 200 },
  { kind: 'razzia', name: 'Razzia', icon: '🏪', pitch: 'Braquez 2 supérettes avant que le quartier ne se réveille', reward: 1500, xp: 180 },
  { kind: 'cible', name: 'Le contrat', icon: '🎯', pitch: 'Un caïd se promène avec ses gardes : mettez-le K.O.', reward: 2000, xp: 220 },
];

export const opByKind = (k: string) => OPS.find((o) => o.kind === k);

/** Seconds to finish a job. */
export const OP_TIME = 300;
/** Level needed to launch one (anybody can join). */
export const OP_LEVEL = 3;
/** Seconds between two jobs launched by the same player. */
export const OP_COOLDOWN = 90;
/** An open job invitation stays on screen this long (s). */
export const OP_INVITE = 25;
/** Crew jobs pay this much more (you came together). */
export const OP_CREW_BONUS = 1.25;
