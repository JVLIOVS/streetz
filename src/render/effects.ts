import * as THREE from 'three';
import type { SimEvent, PickupState } from '../sim/world';
import type { Vehicle } from '../sim/vehicle';

const MAX_PUFFS = 256;
const MAX_TRACERS = 24;

interface Puff {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  grow: number;
  life: number;
  max: number;
  color: THREE.Color;
  /** Gravity (m/s²), for water and debris. */
  g: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const C = {
  smoke: new THREE.Color(0x6b6b70),
  dark: new THREE.Color(0x2a2a2e),
  fire: new THREE.Color(0xff7a1a),
  yellow: new THREE.Color(0xffd23f),
  white: new THREE.Color(0xffffff),
  dust: new THREE.Color(0xd8cdb8),
  water: new THREE.Color(0x7fd6ff),
  spark: new THREE.Color(0xfff2a0),
};

/**
 * Cheap pooled effects, all instanced: puffs (smoke, fire, flashes, dust),
 * bullet tracers (one LineSegments) and money pickups.
 */
export class Effects {
  readonly root = new THREE.Group();
  private puffs: Puff[] = [];
  private puffMesh: THREE.InstancedMesh;
  private tracerGeo: THREE.BufferGeometry;
  private tracerLife = new Float32Array(MAX_TRACERS);
  private tracerNext = 0;
  private money: THREE.InstancedMesh;
  private time = 0;

  constructor() {
    this.root.name = 'effects';
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    this.puffMesh = new THREE.InstancedMesh(geo, mat, MAX_PUFFS);
    this.puffMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffMesh.frustumCulled = false;
    this.puffMesh.count = 0;
    this.puffMesh.setColorAt(0, C.white);
    for (let i = 0; i < MAX_PUFFS; i++) this.puffs.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1, grow: 0, life: 0, max: 1, color: new THREE.Color(), g: 0 });

    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_TRACERS * 6), 3).setUsage(THREE.DynamicDrawUsage));
    const tracers = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.9 }));
    tracers.frustumCulled = false;

    const bill = new THREE.BoxGeometry(0.5, 0.06, 0.28);
    this.money = new THREE.InstancedMesh(bill, new THREE.MeshBasicMaterial({ color: 0x5ee86a }), 64);
    this.money.frustumCulled = false;
    this.money.count = 0;

    this.root.add(this.puffMesh, tracers, this.money);
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, grow: number, life: number, color: THREE.Color, g = 0) {
    const p = this.puffs.find((q) => !q.alive);
    if (!p) return;
    Object.assign(p, { alive: true, x, y, z, vx, vy, vz, size, grow, life, max: life, g });
    p.color.copy(color);
  }

  handle(e: SimEvent) {
    switch (e.type) {
      case 'shot': {
        const pos = this.tracerGeo.getAttribute('position') as THREE.BufferAttribute;
        const i = this.tracerNext++ % MAX_TRACERS;
        pos.setXYZ(i * 2, e.fx, e.fy, e.fz);
        pos.setXYZ(i * 2 + 1, e.tx, e.ty, e.tz);
        pos.needsUpdate = true;
        this.tracerLife[i] = 0.08;
        this.spawn(e.fx, e.fy, e.fz, 0, 0, 0, 0.18, 1.5, 0.06, C.yellow);
        if (!e.hit) this.spawn(e.tx, e.ty, e.tz, 0, 0.5, 0, 0.15, 1.2, 0.3, C.dust);
        break;
      }
      case 'break':
        for (let k = 0; k < 8; k++) this.spawn(e.x, e.y, e.z, rnd(3), Math.random() * 4, rnd(3), 0.15, 0.8, 0.5, k % 2 ? C.dust : C.spark, 10);
        break;
      case 'punch':
        for (let k = 0; k < 5; k++) this.spawn(e.x, e.y, e.z, rnd(3), rnd(3), rnd(3), 0.08, 0.4, 0.18, C.white);
        break;
      case 'impact':
        for (let k = 0; k < Math.min(8, e.strength); k++) this.spawn(e.x, e.y, e.z, rnd(3), Math.random() * 3, rnd(3), 0.2, 1.4, 0.5, C.dust);
        break;
      case 'explosion':
        for (let k = 0; k < 28; k++) this.spawn(e.x, e.y, e.z, rnd(9), Math.random() * 9, rnd(9), 0.8, 3, 0.4 + Math.random() * 0.5, k % 3 ? C.fire : C.yellow);
        for (let k = 0; k < 16; k++) this.spawn(e.x, e.y + 1, e.z, rnd(3), 2 + Math.random() * 4, rnd(3), 1.2, 2.5, 1.6 + Math.random(), C.dark);
        this.spawn(e.x, e.y + 1, e.z, 0, 0, 0, 2.5, 14, 0.25, C.yellow);
        break;
    }
  }

  /** Fire and black smoke on a wreck. */
  burning(x: number, y: number, z: number, dt: number) {
    if (Math.random() < dt * 14) this.spawn(x + rnd(1), y + 0.5, z + rnd(1), rnd(0.5), 2.2, rnd(0.5), 0.6, 2, 1.8, Math.random() < 0.5 ? C.fire : C.dark);
  }

  /** Water gushing from a broken hydrant. */
  waterJet(x: number, z: number, left: number, dt: number) {
    const rate = 40 * Math.min(1, left / 5);
    for (let k = 0; k < rate * dt + (Math.random() < (rate * dt) % 1 ? 1 : 0); k++) {
      this.spawn(x + rnd(0.1), 0.6, z + rnd(0.1), rnd(1.2), 9 + Math.random() * 3, rnd(1.2), 0.12, 0.5, 1.4, C.water, 18);
    }
  }

  /** Smoke and fire on damaged vehicles. */
  vehicleSmoke(v: Vehicle, dt: number) {
    const s = v.state;
    const max = v.spec.health;
    if (s.wrecked) {
      if (Math.random() < dt * 4) this.spawn(s.x + rnd(0.6), s.y + 1.2, s.z + rnd(0.6), rnd(0.4), 1.6, rnd(0.4), 0.4, 1.6, 2.5, C.dark);
      return;
    }
    if (s.health > max * 0.35) return;
    const hx = s.x - Math.sin(s.yaw) * v.spec.length * 0.35;
    const hz = s.z - Math.cos(s.yaw) * v.spec.length * 0.35;
    const rate = s.fire >= 0 ? 30 : s.health < max * 0.15 ? 10 : 4;
    if (Math.random() < dt * rate) this.spawn(hx + rnd(0.3), s.y + 1.1, hz + rnd(0.3), rnd(0.5), 1.8, rnd(0.5), 0.3, 1.4, 1.4, s.fire >= 0 && Math.random() < 0.6 ? C.fire : C.smoke);
  }

  update(dt: number, pickups: Map<number, PickupState>) {
    this.time += dt;
    let n = 0;
    for (const p of this.puffs) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.x += p.vx * dt;
      p.vy -= p.g * dt;
      p.y += p.vy * dt;
      if (p.g > 0 && p.y < 0.05) p.life = 0;
      p.z += p.vz * dt;
      p.vx *= 0.96;
      p.vz *= 0.96;
      p.size += p.grow * dt;
      const k = p.life / p.max;
      _m.compose(_p.set(p.x, p.y, p.z), _q, _s.setScalar(p.size * (0.4 + 0.6 * Math.sqrt(k))));
      this.puffMesh.setMatrixAt(n, _m);
      this.puffMesh.setColorAt(n, p.color);
      n++;
    }
    this.puffMesh.count = n;
    this.puffMesh.instanceMatrix.needsUpdate = true;
    if (this.puffMesh.instanceColor) this.puffMesh.instanceColor.needsUpdate = true;

    const pos = this.tracerGeo.getAttribute('position') as THREE.BufferAttribute;
    let dirty = false;
    for (let i = 0; i < MAX_TRACERS; i++) {
      if (this.tracerLife[i] <= 0) continue;
      this.tracerLife[i] -= dt;
      if (this.tracerLife[i] <= 0) {
        pos.setXYZ(i * 2, 0, -1000, 0);
        pos.setXYZ(i * 2 + 1, 0, -1000, 0);
        dirty = true;
      }
    }
    if (dirty) pos.needsUpdate = true;

    let m = 0;
    for (const pk of pickups.values()) {
      if (m >= 64) break;
      _q.setFromAxisAngle(_p.set(0, 1, 0), this.time * 3 + pk.id);
      _m.compose(_p.set(pk.x, pk.y + 0.5 + Math.sin(this.time * 4 + pk.id) * 0.12, pk.z), _q, _s.setScalar(1));
      this.money.setMatrixAt(m++, _m);
    }
    this.money.count = m;
    this.money.instanceMatrix.needsUpdate = true;
  }
}

function rnd(a: number) {
  return (Math.random() * 2 - 1) * a;
}
