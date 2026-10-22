import { Vector3 } from 'three';
import type { Sound } from './audio/sound';
import { CommandQueue, type ActionCommand, type MoveCommand } from './core/commands';
import { FixedLoop } from './core/loop';
import type { Controls } from './input/controls';
import type { GameRenderer } from './render/renderer';
import type { SimWorld } from './sim/world';
import type { Hud } from './ui/hud';
import { MenuPanel, type MenuKind } from './ui/menus';
import { missionById } from './data/missions';

export const LOCAL_PLAYER = 'local';

/** Multiplayer hook (host or guest), see src/net/. */
export interface NetSession {
  /** Before the sim tick: the host injects guests' actions into the queue. */
  beforeStep(tick: number, queue: CommandQueue): void;
  /** A local action: a guest sends it to the host instead of running it locally (returns true). */
  onLocalAction(cmd: ActionCommand): boolean;
  /** After the sim tick: snapshots (host) or position reports (guest). */
  afterStep(tick: number): void;
}

/**
 * Glue between input → commands → sim → render/HUD/sound. In multiplayer the session
 * forwards commands and snapshots between the host and the guests.
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
  net: NetSession | null = null;
  readonly menu: MenuPanel;
  /** Commands from menus (shop, wardrobe, garage), sent with the next tick. */
  private menuActions: { action: ActionCommand['action']; arg: string }[] = [];

  constructor(
    readonly sim: SimWorld,
    readonly view: GameRenderer,
    readonly controls: Controls,
    readonly hud: Hud,
    readonly sound: Sound,
    private debug: boolean,
    readonly localId: string = LOCAL_PLAYER,
  ) {
    this.menu = new MenuPanel(
      (action, arg) => this.menuActions.push({ action, arg }),
      () => {},
    );
    hud.onAbort = () => this.menuActions.push({ action: 'mission', arg: 'abort' });
    this.loop = new FixedLoop(
      (tick) => this.step(tick),
      (alpha, dt) => this.render(alpha, dt),
    );
  }

  get player() {
    return this.sim.players.get(this.localId)!.state;
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
    // in multiplayer the world keeps running behind the menu
    this.paused = p && !this.net;
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
      playerId: this.localId,
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
    const actions: ActionCommand[] = [];
    for (const a of this.controls.takeActions()) {
      // contextual "use" on a counter / wardrobe / garage opens a menu instead
      const ctx = this.player.context;
      if (a === 'use' && ctx && (ctx.kind === 'shop' || ctx.kind === 'wardrobe' || ctx.kind === 'garage')) {
        this.menu.open(ctx.kind === 'shop' ? (ctx.target as MenuKind) : ctx.kind);
        continue;
      }
      actions.push({ type: 'action', playerId: this.localId, tick, action: a });
    }
    for (const m of this.menuActions) actions.push({ type: 'action', playerId: this.localId, tick, action: m.action, arg: m.arg });
    this.menuActions = [];
    // Holding the trigger keeps attacking (the sim enforces the weapon's rate of fire)
    if ((h.attack || k.attack) && this.player.vehicle < 0 && tick % 4 === 0) actions.push({ type: 'action', playerId: this.localId, tick, action: 'attack' });
    for (const a of actions) if (!this.net?.onLocalAction(a)) this.queue.push(a);
    this.net?.beforeStep(tick, this.queue);
    this.sim.step(this.queue.drain(tick));
    this.net?.afterStep(tick);
    const me = this.player;
    for (const e of this.sim.drainEvents()) {
      this.view.handleEvent(e);
      const d = 'x' in e ? Math.hypot((e as { x: number }).x - me.x, (e as { z: number }).z - me.z) : 0;
      switch (e.type) {
        case 'toast':
          if (e.playerId === this.localId) this.hud.toast(e.text);
          break;
        case 'respawn':
          if (e.playerId === this.localId) {
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
          if (e.playerId === this.localId) {
            this.sound.cash();
            this.hud.toast(`+${e.amount.toLocaleString('fr-FR')} €`, 1.2);
            this.onSave?.();
          }
          break;
        case 'mission':
          if (e.playerId === this.localId) {
            if (e.state === 'done') this.sound.cash();
            else if (e.state === 'fail') this.sound.alert();
            this.onSave?.();
          } else if (e.state === 'start') {
            const who = this.sim.players.get(e.playerId)?.state.name ?? 'Un joueur';
            this.hud.toast(`🎯 ${who} lance la mission « ${e.name} » : aide ou sabote !`);
          }
          break;
        case 'busted':
          if (e.playerId === this.localId) this.sound.alert();
          break;
        case 'joined':
          this.hud.toast(`${e.name} a rejoint la partie`);
          break;
        case 'left':
          this.hud.toast(`${e.name} a quitté la partie`);
          break;
        case 'wanted':
          if (e.playerId !== this.localId) break;
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

  private updateNameTags(me: { x: number; z: number; interior: string | null }) {
    const tags: { id: string; name: string; sub?: string; x: number; y: number }[] = [];
    for (const p of this.sim.players.values()) {
      const s = p.state;
      if (s.id === this.localId || s.interior !== me.interior || Math.hypot(s.x - me.x, s.z - me.z) > 70) continue;
      const v = this.tmp.set(s.x, s.y + 2.3, s.z).project(this.view.cam.camera);
      if (v.z > 1) continue;
      const job = s.mission ? missionById(s.mission) : undefined;
      tags.push({ id: s.id, name: s.name, sub: job ? `🎯 ${job.name}` : undefined, x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight });
    }
    this.hud.setNameTags(tags);
  }

  /** Police sirens around: loudness from the closest unit chasing someone. */
  private updateSiren(me: { x: number; z: number; interior: string | null }) {
    let d = Infinity;
    if (!me.interior) {
      for (const v of this.sim.vehicles.values()) if (v.state.siren) d = Math.min(d, Math.hypot(v.state.x - me.x, v.state.z - me.z));
      for (const h of this.sim.police.helis.values()) if (h.state.down < 0) d = Math.min(d, Math.hypot(h.state.x - me.x, h.state.z - me.z) + 20);
    }
    this.sound.setSiren(d < 150 ? 1 - d / 150 : 0);
  }

  private render(alpha: number, dt: number) {
    this.controls.update(dt);
    const d = this.controls.takeCameraDelta();
    if (d.yaw || d.pitch) this.view.cam.rotate(d.yaw, d.pitch);
    this.view.render(this.localId, alpha, dt, this.controls.state.moveY);
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
    this.menu.update(me);
    this.updateTargetBar(me.lastHit, me.lastHitTick);
    if (this.sim.players.size > 1) this.updateNameTags(me);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 1 / 20;
      this.hud.minimap.update(me.x, me.z, me.facing, this.view.cam.yaw, this.sim, me);
      this.hud.updateZone(me.x, me.z, me.interior);
      this.hud.setMoney(me.money);
      this.hud.setStars(me.wanted, me.wanted > 0 && !me.wantedSeen);
      this.updateSiren(me);
    }
  }
}
