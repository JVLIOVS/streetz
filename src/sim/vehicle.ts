import type RAPIER_T from '@dimforge/rapier3d-compat';
import { DT } from '../core/loop';
import { VEHICLES, type VehicleType } from '../data/vehicles';

/** Serializable vehicle state. */
export interface VehicleState {
  id: number;
  type: VehicleType;
  x: number;
  y: number;
  z: number;
  /** Heading (radians, 0 = facing -z). */
  yaw: number;
  pitch: number;
  roll: number;
  vx: number;
  vy: number;
  vz: number;
  /** Signed forward speed (m/s). */
  speed: number;
  steer: number;
  health: number;
  /** 'none' | 'npc' | player id */
  driver: string;
  /** Seconds burning before exploding; < 0 when not on fire. */
  fire: number;
  wrecked: boolean;
  /** Wheel spin angle for rendering. */
  wheel: number;
  braking: boolean;
  /** Last horn tick, for the renderer/sound. */
  horn: number;
  /** Paint variant for rendering. */
  paint: number;
  /** Police lights and siren on. */
  siren: boolean;
}

export interface DriveInput {
  throttle: number; // -1..1 (negative = brake / reverse)
  steer: number; // -1..1 (positive = right)
  handbrake: boolean;
  /** Flying vehicles: up/down (gas/brake buttons) and forward/back (stick). */
  lift?: number;
  fwd?: number;
}

/** Networked vehicle pose (what a driver reports / a host broadcasts). */
export interface VehicleNet {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  vx: number;
  vz: number;
  speed: number;
  steer: number;
}

export interface Impact {
  strength: number;
}

/** Runtime vehicle: state + physics handles + AI scratch. */
export class Vehicle {
  prev = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  input: DriveInput = { throttle: 0, steer: 0, handbrake: false };
  grounded = true;
  /** AI: current lane and whether the vehicle is part of the ambient traffic. */
  lane = -1;
  ambient = true;
  parkedSpot = -1;
  /** AI speed factor (> 1: a fleeing car that does not stop for pedestrians). */
  rush = 1;
  /** Driving skill of the driver (1 = none). */
  tune = 1;
  /** Player who last shot it (credited if it explodes). */
  lastHitBy: string | null = null;
  /** Ticks since a player last drove it (persistent while recent). */
  touchedTick = -1;
  /** Police AI scratch (target player, unstuck timers, crew dropped off). */
  police: { target: string | null; stuck: number; reverse: number; dropped: boolean; block: boolean } | null = null;
  /** Rotor speed (rendering): 0 when parked, 1 when flying. */
  rotor = 0;

  /**
   * Mini-helicopter: hovers while someone is at the controls; gas climbs, brake goes
   * down, the stick flies forward/back and turns. Without a pilot it falls.
   */
  private fly(controller: RAPIER_T.KinematicCharacterController, filterGroups?: number): number {
    const s = this.state;
    const sp = this.spec;
    const inp = this.input;
    const piloted = !s.wrecked && s.driver !== 'none' && s.driver !== 'npc' && s.health > 0;
    this.rotor += ((piloted ? 1 : 0) - this.rotor) * (1 - Math.exp(-1.5 * DT));
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    const rx = Math.cos(s.yaw);
    const rz = -Math.sin(s.yaw);
    let vf = s.vx * fx + s.vz * fz;
    let vr = s.vx * rx + s.vz * rz;
    if (piloted && this.rotor > 0.5) {
      const lift = inp.lift ?? 0;
      const fwd = inp.fwd ?? 0;
      s.vy += (lift * 8 - s.vy) * (1 - Math.exp(-2.5 * DT));
      if (s.y > 140) s.vy = Math.min(s.vy, 0);
      vf += (fwd * sp.maxSpeed * this.tune - vf) * (1 - Math.exp(-1.2 * DT));
      vr *= Math.exp(-2 * DT);
      s.yaw -= inp.steer * 1.7 * DT;
      // nose down when going forward, lean into turns (visual)
      s.pitch += (-fwd * 0.22 - s.pitch) * (1 - Math.exp(-4 * DT));
      s.roll += (inp.steer * 0.25 - s.roll) * (1 - Math.exp(-4 * DT));
    } else {
      s.vy = this.grounded ? -2 : s.vy - 20 * DT;
      vf *= Math.exp(-(this.grounded ? 4 : 0.5) * DT);
      vr *= Math.exp(-(this.grounded ? 4 : 0.5) * DT);
      s.pitch *= 0.95;
      s.roll *= 0.95;
    }
    const nfx = -Math.sin(s.yaw);
    const nfz = -Math.cos(s.yaw);
    const nrx = Math.cos(s.yaw);
    const nrz = -Math.sin(s.yaw);
    s.vx = nfx * vf + nrx * vr;
    s.vz = nfz * vf + nrz * vr;
    const before = Math.hypot(s.vx, s.vy, s.vz);
    controller.computeColliderMovement(this.collider, { x: s.vx * DT, y: s.vy * DT, z: s.vz * DT }, undefined, filterGroups);
    const m = controller.computedMovement();
    this.grounded = controller.computedGrounded();
    s.vx = m.x / DT;
    s.vz = m.z / DT;
    if (this.grounded && s.vy < 0) s.vy = 0;
    s.x += m.x;
    s.y += m.y;
    s.z += m.z;
    s.speed = s.vx * nfx + s.vz * nfz;
    s.wheel += this.rotor * 0.9;
    this.body.setNextKinematicTranslation({ x: s.x, y: s.y, z: s.z });
    this.body.setNextKinematicRotation({ w: Math.cos(s.yaw / 2), x: 0, y: Math.sin(s.yaw / 2), z: 0 });
    const lost = before - Math.hypot(s.vx, m.y / DT, s.vz);
    return lost > 9 ? lost * 0.6 : 0;
  }

  /** Multiplayer: last networked pose to glide towards, and damage to report to the host. */
  net: VehicleNet | null = null;
  pendingDamage = 0;

  constructor(
    public state: VehicleState,
    readonly body: RAPIER_T.RigidBody,
    readonly collider: RAPIER_T.Collider,
  ) {
    this.savePrev();
  }

  get spec() {
    return VEHICLES[this.state.type];
  }

  savePrev() {
    const s = this.state;
    this.prev.x = s.x;
    this.prev.y = s.y;
    this.prev.z = s.z;
    this.prev.yaw = s.yaw;
    this.prev.pitch = s.pitch;
    this.prev.roll = s.roll;
  }

  /**
   * Arcade car model: forward/lateral velocity split, speed-dependent steering,
   * lateral grip (low grip = drift), gravity, moved with a character controller so it
   * slides along walls and climbs slopes. Returns the impact strength (m/s lost).
   */
  update(controller: RAPIER_T.KinematicCharacterController, groundProbe: (x: number, z: number, y: number) => number | null, filterGroups?: number): number {
    if (this.spec.fly) return this.fly(controller, filterGroups);
    const s = this.state;
    const sp = this.spec;
    const inp = s.wrecked ? { throttle: 0, steer: 0, handbrake: true } : this.input;
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    const rx = Math.cos(s.yaw);
    const rz = -Math.sin(s.yaw);
    let vf = s.vx * fx + s.vz * fz;
    let vr = s.vx * rx + s.vz * rz;

    if (this.grounded) {
      s.braking = false;
      if (inp.throttle > 0) {
        if (vf < -0.5) {
          vf += sp.brake * DT;
          s.braking = true;
        } else vf += sp.accel * this.tune * inp.throttle * DT * Math.max(0, 1 - vf / (sp.maxSpeed * this.tune));
      } else if (inp.throttle < 0) {
        if (vf > 0.5) {
          vf -= sp.brake * DT * -inp.throttle;
          s.braking = true;
        } else vf = Math.max(-sp.reverseSpeed, vf + sp.accel * 0.6 * inp.throttle * DT);
      } else {
        const roll = (1.5 + 0.012 * vf * vf) * DT;
        vf -= Math.sign(vf) * Math.min(Math.abs(vf), roll);
      }
      if (inp.handbrake) {
        vf -= Math.sign(vf) * Math.min(Math.abs(vf), 7 * DT);
        s.braking = true;
      }
      // Steering: softer at high speed, sharper with the handbrake (drift)
      const target = inp.steer * sp.steer / (1 + Math.abs(vf) / (sp.twoWheels ? 14 : 22));
      s.steer += (target - s.steer) * (1 - Math.exp(-(sp.steerRate ?? 10) * DT));
      let yawRate = (vf * Math.tan(s.steer)) / sp.wheelbase;
      if (inp.handbrake) yawRate *= 1.35;
      s.yaw -= yawRate * DT;
      const grip = inp.handbrake ? 1.4 : sp.grip;
      vr *= Math.exp(-grip * DT);
    }

    const nfx = -Math.sin(s.yaw);
    const nfz = -Math.cos(s.yaw);
    const nrx = Math.cos(s.yaw);
    const nrz = -Math.sin(s.yaw);
    s.vx = nfx * vf + nrx * vr;
    s.vz = nfz * vf + nrz * vr;
    s.vy = this.grounded && s.vy <= 0 ? -2 : s.vy - 26 * DT;

    const desired = { x: s.vx * DT, y: s.vy * DT, z: s.vz * DT };
    controller.computeColliderMovement(this.collider, desired, undefined, filterGroups);
    const m = controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = controller.computedGrounded();
    // Keep the vertical launch speed when leaving a slope (jumps!)
    if (this.grounded) s.vy = Math.max(-2, m.y / DT);
    else if (wasGrounded) s.vy = Math.max(s.vy, m.y / DT);

    const before = Math.hypot(s.vx, s.vz);
    s.vx = m.x / DT;
    s.vz = m.z / DT;
    const after = Math.hypot(s.vx, s.vz);
    s.x += m.x;
    s.y += m.y;
    s.z += m.z;
    s.speed = s.vx * nfx + s.vz * nfz;
    s.wheel += (s.speed * DT) / 0.38;

    // Orientation follows the ground under the axles (rendering + collider)
    const half = sp.length * 0.38;
    const hf = groundProbe(s.x + nfx * half, s.z + nfz * half, s.y);
    const hb = groundProbe(s.x - nfx * half, s.z - nfz * half, s.y);
    const hl = groundProbe(s.x - nrx * sp.width * 0.4, s.z - nrz * sp.width * 0.4, s.y);
    const hr = groundProbe(s.x + nrx * sp.width * 0.4, s.z + nrz * sp.width * 0.4, s.y);
    const k = 1 - Math.exp(-12 * DT);
    if (this.grounded && hf !== null && hb !== null) s.pitch += (Math.atan2(hf - hb, half * 2) - s.pitch) * k;
    else s.pitch *= 0.98;
    if (this.grounded && hl !== null && hr !== null) s.roll += (Math.atan2(hr - hl, sp.width * 0.8) - s.roll) * k;
    else s.roll *= 0.98;

    this.body.setNextKinematicTranslation({ x: s.x, y: s.y, z: s.z });
    const cy = Math.cos(s.yaw / 2);
    const sy = Math.sin(s.yaw / 2);
    this.body.setNextKinematicRotation({ w: cy, x: 0, y: sy, z: 0 });

    const lost = before - after;
    return lost > 4 ? lost : 0;
  }

  setNet(n: VehicleNet) {
    this.net = { ...n };
  }

  /** Glide towards the networked pose (dead reckoning with the reported velocity). */
  followNet() {
    const n = this.net;
    if (!n) return;
    const s = this.state;
    n.x += n.vx * DT;
    n.z += n.vz * DT;
    const k = 0.35;
    if (Math.hypot(n.x - s.x, n.z - s.z) > 10) {
      s.x = n.x;
      s.z = n.z;
    }
    s.x += (n.x - s.x) * k;
    s.y += (n.y - s.y) * k;
    s.z += (n.z - s.z) * k;
    let dy = (n.yaw - s.yaw) % (Math.PI * 2);
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    s.yaw += dy * k;
    s.pitch += (n.pitch - s.pitch) * k;
    s.roll += (n.roll - s.roll) * k;
    s.vx = n.vx;
    s.vz = n.vz;
    s.speed = n.speed;
    s.steer = n.steer;
    s.wheel += (s.speed * DT) / 0.38;
    this.body.setNextKinematicTranslation({ x: s.x, y: s.y, z: s.z });
    this.body.setNextKinematicRotation({ w: Math.cos(s.yaw / 2), x: 0, y: Math.sin(s.yaw / 2), z: 0 });
  }

  teleport(x: number, y: number, z: number, yaw: number) {
    const s = this.state;
    s.x = x;
    s.y = y;
    s.z = z;
    s.yaw = yaw;
    s.vx = s.vy = s.vz = 0;
    s.speed = 0;
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ w: Math.cos(yaw / 2), x: 0, y: Math.sin(yaw / 2), z: 0 }, true);
    this.body.setNextKinematicTranslation({ x, y, z });
    this.savePrev();
  }
}

/** Forward unit vector for a yaw. */
export function forward(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}
