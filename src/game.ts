import { Vector3 } from 'three';
import type { Sound } from './audio/sound';
import { CommandQueue, type MoveCommand } from './core/commands';
import { FixedLoop } from './core/loop';
import type { Controls } from './input/controls';
import type { GameRenderer } from './render/renderer';
import type { SimWorld } from './sim/world';
import type { Hud } from './ui/hud';

export const LOCAL_PLAYER = 'local';

/**
 * Glue between input → commands → sim → render/HUD/sound. In multiplayer the CommandQueue
 * would also be sent to the server and the sim would reconcile with its snapshots.
 */
export class Game {
  readonly queue = new CommandQueue();
  readonly loop: FixedLoop;
  paused = false;
  fps = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private hudTimer = 0;
  private raf = 0;
  private lastWanted = 0;
  onSave?: () => void;

  constructor(
    readonly sim: SimWorld,
    readonly view: GameRenderer,
    readonly controls: Controls,
    readonly hud: Hud,
    readonly sound: Sound,
    private debug: boolean,
  ) {
    this.loop = new FixedLoop(
      (tick) => this.step(tick),
      (alpha, dt) => this.render(alpha, dt),
    );
  }

  get player() {
    return this.sim.players.get(LOCAL_PLAYER)!.state;
  }

  start() {
    const frame = (t: number) => {
      this.raf = requestAnimationFrame(frame);
      if (this.paused) return;
      this.loop.frame(t);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (p) this.sound.setEngine(false, 0, 0);
    if (!p) this.loop.resetClock();
  }

  private step(tick: number) {
    const s = this.controls.state;
    const h = this.controls.held;
    const k = this.controls.keyHeld();
    const gas = h.gas || k.gas;
    const brake = h.brake || k.brake;
    const cmd: MoveCommand = {
      type: 'move',
      playerId: LOCAL_PLAYER,
      tick,
      x: s.moveX,
      y: s.moveY,
      yaw: this.view.cam.yaw,
      sprint: s.sprint,
      jump: this.controls.consumeJump(),
      throttle: gas ? 1 : brake ? -1 : 0,
      handbrake: h.handbrake || k.handbrake,
    };
    this.queue.push(cmd);
    for (const a of this.controls.takeActions()) this.queue.push({ type: 'action', playerId: LOCAL_PLAYER, tick, action: a });
    // Holding the trigger keeps attacking (the sim enforces the weapon's rate of fire)
    if ((h.attack || k.attack) && this.player.vehicle < 0) this.queue.push({ type: 'action', playerId: LOCAL_PLAYER, tick, action: 'attack' });
    this.sim.step(this.queue.drain(tick));
    const me = this.player;
    for (const e of this.sim.drainEvents()) {
      this.view.handleEvent(e);
      const d = 'x' in e ? Math.hypot((e as { x: number }).x - me.x, (e as { z: number }).z - me.z) : 0;
      switch (e.type) {
        case 'toast':
          if (e.playerId === LOCAL_PLAYER) this.hud.toast(e.text);
          break;
        case 'respawn':
          if (e.playerId === LOCAL_PLAYER) {
            if (e.reason === 'drowned') this.hud.toast('Plouf ! Retour sur la terre ferme');
            this.onSave?.();
          }
          break;
        case 'shot':
          this.sound.gunshot(Math.hypot(e.fx - me.x, e.fz - me.z));
          break;
        case 'punch':
          this.sound.punch();
          break;
        case 'explosion':
          this.sound.explosion(d);
          break;
        case 'break':
          if (d < 40) this.sound.impact(e.kind === 'streetlight' || e.kind === 'trafficlight' || e.kind === 'dumpster' ? 14 : 7);
          break;
        case 'impact':
          if (d < 20) this.sound.impact(e.strength);
          break;
        case 'horn':
          if (e.vehicle === me.vehicle) this.sound.horn();
          break;
        case 'money':
          if (e.playerId === LOCAL_PLAYER) {
            this.sound.cash();
            this.hud.toast(`+${e.amount.toLocaleString('fr-FR')} €`, 1.2);
            this.onSave?.();
          }
          break;
        case 'wanted':
          if (e.level > this.lastWanted) this.sound.alert();
          this.lastWanted = e.level;
          break;
      }
    }
  }

  private tmp = new Vector3();

  /** Shows the health of the last pedestrian you hit, above their head, for a few seconds. */
  private updateTargetBar(id: number, tick: number) {
    const ped = this.sim.peds.get(id);
    if (!ped || tick < 0 || this.sim.tick - tick > 60 * 5) {
      this.hud.setTargetBar(null);
      return;
    }
    const s = ped.state;
    const v = this.tmp.set(s.x, s.y + 1.95, s.z).project(this.view.cam.camera);
    if (v.z > 1) {
      this.hud.setTargetBar(null);
      return;
    }
    this.hud.setTargetBar({ x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, ratio: s.health / s.maxHealth });
  }

  private render(alpha: number, dt: number) {
    this.controls.update(dt);
    const d = this.controls.takeCameraDelta();
    if (d.yaw || d.pitch) this.view.cam.rotate(d.yaw, d.pitch);
    this.view.render(LOCAL_PLAYER, alpha, dt, this.controls.state.moveY);
    const me = this.player;
    const v = me.vehicle >= 0 ? this.sim.vehicles.get(me.vehicle) : undefined;
    this.sound.setEngine(!!v && !v.state.wrecked, v?.state.speed ?? 0, v && v.input.throttle > 0 ? 1 : 0);

    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      const st = this.view.stats();
      this.hud.setDebug(
        this.debug
          ? `${this.fps.toFixed(0)} FPS · ${st.calls} dc · ${(st.triangles / 1000).toFixed(0)}k tri · x${st.pixelRatio.toFixed(2)} · ${st.quality} · ${this.sim.peds.size}p ${this.sim.vehicles.size}v`
          : `${this.fps.toFixed(0)} FPS`,
      );
    }
    this.hud.update(dt);
    this.hud.updatePlayer(me);
    this.updateTargetBar(me.lastHit, me.lastHitTick);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 1 / 20;
      this.hud.minimap.update(me.x, me.z, me.facing, this.view.cam.yaw, this.sim);
      this.hud.updateZone(me.x, me.z, me.interior);
      this.hud.setMoney(me.money);
      const w = this.sim.wanted;
      this.hud.setStars(w.level, w.level > 0 && w.cooldown < 8);
    }
  }
}
