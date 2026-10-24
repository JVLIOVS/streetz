import type { ActionKind } from '../core/commands';
import type { PlayerReport } from '../sim/world';

/**
 * Everything a guest sends is untrusted: a modified client can send any JSON. The host
 * checks shapes and bounds here before anything reaches the simulation, so a bad
 * message is dropped instead of crashing (NaN in physics) or corrupting the game.
 */

export const ACTIONS: readonly ActionKind[] = ['attack', 'use', 'weapon', 'horn', 'buy', 'wear', 'garage_out', 'mission', 'collect', 'crew', 'heist', 'fine', 'bank', 'skill', 'surrender', 'guards', 'build', 'locker', 'upgrade'];
const ACTION_SET = new Set<string>(ACTIONS);
const ANIMS = new Set(['idle', 'walk', 'run', 'sprint', 'jump', 'fall', 'drive', 'ko']);
/** Actions accepted per report (a report is sent every 3 ticks: a few taps at most). */
export const MAX_ACTIONS_PER_REPORT = 6;
/** Reports a peer may send per second before being ignored (normal: 20). */
export const MAX_MESSAGES_PER_SECOND = 45;
/** The playable world plus the interior rooms (laid out beyond x = 1000). */
const BOUND_MIN = -620;
const BOUND_MAX = 2600;
const MAX_SPEED = 120;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inWorld = (v: unknown) => finite(v) && v >= BOUND_MIN && v <= BOUND_MAX;
const inRange = (v: unknown, lo: number, hi: number) => finite(v) && v >= lo && v <= hi;

export function cleanName(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  // printable text only (no control / bidi-override characters), 14 chars max
  const t = s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩<>]/g, '').trim().slice(0, 14);
  return t || 'Joueur';
}

export function cleanLook(v: unknown): number {
  return finite(v) ? Math.abs(Math.floor(v)) % 1e9 : 0;
}

/** A position report: numbers must be finite and inside the world. */
export function validReport(r: unknown): r is PlayerReport {
  if (!r || typeof r !== 'object') return false;
  const m = r as Record<string, unknown>;
  if (!inWorld(m.x) || !inRange(m.y, -50, 400) || !inWorld(m.z)) return false;
  if (!inRange(m.vx, -MAX_SPEED, MAX_SPEED) || !inRange(m.vz, -MAX_SPEED, MAX_SPEED) || !inRange(m.sp, -MAX_SPEED, MAX_SPEED)) return false;
  if (!finite(m.f) || !finite(m.yaw) || !finite(m.tp) || typeof m.g !== 'boolean' || !ANIMS.has(m.anim as string)) return false;
  if (m.v !== undefined) {
    const v = m.v as Record<string, unknown>;
    if (!v || typeof v !== 'object' || !finite(v.id) || !inWorld(v.x) || !inRange(v.y, -50, 400) || !inWorld(v.z)) return false;
    for (const k of ['yaw', 'pitch', 'roll', 'steer'] as const) if (!finite(v[k])) return false;
    for (const k of ['vx', 'vz', 'speed'] as const) if (!inRange(v[k], -MAX_SPEED, MAX_SPEED)) return false;
    // damage is reported, never healing
    if (!inRange(v.dmg, 0, 500)) return false;
  }
  return true;
}

/** Known actions with a short string argument, a handful per report. */
export function cleanActions(a: unknown): { k: ActionKind; arg?: string }[] {
  if (!Array.isArray(a)) return [];
  const out: { k: ActionKind; arg?: string }[] = [];
  for (const x of a.slice(0, MAX_ACTIONS_PER_REPORT)) {
    if (!x || typeof x !== 'object' || !ACTION_SET.has((x as { k: unknown }).k as string)) continue;
    const arg = (x as { arg?: unknown }).arg;
    out.push({ k: (x as { k: ActionKind }).k, arg: typeof arg === 'string' ? arg.slice(0, 48) : undefined });
  }
  return out;
}

/** Sliding one-second window per peer. */
export class RateLimiter {
  private hits = new Map<string, { t: number; n: number }>();
  constructor(private max = MAX_MESSAGES_PER_SECOND) {}

  allow(peer: string, now: number): boolean {
    const h = this.hits.get(peer);
    if (!h || now - h.t >= 1000) {
      this.hits.set(peer, { t: now, n: 1 });
      return true;
    }
    return ++h.n <= this.max;
  }

  forget(peer: string) {
    this.hits.delete(peer);
  }
}
