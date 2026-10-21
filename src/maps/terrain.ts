import type { TerrainDef } from './types';

/** Bilinear height of the terrain at world (x, z); 0 outside. */
export function terrainHeight(t: TerrainDef, x: number, z: number): number {
  const fx = ((x - t.x0) / t.sizeX) * t.res;
  const fz = ((z - t.z0) / t.sizeZ) * t.res;
  if (fx < 0 || fz < 0 || fx > t.res || fz > t.res) return 0;
  const ix = Math.min(t.res - 1, Math.floor(fx));
  const iz = Math.min(t.res - 1, Math.floor(fz));
  const tx = fx - ix;
  const tz = fz - iz;
  const n = t.res + 1;
  const h00 = t.heights[iz * n + ix];
  const h10 = t.heights[iz * n + ix + 1];
  const h01 = t.heights[(iz + 1) * n + ix];
  const h11 = t.heights[(iz + 1) * n + ix + 1];
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

export function terrainSlope(t: TerrainDef, x: number, z: number): number {
  const e = 2;
  const dx = terrainHeight(t, x + e, z) - terrainHeight(t, x - e, z);
  const dz = terrainHeight(t, x, z + e) - terrainHeight(t, x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}
