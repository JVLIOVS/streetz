import * as THREE from 'three';
import type { Heli } from '../sim/police';
import { toon } from './materials';

/** Police / army helicopters, built from primitives (no CC0 model available). */
function buildHeli(army: boolean): { root: THREE.Group; rotor: THREE.Object3D; tailRotor: THREE.Object3D; light: THREE.Mesh } {
  const root = new THREE.Group();
  const body = toon(army ? 0x55663f : 0x1f3a7a);
  const stripe = toon(army ? 0x3d4a2c : 0xf2f2f2);
  const glass = toon(0x8fd3ff);
  const dark = toon(0x222428);
  const cabin = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), body);
  cabin.scale.set(1, 0.9, 1.5);
  const window = new THREE.Mesh(new THREE.SphereGeometry(1.25, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  window.rotation.x = -Math.PI / 2 - 0.3;
  window.position.set(0, 0.25, -1.2);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.62, 1.62, 0.35, 16), stripe);
  band.scale.set(1, 1, 1.5);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.35, 5, 8), body);
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, 0.3, 4);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.3, 0.8), body);
  fin.position.set(0, 0.9, 6.3);
  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.18), dark);
  tailRotor.position.set(0.2, 0.9, 6.3);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.6, 8), dark);
  mast.position.y = 1.6;
  const rotor = new THREE.Group();
  rotor.position.y = 1.9;
  for (let k = 0; k < 4; k++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 5.5), dark);
    blade.rotation.y = (k * Math.PI) / 2;
    blade.position.set(Math.sin((k * Math.PI) / 2) * 2.75, 0, Math.cos((k * Math.PI) / 2) * 2.75);
    rotor.add(blade);
  }
  for (const sx of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 4), dark);
    skid.position.set(sx * 1.1, -1.6, 0);
    root.add(skid);
  }
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2030 }));
  light.position.set(0, -1.3, -1.6);
  root.add(cabin, window, band, boom, fin, tailRotor, mast, rotor, light);
  root.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return { root, rotor, tailRotor, light };
}

export class HeliRenderer {
  readonly root = new THREE.Group();
  private views = new Map<number, ReturnType<typeof buildHeli>>();

  sync(helis: Map<number, Heli>, alpha: number) {
    for (const [id, v] of this.views) {
      if (!helis.has(id)) {
        v.root.removeFromParent();
        this.views.delete(id);
      }
    }
    for (const h of helis.values()) {
      const s = h.state;
      let v = this.views.get(s.id);
      if (!v) {
        v = buildHeli(s.army);
        this.views.set(s.id, v);
        this.root.add(v.root);
      }
      const p = h.prev;
      v.root.position.set(p.x + (s.x - p.x) * alpha, p.y + (s.y - p.y) * alpha, p.z + (s.z - p.z) * alpha);
      let dy = s.yaw - p.yaw;
      if (dy > Math.PI) dy -= Math.PI * 2;
      if (dy < -Math.PI) dy += Math.PI * 2;
      v.root.rotation.set(s.down >= 0 ? 0.4 : 0.12, p.yaw + dy * alpha, s.down >= 0 ? 0.3 : 0, 'YXZ');
      v.rotor.rotation.y = s.rotor;
      v.tailRotor.rotation.x = s.rotor * 2;
      v.light.visible = s.down < 0 && Math.floor(performance.now() / 300) % 2 === 0;
    }
  }
}
