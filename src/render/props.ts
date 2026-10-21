import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapData } from '../maps/types';
import type { PropField } from '../sim/props';
import type { GameAssets } from './assets';
import { detailMaterial, propGeometry, propMaterial } from './details';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _ax = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

interface ChunkProps {
  ids: number[];
  meshes: THREE.Mesh[];
  dirty: boolean;
}

/**
 * Street furniture: intact props are merged per chunk (1–2 draw calls); when one breaks,
 * its chunk is rebuilt without it and a separate debris mesh follows the sim.
 */
export class PropsView {
  readonly root = new THREE.Group();
  private chunks = new Map<number, ChunkProps>();
  private known = new Set<number>();
  private debris = new Map<number, THREE.Mesh>();
  private vcMat = detailMaterial();

  constructor(
    private map: MapData,
    private assets: GameAssets,
    private groups: THREE.Group[],
    chunkOf: (x: number, z: number) => number,
    private shadows: boolean,
    private detailList: (k: number) => THREE.Object3D[],
  ) {
    this.root.name = 'debris';
    map.props.forEach((p, i) => {
      const k = chunkOf(p.x, p.z);
      let c = this.chunks.get(k);
      if (!c) this.chunks.set(k, (c = { ids: [], meshes: [], dirty: true }));
      c.ids.push(i);
    });
    for (const [k, c] of this.chunks) this.rebuild(k, c);
  }

  private rebuild(k: number, c: ChunkProps) {
    for (const m of c.meshes) {
      m.removeFromParent();
      m.geometry.dispose();
      const list = this.detailList(k);
      const at = list.indexOf(m);
      if (at >= 0) list.splice(at, 1);
    }
    c.meshes = [];
    const atlas: THREE.BufferGeometry[] = [];
    const vc: THREE.BufferGeometry[] = [];
    for (const i of c.ids) {
      if (this.known.has(i)) continue;
      const p = this.map.props[i];
      const g = propGeometry(p.kind, this.assets);
      if (!g) continue;
      _q.setFromAxisAngle(_up, p.yaw);
      _m.compose(_p.set(p.x, 0, p.z), _q, _s);
      (g.getAttribute('color') ? vc : atlas).push(g.clone().applyMatrix4(_m));
    }
    if (atlas.length && propMaterial) c.meshes.push(new THREE.Mesh(mergeGeometries(atlas)!, propMaterial));
    if (vc.length) c.meshes.push(new THREE.Mesh(mergeGeometries(vc)!, this.vcMat));
    for (const m of c.meshes) {
      m.castShadow = this.shadows;
      m.receiveShadow = this.shadows;
      m.geometry.computeBoundingSphere();
      this.groups[k].add(m);
      this.detailList(k).push(m);
    }
    c.dirty = false;
  }

  sync(field: PropField, cx: number, cz: number) {
    for (const [id, d] of field.broken) {
      if (!this.known.has(id)) {
        this.known.add(id);
        for (const [, c] of this.chunks) if (c.ids.includes(id)) c.dirty = true;
        const g = propGeometry(this.map.props[id].kind, this.assets);
        if (g) {
          const mesh = new THREE.Mesh(g, g.getAttribute('color') ? this.vcMat : propMaterial!);
          mesh.castShadow = this.shadows;
          this.debris.set(id, mesh);
          this.root.add(mesh);
        }
      }
      const mesh = this.debris.get(id);
      if (!mesh) continue;
      mesh.visible = Math.hypot(d.x - cx, d.z - cz) < 160;
      if (!mesh.visible) continue;
      _ax.set(d.ax, 0, d.az);
      _q.setFromAxisAngle(_ax, d.tilt);
      _q2.setFromAxisAngle(_up, this.map.props[id].yaw + d.spin);
      mesh.quaternion.multiplyQuaternions(_q, _q2);
      mesh.position.set(d.x, d.y, d.z);
    }
    for (const [k, c] of this.chunks) if (c.dirty) this.rebuild(k, c);
  }
}
