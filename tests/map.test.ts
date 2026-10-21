import { describe, expect, it } from 'vitest';
import { buildParisMap, RIVER, terrainHeight } from '../src/maps/paris/layout';

const map = buildParisMap();

describe('Paris map', () => {
  it('is deterministic', () => {
    const again = buildParisMap();
    expect(again.buildings.length).toBe(map.buildings.length);
    expect(again.buildings[123]).toEqual(map.buildings[123]);
  });

  it('has a full city with all required places', () => {
    expect(map.buildings.length).toBeGreaterThan(500);
    const kinds = new Set(map.pois.map((p) => p.kind));
    for (const k of ['police', 'hospital', 'garage', 'bank', 'jewelry', 'shop', 'airport', 'hideout', 'fountain']) {
      expect(kinds.has(k as never), k).toBe(true);
    }
    expect(map.roads.some((r) => r.kind === 'highway')).toBe(true);
    expect(map.solids.filter((s) => s.kind === 'bridge').length).toBeGreaterThanOrEqual(3);
    expect(map.terrain).not.toBeNull();
  });

  it('keeps buildings out of the river and inside the map', () => {
    for (const b of map.buildings) {
      const z0 = b.z - b.d / 2;
      const z1 = b.z + b.d / 2;
      expect(z1 <= RIVER.quayZ0 || z0 >= RIVER.quayZ1).toBe(true);
      expect(Math.abs(b.x) + b.w / 2).toBeLessThan(map.half);
      expect(Math.abs(b.z) + b.d / 2).toBeLessThan(map.half);
    }
  });

  it('keeps buildings off the roads', () => {
    for (const r of map.roads) {
      for (const b of map.buildings) {
        const ox = Math.min(r.x + r.w / 2, b.x + b.w / 2) - Math.max(r.x - r.w / 2, b.x - b.w / 2);
        const oz = Math.min(r.z + r.d / 2, b.z + b.d / 2) - Math.max(r.z - r.d / 2, b.z - b.d / 2);
        expect(ox > 0.01 && oz > 0.01, `building at ${b.x},${b.z} overlaps road at ${r.x},${r.z}`).toBe(false);
      }
    }
  });

  it('has a hilly park that meets the ground at its border', () => {
    const t = map.terrain!;
    expect(Math.max(...t.heights)).toBeGreaterThan(12);
    expect(terrainHeight(t, t.x0 + 0.5, t.z0 + t.sizeZ / 2)).toBeLessThan(0.5);
  });

  it('spawns on dry land, away from buildings', () => {
    const s = map.spawn;
    for (const b of map.buildings) {
      const inside = Math.abs(s.x - b.x) < b.w / 2 + 1 && Math.abs(s.z - b.z) < b.d / 2 + 1;
      expect(inside).toBe(false);
    }
  });
});
