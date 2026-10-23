/** Police response per wanted level (stars). Tweak here to rebalance the chase. */
export interface PoliceLevel {
  /** Officers on foot around the suspect. */
  cops: number;
  /** Patrol cars chasing. */
  cars: number;
  helis: number;
  /** Roadblocks put across the road ahead. */
  roadblocks: boolean;
  /** Unit type for foot soldiers. */
  unit: 'cop' | 'swat' | 'soldier';
  /** Do they shoot? (level 1 only tries to arrest) */
  shoot: boolean;
  /** Damage per bullet that hits. */
  damage: number;
  /** Chance to hit at 10 m on a still target. */
  accuracy: number;
}

export const POLICE_LEVELS: PoliceLevel[] = [
  { cops: 0, cars: 0, helis: 0, roadblocks: false, unit: 'cop', shoot: false, damage: 0, accuracy: 0 },
  { cops: 2, cars: 0, helis: 0, roadblocks: false, unit: 'cop', shoot: false, damage: 0, accuracy: 0 },
  { cops: 3, cars: 2, helis: 0, roadblocks: false, unit: 'cop', shoot: true, damage: 6, accuracy: 0.45 },
  { cops: 4, cars: 3, helis: 1, roadblocks: false, unit: 'cop', shoot: true, damage: 7, accuracy: 0.5 },
  { cops: 5, cars: 4, helis: 1, roadblocks: true, unit: 'swat', shoot: true, damage: 8, accuracy: 0.55 },
  { cops: 6, cars: 3, helis: 2, roadblocks: true, unit: 'soldier', shoot: true, damage: 10, accuracy: 0.6 },
];

/**
 * Seconds before the first unit shows up after you get stars (per level), then
 * seconds between two reinforcements: the police doesn't teleport in.
 */
export const RESPONSE_DELAY = [0, 14, 9, 6, 5, 4];
export const REINFORCE_EVERY = 3;

/** Search zone radius around the last place the police saw you. */
export const searchRadius = (level: number) => 60 + level * 25;
/** Seconds to stay unseen outside the zone to lose the police. */
export const HIDE_TIME = 8;
/** Seconds unseen inside the zone before losing one star. */
export const COOL_TIME = 30;
/** Cost of a repaint at the garage (clears the stars). */
export const REPAINT_PRICE = 300;
