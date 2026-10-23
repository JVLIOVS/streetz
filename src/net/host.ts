import type { ActionCommand, CommandQueue } from '../core/commands';
import type { NetSession } from '../game';
import { sanitize } from '../core/save';
import { applyProfile } from '../sim/player';
import type { SimEvent, SimWorld } from '../sim/world';
import { AOI, MAX_PLAYERS, packHeli, packPed, packPickup, packPlayer, packProp, packVehicle, SNAPSHOT_EVERY, type GuestMessage, type HostMessage } from './protocol';
import type { Transport } from './transport';

interface Guest {
  peer: string;
  name: string;
  /** Broken props already sent to this guest once they came to rest. */
  sentProps: Set<number>;
}

/**
 * The host runs the authoritative simulation (pedestrians, traffic, fights, money…)
 * and streams snapshots to every guest. Guests own their position (smooth controls);
 * everything else is decided here.
 */
export class NetHost implements NetSession {
  private guests = new Map<string, Guest>();
  private pending: ActionCommand[] = [];
  private events: SimEvent[] = [];
  onPlayersChange?: (count: number) => void;
  /** Public rooms: another host was elected at the same time and wins. */
  onYield?: () => void;

  constructor(
    private t: Transport,
    private sim: SimWorld,
    readonly code: string,
  ) {
    t.onMessage = (m, from) => this.onMessage(m as GuestMessage | { t: 'hosting' }, from);
    t.onLeave = (peer) => this.drop(peer);
    t.onJoin = (peer) => t.send({ t: 'hosting' } satisfies HostMessage, peer);
    t.send({ t: 'hosting' } satisfies HostMessage);
  }

  get playerCount() {
    return this.guests.size + 1;
  }

  private onMessage(m: GuestMessage | { t: 'hosting' }, from: string) {
    if (m.t === 'hosting') {
      if (from < this.t.selfId) this.onYield?.();
      return;
    }
    if (m.t === 'join') {
      if (this.guests.has(from)) return;
      if (this.guests.size + 1 >= MAX_PLAYERS) {
        this.t.send({ t: 'full' } satisfies HostMessage, from);
        return;
      }
      const name = (m.name || 'Joueur').slice(0, 14);
      this.guests.set(from, { peer: from, name, sentProps: new Set() });
      // drop in next to the spawn square
      const sp = this.sim.map.spawn;
      const a = this.guests.size * 1.3;
      const p = this.sim.addPlayer(from, { x: sp.x + Math.cos(a) * 3, y: sp.y, z: sp.z + Math.sin(a) * 3, yaw: sp.yaw });
      p.remote = true;
      p.state.name = name;
      p.state.look = m.look;
      applyProfile(p.state, sanitize(m.profile));
      this.t.send({ t: 'welcome', id: from, host: this.t.selfId, tick: this.sim.tick } satisfies HostMessage, from);
      this.sim.events.push({ type: 'joined', playerId: from, name });
      this.onPlayersChange?.(this.playerCount);
      return;
    }
    if (m.t === 'st') {
      if (!this.guests.has(from)) return;
      this.sim.applyPlayerReport(from, m);
      for (const a of m.a ?? []) this.pending.push({ type: 'action', playerId: from, tick: 0, action: a.k, arg: a.arg });
    }
  }

  private drop(peer: string) {
    const g = this.guests.get(peer);
    if (!g) return;
    this.guests.delete(peer);
    this.sim.removePlayer(peer);
    this.sim.events.push({ type: 'left', playerId: peer, name: g.name });
    this.onPlayersChange?.(this.playerCount);
  }

  beforeStep(tick: number, queue: CommandQueue) {
    for (const a of this.pending) queue.push({ ...a, tick });
    this.pending = [];
  }

  onLocalAction(): boolean {
    return false; // the host plays its own actions locally
  }

  afterStep(tick: number) {
    // keep this tick's events for the next snapshots (the game drains sim.events right after)
    this.events.push(...this.sim.events);
    if (tick % SNAPSHOT_EVERY !== 0 || this.guests.size === 0) {
      if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
      return;
    }
    const players = [...this.sim.players.values()];
    const shared = players.map((p) => packPlayer(p.state, false));
    const index = new Map(players.map((p, i) => [p.state.id, i]));
    const driverIndex = (d: string) => (d === 'none' ? -1 : d === 'npc' ? -2 : (index.get(d) ?? -1));
    for (const g of this.guests.values()) {
      const me = this.sim.players.get(g.peer);
      if (!me) continue;
      const cx = me.state.x;
      const cz = me.state.z;
      const near = (x: number, z: number, r = AOI) => Math.abs(x - cx) < r && Math.abs(z - cz) < r;
      const D: number[][] = [];
      for (const ped of this.sim.peds.values()) if (near(ped.state.x, ped.state.z)) D.push(packPed(ped.state));
      const V: number[][] = [];
      for (const v of this.sim.vehicles.values()) if (near(v.state.x, v.state.z) || v.state.driver === g.peer) V.push(packVehicle(v.state, driverIndex));
      const K: number[][] = [];
      for (const pk of this.sim.pickups.values()) if (near(pk.x, pk.z)) K.push(packPickup(pk));
      const X: number[][] = [];
      for (const [id, d] of this.sim.props.broken) {
        if (g.sentProps.has(id)) continue;
        X.push(packProp(d));
        if (d.resting && d.spray <= 0) g.sentProps.add(id);
      }
      const H: number[][] = [];
      for (const h of this.sim.police.helis.values()) if (near(h.state.x, h.state.z, AOI + 80)) H.push(packHeli(h.state));
      const E = this.events.filter((e) => {
        if (e.type === 'toast' || e.type === 'money' || e.type === 'respawn' || e.type === 'levelup' || e.type === 'chaos' || e.type === 'chaosEnd' || e.type === 'contract' || e.type === 'streak' || e.type === 'dmg' || e.type === 'crate' || e.type === 'say' || e.type === 'freeRoam') return e.playerId === g.peer;
        if ('x' in e) return near((e as { x: number }).x, (e as { z: number }).z, AOI + 30);
        if (e.type === 'shot') return near(e.fx, e.fz, AOI + 30);
        return true;
      });
      // rooftop stashes: 1 = full
      const C = this.sim.roofs.chests.map((c) => (c.refill === 0 || this.sim.tick >= c.refill ? 1 : 0));
      const P = players.map((p, i) => (p.state.id === g.peer ? packPlayer(p.state) : shared[i]));
      this.t.send({ t: 'snap', k: tick, P, D, V, K, X, H, C, E } satisfies HostMessage, g.peer);
    }
    this.events = [];
  }

  close() {
    this.t.leave();
  }
}
