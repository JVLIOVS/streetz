import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { InteriorDef, MapData, PropKind } from '../maps/types';
import type { GameAssets } from './assets';
import { toonGradient } from './materials';

/**
 * Static decoration merged per chunk: KayKit street furniture (one textured mesh per chunk)
 * and building details (balconies, chimneys, awnings, entrances) as vertex-colored boxes.
 */

const PROP_MODELS: Record<PropKind, { name: string; scale: number }> = {
  streetlight: { name: 'streetlight', scale: 5.6 },
  trafficlight: { name: 'trafficlight_B', scale: 5 },
  bench: { name: 'bench', scale: 5 },
  trash: { name: 'trash_A', scale: 5 },
  hydrant: { name: 'firehydrant', scale: 4.2 },
  dumpster: { name: 'dumpster', scale: 5 },
  bush: { name: 'bush', scale: 4.5 },
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

let propMaterial: THREE.Material | null = null;
const propGeo = new Map<PropKind, THREE.BufferGeometry>();

function propGeometry(kind: PropKind, assets: GameAssets): THREE.BufferGeometry | null {
  if (propGeo.has(kind)) return propGeo.get(kind)!;
  const spec = PROP_MODELS[kind];
  const src = assets.city.get(spec.name);
  if (!src) return null;
  const r = src.clone(true);
  r.position.set(0, 0, 0);
  r.scale.setScalar(spec.scale);
  r.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  r.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!propMaterial) {
      const m = mesh.material as THREE.MeshStandardMaterial;
      propMaterial = new THREE.MeshToonMaterial({ map: m.map, gradientMap: toonGradient() });
    }
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    parts.push(g.index ? g.toNonIndexed() : g);
  });
  const g = mergeGeometries(parts)!;
  propGeo.set(kind, g);
  return g;
}

export interface ChunkMeshes {
  props: THREE.Mesh | null;
  details: THREE.Mesh | null;
}

/** Boxes with a vertex color, accumulated then merged. */
class BoxBatch {
  private geos: THREE.BufferGeometry[] = [];
  private unit = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();

  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, rotY = 0, rotX = 0) {
    const g = this.unit.clone();
    _q.setFromEuler(_e.set(rotX, rotY, 0, 'YXZ'));
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    g.applyMatrix4(_m);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    _c.setHex(color);
    for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    this.geos.push(g);
  }

  build(): THREE.BufferGeometry | null {
    if (this.geos.length === 0) return null;
    const g = mergeGeometries(this.geos)!;
    this.geos = [];
    return g;
  }
}

const detailMaterial = () => new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });

const AWNINGS = [0xd63031, 0x00a86b, 0x1e6fd9, 0xf39c12, 0x8e44ad, 0x2d3436];

export function buildChunkDetails(map: MapData, assets: GameAssets, chunkKey: (x: number, z: number) => number): Map<number, ChunkMeshes> {
  const propParts = new Map<number, THREE.BufferGeometry[]>();
  const batches = new Map<number, BoxBatch>();
  const batch = (k: number) => {
    let b = batches.get(k);
    if (!b) batches.set(k, (b = new BoxBatch()));
    return b;
  };

  for (const p of map.props) {
    const g = propGeometry(p.kind, assets);
    if (!g) continue;
    const k = chunkKey(p.x, p.z);
    _q.setFromEuler(_e.set(0, p.yaw, 0));
    _m.compose(_p.set(p.x, 0, p.z), _q, _s.set(1, 1, 1));
    if (!propParts.has(k)) propParts.set(k, []);
    propParts.get(k)!.push(g.clone().applyMatrix4(_m));
  }

  let seed = 0;
  for (const b of map.buildings) {
    const k = chunkKey(b.x, b.z);
    const bb = batch(k);
    seed++;
    if (b.style === 0) {
      // Haussmann: wrought-iron balconies on the 2nd floor and the top floor, chimneys on the roof
      const gf = 4.2;
      const fh = 3.1;
      const topRow = Math.floor((b.h - 1.2 - gf) / fh) - 1;
      for (const row of [0, topRow]) {
        const y = gf + row * fh + 0.08;
        for (const [nx, nz] of [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ]) {
          const along = nx === 0 ? b.w : b.d;
          const cx = b.x + nx * (b.w / 2 + 0.35);
          const cz = b.z + nz * (b.d / 2 + 0.35);
          const sx = nx === 0 ? along - 0.6 : 0.7;
          const sz = nx === 0 ? 0.7 : along - 0.6;
          bb.add(cx, y, cz, sx, 0.14, sz, 0xe8dcc4);
          // railing
          const rx = b.x + nx * (b.w / 2 + 0.68);
          const rz = b.z + nz * (b.d / 2 + 0.68);
          bb.add(rx, y + 0.5, rz, nx === 0 ? along - 0.6 : 0.06, 0.9, nx === 0 ? 0.06 : along - 0.6, 0x1d2230);
        }
      }
      const n = 1 + (seed % 3);
      for (let i = 0; i < n; i++) {
        const t = (i + 1) / (n + 1) - 0.5;
        const alongX = b.w > b.d;
        bb.add(b.x + (alongX ? t * b.w : 0), b.h + b.roofH + 0.6, b.z + (alongX ? 0 : t * b.d), 1.0, 2.0, 0.7, 0xc0634a);
      }
    } else if (b.style === 2) {
      // Shops: colorful awnings over the ground floor
      const col = AWNINGS[seed % AWNINGS.length];
      for (const [nx, nz] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const along = (nx === 0 ? b.w : b.d) - 1.2;
        const cx = b.x + nx * (b.w / 2 + 0.7);
        const cz = b.z + nz * (b.d / 2 + 0.7);
        const rotY = nx === 0 ? 0 : Math.PI / 2;
        const tilt = (nz !== 0 ? nz : nx) * 0.35;
        bb.add(cx, 3.7, cz, along, 0.12, 1.6, col, rotY, nx === 0 ? tilt : -tilt);
      }
    } else if (b.style === 1) {
      // Towers: rooftop water tanks / antennas
      bb.add(b.x + b.w * 0.2, b.h + b.roofH + 1.2, b.z, 2.5, 2.4, 2.5, 0x9aa0a8);
    }
  }

  // Entrances of enterable buildings
  for (const def of map.interiors) {
    const k = chunkKey(def.door.x, def.door.z);
    addEntrance(batch(k), def);
  }

  const out = new Map<number, ChunkMeshes>();
  const keys = new Set([...propParts.keys(), ...batches.keys()]);
  const dmat = detailMaterial();
  for (const k of keys) {
    const parts = propParts.get(k);
    const props = parts && propMaterial ? new THREE.Mesh(mergeGeometries(parts)!, propMaterial) : null;
    const dg = batches.get(k)?.build();
    const details = dg ? new THREE.Mesh(dg, dmat) : null;
    for (const m of [props, details]) {
      if (!m) continue;
      m.castShadow = true;
      m.receiveShadow = true;
      m.geometry.computeBoundingSphere();
    }
    out.set(k, { props, details });
  }
  return out;
}

function addEntrance(bb: BoxBatch, def: InteriorDef) {
  const { x, z, yaw } = def.door;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const at = (f: number, r: number) => [x + fx * f + rx * r, z + fz * f + rz * r] as const;
  // glass door + frame, slightly in front of the wall
  let [px, pz] = at(0.06, 0);
  bb.add(px, 1.35, pz, Math.abs(rx) * 2.4 + 0.12, 2.7, Math.abs(rz) * 2.4 + 0.12, 0x6fb7d9, 0);
  [px, pz] = at(0.12, 0);
  bb.add(px, 1.35, pz, Math.abs(rx) * 0.12 + 0.04, 2.6, Math.abs(rz) * 0.12 + 0.04, 0x2a3a4a, 0);
  for (const side of [-1.3, 1.3]) {
    [px, pz] = at(0.1, side);
    bb.add(px, 1.45, pz, Math.abs(rx) * 0.25 + 0.2, 2.9, Math.abs(rz) * 0.25 + 0.2, 0xf5f0e6);
  }
  // awning in the sign color
  [px, pz] = at(1.0, 0);
  bb.add(px, 3.25, pz, Math.abs(rx) * 3.8 + Math.abs(rz) * 2, 0.15, Math.abs(rz) * 3.8 + Math.abs(rx) * 2, def.signColor);
  // welcome mat
  [px, pz] = at(0.9, 0);
  bb.add(px, 0.03, pz, Math.abs(rx) * 2 + Math.abs(rz) * 1.2, 0.04, Math.abs(rz) * 2 + Math.abs(rx) * 1.2, 0xb33939);
}

/** Bright text signs above entrances (canvas textures). */
export function buildSigns(map: MapData): THREE.Group {
  const g = new THREE.Group();
  g.name = 'signs';
  for (const def of map.interiors) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const ctx = c.getContext('2d')!;
    const col = '#' + def.signColor.toString(16).padStart(6, '0');
    ctx.fillStyle = '#1b1430';
    roundRect(ctx, 4, 4, 504, 88, 18);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = col;
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.font = '900 54px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 54;
    while (ctx.measureText(def.sign).width > 470 && size > 20) ctx.font = `900 ${(size -= 2)}px system-ui, sans-serif`;
    ctx.fillText(def.sign, 256, 50);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.05), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    const fx = -Math.sin(def.door.yaw);
    const fz = -Math.cos(def.door.yaw);
    mesh.position.set(def.door.x + fx * 0.15, 4.3, def.door.z + fz * 0.15);
    mesh.rotation.y = def.door.yaw + Math.PI;
    g.add(mesh);
  }
  return g;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
