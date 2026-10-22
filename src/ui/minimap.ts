import type { MapData, PoiKind } from '../maps/types';
import type { PlayerState } from '../sim/player';
import type { SimWorld } from '../sim/world';

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
        // money on the ground
        g.fillStyle = '#5ee86a';
        for (const pk of sim.pickups.values()) {
          const [mx, mz] = at(pk.x, pk.z);
          g.fillRect(mx - 5 / k, mz - 5 / k, 10 / k, 10 / k);
        }
        const police = blink ? '#ff3040' : '#3060ff';
        for (const ped of sim.peds.values()) if (ped.state.role !== 'civ' && ped.alive) dot(ped.state.x, ped.state.z, 3.5, police);
        for (const v of sim.vehicles.values()) if (v.state.siren) dot(v.state.x, v.state.z, 5, police);
        for (const h of sim.police.helis.values()) if (h.state.down < 0) dot(h.state.x, h.state.z, 6.5, police);
        for (const p of sim.players.values()) if (me && p.state.id !== me.id && !p.state.interior) dot(p.state.x, p.state.z, 5, '#ffd23f');
      }
      g.restore();
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
