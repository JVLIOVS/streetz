import type RAPIER_T from '@dimforge/rapier3d-compat';
import type { Command } from '../core/commands';
import type { MapData } from '../maps/types';
import { buildStaticColliders } from './colliders';
import { GROUP, groups, initPhysics } from './physics';
import { Player, PLAYER_TUNING, type PlayerState } from './player';

export interface WorldSnapshot {
  tick: number;
  mapId: string;
  players: PlayerState[];
}

export type SimEvent = { type: 'respawn'; playerId: string; reason: 'drowned' | 'fell' };

/**
 * Authoritative game simulation. No three.js, no DOM: this exact class is meant
 * to run on a server in v2. Driven only by Commands, at a fixed 60 Hz.
 */
export class SimWorld {
  tick = 0;
  readonly players = new Map<string, Player>();
  events: SimEvent[] = [];
  staticColliderCount = 0;
  private controller: RAPIER_T.KinematicCharacterController;

  private constructor(
    private R: typeof RAPIER_T,
    readonly physics: RAPIER_T.World,
    readonly map: MapData,
  ) {
    this.controller = physics.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(0.45, 0.25, true);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.staticColliderCount = buildStaticColliders(R, physics, map);
    physics.step(); // build the query structures once
  }

  static async create(map: MapData): Promise<SimWorld> {
    const R = await initPhysics();
    const physics = new R.World({ x: 0, y: -9.81 * 2, z: 0 });
    physics.timestep = 1 / 60;
    return new SimWorld(R, physics, map);
  }

  addPlayer(id: string, spawn = this.map.spawn): Player {
    const R = this.R;
    const body = this.physics.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    const collider = this.physics.createCollider(
      R.ColliderDesc.capsule(PLAYER_TUNING.halfHeight, PLAYER_TUNING.radius)
        .setTranslation(0, PLAYER_TUNING.halfHeight + PLAYER_TUNING.radius, 0)
        .setCollisionGroups(groups(GROUP.PLAYER, GROUP.STATIC | GROUP.PLAYER)),
      body,
    );
    const p = new Player(id, body, collider, spawn);
    this.players.set(id, p);
    return p;
  }

  /** Advance one fixed tick with the commands for this tick. */
  step(commands: readonly Command[]): void {
    for (const c of commands) {
      if (c.type === 'move') this.players.get(c.playerId)?.setInput(c);
    }
    for (const p of this.players.values()) {
      p.savePrev();
      p.update(this.controller);
      if (p.state.y < this.map.killY) {
        const s = this.map.spawn;
        p.teleport(s.x, s.y, s.z);
        this.events.push({ type: 'respawn', playerId: p.state.id, reason: 'drowned' });
      }
    }
    this.physics.step();
    this.tick++;
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
      players: [...this.players.values()].map((p) => ({ ...p.state })),
    };
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
