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
const MAX_POOLS = 30;
const C = {
  blood: new THREE.Color(0x8a0a12),
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
  private pools: THREE.InstancedMesh;
  private poolData = Array.from({ length: MAX_POOLS }, () => ({ x: 0, y: 0, z: 0, age: 0, size: 1, rot: 0, on: false }));
  private poolNext = 0;
  private crates: THREE.InstancedMesh;
  private crateGlow: THREE.InstancedMesh;
  private guns: THREE.InstancedMesh;
  private gunGlow: THREE.InstancedMesh;
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
    // surprise crates: glowing golden boxes
    this.crates = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), new THREE.MeshBasicMaterial({ color: 0xffc93c }), 16);
    this.crates.frustumCulled = false;
    this.crates.count = 0;
    this.crateGlow = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.9, 0.9, 6, 12, 1, true).translate(0, 3, 0),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
      16,
    );
    this.crateGlow.frustumCulled = false;
    this.crateGlow.count = 0;
    this.root.add(this.crates, this.crateGlow);
    // dropped weapons: a dark gun shape in a cyan glow
    this.guns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.18, 0.16), new THREE.MeshBasicMaterial({ color: 0x2a2a30 }), 16);
    this.guns.frustumCulled = false;
    this.guns.count = 0;
    this.gunGlow = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.6, 0.6, 3, 12, 1, true).translate(0, 1.5, 0),
      new THREE.MeshBasicMaterial({ color: 0x5ee8ff, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
      16,
    );
    this.gunGlow.frustumCulled = false;
    this.gunGlow.count = 0;
    this.root.add(this.guns, this.gunGlow);

    this.root.add(this.puffMesh, tracers, this.money);
    // blood pools: flat dark-red discs that spread under knocked-out people
    const poolGeo = new THREE.CircleGeometry(1, 14);
    poolGeo.rotateX(-Math.PI / 2);
    // irregular outline
    const pos = poolGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 1; i < pos.count; i++) {
      const k = 0.75 + ((i * 7919) % 13) / 30;
      pos.setXYZ(i, pos.getX(i) * k, 0, pos.getZ(i) * k);
    }
    this.pools = new THREE.InstancedMesh(
      poolGeo,
      new THREE.MeshBasicMaterial({ color: 0x5e0610, transparent: true, opacity: 0.88, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      MAX_POOLS,
    );
    this.pools.frustumCulled = false;
    this.pools.count = 0;
    this.pools.renderOrder = 1;
    this.root.add(this.pools);
  }

  /** Jetpack exhaust (call every frame while firing). */
  jet(x: number, y: number, z: number, dt: number) {
    const n = Math.random() < dt * 40 ? 2 : 1;
    for (let k = 0; k < n; k++) this.spawn(x + rnd(0.15), y, z + rnd(0.15), rnd(0.6), -6 - Math.random() * 3, rnd(0.6), 0.18, 1.2, 0.3, Math.random() < 0.6 ? C.fire : C.yellow);
  }

  /** Blood spurting from a hit (red droplets falling). */
  bleed(x: number, y: number, z: number, amount = 6) {
    for (let k = 0; k < amount; k++) this.spawn(x + rnd(0.15), y + rnd(0.2), z + rnd(0.15), rnd(2.2), 1 + Math.random() * 2.2, rnd(2.2), 0.07 + Math.random() * 0.06, 0.1, 0.45 + Math.random() * 0.3, C.blood, 12);
  }

  /** A pool of blood spreading under someone on the ground. */
  bloodPool(x: number, y: number, z: number) {
    const p = this.poolData[this.poolNext];
    this.poolNext = (this.poolNext + 1) % MAX_POOLS;
    Object.assign(p, { x, y: y + 0.03, z, age: 0, size: 0.7 + Math.random() * 0.6, rot: Math.random() * 6.28, on: true });
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, grow: number, life: number, color: THREE.Color, g = 0) {
    const p = this.puffs.find((q) => !q.alive);
    if (!p) return;
    Object.assign(p, { alive: true, x, y, z, vx, vy, vz, size, grow, life, max: life, g });
    p.color.copy(color);
  }

  handle(e: SimEvent) {
    if (e.type === 'flame') {
      // a jet of fire: fast hot puffs going forward, rising a bit
      for (let k = 0; k < 4; k++) {
        const sp = 9 + Math.random() * 5;
        this.spawn(e.x, e.y, e.z, e.dx * sp + rnd(1.5), 0.6 + Math.random() * 1.2, e.dz * sp + rnd(1.5), 0.25, 2.2, 0.45 + Math.random() * 0.25, Math.random() < 0.7 ? C.fire : C.yellow);
      }
      if (Math.random() < 0.3) this.spawn(e.x + e.dx * 6, e.y + 0.5, e.z + e.dz * 6, rnd(0.5), 1.5, rnd(0.5), 0.6, 1.5, 1.2, C.smoke);
      return;
    }
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
    // blood pools grow for 2 s, stay, then dry up after a minute
    let np = 0;
    for (const b of this.poolData) {
      if (!b.on) continue;
      b.age += dt;
      if (b.age > 75) {
        b.on = false;
        continue;
      }
      const grow = Math.min(1, b.age / 2.2);
      const dry = b.age > 60 ? 1 - (b.age - 60) / 15 : 1;
      _q.setFromAxisAngle(_p.set(0, 1, 0), b.rot);
      _m.compose(_p.set(b.x, b.y, b.z), _q, _s.set(b.size * (0.25 + 0.75 * grow) * dry, 1, b.size * (0.25 + 0.75 * grow) * dry));
      this.pools.setMatrixAt(np++, _m);
    }
    this.pools.count = np;
    this.pools.instanceMatrix.needsUpdate = true;
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
    let c = 0;
    let gn = 0;
    for (const pk of pickups.values()) {
      if (pk.kind === 'weapon') {
        if (gn >= 16) continue;
        _q.setFromAxisAngle(_p.set(0, 1, 0), this.time * 2 + pk.id);
        _m.compose(_p.set(pk.x, pk.y + 0.5 + Math.sin(this.time * 3 + pk.id) * 0.1, pk.z), _q, _s.setScalar(1));
        this.guns.setMatrixAt(gn, _m);
        _m.compose(_p.set(pk.x, pk.y, pk.z), _q.identity(), _s.setScalar(1));
        this.gunGlow.setMatrixAt(gn++, _m);
        continue;
      }
      if (pk.kind === 'crate') {
        if (c >= 16) continue;
        _q.setFromAxisAngle(_p.set(0, 1, 0), this.time * 1.5 + pk.id);
        _m.compose(_p.set(pk.x, pk.y + 0.6 + Math.sin(this.time * 3 + pk.id) * 0.15, pk.z), _q, _s.setScalar(1));
        this.crates.setMatrixAt(c, _m);
        _m.compose(_p.set(pk.x, pk.y, pk.z), _q.identity(), _s.setScalar(1));
        this.crateGlow.setMatrixAt(c++, _m);
        continue;
      }
      if (m >= 64) break;
      _q.setFromAxisAngle(_p.set(0, 1, 0), this.time * 3 + pk.id);
      _m.compose(_p.set(pk.x, pk.y + 0.5 + Math.sin(this.time * 4 + pk.id) * 0.12, pk.z), _q, _s.setScalar(1));
      this.money.setMatrixAt(m++, _m);
    }
    this.money.count = m;
    this.guns.count = gn;
    this.gunGlow.count = gn;
    this.guns.instanceMatrix.needsUpdate = true;
    this.gunGlow.instanceMatrix.needsUpdate = true;
    this.crates.count = c;
    this.crateGlow.count = c;
    this.crates.instanceMatrix.needsUpdate = true;
    this.crateGlow.instanceMatrix.needsUpdate = true;
    this.money.instanceMatrix.needsUpdate = true;
  }
}

function rnd(a: number) {
  return (Math.random() * 2 - 1) * a;
}
