import { WEAPONS } from '../data/weapons';
import type { MapData } from '../maps/types';
import type { PlayerState } from '../sim/player';
import { Minimap } from './minimap';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const WEAPON_ICON = { fist: '✊', pistol: '🔫', rifle: '💥' } as const;

/** DOM HUD: mini-map, health, wanted stars, money, weapon, contextual buttons, toasts. */
export class Hud {
  readonly minimap: Minimap;
  private money = $('money');
  private stars = [...$('stars').children] as HTMLElement[];
  private starsBox = $('stars');
  private toastEl = $('toast');
  private fpsEl = $('fps');
  private zoneEl = $('zone-name');
  private hp = $('hp').firstElementChild as HTMLElement;
  private armor = $('armor');
  private weaponIcon = $('weapon-icon');
  private weaponAmmo = $('weapon-ammo');
  private attackIcon = $('attack-icon');
  private attackLbl = $('attack-lbl');
  private attackBtn = $('btn-attack');
  private actionBtn = $('btn-action');
  private actionLbl = $('action-lbl');
  private foot = $('buttons-foot');
  private car = $('buttons-car');
  private robbery = $('robbery');
  private robberyBar = $('robbery').querySelector('i') as HTMLElement;
  private ko = $('ko');
  private targetHp = $('target-hp');
  private targetFill = $('target-hp').firstElementChild as HTMLElement;
  private toastTimer = 0;
  private last: Record<string, string | number | boolean> = {};

  constructor(private map: MapData) {
    $('hud').classList.remove('hidden');
    this.minimap = new Minimap($('minimap') as HTMLCanvasElement, map);
  }

  /** Only touches the DOM when a value actually changes. */
  private changed(key: string, v: string | number | boolean) {
    if (this.last[key] === v) return false;
    this.last[key] = v;
    return true;
  }

  setMoney(v: number) {
    if (this.changed('money', v)) this.money.textContent = `${v.toLocaleString('fr-FR')} €`;
  }

  setStars(n: number, flashing: boolean) {
    if (this.changed('stars', n)) this.stars.forEach((s, i) => s.classList.toggle('on', i < n));
    if (this.changed('flash', flashing)) this.starsBox.classList.toggle('flash', flashing);
  }

  updatePlayer(s: PlayerState) {
    if (this.changed('hp', Math.round(s.health))) this.hp.style.width = `${Math.max(0, s.health)}%`;
    if (this.changed('armor', Math.round(s.armor))) {
      this.armor.classList.toggle('empty', s.armor <= 0);
      (this.armor.firstElementChild as HTMLElement).style.width = `${s.armor}%`;
    }
    const w = s.weapon;
    if (this.changed('weapon', w)) {
      this.weaponIcon.textContent = WEAPON_ICON[w];
      this.attackIcon.textContent = WEAPON_ICON[w];
      this.attackLbl.textContent = w === 'fist' ? 'FRAPPER' : 'TIRER';
      this.attackBtn.classList.toggle('gun', w !== 'fist');
    }
    const ammo = w === 'fist' ? '' : String(s.ammo[w]);
    if (this.changed('ammo', ammo)) this.weaponAmmo.textContent = ammo ? `${ammo}` : WEAPONS.fist.name;
    const driving = s.vehicle >= 0;
    if (this.changed('driving', driving)) {
      this.foot.classList.toggle('hidden', driving);
      this.car.classList.toggle('hidden', !driving);
    }
    const label = s.context && !s.dead ? s.context.label : '';
    if (this.changed('ctx', label)) {
      this.actionBtn.classList.toggle('hidden', !label);
      this.actionLbl.textContent = label.toUpperCase();
    }
    if (this.changed('rob', s.robbery >= 0)) this.robbery.classList.toggle('hidden', s.robbery < 0);
    if (s.robbery >= 0) this.robberyBar.style.width = `${s.robbery * 100}%`;
    if (this.changed('ko', s.dead)) this.ko.classList.toggle('hidden', !s.dead);
  }

  /** Floating health bar at screen position (x, y) in px, or hidden when null. */
  setTargetBar(pos: { x: number; y: number; ratio: number } | null) {
    if (this.changed('tbar', !!pos)) this.targetHp.classList.toggle('hidden', !pos);
    if (!pos) return;
    this.targetHp.style.transform = `translate(${pos.x.toFixed(0)}px, ${pos.y.toFixed(0)}px)`;
    const w = `${Math.max(0, pos.ratio * 100).toFixed(0)}%`;
    if (this.changed('tfill', w)) this.targetFill.style.width = w;
  }

  updateZone(x: number, z: number, interior: string | null) {
    let name: string;
    if (interior) name = this.map.interiors.find((i) => i.id === interior)?.name ?? 'Intérieur';
    else name = this.map.zones.find((zn) => zn.kind !== 'river' && x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1)?.name ?? 'Belleplace';
    if (this.changed('zone', name)) this.zoneEl.textContent = name;
  }

  toast(text: string, seconds = 2.4) {
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
