import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VEHICLES, type VehicleType } from '../data/vehicles';
import type { Vehicle } from '../sim/vehicle';
import type { GameAssets } from './assets';
import { toonGradient } from './materials';

/**
 * Vehicle models: each type is baked into one merged geometry (1 draw call per car);
 * the car the player drives gets separate wheels that spin and steer.
 */
interface ModelParts {
  merged: THREE.BufferGeometry;
  body: THREE.BufferGeometry;
  wheels: { geo: THREE.BufferGeometry; pivot: THREE.Vector3; front: boolean }[];
  material: THREE.Material;
}

const KENNEY_TRUCKS = ['vehicle-truck-red', 'vehicle-truck-green', 'vehicle-truck-yellow'];
const models = new Map<string, ModelParts>();
let wreckMat: THREE.Material | null = null;

function toToon(m: THREE.Material): THREE.Material {
  const src = m as THREE.MeshStandardMaterial;
  const t = new THREE.MeshToonMaterial({ map: src.map ?? null, color: src.color ?? new THREE.Color(0xffffff), gradientMap: toonGradient() });
  if (t.map) t.map.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bake(root: THREE.Object3D, scale: number): ModelParts {
  const r = root.clone(true);
  r.position.set(0, 0, 0);
  r.rotation.set(0, 0, 0);
  r.scale.setScalar(scale);
  r.updateMatrixWorld(true);
  const all: THREE.BufferGeometry[] = [];
  const bodyParts: THREE.BufferGeometry[] = [];
  const wheels: ModelParts['wheels'] = [];
  let material: THREE.Material | null = null;
  r.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    material ??= toToon(mesh.material as THREE.Material);
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    const gi = g.index ? g.toNonIndexed() : g;
    all.push(gi);
    if (/wheel/i.test(mesh.name) || /wheel/i.test(mesh.parent?.name ?? '')) {
      gi.computeBoundingBox();
      const c = gi.boundingBox!.getCenter(new THREE.Vector3());
      wheels.push({ geo: gi.clone().translate(-c.x, -c.y, -c.z), pivot: c, front: false });
    } else bodyParts.push(gi);
  });
  const merged = mergeGeometries(all)!;
  const body = mergeGeometries(bodyParts)!;
  merged.computeBoundingSphere();
  return { merged, body, wheels, material: material! };
}

/** KayKit cars face +Z and Kenney vehicles face -Z… normalized here to the game's -Z forward. */
function modelFor(type: VehicleType, paint: number, assets: GameAssets): ModelParts {
  const spec = VEHICLES[type];
  const name = type === 'offroad' ? KENNEY_TRUCKS[paint % KENNEY_TRUCKS.length] : spec.model;
  let m = models.get(name);
  if (m) return m;
  const src = (spec.pack === 'city' ? assets.city : assets.vehicles).get(name);
  if (!src) throw new Error(`missing vehicle model ${name} in [${[...(spec.pack === "city" ? assets.city : assets.vehicles).keys()].join(",")}]`);
  m = bake(src, spec.scale);
  // Face -Z (game convention): KayKit cars point to +Z
  if (spec.pack === 'city') {
    const rot = new THREE.Matrix4().makeRotationY(Math.PI);
    m.merged.applyMatrix4(rot);
    m.body.applyMatrix4(rot);
    for (const w of m.wheels) w.pivot.applyMatrix4(rot);
  }
  // Ground the model: lowest point at y = 0
  m.merged.computeBoundingBox();
  const minY = m.merged.boundingBox!.min.y;
  m.merged.translate(0, -minY, 0);
  m.body.translate(0, -minY, 0);
  for (const w of m.wheels) {
    w.pivot.y -= minY;
    w.front = w.pivot.z < 0;
  }
  models.set(name, m);
  return m;
}

export class VehicleView {
  readonly root = new THREE.Group();
  private tilt = new THREE.Group();
  private merged: THREE.Mesh;
  private detail: THREE.Group | null = null;
  private wheels: { obj: THREE.Object3D; front: boolean }[] = [];
  private wrecked = false;
  lastSmoke = 0;

  constructor(
    readonly id: number,
    readonly type: VehicleType,
    private parts: ModelParts,
  ) {
    this.root.add(this.tilt);
    this.merged = new THREE.Mesh(parts.merged, parts.material);
    this.merged.castShadow = true;
    this.merged.receiveShadow = true;
    this.tilt.add(this.merged);
  }

  /** Detailed mode: separate wheels (used for the car the player drives). */
  setDetailed(on: boolean) {
    if (on === !!this.detail) return;
    if (on) {
      this.detail = new THREE.Group();
      const body = new THREE.Mesh(this.parts.body, this.merged.material);
      body.castShadow = true;
      this.detail.add(body);
      for (const w of this.parts.wheels) {
        const pivot = new THREE.Group();
        pivot.position.copy(w.pivot);
        const mesh = new THREE.Mesh(w.geo, this.merged.material);
        mesh.castShadow = true;
        pivot.add(mesh);
        this.detail.add(pivot);
        this.wheels.push({ obj: pivot, front: w.front });
      }
      this.tilt.add(this.detail);
      this.merged.visible = false;
    } else {
      this.detail!.removeFromParent();
      this.detail = null;
      this.wheels = [];
      this.merged.visible = true;
    }
  }

  setWrecked() {
    if (this.wrecked) return;
    this.wrecked = true;
    wreckMat ??= new THREE.MeshToonMaterial({ color: 0x2a2626, gradientMap: toonGradient() });
    this.merged.material = wreckMat;
    this.setDetailed(false);
  }

  update(v: Vehicle, alpha: number) {
    const s = v.state;
    const p = v.prev;
    this.root.position.set(p.x + (s.x - p.x) * alpha, p.y + (s.y - p.y) * alpha, p.z + (s.z - p.z) * alpha);
    let dy = s.yaw - p.yaw;
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    this.root.rotation.y = p.yaw + dy * alpha;
    this.tilt.rotation.set(p.pitch + (s.pitch - p.pitch) * alpha, 0, -(p.roll + (s.roll - p.roll) * alpha), 'YXZ');
    if (VEHICLES[s.type].twoWheels) this.tilt.rotation.z += -s.steer * Math.min(1, Math.abs(s.speed) / 12) * 0.6;
    if (s.wrecked) this.setWrecked();
    for (const w of this.wheels) {
      w.obj.rotation.set(-s.wheel, w.front ? -s.steer : 0, 0, 'YXZ');
    }
  }
}

export class VehicleRenderer {
  readonly root = new THREE.Group();
  readonly views = new Map<number, VehicleView>();

  constructor(private assets: GameAssets) {
    this.root.name = 'vehicles';
  }

  sync(vehicles: Map<number, Vehicle>, alpha: number, detailedId: number, cx: number, cz: number, viewDist: number) {
    for (const [id, view] of this.views) {
      if (!vehicles.has(id)) {
        view.root.removeFromParent();
        this.views.delete(id);
      }
    }
    for (const v of vehicles.values()) {
      let view = this.views.get(v.state.id);
      if (!view) {
        view = new VehicleView(v.state.id, v.state.type, modelFor(v.state.type, v.state.paint, this.assets));
        this.views.set(v.state.id, view);
        this.root.add(view.root);
      }
      const d = Math.hypot(v.state.x - cx, v.state.z - cz);
      view.root.visible = d < viewDist;
      if (!view.root.visible) continue;
      view.setDetailed(v.state.id === detailedId && !v.state.wrecked);
      view.update(v, alpha);
    }
  }
}
