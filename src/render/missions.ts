import * as THREE from 'three';
import { missionById } from '../data/missions';
import type { PlayerState } from '../sim/player';
import type { SimWorld } from '../sim/world';

const MAX_TARGETS = 8;

/**
 * Mission markers in the world: glowing columns on mission starts, a tall beam on the
 * current waypoint and bouncing arrows above mission targets (thugs, witness, car).
 */
export class MissionMarkers {
  readonly root = new THREE.Group();
  private givers: { id: string; group: THREE.Group; beam: THREE.Mesh }[] = [];
  private waypoint: THREE.Mesh;
  private arrows: THREE.Mesh[] = [];
  private openMat = beamMat(0xffd23f, 0.4);
  private lockedMat = beamMat(0x9aa0b0, 0.22);
  private time = 0;
  private fence: THREE.Group;
  private vips: THREE.Mesh[] = [];

  constructor(private sim: SimWorld) {
    const beamGeo = new THREE.CylinderGeometry(1.1, 1.1, 3.2, 20, 1, true);
    beamGeo.translate(0, 1.6, 0);
    const ringGeo = new THREE.RingGeometry(1.0, 1.35, 28);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, depthWrite: false });
    const bangGeo = new THREE.OctahedronGeometry(0.35);
    bangGeo.scale(1, 1.6, 1);
    const bangMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
    for (const g of sim.missions.givers) {
      const group = new THREE.Group();
      const beam = new THREE.Mesh(beamGeo, this.openMat);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.06;
      const bang = new THREE.Mesh(bangGeo, bangMat);
      bang.position.y = 3.6;
      bang.name = 'bang';
      group.add(beam, ring, bang);
      group.position.set(g.x, sim.groundY(g.x, g.z), g.z);
      this.root.add(group);
      this.givers.push({ id: g.id, group, beam });
    }
    // fence (receleur) drop-off: green ring + beam
    const fence = new THREE.Group();
    const fBeam = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 6, 24, 1, true).translate(0, 3, 0), beamMat(0x5ee86a, 0.25));
    const fRing = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.2, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5ee86a, transparent: true, opacity: 0.85, depthWrite: false }));
    fRing.position.y = 0.06;
    fence.add(fBeam, fRing);
    fence.position.set(sim.contracts.fence.x, sim.groundY(sim.contracts.fence.x, sim.contracts.fence.z), sim.contracts.fence.z);
    this.fence = fence;
    this.root.add(fence);
    const wpGeo = new THREE.CylinderGeometry(1.4, 1.4, 70, 16, 1, true);
    wpGeo.translate(0, 35, 0);
    this.waypoint = new THREE.Mesh(wpGeo, beamMat(0xffd23f, 0.3));
    this.waypoint.visible = false;
    this.root.add(this.waypoint);
    const arrowGeo = new THREE.ConeGeometry(0.35, 0.6, 4);
    arrowGeo.rotateX(Math.PI);
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xff3b4f });
    const vipGeo = new THREE.OctahedronGeometry(0.22);
    vipGeo.scale(1, 1.4, 1);
    const vipMat = new THREE.MeshBasicMaterial({ color: 0xffc93c });
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Mesh(vipGeo, vipMat);
      d.visible = false;
      this.vips.push(d);
      this.root.add(d);
    }
    for (let i = 0; i < MAX_TARGETS; i++) {
      const a = new THREE.Mesh(arrowGeo, arrowMat);
      a.visible = false;
      this.arrows.push(a);
      this.root.add(a);
    }
  }

  sync(me: PlayerState | undefined, dt: number) {
    this.time += dt;
    const bob = Math.sin(this.time * 3) * 0.2;
    const indoors = !!me?.interior;
    for (const g of this.givers) {
      const def = missionById(g.id)!;
      const open = !def.requires || !!me?.missionsDone.includes(def.requires);
      g.group.visible = !indoors && !me?.mission;
      g.beam.material = open ? this.openMat : this.lockedMat;
      const bang = g.group.getObjectByName('bang')!;
      bang.visible = open;
      bang.position.y = 3.6 + bob;
      bang.rotation.y = this.time * 2;
    }
    this.fence.visible = !indoors;
    const wp = me?.waypoint;
    this.waypoint.visible = !!wp && !indoors;
    if (wp) this.waypoint.position.set(wp[0], this.sim.groundY(wp[0], wp[1]), wp[1]);
    let n = 0;
    for (const id of me?.missionTargets ?? []) {
      if (n >= MAX_TARGETS || indoors) break;
      const ped = this.sim.peds.get(id);
      const veh = ped ? undefined : this.sim.vehicles.get(id);
      if (ped && !ped.alive) continue;
      const s = ped?.state ?? veh?.state;
      if (!s) continue;
      const a = this.arrows[n++];
      a.visible = true;
      a.position.set(s.x, s.y + (veh ? veh.spec.height + 1.2 : 2.5) + bob, s.z);
      a.rotation.y = this.time * 3;
    }
    for (let i = n; i < MAX_TARGETS; i++) this.arrows[i].visible = false;
    // rich passers-by: a spinning gold diamond above their head
    let k = 0;
    if (!indoors && me) {
      for (const ped of this.sim.peds.values()) {
        if (k >= this.vips.length) break;
        const s = ped.state;
        if (!s.vip || !ped.alive || Math.abs(s.x - me.x) > 60 || Math.abs(s.z - me.z) > 60) continue;
        const d = this.vips[k++];
        d.visible = true;
        d.position.set(s.x, s.y + 2.4 + bob, s.z);
        d.rotation.y = this.time * 3;
      }
    }
    for (let i = k; i < this.vips.length; i++) this.vips[i].visible = false;
  }
}

function beamMat(color: number, opacity: number) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
}
