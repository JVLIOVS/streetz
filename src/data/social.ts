/**
 * Multiplayer social rules: bounties on wanted players, crews and the co-op heist.
 */

/** A player reaching this many stars (with other players around) gets a bounty. */
export const BOUNTY_MIN_STARS = 4;
export const BOUNTY_BASE = 1000;
export const BOUNTY_PER_STAR = 750;
/** Survive this long (s) and you cash in twice the bounty yourself. */
export const BOUNTY_TIME = 180;
/** Seconds before the same player can get a new bounty. */
export const BOUNTY_COOLDOWN = 120;

export const CREW_PRICE = 500;
/** Chaos cash-in bonus when a crewmate is within CREW_NEAR meters. */
export const CREW_BONUS = 1.25;
export const CREW_NEAR = 60;
export const CREW_COLORS = [0xff4057, 0x2f80ed, 0x27ae60, 0xffd23f, 0xb56cff, 0xff9f1c, 0x00c2c7, 0xff7eb6];

/** Crew names: 2–12 letters/digits, upper case. */
export function cleanCrewName(raw: string): string | null {
  const n = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .trim()
    .slice(0, 12);
  return n.length >= 2 ? n : null;
}

export function crewColor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CREW_COLORS[h % CREW_COLORS.length];
}

/** Week number (weeks start on Monday) from a day number (days since 1970-01-01, a Thursday). */
export const weekOf = (day: number) => Math.floor((day + 3) / 7);

// ------------------------------------------------------------------ co-op heist

export const HEIST = {
  id: 'coffre',
  name: 'Le Coffre',
  /** Marker next to the bank. */
  x: 140,
  z: -100,
  minPlayers: 2,
  /** Players within this radius of the marker join the crew when it starts. */
  gatherRadius: 14,
  /** Drilling time (s) with 2 players at the vault; more players drill faster. */
  drillTime: 30,
  total: 24000,
  xp: 300,
  /** Seconds between two heists in the same game. */
  cooldown: 600,
} as const;
