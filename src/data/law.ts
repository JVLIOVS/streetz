/**
 * Consequences of your actions: fines, criminal record, respect, prison and the bank.
 * Every number that balances "crime pays / crime costs" lives here.
 */

/** Fines for minor offences, by how many you already paid. After the 5th: no more fines, they hunt you. */
export const FINE_PRICES = [150, 300, 600, 1200, 2500];
export const MAX_FINES = FINE_PRICES.length;
/** Minor offences that get a fine instead of a chase (while you have fines left). */
export const MINOR_CRIMES = ['assault', 'carjack', 'hit_and_run'] as const;
/** Seconds the officer waits for you to pay before it turns into a chase. */
export const FINE_WAIT = 25;
/** Walk away this far from the officer = refusal. */
export const FINE_REFUSE_DIST = 18;

/** Criminal record (0–100): grows with crimes, slowly fades (points per minute). */
export const NOTORIETY = {
  koCiv: 1,
  koCop: 3,
  robbery: 5,
  bigRobbery: 10,
  fine: 3,
  arrest: 5,
  star: 2,
  decayPerMin: 1,
  /** From here the police stops you for random checks. */
  checks: 30,
  /** From here passers-by keep away from you. */
  feared: 50,
};
/** Seconds between two random police checks (min, max). */
export const CHECK_EVERY: [number, number] = [150, 300];

/** Respect: earned by doing big things, lost by getting beaten or arrested. */
export const RESPECT = {
  pvpKo: 10,
  bounty: 25,
  heist: 30,
  mission: 10,
  koCop: 2,
  bigCombo: 3,
  koByPlayer: -5,
  arrested: -5,
  /** XP bonus: +100 % at this much respect. */
  xpFull: 1000,
  /** From here, tough guys don't dare fight you back. */
  feared: 300,
};

/** Arrest: share of the cash you carry that is seized, and firearms are confiscated. */
export const JAIL_CASH_SEIZED = 0.5;

/** Character skills, improved with skill points (one per level). */
export type SkillId = 'force' | 'endurance' | 'precision' | 'speed' | 'driving';
export const SKILL_MAX = 10;
export const SKILLS: { id: SkillId; name: string; icon: string; per: string }[] = [
  { id: 'force', name: 'Force', icon: '💪', per: '+8 % de dégâts au corps à corps' },
  { id: 'endurance', name: 'Endurance', icon: '🛡', per: '-5 % de dégâts reçus' },
  { id: 'precision', name: 'Précision', icon: '🎯', per: '+5 % de dégâts aux armes à feu, visée plus large' },
  { id: 'speed', name: 'Vitesse', icon: '⚡', per: '+3 % de vitesse de course' },
  { id: 'driving', name: 'Conduite', icon: '🏎', per: '+3 % d’accélération et de vitesse en voiture' },
];
export type Skills = Record<SkillId, number>;
export const noSkills = (): Skills => ({ force: 0, endurance: 0, precision: 0, speed: 0, driving: 0 });

/** Skill points available at `level`, minus those already spent. */
export const skillPoints = (level: number, skills: Skills) => Math.max(0, level - 1 - Object.values(skills).reduce((a, b) => a + b, 0));
