import { DT } from '../core/loop';
import { AWAKEN_CHARGE, AWAKEN_COOLDOWN, AWAKEN_DAMAGE, BALL, BEAM, STAGES, stageOf, type Stage } from '../data/evolution';
import { levelOf } from '../data/progression';
import { PROP_SPECS } from './props';
import type { Player } from './player';
import type { SimWorld, Target } from './world';

/**
 * The powers your character earns by levelling up (src/data/evolution.ts): the
 * awakening (cinematic charge → shockwave → transformed for a while), energy balls
 * and the beam while awakened. Dash, flight and speed live in the movement code.
 */
export class PowerSystem {
  constructor(private w: SimWorld) {}

  stage(p: Player): Stage {
    return STAGES[stageOf(levelOf(p.state.rep))];
  }

  /** Damage taken multiplier: toughness, and untouchable while transforming. */
  defense(p: Player): number {
    return p.state.awakenCharge > 0 ? 0 : this.stage(p).toughness;
  }

  /** Damage dealt multiplier. */
  attack(p: Player): number {
    return p.state.awaken > 0 ? AWAKEN_DAMAGE : 1;
  }

  /** "Éveil" button: start the transformation. */
  awaken(p: Player) {
    const s = p.state;
    const st = this.stage(p);
    if (!st.awaken) return this.w.toast(p, `⚡ L’Éveil se débloque au niveau ${STAGES.find((x) => x.awaken)!.level}`);
    if (s.dead || s.vehicle >= 0 || s.interior || s.awaken > 0 || s.awakenCharge > 0) return;
    if (s.awakenCooldown > 0) return this.w.toast(p, `⚡ Encore ${Math.ceil(s.awakenCooldown)} s avant de pouvoir t’éveiller`);
    s.awakenCharge = AWAKEN_CHARGE;
    s.action = 'interact';
    s.actionSeq++;
    this.w.events.push({ type: 'awaken', playerId: s.id, x: s.x, y: s.y, z: s.z, phase: 'charge', aura: st.aura });
  }

  update() {
    for (const p of this.w.players.values()) {
      const s = p.state;
      if (s.powerCooldown > 0) s.powerCooldown = Math.max(0, s.powerCooldown - DT);
      if (s.awakenCooldown > 0) s.awakenCooldown = Math.max(0, s.awakenCooldown - DT);
      if (s.dead || s.vehicle >= 0) {
        // knocked out or in a car: the aura goes out
        if (s.awaken > 0 || s.awakenCharge > 0) this.end(p);
        continue;
      }
      if (s.awakenCharge > 0) {
        s.awakenCharge = Math.max(0, s.awakenCharge - DT);
        if (s.awakenCharge === 0) this.boom(p);
      } else if (s.awaken > 0) {
        s.awaken = Math.max(0, s.awaken - DT);
        if (s.awaken === 0) this.end(p, true);
      }
    }
  }

  private end(p: Player, ran = false) {
    const s = p.state;
    const was = ran || s.awaken > 0 || s.awakenCharge > 0;
    s.awaken = 0;
    s.awakenCharge = 0;
    if (!was) return;
    s.awakenCooldown = AWAKEN_COOLDOWN;
    this.w.events.push({ type: 'awaken', playerId: s.id, x: s.x, y: s.y, z: s.z, phase: 'end', aura: this.stage(p).aura });
  }

  /** End of the charge: shockwave, everybody around is blown away, and you are transformed. */
  private boom(p: Player) {
    const s = p.state;
    const st = this.stage(p);
    s.awaken = st.awaken;
    this.w.events.push({ type: 'awaken', playerId: s.id, x: s.x, y: s.y, z: s.z, phase: 'boom', aura: st.aura });
    this.w.events.push({ type: 'explosion', x: s.x, y: s.y + 1, z: s.z });
    for (const ped of this.w.peds.values()) {
      const d = Math.hypot(ped.state.x - s.x, ped.state.z - s.z);
      if (d > 9 || d < 0.1 || ped.invulnerable || ped.guardOf) continue;
      ped.kvx = ((ped.state.x - s.x) / d) * 10;
      ped.kvz = ((ped.state.z - s.z) / d) * 10;
      ped.scare(s.x, s.z, true);
    }
    for (const v of this.w.vehicles.values()) {
      const d = Math.hypot(v.state.x - s.x, v.state.z - s.z);
      if (d > 7 || d < 0.1) continue;
      v.state.vx += ((v.state.x - s.x) / d) * 6;
      v.state.vz += ((v.state.z - s.z) / d) * 6;
    }
    this.w.toast(p, `⚡ ${st.name.toUpperCase()} ! Bouton 🔵 : énergie${st.beam ? ' (maintiens : RAYON)' : ''}${st.flight ? ' · maintiens SAUT pour voler' : ''}`);
  }

  /** Energy attack while awakened: `ball` (tap) or `beam` (hold). */
  power(p: Player, kind: string) {
    const s = p.state;
    const st = this.stage(p);
    if (s.awaken <= 0 || s.dead || s.vehicle >= 0 || s.powerCooldown > 0) return;
    const yaw = p.input?.yaw ?? s.facing;
    if (kind === 'beam' && st.beam) this.beam(p, yaw);
    else this.ball(p, yaw);
  }

  private ball(p: Player, yaw: number) {
    const s = p.state;
    const w = this.w;
    s.powerCooldown = BALL.cooldown;
    const target = w.autoAim(p, yaw, BALL.range, 0.4);
    const dir = target ? Math.atan2(-(target.x - s.x), -(target.z - s.z)) : yaw;
    s.facing = dir;
    s.action = 'shoot';
    s.actionSeq++;
    const fx = -Math.sin(dir);
    const fz = -Math.cos(dir);
    const fy = s.y + 1.3;
    let dist = target ? Math.hypot(target.x - s.x, target.z - s.z) : BALL.range;
    dist = Math.min(dist, w.castStatic(s.x, fy, s.z, fx, 0, fz, dist));
    const ix = s.x + fx * dist;
    const iz = s.z + fz * dist;
    const iy = target ? target.y : fy;
    w.events.push({ type: 'energy', playerId: s.id, kind: 'ball', fx: s.x + fx * 0.6, fy, fz: s.z + fz * 0.6, tx: ix, ty: iy, tz: iz, aura: this.stage(p).aura });
    this.blast(p, ix, iz, BALL.radius, BALL.damage);
    w.crime(p, 'gunshot', s.x, s.z, null);
  }

  private beam(p: Player, yaw: number) {
    const s = p.state;
    const w = this.w;
    s.powerCooldown = BEAM.cooldown;
    const target = w.autoAim(p, yaw, BEAM.range, 0.3);
    const dir = target ? Math.atan2(-(target.x - s.x), -(target.z - s.z)) : yaw;
    s.facing = dir;
    s.action = 'shoot2';
    s.actionSeq++;
    const fx = -Math.sin(dir);
    const fz = -Math.cos(dir);
    const fy = s.y + 1.3;
    const len = w.castStatic(s.x, fy, s.z, fx, 0, fz, BEAM.range);
    w.events.push({ type: 'energy', playerId: s.id, kind: 'beam', fx: s.x + fx * 0.6, fy, fz: s.z + fz * 0.6, tx: s.x + fx * len, ty: fy, tz: s.z + fz * len, aura: this.stage(p).aura });
    // everything along the beam
    for (const t of w.targets(p, true)) {
      const dx = t.x - s.x;
      const dz = t.z - s.z;
      const along = dx * fx + dz * fz;
      if (along < 0.5 || along > len + 1) continue;
      if (Math.abs(dx * fz - dz * fx) > BEAM.width + (t.vehicle ? 1 : 0)) continue;
      this.hit(p, t, t.vehicle ? BEAM.damage * 2 : BEAM.damage, fx, fz);
    }
    for (let k = 4; k < len; k += 6) this.props(p, s.x + fx * k, s.z + fz * k, 3);
    this.blast(p, s.x + fx * len, s.z + fz * len, 3, BEAM.damage * 0.5);
    w.crime(p, 'gunshot', s.x, s.z, null);
  }

  /** Area damage around an impact (falls off with distance), knocks people away. */
  private blast(p: Player, x: number, z: number, radius: number, damage: number) {
    for (const t of this.w.targets(p, true)) {
      const d = Math.hypot(t.x - x, t.z - z);
      if (d > radius + (t.vehicle ? 1 : 0)) continue;
      const k = 1 - Math.min(1, d / (radius + 1)) * 0.6;
      this.hit(p, t, (t.vehicle ? damage * 1.6 : damage) * k, (t.x - x) / Math.max(d, 0.1), (t.z - z) / Math.max(d, 0.1));
    }
    this.props(p, x, z, radius);
    this.w.events.push({ type: 'explosion', x, y: this.w.groundY(x, z) + 0.5, z });
  }

  private hit(p: Player, t: Target, damage: number, kx: number, kz: number) {
    if (t.ped) {
      t.ped.kvx = kx * 9;
      t.ped.kvz = kz * 9;
    }
    // hitTarget applies the awakened bonus and the crimes
    this.w.hitTarget(p, t, damage, false);
  }

  private props(p: Player, x: number, z: number, radius: number) {
    const w = this.w;
    for (const i of w.props.near(x, z, radius, [])) {
      const d = w.map.props[i];
      if (!PROP_SPECS[d.kind].fragile) continue;
      const dd = Math.hypot(d.x - x, d.z - z) || 1;
      w.breakProp(i, ((d.x - x) / dd) * 8, ((d.z - z) / dd) * 8, 4, p);
    }
  }
}
