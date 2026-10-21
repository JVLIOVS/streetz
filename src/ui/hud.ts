import type { MapData } from '../maps/types';
import { Minimap } from './minimap';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** DOM HUD: mini-map, wanted stars, money, toasts, FPS. */
export class Hud {
  readonly minimap: Minimap;
  private money = $('money');
  private stars = [...$('stars').children] as HTMLElement[];
  private toastEl = $('toast');
  private fpsEl = $('fps');
  private zoneEl = $('zone-name');
  private toastTimer = 0;
  private lastMoney = -1;
  private lastStars = -1;
  private lastZone = '';

  constructor(private map: MapData) {
    $('hud').classList.remove('hidden');
    this.minimap = new Minimap($('minimap') as HTMLCanvasElement, map);
  }

  setMoney(v: number) {
    if (v === this.lastMoney) return;
    this.lastMoney = v;
    this.money.textContent = `${v.toLocaleString('fr-FR')} €`;
  }

  setStars(n: number) {
    if (n === this.lastStars) return;
    this.lastStars = n;
    this.stars.forEach((s, i) => s.classList.toggle('on', i < n));
  }

  updateZone(x: number, z: number) {
    const zone = this.map.zones.find((zn) => zn.kind !== 'river' && x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1);
    const name = zone?.name ?? 'Belleplace';
    if (name !== this.lastZone) {
      this.lastZone = name;
      this.zoneEl.textContent = name;
    }
  }

  toast(text: string, seconds = 2.2) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = seconds;
  }

  setDebug(text: string) {
    this.fpsEl.textContent = text;
  }

  update(dt: number) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }
}
