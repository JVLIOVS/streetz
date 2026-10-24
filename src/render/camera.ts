import * as THREE from 'three';

export interface CameraCollider {
  /** Distance to the first static obstacle along the ray, or maxDist. */
  castStatic(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number;
}

const _dir = new THREE.Vector3();

/**
 * Third-person orbit camera. Yaw convention matches the sim: the camera looks along
 * (-sin yaw, 0, -cos yaw). Right-side drag rotates; it slowly recenters behind the player.
 */
export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0.28;
  private dist = 6;
  private target = new THREE.Vector3();
  private sinceDrag = 10;
  private initialized = false;
  /** Screen shake strength (decays). */
  private trauma = 0;
  private shakeT = 0;
  /** Transformation cinematic: close, low angle, slowly circling (0 = normal play). */
  cinematic = false;

  constructor(aspect: number, private collider: CameraCollider) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.3, 1200);
  }

  /** Jump straight behind the player (after a teleport). */
  snap(yaw: number) {
    this.yaw = yaw;
    this.pitch = 0.28;
    this.initialized = false;
  }

  /** Adds screen shake (0..1). */
  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  rotate(dYaw: number, dPitch: number) {
    this.yaw += dYaw;
    this.pitch = Math.min(1.1, Math.max(-0.25, this.pitch + dPitch));
    this.sinceDrag = 0;
  }

  update(px: number, py: number, pz: number, facing: number, speed: number, forwardInput: number, dt: number, mode: 'foot' | 'vehicle' = 'foot', vehicleSpeed = 0) {
    const inCar = mode === 'vehicle';
    const tx = px;
    const ty = py + (inCar ? 2.0 : 1.55);
    const tz = pz;
    if (!this.initialized) {
      this.target.set(tx, ty, tz);
      this.yaw = facing;
      this.dist = 5.2;
      this.initialized = true;
    }
    const kf = 1 - Math.exp(-14 * dt);
    this.target.x += (tx - this.target.x) * kf;
    this.target.y += (ty - this.target.y) * (1 - Math.exp(-8 * dt));
    this.target.z += (tz - this.target.z) * kf;

    // Auto-recenter behind the player when moving forward and not touching the camera
    this.sinceDrag += dt;
    const recenter = inCar ? this.sinceDrag > 0.8 && vehicleSpeed > 2 : this.sinceDrag > 1.2 && speed > 1 && forwardInput > 0.3;
    if (recenter) {
      let d = (facing - this.yaw) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * (1 - Math.exp(-(inCar ? 3 : 1.2 * forwardInput) * dt));
      if (inCar) this.pitch += (0.22 - this.pitch) * (1 - Math.exp(-2 * dt));
    }

    if (this.cinematic) {
      this.yaw += dt * 1.1;
      this.pitch += (0.02 - this.pitch) * (1 - Math.exp(-3 * dt));
      this.sinceDrag = 0;
    }
    const wanted = this.cinematic ? 3.4 : inCar ? 7.5 + Math.min(4, Math.abs(vehicleSpeed) * 0.12) : 5.2 + Math.min(1.5, speed * 0.12);
    _dir.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const hit = this.collider.castStatic(this.target.x, this.target.y, this.target.z, _dir.x, _dir.y, _dir.z, wanted + 0.4);
    const allowed = Math.max(1.2, hit - 0.4);
    // Snap in quickly when blocked, ease out slowly
    const kd = allowed < this.dist ? 1 - Math.exp(-25 * dt) : 1 - Math.exp(-3 * dt);
    this.dist += (Math.min(wanted, allowed) - this.dist) * kd;

    const c = this.camera;
    c.position.copy(this.target).addScaledVector(_dir, this.dist);
    c.lookAt(this.target.x, this.target.y + (this.cinematic ? 0.5 : 0.15), this.target.z);
    const fov = this.cinematic ? 50 : 62;
    if (Math.abs(c.fov - fov) > 0.05) {
      c.fov += (fov - c.fov) * (1 - Math.exp(-4 * dt));
      c.updateProjectionMatrix();
    }
    if (this.trauma > 0.001) {
      // smooth noise, strength = trauma² (small hits barely shake, big ones do)
      this.shakeT += dt * 32;
      const k = this.trauma * this.trauma;
      c.position.x += Math.sin(this.shakeT * 1.3) * 0.35 * k;
      c.position.y += Math.sin(this.shakeT * 1.7 + 1) * 0.25 * k;
      c.rotation.z += Math.sin(this.shakeT * 1.1 + 2) * 0.05 * k;
      this.trauma = Math.max(0, this.trauma - dt * 1.8);
    }
  }
}
