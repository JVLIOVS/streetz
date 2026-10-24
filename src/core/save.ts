import { APARTMENT_PRICES, CLOTHES, type Outfit } from '../data/shop';
import { VEHICLES, type VehicleType } from '../data/vehicles';
import { WEAPONS, type WeaponId } from '../data/weapons';
import { MISSIONS } from '../data/missions';
import { BUSINESSES } from '../data/business';
import { GEAR_SLOTS, type Gear } from '../data/gear';
import { START_XP } from '../data/progression';
import { emptyWeek, type WeekStats } from '../sim/player';
import { noSkills, SKILL_MAX, type Skills } from '../data/law';

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
  /** The "Le premier coup" prologue done or skipped (new in test 8: shown once to everybody). */
  prologue: boolean;
  crew: { name: string; color: number; id?: string } | null;
  week: WeekStats;
  bank: number;
  fines: number;
  notoriety: number;
  respect: number;
  skills: Skills;
  jetpack: boolean;
  /** Clothes / gear worn (lost when knocked out). */
  gear: Gear;
}

export interface SaveData {
  version: 2;
  settings: { quality: 'low' | 'medium' | 'high'; music: boolean; sfx: boolean };
  profile: Profile;
}

const KEY = 'streetz.save';

export function defaultProfile(): Profile {
  return { money: 500, weapons: ['fist'], ammo: {}, armor: 0, outfit: {}, clothes: [], garage: [], homes: ['hideout'], rep: START_XP, missions: [], daily: { day: 0, progress: [] }, streak: { day: 0, count: 0 }, biz: [], tutorial: false, prologue: false, crew: null, week: emptyWeek(0), bank: 0, fines: 0, notoriety: 0, respect: 0, skills: noSkills(), jetpack: false, gear: {} };
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
  const num = (v: unknown, lo: number, hi: number, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  };
  const list = (v: unknown, allowed: Set<string>, max: number): string[] =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && allowed.has(x)))].slice(0, max) : [];
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const weapons = list(p.weapons, WEAPON_SET, 32) as WeaponId[];
  if (!weapons.includes('fist')) weapons.unshift('fist');
  const ammo: Partial<Record<WeaponId, number>> = {};
  for (const w of WEAPON_IDS) {
    const n = num(obj(p.ammo)[w], 0, 9999);
    if (n > 0) ammo[w] = Math.floor(n);
  }
  const outfit: Outfit = {};
  const o = obj(p.outfit);
  for (const k of ['top', 'topAccent', 'bottom', 'shoes', 'hatColor', 'hair'] as const) if (o[k] !== undefined) outfit[k] = num(o[k], 0, 0xffffff);
  if (o.sleeves === 'short' || o.sleeves === 'long') outfit.sleeves = o.sleeves;
  if (o.hat === 'none' || o.hat === 'cap' || o.hat === 'beanie') outfit.hat = o.hat;
  if (typeof o.glasses === 'boolean') outfit.glasses = o.glasses;
  if (typeof o.hairStyle === 'string' && HAIR.has(o.hairStyle)) outfit.hairStyle = o.hairStyle as Outfit['hairStyle'];
  const homes = list(p.homes, HOME_SET, 8);
  if (!homes.includes('hideout')) homes.unshift('hideout');
  const skills = noSkills();
  for (const k of Object.keys(skills) as (keyof Skills)[]) skills[k] = Math.floor(num(obj(p.skills)[k], 0, SKILL_MAX));
  const wk = obj(p.week);
  const week = emptyWeek(Math.floor(num(wk.id, 0, 1e6)));
  for (const k of ['best', 'kos', 'pvp', 'bounties', 'heists'] as const) week[k] = Math.floor(num(wk[k], 0, 1e9));
  const daily = obj(p.daily);
  const streak = obj(p.streak);
  const crew = obj(p.crew);
  return {
    money: Math.floor(num(p.money, 0, 10_000_000)),
    weapons,
    ammo,
    armor: num(p.armor, 0, 100),
    outfit,
    clothes: list(p.clothes, CLOTH_SET, 64),
    garage: (Array.isArray(p.garage) ? p.garage : [])
      .filter((g): g is { type: VehicleType; paint: number } => !!g && typeof g === 'object' && VEHICLE_SET.has((g as { type: string }).type))
      .map((g) => ({ type: g.type, paint: Math.floor(num(g.paint, 0, 0xffffff)) }))
      .slice(0, 8),
    homes,
    rep: Math.floor(num(p.rep, 0, 50_000_000, START_XP)),
    missions: list(p.missions, MISSION_SET, 64),
    daily: { day: Math.floor(num(daily.day, 0, 1e6)), progress: (Array.isArray(daily.progress) ? daily.progress : []).slice(0, 8).map((x) => num(x, 0, 1e7)) },
    streak: { day: Math.floor(num(streak.day, 0, 1e6)), count: Math.floor(num(streak.count, 0, 10_000)) },
    biz: (Array.isArray(p.biz) ? p.biz : [])
      .filter((b): b is { id: string; stock: number; last: number } => !!b && typeof b === 'object' && BIZ_SET.has((b as { id: string }).id))
      .map((b) => ({ id: b.id, stock: num(b.stock, 0, 1e7), last: num(b.last, 0, 1e13) }))
      .slice(0, 6),
    crew: typeof crew.name === 'string' && crew.name.trim() ? { name: crew.name.replace(/[<>\u0000-\u001f]/g, '').slice(0, 12), color: Math.floor(num(crew.color, 0, 0xffffff, 0xffffff)), ...(typeof crew.id === 'string' ? { id: crew.id.slice(0, 32) } : {}) } : null,
    week,
    bank: Math.floor(num(p.bank, 0, 1e8)),
    fines: Math.floor(num(p.fines, 0, 5)),
    notoriety: num(p.notoriety, 0, 100),
    respect: Math.floor(num(p.respect, 0, 1e7)),
    skills,
    jetpack: p.jetpack === true,
    gear: cleanGear(p.gear),
    prologue: p.prologue === true,
    // players from before the tutorial existed already know the game
    tutorial: typeof p.tutorial === 'boolean' ? p.tutorial : (Array.isArray(p.missions) && p.missions.length > 0) || (Number(p.money) || 0) !== d.money,
  };
}

/** Known slots, rarity 0..3. */
function cleanGear(v: unknown): Gear {
  const out: Gear = {};
  if (!v || typeof v !== 'object') return out;
  for (const slot of GEAR_SLOTS) {
    const r = (v as Record<string, unknown>)[slot];
    if (r === 0 || r === 1 || r === 2 || r === 3) out[slot] = r;
  }
  return out;
}

const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
const WEAPON_SET = new Set<string>(WEAPON_IDS);
const VEHICLE_SET = new Set<string>(Object.keys(VEHICLES));
const CLOTH_SET = new Set(CLOTHES.map((c) => c.id));
const HOME_SET = new Set(['hideout', ...Object.keys(APARTMENT_PRICES)]);
const MISSION_SET = new Set(MISSIONS.map((m) => m.id));
const BIZ_SET = new Set(BUSINESSES.map((b) => b.id));
const HAIR = new Set(['short', 'buzz', 'long', 'ponytail', 'afro', 'bald', 'mohawk']);

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
