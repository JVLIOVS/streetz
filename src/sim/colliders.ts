import type RAPIER_T from '@dimforge/rapier3d-compat';
import type { MapData } from '../maps/types';
import { GROUP, groups } from './physics';

/** Builds every static collider of a map in one fixed rigid body. */
export function buildStaticColliders(R: typeof RAPIER_T, world: RAPIER_T.World, map: MapData): number {
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const g = groups(GROUP.STATIC, 0xffff);
  let count = 0;
  const add = (desc: RAPIER_T.ColliderDesc) => {
    world.createCollider(desc.setCollisionGroups(g).setFriction(0.6), body);
    count++;
  };

  for (const s of map.solids) {
    if (s.noCollide) continue;
    const d = R.ColliderDesc.cuboid(s.sx / 2, s.sy / 2, s.sz / 2).setTranslation(s.x, s.y, s.z);
    if (s.rotZ || s.rotY) d.setRotation(eulerYZ(s.rotY ?? 0, s.rotZ ?? 0));
    add(d);
  }
  for (const b of map.buildings) {
    const h = b.h + b.roofH;
    add(R.ColliderDesc.cuboid(b.w / 2, h / 2, b.d / 2).setTranslation(b.x, h / 2, b.z));
  }
  for (const t of map.trees) {
    add(R.ColliderDesc.cylinder(1.5, 0.3 * t.s).setTranslation(t.x, t.y + 1.5, t.z));
  }
  for (const f of map.fountains) {
    add(R.ColliderDesc.cylinder(0.4, f.r).setTranslation(f.x, 0.4, f.z));
    add(R.ColliderDesc.cylinder(1.6, 0.8).setTranslation(f.x, 1.6, f.z));
  }
  if (map.terrain) {
    const t = map.terrain;
    // Rapier heightfields are column-major with rows along z: h[iz + ix * (res + 1)].
    const n = t.res + 1;
    const hf = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) hf[iz + ix * n] = t.heights[iz * n + ix];
    add(
      R.ColliderDesc.heightfield(t.res, t.res, hf, { x: t.sizeX, y: 1, z: t.sizeZ }).setTranslation(
        t.x0 + t.sizeX / 2,
        0,
        t.z0 + t.sizeZ / 2,
      ),
    );
  }
  return count;
}

function eulerYZ(yaw: number, roll: number) {
  // q = qY(yaw) * qZ(roll)
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cz = Math.cos(roll / 2);
  const sz = Math.sin(roll / 2);
  return { w: cy * cz, x: sy * sz, y: sy * cz, z: cy * sz };
}
