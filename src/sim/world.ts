import type RAPIER_T from '@dimforge/rapier3d-compat';
import type { Command, MoveCommand } from '../core/commands';
import { DT } from '../core/loop';
import { Rng } from '../core/rng';
import { TRAFFIC_MIX, VEHICLES, type VehicleType } from '../data/vehicles';
import { WEAPON_ORDER, WEAPONS, type WeaponId } from '../data/weapons';
import { terrainHeight } from '../maps/terrain';
import type { InteriorDef, MapData } from '../maps/types';
import { buildStaticColliders } from './colliders';
import { roomLayout, type RoomLayout } from './interiors';
import { buildLaneGraph, buildSidewalkGraph, nextLane, type LaneGraph, type WalkNode } from './nav';
import { Ped, type PedState } from './peds';
import { PROP_SPECS, PropField, type BrokenProp } from './props';
import { GROUP, groups, initPhysics } from './physics';
import { angleDiff, Player, PLAYER_TUNING, type ContextAction, type PlayerState } from './player';
import { Vehicle, type VehicleState } from './vehicle';

export interface PickupState {
  id: number;
  x: number;
  y: number;
  z: number;
  kind: 'money';
  amount: number;
}

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
  wanted: WantedState;
  props: BrokenProp[];
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
  | { type: 'wanted'; level: number }
  | { type: 'break'; x: number; y: number; z: number; kind: string; prop: number };

export interface Density {
  peds: number;
  traffic: number;
  parkedRadius: number;
}

/** Something a player can hit. */
interface Target {
  x: number;
  y: number;
  z: number;
  ped?: Ped;
  player?: Player;
  vehicle?: Vehicle;
}

type Crime = 'assault' | 'gunshot' | 'shoot_person' | 'knockout' | 'carjack' | 'robbery_shop' | 'robbery_big' | 'hit_and_run';

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
  readonly wanted: WantedState = { level: 0, heat: 0, cooldown: 0 };
  events: SimEvent[] = [];
  staticColliderCount = 0;
  density: Density = { peds: 22, traffic: 12, parkedRadius: 75 };
  readonly lanes: LaneGraph;
  readonly walk: WalkNode[];
  readonly rooms = new Map<string, RoomLayout>();
  readonly props: PropField;
  private propColliders: RAPIER_T.Collider[] = [];
  private scratch: number[] = [];
  private rng: Rng;
  private nextId = 1;
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
  ) {
    this.rng = new Rng(map.seed ^ 0x5eed);
    this.controller = this.makeController(50, 0.45);
    this.carController = this.makeController(32, 0.25);
    this.offroadController = this.makeController(52, 0.45);
    this.staticColliderCount = buildStaticColliders(R, physics, map);
    this.lanes = buildLaneGraph(map);
    this.walk = buildSidewalkGraph(map);
    this.buildInteriors();
    this.props = new PropField(map.props);
    this.buildProps();
    for (const f of map.featured) this.spawnVehicle(f.type as VehicleType, f.x, 0.3, f.z, f.yaw, 'none', false);
    physics.step(); // build the query structures once
  }

  static async create(map: MapData): Promise<SimWorld> {
    const R = await initPhysics();
    const physics = new R.World({ x: 0, y: -9.81 * 2, z: 0 });
    physics.timestep = 1 / 60;
    return new SimWorld(R, physics, map);
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

  spawnPed(x: number, z: number, opts: { from?: number; to?: number; ambient?: boolean; mode?: PedState['mode']; facing?: number } = {}): Ped {
    const R = this.R;
    const id = this.nextId++;
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

  spawnVehicle(type: VehicleType, x: number, y: number, z: number, yaw: number, driver: string, ambient: boolean): Vehicle {
    const R = this.R;
    const sp = VEHICLES[type];
    const id = this.nextId++;
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

  /** Breaks a street prop with a push; returns true if it was intact. */
  breakProp(i: number, vx: number, vz: number, up = 2): boolean {
    if (!this.props.break(i, vx, vz, up)) return false;
    this.propColliders[i]?.setEnabled(false);
    const d = this.map.props[i];
    this.events.push({ type: 'break', x: d.x, y: 0.8, z: d.z, kind: d.kind, prop: i });
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
      if (room.clerk) {
        const clerk = this.spawnPed(room.clerk.x, room.clerk.z, { ambient: false, mode: 'shopkeeper', facing: Math.PI });
        this.clerks.set(def.id, clerk.state.id);
      }
    }
  }

  // ------------------------------------------------------------------ step

  /** Advance one fixed tick with the commands for this tick. */
  step(commands: readonly Command[]): void {
    for (const c of commands) {
      const p = this.players.get(c.playerId);
      if (!p) continue;
      if (c.type === 'move') p.setInput(c);
      else this.handleAction(p, c.action);
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
    this.updateWanted();
    if (this.tick % 20 === 0) this.managePopulation();
    for (const p of this.players.values()) p.state.context = this.computeContext(p);
    this.physics.step();
    this.tick++;
  }

  private updatePlayer(p: Player) {
    const s = p.state;
    p.savePrev();
    if (p.attackCooldown > 0) p.attackCooldown -= DT;
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
        p.teleport(sp.x, sp.y, sp.z);
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
    if (this.wanted.level >= 3) target *= 1.15;
    // Brake for anything in front
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    const check = (x: number, z: number, radius: number) => {
      const dx = x - s.x;
      const dz = z - s.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < 0 || ahead > 16) return;
      const lateral = Math.abs(dx * fz - dz * fx);
      if (lateral < 1.4 + radius) target = Math.min(target, Math.max(0, (ahead - 4.5 - radius) * 1.3));
    };
    for (const o of this.vehicles.values()) if (o !== v) check(o.state.x, o.state.z, VEHICLES[o.state.type].length / 2);
    for (const pd of this.peds.values()) if (pd.alive && pd.state.mode !== 'shopkeeper') check(pd.state.x, pd.state.z, 0.3);
    for (const pl of this.players.values()) if (pl.state.vehicle < 0 && !pl.state.interior) check(pl.state.x, pl.state.z, 0.4);
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
      if (!this.breakProp(i, s.vx * 1.1 + fz * side * 2, s.vz * 1.1 - fx * side * 2, 2 + Math.abs(s.speed) * 0.2)) continue;
      s.vx *= spec.carKeep;
      s.vz *= spec.carKeep;
      s.health -= spec.carDamage;
    }
  }

  private explode(v: Vehicle) {
    const s = v.state;
    s.wrecked = true;
    s.fire = -1;
    s.health = 0;
    this.events.push({ type: 'explosion', x: s.x, y: s.y + 1, z: s.z });
    if (s.driver !== 'none' && s.driver !== 'npc') {
      const p = this.players.get(s.driver);
      if (p) {
        this.leaveVehicle(p);
        this.damagePlayer(p, 120);
      }
    }
    s.driver = 'none';
    for (const ped of this.peds.values()) {
      const d = Math.hypot(ped.state.x - s.x, ped.state.z - s.z);
      if (d < 7) {
        ped.kvx = ((ped.state.x - s.x) / (d + 0.1)) * 8;
        ped.kvz = ((ped.state.z - s.z) / (d + 0.1)) * 8;
        this.damagePed(ped, 150, null, s.x, s.z);
      } else if (d < 45) ped.scare(s.x, s.z, this.rng.chance(0.3));
    }
    for (const p of this.players.values()) {
      if (p.state.vehicle >= 0) continue;
      const d = Math.hypot(p.state.x - s.x, p.state.z - s.z);
      if (d < 7) this.damagePlayer(p, 90 * (1 - d / 7));
    }
    for (const o of this.vehicles.values()) {
      if (o === v || o.state.wrecked) continue;
      const d = Math.hypot(o.state.x - s.x, o.state.z - s.z);
      if (d < 7) o.state.health -= 80 * (1 - d / 7);
    }
    for (const i of [...this.props.near(s.x, s.z, 7, this.scratch)]) {
      const p = this.map.props[i];
      const d = Math.hypot(p.x - s.x, p.z - s.z) + 0.1;
      if (d < 7) this.breakProp(i, ((p.x - s.x) / d) * 12, ((p.z - s.z) / d) * 12, 8);
    }
  }

  // ------------------------------------------------------------------ actions

  private handleAction(p: Player, action: string) {
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
          if (w === 'fist' || s.ammo[w] > 0) {
            s.weapon = w;
            break;
          }
        }
        break;
      }
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
        p.teleport(room.spawn.x, 0.2, room.spawn.z, 0);
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
        p.teleport(def.door.x + fx * 1.6, 0.2, def.door.z + fz * 1.6, def.door.yaw);
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
      case 'travel':
        this.toast(p, '✈ Bientôt disponible : Amérique latine, Afrique, Île, Asie');
        break;
    }
  }

  private enterVehicle(p: Player, id: number) {
    const v = this.vehicles.get(id);
    if (!v || v.state.wrecked) return;
    const s = p.state;
    if (v.state.driver === 'npc') {
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
        p.teleport(x, v.state.y + 0.3, z, v.state.yaw);
        return;
      }
    }
    p.teleport(v.state.x, v.state.y + v.spec.height + 0.3, v.state.z, v.state.yaw);
  }

  private computeContext(p: Player): ContextAction | null {
    const s = p.state;
    if (s.dead) return null;
    if (s.vehicle >= 0) return { kind: 'exit_vehicle', label: 'Sortir', target: s.vehicle };
    if (s.interior) {
      const room = this.rooms.get(s.interior)!;
      const def = this.interior(s.interior)!;
      if (Math.hypot(s.x - room.exit.x, s.z - room.exit.z) < 2.4) return { kind: 'exit_building', label: 'Sortir', target: s.interior };
      if (room.counter && Math.hypot(s.x - room.counter.x, s.z - room.counter.z) < 3) {
        const clerk = this.peds.get(this.clerks.get(def.id) ?? -1);
        const robbable = ['shop', 'bank', 'jewelry'].includes(def.kind);
        const last = p.lastRobbery.get(def.id) ?? -1e9;
        if (robbable && s.weapon !== 'fist' && clerk?.alive && p.robberyTarget === null && this.tick - last > 60 * 120) {
          return { kind: 'rob', label: 'Braquer', target: def.id };
        }
        if (clerk?.alive) return { kind: 'talk', label: 'Parler', target: clerk.state.id };
      }
      return null;
    }
    // Vehicles
    let best: Vehicle | null = null;
    let bd = Infinity;
    for (const v of this.vehicles.values()) {
      if (v.state.wrecked || (v.state.driver !== 'none' && v.state.driver !== 'npc')) continue;
      const d = Math.hypot(v.state.x - s.x, v.state.z - s.z) - v.spec.length / 2;
      if (d < 1.6 && d < bd && Math.abs(v.state.y - s.y) < 2) {
        bd = d;
        best = v;
      }
    }
    if (best) {
      const name = best.spec.name;
      return best.state.driver === 'npc'
        ? { kind: 'steal_vehicle', label: `Voler`, target: best.state.id }
        : { kind: 'enter_vehicle', label: `Monter · ${name}`, target: best.state.id };
    }
    for (const def of this.map.interiors) {
      if (Math.hypot(def.door.x - s.x, def.door.z - s.z) < 2.6) return { kind: 'enter_building', label: 'Entrer', target: def.id };
    }
    const airport = this.map.pois.find((q) => q.kind === 'airport');
    if (airport && Math.hypot(airport.x - s.x, airport.z - s.z) < 5) return { kind: 'travel', label: 'Voyager', target: airport.id };
    for (const ped of this.peds.values()) {
      if (!ped.alive || ped.state.mode === 'flee' || ped.state.mode === 'cower') continue;
      if (Math.hypot(ped.state.x - s.x, ped.state.z - s.z) < 1.8) return { kind: 'talk', label: 'Parler', target: ped.state.id };
    }
    return null;
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
      s.action = s.actionSeq % 3 === 0 ? 'kick' : 'punch';
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
    const aimYaw = s.speed > 0.5 ? s.facing : p.input?.yaw ?? s.facing;
    const target = this.autoAim(p, aimYaw, spec.range, spec.aimCone);
    if (target) s.facing = Math.atan2(-(target.x - s.x), -(target.z - s.z));
    else if (s.speed < 0.5) s.facing = aimYaw;
    s.action = 'shoot';
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
      this.breakProp(blocker.i, ((tx - fx) / len) * 7, ((tz - fz) / len) * 7, 3);
      tx = blocker.x;
      tz = blocker.z;
      ty = 0.6;
    } else if (target) {
      hit = true;
      this.hitTarget(p, target, spec.damage, false);
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
    if (withVehicles) for (const v of this.vehicles.values()) if (!v.state.wrecked && v.state.driver !== s.id) out.push({ x: v.state.x, y: v.state.y + 0.9, z: v.state.z, vehicle: v });
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
          this.breakProp(i, fx * 7, fz * 7, 3);
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
    this.hitTarget(p, t, s.action === 'kick' ? WEAPONS.fist.damage * 1.3 : WEAPONS.fist.damage, true);
    for (const o of this.peds.values()) if (o !== t.ped && Math.hypot(o.state.x - s.x, o.state.z - s.z) < 14) o.scare(s.x, s.z, false);
  }

  private hitTarget(p: Player, t: Target, damage: number, melee: boolean) {
    const s = p.state;
    if (t.ped) {
      this.damagePed(t.ped, damage, p, s.x, s.z);
      s.lastHit = t.ped.state.id;
      s.lastHitTick = this.tick;
      this.crime(p, t.ped.alive ? (melee ? 'assault' : 'shoot_person') : 'knockout', t.ped.state.x, t.ped.state.z, t.ped);
    } else if (t.player) {
      this.damagePlayer(t.player, damage * 0.8);
    } else if (t.vehicle) t.vehicle.state.health -= damage * 0.8;
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
    } else ped.hurt(by?.state.id ?? null, fromX, fromZ);
  }

  /** Ground height for walkers (park hills), cheap: terrain lookup, no raycast. */
  private groundY(x: number, z: number) {
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
    this.wanted.level = 0;
    this.wanted.heat = 0;
    if (h) {
      const fx = -Math.sin(h.door.yaw);
      const fz = -Math.cos(h.door.yaw);
      p.teleport(h.door.x + fx * 2, 0.3, h.door.z + fz * 2, h.door.yaw);
    } else p.teleport(this.map.spawn.x, 1, this.map.spawn.z);
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
    const w = this.wanted;
    const before = w.level;
    switch (kind) {
      case 'assault':
      case 'carjack':
      case 'gunshot':
      case 'hit_and_run':
        w.level = Math.max(w.level, 1);
        break;
      case 'shoot_person':
        w.level = Math.max(w.level, 2);
        break;
      case 'knockout':
        w.level = Math.min(5, Math.max(2, w.level + 1));
        break;
      case 'robbery_shop':
        w.level = Math.max(w.level, 2);
        break;
      case 'robbery_big':
        w.level = Math.max(w.level, 3);
        break;
    }
    w.heat = 0;
    w.cooldown = WANTED_DECAY;
    if (w.level !== before) this.events.push({ type: 'wanted', level: w.level });
    void p;
  }

  private updateWanted() {
    const w = this.wanted;
    if (w.level === 0) return;
    w.heat += DT;
    w.cooldown -= DT;
    if (w.cooldown <= 0) {
      w.level--;
      w.cooldown = WANTED_DECAY;
      this.events.push({ type: 'wanted', level: w.level });
    }
  }

  // ------------------------------------------------------------------ pickups & population

  private collectPickups() {
    for (const p of this.players.values()) {
      const s = p.state;
      if (s.dead) continue;
      const r = s.vehicle >= 0 ? 3 : 1.6;
      for (const pk of this.pickups.values()) {
        if (Math.hypot(pk.x - s.x, pk.z - s.z) < r && Math.abs(pk.y - s.y) < 2.5) {
          s.money += pk.amount;
          this.events.push({ type: 'money', playerId: s.id, amount: pk.amount });
          this.pickups.delete(pk.id);
        }
      }
    }
  }

  private managePopulation() {
    const centers = [...this.players.values()].filter((p) => !p.state.interior).map((p) => p.state);
    const near = (x: number, z: number, r: number) => centers.some((c) => Math.hypot(c.x - x, c.z - z) < r);
    // --- pedestrians
    for (const ped of [...this.peds.values()]) {
      if (!ped.ambient) continue;
      if (!near(ped.state.x, ped.state.z, 140) || (!ped.alive && ped.timer > 45)) this.removePed(ped.state.id);
    }
    for (const pk of [...this.pickups.values()]) if (!near(pk.x, pk.z, 200)) this.pickups.delete(pk.id);
    if (centers.length === 0) return;
    let ambient = 0;
    for (const ped of this.peds.values()) if (ped.ambient) ambient++;
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
      this.spawnPed(n.x + (m.x - n.x) * t, n.z + (m.z - n.z) * t, { from: n.id, to });
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

  private nearestWalkNode(x: number, z: number) {
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

  private toast(p: Player, text: string) {
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
      wanted: { ...this.wanted },
      props: this.props.snapshot(),
    };
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

function structuredCloneState(s: PlayerState): PlayerState {
  return { ...s, ammo: { ...s.ammo }, context: s.context ? { ...s.context } : null };
}

export type { MoveCommand };
