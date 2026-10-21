import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapData } from '../maps/types';
import { roomLayout } from '../sim/interiors';
import { toonGradient } from './materials';

/** Interior rooms (built off-map), from the same box list the sim uses for colliders. */
export class InteriorsView {
  readonly root = new THREE.Group();
  private rooms = new Map<string, THREE.Object3D>();

  constructor(map: MapData) {
    this.root.name = 'interiors';
    const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient(), side: THREE.DoubleSide });
    const unit = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    unit.deleteAttribute('uv');
    const c = new THREE.Color();
    for (const def of map.interiors) {
      const geos = roomLayout(def).boxes.map((b) => {
        const g = unit.clone();
        g.scale(b.sx, b.sy, b.sz).translate(b.x, b.y, b.z);
        const n = g.getAttribute('position').count;
        const col = new Float32Array(n * 3);
        c.setHex(b.color);
        for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return g;
      });
      const mesh = new THREE.Mesh(mergeGeometries(geos)!, mat);
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      mesh.visible = false;
      this.rooms.set(def.id, mesh);
      this.root.add(mesh);
    }
  }

  show(id: string | null) {
    for (const [k, m] of this.rooms) m.visible = k === id;
  }
}
