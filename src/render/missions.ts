import { levelOf } from '../data/progression';
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
  private heist: THREE.Group;
  private hunted: THREE.Mesh[] = [];
  private allyMark: THREE.Mesh;
  private chests: THREE.Group[] = [];
  private stash: THREE.Mesh;
  private pinBeam: THREE.Mesh;
  /** The pin the player dropped on the big map (pink beam). */
  pin: [number, number] | null = null;
  /** Who your gun points at now (ped or vehicle id), shown with a red reticle. */
  aim = -1;
  private reticle: THREE.Mesh;

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
    // co-op heist marker (red)
    const heist = new THREE.Group();
    heist.add(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 5, 24, 1, true).translate(0, 2.5, 0), beamMat(0xff3b4f, 0.35)));
    const hRing = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3b4f, transparent: true, opacity: 0.9, depthWrite: false }));
    hRing.position.y = 0.06;
    heist.add(hRing);
    heist.position.set(sim.heist.spot.x, sim.groundY(sim.heist.spot.x, sim.heist.spot.z), sim.heist.spot.z);
    this.heist = heist;
    this.root.add(heist);
    // rooftop stashes (shown while full) and sniper spots (always: a goal to climb to)
    const chestBox = new THREE.BoxGeometry(0.9, 0.55, 0.6);
    const chestMat = new THREE.MeshToonMaterial({ color: 0x6b4423 });
    const bandMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
    // tall enough to be seen from the street: a reason to jump up there
    const glowGeo = new THREE.CylinderGeometry(0.7, 0.7, 9, 12, 1, true).translate(0, 4.5, 0);
    const glowMat = beamMat(0xffd23f, 0.25);
    for (const c of sim.roofs.chests) {
      const g = new THREE.Group();
      const box = new THREE.Mesh(chestBox, chestMat);
      box.position.y = 0.28;
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.08, 0.65), bandMat);
      band.position.y = 0.4;
      g.add(box, band, new THREE.Mesh(glowGeo, glowMat));
      g.position.set(c.x, c.y, c.z);
      this.chests.push(g);
      this.root.add(g);
    }
    const spotBeam = new THREE.CylinderGeometry(1.6, 1.6, 9, 20, 1, true).translate(0, 4.5, 0);
    const spotMat = beamMat(0xff3b4f, 0.3);
    const spotRing = new THREE.RingGeometry(1.4, 1.9, 4).rotateX(-Math.PI / 2);
    const spotRingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    for (const q of sim.roofs.spots) {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(spotRing, spotRingMat);
      ring.position.y = 0.06;
      g.add(new THREE.Mesh(spotBeam, spotMat), ring);
      g.position.set(q.x, q.y, q.z);
      this.root.add(g);
    }
    this.stash = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 40, 16, 1, true).translate(0, 20, 0), beamMat(0xb56cff, 0.35));
    this.stash.visible = false;
    this.root.add(this.stash);
    this.pinBeam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 60, 16, 1, true).translate(0, 30, 0), beamMat(0xff3b9a, 0.32));
    this.pinBeam.visible = false;
    this.root.add(this.pinBeam);
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 24, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3b4f, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
    this.reticle.renderOrder = 10;
    this.reticle.visible = false;
    this.root.add(this.reticle);
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
    this.allyMark = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0x5ee86a }));
    this.allyMark.visible = false;
    this.root.add(this.allyMark);
    const huntGeo = new THREE.ConeGeometry(0.5, 0.9, 4).rotateX(Math.PI);
    for (let i = 0; i < 4; i++) {
      const a = new THREE.Mesh(huntGeo, arrowMat);
      a.visible = false;
      this.hunted.push(a);
      this.root.add(a);
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
      const open = (!def.requires || !!me?.missionsDone.includes(def.requires)) && !!me && levelOf(me.rep) >= (def.level ?? 1);
      g.group.visible = !indoors && !me?.mission;
      g.beam.material = open ? this.openMat : this.lockedMat;
      const bang = g.group.getObjectByName('bang')!;
      bang.visible = open;
      bang.position.y = 3.6 + bob;
      bang.rotation.y = this.time * 2;
    }
    this.fence.visible = !indoors;
    this.pinBeam.visible = !!this.pin && !indoors;
    const aimed = this.aim >= 0 ? (this.sim.peds.get(this.aim)?.state ?? this.sim.vehicles.get(this.aim)?.state) : undefined;
    this.reticle.visible = !!aimed;
    if (aimed) {
      this.reticle.position.set(aimed.x, aimed.y + 0.08, aimed.z);
      this.reticle.rotation.y = this.time * 2;
      const pulse = 1 + Math.sin(this.time * 8) * 0.08;
      this.reticle.scale.set(pulse, 1, pulse);
    }
    if (this.pin) this.pinBeam.position.set(this.pin[0], this.sim.groundY(this.pin[0], this.pin[1]), this.pin[1]);
    this.stash.visible = !!me?.stash && !indoors;
    if (me?.stash) this.stash.position.set(me.stash[0], this.sim.groundY(me.stash[0], me.stash[1]), me.stash[1]);
    this.sim.roofs.chests.forEach((c, i) => {
      const full = c.refill === 0 || this.sim.tick >= c.refill;
      this.chests[i].visible = full && !indoors && !!me && Math.abs(c.x - me.x) < 220 && Math.abs(c.z - me.z) < 220;
    });
    this.heist.visible = !indoors && !me?.mission;
    // players with a bounty: a big red arrow everybody can see
    let h = 0;
    if (!indoors && me) {
      for (const p of this.sim.players.values()) {
        const s = p.state;
        if (h >= this.hunted.length || s.id === me.id || s.bounty <= 0 || s.interior) continue;
        const a = this.hunted[h++];
        a.visible = true;
        a.position.set(s.x, s.y + 3.2 + bob, s.z);
        a.rotation.y = this.time * 4;
      }
    }
    for (let i = h; i < this.hunted.length; i++) this.hunted[i].visible = false;
    // your mission partner: small green arrow
    const ally = me && me.ally >= 0 ? this.sim.peds.get(me.ally) : undefined;
    this.allyMark.visible = !!ally;
    if (ally) {
      this.allyMark.position.set(ally.state.x, ally.state.y + 2.4 + bob, ally.state.z);
      this.allyMark.rotation.y = this.time * 2;
    }
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
