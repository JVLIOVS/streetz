import type { MapData, PoiKind } from '../maps/types';

const POI_STYLE: Partial<Record<PoiKind, { color: string; label: string }>> = {
  police: { color: '#3f7bff', label: '★' },
  hospital: { color: '#ff4057', label: '+' },
  garage: { color: '#ff9f1c', label: '🔧' },
  bank: { color: '#2ecc71', label: '$' },
  jewelry: { color: '#b56cff', label: '◆' },
  hideout: { color: '#ffd23f', label: '⌂' },
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
  update(px: number, pz: number, facing: number, yaw: number) {
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
    g.drawImage(this.base, -x, -z);
    g.restore();
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
