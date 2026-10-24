import { GEAR_SLOTS, type Rarity } from '../data/gear';
import type { ActionKind } from '../core/commands';
import { VEHICLES, type VehicleType } from '../data/vehicles';
import type { PedMode, PedRole, PedState, PedWeapon, Temper } from '../sim/peds';
import { WEAPONS, type WeaponId } from '../data/weapons';
import type { PlayerState } from '../sim/player';
import type { BrokenProp } from '../sim/props';
import type { VehicleState } from '../sim/vehicle';
import type { PickupState, PlayerReport, SimEvent } from '../sim/world';
import type { HeliState } from '../sim/police';
import type { Profile } from '../core/save';

/**
 * Wire format. Entities are packed into flat number arrays (positions rounded to cm)
 * to keep snapshots small: the host sends ~12 per second to every guest.
 */

export const MAX_PLAYERS = 10;
export const SNAPSHOT_EVERY = 5; // ticks (60 Hz) → 12 Hz
export const REPORT_EVERY = 3; // ticks → 20 Hz
/** Area of interest: entities farther than this from a guest are not sent to them. */
export const AOI = 130;

export type HostMessage =
  | { t: 'welcome'; id: string; host: string; tick: number }
  | { t: 'full' }
  /** Sent by a host to every peer it meets: two hosts in one public room → the larger id steps down. */
  | { t: 'hosting' }
  | { t: 'snap'; k: number; P: NetPlayer[]; D: number[][]; V: number[][]; K: number[][]; X: number[][]; H?: number[][]; C?: number[]; E: SimEvent[] };

export type GuestMessage = { t: 'join'; name: string; look: number; profile?: Profile } | ({ t: 'st'; a: { k: ActionKind; arg?: string }[] } & PlayerReport);

const q = (n: number) => Math.round(n * 100) / 100;

const PED_MODES: PedMode[] = ['walk', 'idle', 'flee', 'cower', 'ko', 'shopkeeper', 'wave', 'stun', 'fight', 'police', 'follow'];
const TEMPERS: Temper[] = ['coward', 'scared', 'fighter'];
const ROLES: PedRole[] = ['civ', 'cop', 'swat', 'soldier'];
const PED_WEAPONS: PedWeapon[] = ['none', 'knife', 'bat', 'baton', 'pistol', 'rifle'];
const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
const VEHICLE_TYPES = Object.keys(VEHICLES) as VehicleType[];

/** Player fields a guest needs (position + everything the host decides). */
export type NetPlayer = Pick<
  PlayerState,
  | 'id'
  | 'x'
  | 'y'
  | 'z'
  | 'vx'
  | 'vz'
  | 'facing'
  | 'anim'
  | 'speed'
  | 'grounded'
  | 'health'
  | 'armor'
  | 'money'
  | 'weapon'
  | 'ammo'
  | 'vehicle'
  | 'interior'
  | 'action'
  | 'actionSeq'
  | 'robbery'
  | 'context'
  | 'dead'
  | 'lastHit'
  | 'lastHitTick'
  | 'wanted'
  | 'wantedCooldown'
  | 'teleportSeq'
  | 'name'
  | 'look'
  | 'weapons'
  | 'outfit'
  | 'clothes'
  | 'garage'
  | 'homes'
  | 'rep'
  | 'missionsDone'
  | 'mission'
  | 'missionStep'
  | 'objective'
  | 'missionTimer'
  | 'waypoint'
  | 'missionTargets'
  | 'ally'
  | 'chaos'
  | 'chaosMult'
  | 'chaosTimer'
  | 'contracts'
  | 'contractsDay'
  | 'streak'
  | 'streakDay'
  | 'fenceOrder'
  | 'biz'
  | 'tutorialDone'
  | 'bounty'
  | 'bountyTimer'
  | 'crew'
  | 'week'
  | 'bank'
  | 'fines'
  | 'fine'
  | 'fineTimer'
  | 'refused'
  | 'canSurrender'
  | 'notoriety'
  | 'respect'
  | 'skills'
  | 'carrying'
  | 'stash'
  | 'jetpack'
  | 'fuel'
  | 'jetting'
  | 'resist'
  | 'wantedSeen'
  | 'searchX'
  | 'searchZ'
  | 'searchR'
  | 'arrest'
  | 'gear'
  | 'base'
  | 'locker'
  | 'awaken'
  | 'awakenCharge'
  | 'awakenCooldown'
  | 'powerCooldown'
  | 'opInvite'
>;

/** Private fields only sent to their owner (inventory, contracts…). */
const PRIVATE: (keyof NetPlayer)[] = ['opInvite', 'base', 'locker', 'ammo', 'weapons', 'clothes', 'garage', 'homes', 'missionsDone', 'contracts', 'biz', 'week', 'bank', 'skills', 'fines', 'context', 'searchX', 'searchZ', 'searchR', 'waypoint', 'missionTargets', 'objective'];

export function packPlayer(s: PlayerState, owner = true): NetPlayer {
  const n = packFull(s);
  if (!owner) for (const k of PRIVATE) delete (n as Partial<NetPlayer>)[k];
  return n;
}

function packFull(s: PlayerState): NetPlayer {
  return {
    id: s.id,
    gear: s.gear,
    base: s.base,
    locker: s.locker,
    awaken: q(s.awaken),
    awakenCharge: q(s.awakenCharge),
    awakenCooldown: Math.ceil(s.awakenCooldown),
    powerCooldown: q(s.powerCooldown),
    opInvite: s.opInvite,
    x: q(s.x),
    y: q(s.y),
    z: q(s.z),
    vx: q(s.vx),
    vz: q(s.vz),
    facing: q(s.facing),
    anim: s.anim,
    speed: q(s.speed),
    grounded: s.grounded,
    health: Math.round(s.health),
    armor: Math.round(s.armor),
    money: s.money,
    weapon: s.weapon,
    ammo: s.ammo,
    vehicle: s.vehicle,
    interior: s.interior,
    action: s.action,
    actionSeq: s.actionSeq,
    robbery: q(s.robbery),
    context: s.context,
    dead: s.dead,
    lastHit: s.lastHit,
    lastHitTick: s.lastHitTick,
    wanted: s.wanted,
    wantedCooldown: q(s.wantedCooldown),
    teleportSeq: s.teleportSeq,
    name: s.name,
    look: s.look,
    weapons: s.weapons,
    outfit: s.outfit,
    clothes: s.clothes,
    garage: s.garage,
    homes: s.homes,
    rep: s.rep,
    missionsDone: s.missionsDone,
    mission: s.mission,
    missionStep: s.missionStep,
    objective: s.objective,
    missionTimer: q(s.missionTimer),
    waypoint: s.waypoint ? [q(s.waypoint[0]), q(s.waypoint[1])] : null,
    missionTargets: s.missionTargets,
    ally: s.ally,
    chaos: Math.round(s.chaos),
    chaosMult: s.chaosMult,
    chaosTimer: q(s.chaosTimer),
    contracts: s.contracts,
    contractsDay: s.contractsDay,
    streak: s.streak,
    streakDay: s.streakDay,
    fenceOrder: s.fenceOrder,
    biz: s.biz,
    tutorialDone: s.tutorialDone,
    bounty: s.bounty,
    bountyTimer: q(s.bountyTimer),
    crew: s.crew,
    week: s.week,
    bank: s.bank,
    fines: s.fines,
    fine: s.fine,
    fineTimer: q(s.fineTimer),
    refused: s.refused,
    canSurrender: s.canSurrender,
    notoriety: Math.round(s.notoriety),
    respect: s.respect,
    skills: s.skills,
    carrying: s.carrying,
    stash: s.stash,
    jetpack: s.jetpack,
    fuel: q(s.fuel),
    jetting: s.jetting,
    resist: q(s.resist),
    wantedSeen: s.wantedSeen,
    searchX: q(s.searchX),
    searchZ: q(s.searchZ),
    searchR: s.searchR,
    arrest: q(s.arrest),
  };
}

export function packPed(s: PedState): number[] {
  return [
    s.id,
    q(s.x),
    q(s.y),
    q(s.z),
    q(s.facing),
    q(s.speed),
    PED_MODES.indexOf(s.mode),
    Math.round(s.health),
    s.maxHealth,
    s.look,
    s.hitSeq,
    s.action === 'kick' ? 2 : s.action === 'punch' ? 1 : 0,
    s.actionSeq,
    TEMPERS.indexOf(s.temper),
    s.vip ? 1 : 0,
    ROLES.indexOf(s.role),
    PED_WEAPONS.indexOf(s.weapon),
  ];
}

export function unpackPed(a: number[], s: PedState) {
  [, s.x, s.y, s.z, s.facing, s.speed] = a;
  s.mode = PED_MODES[a[6]] ?? 'walk';
  s.health = a[7];
  s.maxHealth = a[8];
  s.look = a[9];
  s.hitSeq = a[10];
  s.action = a[11] === 2 ? 'kick' : a[11] === 1 ? 'punch' : null;
  s.actionSeq = a[12];
  s.temper = TEMPERS[a[13]] ?? 'coward';
  s.vip = a[14] === 1;
  s.role = ROLES[a[15]] ?? 'civ';
  s.weapon = PED_WEAPONS[a[16]] ?? 'none';
}

export function packVehicle(s: VehicleState, driverIndex: (d: string) => number): number[] {
  return [
    s.id,
    VEHICLE_TYPES.indexOf(s.type),
    s.paint,
    q(s.x),
    q(s.y),
    q(s.z),
    q(s.yaw),
    q(s.pitch),
    q(s.roll),
    q(s.vx),
    q(s.vz),
    q(s.speed),
    q(s.steer),
    Math.round(s.health),
    driverIndex(s.driver),
    q(s.fire),
    s.wrecked ? 1 : 0,
    s.braking ? 1 : 0,
    s.horn,
  ];
}

export const vehicleTypeOf = (a: number[]) => VEHICLE_TYPES[a[1]] ?? 'compact';

export function packPickup(p: PickupState): number[] {
  // the last field is the weapon index, or slot × 4 + rarity for clothes
  const extra = p.gear ? GEAR_SLOTS.indexOf(p.gear.slot) * 4 + p.gear.r : p.weapon ? WEAPON_IDS.indexOf(p.weapon) : -1;
  return [p.id, q(p.x), q(p.y), q(p.z), p.amount, p.kind === 'crate' ? 1 : p.kind === 'weapon' ? 2 : p.kind === 'gear' ? 3 : 0, extra];
}

export function unpackPickup(a: number[]): PickupState {
  const [id, x, y, z, amount, kind, w] = a;
  if (kind === 3) return { id, x, y, z, amount, kind: 'gear', gear: { slot: GEAR_SLOTS[Math.floor(w / 4)] ?? 'top', r: (w % 4) as Rarity } };
  return { id, x, y, z, amount, kind: kind === 1 ? 'crate' : kind === 2 ? 'weapon' : 'money', weapon: WEAPON_IDS[w] };
}

export function packProp(p: BrokenProp): number[] {
  return [p.id, q(p.x), q(p.y), q(p.z), q(p.tilt), q(p.ax), q(p.az), q(p.spin), q(p.spray)];
}

export function packHeli(h: HeliState): number[] {
  return [h.id, q(h.x), q(h.y), q(h.z), q(h.yaw), Math.round(h.health), q(h.down), h.army ? 1 : 0];
}
