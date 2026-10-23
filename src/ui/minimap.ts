import { levelOf } from '../data/progression';
import type { MapData, PoiKind } from '../maps/types';
import type { PlayerState } from '../sim/player';
import type { SimWorld } from '../sim/world';
import { missionById } from '../data/missions';
import { GOLD_PAINT } from '../data/contracts';

const POI_STYLE: Partial<Record<PoiKind, { color: string; label: string }>> = {
  police: { color: '#3f7bff', label: '★' },
  hospital: { color: '#ff4057', label: '+' },
  garage: { color: '#ff9f1c', label: '🔧' },
  bank: { color: '#2ecc71', label: '$' },
  jewelry: { color: '#b56cff', label: '◆' },
  hideout: { color: '#ffd23f', label: '⌂' },
  shop: { color: '#22b14c', label: '🛒' },
  gunshop: { color: '#ff7a3d', label: '🔫' },
  clothes: { color: '#ff7eb6', label: '👕' },
  dealer: { color: '#2f80ed', label: '🚗' },
  apartment: { color: '#7dff7a', label: '🏠' },
  airport: { color: '#9fd3ff', label: '✈' },
};

/**
 * Rotating circular mini-map. The whole map is pre-rendered once to an offscreen
 * canvas; each update just draws a rotated crop around the player.
 */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private scale: number; // px per meter on the base canvas
  private size: number;

  constructor(canvas: HTMLCanvasElement, private map: MapData) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.size = canvas.clientWidth || 132;
    canvas.width = this.size * dpr;
    canvas.height = this.size * dpr;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    const res = 1024;
    this.scale = res / (map.half * 2);
    this.base = document.createElement('canvas');
    this.base.width = res;
    this.base.height = res;
    this.drawBase(this.base.getContext('2d')!);
  }

  private toPx(x: number, z: number): [number, number] {
    return [(x + this.map.half) * this.scale, (z + this.map.half) * this.scale];
  }

  private drawBase(g: CanvasRenderingContext2D) {
    const m = this.map;
    const s = this.scale;
    g.fillStyle = '#d8d0c0';
    g.fillRect(0, 0, this.base.width, this.base.height);
    if (m.terrain) {
      const [x, z] = this.toPx(m.terrain.x0, m.terrain.z0);
      g.fillStyle = '#7fd35e';
      g.fillRect(x, z, m.terrain.sizeX * s, m.terrain.sizeZ * s);
    }
    for (const sd of m.solids) {
      if (sd.kind === 'grass' || sd.kind === 'plaza' || sd.kind === 'quay') {
        g.fillStyle = sd.kind === 'grass' ? '#86d566' : sd.kind === 'quay' ? '#c3b497' : '#efe5cf';
        const [x, z] = this.toPx(sd.x - sd.sx / 2, sd.z - sd.sz / 2);
        g.fillRect(x, z, sd.sx * s, sd.sz * s);
      }
    }
    g.fillStyle = '#3ba7d6';
    for (const w of m.water) {
      const [x, z] = this.toPx(w.x0, w.z0);
      g.fillRect(x, z, (w.x1 - w.x0) * s, (w.z1 - w.z0) * s);
    }
    for (const r of m.roads) {
      g.fillStyle = r.kind === 'highway' ? '#f7c948' : '#fdfbf6';
      const [x, z] = this.toPx(r.x - r.w / 2, r.z - r.d / 2);
      g.fillRect(x, z, r.w * s, r.d * s);
    }
    for (const b of m.buildings) {
      g.fillStyle = b.style === 3 ? '#8a7f9e' : '#9d9488';
      const [x, z] = this.toPx(b.x - b.w / 2, b.z - b.d / 2);
      g.fillRect(x, z, b.w * s, b.d * s);
    }
    g.font = 'bold 22px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of m.pois) {
      const st = POI_STYLE[p.kind];
      if (!st) continue;
      const [x, z] = this.toPx(p.x, p.z);
      g.fillStyle = st.color;
      g.beginPath();
      g.arc(x, z, 14, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 3;
      g.stroke();
      g.fillStyle = '#fff';
      g.fillText(st.label, x, z + 1);
    }
  }

  /** Mission start markers, current waypoint and mission targets. */
  private drawMissions(
    g: CanvasRenderingContext2D,
    k: number,
    sim: SimWorld,
    me: PlayerState,
    at: (x: number, z: number) => [number, number],
    dot: (x: number, z: number, r: number, color: string) => void,
    blink: boolean,
  ) {
    g.font = `900 ${12 / k}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (!me.mission) {
      for (const gv of sim.missions.givers) {
        const def = missionById(gv.id)!;
        const open = (!def.requires || me.missionsDone.includes(def.requires)) && levelOf(me.rep) >= (def.level ?? 1);
        const done = me.missionsDone.includes(def.id);
        const [mx, mz] = at(gv.x, gv.z);
        g.fillStyle = !open ? 'rgba(120,120,130,0.8)' : done ? '#b8a24a' : '#ffd23f';
        g.strokeStyle = '#1b1430';
        g.lineWidth = 2 / k;
        g.beginPath();
        g.arc(mx, mz, 8 / k, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#1b1430';
        g.fillText(open ? '!' : '🔒', mx, mz + 1 / k);
      }
    }
    // your stuff on the ground (knocked out)
    if (me.stash) {
      const [bx, bz] = at(me.stash[0], me.stash[1]);
      g.fillStyle = blink ? '#b56cff' : '#fff';
      g.strokeStyle = '#1b1430';
      g.lineWidth = 2 / k;
      g.beginPath();
      g.arc(bx, bz, 9 / k, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#1b1430';
      g.fillText('🎒', bx, bz + 1 / k);
    }
    // rooftop sniper spots
    for (const q of sim.roofs.spots) {
      const [sx, sz] = at(q.x, q.z);
      g.strokeStyle = '#ff3b4f';
      g.lineWidth = 2.5 / k;
      g.beginPath();
      g.arc(sx, sz, 6 / k, 0, Math.PI * 2);
      g.moveTo(sx - 9 / k, sz);
      g.lineTo(sx + 9 / k, sz);
      g.moveTo(sx, sz - 9 / k);
      g.lineTo(sx, sz + 9 / k);
      g.stroke();
    }
    // co-op heist start
    if (!me.mission) {
      const [hx, hz] = at(sim.heist.spot.x, sim.heist.spot.z);
      g.fillStyle = '#ff3b4f';
      g.strokeStyle = '#fff';
      g.lineWidth = 2 / k;
      g.beginPath();
      g.arc(hx, hz, 9 / k, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#fff';
      g.fillText('$$', hx, hz + 1 / k);
    }
    // fence (receleur)
    {
      const f = sim.contracts.fence;
      const [mx, mz] = at(f.x, f.z);
      g.fillStyle = '#5ee86a';
      g.strokeStyle = '#1b1430';
      g.lineWidth = 2 / k;
      g.beginPath();
      g.arc(mx, mz, 8 / k, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#1b1430';
      g.fillText('€', mx, mz + 1 / k);
    }
    for (const id of me.missionTargets) {
      const t = sim.peds.get(id)?.state ?? sim.vehicles.get(id)?.state;
      if (t) dot(t.x, t.z, 4.5, blink ? '#ff3b4f' : '#ffd23f');
    }
    if (me.waypoint) {
      const [mx, mz] = at(me.waypoint[0], me.waypoint[1]);
      g.save();
      g.translate(mx, mz);
      g.rotate(Math.PI / 4);
      g.fillStyle = '#ffd23f';
      g.strokeStyle = '#1b1430';
      g.lineWidth = 2 / k;
      const r = 6 / k;
      g.fillRect(-r, -r, r * 2, r * 2);
      g.strokeRect(-r, -r, r * 2, r * 2);
      g.restore();
    }
  }

  /** @param yaw camera yaw: the map rotates so that "up" is where the camera looks. */
  update(px: number, pz: number, facing: number, yaw: number, sim?: SimWorld, me?: PlayerState) {
    const g = this.ctx;
    const S = this.size;
    const view = 220; // meters across
    const k = S / (view * this.scale);
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    g.clip();
    g.translate(S / 2, S / 2);
    // Camera forward (-sin yaw, -cos yaw) must point up (-y on canvas)
    g.rotate(yaw);
    g.scale(k, k);
    const [x, z] = this.toPx(px, pz);
    if (px > this.map.half + 50) {
      // inside a building (rooms live off-map)
      g.restore();
      g.fillStyle = '#2a2140';
      g.beginPath();
      g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
      g.fill();
    } else {
      g.drawImage(this.base, -x, -z);
      const at = (wx: number, wz: number): [number, number] => {
        const [mx, mz] = this.toPx(wx, wz);
        return [mx - x, mz - z];
      };
      const dot = (wx: number, wz: number, r: number, color: string) => {
        const [mx, mz] = at(wx, wz);
        g.fillStyle = color;
        g.beginPath();
        g.arc(mx, mz, r / k, 0, Math.PI * 2);
        g.fill();
      };
      const blink = Math.floor(performance.now() / 350) % 2 === 0;
      if (me && me.wanted > 0 && !me.wantedSeen) {
        // search zone: get out of it and hide to lose the police
        const [cx, cz] = at(me.searchX, me.searchZ);
        g.fillStyle = blink ? 'rgba(255,40,60,0.28)' : 'rgba(60,90,255,0.22)';
        g.strokeStyle = blink ? '#ff3b4f' : '#4d6bff';
        g.lineWidth = 3 / k;
        g.beginPath();
        g.arc(cx, cz, me.searchR * this.scale, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      if (sim) {
        // money on the ground, surprise crates
        for (const pk of sim.pickups.values()) {
          const [mx, mz] = at(pk.x, pk.z);
          const r = (pk.kind === 'money' ? 5 : 7) / k;
          g.fillStyle = pk.kind === 'crate' ? '#ffc93c' : pk.kind === 'weapon' ? '#5ee8ff' : '#5ee86a';
          g.fillRect(mx - r, mz - r, r * 2, r * 2);
          if (pk.kind === 'crate') {
            g.strokeStyle = '#1b1430';
            g.lineWidth = 1.5 / k;
            g.strokeRect(mx - r, mz - r, r * 2, r * 2);
          }
        }
        // golden cars and rich passers-by
        for (const v of sim.vehicles.values()) if (v.state.paint === GOLD_PAINT && !v.state.wrecked) dot(v.state.x, v.state.z, blink ? 6 : 4.5, '#ffc93c');
        for (const ped of sim.peds.values()) if (ped.state.vip && ped.alive) dot(ped.state.x, ped.state.z, 4, '#ffc93c');
        const police = blink ? '#ff3040' : '#3060ff';
        for (const ped of sim.peds.values()) if (ped.state.role !== 'civ' && ped.alive) dot(ped.state.x, ped.state.z, 3.5, police);
        for (const v of sim.vehicles.values()) if (v.state.siren) dot(v.state.x, v.state.z, 5, police);
        for (const h of sim.police.helis.values()) if (h.state.down < 0) dot(h.state.x, h.state.z, 6.5, police);
        for (const p of sim.players.values()) {
          const o = p.state;
          if (!me || o.id === me.id || o.interior) continue;
          // bounty targets blink red and big; crewmates in the crew color
          if (o.bounty > 0) dot(o.x, o.z, blink ? 8 : 6, '#ff3b4f');
          else dot(o.x, o.z, 5, o.crew && me.crew?.name === o.crew.name ? `#${o.crew.color.toString(16).padStart(6, '0')}` : '#ffd23f');
        }
        if (me) this.drawMissions(g, k, sim, me, at, dot, blink);
      }
      g.restore();
    }
    // Next objective: an arrow on the rim when it is off the map
    if (me?.waypoint && px <= this.map.half + 50) {
      const dx = me.waypoint[0] - px;
      const dz = me.waypoint[1] - pz;
      // rotate like the map: camera forward is up
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      const rx = (dx * c - dz * sn) * this.scale * k;
      const rz = (dx * sn + dz * c) * this.scale * k;
      const d = Math.hypot(rx, rz);
      const R = S / 2 - 10;
      if (d > R) {
        g.save();
        g.translate(S / 2 + (rx / d) * R, S / 2 + (rz / d) * R);
        g.rotate(Math.atan2(rz, rx) + Math.PI / 2);
        g.fillStyle = '#ffd23f';
        g.strokeStyle = '#1b1430';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(0, -8);
        g.lineTo(7, 5);
        g.lineTo(-7, 5);
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();
      }
    }
    // Player arrow
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(-(facing - yaw));
    g.fillStyle = '#ff3b6b';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(7, 7);
    g.lineTo(0, 3);
    g.lineTo(-7, 7);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
}
