import type { ActionCommand, ActionKind } from '../core/commands';
import type { Profile } from '../core/save';
import type { NetSession } from '../game';
import type { Player } from '../sim/player';
import { Heli } from '../sim/police';
import type { SimWorld } from '../sim/world';
import { REPORT_EVERY, unpackPed, unpackPickup, vehicleTypeOf, type GuestMessage, type HostMessage, type NetPlayer } from './protocol';
import type { Transport } from './transport';

/**
 * A guest: simulates its own player (and the car it drives) for instant controls,
 * reports its position to the host, sends its actions (punch, shoot, enter car…) and
 * mirrors everything else from the host's snapshots into a replica SimWorld.
 */
export class NetClient implements NetSession {
  private actions: { k: ActionKind; arg?: string }[] = [];
  private seen = new Map<number, number>();
  private seenV = new Map<number, number>();
  private snaps = 0;
  onHostLost?: () => void;
  onPlayersChange?: (count: number) => void;

  constructor(
    private t: Transport,
    private sim: SimWorld,
    readonly localId: string,
    readonly hostId: string,
  ) {
    t.onMessage = (m, from) => {
      if (from !== hostId) return;
      const msg = m as HostMessage;
      if (msg.t === 'snap') this.apply(msg);
    };
    t.onLeave = (peer) => {
      if (peer === hostId) this.onHostLost?.();
    };
  }

  /** Connects to the room's host: resolves with our player id, rejects if nobody answers. */
  static connect(t: Transport, name: string, look: number, profile: Profile, timeoutMs = 25000): Promise<{ id: string; host: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Partie introuvable')), timeoutMs);
      const hello = (peer?: string) => t.send({ t: 'join', name, look, profile } satisfies GuestMessage, peer);
      t.onJoin = (peer) => hello(peer);
      t.onMessage = (m) => {
        const msg = m as HostMessage;
        if (msg.t === 'welcome') {
          clearTimeout(timer);
          resolve({ id: msg.id, host: msg.host });
        } else if (msg.t === 'full') {
          clearTimeout(timer);
          reject(new Error('Partie pleine (10 joueurs max)'));
        }
      };
      hello();
    });
  }

  get snapshotsReceived() {
    return this.snaps;
  }

  beforeStep() {}

  onLocalAction(cmd: ActionCommand): boolean {
    this.actions.push({ k: cmd.action, arg: cmd.arg });
    return true;
  }

  afterStep(tick: number) {
    if (tick % REPORT_EVERY !== 0) return;
    const p = this.sim.players.get(this.localId);
    if (!p) return;
    const s = p.state;
    const v = s.vehicle >= 0 ? this.sim.vehicles.get(s.vehicle) : undefined;
    const msg: GuestMessage = {
      t: 'st',
      x: s.x,
      y: s.y,
      z: s.z,
      vx: s.vx,
      vz: s.vz,
      f: s.facing,
      yaw: p.input?.yaw ?? s.facing,
      anim: s.anim,
      g: s.grounded,
      sp: s.speed,
      tp: s.teleportSeq,
      a: this.actions,
      v: v
        ? {
            id: v.state.id,
            x: v.state.x,
            y: v.state.y,
            z: v.state.z,
            yaw: v.state.yaw,
            pitch: v.state.pitch,
            roll: v.state.roll,
            vx: v.state.vx,
            vz: v.state.vz,
            speed: v.state.speed,
            steer: v.state.steer,
            dmg: v.pendingDamage,
          }
        : undefined,
    };
    if (v) v.pendingDamage = 0;
    this.actions = [];
    this.t.send(msg, this.hostId);
  }

  private apply(m: Extract<HostMessage, { t: 'snap' }>) {
    const sim = this.sim;
    this.snaps++;
    const now = performance.now();

    // --- players
    const ids = new Set(m.P.map((p) => p.id));
    for (const id of [...sim.players.keys()]) if (!ids.has(id) && id !== this.localId) sim.removePlayer(id);
    for (const np of m.P) {
      if (np.id === this.localId) this.applySelf(np);
      else {
        let p = sim.players.get(np.id);
        if (!p) {
          p = sim.addPlayer(np.id, { x: np.x, y: np.y, z: np.z, yaw: np.facing });
          p.remote = true;
          p.collider.setEnabled(false);
        }
        Object.assign(p.net, { x: np.x, y: np.y, z: np.z, facing: np.facing, vx: np.vx, vz: np.vz, has: true });
        copyShared(p, np);
        p.state.anim = np.anim;
        p.state.speed = np.speed;
        p.state.grounded = np.grounded;
        p.state.vehicle = np.vehicle;
      }
    }
    const driverOf = (i: number) => (i === -1 ? 'none' : i === -2 ? 'npc' : (m.P[i]?.id ?? 'none'));

    // --- pedestrians
    for (const a of m.D) {
      const id = a[0];
      let ped = sim.peds.get(id);
      const fresh = !ped;
      if (!ped) ped = sim.spawnPed(a[1], a[3], { id, ambient: true });
      const s = ped.state;
      const cur = { x: s.x, y: s.y, z: s.z, facing: s.facing };
      unpackPed(a, s);
      // unpack wrote the host position into state: keep ours and glide there
      ped.net = { x: a[1], y: a[2], z: a[3], facing: a[4] };
      if (fresh) ped.savePrev();
      else Object.assign(s, cur);
      this.seen.set(id, now);
    }
    for (const [id, t] of this.seen) {
      if (now - t > 1500) {
        sim.removePed(id);
        this.seen.delete(id);
      }
    }

    // --- vehicles
    const mine = sim.players.get(this.localId)?.state.vehicle ?? -1;
    for (const a of m.V) {
      const id = a[0];
      let v = sim.vehicles.get(id);
      if (!v) v = sim.spawnVehicle(vehicleTypeOf(a), a[3], a[4], a[5], a[6], 'none', false, id);
      const s = v.state;
      s.paint = a[2];
      s.health = a[13];
      s.fire = a[15];
      s.wrecked = a[16] === 1;
      s.horn = a[18];
      if (id !== mine) {
        s.driver = driverOf(a[14]);
        s.braking = a[17] === 1;
        v.setNet({ id, x: a[3], y: a[4], z: a[5], yaw: a[6], pitch: a[7], roll: a[8], vx: a[9], vz: a[10], speed: a[11], steer: a[12] });
      }
      this.seenV.set(id, now);
    }
    for (const [id, t] of this.seenV) {
      if (now - t > 1500 && id !== mine) {
        sim.removeVehicle(id);
        this.seenV.delete(id);
      }
    }

    // --- police helicopters
    const helis = new Set<number>();
    for (const [id, x, y, z, yaw, health, down, army] of m.H ?? []) {
      helis.add(id);
      let h = sim.police.helis.get(id);
      if (!h) {
        h = new Heli({ id, x, y, z, yaw, health, down, army: army === 1, rotor: 0 });
        sim.police.helis.set(id, h);
      }
      h.net = { x, y, z, yaw };
      h.state.health = health;
      h.state.down = down;
    }
    for (const id of [...sim.police.helis.keys()]) if (!helis.has(id)) sim.police.helis.delete(id);

    // --- rooftop stashes
    m.C?.forEach((full, i) => {
      const c = sim.roofs.chests[i];
      if (c) c.refill = full ? 0 : Number.MAX_SAFE_INTEGER;
    });

    // --- money on the ground, broken props
    sim.pickups.clear();
    for (const a of m.K) sim.pickups.set(a[0], unpackPickup(a));
    for (const [id, x, y, z, tilt, ax, az, spin, spray] of m.X) sim.applyBrokenProp({ id, x, y, z, tilt, ax, az, spin, spray });

    // --- events (effects, sounds, toasts) from the host
    for (const e of m.E) sim.events.push(e);
  }

  private applySelf(np: NetPlayer) {
    const p = this.sim.players.get(this.localId);
    if (!p) return;
    const s = p.state;
    copyShared(p, np);
    s.ammo = np.ammo;
    s.money = np.money;
    s.armor = np.armor;
    s.interior = np.interior;
    s.robbery = np.robbery;
    s.context = np.context;
    s.lastHit = np.lastHit;
    s.lastHitTick = np.lastHitTick;
    s.wanted = np.wanted;
    s.wantedCooldown = np.wantedCooldown;
    s.wantedSeen = np.wantedSeen;
    s.searchX = np.searchX;
    s.searchZ = np.searchZ;
    s.searchR = np.searchR;
    s.arrest = np.arrest;
    s.weapons = np.weapons;
    s.clothes = np.clothes;
    s.garage = np.garage;
    s.homes = np.homes;
    s.rep = np.rep;
    s.missionsDone = np.missionsDone;
    s.base = np.base ?? s.base;
    s.locker = np.locker ?? s.locker;
    s.mission = np.mission;
    s.missionStep = np.missionStep;
    s.objective = np.objective;
    s.missionTimer = np.missionTimer;
    s.waypoint = np.waypoint;
    s.missionTargets = np.missionTargets ?? [];
    s.ally = np.ally ?? -1;
    s.chaos = np.chaos;
    s.chaosMult = np.chaosMult;
    s.chaosTimer = np.chaosTimer;
    s.contracts = np.contracts;
    s.contractsDay = np.contractsDay;
    s.streak = np.streak;
    s.streakDay = np.streakDay;
    s.fenceOrder = np.fenceOrder;
    s.biz = np.biz;
    s.tutorialDone = np.tutorialDone;
    s.week = np.week;
    s.bank = np.bank;
    s.fines = np.fines;
    s.fine = np.fine;
    s.fineTimer = np.fineTimer;
    s.refused = np.refused;
    s.canSurrender = np.canSurrender;
    s.notoriety = np.notoriety;
    s.respect = np.respect;
    s.skills = np.skills;
    s.carrying = np.carrying;
    s.stash = np.stash;
    s.jetpack = np.jetpack;
    s.resist = np.resist;
    if (np.teleportSeq > s.teleportSeq) {
      // doors, respawn, getting out of a car: the host moved us
      p.teleport(np.x, np.y, np.z, np.facing);
      s.teleportSeq = np.teleportSeq;
    }
    if (np.vehicle !== s.vehicle) {
      const prev = s.vehicle >= 0 ? this.sim.vehicles.get(s.vehicle) : undefined;
      if (prev) prev.state.driver = 'none';
      s.vehicle = np.vehicle;
      p.collider.setEnabled(s.vehicle < 0);
      const v = s.vehicle >= 0 ? this.sim.vehicles.get(s.vehicle) : undefined;
      if (v) {
        v.state.driver = this.localId;
        v.net = null; // we drive it now
        v.grounded = true;
      }
    }
  }
}

/** Fields decided by the host for every player. */
function copyShared(p: Player, np: NetPlayer) {
  const s = p.state;
  s.health = np.health;
  s.dead = np.dead;
  s.weapon = np.weapon;
  s.action = np.action;
  s.actionSeq = np.actionSeq;
  s.name = np.name;
  s.look = np.look;
  s.interior = np.interior;
  s.outfit = np.outfit;
  s.gear = np.gear ?? {};
  s.wanted = np.wanted;
  s.bounty = np.bounty;
  s.bountyTimer = np.bountyTimer;
  s.crew = np.crew;
  s.rep = np.rep;
  s.mission = np.mission;
  s.jetting = np.jetting;
  s.jetpack = np.jetpack;
}
