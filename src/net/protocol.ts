import type { ActionKind } from '../core/commands';
import { VEHICLES, type VehicleType } from '../data/vehicles';
import type { PedMode, PedState, Temper } from '../sim/peds';
import type { PlayerState } from '../sim/player';
import type { BrokenProp } from '../sim/props';
import type { VehicleState } from '../sim/vehicle';
import type { PickupState, PlayerReport, SimEvent } from '../sim/world';
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
  | { t: 'snap'; k: number; P: NetPlayer[]; D: number[][]; V: number[][]; K: number[][]; X: number[][]; E: SimEvent[] };

export type GuestMessage = { t: 'join'; name: string; look: number; profile?: Profile } | ({ t: 'st'; a: { k: ActionKind; arg?: string }[] } & PlayerReport);

const q = (n: number) => Math.round(n * 100) / 100;

const PED_MODES: PedMode[] = ['walk', 'idle', 'flee', 'cower', 'ko', 'shopkeeper', 'wave', 'stun', 'fight', 'police', 'follow'];
const TEMPERS: Temper[] = ['coward', 'scared', 'fighter'];
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
  | 'wantedSeen'
  | 'searchX'
  | 'searchZ'
  | 'searchR'
  | 'arrest'
>;

export function packPlayer(s: PlayerState): NetPlayer {
  return {
    id: s.id,
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
  return [p.id, q(p.x), q(p.y), q(p.z), p.amount];
}

export function packProp(p: BrokenProp): number[] {
  return [p.id, q(p.x), q(p.y), q(p.z), q(p.tilt), q(p.ax), q(p.az), q(p.spin), q(p.spray)];
}
