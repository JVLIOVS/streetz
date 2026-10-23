import * as THREE from 'three';
import type { Ped } from '../sim/peds';
import type { Vehicle } from '../sim/vehicle';
import { HumanView, randomLook, roleLook, type BaseAnim } from './human';

/** A limited set of outfits keeps the dressed-geometry cache small. */
const LOOK_VARIANTS = 40;

interface Entry {
  weapon: string;
  ko: boolean;
  view: HumanView;
  hitSeq: number;
  actionSeq: number;
  far: number;
}

/** Pedestrians (and moto riders): one HumanView per sim ped, created/destroyed with it. */
export class PedRenderer {
  readonly root = new THREE.Group();
  private views = new Map<number, Entry>();
  private riders = new Map<number, HumanView>();

  /** Blood effects requested by the pedestrians (hit = spurt, pool = on the ground). */
  onBlood?: (kind: 'hit' | 'pool', x: number, y: number, z: number) => void;

  constructor() {
    this.root.name = 'peds';
  }

  sync(peds: Map<number, Ped>, alpha: number, dt: number, cx: number, cz: number, viewDist: number) {
    for (const [id, e] of this.views) {
      if (!peds.has(id)) {
        e.view.dispose();
        this.views.delete(id);
      }
    }
    for (const ped of peds.values()) {
      const s = ped.state;
      const d = Math.hypot(s.x - cx, s.z - cz);
      let e = this.views.get(s.id);
      if (!e) {
        if (d > viewDist) continue;
        const look = s.role === 'civ' ? randomLook(s.look % LOOK_VARIANTS) : roleLook(s.role, s.look % 12);
        e = { view: new HumanView(look), hitSeq: s.hitSeq, actionSeq: s.actionSeq, far: 0, weapon: 'none', ko: false };
        this.views.set(s.id, e);
        this.root.add(e.view.root);
      }
      const v = e.view;
      v.root.visible = d < viewDist;
      if (!v.root.visible) continue;
      const p = ped.prev;
      v.root.position.set(p.x + (s.x - p.x) * alpha, p.y + (s.y - p.y) * alpha, p.z + (s.z - p.z) * alpha);
      let df = s.facing - p.facing;
      if (df > Math.PI) df -= Math.PI * 2;
      if (df < -Math.PI) df += Math.PI * 2;
      v.root.rotation.y = p.facing + df * alpha;
      const base: BaseAnim =
        s.mode === 'ko'
          ? 'ko'
          : s.mode === 'cower'
            ? 'cower'
            : s.mode === 'wave'
              ? 'wave'
              : s.mode === 'flee'
                ? 'sprint'
                : s.mode === 'police'
                  ? s.speed > 3.5
                    ? 'run'
                    : s.speed > 0.4
                      ? 'walk'
                      : s.weapon === 'pistol' || s.weapon === 'rifle'
                        ? 'aim'
                        : 'guard'
                : s.mode === 'fight' || s.mode === 'stun'
                  ? s.speed > 0.5
                    ? 'run'
                    : 'guard'
                  : s.speed > 0.2
                    ? 'walk'
                    : 'idle';
      v.setBase(base);
      if (base === 'walk') v.setSpeedScale(s.speed / 1.5);
      if (s.hitSeq !== e.hitSeq) {
        e.hitSeq = s.hitSeq;
        if (s.mode !== 'ko') v.playOverlay('hit');
        this.onBlood?.('hit', s.x, s.y + 1.3, s.z);
      }
      if ((s.mode === 'ko') !== e.ko) {
        e.ko = s.mode === 'ko';
        // fell down: a pool spreads under them (offset towards where the body lies)
        if (e.ko) this.onBlood?.('pool', s.x + Math.sin(s.facing) * 0.6, s.y, s.z + Math.cos(s.facing) * 0.6);
      }
      if (s.weapon !== e.weapon) {
        e.weapon = s.weapon;
        v.setWeapon(s.mode === 'ko' ? 'none' : s.weapon);
      }
      if (s.actionSeq !== e.actionSeq) {
        e.actionSeq = s.actionSeq;
        if (s.action) v.playOverlay(s.action);
      }
      v.setOutline(d < 18);
      v.setShadow(d < 25);
      // Animation LOD: far peds update at a lower rate
      e.far += dt;
      const step = d < 40 ? 0 : d < 80 ? 1 / 20 : 1 / 10;
      if (e.far >= step) {
        v.update(e.far);
        e.far = 0;
      }
    }
  }

  /** NPC moto riders, so scooters are never ghost-ridden. */
  syncRiders(vehicles: Map<number, Vehicle>, vehicleRoots: Map<number, THREE.Object3D>, dt: number) {
    for (const [id, r] of this.riders) {
      const v = vehicles.get(id);
      if (!v || v.state.driver !== 'npc') {
        r.dispose();
        this.riders.delete(id);
      }
    }
    for (const v of vehicles.values()) {
      if (v.state.type !== 'moto' || v.state.driver !== 'npc') continue;
      const root = vehicleRoots.get(v.state.id);
      if (!root) continue;
      let r = this.riders.get(v.state.id);
      if (!r) {
        r = new HumanView(randomLook(v.state.id % LOOK_VARIANTS));
        r.setBase('drive');
        r.root.position.set(0, 0.35, 0.15);
        root.children[0].add(r.root);
        this.riders.set(v.state.id, r);
      }
      if (root.visible) r.update(dt);
    }
  }
}
