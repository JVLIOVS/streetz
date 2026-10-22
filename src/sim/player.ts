import type RAPIER_T from '@dimforge/rapier3d-compat';
import type { MoveCommand } from '../core/commands';
import { DT } from '../core/loop';
import type { Profile } from '../core/save';
import type { Outfit } from '../data/shop';
import type { VehicleType } from '../data/vehicles';
import type { WeaponId } from '../data/weapons';

export type PlayerAnim = 'idle' | 'walk' | 'run' | 'sprint' | 'jump' | 'fall' | 'drive' | 'ko';
export type PlayerAction = 'punch' | 'kick' | 'shoot' | 'shoot2' | 'stab' | 'swing' | 'hit' | 'interact';

export interface ContextAction {
  kind:
    | 'enter_vehicle'
    | 'steal_vehicle'
    | 'exit_vehicle'
    | 'enter_building'
    | 'exit_building'
    | 'rob'
    | 'talk'
    | 'travel'
    | 'repaint'
    /** These open a menu on the client (shop list, wardrobe, garage). */
    | 'shop'
    | 'wardrobe'
    | 'garage'
    | 'buy_home'
    | 'store_vehicle'
    | 'mission';
  label: string;
  target: number | string;
}

/** Serializable player state (what a server would broadcast). */
export interface PlayerState {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Facing direction (radians, 0 = looking towards -z). */
  facing: number;
  grounded: boolean;
  anim: PlayerAnim;
  speed: number;
  health: number;
  armor: number;
  money: number;
  weapon: WeaponId;
  /** Weapons owned (fists always). */
  weapons: WeaponId[];
  ammo: Record<WeaponId, number>;
  /** Clothes worn (overrides of the generated look) and owned. */
  outfit: Outfit;
  clothes: string[];
  /** Vehicles stored in the garage, and homes owned (the hideout is always yours). */
  garage: { type: VehicleType; paint: number }[];
  homes: string[];
  /** Reputation points (missions); level = 1 + floor(rep / 100). */
  rep: number;
  /** Story missions completed, and the one in progress (id) with its step. */
  missionsDone: string[];
  mission: string | null;
  missionStep: number;
  /** One-line objective of the current mission, and its countdown (s, -1 = none). */
  objective: string;
  missionTimer: number;
  /** Vehicle id when driving, -1 on foot. */
  vehicle: number;
  /** Interior id when inside a building. */
  interior: string | null;
  /** Last one-shot action and a counter so the renderer can play it once. */
  action: PlayerAction | null;
  actionSeq: number;
  /** Robbery progress 0..1 (or -1). */
  robbery: number;
  context: ContextAction | null;
  dead: boolean;
  /** Last pedestrian hit, for the target health bar. */
  lastHit: number;
  lastHitTick: number;
  /** Wanted level (stars) and seconds before the next star is lost. */
  wanted: number;
  wantedCooldown: number;
  /** Is the police currently seeing you? (stars blink when not) */
  wantedSeen: boolean;
  /** Search zone: last place the police saw you, and its radius. */
  searchX: number;
  searchZ: number;
  searchR: number;
  /** Arrest progress 0..1 while an officer holds you. */
  arrest: number;
  /** Incremented by the authority on every teleport (doors, respawn…): clients apply it once. */
  teleportSeq: number;
  /** Multiplayer: nickname and outfit seed (-1 = default look). */
  name: string;
  look: number;
}

export const PLAYER_TUNING = {
  radius: 0.35,
  halfHeight: 0.55, // capsule total height = 2 * (halfHeight + radius) = 1.8 m
  walkSpeed: 2.3,
  runSpeed: 5.6,
  sprintSpeed: 8.8,
  jumpSpeed: 8.2,
  gravity: 26,
  groundAccel: 14,
  airAccel: 3.5,
  turnRate: 12,
};

/** Runtime player: state + physics handles. Physics handles never leave the sim. */
export class Player {
  state: PlayerState;
  /** Position at the previous tick, for render interpolation. */
  prev = { x: 0, y: 0, z: 0, facing: 0 };
  input: MoveCommand | null = null;
  private jumpQueued = false;
  attackCooldown = 0;
  /** Pending melee hit (applied a few ticks after the punch starts). */
  pendingHit = -1;
  /** Melee lock-on target and lunge duration (ticks without input steering). */
  meleeLock: unknown = null;
  lungeTicks = 0;
  respawnTimer = 0;
  /** Seconds the police has not seen this player. */
  unseen = 0;
  /** Multiplayer: this player's position comes from network reports, not from local physics. */
  remote = false;
  /** Last reported position (remote players). */
  net = { x: 0, y: 0, z: 0, facing: 0, vx: 0, vz: 0, has: false };
  robberyTarget: string | null = null;
  robberyTime = 0;
  lastRobbery = new Map<string, number>();

  constructor(
    id: string,
    readonly body: RAPIER_T.RigidBody,
    readonly collider: RAPIER_T.Collider,
    spawn: { x: number; y: number; z: number; yaw: number },
  ) {
    this.state = {
      id,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      vx: 0,
      vy: 0,
      vz: 0,
      facing: spawn.yaw,
      grounded: false,
      anim: 'idle',
      speed: 0,
      health: 100,
      armor: 0,
      money: 500,
      weapon: 'fist',
      weapons: ['fist'],
      ammo: { fist: 0, knife: 0, baton: 0, bat: 0, pistol: 0, smg: 0, shotgun: 0, rifle: 0 },
      outfit: {},
      clothes: [],
      garage: [],
      homes: ['hideout'],
      rep: 0,
      missionsDone: [],
      mission: null,
      missionStep: 0,
      objective: '',
      missionTimer: -1,
      vehicle: -1,
      interior: null,
      action: null,
      actionSeq: 0,
      robbery: -1,
      context: null,
      dead: false,
      lastHit: -1,
      lastHitTick: -1,
      wanted: 0,
      wantedCooldown: 0,
      wantedSeen: false,
      searchX: 0,
      searchZ: 0,
      searchR: 0,
      arrest: 0,
      teleportSeq: 0,
      name: id,
      look: -1,
    };
    this.savePrev();
  }

  setInput(cmd: MoveCommand) {
    if (cmd.jump) this.jumpQueued = true;
    this.input = cmd;
  }

  savePrev() {
    this.prev.x = this.state.x;
    this.prev.y = this.state.y;
    this.prev.z = this.state.z;
    this.prev.facing = this.state.facing;
  }

  /** One fixed tick of on-foot movement. */
  update(controller: RAPIER_T.KinematicCharacterController) {
    const T = PLAYER_TUNING;
    const s = this.state;
    const inp = this.input;
    let sx = inp?.x ?? 0;
    let sy = inp?.y ?? 0;
    const mag = Math.min(1, Math.hypot(sx, sy));
    if (mag > 1) {
      sx /= mag;
      sy /= mag;
    }
    const yaw = inp?.yaw ?? 0;
    // Camera-relative: forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
    const dirX = Math.cos(yaw) * sx - Math.sin(yaw) * sy;
    const dirZ = -Math.sin(yaw) * sx - Math.cos(yaw) * sy;
    // Three gaits: light push = walk, full push = run, sprint button = sprint
    const sprint = !!inp?.sprint && mag > 0.3;
    const maxSpeed = s.dead ? 0 : sprint ? T.sprintSpeed : mag < 0.65 ? T.walkSpeed * Math.min(1, mag / 0.4) : T.runSpeed;
    const dl = Math.hypot(dirX, dirZ);
    const tx = dl > 1e-4 ? (dirX / dl) * maxSpeed : 0;
    const tz = dl > 1e-4 ? (dirZ / dl) * maxSpeed : 0;

    const accel = s.grounded ? T.groundAccel : T.airAccel;
    const k = 1 - Math.exp(-accel * DT);
    if (this.lungeTicks > 0) {
      this.lungeTicks--; // lunging at a target: keep the dash velocity
      if (this.lungeTicks === 0) {
        s.vx *= 0.2;
        s.vz *= 0.2;
      }
    } else {
      s.vx += (tx - s.vx) * k;
      s.vz += (tz - s.vz) * k;
    }

    if (this.jumpQueued && s.grounded && !s.dead) {
      s.vy = T.jumpSpeed;
      s.grounded = false;
    } else if (s.grounded && s.vy <= 0) {
      s.vy = -2; // keep pressed against slopes
    } else {
      s.vy -= T.gravity * DT;
    }
    this.jumpQueued = false;

    const desired = { x: s.vx * DT, y: s.vy * DT, z: s.vz * DT };
    controller.computeColliderMovement(this.collider, desired);
    const m = controller.computedMovement();
    const wasRising = s.vy > 0;
    s.grounded = controller.computedGrounded();
    if (wasRising && m.y < desired.y - 1e-4) s.vy = 0; // bumped the ceiling
    if (s.grounded && s.vy < 0) s.vy = 0;
    // Hitting a wall kills horizontal velocity along it (no "sticky" acceleration build-up)
    s.vx = m.x / DT;
    s.vz = m.z / DT;

    s.x += m.x;
    s.y += m.y;
    s.z += m.z;
    this.body.setNextKinematicTranslation({ x: s.x, y: s.y, z: s.z });

    const hs = Math.hypot(s.vx, s.vz);
    s.speed = hs;
    if (hs > 0.3) {
      const target = Math.atan2(-s.vx, -s.vz);
      s.facing = lerpAngle(s.facing, target, 1 - Math.exp(-T.turnRate * DT));
    }
    if (s.dead) s.anim = 'ko';
    else if (!s.grounded) s.anim = s.vy > 0 ? 'jump' : 'fall';
    else if (hs > T.runSpeed + 0.8) s.anim = 'sprint';
    else if (hs > T.walkSpeed + 0.6) s.anim = 'run';
    else if (hs > 0.3) s.anim = 'walk';
    else s.anim = 'idle';
  }

  teleport(x: number, y: number, z: number, facing?: number) {
    const s = this.state;
    s.x = x;
    s.y = y;
    s.z = z;
    s.vx = s.vy = s.vz = 0;
    if (facing !== undefined) s.facing = facing;
    this.body.setTranslation({ x, y, z }, true);
    this.body.setNextKinematicTranslation({ x, y, z });
    this.savePrev();
  }
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Loads a saved profile into a player. */
export function applyProfile(s: PlayerState, p: Profile) {
  s.money = p.money;
  s.weapons = [...p.weapons];
  for (const k of Object.keys(s.ammo) as WeaponId[]) s.ammo[k] = Math.max(0, Number(p.ammo[k]) || 0);
  s.armor = p.armor;
  s.outfit = { ...p.outfit };
  s.clothes = [...p.clothes];
  s.garage = p.garage.map((g) => ({ ...g }));
  s.homes = [...p.homes];
  s.rep = p.rep;
  s.missionsDone = [...p.missions];
}

/** What gets saved from a player. */
export function profileOf(s: PlayerState): Profile {
  return {
    money: s.money,
    weapons: [...s.weapons],
    ammo: { ...s.ammo },
    armor: Math.round(s.armor),
    outfit: { ...s.outfit },
    clothes: [...s.clothes],
    garage: s.garage.map((g) => ({ ...g })),
    homes: [...s.homes],
    rep: s.rep,
    missions: [...s.missionsDone],
  };
}
