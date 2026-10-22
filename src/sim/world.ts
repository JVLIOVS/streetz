import type RAPIER_T from '@dimforge/rapier3d-compat';
import type { Command, MoveCommand } from '../core/commands';
import { DT } from '../core/loop';
import { Rng } from '../core/rng';
import { TRAFFIC_MIX, VEHICLES, type VehicleType } from '../data/vehicles';
import { APARTMENT_PRICES, CLOTHES, GARAGE_SLOTS, VEHICLE_OFFERS } from '../data/shop';
import { ARMOR_PRICE, WEAPON_ORDER, WEAPONS, type WeaponId } from '../data/weapons';
import { terrainHeight } from '../maps/terrain';
import type { InteriorDef, MapData } from '../maps/types';
import { buildStaticColliders } from './colliders';
import { roomLayout, type RoomLayout } from './interiors';
import { buildLaneGraph, buildSidewalkGraph, nextLane, type LaneGraph, type WalkNode } from './nav';
import { Ped, type PedState } from './peds';
import { PROP_SPECS, PropField, type BrokenProp } from './props';
import { PoliceSystem, type HeliState } from './police';
import { MissionSystem } from './missions';
import { ProgressSystem } from './progress';
import { ContractSystem } from './contracts';
import { REPAINT_PRICE } from '../data/police';
import { levelOf, requiredLevel } from '../data/progression';
import { GOLD_PAINT } from '../data/contracts';
import { GROUP, groups, initPhysics } from './physics';
import { angleDiff, Player, PLAYER_TUNING, type ContextAction, type PlayerState } from './player';
import { Vehicle, type VehicleNet, type VehicleState } from './vehicle';

export interface PickupState {
  id: number;
  x: number;
  y: number;
  z: number;
  kind: 'money' | 'crate';
  amount: number;
}

/** @deprecated kept for reference: wanted level now lives on each player. */
export interface WantedState {
  level: number;
  /** Seconds since the last reported crime. */
  heat: number;
  /** Seconds before the next star is lost. */
  cooldown: number;
}

export interface WorldSnapshot {
  tick: number;
  mapId: string;
  players: PlayerState[];
  peds: PedState[];
  vehicles: VehicleState[];
  pickups: PickupState[];
  props: BrokenProp[];
  helis: HeliState[];
}

export type SimEvent =
  | { type: 'respawn'; playerId: string; reason: 'drowned' | 'hospital' }
  | { type: 'shot'; fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; hit: boolean }
  | { type: 'punch'; x: number; y: number; z: number }
  | { type: 'explosion'; x: number; y: number; z: number }
  | { type: 'impact'; x: number; y: number; z: number; strength: number }
  | { type: 'toast'; playerId: string; text: string }
  | { type: 'money'; playerId: string; amount: number }
  | { type: 'horn'; vehicle: number }
  | { type: 'wanted'; playerId: string; level: number }
  | { type: 'busted'; playerId: string }
  | { type: 'crate'; playerId: string; text: string; rare: boolean }
  | { type: 'levelup'; playerId: string; level: number; unlocks: string[]; cash: number }
  | { type: 'chaos'; playerId: string; label: string; points: number }
  | { type: 'chaosEnd'; playerId: string; score: number; cash: number; mult: number }
  | { type: 'contract'; playerId: string; text: string; cash: number; all: boolean }
  | { type: 'streak'; playerId: string; day: number; cash: number }
  /** Damage dealt by a player (floating numbers). */
  | { type: 'dmg'; playerId: string; x: number; y: number; z: number; amount: number; ko: boolean }
  | { type: 'mission'; playerId: string; name: string; state: 'start' | 'done' | 'fail' }
  | { type: 'joined'; playerId: string; name: string }
  | { type: 'left'; playerId: string; name: string }
  | { type: 'break'; x: number; y: number; z: number; kind: string; prop: number };

export interface Density {
  peds: number;
  traffic: number;
  parkedRadius: number;
}

/** What a multiplayer guest sends about itself ~20 times per second. */
export interface PlayerReport {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  f: number;
  yaw: number;
  anim: PlayerState['anim'];
  g: boolean;
  sp: number;
  /** Last teleport applied. */
  tp: number;
  v?: VehicleNet & { dmg: number };
}

/** Something a player can hit. */
interface Target {
  x: number;
  y: number;
  z: number;
  ped?: Ped;
  player?: Player;
  vehicle?: Vehicle;
  heli?: HeliState;
}

type Crime = 'assault' | 'gunshot' | 'shoot_person' | 'knockout' | 'carjack' | 'robbery_shop' | 'robbery_big' | 'hit_and_run' | 'attack_cop';

const WANTED_DECAY = 25;
const TALK_LINES = ['Bien ou bien ?', 'Fais gaffe aux keufs ce soir…', 'Paraît que la banque est blindée.', 'T’as pas une clope ?', 'Belle journée hein !', 'On se connaît, non ?'];

/**
 * Authoritative game simulation. No three.js, no DOM: this exact class is meant
 * to run on a server in v2. Driven only by Commands, at a fixed 60 Hz.
 */
export class SimWorld {
  tick = 0;
  readonly players = new Map<string, Player>();
  readonly peds = new Map<number, Ped>();
  readonly vehicles = new Map<number, Vehicle>();
  readonly pickups = new Map<number, PickupState>();
  /** 'authority' runs everything (solo / host); 'replica' mirrors a host (multiplayer client). */
  readonly role: 'authority' | 'replica';
  events: SimEvent[] = [];
  staticColliderCount = 0;
  density: Density = { peds: 22, traffic: 12, parkedRadius: 75 };
  readonly lanes: LaneGraph;
  readonly walk: WalkNode[];
  readonly rooms = new Map<string, RoomLayout>();
  readonly props: PropField;
  private propColliders: RAPIER_T.Collider[] = [];
  private scratch: number[] = [];
  /** Internal (also used by the police system). */
  rng: Rng;
  private nextId = 1;
  readonly police: PoliceSystem;
  readonly missions: MissionSystem;
  readonly progress: ProgressSystem;
  readonly contracts: ContractSystem;
  /** Local calendar day number (set by the game from the clock; 0 = unknown). */
  day = 0;
  /** Wall-clock time in seconds (set by the game; used by hideout businesses). */
  now = 0;
  private controller: RAPIER_T.KinematicCharacterController;
  private carController: RAPIER_T.KinematicCharacterController;
  private offroadController: RAPIER_T.KinematicCharacterController;
  private parkedAlive = new Map<number, number>();
  private parkedGone = new Set<number>();
  private clerks = new Map<string, number>();

  private constructor(
    private R: typeof RAPIER_T,
    readonly physics: RAPIER_T.World,
    readonly map: MapData,
    role: 'authority' | 'replica',
  ) {
    this.role = role;
    this.rng = new Rng(map.seed ^ 0x5eed);
    this.controller = this.makeController(50, 0.45);
    this.carController = this.makeController(32, 0.25);
    this.offroadController = this.makeController(52, 0.45);
    this.staticColliderCount = buildStaticColliders(R, physics, map);
    this.lanes = buildLaneGraph(map);
    this.walk = buildSidewalkGraph(map);
    this.buildInteriors();
    this.police = new PoliceSystem(this);
    this.missions = new MissionSystem(this);
    this.progress = new ProgressSystem(this);
    this.contracts = new ContractSystem(this);
    this.props = new PropField(map.props);
    this.buildProps();
    if (role === 'authority') for (const f of map.featured) this.spawnVehicle(f.type as VehicleType, f.x, 0.3, f.z, f.yaw, 'none', false);
    physics.step(); // build the query structures once
  }

  static async create(map: MapData, role: 'authority' | 'replica' = 'authority'): Promise<SimWorld> {
    const R = await initPhysics();
    const physics = new R.World({ x: 0, y: -9.81 * 2, z: 0 });
    physics.timestep = 1 / 60;
    return new SimWorld(R, physics, map, role);
  }

  /** Highest wanted level among players (traffic gets nervous). */
  get maxWanted() {
    let m = 0;
    for (const p of this.players.values()) m = Math.max(m, p.state.wanted);
    return m;
  }

  /** Authoritative teleport: clients see the bumped teleportSeq and move their own player. */
  teleportPlayer(p: Player, x: number, y: number, z: number, facing?: number) {
    p.teleport(x, y, z, facing);
    p.state.teleportSeq++;
  }

  removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.state.vehicle >= 0) this.leaveVehicle(p);
    this.missions.drop(id);
    this.progress.drop(id);
    this.physics.removeRigidBody(p.body);
    this.players.delete(id);
  }

  private makeController(climbDeg: number, step: number) {
    const c = this.physics.createCharacterController(0.03);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.enableAutostep(step, 0.2, true);
    c.enableSnapToGround(0.45);
    c.setMaxSlopeClimbAngle((climbDeg * Math.PI) / 180);
    c.setMinSlopeSlideAngle(((climbDeg + 5) * Math.PI) / 180);
    return c;
  }

  // ------------------------------------------------------------------ entities

  addPlayer(id: string, spawn = this.map.spawn): Player {
    const R = this.R;
    const body = this.physics.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z));
    const collider = this.physics.createCollider(
      R.ColliderDesc.capsule(PLAYER_TUNING.halfHeight, PLAYER_TUNING.radius)
        .setTranslation(0, PLAYER_TUNING.halfHeight + PLAYER_TUNING.radius, 0)
        .setCollisionGroups(groups(GROUP.PLAYER, GROUP.STATIC | GROUP.PLAYER | GROUP.PED | GROUP.VEHICLE | GROUP.PROP | GROUP.BREAKABLE)),
      body,
    );
    const p = new Player(id, body, collider, spawn);
    this.players.set(id, p);
    return p;
  }

  spawnPed(x: number, z: number, opts: { from?: number; to?: number; ambient?: boolean; mode?: PedState['mode']; facing?: number; id?: number } = {}): Ped {
    const R = this.R;
    const id = opts.id ?? this.nextId++;
    const body = this.physics.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, 0, z));
    const collider = this.physics.createCollider(
      R.ColliderDesc.capsule(0.5, 0.32).setTranslation(0, 0.85, 0).setCollisionGroups(groups(GROUP.PED, GROUP.PLAYER | GROUP.QUERY)),
      body,
    );
    const roll = this.rng.next();
    const temper: PedState['temper'] = roll < 0.33 ? 'fighter' : roll < 0.53 ? 'scared' : 'coward';
    const maxHealth = temper === 'fighter' ? 130 : 100;
    // most people carry a little cash, some are loaded
    const money = this.rng.chance(0.12) ? this.rng.int(150, 600) : this.rng.int(5, 90);
    const state: PedState = {
      id,
      x,
      y: this.groundY(x, z),
      z,
      facing: opts.facing ?? 0,
      speed: 0,
      mode: opts.mode ?? 'walk',
      health: maxHealth,
      maxHealth,
      role: 'civ',
      weapon: 'none',
      look: this.rng.int(0, 1e9),
      money,
      hitSeq: 0,
      temper,
      target: null,
      action: null,
      actionSeq: 0,
    };
    const ped = new Ped(state, body, collider, this.rng);
    ped.from = opts.from ?? -1;
    ped.to = opts.to ?? -1;
    ped.ambient = opts.ambient ?? true;
    this.peds.set(id, ped);
    return ped;
  }

  removePed(id: number) {
    const p = this.peds.get(id);
    if (!p) return;
    this.physics.removeRigidBody(p.body);
    this.peds.delete(id);
  }

  spawnVehicle(type: VehicleType, x: number, y: number, z: number, yaw: number, driver: string, ambient: boolean, forcedId?: number): Vehicle {
    const R = this.R;
    const sp = VEHICLES[type];
    const id = forcedId ?? this.nextId++;
    const body = this.physics.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z).setRotation({ w: Math.cos(yaw / 2), x: 0, y: Math.sin(yaw / 2), z: 0 }),
    );
    const r = 0.25;
    const collider = this.physics.createCollider(
      R.ColliderDesc.roundCuboid(sp.width / 2 - r, sp.height * 0.32 - r, sp.length / 2 - r, r)
        .setTranslation(0, sp.height * 0.4, 0)
        .setCollisionGroups(groups(GROUP.VEHICLE, 0xffff & ~GROUP.BREAKABLE)),
      body,
    );
    const state: VehicleState = {
      id,
      type,
      x,
      y,
      z,
      yaw,
      pitch: 0,
      roll: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      speed: 0,
      steer: 0,
      health: sp.health,
      driver,
      fire: -1,
      wrecked: false,
      wheel: 0,
      braking: false,
      horn: -1,
      paint: this.rng.int(0, 7),
      siren: false,
    };
    const v = new Vehicle(state, body, collider);
    v.ambient = ambient;
    this.vehicles.set(id, v);
    return v;
  }

  removeVehicle(id: number) {
    const v = this.vehicles.get(id);
    if (!v) return;
    if (v.parkedSpot >= 0) this.parkedAlive.delete(v.parkedSpot);
    this.physics.removeRigidBody(v.body);
    this.vehicles.delete(id);
  }

  private buildProps() {
    const R = this.R;
    const body = this.physics.createRigidBody(R.RigidBodyDesc.fixed());
    const g = groups(GROUP.BREAKABLE, GROUP.PLAYER | GROUP.QUERY);
    for (const p of this.map.props) {
      const sh = PROP_SPECS[p.kind].shape;
      const desc =
        sh.kind === 'cyl'
          ? R.ColliderDesc.cylinder(sh.h / 2, sh.r).setTranslation(p.x, sh.h / 2, p.z)
          : R.ColliderDesc.cuboid(sh.sx / 2, sh.sy / 2, sh.sz / 2)
              .setTranslation(p.x, sh.sy / 2, p.z)
              .setRotation({ w: Math.cos(p.yaw / 2), x: 0, y: Math.sin(p.yaw / 2), z: 0 });
      this.propColliders.push(this.physics.createCollider(desc.setCollisionGroups(g), body));
    }
  }

  /** Multiplayer replica: mirror a prop broken on the host. */
  applyBrokenProp(b: BrokenProp) {
    if (this.props.applyRemote(b)) this.propColliders[b.id]?.setEnabled(false);
  }

  /** Breaks a street prop with a push; returns true if it was intact. */
  breakProp(i: number, vx: number, vz: number, up = 2, by?: Player): boolean {
    if (!this.props.break(i, vx, vz, up)) return false;
    this.propColliders[i]?.setEnabled(false);
    const d = this.map.props[i];
    this.events.push({ type: 'break', x: d.x, y: 0.8, z: d.z, kind: d.kind, prop: i });
    if (by) this.progress.onProp(by);
    return true;
  }

  private buildInteriors() {
    const R = this.R;
    const body = this.physics.createRigidBody(R.RigidBodyDesc.fixed());
    for (const def of this.map.interiors) {
      const room = roomLayout(def);
      this.rooms.set(def.id, room);
      for (const b of room.boxes) {
        if (b.deco) continue;
        this.physics.createCollider(
          R.ColliderDesc.cuboid(b.sx / 2, b.sy / 2, b.sz / 2).setTranslation(b.x, b.y, b.z).setCollisionGroups(groups(GROUP.STATIC, 0xffff)),
          body,
        );
      }
      if (room.clerk && this.role === 'authority') {
        const clerk = this.spawnPed(room.clerk.x, room.clerk.z, { ambient: false, mode: 'shopkeeper', facing: Math.PI });
        this.clerks.set(def.id, clerk.state.id);
      }
    }
  }

  // ------------------------------------------------------------------ step

  /** Advance one fixed tick with the commands for this tick. */
  step(commands: readonly Command[]): void {
    if (this.role === 'replica') {
      this.stepReplica(commands);
      return;
    }
    for (const c of commands) {
      const p = this.players.get(c.playerId);
      if (!p) continue;
      if (c.type === 'move') p.setInput(c);
      else this.handleAction(p, c.action, c.arg);
    }
    for (const p of this.players.values()) this.updatePlayer(p);
    for (const v of this.vehicles.values()) this.updateVehicle(v);
    for (const ped of this.peds.values()) {
      ped.savePrev();
      if (ped.state.mode === 'fight') this.pedFight(ped);
      ped.update(this.walk, this.rng);
      ped.state.y = this.groundY(ped.state.x, ped.state.z);
    }
    this.props.update((x, z) => this.groundY(x, z));
    this.collectPickups();
    this.police.update();
    this.missions.update();
    this.progress.update();
    this.contracts.update();
    if (this.tick % 20 === 0) this.managePopulation();
    for (const p of this.players.values()) p.state.context = this.computeContext(p);
    this.physics.step();
    this.tick++;
  }

  // ------------------------------------------------------------------ multiplayer

  /**
   * Replica tick (multiplayer client): only the local player (and the car they drive) are
   * simulated; everything else eases towards the host's last snapshot.
   */
  private stepReplica(commands: readonly Command[]) {
    for (const c of commands) if (c.type === 'move') this.players.get(c.playerId)?.setInput(c);
    for (const p of this.players.values()) {
      const s = p.state;
      p.savePrev();
      if (p.remote) {
        this.followNet(p);
        continue;
      }
      if (s.dead) continue;
      const v = s.vehicle >= 0 ? this.vehicles.get(s.vehicle) : undefined;
      if (v) {
        const inp = p.input;
        const stickThrottle = inp && Math.abs(inp.y) > 0.4 ? Math.sign(inp.y) : 0;
        v.input = { throttle: inp ? inp.throttle || stickThrottle : 0, steer: inp ? inp.x : 0, handbrake: !!inp?.handbrake };
        v.savePrev();
        const ctrl = v.state.type === 'offroad' ? this.offroadController : this.carController;
        const impact = v.update(ctrl, (x, z, y) => this.groundAt(x, z, y), groups(GROUP.VEHICLE, GROUP.STATIC | GROUP.VEHICLE | GROUP.PROP));
        if (impact > 0) {
          v.pendingDamage += (impact - 3) * 3.5;
          this.events.push({ type: 'impact', x: v.state.x, y: v.state.y + 0.8, z: v.state.z, strength: impact });
        }
        if (Math.abs(v.state.speed) > 1.2) this.vehicleProps(v);
        s.x = v.state.x;
        s.y = v.state.y;
        s.z = v.state.z;
        s.facing = v.state.yaw;
        s.speed = Math.abs(v.state.speed);
        s.anim = 'drive';
        continue;
      }
      p.update(this.controller);
      if (s.y < this.map.killY) {
        const sp = this.map.spawn;
        p.teleport(sp.x, sp.y, sp.z);
        this.events.push({ type: 'respawn', playerId: s.id, reason: 'drowned' });
      }
    }
    const mine = new Set([...this.players.values()].filter((p) => !p.remote).map((p) => p.state.vehicle));
    for (const v of this.vehicles.values()) {
      if (mine.has(v.state.id)) continue;
      v.savePrev();
      v.followNet();
    }
    for (const ped of this.peds.values()) {
      ped.savePrev();
      ped.followNet();
    }
    for (const h of this.police.helis.values()) {
      h.savePrev();
      const n = h.net;
      if (!n) continue;
      const hs = h.state;
      hs.x += (n.x - hs.x) * 0.25;
      hs.y += (n.y - hs.y) * 0.25;
      hs.z += (n.z - hs.z) * 0.25;
      hs.yaw += angleDiff(hs.yaw, n.yaw) * 0.25;
      hs.rotor += DT * (hs.down < 0 ? 40 : 10);
    }
    this.props.update((x, z) => this.groundY(x, z));
    this.physics.step();
    this.tick++;
  }

  /** Remote player: glide towards the last reported position (dead reckoning between reports). */
  private followNet(p: Player) {
    const s = p.state;
    const n = p.net;
    if (!n.has) return;
    n.x += n.vx * DT;
    n.z += n.vz * DT;
    const k = 0.35;
    s.x += (n.x - s.x) * k;
    s.y += (n.y - s.y) * k;
    s.z += (n.z - s.z) * k;
    let df = (n.facing - s.facing) % (Math.PI * 2);
    if (df > Math.PI) df -= Math.PI * 2;
    if (df < -Math.PI) df += Math.PI * 2;
    s.facing += df * k;
    if (Math.hypot(n.x - s.x, n.z - s.z) > 8) {
      s.x = n.x;
      s.y = n.y;
      s.z = n.z;
    }
    p.body.setNextKinematicTranslation({ x: s.x, y: s.y, z: s.z });
  }

  /** Host side: position report from a remote player (ignored until they applied our last teleport). */
  applyPlayerReport(id: string, r: PlayerReport) {
    const p = this.players.get(id);
    if (!p || r.tp < p.state.teleportSeq) return;
    const s = p.state;
    Object.assign(p.net, { x: r.x, y: r.y, z: r.z, facing: r.f, vx: r.vx, vz: r.vz, has: true });
    s.vx = r.vx;
    s.vz = r.vz;
    s.anim = r.anim;
    s.grounded = r.g;
    s.speed = r.sp;
    if (p.input) p.input.yaw = r.yaw;
    else p.input = { type: 'move', playerId: id, tick: this.tick, x: 0, y: 0, yaw: r.yaw, sprint: false, jump: false, throttle: 0, handbrake: false };
    if (r.v && s.vehicle === r.v.id) {
      const v = this.vehicles.get(r.v.id);
      if (v) {
        v.setNet(r.v);
        v.state.health -= r.v.dmg;
      }
    }
  }

  private updatePlayer(p: Player) {
    const s = p.state;
    p.savePrev();
    if (p.attackCooldown > 0) p.attackCooldown -= DT;
    if (p.remote) {
      // Multiplayer guest: movement comes from their reports, the host resolves the rest
      if (s.vehicle < 0 && !s.dead) this.followNet(p);
      else if (s.vehicle >= 0) {
        const v = this.vehicles.get(s.vehicle);
        if (v) {
          s.x = v.state.x;
          s.y = v.state.y;
          s.z = v.state.z;
          s.facing = v.state.yaw;
        }
      }
      if (s.dead) {
        p.respawnTimer -= DT;
        if (p.respawnTimer <= 0) this.respawnAtHospital(p);
        return;
      }
      if (p.pendingHit > 0 && --p.pendingHit === 0) this.resolveMelee(p);
      this.updateRobbery(p);
      return;
    }
    if (s.dead) {
      p.respawnTimer -= DT;
      s.anim = 'ko';
      if (p.respawnTimer <= 0) this.respawnAtHospital(p);
      return;
    }
    if (s.vehicle >= 0) {
      const v = this.vehicles.get(s.vehicle);
      if (!v) {
        this.leaveVehicle(p);
        return;
      }
      const inp = p.input;
      const stickThrottle = inp && Math.abs(inp.y) > 0.4 ? Math.sign(inp.y) : 0;
      v.input = {
        throttle: inp ? inp.throttle || stickThrottle : 0,
        steer: inp ? inp.x : 0,
        handbrake: !!inp?.handbrake,
      };
      // the player rides along (position used by the camera and population code)
      s.x = v.state.x;
      s.y = v.state.y;
      s.z = v.state.z;
      s.facing = v.state.yaw;
      s.speed = Math.abs(v.state.speed);
      s.anim = 'drive';
      return;
    }
    p.update(this.controller);
    if (p.pendingHit > 0 && --p.pendingHit === 0) this.resolveMelee(p);
    if (s.y < this.map.killY) {
      const sp = this.map.spawn;
      p.teleport(sp.x, sp.y, sp.z);
      this.events.push({ type: 'respawn', playerId: s.id, reason: 'drowned' });
    }
    this.updateRobbery(p);
  }

  private updateVehicle(v: Vehicle) {
    const s = v.state;
    v.savePrev();
    const remoteDriver = s.driver !== 'npc' && s.driver !== 'none' ? this.players.get(s.driver) : undefined;
    if (remoteDriver?.remote) {
      // driven by a guest: follow their reports, still hit people and props on the host
      v.followNet();
      if (Math.abs(s.speed) > 2.5) this.vehicleHits(v);
      if (Math.abs(s.speed) > 1.2) this.vehicleProps(v);
      if (!s.wrecked && s.health <= 0) {
        if (s.fire < 0) s.fire = 4;
        s.fire -= DT;
        if (s.fire <= 0) this.explode(v);
      }
      return;
    }
    if (s.driver === 'npc') this.driveAI(v);
    else if (s.driver === 'none') v.input = { throttle: 0, steer: 0, handbrake: true };
    const parkedStill = s.driver === 'none' && Math.abs(s.speed) < 0.05 && v.grounded && s.vy <= 0 && !s.wrecked;
    if (!parkedStill) {
      const ctrl = s.type === 'offroad' ? this.offroadController : this.carController;
      // cars bump into walls, trees and other cars; they run over people and plow through props
      const impact = v.update(ctrl, (x, z, y) => this.groundAt(x, z, y), groups(GROUP.VEHICLE, GROUP.STATIC | GROUP.VEHICLE | GROUP.PROP));
      if (impact > 0) {
        s.health -= (impact - 3) * 3.5;
        this.events.push({ type: 'impact', x: s.x, y: s.y + 0.8, z: s.z, strength: impact });
        if (s.driver !== 'npc' && s.driver !== 'none') {
          const p = this.players.get(s.driver);
          if (p && impact > 14) this.damagePlayer(p, (impact - 14) * 2);
        }
      }
      if (Math.abs(s.speed) > 2.5) this.vehicleHits(v);
      if (Math.abs(s.speed) > 1.2) this.vehicleProps(v);
    }
    if (s.y < this.map.killY - 2 && !s.wrecked) {
      s.wrecked = true;
      s.health = 0;
      const p = s.driver !== 'npc' && s.driver !== 'none' ? this.players.get(s.driver) : undefined;
      if (p) {
        this.leaveVehicle(p);
        const sp = this.map.spawn;
        this.teleportPlayer(p, sp.x, sp.y, sp.z);
        this.events.push({ type: 'respawn', playerId: p.state.id, reason: 'drowned' });
      }
    }
    // Damage states: smoke < 30 %, fire at 0 then explosion
    if (!s.wrecked && s.health <= 0) {
      if (s.fire < 0) s.fire = 4;
      s.fire -= DT;
      if (s.fire <= 0) this.explode(v);
    }
  }

  // ------------------------------------------------------------------ vehicles AI & hits

  private driveAI(v: Vehicle) {
    const s = v.state;
    if (v.lane < 0) {
      v.input = { throttle: 0, steer: 0, handbrake: true };
      return;
    }
    let lane = this.lanes.lanes[v.lane];
    let t = (s.x - lane.ax) * lane.dx + (s.z - lane.az) * lane.dz;
    if (t > lane.length - 1.5) {
      lane = nextLane(this.lanes, lane, this.rng.next());
      v.lane = lane.id;
      t = (s.x - lane.ax) * lane.dx + (s.z - lane.az) * lane.dz;
    }
    const look = Math.min(lane.length, Math.max(0, t) + 7);
    const tx = lane.ax + lane.dx * look;
    const tz = lane.az + lane.dz * look;
    const desired = Math.atan2(-(tx - s.x), -(tz - s.z));
    const diff = angleDiff(s.yaw, desired);
    let target = lane.speed * (Math.abs(diff) > 0.35 ? 0.45 : 1);
    if (this.maxWanted >= 3) target *= 1.15;
    if (v.rush > 1) target = Math.min(target * v.rush, Math.max(target, 19));
    // Brake for anything in front
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    const check = (x: number, z: number, radius: number, side = 1.4 + radius) => {
      const dx = x - s.x;
      const dz = z - s.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < 0 || ahead > 16) return;
      const lateral = Math.abs(dx * fz - dz * fx);
      if (lateral < side) target = Math.min(target, Math.max(0, (ahead - 4.5 - radius) * 1.3));
    };
    for (const o of this.vehicles.values()) {
      if (o === v) continue;
      // a car parallel to us only takes its width sideways (parked cars along the curb)
      const sp = VEHICLES[o.state.type];
      const parallel = Math.abs(Math.sin(angleDiff(o.state.yaw, s.yaw)));
      check(o.state.x, o.state.z, sp.length / 2, v.spec.width / 2 - 0.05 + sp.width / 2 + ((sp.length - sp.width) / 2) * parallel);
    }
    if (v.rush <= 1) {
      for (const pd of this.peds.values()) if (pd.alive && pd.state.mode !== 'shopkeeper') check(pd.state.x, pd.state.z, 0.3);
      for (const pl of this.players.values()) if (pl.state.vehicle < 0 && !pl.state.interior) check(pl.state.x, pl.state.z, 0.4);
    }
    const speed = s.speed;
    v.input = {
      throttle: speed < target - 0.5 ? 1 : speed > target + 0.8 ? -0.7 : 0,
      steer: Math.max(-1, Math.min(1, -diff * 2.4)),
      handbrake: target === 0 && speed < 0.5,
    };
    if (target === 0 && this.tick % 240 === 0 && this.rng.chance(0.3)) {
      s.horn = this.tick;
      this.events.push({ type: 'horn', vehicle: s.id });
    }
  }

  private vehicleHits(v: Vehicle) {
    const s = v.state;
    const sp = v.spec;
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    const inside = (x: number, z: number, pad: number) => {
      const dx = x - s.x;
      const dz = z - s.z;
      const lf = dx * fx + dz * fz;
      const lr = dx * fz - dz * fx;
      return Math.abs(lf) < sp.length / 2 + pad && Math.abs(lr) < sp.width / 2 + pad;
    };
    const speed = Math.abs(s.speed);
    const byPlayer = s.driver !== 'npc' && s.driver !== 'none' ? this.players.get(s.driver) : undefined;
    for (const ped of this.peds.values()) {
      if (!ped.alive || ped.state.mode === 'shopkeeper' || !inside(ped.state.x, ped.state.z, 0.4)) continue;
      ped.kvx = s.vx * 0.9 + fz * 1.5;
      ped.kvz = s.vz * 0.9 - fx * 1.5;
      this.damagePed(ped, speed * 9, byPlayer ?? null, s.x, s.z);
      if (byPlayer) this.crime(byPlayer, 'hit_and_run', ped.state.x, ped.state.z, ped);
    }
    for (const p of this.players.values()) {
      if (p.state.vehicle >= 0 || p.state.dead || !inside(p.state.x, p.state.z, 0.4)) continue;
      if (speed > 4) {
        this.damagePlayer(p, speed * 3);
        p.state.vx = s.vx * 0.8;
        p.state.vz = s.vz * 0.8;
        p.state.vy = 4;
      }
    }
  }

  /** Cars plow through street furniture: the prop breaks, the car loses some speed. */
  private vehicleProps(v: Vehicle) {
    const s = v.state;
    const sp = v.spec;
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    for (const i of this.props.near(s.x, s.z, sp.length / 2 + 1, this.scratch)) {
      const d = this.map.props[i];
      const r = this.props.radius(i);
      const dx = d.x - s.x;
      const dz = d.z - s.z;
      const lf = dx * fx + dz * fz;
      const lr = dx * fz - dz * fx;
      if (Math.abs(lf) > sp.length / 2 + r || Math.abs(lr) > sp.width / 2 + r) continue;
      const spec = PROP_SPECS[d.kind];
      // push along the car's motion, a bit outwards
      const side = lr > 0 ? 1 : -1;
      const driver = s.driver !== 'npc' && s.driver !== 'none' ? this.players.get(s.driver) : undefined;
      if (!this.breakProp(i, s.vx * 1.1 + fz * side * 2, s.vz * 1.1 - fx * side * 2, 2 + Math.abs(s.speed) * 0.2, driver)) continue;
      s.vx *= spec.carKeep;
      s.vz *= spec.carKeep;
      s.health -= spec.carDamage;
    }
  }

  private explode(v: Vehicle) {
    const s = v.state;
    const culprit = this.players.get(s.driver) ?? (v.lastHitBy ? this.players.get(v.lastHitBy) : undefined);
    if (culprit) this.progress.onExplode(culprit, v);
    s.wrecked = true;
    s.fire = -1;
    s.health = 0;
    if (s.driver !== 'none' && s.driver !== 'npc' && s.driver !== 'police') {
      const p = this.players.get(s.driver);
      if (p) {
        this.leaveVehicle(p);
        this.damagePlayer(p, 120);
      }
    }
    s.driver = 'none';
    this.blast(s.x, s.y, s.z, 7, 150, v);
  }

  /** Explosion at (x, y, z): hurts people, cars, helicopters and breaks props around. */
  blast(x: number, y: number, z: number, radius: number, damage: number, source?: Vehicle) {
    this.events.push({ type: 'explosion', x, y: y + 1, z });
    for (const ped of this.peds.values()) {
      const d = Math.hypot(ped.state.x - x, ped.state.z - z);
      if (d < radius) {
        ped.kvx = ((ped.state.x - x) / (d + 0.1)) * 8;
        ped.kvz = ((ped.state.z - z) / (d + 0.1)) * 8;
        this.damagePed(ped, damage, null, x, z);
      } else if (d < 45) ped.scare(x, z, this.rng.chance(0.3));
    }
    for (const p of this.players.values()) {
      if (p.state.vehicle >= 0) continue;
      const d = Math.hypot(p.state.x - x, p.state.z - z);
      if (d < radius) this.damagePlayer(p, 90 * (1 - d / radius));
    }
    for (const o of this.vehicles.values()) {
      if (o === source || o.state.wrecked) continue;
      const d = Math.hypot(o.state.x - x, o.state.z - z);
      if (d < radius) o.state.health -= 80 * (1 - d / radius);
    }
    for (const i of [...this.props.near(x, z, radius, this.scratch)]) {
      const p = this.map.props[i];
      const d = Math.hypot(p.x - x, p.z - z) + 0.1;
      if (d < radius) this.breakProp(i, ((p.x - x) / d) * 12, ((p.z - z) / d) * 12, 8, source?.lastHitBy ? this.players.get(source.lastHitBy) : undefined);
    }
  }

  /** New entity id (shared counter for peds, vehicles, helicopters, pickups). */
  newId() {
    return this.nextId++;
  }

  /** Moves a walker (police officer) with collisions against walls, props and cars. */
  moveWalker(ped: Ped, vx: number, vz: number) {
    const s = ped.state;
    if (vx !== 0 || vz !== 0) {
      this.controller.computeColliderMovement(ped.collider, { x: vx * DT, y: 0, z: vz * DT }, undefined, groups(GROUP.PED, GROUP.STATIC | GROUP.PROP | GROUP.BREAKABLE | GROUP.VEHICLE));
      const m = this.controller.computedMovement();
      s.x += m.x;
      s.z += m.z;
    }
    s.speed = Math.hypot(vx, vz);
  }

  /** Police lost track of the player. */
  clearWanted(p: Player, message?: string) {
    const s = p.state;
    if (s.wanted === 0 && !message) return;
    s.wanted = 0;
    s.wantedCooldown = 0;
    s.wantedSeen = false;
    s.arrest = 0;
    this.events.push({ type: 'wanted', playerId: s.id, level: 0 });
    if (message) this.toast(p, message);
  }

  /** Busted: taken to the police station, fined, firearms confiscated. */
  arrest(p: Player) {
    const s = p.state;
    const fine = Math.floor(s.money * 0.15);
    s.money -= fine;
    for (const w of WEAPON_ORDER) if (!WEAPONS[w].melee) s.ammo[w] = 0;
    s.weapon = 'fist';
    this.clearWanted(p);
    s.robbery = -1;
    p.robberyTarget = null;
    const station = this.map.interiors.find((i) => i.kind === 'police');
    if (station) {
      const fx = -Math.sin(station.door.yaw);
      const fz = -Math.cos(station.door.yaw);
      this.teleportPlayer(p, station.door.x + fx * 2, 0.3, station.door.z + fz * 2, station.door.yaw);
    }
    this.events.push({ type: 'busted', playerId: s.id });
    this.progress.breakCombo(p);
    if (s.mission) this.missions.abort(p, 'Mission échouée : arrêté');
    this.toast(p, `ARRÊTÉ ! Amende -${fine.toLocaleString('fr-FR')} €, armes confisquées`);
  }

  // ------------------------------------------------------------------ actions

  private handleAction(p: Player, action: string, arg?: string) {
    const s = p.state;
    if (s.dead) return;
    switch (action) {
      case 'attack':
        this.attack(p);
        break;
      case 'weapon': {
        const i = WEAPON_ORDER.indexOf(s.weapon);
        for (let k = 1; k <= WEAPON_ORDER.length; k++) {
          const w = WEAPON_ORDER[(i + k) % WEAPON_ORDER.length];
          if (s.weapons.includes(w) && (WEAPONS[w].melee || s.ammo[w] > 0)) {
            s.weapon = w;
            break;
          }
        }
        break;
      }
      case 'buy':
        if (arg) this.buy(p, arg);
        break;
      case 'wear':
        if (arg) this.wear(p, arg);
        break;
      case 'garage_out':
        this.garageOut(p, Number(arg));
        break;
      case 'mission':
        if (arg === 'abort') this.missions.abort(p);
        else if (arg) this.missions.start(p, arg);
        break;
      case 'horn':
        if (s.vehicle >= 0) {
          const v = this.vehicles.get(s.vehicle);
          if (v) v.state.horn = this.tick;
          this.events.push({ type: 'horn', vehicle: s.vehicle });
        }
        break;
      case 'use':
        this.use(p);
        break;
    }
  }

  private use(p: Player) {
    const s = p.state;
    const ctx = this.computeContext(p);
    if (!ctx) return;
    switch (ctx.kind) {
      case 'exit_vehicle':
        this.leaveVehicle(p);
        break;
      case 'enter_vehicle':
      case 'steal_vehicle':
        this.enterVehicle(p, ctx.target as number);
        break;
      case 'enter_building': {
        const def = this.interior(ctx.target as string)!;
        const room = this.rooms.get(def.id)!;
        s.interior = def.id;
        this.teleportPlayer(p, room.spawn.x, 0.2, room.spawn.z, 0);
        this.toast(p, def.name);
        break;
      }
      case 'exit_building': {
        const def = this.interior(s.interior!)!;
        s.interior = null;
        p.robberyTarget = null;
        s.robbery = -1;
        const fx = -Math.sin(def.door.yaw);
        const fz = -Math.cos(def.door.yaw);
        this.teleportPlayer(p, def.door.x + fx * 1.6, 0.2, def.door.z + fz * 1.6, def.door.yaw);
        break;
      }
      case 'rob':
        p.robberyTarget = s.interior;
        p.robberyTime = 0;
        s.action = 'interact';
        s.actionSeq++;
        {
          const clerk = this.peds.get(this.clerks.get(s.interior!) ?? -1);
          if (clerk && clerk.alive) {
            clerk.state.mode = 'cower';
            clerk.timer = 12;
          }
        }
        this.toast(p, 'Braquage ! Reste près du comptoir…');
        break;
      case 'talk': {
        const ped = this.peds.get(ctx.target as number);
        if (ped) {
          if (ped.state.mode !== 'shopkeeper') {
            ped.state.mode = 'wave';
            ped.timer = 2.5;
          }
          ped.state.facing = Math.atan2(-(s.x - ped.state.x), -(s.z - ped.state.z));
          this.toast(p, `« ${TALK_LINES[this.rng.int(0, TALK_LINES.length - 1)]} »`);
        }
        break;
      }
      case 'repaint': {
        if (s.money < REPAINT_PRICE) {
          this.toast(p, `Il te faut ${REPAINT_PRICE} € pour repeindre`);
          break;
        }
        s.money -= REPAINT_PRICE;
        const v = this.vehicles.get(s.vehicle);
        if (v) v.state.paint = (v.state.paint + 1) % 8;
        this.clearWanted(p, 'Voiture repeinte : la police ne te reconnaît plus');
        break;
      }
      case 'travel':
        this.toast(p, '✈ Bientôt disponible : Amérique latine, Afrique, Île, Asie');
        break;
      case 'buy_home':
        this.buy(p, `home:${ctx.target}`);
        break;
      case 'store_vehicle':
        this.storeVehicle(p);
        break;
      case 'mission':
        this.missions.start(p, ctx.target as string);
        break;
      case 'fence':
        this.contracts.sell(p);
        break;
    }
  }

  private enterVehicle(p: Player, id: number) {
    const v = this.vehicles.get(id);
    if (!v || v.state.wrecked) return;
    const s = p.state;
    if (v.state.driver === 'police') {
      // stealing a cop car: the officer gets out and fights
      const rx = Math.cos(v.state.yaw);
      const rz = -Math.sin(v.state.yaw);
      const cop = this.spawnPed(v.state.x - rx * (v.spec.width / 2 + 0.9), v.state.z - rz * (v.spec.width / 2 + 0.9), { mode: 'police' });
      cop.state.role = 'cop';
      cop.state.weapon = 'pistol';
      cop.police = { target: s.id, cooldown: 1, leaving: false };
      v.police = null;
      v.state.siren = false;
      this.crime(p, 'attack_cop', s.x, s.z, null, true);
    } else if (v.state.driver === 'npc') {
      // Carjacking: the driver is thrown out and runs away
      const rx = Math.cos(v.state.yaw);
      const rz = -Math.sin(v.state.yaw);
      const ped = this.spawnPed(v.state.x - rx * (v.spec.width / 2 + 0.9), v.state.z - rz * (v.spec.width / 2 + 0.9));
      const near = this.nearestWalkNode(ped.state.x, ped.state.z);
      ped.to = near;
      ped.from = near;
      ped.scare(s.x, s.z, false);
      this.crime(p, 'carjack', s.x, s.z, ped);
    }
    if (v.parkedSpot >= 0) {
      this.parkedGone.add(v.parkedSpot);
      this.parkedAlive.delete(v.parkedSpot);
      v.parkedSpot = -1;
    }
    v.state.driver = s.id;
    v.ambient = false;
    v.lane = -1;
    v.touchedTick = this.tick;
    s.vehicle = id;
    s.weapon = s.weapon === 'rifle' ? 'pistol' : s.weapon;
    p.collider.setEnabled(false);
    s.action = 'interact';
    s.actionSeq++;
  }

  /** Public: put a driver back on foot (fence, missions). */
  leaveVehicleOf(p: Player) {
    if (p.state.vehicle >= 0) this.leaveVehicle(p);
  }

  private leaveVehicle(p: Player) {
    const s = p.state;
    const v = this.vehicles.get(s.vehicle);
    s.vehicle = -1;
    p.collider.setEnabled(true);
    if (!v) return;
    v.state.driver = 'none';
    v.touchedTick = this.tick;
    const rx = Math.cos(v.state.yaw);
    const rz = -Math.sin(v.state.yaw);
    const side = v.spec.width / 2 + 0.7;
    // try the driver side (left), then the right side
    for (const k of [-1, 1]) {
      const x = v.state.x + rx * side * k;
      const z = v.state.z + rz * side * k;
      if (this.castStatic(v.state.x, v.state.y + 1, v.state.z, rx * k, 0, rz * k, side + 0.4) > side + 0.3) {
        this.teleportPlayer(p, x, v.state.y + 0.3, z, v.state.yaw);
        return;
      }
    }
    this.teleportPlayer(p, v.state.x, v.state.y + v.spec.height + 0.3, v.state.z, v.state.yaw);
  }

  private computeContext(p: Player): ContextAction | null {
    const s = p.state;
    if (s.dead) return null;
    if (s.vehicle >= 0) {
      const home = this.homeNear(p, 16);
      const v = this.vehicles.get(s.vehicle);
      const sale = this.contracts.context(p);
      if (sale) return sale;
      if (home && v && !v.police && v.state.type !== 'army') return { kind: 'store_vehicle', label: 'Garer au garage', target: home.id };
      const garage = this.map.pois.find((q) => q.kind === 'garage');
      if (garage && s.wanted > 0 && Math.hypot(garage.x - s.x, garage.z - s.z) < 14) return { kind: 'repaint', label: `Repeindre · ${REPAINT_PRICE} €`, target: s.vehicle };
      return { kind: 'exit_vehicle', label: 'Sortir', target: s.vehicle };
    }
    if (s.interior) {
      const room = this.rooms.get(s.interior)!;
      const def = this.interior(s.interior)!;
      if (Math.hypot(s.x - room.exit.x, s.z - room.exit.z) < 2.4) return { kind: 'exit_building', label: 'Sortir', target: s.interior };
      if (room.wardrobe && Math.hypot(s.x - room.wardrobe.x, s.z - room.wardrobe.z) < 2) return { kind: 'wardrobe', label: 'Garde-robe', target: def.id };
      if (room.garage && Math.hypot(s.x - room.garage.x, s.z - room.garage.z) < 2) return { kind: 'garage', label: 'Mon garage', target: def.id };
      if (room.counter && Math.hypot(s.x - room.counter.x, s.z - room.counter.z) < 3) {
        const clerk = this.peds.get(this.clerks.get(def.id) ?? -1);
        if (clerk?.alive && (def.kind === 'gunshop' || def.kind === 'clothes' || def.kind === 'dealer')) return { kind: 'shop', label: 'Acheter', target: def.kind };
        const robbable = ['shop', 'bank', 'jewelry'].includes(def.kind);
        const last = p.lastRobbery.get(def.id) ?? -1e9;
        if (robbable && s.weapon !== 'fist' && clerk?.alive && p.robberyTarget === null && this.tick - last > 60 * 120) {
          return { kind: 'rob', label: 'Braquer', target: def.id };
        }
        if (clerk?.alive) return { kind: 'talk', label: 'Parler', target: clerk.state.id };
      }
      return null;
    }
    const job = this.missions.context(p);
    if (job) return job;
    // Vehicles
    let best: Vehicle | null = null;
    let bd = Infinity;
    for (const v of this.vehicles.values()) {
      if (v.state.wrecked || (v.state.driver !== 'none' && v.state.driver !== 'npc' && v.state.driver !== 'police')) continue;
      const d = Math.hypot(v.state.x - s.x, v.state.z - s.z) - v.spec.length / 2;
      if (d < 1.6 && d < bd && Math.abs(v.state.y - s.y) < 2) {
        bd = d;
        best = v;
      }
    }
    if (best) {
      const name = best.spec.name;
      return best.state.driver === 'npc' || best.state.driver === 'police'
        ? { kind: 'steal_vehicle', label: `Voler`, target: best.state.id }
        : { kind: 'enter_vehicle', label: `Monter · ${name}`, target: best.state.id };
    }
    for (const def of this.map.interiors) {
      if (Math.hypot(def.door.x - s.x, def.door.z - s.z) >= 2.6) continue;
      if (def.kind === 'apartment' && !s.homes.includes(def.id)) {
        return { kind: 'buy_home', label: `Acheter · ${(APARTMENT_PRICES[def.id] ?? 0).toLocaleString('fr-FR')} €`, target: def.id };
      }
      return { kind: 'enter_building', label: 'Entrer', target: def.id };
    }
    const airport = this.map.pois.find((q) => q.kind === 'airport');
    if (airport && Math.hypot(airport.x - s.x, airport.z - s.z) < 5) return { kind: 'travel', label: 'Voyager', target: airport.id };
    for (const ped of this.peds.values()) {
      if (!ped.alive || ['flee', 'cower', 'fight', 'stun'].includes(ped.state.mode)) continue;
      if (Math.hypot(ped.state.x - s.x, ped.state.z - s.z) < 1.8) return { kind: 'talk', label: 'Parler', target: ped.state.id };
    }
    return null;
  }

  /** An owned home (hideout / bought apartment) whose door is within r. */
  private homeNear(p: Player, r: number): InteriorDef | undefined {
    return this.map.interiors.find((d) => p.state.homes.includes(d.kind === 'hideout' ? 'hideout' : d.id) && (d.kind === 'hideout' || d.kind === 'apartment') && Math.hypot(d.door.x - p.state.x, d.door.z - p.state.z) < r);
  }

  /** Purchases: weapons, ammo, vest (gun shop), clothes, cars (dealer), apartments. */
  private buy(p: Player, item: string) {
    const s = p.state;
    const [kind, id] = item.split(':');
    const inside = s.interior ? this.interior(s.interior)?.kind : undefined;
    const pay = (price: number, what: string) => {
      if (s.money < price) {
        this.toast(p, `Pas assez d'argent (${price.toLocaleString('fr-FR')} €)`);
        return false;
      }
      s.money -= price;
      this.toast(p, `${what} : -${price.toLocaleString('fr-FR')} €`);
      return true;
    };
    const need = requiredLevel(item);
    if (levelOf(s.rep) < need) {
      this.toast(p, `🔒 Débloqué au niveau ${need}`);
      return;
    }
    if (kind === 'weapon' && inside === 'gunshop' && id in WEAPONS) {
      const w = id as WeaponId;
      const spec = WEAPONS[w];
      if (s.weapons.includes(w) || spec.price <= 0 || !pay(spec.price, spec.name)) return;
      s.weapons.push(w);
      s.ammo[w] += spec.ammoPack;
      s.weapon = w;
    } else if (kind === 'ammo' && inside === 'gunshop' && id in WEAPONS) {
      const w = id as WeaponId;
      const spec = WEAPONS[w];
      if (!s.weapons.includes(w) || spec.melee || !pay(spec.ammoPrice, `Munitions ${spec.name}`)) return;
      s.ammo[w] += spec.ammoPack;
    } else if (kind === 'armor' && inside === 'gunshop') {
      if (s.armor >= 100 || !pay(ARMOR_PRICE, 'Gilet pare-balles')) return;
      s.armor = 100;
    } else if (kind === 'cloth' && inside === 'clothes') {
      const c = CLOTHES.find((x) => x.id === id);
      if (!c) return;
      if (!s.clothes.includes(c.id)) {
        if (!pay(c.price, c.name)) return;
        s.clothes.push(c.id);
      }
      s.outfit = { ...s.outfit, ...c.set };
    } else if (kind === 'car' && inside === 'dealer') {
      const o = VEHICLE_OFFERS.find((x) => x.type === id);
      if (!o) return;
      if (s.garage.length >= GARAGE_SLOTS) {
        this.toast(p, 'Ton garage est plein');
        return;
      }
      if (!pay(o.price, VEHICLES[o.type].name)) return;
      s.garage.push({ type: o.type, paint: this.rng.int(0, 7) });
      this.toast(p, `${VEHICLES[o.type].name} livrée à ta planque`);
    } else if (kind === 'home' && id in APARTMENT_PRICES) {
      if (s.homes.includes(id)) return;
      const def = this.interior(id);
      if (!def || Math.hypot(def.door.x - s.x, def.door.z - s.z) > 4) return;
      if (!pay(APARTMENT_PRICES[id], def.name)) return;
      s.homes.push(id);
      this.toast(p, `Bienvenue chez toi : ${def.name} !`);
    }
  }

  private wear(p: Player, id: string) {
    const s = p.state;
    const def = s.interior ? this.interior(s.interior) : undefined;
    const c = CLOTHES.find((x) => x.id === id);
    if (!c || !def || (def.kind !== 'hideout' && def.kind !== 'apartment' && def.kind !== 'clothes')) return;
    if (c.price !== 0 && !s.clothes.includes(id)) return;
    s.outfit = { ...s.outfit, ...c.set };
  }

  /** Drive a vehicle into your home garage: it is kept (max GARAGE_SLOTS). */
  private storeVehicle(p: Player) {
    const s = p.state;
    const v = this.vehicles.get(s.vehicle);
    if (!v) return;
    if (s.garage.length >= GARAGE_SLOTS) {
      this.toast(p, `Garage plein (${GARAGE_SLOTS} véhicules)`);
      return;
    }
    s.garage.push({ type: v.state.type, paint: v.state.paint });
    this.leaveVehicle(p);
    this.removeVehicle(v.state.id);
    this.toast(p, `${v.spec.name} rangée au garage`);
  }

  /** Take a stored vehicle out: you step outside, already at the wheel. */
  private garageOut(p: Player, index: number) {
    const s = p.state;
    const def = s.interior ? this.interior(s.interior) : undefined;
    const slot = s.garage[index];
    if (!def || !slot || (def.kind !== 'hideout' && def.kind !== 'apartment')) return;
    s.garage.splice(index, 1);
    const fx = -Math.sin(def.door.yaw);
    const fz = -Math.cos(def.door.yaw);
    s.interior = null;
    const v = this.spawnVehicle(slot.type, def.door.x + fx * 8, 0.4, def.door.z + fz * 8, def.door.yaw + Math.PI / 2, 'none', false);
    v.state.paint = slot.paint;
    v.touchedTick = this.tick;
    this.teleportPlayer(p, v.state.x, 0.4, v.state.z, def.door.yaw);
    this.enterVehicle(p, v.state.id);
  }

  private interior(id: string): InteriorDef | undefined {
    return this.map.interiors.find((i) => i.id === id);
  }

  private updateRobbery(p: Player) {
    const s = p.state;
    if (!p.robberyTarget) return;
    const room = this.rooms.get(p.robberyTarget)!;
    const def = this.interior(p.robberyTarget)!;
    if (s.interior !== def.id || !room.counter || Math.hypot(s.x - room.counter.x, s.z - room.counter.z) > 6) {
      p.robberyTarget = null;
      s.robbery = -1;
      this.toast(p, 'Braquage raté !');
      return;
    }
    p.robberyTime += DT;
    const duration = def.kind === 'bank' ? 10 : def.kind === 'jewelry' ? 8 : 5;
    s.robbery = Math.min(1, p.robberyTime / duration);
    if (p.robberyTime >= duration) {
      const amount = def.kind === 'bank' ? this.rng.int(4000, 8000) : def.kind === 'jewelry' ? this.rng.int(1500, 3000) : this.rng.int(250, 700);
      s.money += amount;
      this.events.push({ type: 'money', playerId: s.id, amount });
      p.lastRobbery.set(def.id, this.tick);
      p.robberyTarget = null;
      s.robbery = -1;
      this.crime(p, def.kind === 'shop' ? 'robbery_shop' : 'robbery_big', s.x, s.z, null, true);
      this.toast(p, `Butin : +${amount.toLocaleString('fr-FR')} € — file !`);
      this.missions.onRobbery(p, def.id);
      this.progress.onRobbery(p, def.kind === 'shop');
    }
  }

  // ------------------------------------------------------------------ combat

  private attack(p: Player) {
    const s = p.state;
    if (s.vehicle >= 0 || p.attackCooldown > 0) return;
    let weapon: WeaponId = s.weapon;
    if (weapon !== 'fist' && s.ammo[weapon] <= 0) {
      s.weapon = weapon = 'fist';
      this.toast(p, 'Plus de munitions');
    }
    const spec = WEAPONS[weapon];
    p.attackCooldown = spec.cooldown;
    s.actionSeq++;
    if (spec.melee) {
      s.action = weapon === 'fist' ? (s.actionSeq % 3 === 0 ? 'kick' : 'punch') : spec.anim === 'stab' ? 'stab' : 'swing';
      // Melee assist: lock on the closest target around and lunge at it
      const target = this.meleeTarget(p, 3.4);
      p.meleeLock = target;
      if (target) {
        const dx = target.x - s.x;
        const dz = target.z - s.z;
        const d = Math.hypot(dx, dz);
        s.facing = Math.atan2(-dx, -dz);
        if (d > 1.1) {
          const v = Math.min(10, (d - 1.0) / 0.12);
          s.vx = (dx / d) * v;
          s.vz = (dz / d) * v;
          p.lungeTicks = 7;
        }
      }
      p.pendingHit = 7;
      return;
    }
    // auto-aim in the camera's field of view (where the player is looking)
    const aimYaw = p.input?.yaw ?? s.facing;
    const target = this.autoAim(p, aimYaw, spec.range, spec.aimCone);
    if (target) s.facing = Math.atan2(-(target.x - s.x), -(target.z - s.z));
    else if (s.speed < 0.5) s.facing = aimYaw;
    s.action = spec.anim === 'shoot2' ? 'shoot2' : 'shoot';
    s.ammo[weapon]--;
    const fx = s.x - Math.sin(s.facing) * 0.6;
    const fy = s.y + 1.35;
    const fz = s.z - Math.cos(s.facing) * 0.6;
    let tx: number;
    let ty: number;
    let tz: number;
    let hit = false;
    if (target) {
      tx = target.x;
      ty = target.y;
      tz = target.z;
    } else {
      const dx = -Math.sin(s.facing);
      const dz = -Math.cos(s.facing);
      const d = this.castStatic(fx, fy, fz, dx, 0, dz, spec.range);
      tx = fx + dx * d;
      ty = fy;
      tz = fz + dz * d;
    }
    // a fragile prop on the bullet's path takes the hit (bins fly, hydrants burst…)
    const blocker = this.propOnSegment(fx, fz, tx, tz);
    if (blocker) {
      const len = Math.hypot(tx - fx, tz - fz) || 1;
      this.breakProp(blocker.i, ((tx - fx) / len) * 7, ((tz - fz) / len) * 7, 3, p);
      tx = blocker.x;
      tz = blocker.z;
      ty = 0.6;
    } else if (target) {
      hit = true;
      // shotguns: all pellets hit up close, fewer far away
      const d = Math.hypot(tx - s.x, tz - s.z);
      const dmg = spec.pellets ? spec.damage * spec.pellets * Math.max(0.15, Math.min(1, 1.25 - d / spec.range)) : spec.damage;
      this.hitTarget(p, target, dmg, false);
      if (spec.pellets) for (let k = 1; k < 4; k++) this.events.push({ type: 'shot', fx, fy, fz, tx: tx + this.rng.range(-1, 1), ty: ty + this.rng.range(-0.5, 0.5), tz: tz + this.rng.range(-1, 1), hit: false });
    }
    this.events.push({ type: 'shot', fx, fy, fz, tx, ty, tz, hit });
    this.crime(p, 'gunshot', s.x, s.z, null, true);
    for (const ped of this.peds.values()) {
      if (ped.state.mode !== 'fight' && Math.hypot(ped.state.x - s.x, ped.state.z - s.z) < 40) ped.scare(s.x, s.z, this.rng.chance(0.35));
    }
  }

  /** Closest fragile prop crossing the 2D segment a→b. */
  private propOnSegment(ax: number, az: number, bx: number, bz: number) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.1) return null;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    let best: { i: number; x: number; z: number; t: number } | null = null;
    for (let t = 0; t < len + 6; t += 10) {
      for (const i of this.props.near(ax + ux * Math.min(t, len), az + uz * Math.min(t, len), 6, this.scratch)) {
        const d = this.map.props[i];
        if (!PROP_SPECS[d.kind].fragile) continue;
        const along = (d.x - ax) * ux + (d.z - az) * uz;
        if (along < 0.3 || along > len) continue;
        const off = Math.abs((d.x - ax) * uz - (d.z - az) * ux);
        if (off < this.props.radius(i) + 0.15 && (!best || along < best.t)) best = { i, x: d.x, z: d.z, t: along };
      }
    }
    return best;
  }

  /** Everything a player can hit: pedestrians, other players, cars (guns only). */
  private targets(p: Player, withVehicles: boolean): Target[] {
    const out: Target[] = [];
    const s = p.state;
    for (const ped of this.peds.values()) if (ped.alive) out.push({ x: ped.state.x, y: ped.state.y + 1.1, z: ped.state.z, ped });
    for (const o of this.players.values()) {
      if (o === p || o.state.dead || o.state.vehicle >= 0 || o.state.interior !== s.interior) continue;
      out.push({ x: o.state.x, y: o.state.y + 1.1, z: o.state.z, player: o });
    }
    if (withVehicles) {
      for (const v of this.vehicles.values()) if (!v.state.wrecked && v.state.driver !== s.id) out.push({ x: v.state.x, y: v.state.y + 0.9, z: v.state.z, vehicle: v });
      for (const h of this.police.helis.values()) if (h.state.down < 0) out.push({ x: h.state.x, y: h.state.y, z: h.state.z, heli: h.state });
    }
    return out;
  }

  private meleeTarget(p: Player, range: number): Target | null {
    const s = p.state;
    const fx = -Math.sin(s.facing);
    const fz = -Math.cos(s.facing);
    let best: Target | null = null;
    let bestScore = Infinity;
    for (const t of this.targets(p, false)) {
      const dx = t.x - s.x;
      const dz = t.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > range || Math.abs(t.y - 1.1 - s.y) > 1.5) continue;
      const cos = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      const score = d * (1.6 - cos * 0.6);
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  private autoAim(p: Player, yaw: number, range: number, cone: number): Target | null {
    const s = p.state;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    let best: Target | null = null;
    let bestScore = Infinity;
    for (const t of this.targets(p, true)) {
      const dx = t.x - s.x;
      const dz = t.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > range || d < 0.1) continue;
      const cos = (dx * fx + dz * fz) / d;
      if (cos < Math.cos(cone)) continue;
      // people first, cars only if nobody is in the cone
      const score = d * (2 - cos) + (t.vehicle ? 60 : 0);
      if (score >= bestScore) continue;
      if (d > 2 && this.castStatic(s.x, s.y + 1.3, s.z, dx / d, (t.y - s.y - 1.3) / d, dz / d, d) < d - 0.5) continue;
      bestScore = score;
      best = t;
    }
    return best;
  }

  private resolveMelee(p: Player) {
    const s = p.state;
    let t = p.meleeLock as Target | null;
    p.meleeLock = null;
    // the locked target must still be in reach (generous), otherwise take whoever is in front
    if (t) {
      const cur = t.ped ? t.ped.state : t.player?.state;
      if (!cur || Math.hypot(cur.x - s.x, cur.z - s.z) > 2.4 || (t.ped && !t.ped.alive) || (t.player && t.player.state.dead)) t = null;
    }
    t ??= this.meleeTarget(p, 2.0);
    if (!t) {
      // nobody around: kick the closest fragile prop in front (bins, bollards, benches…)
      const fx = -Math.sin(s.facing);
      const fz = -Math.cos(s.facing);
      for (const i of this.props.near(s.x + fx, s.z + fz, 1.3, this.scratch)) {
        if (PROP_SPECS[this.map.props[i].kind].fragile) {
          this.breakProp(i, fx * 7, fz * 7, 3, p);
          break;
        }
      }
      return;
    }
    const cur = (t.ped ? t.ped.state : t.player!.state) as { x: number; y: number; z: number };
    const fx = -Math.sin(s.facing);
    const fz = -Math.cos(s.facing);
    if (t.ped) {
      t.ped.kvx = fx * 2.2;
      t.ped.kvz = fz * 2.2;
    }
    this.events.push({ type: 'punch', x: cur.x, y: cur.y + 1.3, z: cur.z });
    const spec = WEAPONS[s.weapon].melee ? WEAPONS[s.weapon] : WEAPONS.fist;
    if (t.ped && spec.knock) {
      t.ped.kvx = fx * spec.knock;
      t.ped.kvz = fz * spec.knock;
    }
    this.hitTarget(p, t, s.action === 'kick' ? spec.damage * 1.3 : spec.damage, true);
    for (const o of this.peds.values()) if (o !== t.ped && Math.hypot(o.state.x - s.x, o.state.z - s.z) < 14) o.scare(s.x, s.z, false);
  }

  private hitTarget(p: Player, t: Target, damage: number, melee: boolean) {
    const s = p.state;
    if (t.ped) {
      const cop = t.ped.state.role !== 'civ';
      const wasAlive = t.ped.alive;
      this.damagePed(t.ped, damage, p, s.x, s.z);
      s.lastHit = t.ped.state.id;
      s.lastHitTick = this.tick;
      if (cop) {
        // the first hit on an officer and taking one down each add a star
        if (s.wanted === 0 || (wasAlive && !t.ped.alive) || !melee) this.crime(p, 'attack_cop', t.ped.state.x, t.ped.state.z, null, true);
        else this.police.reported(p, s.x, s.z);
        if (t.ped.police) t.ped.police.target = s.id;
      } else this.crime(p, t.ped.alive ? (melee ? 'assault' : 'shoot_person') : 'knockout', t.ped.state.x, t.ped.state.z, t.ped, !melee);
    } else if (t.player) {
      this.damagePlayer(t.player, damage * 0.8);
    } else if (t.vehicle) {
      t.vehicle.state.health -= damage * 0.8;
      t.vehicle.lastHitBy = s.id;
    } else if (t.heli) {
      t.heli.health -= damage;
      const h = this.police.helis.get(t.heli.id);
      if (h) h.lastHitBy = s.id;
      if (s.wanted < 3) this.crime(p, 'attack_cop', s.x, s.z, null, true);
    }
  }

  /** Pedestrians who fight back: chase the attacker and throw punches. */
  private pedFight(ped: Ped) {
    const s = ped.state;
    const target = s.target ? this.players.get(s.target) : undefined;
    const ts = target?.state;
    if (!ts || ts.dead || ts.vehicle >= 0 || ts.interior || Math.hypot(ts.x - s.x, ts.z - s.z) > 25) {
      s.mode = 'walk';
      s.target = null;
      ped.to = ped.from = this.nearestWalkNode(s.x, s.z);
      return;
    }
    ped.chase.x = ts.x;
    ped.chase.z = ts.z;
    ped.chase.stop = 1.15;
    const d = Math.hypot(ts.x - s.x, ts.z - s.z);
    if (ped.pendingHit > 0 && --ped.pendingHit === 0) {
      if (d < 1.9) {
        this.events.push({ type: 'punch', x: ts.x, y: ts.y + 1.3, z: ts.z });
        this.damagePlayer(target!, s.action === 'kick' ? 11 : 8);
      }
    }
    if (d < 1.6 && ped.attackCooldown <= 0 && ped.pendingHit <= 0) {
      s.actionSeq++;
      s.action = s.actionSeq % 3 === 0 ? 'kick' : 'punch';
      ped.pendingHit = 14;
      ped.attackCooldown = this.rng.range(0.9, 1.4);
    }
  }

  damagePed(ped: Ped, amount: number, by: Player | null, fromX: number, fromZ: number) {
    if (!ped.alive) return;
    ped.state.health -= amount;
    ped.state.hitSeq++;
    if (by) {
      const ko = ped.state.health <= 0;
      this.events.push({ type: 'dmg', playerId: by.state.id, x: ped.state.x, y: ped.state.y + 2, z: ped.state.z, amount: Math.round(amount), ko });
      if (ko) {
        this.progress.onKo(by, ped);
        this.missions.onKo(by);
      } else this.progress.chaos(by, 5);
    }
    if (ped.state.health <= 0) {
      ped.state.health = 0;
      ped.state.mode = 'ko';
      ped.state.target = null;
      ped.timer = 0;
      ped.state.facing = Math.atan2(-(fromX - ped.state.x), -(fromZ - ped.state.z));
      if (ped.state.money > 0) {
        const id = this.nextId++;
        this.pickups.set(id, { id, x: ped.state.x + 0.6, y: ped.state.y, z: ped.state.z, kind: 'money', amount: ped.state.money });
        ped.state.money = 0;
      }
    } else if (ped.state.mode === 'shopkeeper') {
      ped.state.mode = 'cower';
      ped.timer = 6;
    } else if (ped.state.role === 'civ') ped.hurt(by?.state.id ?? null, fromX, fromZ);
  }

  /** Ground height for walkers (park hills), cheap: terrain lookup, no raycast. */
  groundY(x: number, z: number) {
    return this.map.terrain ? terrainHeight(this.map.terrain, x, z) : 0;
  }

  damagePlayer(p: Player, amount: number) {
    const s = p.state;
    if (s.dead) return;
    const absorbed = Math.min(s.armor, amount * 0.7);
    s.armor -= absorbed;
    s.health -= amount - absorbed;
    s.action = 'hit';
    s.actionSeq++;
    if (s.health <= 0) {
      s.health = 0;
      s.dead = true;
      p.respawnTimer = 3.5;
      if (s.vehicle >= 0) this.leaveVehicle(p);
      this.toast(p, 'K.O. !');
    }
  }

  private respawnAtHospital(p: Player) {
    const s = p.state;
    const h = this.map.interiors.find((i) => i.kind === 'hospital');
    const lost = Math.floor(s.money * 0.1);
    s.money -= lost;
    s.health = 100;
    s.dead = false;
    s.interior = null;
    s.weapon = 'fist';
    s.wanted = 0;
    s.wantedCooldown = 0;
    if (h) {
      const fx = -Math.sin(h.door.yaw);
      const fz = -Math.cos(h.door.yaw);
      this.teleportPlayer(p, h.door.x + fx * 2, 0.3, h.door.z + fz * 2, h.door.yaw);
    } else this.teleportPlayer(p, this.map.spawn.x, 1, this.map.spawn.z);
    this.events.push({ type: 'respawn', playerId: s.id, reason: 'hospital' });
    this.toast(p, `Hôpital Sainte-Aube : soins -${lost.toLocaleString('fr-FR')} €`);
  }

  // ------------------------------------------------------------------ wanted level

  private crime(p: Player, kind: Crime, x: number, z: number, victim: Ped | null, always = false) {
    let witnessed = always;
    if (!witnessed) {
      for (const ped of this.peds.values()) {
        if (ped !== victim && ped.alive && ped.ambient && Math.hypot(ped.state.x - x, ped.state.z - z) < 30) {
          witnessed = true;
          break;
        }
      }
    }
    if (!witnessed) return;
    const s = p.state;
    const before = s.wanted;
    switch (kind) {
      case 'assault':
      case 'carjack':
      case 'gunshot':
      case 'hit_and_run':
        s.wanted = Math.max(s.wanted, 1);
        break;
      case 'shoot_person':
        s.wanted = Math.max(s.wanted, 2);
        break;
      case 'knockout':
        s.wanted = Math.min(5, Math.max(2, s.wanted + 1));
        break;
      case 'robbery_shop':
        s.wanted = Math.max(s.wanted, 2);
        break;
      case 'robbery_big':
        s.wanted = Math.max(s.wanted, 3);
        break;
      case 'attack_cop':
        s.wanted = Math.min(5, Math.max(1, s.wanted + 1));
        break;
    }
    s.wantedCooldown = WANTED_DECAY;
    this.police.reported(p, x, z);
    if (s.wanted !== before) this.events.push({ type: 'wanted', playerId: s.id, level: s.wanted });
  }



  // ------------------------------------------------------------------ pickups & population

  private collectPickups() {
    for (const p of this.players.values()) {
      const s = p.state;
      if (s.dead) continue;
      const r = s.vehicle >= 0 ? 3 : 1.6;
      for (const pk of this.pickups.values()) {
        if (Math.hypot(pk.x - s.x, pk.z - s.z) < r && Math.abs(pk.y - s.y) < 2.5) {
          this.pickups.delete(pk.id);
          if (pk.kind === 'crate') {
            this.openCrate(p);
            continue;
          }
          s.money += pk.amount;
          this.events.push({ type: 'money', playerId: s.id, amount: pk.amount });
        }
      }
    }
  }

  /** Surprise crate: mostly cash, sometimes ammo or armor, rarely a better weapon. */
  private openCrate(p: Player) {
    const s = p.state;
    this.contracts.track(p, 'crate', 1);
    this.progress.addXp(p, 15);
    const roll = this.rng.next();
    const guns = s.weapons.filter((w) => !WEAPONS[w].melee);
    const next = WEAPON_ORDER.find((w) => !s.weapons.includes(w) && WEAPONS[w].price > 0);
    if (roll < 0.05 && next) {
      s.weapons.push(next);
      s.ammo[next] += WEAPONS[next].ammoPack;
      this.events.push({ type: 'crate', playerId: s.id, text: `JACKPOT : ${WEAPONS[next].name} !`, rare: true });
    } else if (roll < 0.15 && s.armor < 100) {
      s.armor = Math.min(100, s.armor + 50);
      this.events.push({ type: 'crate', playerId: s.id, text: 'Gilet pare-balles +50', rare: false });
    } else if (roll < 0.4 && guns.length) {
      const w = guns[this.rng.int(0, guns.length - 1)];
      s.ammo[w] += WEAPONS[w].ammoPack;
      this.events.push({ type: 'crate', playerId: s.id, text: `Munitions ${WEAPONS[w].name} +${WEAPONS[w].ammoPack}`, rare: false });
    } else {
      // cash, with a small chance of a big pile
      const amount = this.rng.chance(0.1) ? this.rng.int(1000, 2500) : this.rng.int(100, 450);
      s.money += amount;
      this.events.push({ type: 'money', playerId: s.id, amount });
      this.events.push({ type: 'crate', playerId: s.id, text: `+${amount.toLocaleString('fr-FR')} €`, rare: amount >= 1000 });
    }
  }

  private managePopulation() {
    const centers = [...this.players.values()].filter((p) => !p.state.interior).map((p) => p.state);
    const near = (x: number, z: number, r: number) => centers.some((c) => Math.hypot(c.x - x, c.z - z) < r);
    // --- pedestrians
    for (const ped of [...this.peds.values()]) {
      if (!ped.ambient || ped.state.role !== 'civ') continue;
      if (!near(ped.state.x, ped.state.z, 140) || (!ped.alive && ped.timer > 45)) this.removePed(ped.state.id);
    }
    for (const pk of [...this.pickups.values()]) if (!near(pk.x, pk.z, 200)) this.pickups.delete(pk.id);
    if (centers.length === 0) return;
    // --- surprise crates: about 2 around each player, 40–120 m away on sidewalks
    for (const c of centers) {
      let around = 0;
      for (const pk of this.pickups.values()) if (pk.kind === 'crate' && Math.hypot(pk.x - c.x, pk.z - c.z) < 150) around++;
      if (around >= 2 || !this.rng.chance(0.12)) continue;
      const ring = this.walk.filter((q) => {
        const d = Math.hypot(q.x - c.x, q.z - c.z);
        return d > 40 && d < 120;
      });
      if (!ring.length) continue;
      const n = ring[this.rng.int(0, ring.length - 1)];
      const id = this.nextId++;
      this.pickups.set(id, { id, x: n.x, y: this.groundY(n.x, n.z), z: n.z, kind: 'crate', amount: 0 });
    }
    let ambient = 0;
    for (const ped of this.peds.values()) if (ped.ambient && ped.state.role === 'civ') ambient++;
    const ring = (x: number, z: number, r0: number, r1: number) =>
      centers.some((c) => {
        const d = Math.hypot(c.x - x, c.z - z);
        return d > r0 && d < r1;
      }) && !near(x, z, r0);
    const walkCandidates = ambient < this.density.peds ? this.walk.filter((n) => n.links.length > 0 && ring(n.x, n.z, 25, 110)) : [];
    for (let tries = 0; ambient < this.density.peds && walkCandidates.length > 0 && tries < 8; tries++) {
      const n = walkCandidates[this.rng.int(0, walkCandidates.length - 1)];
      const to = n.links[this.rng.int(0, n.links.length - 1)];
      const t = this.rng.next();
      const m = this.walk[to];
      const ped = this.spawnPed(n.x + (m.x - n.x) * t, n.z + (m.z - n.z) * t, { from: n.id, to });
      if (this.rng.chance(0.04)) {
        // VIP: dressed rich, loaded with cash
        ped.state.vip = true;
        ped.state.money = this.rng.int(600, 1500);
      }
      ambient++;
    }
    // --- traffic
    let traffic = 0;
    for (const v of [...this.vehicles.values()]) {
      const recent = v.touchedTick >= 0 && this.tick - v.touchedTick < 60 * 90;
      const far = !near(v.state.x, v.state.z, v.parkedSpot >= 0 ? this.density.parkedRadius + 30 : 190);
      const driven = v.state.driver !== 'none' && v.state.driver !== 'npc';
      if (!driven && far && !recent && (v.ambient || v.state.wrecked)) {
        this.removeVehicle(v.state.id);
        continue;
      }
      if (v.state.driver === 'npc') traffic++;
    }
    const laneCandidates =
      traffic < this.density.traffic ? this.lanes.lanes.filter((l) => ring((l.ax + l.bx) / 2, (l.az + l.bz) / 2, 50, 160)) : [];
    for (let tries = 0; traffic < this.density.traffic && laneCandidates.length > 0 && tries < 6; tries++) {
      const lane = laneCandidates[this.rng.int(0, laneCandidates.length - 1)];
      const t = this.rng.range(0.2, 0.8) * lane.length;
      const x = lane.ax + lane.dx * t;
      const z = lane.az + lane.dz * t;
      if (!ring(x, z, 45, 170)) continue;
      if ([...this.vehicles.values()].some((v) => Math.hypot(v.state.x - x, v.state.z - z) < 12)) continue;
      const type = this.pickType();
      const v = this.spawnVehicle(type, x, 0.3, z, Math.atan2(-lane.dx, -lane.dz), 'npc', true);
      if (type !== 'moto' && this.rng.chance(0.025)) {
        v.state.paint = GOLD_PAINT;
        for (const pl of this.players.values()) if (Math.hypot(pl.state.x - x, pl.state.z - z) < 170) this.toast(pl, '🌟 Une voiture DORÉE roule dans le coin : le receleur la paie 5 000 € !');
      }
      v.lane = lane.id;
      v.state.vx = lane.dx * lane.speed * 0.7;
      v.state.vz = lane.dz * lane.speed * 0.7;
      traffic++;
    }
    // --- parked cars near the players
    const R2 = this.density.parkedRadius;
    this.map.parking.forEach((spot, i) => {
      if (this.parkedAlive.has(i) || this.parkedGone.has(i)) return;
      if (!near(spot.x, spot.z, R2)) return;
      if ([...this.vehicles.values()].some((v) => Math.hypot(v.state.x - spot.x, v.state.z - spot.z) < 5)) return;
      const r = new Rng(this.map.seed + i * 7919);
      let type = this.pickType(r);
      if (type === 'offroad') type = 'wagon';
      const v = this.spawnVehicle(type, spot.x, 0.3, spot.z, spot.yaw, 'none', true);
      v.state.paint = r.int(0, 7);
      v.parkedSpot = i;
      this.parkedAlive.set(i, v.state.id);
    });
  }

  private pickType(r: Rng = this.rng): VehicleType {
    const total = TRAFFIC_MIX.reduce((a, [, w]) => a + w, 0);
    let x = r.next() * total;
    for (const [t, w] of TRAFFIC_MIX) {
      x -= w;
      if (x <= 0) return t;
    }
    return 'compact';
  }

  nearestWalkNode(x: number, z: number) {
    let best = 0;
    let bd = Infinity;
    for (const n of this.walk) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) {
        bd = d;
        best = n.id;
      }
    }
    return best;
  }

  toast(p: Player, text: string) {
    this.events.push({ type: 'toast', playerId: p.state.id, text });
  }

  // ------------------------------------------------------------------ queries

  /** Height of static ground below (x, z), searching down from y + 2. */
  groundAt(x: number, z: number, y: number): number | null {
    const ray = new this.R.Ray({ x, y: y + 2, z }, { x: 0, y: -1, z: 0 });
    const hit = this.physics.castRay(ray, 6, true, undefined, groups(GROUP.QUERY, GROUP.STATIC));
    return hit ? y + 2 - hit.timeOfImpact : null;
  }

  /** Read-only ray query against static geometry (used by the camera). Returns hit distance or maxDist. */
  castStatic(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number {
    const ray = new this.R.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.physics.castRay(ray, maxDist, true, undefined, groups(GROUP.QUERY, GROUP.STATIC));
    return hit ? hit.timeOfImpact : maxDist;
  }

  snapshot(): WorldSnapshot {
    return {
      tick: this.tick,
      mapId: this.map.id,
      players: [...this.players.values()].map((p) => structuredCloneState(p.state)),
      peds: [...this.peds.values()].map((p) => ({ ...p.state })),
      vehicles: [...this.vehicles.values()].map((v) => ({ ...v.state })),
      pickups: [...this.pickups.values()].map((p) => ({ ...p })),
      props: this.props.snapshot(),
      helis: [...this.police.helis.values()].map((h) => ({ ...h.state })),
    };
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

function structuredCloneState(s: PlayerState): PlayerState {
  return { ...s, ammo: { ...s.ammo }, context: s.context ? { ...s.context } : null, waypoint: s.waypoint ? [...s.waypoint] : null, missionTargets: [...s.missionTargets] };
}

export type { MoveCommand };
