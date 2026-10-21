import * as THREE from 'three';
import type { MapData } from '../maps/types';
import type { GameAssets } from './assets';
import { buildChunkDetails, buildSigns } from './details';
import { buildingMaterial, roadMaterial, roofMaterial, toon, waterMaterial } from './materials';

export const CHUNK_SIZE = 125;

interface Chunk {
  cx: number;
  cz: number;
  group: THREE.Group;
  /** Meshes hidden beyond the LOD distance (roofs, trees). */
  detail: THREE.Object3D[];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _e = new THREE.Euler();

/**
 * Static city: buildings and trees are split in chunks (one InstancedMesh per chunk and
 * per material), roads/ground/water are single meshes. Chunks are shown by distance.
 */
export class CityView {
  readonly root = new THREE.Group();
  readonly chunks: Chunk[] = [];
  private buildingMat = buildingMaterial();
  private roofMat = roofMaterial();

  constructor(map: MapData, opts: { shadows: boolean }, assets: GameAssets) {
    this.root.name = 'city';
    const n = Math.ceil((map.half * 2) / CHUNK_SIZE);
    const grid: Chunk[][] = [];
    for (let i = 0; i < n; i++) {
      grid.push([]);
      for (let j = 0; j < n; j++) {
        const c: Chunk = {
          cx: -map.half + (i + 0.5) * CHUNK_SIZE,
          cz: -map.half + (j + 0.5) * CHUNK_SIZE,
          group: new THREE.Group(),
          detail: [],
        };
        c.group.name = `chunk_${i}_${j}`;
        grid[i].push(c);
        this.chunks.push(c);
        this.root.add(c.group);
      }
    }
    const chunkOf = (x: number, z: number) => {
      const i = Math.min(n - 1, Math.max(0, Math.floor((x + map.half) / CHUNK_SIZE)));
      const j = Math.min(n - 1, Math.max(0, Math.floor((z + map.half) / CHUNK_SIZE)));
      return grid[i][j];
    };

    this.buildBuildings(map, chunkOf, opts.shadows);
    const chunkKey = (x: number, z: number) => {
      const c = chunkOf(x, z);
      return this.chunks.indexOf(c);
    };
    for (const [k, m] of buildChunkDetails(map, assets, chunkKey)) {
      const c = this.chunks[k];
      for (const mesh of [m.props, m.details]) {
        if (!mesh) continue;
        mesh.castShadow = opts.shadows;
        mesh.receiveShadow = opts.shadows;
        c.group.add(mesh);
        c.detail.push(mesh);
      }
    }
    this.root.add(buildSigns(map));
    this.buildTrees(map, chunkOf, opts.shadows);
    this.root.add(this.buildSolids(map, opts.shadows));
    this.root.add(this.buildRoads(map, opts.shadows));
    for (const w of map.water) {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(w.x1 - w.x0, w.z1 - w.z0, 1, 1), waterMaterial());
      water.rotation.x = -Math.PI / 2;
      water.position.set((w.x0 + w.x1) / 2, w.y, (w.z0 + w.z1) / 2);
      water.receiveShadow = opts.shadows;
      water.name = 'water';
      this.root.add(water);
    }
    if (map.terrain) this.root.add(this.buildTerrain(map, opts.shadows));
    this.root.add(this.buildFountains(map, opts.shadows));
  }

  /** Show chunks within viewDist of (x, z); hide details beyond lodDist. */
  updateVisibility(x: number, z: number, viewDist: number, lodDist: number) {
    const r = CHUNK_SIZE * 0.71;
    for (const c of this.chunks) {
      const d = Math.hypot(c.cx - x, c.cz - z) - r;
      c.group.visible = d < viewDist;
      const near = d < lodDist;
      for (const o of c.detail) o.visible = near;
    }
  }

  private buildBuildings(map: MapData, chunkOf: (x: number, z: number) => Chunk, shadows: boolean) {
    const per = new Map<Chunk, number[]>();
    map.buildings.forEach((b, i) => {
      const c = chunkOf(b.x, b.z);
      if (!per.has(c)) per.set(c, []);
      per.get(c)!.push(i);
    });
    // Centered unit boxes: the shaders rely on position + 0.5 being the 0..1 local coordinate.
    for (const [chunk, ids] of per) {
      const wallGeo = new THREE.BoxGeometry(1, 1, 1);
      const roofGeo = new THREE.BoxGeometry(1, 1, 1);
      const walls = new THREE.InstancedMesh(wallGeo, this.buildingMat, ids.length);
      const roofs = new THREE.InstancedMesh(roofGeo, this.roofMat, ids.length);
      const params = new Float32Array(ids.length * 4);
      const inset = new Float32Array(ids.length);
      ids.forEach((id, k) => {
        const b = map.buildings[id];
        _q.identity();
        _m.compose(_p.set(b.x, b.h / 2, b.z), _q, _s.set(b.w, b.h, b.d));
        walls.setMatrixAt(k, _m);
        walls.setColorAt(k, _c.setHex(b.color));
        _m.compose(_p.set(b.x, b.h + b.roofH / 2, b.z), _q, _s.set(b.w, b.roofH, b.d));
        roofs.setMatrixAt(k, _m);
        roofs.setColorAt(k, _c.setHex(b.roofColor));
        const floorH = b.style === 0 ? 3.1 : b.style === 1 ? 2.8 : 3.4;
        const gf = b.style === 1 ? 3.0 : 4.2;
        params.set([b.style, (id * 0.6180339) % 1, floorH, gf], k * 4);
        inset[k] = b.style === 0 ? Math.min(1.8, b.roofH * 0.5) : 0;
      });
      wallGeo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
      roofGeo.setAttribute('aInset', new THREE.InstancedBufferAttribute(inset, 1));
      for (const mesh of [walls, roofs]) {
        mesh.castShadow = shadows;
        mesh.receiveShadow = shadows;
        mesh.computeBoundingSphere();
        chunk.group.add(mesh);
      }
      walls.name = 'buildings';
      roofs.name = 'roofs';
      chunk.detail.push(roofs);
    }
  }

  private buildTrees(map: MapData, chunkOf: (x: number, z: number) => Chunk, shadows: boolean) {
    const per = new Map<Chunk, number[]>();
    map.trees.forEach((t, i) => {
      const c = chunkOf(t.x, t.z);
      if (!per.has(c)) per.set(c, []);
      per.get(c)!.push(i);
    });
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 3, 6);
    trunkGeo.translate(0, 1.5, 0);
    const crownGeo = new THREE.IcosahedronGeometry(2.2, 0);
    crownGeo.translate(0, 4.4, 0);
    const trunkMat = toon(0x7a5232);
    const crownMat = toon(0xffffff); // icosahedron detail 0 already has flat normals
    const greens = [0x55c43a, 0x4bb33a, 0x6fd14a, 0x3fa846];
    for (const [chunk, ids] of per) {
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, ids.length);
      const crowns = new THREE.InstancedMesh(crownGeo, crownMat, ids.length);
      ids.forEach((id, k) => {
        const t = map.trees[id];
        _q.setFromEuler(_e.set(0, (id * 2.39996) % (Math.PI * 2), 0));
        _m.compose(_p.set(t.x, t.y, t.z), _q, _s.setScalar(t.s));
        trunks.setMatrixAt(k, _m);
        crowns.setMatrixAt(k, _m);
        crowns.setColorAt(k, _c.setHex(greens[id % greens.length]));
      });
      for (const mesh of [trunks, crowns]) {
        mesh.castShadow = shadows;
        mesh.receiveShadow = false;
        mesh.computeBoundingSphere();
        chunk.group.add(mesh);
        chunk.detail.push(mesh);
      }
    }
  }

  private buildSolids(map: MapData, shadows: boolean) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geo, toon(0xffffff), map.solids.length);
    map.solids.forEach((s, k) => {
      _q.setFromEuler(_e.set(0, s.rotY ?? 0, s.rotZ ?? 0, 'YZX'));
      _m.compose(_p.set(s.x, s.y, s.z), _q, _s.set(s.sx, s.sy, s.sz));
      mesh.setMatrixAt(k, _m);
      mesh.setColorAt(k, _c.setHex(s.color));
    });
    mesh.receiveShadow = shadows;
    mesh.castShadow = false;
    mesh.computeBoundingSphere();
    mesh.name = 'solids';
    return mesh;
  }

  private buildRoads(map: MapData, shadows: boolean) {
    const geo = new THREE.BoxGeometry(1, 0.02, 1);
    const kinds = new Float32Array(map.roads.length);
    const mesh = new THREE.InstancedMesh(geo, roadMaterial(), map.roads.length);
    map.roads.forEach((r, k) => {
      // Local x along traffic: roads running along z are rotated by 90°
      const alongZ = r.axis === 'z';
      _q.setFromEuler(_e.set(0, alongZ ? Math.PI / 2 : 0, 0));
      _m.compose(_p.set(r.x, r.y + 0.015, r.z), _q, _s.set(alongZ ? r.d : r.w, 1, alongZ ? r.w : r.d));
      mesh.setMatrixAt(k, _m);
      kinds[k] = r.kind === 'street' ? 0 : r.kind === 'boulevard' ? 1 : r.kind === 'highway' ? 2 : 3;
    });
    mesh.geometry.setAttribute('aRoad', new THREE.InstancedBufferAttribute(kinds, 1));
    mesh.receiveShadow = shadows;
    mesh.computeBoundingSphere();
    mesh.name = 'roads';
    return mesh;
  }

  private buildTerrain(map: MapData, shadows: boolean) {
    const t = map.terrain!;
    const geo = new THREE.PlaneGeometry(t.sizeX, t.sizeZ, t.res, t.res);
    geo.rotateX(-Math.PI / 2);
    // After rotateX(-90°), PlaneGeometry row 0 lies at z = -sizeZ/2: vertex i = iz * (res + 1) + ix.
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const n = t.res + 1;
    const low = new THREE.Color(0x6ccf4f);
    const high = new THREE.Color(0xb5e061);
    const dirt = new THREE.Color(0xc99a5b);
    for (let i = 0; i < pos.count; i++) {
      const ix = i % n;
      const iz = Math.floor(i / n);
      const h = t.heights[iz * n + ix];
      pos.setY(i, h + 0.06);
      // slope estimate for dirt on steep parts
      const hx = t.heights[iz * n + Math.min(n - 1, ix + 1)] - t.heights[iz * n + Math.max(0, ix - 1)];
      const hz = t.heights[Math.min(n - 1, iz + 1) * n + ix] - t.heights[Math.max(0, iz - 1) * n + ix];
      const slope = Math.hypot(hx, hz) / (2 * (t.sizeX / t.res));
      _c.copy(low).lerp(high, Math.min(1, h / 18)).lerp(dirt, Math.min(1, Math.max(0, (slope - 0.35) * 2.5)));
      colors.set([_c.r, _c.g, _c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true }));
    mesh.position.set(t.x0 + t.sizeX / 2, 0, t.z0 + t.sizeZ / 2);
    mesh.receiveShadow = shadows;
    mesh.name = 'terrain';
    return mesh;
  }

  private buildFountains(map: MapData, shadows: boolean) {
    const g = new THREE.Group();
    const stone = toon(0xe9dcc0);
    const water = toon(0x55c8ef);
    const basin = new THREE.CylinderGeometry(1, 1.05, 0.8, 24);
    const pool = new THREE.CircleGeometry(1, 24);
    const column = new THREE.CylinderGeometry(0.5, 0.8, 3.2, 12);
    const bowl = new THREE.CylinderGeometry(1.6, 0.6, 0.5, 16);
    for (const f of map.fountains) {
      const b = new THREE.Mesh(basin, stone);
      b.scale.set(f.r, 1, f.r);
      b.position.set(f.x, 0.4, f.z);
      const p = new THREE.Mesh(pool, water);
      p.rotation.x = -Math.PI / 2;
      p.scale.setScalar(f.r - 0.3);
      p.position.set(f.x, 0.82, f.z);
      const c = new THREE.Mesh(column, stone);
      c.position.set(f.x, 1.6, f.z);
      const bw = new THREE.Mesh(bowl, stone);
      bw.position.set(f.x, 3.1, f.z);
      for (const m of [b, c, bw]) m.castShadow = shadows;
      g.add(b, p, c, bw);
    }
    g.name = 'fountains';
    return g;
  }
}
