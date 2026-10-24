import * as THREE from 'three';
import { STAGES, stageOf } from '../data/evolution';
import { levelOf } from '../data/progression';
import type { SimEvent, SimWorld } from '../sim/world';

const MAX_AURAS = 6;
const MAX_BOLTS = 10;
const MAX_RINGS = 4;
const MAX_BALLS = 6;
const MAX_BEAMS = 3;

interface Ball {
  on: boolean;
  t: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  mesh: THREE.Mesh;
}

const _v = new THREE.Vector3();

function additive(color: number, opacity: number) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
}

/**
 * Awakening visuals, drawn for every player: the flame-like aura (bigger while charging),
 * lightning crackling around, the shockwave ring of the "boom", energy balls flying and
 * beams. Pools only: nothing is allocated per frame.
 */
export class PowerFx {
  readonly root = new THREE.Group();
  private auras: { group: THREE.Group; outer: THREE.Mesh; inner: THREE.Mesh; mat: THREE.MeshBasicMaterial; mat2: THREE.MeshBasicMaterial }[] = [];
  private bolts: THREE.LineSegments;
  private boltPos: THREE.BufferAttribute;
  private boltLife = new Float32Array(MAX_BOLTS);
  private rings: { mesh: THREE.Mesh; t: number }[] = [];
  private balls: Ball[] = [];
  private blasts: { mesh: THREE.Mesh; t: number }[] = [];
  private beams: { mesh: THREE.Mesh; t: number }[] = [];
  private time = 0;
  /** Set when the local player's awakening goes boom (the game flashes the screen). */
  onBoom?: (playerId: string) => void;

  constructor(private sim: SimWorld) {
    this.root.name = 'powers';
    // aura: two open cones flaring upwards, flickering
    const coneOuter = new THREE.CylinderGeometry(0.15, 0.85, 2.6, 14, 1, true).translate(0, 1.2, 0);
    const coneInner = new THREE.CylinderGeometry(0.1, 0.55, 2.1, 12, 1, true).translate(0, 1.0, 0);
    for (let i = 0; i < MAX_AURAS; i++) {
      const mat = additive(0xffd23f, 0.35);
      const mat2 = additive(0xffffff, 0.25);
      const outer = new THREE.Mesh(coneOuter, mat);
      const inner = new THREE.Mesh(coneInner, mat2);
      const group = new THREE.Group();
      group.add(outer, inner);
      group.visible = false;
      this.auras.push({ group, outer, inner, mat, mat2 });
      this.root.add(group);
    }
    // lightning: jagged segments, 6 per bolt
    const geo = new THREE.BufferGeometry();
    this.boltPos = new THREE.BufferAttribute(new Float32Array(MAX_BOLTS * 12 * 3), 3);
    geo.setAttribute('position', this.boltPos);
    this.bolts = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xcff6ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }));
    this.bolts.frustumCulled = false;
    this.root.add(this.bolts);
    const ringGeo = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_RINGS; i++) {
      const mesh = new THREE.Mesh(ringGeo, additive(0xffffff, 0.8));
      mesh.visible = false;
      this.rings.push({ mesh, t: 1 });
      this.root.add(mesh);
    }
    const ballGeo = new THREE.SphereGeometry(0.45, 14, 10);
    const blastGeo = new THREE.SphereGeometry(1, 16, 12);
    for (let i = 0; i < MAX_BALLS; i++) {
      const mesh = new THREE.Mesh(ballGeo, additive(0x6fd8ff, 0.95));
      mesh.visible = false;
      this.balls.push({ on: false, t: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), mesh });
      const blast = new THREE.Mesh(blastGeo, additive(0x6fd8ff, 0.7));
      blast.visible = false;
      this.blasts.push({ mesh: blast, t: 1 });
      this.root.add(mesh, blast);
    }
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    for (let i = 0; i < MAX_BEAMS; i++) {
      const mesh = new THREE.Mesh(beamGeo, additive(0x6fd8ff, 0.85));
      mesh.visible = false;
      this.beams.push({ mesh, t: 1 });
      this.root.add(mesh);
    }
  }

  handle(e: SimEvent) {
    if (e.type === 'awaken' && e.phase === 'boom') {
      this.ring(e.x, e.y, e.z, e.aura);
      this.ring(e.x, e.y + 0.6, e.z, 0xffffff);
      this.onBoom?.(e.playerId);
    } else if (e.type === 'energy') {
      if (e.kind === 'ball') {
        const b = this.balls.find((q) => !q.on) ?? this.balls[0];
        b.on = true;
        b.t = 0;
        b.from.set(e.fx, e.fy, e.fz);
        b.to.set(e.tx, e.ty, e.tz);
        (b.mesh.material as THREE.MeshBasicMaterial).color.setHex(e.aura === 0x6fd8ff ? 0x9fe8ff : 0x7fd0ff);
        b.mesh.visible = true;
      } else {
        const beam = this.beams.reduce((a, q) => (q.t > a.t ? q : a));
        beam.t = 0;
        const len = Math.hypot(e.tx - e.fx, e.tz - e.fz);
        beam.mesh.position.set(e.fx, e.fy, e.fz);
        beam.mesh.lookAt(e.tx, e.ty, e.tz);
        beam.mesh.scale.set(0.7, 0.7, len);
        beam.mesh.visible = true;
        this.blast(e.tx, e.ty, e.tz, 3);
      }
    }
  }

  private ring(x: number, y: number, z: number, color: number) {
    const r = this.rings.reduce((a, q) => (q.t > a.t ? q : a));
    r.t = 0;
    r.mesh.position.set(x, y + 0.15, z);
    (r.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    r.mesh.visible = true;
  }

  private blast(x: number, y: number, z: number, size: number) {
    const b = this.blasts.reduce((a, q) => (q.t > a.t ? q : a));
    b.t = 0;
    b.mesh.position.set(x, y, z);
    b.mesh.userData.size = size;
    b.mesh.visible = true;
  }

  update(dt: number) {
    this.time += dt;
    // auras of everybody awakened or transforming
    let a = 0;
    let bolt = 0;
    const pos = this.boltPos;
    for (const p of this.sim.players.values()) {
      const s = p.state;
      if (a >= MAX_AURAS || s.dead || s.vehicle >= 0 || (s.awaken <= 0 && s.awakenCharge <= 0)) continue;
      const st = STAGES[stageOf(levelOf(s.rep))];
      const aura = this.auras[a++];
      aura.group.visible = true;
      const x = s.x;
      const z = s.z;
      aura.group.position.set(x, s.y, z);
      // charging: the aura swells and spins faster; transformed: steady flicker
      const charge = s.awakenCharge > 0 ? 1 - s.awakenCharge / 2.4 : 0;
      const flick = 1 + Math.sin(this.time * 31 + a) * 0.06 + Math.sin(this.time * 17) * 0.05;
      const size = s.awakenCharge > 0 ? 0.7 + charge * 1.1 : 1;
      aura.group.scale.set(size * flick, size * (1 + Math.sin(this.time * 23) * 0.08), size * flick);
      aura.group.rotation.y += dt * (s.awakenCharge > 0 ? 9 : 3);
      aura.mat.color.setHex(st.aura);
      aura.mat.opacity = s.awakenCharge > 0 ? 0.25 + charge * 0.35 : 0.3;
      aura.mat2.opacity = 0.18 + Math.random() * 0.1;
      // lightning: a lot while charging, now and then once transformed
      const n = s.awakenCharge > 0 ? 3 : Math.random() < dt * 4 ? 1 : 0;
      for (let k = 0; k < n && bolt < MAX_BOLTS; k++) {
        const ang = Math.random() * Math.PI * 2;
        const r0 = 0.4 + Math.random() * 0.6 * size;
        let px = x + Math.cos(ang) * r0;
        let py = s.y + 0.2 + Math.random() * 0.6;
        let pz = z + Math.sin(ang) * r0;
        for (let seg = 0; seg < 6; seg++) {
          const nx = px + (Math.random() - 0.5) * 0.5;
          const ny = py + 0.25 + Math.random() * 0.25;
          const nz = pz + (Math.random() - 0.5) * 0.5;
          const o = (bolt * 6 + seg) * 2;
          pos.setXYZ(o, px, py, pz);
          pos.setXYZ(o + 1, nx, ny, nz);
          px = nx;
          py = ny;
          pz = nz;
        }
        this.boltLife[bolt++] = 0.08;
      }
    }
    for (let i = a; i < MAX_AURAS; i++) this.auras[i].group.visible = false;
    // fade old bolts (move them away)
    for (let i = 0; i < MAX_BOLTS; i++) {
      if (i < bolt) continue;
      this.boltLife[i] -= dt;
      if (this.boltLife[i] <= 0) for (let k = 0; k < 12; k++) pos.setXYZ(i * 12 + k, 0, -1000, 0);
    }
    pos.needsUpdate = true;
    // shockwave rings
    for (const r of this.rings) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt * 1.6);
      const sc = 1 + r.t * 14;
      r.mesh.scale.set(sc, 1, sc);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - r.t);
      if (r.t >= 1) r.mesh.visible = false;
    }
    // energy balls fly in ~0.3 s, then burst
    for (const b of this.balls) {
      if (!b.on) continue;
      b.t += dt / 0.3;
      if (b.t >= 1) {
        b.on = false;
        b.mesh.visible = false;
        this.blast(b.to.x, b.to.y, b.to.z, 3.2);
        continue;
      }
      _v.copy(b.from).lerp(b.to, b.t);
      b.mesh.position.copy(_v);
      b.mesh.scale.setScalar(1 + Math.sin(this.time * 40) * 0.15);
    }
    for (const b of this.blasts) {
      if (b.t >= 1) continue;
      b.t = Math.min(1, b.t + dt * 3);
      const size = (b.mesh.userData.size as number) ?? 3;
      b.mesh.scale.setScalar(0.3 + b.t * size);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - b.t);
      if (b.t >= 1) b.mesh.visible = false;
    }
    for (const beam of this.beams) {
      if (beam.t >= 1) continue;
      beam.t = Math.min(1, beam.t + dt * 1.8);
      const w = 0.75 * (1 - beam.t * 0.6) * (1 + Math.sin(this.time * 50) * 0.1);
      beam.mesh.scale.x = w;
      beam.mesh.scale.y = w;
      (beam.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - beam.t);
      if (beam.t >= 1) beam.mesh.visible = false;
    }
  }
}
