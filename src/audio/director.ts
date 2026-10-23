import { WEAPONS } from '../data/weapons';
import type { SimWorld } from '../sim/world';
import type { Sound } from './sound';

interface PedEar {
  hitSeq: number;
  mode: string;
}

/**
 * Turns what happens in the world into sound every frame: engine, tyres, footsteps,
 * helicopter, city ambience, music mood, and pedestrians' cries / sentences (detected
 * from their state, so it works the same for multiplayer guests). Read-only on the sim.
 */
export class AudioDirector {
  private peds = new Map<number, PedEar>();
  private slow = 0;
  private stride = 0;
  private lastVehicle = -1;
  private lastSeq = -1;
  private lastHealth = 100;
  private copLine = 0;

  constructor(
    private sim: SimWorld,
    private sound: Sound,
  ) {}

  update(dt: number, localId: string, camYaw: number) {
    const me = this.sim.players.get(localId)?.state;
    if (!me) return;
    const s = this.sound;
    s.setListener(me.x, me.z, camYaw);
    const v = me.vehicle >= 0 ? this.sim.vehicles.get(me.vehicle) : undefined;
    const vs = v?.state;
    s.setEngine(!!v && !vs!.wrecked, vs?.speed ?? 0, v && v.input.throttle > 0 ? 1 : 0, vs?.type === 'moto');
    // tyres screech when sliding sideways or braking hard
    if (vs && v!.grounded) {
      const fx = -Math.sin(vs.yaw);
      const fz = -Math.cos(vs.yaw);
      const side = Math.abs(vs.vx * fz - vs.vz * fx);
      const brake = v!.input.handbrake && Math.abs(vs.speed) > 6 ? 0.6 : 0;
      s.setScreech(Math.max(brake, (side - 2.5) / 5));
    } else s.setScreech(0);
    // doors
    if (me.vehicle !== this.lastVehicle) {
      if (this.lastVehicle !== -2) s.door();
      this.lastVehicle = me.vehicle;
    }
    // footsteps
    if (!v && me.grounded && me.speed > 1 && !me.dead) {
      this.stride += dt * me.speed;
      const len = me.speed > 7 ? 1.9 : me.speed > 4 ? 1.6 : 1.2;
      if (this.stride > len) {
        this.stride = 0;
        s.footstep(me.speed > 4);
      }
    }
    // own melee swing / getting hurt
    if (me.actionSeq !== this.lastSeq) {
      if (this.lastSeq >= 0 && WEAPONS[me.weapon].melee && me.action !== 'hit' && me.action !== 'interact') s.whoosh();
      this.lastSeq = me.actionSeq;
    }
    if (me.health < this.lastHealth - 4 && !me.dead) s.voices?.cry('effort', me.look > 0 ? me.look : 7, 0.6, 0);
    if (me.dead && this.lastHealth > 0) s.voices?.cry('ko', me.look > 0 ? me.look : 7, 0.7, 0);
    this.lastHealth = me.health;

    this.slow -= dt;
    if (this.slow > 0) return;
    this.slow = 0.05;
    this.scanPeds(me.x, me.z, me.interior);
    // helicopter
    let heli = 0;
    for (const h of this.sim.police.helis.values()) {
      const d = Math.hypot(h.state.x - me.x, h.state.z - me.z);
      heli = Math.max(heli, Math.max(0, 1 - d / 160));
    }
    s.setHeli(me.interior ? heli * 0.2 : heli);
    // ambience: traffic around, park birds
    let traffic = 0;
    for (const o of this.sim.vehicles.values()) if (o.state.driver === 'npc' && Math.abs(o.state.x - me.x) < 60 && Math.abs(o.state.z - me.z) < 60) traffic++;
    const park = this.sim.map.zones.some((z) => z.kind === 'park' && me.x >= z.x0 && me.x <= z.x1 && me.z >= z.z0 && me.z <= z.z1);
    s.setAmbience(traffic, !!me.interior, park);
    s.setMusicMode(!!v, me.wanted >= 2, !!me.interior);
  }

  /** Cries and sentences from pedestrians and cops near the listener. */
  private scanPeds(x: number, z: number, interior: string | null) {
    const voices = this.sound.voices;
    if (!voices) return;
    const seen = new Set<number>();
    for (const ped of this.sim.peds.values()) {
      const ps = ped.state;
      const d = Math.abs(ps.x - x) + Math.abs(ps.z - z);
      if (d > 50) continue;
      seen.add(ps.id);
      const prev = this.peds.get(ps.id);
      if (!prev) {
        this.peds.set(ps.id, { hitSeq: ps.hitSeq, mode: ps.mode });
        continue;
      }
      if (interior && Math.hypot(ps.x - x, ps.z - z) > 30) continue;
      const { vol, pan } = this.sound.voiceAt(ps.x, ps.z, 35);
      const seed = ps.look;
      if (ps.hitSeq !== prev.hitSeq) {
        // got hit
        if (ps.mode === 'ko') {
          voices.cry('ko', seed, vol, pan);
          if (Math.random() < 0.3) voices.line('ko', seed, vol);
        } else {
          voices.cry('hurt', seed, vol, pan);
          if (Math.random() < 0.45) voices.line(ps.role === 'civ' ? (ps.temper === 'fighter' ? 'fight' : 'hurt') : 'cop', seed, vol);
        }
      } else if (ps.mode !== prev.mode) {
        if (ps.mode === 'flee' && (prev.mode === 'walk' || prev.mode === 'idle' || prev.mode === 'wave')) {
          if (Math.random() < 0.35) voices.cry('scream', seed, vol * 0.8, pan);
          else if (Math.random() < 0.4) voices.line('flee', seed, vol);
        } else if (ps.mode === 'fight') voices.line('fight', seed, vol);
        else if (ps.mode === 'cower') voices.cry('scream', seed, vol * 0.6, pan);
        else if (ps.mode === 'wave') voices.line('talk', seed, vol);
      }
      // cops shouting while chasing
      if (ps.role !== 'civ' && ps.mode === 'police' && performance.now() > this.copLine && vol > 0.3) {
        if (voices.line('cop', seed, vol)) this.copLine = performance.now() + 7000;
      }
      prev.hitSeq = ps.hitSeq;
      prev.mode = ps.mode;
    }
    for (const id of this.peds.keys()) if (!seen.has(id)) this.peds.delete(id);
  }
}
