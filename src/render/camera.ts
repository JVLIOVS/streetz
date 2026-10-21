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

  constructor(aspect: number, private collider: CameraCollider) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.3, 1200);
  }

  rotate(dYaw: number, dPitch: number) {
    this.yaw += dYaw;
    this.pitch = Math.min(1.1, Math.max(-0.25, this.pitch + dPitch));
    this.sinceDrag = 0;
  }

  update(px: number, py: number, pz: number, facing: number, speed: number, forwardInput: number, dt: number) {
    const tx = px;
    const ty = py + 1.55;
    const tz = pz;
    if (!this.initialized) {
      this.target.set(tx, ty, tz);
      this.yaw = facing;
      this.initialized = true;
    }
    const kf = 1 - Math.exp(-14 * dt);
    this.target.x += (tx - this.target.x) * kf;
    this.target.y += (ty - this.target.y) * (1 - Math.exp(-8 * dt));
    this.target.z += (tz - this.target.z) * kf;

    // Auto-recenter behind the player when moving forward and not touching the camera
    this.sinceDrag += dt;
    if (this.sinceDrag > 1.2 && speed > 1 && forwardInput > 0.3) {
      let d = (facing - this.yaw) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * (1 - Math.exp(-1.2 * forwardInput * dt));
    }

    const wanted = 5.2 + Math.min(1.5, speed * 0.12);
    _dir.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const hit = this.collider.castStatic(this.target.x, this.target.y, this.target.z, _dir.x, _dir.y, _dir.z, wanted + 0.4);
    const allowed = Math.max(1.2, hit - 0.4);
    // Snap in quickly when blocked, ease out slowly
    const kd = allowed < this.dist ? 1 - Math.exp(-25 * dt) : 1 - Math.exp(-3 * dt);
    this.dist += (Math.min(wanted, allowed) - this.dist) * kd;

    const c = this.camera;
    c.position.copy(this.target).addScaledVector(_dir, this.dist);
    c.lookAt(this.target.x, this.target.y + 0.15, this.target.z);
  }
}
