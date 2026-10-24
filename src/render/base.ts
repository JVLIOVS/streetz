import * as THREE from 'three';
import { moduleById, type ModuleDef, type Placed } from '../data/base';
import type { InteriorDef } from '../maps/types';
import { canPlace, cellInFront, moduleCenter } from '../sim/base';
import type { PlayerState } from '../sim/player';
import type { SimWorld } from '../sim/world';
import { toon } from './materials';

const box = new THREE.BoxGeometry(1, 1, 1);

/**
 * The hideout you built (only yours is drawn: the room is shared in multiplayer) and,
 * in build mode, a see-through preview of the piece to place: green where it fits.
 */
export class BaseView {
  readonly root = new THREE.Group();
  private built = new THREE.Group();
  private ghost = new THREE.Group();
  private ghostKey = '';
  private key = '';
  private mats = new Map<number, THREE.Material>();
  private ok = new THREE.MeshBasicMaterial({ color: 0x5ee86a, transparent: true, opacity: 0.45, depthWrite: false });
  private bad = new THREE.MeshBasicMaterial({ color: 0xff3b4f, transparent: true, opacity: 0.45, depthWrite: false });
  /** Set by the build UI: the piece being placed and its rotation (null = not building). */
  build: { m: string; r: number } | null = null;
  /** Where the preview is (read by the build UI to send the place command). */
  target: Placed | null = null;
  fits = false;

  constructor(private sim: SimWorld) {
    this.root.name = 'base';
    this.root.add(this.built, this.ghost);
  }

  private mat(color: number) {
    let m = this.mats.get(color);
    if (!m) this.mats.set(color, (m = toon(color)));
    return m;
  }

  private model(m: ModuleDef, material?: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    for (const b of m.boxes) {
      const mesh = new THREE.Mesh(box, material ?? this.mat(b.color));
      mesh.scale.set(b.sx, b.sy, b.sz);
      mesh.position.set(b.x, b.y + b.sy / 2, b.z);
      g.add(mesh);
    }
    return g;
  }

  private place(g: THREE.Object3D, def: InteriorDef, m: ModuleDef, p: Placed) {
    const c = moduleCenter(def, m, p);
    g.position.set(c.x, 0, c.z);
    g.rotation.y = (-p.r * Math.PI) / 2;
  }

  sync(me: PlayerState | undefined) {
    const def = me?.interior ? this.sim.map.interiors.find((i) => i.id === me.interior) : undefined;
    const home = def?.kind === 'hideout' ? def : undefined;
    this.root.visible = !!home;
    this.target = null;
    this.fits = false;
    if (!home || !me) {
      this.ghost.visible = false;
      return;
    }
    const key = JSON.stringify(me.base);
    if (key !== this.key) {
      this.key = key;
      this.built.clear();
      for (const p of me.base) {
        const m = moduleById(p.m);
        if (!m) continue;
        const g = this.model(m);
        this.place(g, home, m, p);
        this.built.add(g);
      }
    }
    const m = this.build && moduleById(this.build.m);
    this.ghost.visible = !!m;
    if (!m || !this.build) return;
    const cell = cellInFront(home, m, this.build.r, me.x, me.z, me.facing);
    const target: Placed = { m: m.id, x: cell.x, z: cell.z, r: this.build.r };
    this.fits = canPlace(home, this.sim.rooms.get(home.id)!, me.base, target);
    this.target = target;
    const gk = `${m.id}|${this.fits}`;
    if (gk !== this.ghostKey) {
      this.ghostKey = gk;
      this.ghost.clear();
      this.ghost.add(this.model(m, this.fits ? this.ok : this.bad));
    }
    this.place(this.ghost, home, m, target);
  }
}
