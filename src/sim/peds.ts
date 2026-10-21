import type RAPIER_T from '@dimforge/rapier3d-compat';
import { DT } from '../core/loop';
import type { Rng } from '../core/rng';
import type { WalkNode } from './nav';

export type PedMode = 'walk' | 'idle' | 'flee' | 'cower' | 'ko' | 'shopkeeper' | 'wave';

/** Serializable pedestrian state. */
export interface PedState {
  id: number;
  x: number;
  y: number;
  z: number;
  facing: number;
  speed: number;
  mode: PedMode;
  health: number;
  /** Seed of the procedural look (outfit, hair...). */
  look: number;
  money: number;
  /** Incremented each time the ped gets hit (renderer plays a hit reaction). */
  hitSeq: number;
}

const WALK = 1.45;
const FLEE = 5.6;

export class Ped {
  prev = { x: 0, y: 0, z: 0, facing: 0 };
  /** Node we come from / go to on the sidewalk graph. */
  from = -1;
  to = -1;
  timer = 0;
  threat = { x: 0, z: 0 };
  /** Knock-back velocity (car hits, explosions). */
  kvx = 0;
  kvz = 0;
  ambient = true;
  walkSpeed: number;

  constructor(
    public state: PedState,
    readonly body: RAPIER_T.RigidBody,
    readonly collider: RAPIER_T.Collider,
    rng: Rng,
  ) {
    this.walkSpeed = WALK * rng.range(0.85, 1.15);
    this.savePrev();
  }

  savePrev() {
    this.prev.x = this.state.x;
    this.prev.y = this.state.y;
    this.prev.z = this.state.z;
    this.prev.facing = this.state.facing;
  }

  get alive() {
    return this.state.mode !== 'ko';
  }

  scare(x: number, z: number, cower: boolean) {
    if (!this.alive || !this.ambient) return;
    this.threat.x = x;
    this.threat.z = z;
    if (this.state.mode !== 'flee') {
      this.state.mode = cower ? 'cower' : 'flee';
      this.timer = cower ? 1.8 : 9;
    } else this.timer = 9;
  }

  update(nodes: WalkNode[], rng: Rng) {
    const s = this.state;
    // Knock-back slide
    if (Math.abs(this.kvx) + Math.abs(this.kvz) > 0.05) {
      s.x += this.kvx * DT;
      s.z += this.kvz * DT;
      const d = Math.exp(-4 * DT);
      this.kvx *= d;
      this.kvz *= d;
    }
    switch (s.mode) {
      case 'ko':
        s.speed = 0;
        this.timer += DT;
        break;
      case 'shopkeeper':
      case 'wave':
        s.speed = 0;
        if (s.mode === 'wave') {
          this.timer -= DT;
          if (this.timer <= 0) s.mode = 'walk';
        }
        break;
      case 'idle':
        s.speed = 0;
        this.timer -= DT;
        if (this.timer <= 0) s.mode = 'walk';
        break;
      case 'cower':
        s.speed = 0;
        this.timer -= DT;
        if (this.timer <= 0) {
          // shop clerks go back behind their counter, passers-by run away
          s.mode = this.ambient ? 'flee' : 'shopkeeper';
          this.timer = 9;
        }
        break;
      case 'walk':
      case 'flee': {
        const fleeing = s.mode === 'flee';
        if (fleeing) {
          this.timer -= DT;
          if (this.timer <= 0) s.mode = 'walk';
        }
        if (this.to < 0) break;
        const t = nodes[this.to];
        const dx = t.x - s.x;
        const dz = t.z - s.z;
        const d = Math.hypot(dx, dz);
        const sp = fleeing ? FLEE : this.walkSpeed;
        if (d < 0.6) {
          this.pickNext(nodes, rng, fleeing);
          if (!fleeing && rng.chance(0.08)) {
            s.mode = 'idle';
            this.timer = rng.range(1.5, 4);
          }
          break;
        }
        const step = Math.min(d, sp * DT);
        s.x += (dx / d) * step;
        s.z += (dz / d) * step;
        s.speed = sp;
        const target = Math.atan2(-dx, -dz);
        let df = (target - s.facing) % (Math.PI * 2);
        if (df > Math.PI) df -= Math.PI * 2;
        if (df < -Math.PI) df += Math.PI * 2;
        s.facing += df * (1 - Math.exp(-10 * DT));
        break;
      }
    }
    this.body.setNextKinematicTranslation({ x: s.x, y: s.y, z: s.z });
  }

  pickNext(nodes: WalkNode[], rng: Rng, flee: boolean) {
    const cur = nodes[this.to];
    let options = cur.links.filter((l) => l !== this.from);
    if (options.length === 0) options = cur.links;
    let next = options[Math.floor(rng.next() * options.length)];
    if (flee) {
      // run away from the threat
      let best = -Infinity;
      for (const o of cur.links) {
        const n = nodes[o];
        const score = Math.hypot(n.x - this.threat.x, n.z - this.threat.z);
        if (score > best) {
          best = score;
          next = o;
        }
      }
    }
    this.from = this.to;
    this.to = next;
  }
}
