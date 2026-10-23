/**
 * Consequences of your actions: fines, criminal record, respect, prison and the bank.
 * Every number that balances "crime pays / crime costs" lives here.
 */

/**
 * When the police catches up with you (up to 3 stars), they offer a deal: pay a fine
 * (stars cleared, but you get "fiché") or refuse (chase). Once fiché 3 times, no more
 * deals: they come to neutralize you. You can always surrender (prison, you keep your stuff).
 */
export const MAX_FICHES = 3;
/** Fine per star, by how many times you were already fiché. */
export const FINE_PER_STAR = [300, 800, 2000];
export const fineFor = (wanted: number, fiches: number) => FINE_PER_STAR[Math.min(fiches, FINE_PER_STAR.length - 1)] * Math.max(1, wanted);
/** Seconds to decide before it counts as a refusal. */
export const OFFER_WAIT = 20;
/** Bail paid when you surrender (per star), from cash or bank if possible. */
export const BAIL_PER_STAR = 250;
/** Knocked out: your stuff waits on the ground this long (anyone can take it). */
export const STASH_MINUTES = 10;
/** Old name kept for the save format (fines = times fiché). */
export const MAX_FINES = MAX_FICHES;

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
