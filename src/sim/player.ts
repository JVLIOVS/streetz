import type RAPIER_T from '@dimforge/rapier3d-compat';
import type { MoveCommand } from '../core/commands';
import { DT } from '../core/loop';

export type PlayerAnim = 'idle' | 'walk' | 'run' | 'jump' | 'fall';

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
}

export const PLAYER_TUNING = {
  radius: 0.35,
  halfHeight: 0.55, // capsule total height = 2 * (halfHeight + radius) = 1.8 m
  walkSpeed: 4.6,
  runSpeed: 8.6,
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

  /** One fixed tick of character movement. */
  update(controller: RAPIER_T.KinematicCharacterController) {
    const T = PLAYER_TUNING;
    const s = this.state;
    const inp = this.input;
    let sx = inp?.x ?? 0;
    let sy = inp?.y ?? 0;
    const mag = Math.min(1, Math.hypot(sx, sy));
    if (mag > 1e-3) {
      sx /= Math.max(1, Math.hypot(sx, sy));
      sy /= Math.max(1, Math.hypot(sx, sy));
    }
    const yaw = inp?.yaw ?? 0;
    // Camera-relative: forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
    const dirX = Math.cos(yaw) * sx - Math.sin(yaw) * sy;
    const dirZ = -Math.sin(yaw) * sx - Math.cos(yaw) * sy;
    const sprint = !!inp?.sprint && mag > 0.2;
    const maxSpeed = sprint ? T.runSpeed : T.walkSpeed * Math.min(1, mag * 1.25);
    const dl = Math.hypot(dirX, dirZ);
    const tx = dl > 1e-4 ? (dirX / dl) * maxSpeed : 0;
    const tz = dl > 1e-4 ? (dirZ / dl) * maxSpeed : 0;

    const accel = s.grounded ? T.groundAccel : T.airAccel;
    const k = 1 - Math.exp(-accel * DT);
    s.vx += (tx - s.vx) * k;
    s.vz += (tz - s.vz) * k;

    if (this.jumpQueued && s.grounded) {
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
    s.anim = !s.grounded ? (s.vy > 0 ? 'jump' : 'fall') : hs > T.walkSpeed + 0.8 ? 'run' : hs > 0.4 ? 'walk' : 'idle';
  }

  teleport(x: number, y: number, z: number) {
    const s = this.state;
    s.x = x;
    s.y = y;
    s.z = z;
    s.vx = s.vy = s.vz = 0;
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
