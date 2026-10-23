import { Vector3 } from 'three';
import type { Sound } from './audio/sound';
import { AudioDirector } from './audio/director';
import { CommandQueue, type ActionCommand, type MoveCommand } from './core/commands';
import { FixedLoop } from './core/loop';
import type { Controls } from './input/controls';
import type { GameRenderer } from './render/renderer';
import type { SimWorld } from './sim/world';
import type { Hud } from './ui/hud';
import { MenuPanel, type MenuKind } from './ui/menus';
import { missionById } from './data/missions';
import { HEIST } from './data/social';
import { levelProgress, nextUnlock } from './data/progression';

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
  private audio: AudioDirector;
  private radioCar = -1;
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
    this.audio = new AudioDirector(sim, sound);
    hud.onSkill = (id) => this.sendAction('skill', id);
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
      if (a === 'use' && ctx && (ctx.kind === 'shop' || ctx.kind === 'wardrobe' || ctx.kind === 'garage' || ctx.kind === 'business' || ctx.kind === 'bank')) {
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
          if (e.w !== 'pellet') this.sound.shot(e.fx, e.fz, e.w);
          break;
        case 'punch':
          this.sound.hit(e.x, e.z);
          break;
        case 'explosion':
          this.sound.explosion(e.x, e.z);
          if (d < 35) {
            this.view.cam.shake(0.75 * (1 - d / 35));
            this.vibrate(60);
          }
          break;
        case 'break':
          this.sound.breakProp(e.kind, e.x, e.z);
          break;
        case 'impact':
          if (d < 60) this.sound.impact(e.strength, e.x, e.z);
          break;
        case 'horn':
          if (e.vehicle === me.vehicle) this.sound.horn();
          else {
            const hv = this.sim.vehicles.get(e.vehicle);
            if (hv) this.sound.hornAt(hv.state.x, hv.state.z);
          }
          break;
        case 'money':
          if (e.playerId === this.localId) {
            this.sound.cash();
            this.hud.toast(`+${e.amount.toLocaleString('fr-FR')} €`, 1.2);
            this.onSave?.();
          }
          break;
        case 'dmg':
          if (e.playerId === this.localId) {
            this.onHit(e.x, e.y, e.z, e.amount, e.ko);
            if (e.ko) this.session.kos++;
          }
          break;
        case 'chaos':
          if (e.playerId === this.localId) {
            this.hud.popup(innerWidth - 90, innerHeight * 0.36, `${e.label} +${e.points}`, 'stunt');
            this.sound.combo(this.player.chaosMult);
          }
          break;
        case 'chaosEnd':
          if (e.playerId === this.localId) {
            this.session.best = Math.max(this.session.best, e.score);
            this.hud.chaosCashed(e.score, e.cash);
            if (e.cash > 0) this.sound.cash();
          }
          break;
        case 'levelup':
          if (e.playerId === this.localId) {
            this.hud.levelUp(e.level, e.unlocks);
            this.sound.fanfare();
            this.vibrate([40, 60, 80]);
            this.onSave?.();
          }
          break;
        case 'contract':
          if (e.playerId === this.localId) {
            if (!e.all) this.session.contracts++;
            if (e.all) this.sound.fanfare();
            else this.sound.cash();
            this.onSave?.();
          }
          break;
        case 'crate':
          if (e.playerId === this.localId) {
            if (!e.pickup) this.session.crates++;
            this.hud.toast(e.pickup ? e.text : `📦 Colis surprise : ${e.text}`, e.rare ? 3.5 : 2);
            if (e.rare) {
              this.sound.fanfare();
              this.vibrate([30, 40, 60]);
            } else this.sound.cash();
            this.onSave?.();
          }
          break;
        case 'streak':
          if (e.playerId === this.localId) this.sound.cash();
          break;
        case 'say':
          if (e.playerId === this.localId) {
            this.hud.toast(`${e.name} : « ${e.text} »`, Math.max(4, e.text.length / 14));
            this.sound.voices?.say(e.text, e.seed);
          }
          break;
        case 'freeRoam':
          if (e.playerId === this.localId) {
            this.hud.banner('PROLOGUE TERMINÉ', 'LA VILLE EST À TOI', 'Missions « ! » · contrats 📋 · receleur € · colis 📦 · ou fais ce que tu veux', 6);
            this.sound.fanfare();
          }
          break;
        case 'bounty':
          this.sound.alert();
          break;
        case 'mission':
          if (e.playerId === this.localId) {
            if (e.state === 'done') this.sound.cash();
            else if (e.state === 'fail') this.sound.alert();
            this.onSave?.();
          } else if (e.state === 'start') {
            if (e.name === HEIST.name) break;
            const who = this.sim.players.get(e.playerId)?.state.name ?? 'Un joueur';
            this.hud.toast(`🎯 ${who} lance la mission « ${e.name} » : aide ou sabote !`);
          }
          break;
        case 'jail':
          if (e.playerId === this.localId) {
            this.hud.jail(e.seized, e.lost);
            this.sound.door();
            this.onSave?.();
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
          if (e.level > this.lastWanted) {
            this.sound.radioChirp();
            // a cop on the megaphone
            if (e.level >= 1) this.sound.voices?.line('cop', 4242 + e.level, 0.9, true);
          }
          this.lastWanted = e.level;
          break;
      }
    }
  }

  private tmp = new Vector3();
  private slowmo = 0;
  /** Sends an action from a menu (pause screen, panels) with the next tick. */
  sendAction(action: ActionCommand['action'], arg: string) {
    this.menuActions.push({ action, arg });
    // solo pause: run one tick so the answer comes right away
    if (this.paused) {
      this.step(this.loop.tick);
      this.loop.tick++;
    }
  }

  /** This session's stats, for the recap in the pause menu. */
  private session = { money: -1, xp: 0, level: 1, kos: 0, contracts: 0, crates: 0, best: 0, start: performance.now() };

  /** "This session" summary + the next goal (shown when pausing). */
  recapHtml(): string {
    const s = this.player;
    const ss = this.session;
    const lp = levelProgress(s.rep);
    const earned = s.money - ss.money;
    const min = Math.max(1, Math.round((performance.now() - ss.start) / 60000));
    const lines = [
      `Cette session (${min} min) : <b>${earned >= 0 ? '+' : ''}${earned.toLocaleString('fr-FR')} €</b> · <b>+${(s.rep - ss.xp).toLocaleString('fr-FR')} XP</b>`,
      `Niveau <b>${ss.level} → ${lp.level}</b> · ${ss.kos} K.O. · meilleur combo <b>${ss.best.toLocaleString('fr-FR')}</b>`,
      `Contrats réussis : <b>${ss.contracts}</b> · colis trouvés : <b>${ss.crates}</b>`,
    ];
    const left = lp.need - lp.cur;
    const next = nextUnlock(lp.level);
    lines.push(`<span class="goal">Plus que ${left} XP pour le niveau ${lp.level + 1}${next && next.level === lp.level + 1 ? ` (${next.label})` : ''}</span>`);
    const todo = s.contracts.filter((c) => c.progress < c.goal).length;
    if (todo) lines.push(`<span class="goal">📋 ${todo} contrat${todo > 1 ? 's' : ''} du jour à finir</span>`);
    return lines.join('<br>');
  }
  private lastHealth = 100;

  private vibrate(pattern: number | number[]) {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* not supported */
    }
  }

  /** Juice when the local player lands a hit: number, shake, buzz, hit-stop / slow-mo. */
  private onHit(x: number, y: number, z: number, amount: number, ko: boolean) {
    const v = this.tmp.set(x, y, z).project(this.view.cam.camera);
    if (v.z < 1) this.hud.popup(((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight, ko ? `K.O. ${amount}` : String(amount), ko ? 'dmg ko' : 'dmg');
    this.view.cam.shake(ko ? 0.42 : 0.18);
    this.vibrate(ko ? 45 : 15);
    if (ko) this.sound.knockout();
    // time effects only in solo: in multiplayer the world can't slow down for one player
    if (!this.net) {
      this.loop.timeScale = ko ? 0.3 : 0.06;
      this.slowmo = ko ? 0.32 : 0.06;
    }
  }

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
    const tags: { id: string; name: string; sub?: string; color?: number; hunted?: boolean; x: number; y: number }[] = [];
    for (const p of this.sim.players.values()) {
      const s = p.state;
      if (s.id === this.localId || s.interior !== me.interior || Math.hypot(s.x - me.x, s.z - me.z) > 70) continue;
      const v = this.tmp.set(s.x, s.y + 2.3, s.z).project(this.view.cam.camera);
      if (v.z > 1) continue;
      const job = s.mission === HEIST.id ? HEIST.name : s.mission ? missionById(s.mission)?.name : undefined;
      const sub = s.bounty > 0 ? `🎯 PRIME ${s.bounty.toLocaleString('fr-FR')} €` : job ? `📍 ${job}` : undefined;
      const lvl = levelProgress(s.rep).level;
      tags.push({ id: s.id, name: `${s.crew ? `[${s.crew.name}] ` : ''}${s.name} · ${lvl}`, sub, color: s.crew?.color, hunted: s.bounty > 0, x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight });
    }
    this.hud.setNameTags(tags);
  }

  /** Police sirens around: loudness from the closest unit chasing someone. */
  private updateSiren(me: { x: number; z: number; interior: string | null }) {
    let d = Infinity;
    if (!me.interior) {
      for (const v of this.sim.vehicles.values()) if (v.state.siren) d = Math.min(d, Math.hypot(v.state.x - me.x, v.state.z - me.z));
    }
    this.sound.setSiren(d < 150 ? 1 - d / 150 : 0);
  }

  private render(alpha: number, dt: number) {
    if (this.slowmo > 0) {
      // measured in real time (dt is already slowed down)
      this.slowmo -= dt / Math.max(0.05, this.loop.timeScale);
      if (this.slowmo <= 0) this.loop.timeScale = 1;
    }
    this.controls.update(dt);
    const d = this.controls.takeCameraDelta();
    if (d.yaw || d.pitch) this.view.cam.rotate(d.yaw, d.pitch);
    this.view.render(this.localId, alpha, dt, this.controls.state.moveY);
    const me = this.player;
    this.audio.update(dt, this.localId, this.view.cam.yaw);
    if (me.vehicle >= 0 && this.radioCar !== me.vehicle && this.sound.musicOn && this.sound.station) this.hud.toast(`📻 ${this.sound.station}`, 1.6);
    this.radioCar = me.vehicle;

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
    if (this.session.money < 0) {
      this.session.money = me.money;
      this.session.xp = me.rep;
      this.session.level = levelProgress(me.rep).level;
    }
    this.hud.updatePlayer(me);
    this.hud.updateProgress(me);
    if (me.health < this.lastHealth - 1) {
      this.view.cam.shake(Math.min(0.5, (this.lastHealth - me.health) / 40));
      this.vibrate(25);
    }
    this.lastHealth = me.health;
    this.menu.update(me);
    this.updateTargetBar(me.lastHit, me.lastHitTick);
    if (this.sim.players.size > 1) this.updateNameTags(me);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 1 / 20;
      this.hud.minimap.update(me.x, me.z, me.facing, this.view.cam.yaw, this.sim, me);
      this.hud.updateZone(me.x, me.z, me.interior);
      this.hud.setMoney(me.money, me.bank);
      this.hud.setStars(me.wanted, me.wanted > 0 && !me.wantedSeen);
      this.hud.setBounty(me.bounty, me.bountyTimer);
      if (this.sim.players.size > 1) this.hud.others = [...this.sim.players.values()].filter((p) => p.state.id !== this.localId).map((p) => p.state);
      else if (this.hud.others.length) this.hud.others = [];
      this.updateSiren(me);
    }
  }
}
