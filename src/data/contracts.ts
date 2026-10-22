import { Rng } from '../core/rng';
import type { VehicleType } from './vehicles';

/**
 * Daily contracts: 3 random goals per day, the same for every player (people can
 * compare and team up). They are generated from templates so content never runs out.
 */
export type ContractStat = 'ko' | 'cop' | 'prop' | 'explode' | 'drift' | 'jump' | 'chaos' | 'rob' | 'escape' | 'fence' | 'crate' | 'mission';

interface Template {
  stat: ContractStat;
  /** Goal range. */
  min: number;
  max: number;
  /** Round goals to this step. */
  step?: number;
  text: (n: number) => string;
  /** € and XP per unit of goal. */
  cash: number;
  xp: number;
}

const TEMPLATES: Template[] = [
  { stat: 'ko', min: 5, max: 12, text: (n) => `Mets ${n} passants K.O.`, cash: 60, xp: 8 },
  { stat: 'cop', min: 2, max: 5, text: (n) => `Mets ${n} policiers K.O.`, cash: 180, xp: 25 },
  { stat: 'prop', min: 15, max: 40, step: 5, text: (n) => `Casse ${n} objets dans la rue`, cash: 20, xp: 3 },
  { stat: 'explode', min: 2, max: 5, text: (n) => `Fais exploser ${n} voitures`, cash: 150, xp: 20 },
  { stat: 'drift', min: 8, max: 20, text: (n) => `Dérape pendant ${n} secondes`, cash: 40, xp: 6 },
  { stat: 'jump', min: 2, max: 5, text: (n) => `Réussis ${n} sauts en voiture`, cash: 120, xp: 15 },
  { stat: 'chaos', min: 600, max: 2000, step: 100, text: (n) => `Fais un combo de chaos de ${n}`, cash: 0.8, xp: 0.12 },
  { stat: 'rob', min: 1, max: 3, text: (n) => `Braque ${n} commerce${n > 1 ? 's' : ''}`, cash: 300, xp: 40 },
  { stat: 'escape', min: 1, max: 3, text: (n) => `Sème la police ${n} fois`, cash: 250, xp: 35 },
  { stat: 'fence', min: 1, max: 3, text: (n) => `Livre ${n} voiture${n > 1 ? 's' : ''} commandée${n > 1 ? 's' : ''} au receleur`, cash: 350, xp: 40 },
  { stat: 'crate', min: 2, max: 4, text: (n) => `Trouve ${n} colis surprises`, cash: 150, xp: 20 },
];

export interface Contract {
  stat: ContractStat;
  text: string;
  goal: number;
  progress: number;
  cash: number;
  xp: number;
}

export const CONTRACTS_PER_DAY = 3;
/** Bonus for finishing all of today's contracts. */
export const ALL_CONTRACTS_BONUS = { cash: 1500, xp: 150 };

/** Today's contracts (deterministic: same day → same contracts for everyone). */
export function dailyContracts(day: number): Contract[] {
  const r = new Rng(day * 7919 + 13);
  const pool = [...TEMPLATES];
  const out: Contract[] = [];
  while (out.length < CONTRACTS_PER_DAY && pool.length) {
    const t = pool.splice(r.int(0, pool.length - 1), 1)[0];
    const step = t.step ?? 1;
    const goal = Math.round(r.int(t.min, t.max) / step) * step;
    out.push({ stat: t.stat, text: t.text(goal), goal, progress: 0, cash: Math.round(goal * t.cash), xp: Math.round(goal * t.xp) });
  }
  return out;
}

// ------------------------------------------------------------------ login streak

/** Reward for day k (1..7) of the login streak; day 7 gives an exclusive jacket. */
export const STREAK_REWARDS = [200, 300, 400, 600, 800, 1000, 2500];
export const STREAK_CLOTH = 'jacket_streak';

// ------------------------------------------------------------------ fence (receleur)

/** What the fence pays for the car he ordered (scaled by its condition). */
export const FENCE_PRICES: Partial<Record<VehicleType, number>> = { moto: 500, compact: 700, taxi: 900, wagon: 900, sports: 1600, offroad: 1400 };
/** Any other car goes to the scrapyard. */
export const FENCE_SCRAP = 150;
/** Golden cars (rare in traffic) are worth a fortune. */
export const GOLD_PAINT = 8;
export const GOLD_PRICE = 5000;
export const FENCE_SPOT = { x: -128, z: -62 };
