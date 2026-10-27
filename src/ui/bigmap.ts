import type { PlayerState } from '../sim/player';
import type { SimWorld } from '../sim/world';
import type { Minimap } from './minimap';

const LEGEND: [string, string][] = [
  ['QG', 'Ta planque (QG) : aménage-la, coffre, établi, garage'],
  ['!', 'Missions de la Famille (grise = verrouillée)'],
  ['$$', 'Braquage coop « Le Coffre »'],
  ['€', 'Receleur : livre-lui la voiture qu’il veut'],
  ['⊕', 'Postes de tir sur les toits (super saut)'],
  ['🛒', 'Supérettes : caisse, coffre, rayons · 🔫 armurerie · 👕 fringues · 🚗 concession'],
  ['★', 'Commissariat : armurerie et coffre des scellés (gros risque)'],
  ['📦', 'Colis surprises · carrés verts = cash · bleus = armes'],
  ['📍', 'Touche la carte pour poser ton repère'],
];

/**
 * Full-screen map, opened by tapping the mini-map: north up, the whole city, every
 * activity with a legend. Tapping a spot drops a pin (shown on the mini-map too).
 */
export class BigMap {
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private open = false;
  private view = { ox: 0, oy: 0, k: 1 };

  constructor(
    private mini: Minimap,
    private sim: SimWorld,
    private me: () => PlayerState,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'bigmap';
    this.el.className = 'hidden';
    this.el.innerHTML = `<canvas></canvas><div class="bm-side"><div class="bm-head"><b>Carte</b><button class="bm-close" aria-label="Fermer">✕</button></div><ul></ul><button class="bm-clear">Effacer mon repère</button></div>`;
    document.getElementById('hud')!.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas')!;
    const ul = this.el.querySelector('ul')!;
    for (const [icon, text] of LEGEND) {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = icon;
      li.append(b, document.createTextNode(text));
      ul.appendChild(li);
    }
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.querySelector('.bm-close')!.addEventListener('pointerdown', () => this.toggle(false));
    this.el.querySelector('.bm-clear')!.addEventListener('pointerdown', () => {
      this.mini.mark = null;
      this.draw();
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const px = (e.clientX - r.left - this.view.ox) / this.view.k;
      const py = (e.clientY - r.top - this.view.oy) / this.view.k;
      const half = this.sim.map.half;
      const x = px / this.mini.scale - half;
      const z = py / this.mini.scale - half;
      if (Math.abs(x) > half || Math.abs(z) > half) return;
      this.mini.mark = [x, z];
      this.draw();
    });
  }

  get isOpen() {
    return this.open;
  }

  toggle(on = !this.open) {
    this.open = on;
    this.el.classList.toggle('hidden', !on);
    if (on) this.draw();
  }

  /** Redraws (called on open, on tap, and a few times per second while open). */
  draw() {
    if (!this.open) return;
    const c = this.canvas;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#1b1430';
    g.fillRect(0, 0, w, h);
    const size = this.mini.base.width;
    const k = Math.min(w, h) / size;
    const ox = (w - size * k) / 2;
    const oy = (h - size * k) / 2;
    this.view = { ox, oy, k };
    g.save();
    g.translate(ox, oy);
    g.scale(k, k);
    g.drawImage(this.mini.base, 0, 0);
    const me = this.me();
    const at = (x: number, z: number) => this.mini.toPx(x, z);
    const dot = (x: number, z: number, r: number, color: string) => {
      const [mx, mz] = at(x, z);
      g.fillStyle = color;
      g.beginPath();
      g.arc(mx, mz, r / k, 0, Math.PI * 2);
      g.fill();
    };
    // crates and stuff on the ground
    for (const pk of this.sim.pickups.values()) {
      if (pk.kind === 'crate') dot(pk.x, pk.z, 5, '#ffc93c');
    }
    // the drawing code of the mini-map works in its own scale: give it ours (k)
    this.mini.drawMissions(g, k * 0.6, this.sim, me, at, dot, Math.floor(performance.now() / 350) % 2 === 0);
    // you
    const [px, pz] = at(me.interior ? (this.sim.map.interiors.find((i) => i.id === me.interior)?.door.x ?? me.x) : me.x, me.interior ? (this.sim.map.interiors.find((i) => i.id === me.interior)?.door.z ?? me.z) : me.z);
    g.translate(px, pz);
    g.rotate(-me.facing);
    g.fillStyle = '#ff3b6b';
    g.strokeStyle = '#fff';
    g.lineWidth = 3 / k;
    g.beginPath();
    g.moveTo(0, -16 / k);
    g.lineTo(12 / k, 12 / k);
    g.lineTo(0, 5 / k);
    g.lineTo(-12 / k, 12 / k);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
}
