import { CommandQueue, type MoveCommand } from './core/commands';
import { FixedLoop } from './core/loop';
import type { Controls } from './input/controls';
import type { GameRenderer } from './render/renderer';
import type { SimWorld } from './sim/world';
import type { Hud } from './ui/hud';

export const LOCAL_PLAYER = 'local';

/**
 * Glue between input → commands → sim → render/HUD. In multiplayer the CommandQueue
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
  money = 500;

  constructor(
    readonly sim: SimWorld,
    readonly view: GameRenderer,
    readonly controls: Controls,
    readonly hud: Hud,
    private debug: boolean,
  ) {
    this.loop = new FixedLoop(
      (tick) => this.step(tick),
      (alpha, dt) => this.render(alpha, dt),
    );
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
    if (!p) this.loop.resetClock();
  }

  private step(tick: number) {
    const s = this.controls.state;
    const cmd: MoveCommand = {
      type: 'move',
      playerId: LOCAL_PLAYER,
      tick,
      x: s.moveX,
      y: s.moveY,
      yaw: this.view.cam.yaw,
      sprint: s.sprint,
      jump: this.controls.consumeJump(),
    };
    this.queue.push(cmd);
    this.sim.step(this.queue.drain(tick));
    for (const e of this.sim.drainEvents()) {
      if (e.type === 'respawn' && e.playerId === LOCAL_PLAYER) this.hud.toast('Plouf ! Retour sur la terre ferme');
    }
  }

  private render(alpha: number, dt: number) {
    this.controls.update(dt);
    const d = this.controls.takeCameraDelta();
    if (d.yaw || d.pitch) this.view.cam.rotate(d.yaw, d.pitch);
    this.view.render(LOCAL_PLAYER, alpha, dt, this.controls.state.moveY);

    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      const st = this.view.stats();
      this.hud.setDebug(
        this.debug
          ? `${this.fps.toFixed(0)} FPS · ${st.calls} dc · ${(st.triangles / 1000).toFixed(0)}k tri · x${st.pixelRatio.toFixed(2)} · ${st.quality}`
          : `${this.fps.toFixed(0)} FPS`,
      );
    }
    this.hud.update(dt);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 1 / 20;
      const p = this.sim.players.get(LOCAL_PLAYER)!.state;
      this.hud.minimap.update(p.x, p.z, p.facing, this.view.cam.yaw);
      this.hud.updateZone(p.x, p.z);
      this.hud.setMoney(this.money);
      this.hud.setStars(0);
    }
  }
}
