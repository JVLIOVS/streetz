import { DT } from '../core/loop';
import type { PropDef, PropKind } from '../maps/types';

/**
 * Breakable street furniture. Intact props are static colliders; once hit (car, bullet,
 * kick, explosion) they become debris simulated here with simple ballistics: poles tip
 * over around their base, small things fly and tumble. Broken props stay broken.
 */

export interface PropSpec {
  /** Collider: cylinder (radius, height) or box (sx, sy, sz). */
  shape: { kind: 'cyl'; r: number; h: number } | { kind: 'box'; sx: number; sy: number; sz: number };
  /** Poles pivot around their base; light objects fly. */
  pole: boolean;
  /** Fraction of speed a car keeps when it plows through. */
  carKeep: number;
  /** Damage dealt to the car. */
  carDamage: number;
  /** Bullets / kicks can break it. */
  fragile: boolean;
}

export const PROP_SPECS: Record<PropKind, PropSpec> = {
  streetlight: { shape: { kind: 'cyl', r: 0.16, h: 5.4 }, pole: true, carKeep: 0.75, carDamage: 8, fragile: false },
  trafficlight: { shape: { kind: 'cyl', r: 0.16, h: 4.6 }, pole: true, carKeep: 0.75, carDamage: 8, fragile: false },
  bollard: { shape: { kind: 'cyl', r: 0.12, h: 0.9 }, pole: false, carKeep: 0.94, carDamage: 2, fragile: true },
  hydrant: { shape: { kind: 'cyl', r: 0.22, h: 0.9 }, pole: false, carKeep: 0.9, carDamage: 4, fragile: true },
  trash: { shape: { kind: 'box', sx: 0.6, sy: 0.4, sz: 0.6 }, pole: false, carKeep: 0.97, carDamage: 0, fragile: true },
  bench: { shape: { kind: 'box', sx: 2, sy: 0.5, sz: 0.7 }, pole: false, carKeep: 0.88, carDamage: 3, fragile: true },
  dumpster: { shape: { kind: 'box', sx: 2.8, sy: 1.6, sz: 1.7 }, pole: false, carKeep: 0.55, carDamage: 10, fragile: false },
  bush: { shape: { kind: 'cyl', r: 0.6, h: 1.4 }, pole: false, carKeep: 0.95, carDamage: 0, fragile: true },
};

/** Serializable state of a broken prop (intact ones are implied by the map data). */
export interface BrokenProp {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Tilt around the horizontal axis (ax, az), and spin around Y. */
  tilt: number;
  ax: number;
  az: number;
  spin: number;
  /** Hydrants spray water for a while. */
  spray: number;
}

interface Debris extends BrokenProp {
  vx: number;
  vy: number;
  vz: number;
  tiltV: number;
  spinV: number;
  resting: boolean;
}

const CELL = 12;

export class PropField {
  readonly broken = new Map<number, Debris>();
  private grid = new Map<string, number[]>();

  constructor(readonly defs: PropDef[]) {
    defs.forEach((p, i) => {
      const k = key(p.x, p.z);
      let c = this.grid.get(k);
      if (!c) this.grid.set(k, (c = []));
      c.push(i);
    });
  }

  /** Intact props within `r` of (x, z). */
  near(x: number, z: number, r: number, out: number[] = []): number[] {
    out.length = 0;
    const c0 = Math.floor((x - r) / CELL);
    const c1 = Math.floor((x + r) / CELL);
    const r0 = Math.floor((z - r) / CELL);
    const r1 = Math.floor((z + r) / CELL);
    for (let cx = c0; cx <= c1; cx++)
      for (let cz = r0; cz <= r1; cz++) {
        const cell = this.grid.get(`${cx}:${cz}`);
        if (!cell) continue;
        for (const i of cell) {
          if (this.broken.has(i)) continue;
          const p = this.defs[i];
          if (Math.abs(p.x - x) <= r + 1.5 && Math.abs(p.z - z) <= r + 1.5) out.push(i);
        }
      }
    return out;
  }

  /** Approximate footprint radius of a prop. */
  radius(i: number): number {
    const sh = PROP_SPECS[this.defs[i].kind].shape;
    return sh.kind === 'cyl' ? sh.r : Math.max(sh.sx, sh.sz) / 2;
  }

  /** Breaks prop i with a push (vx, vz) in m/s. Returns false if already broken. */
  break(i: number, vx: number, vz: number, up = 2): boolean {
    if (this.broken.has(i)) return false;
    const p = this.defs[i];
    const spec = PROP_SPECS[p.kind];
    const sp = Math.hypot(vx, vz) || 1;
    // tilt axis is horizontal, perpendicular to the push: tilting by +angle leans along the push
    const ax = vz / sp;
    const az = -vx / sp;
    const d: Debris = {
      id: i,
      x: p.x,
      y: 0,
      z: p.z,
      tilt: 0,
      ax,
      az,
      spin: 0,
      spray: p.kind === 'hydrant' ? 25 : 0,
      vx: spec.pole ? vx * 0.15 : vx * 0.9,
      vy: spec.pole ? 0 : up + sp * 0.15,
      vz: spec.pole ? vz * 0.15 : vz * 0.9,
      tiltV: spec.pole ? 0.6 + sp * 0.08 : sp * 0.6,
      spinV: spec.pole ? 0 : (i % 2 ? 1 : -1) * sp * 0.5,
      resting: false,
    };
    this.broken.set(i, d);
    return true;
  }

  /** Multiplayer replica: take the host's pose for a broken prop. Returns true if it just broke. */
  applyRemote(b: BrokenProp): boolean {
    let d = this.broken.get(b.id);
    const isNew = !d;
    if (!d) {
      this.break(b.id, 0, 0, 0);
      d = this.broken.get(b.id)!;
    }
    Object.assign(d, b);
    d.vx = d.vy = d.vz = d.tiltV = d.spinV = 0;
    d.resting = true; // the host animates it
    return isNew;
  }

  /** Ballistics for moving debris. ground(x, z) gives the floor height. */
  update(ground: (x: number, z: number) => number) {
    for (const d of this.broken.values()) {
      if (d.spray > 0) d.spray = Math.max(0, d.spray - DT);
      if (d.resting) continue;
      const spec = PROP_SPECS[this.defs[d.id].kind];
      if (spec.pole) {
        // falls around its base like a tree being cut
        d.tiltV += 9 * Math.sin(Math.max(0.05, d.tilt)) * DT;
        d.tilt += d.tiltV * DT;
        d.x += d.vx * DT;
        d.z += d.vz * DT;
        d.vx *= 0.95;
        d.vz *= 0.95;
        if (d.tilt >= Math.PI / 2) {
          d.tilt = Math.PI / 2;
          d.resting = true;
        }
        continue;
      }
      d.vy -= 26 * DT;
      d.x += d.vx * DT;
      d.y += d.vy * DT;
      d.z += d.vz * DT;
      d.tilt += d.tiltV * DT;
      d.spin += d.spinV * DT;
      const g = ground(d.x, d.z);
      if (d.y <= g) {
        d.y = g;
        if (Math.abs(d.vy) > 3) {
          d.vy *= -0.3; // bounce
          d.tiltV *= 0.5;
        } else {
          d.vy = 0;
          d.vx *= 0.7;
          d.vz *= 0.7;
          d.tiltV *= 0.7;
          d.spinV *= 0.7;
          // settle lying on a side
          const target = Math.round(d.tilt / (Math.PI / 2)) * (Math.PI / 2);
          d.tilt += (target - d.tilt) * 0.2;
          if (Math.hypot(d.vx, d.vz) < 0.2 && Math.abs(d.tiltV) < 0.3) d.resting = true;
        }
      }
    }
  }

  snapshot(): BrokenProp[] {
    return [...this.broken.values()].map(({ id, x, y, z, tilt, ax, az, spin, spray }) => ({ id, x, y, z, tilt, ax, az, spin, spray }));
  }
}

function key(x: number, z: number) {
  return `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;
}
