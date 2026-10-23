import type { Outfit } from '../data/shop';
import type { VehicleType } from '../data/vehicles';
import type { WeaponId } from '../data/weapons';
import { START_XP } from '../data/progression';
import { emptyWeek, type WeekStats } from '../sim/player';
import { noSkills, type Skills } from '../data/law';

/**
 * Player progression, saved on the device (localStorage). The same JSON shape is sent to
 * the host when joining a multiplayer game, and will later go to an online account.
 */
export interface Profile {
  money: number;
  weapons: WeaponId[];
  ammo: Partial<Record<WeaponId, number>>;
  armor: number;
  outfit: Outfit;
  clothes: string[];
  garage: { type: VehicleType; paint: number }[];
  homes: string[];
  rep: number;
  /** Story missions completed. */
  missions: string[];
  /** Daily contracts progress (day number + progress per contract). */
  daily: { day: number; progress: number[] };
  /** Login streak: last day played and streak length. */
  streak: { day: number; count: number };
  /** Hideout businesses owned. */
  biz: { id: string; stock: number; last: number }[];
  /** Tutorial finished (or skipped). */
  tutorial: boolean;
  crew: { name: string; color: number } | null;
  week: WeekStats;
  bank: number;
  fines: number;
  notoriety: number;
  respect: number;
  skills: Skills;
}

export interface SaveData {
  version: 2;
  settings: { quality: 'low' | 'medium' | 'high'; music: boolean; sfx: boolean };
  profile: Profile;
}

const KEY = 'streetz.save';

export function defaultProfile(): Profile {
  return { money: 500, weapons: ['fist'], ammo: {}, armor: 0, outfit: {}, clothes: [], garage: [], homes: ['hideout'], rep: START_XP, missions: [], daily: { day: 0, progress: [] }, streak: { day: 0, count: 0 }, biz: [], tutorial: false, crew: null, week: emptyWeek(0), bank: 0, fines: 0, notoriety: 0, respect: 0, skills: noSkills() };
}

export function defaultSave(): SaveData {
  return { version: 2, settings: { quality: 'medium', music: true, sfx: true }, profile: defaultProfile() };
}

export function loadSave(storage: Pick<Storage, 'getItem'> | null = safeStorage()): SaveData {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return defaultSave();
    const data = JSON.parse(raw);
    if (data?.version === 1) {
      // v1 only had money
      const s = defaultSave();
      s.settings = { ...s.settings, ...data.settings };
      s.profile.money = Number(data.progress?.money) || s.profile.money;
      return s;
    }
    if (data?.version !== 2) return defaultSave();
    return { ...defaultSave(), ...data, settings: { ...defaultSave().settings, ...data.settings }, profile: sanitize(data.profile) };
  } catch {
    return defaultSave();
  }
}

/** Keeps a profile coming from storage or the network within sane bounds. */
export function sanitize(p: Partial<Profile> | undefined): Profile {
  const d = defaultProfile();
  if (!p || typeof p !== 'object') return d;
  const arr = <T>(v: unknown, fallback: T[]): T[] => (Array.isArray(v) ? (v as T[]) : fallback);
  return {
    money: Math.max(0, Math.min(10_000_000, Number(p.money) || 0)),
    weapons: arr<WeaponId>(p.weapons, d.weapons).includes('fist') ? arr<WeaponId>(p.weapons, d.weapons) : ['fist', ...arr<WeaponId>(p.weapons, [])],
    ammo: typeof p.ammo === 'object' && p.ammo ? p.ammo : {},
    armor: Math.max(0, Math.min(100, Number(p.armor) || 0)),
    outfit: typeof p.outfit === 'object' && p.outfit ? p.outfit : {},
    clothes: arr<string>(p.clothes, []),
    garage: arr<{ type: VehicleType; paint: number }>(p.garage, []).slice(0, 8),
    homes: arr<string>(p.homes, d.homes).includes('hideout') ? arr<string>(p.homes, d.homes) : ['hideout', ...arr<string>(p.homes, [])],
    rep: Math.max(0, Number(p.rep) || 0),
    missions: arr<string>(p.missions, []),
    daily: p.daily && typeof p.daily === 'object' ? { day: Number(p.daily.day) || 0, progress: arr<number>(p.daily.progress, []) } : d.daily,
    streak: p.streak && typeof p.streak === 'object' ? { day: Number(p.streak.day) || 0, count: Math.max(0, Number(p.streak.count) || 0) } : d.streak,
    biz: arr<{ id: string; stock: number; last: number }>(p.biz, []).slice(0, 6),
    // players from before the tutorial existed already know the game
    crew: p.crew && typeof p.crew.name === 'string' ? { name: String(p.crew.name).slice(0, 12), color: Number(p.crew.color) || 0xffffff } : null,
    week: p.week && typeof p.week === 'object' ? { ...emptyWeek(0), ...p.week } : emptyWeek(0),
    bank: Math.max(0, Math.min(1e8, Number(p.bank) || 0)),
    fines: Math.max(0, Math.min(5, Number(p.fines) || 0)),
    notoriety: Math.max(0, Math.min(100, Number(p.notoriety) || 0)),
    respect: Math.max(0, Number(p.respect) || 0),
    skills: { ...noSkills(), ...(typeof p.skills === 'object' && p.skills ? p.skills : {}) },
    tutorial: typeof p.tutorial === 'boolean' ? p.tutorial : (p.missions?.length ?? 0) > 0 || (Number(p.money) || 0) !== d.money,
  };
}

export function writeSave(data: SaveData, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private mode / quota: the game keeps running without saving */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
