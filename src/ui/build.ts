import type { ActionKind } from '../core/commands';
import { MAX_MODULES, moduleById } from '../data/base';
import { levelOf } from '../data/progression';
import type { MapData } from '../maps/types';
import type { BaseView } from '../render/base';
import { CATALOG, moduleNear } from '../sim/base';
import type { PlayerState } from '../sim/player';

const euro = (n: number) => `${n.toLocaleString('fr-FR')} €`;

/**
 * Build mode in your hideout: pick a piece in the catalog, walk to aim the preview
 * (it sits in front of you), turn it, place it. "Retirer" takes back the piece you
 * stand next to (refunded). The sim checks everything (room, space, money, level).
 */
export class BuildBar {
  private btn: HTMLButtonElement;
  private bar: HTMLElement;
  private chips: HTMLElement;
  private info: HTMLElement;
  private active = false;
  private chipsKey = '';
  private me: PlayerState | null = null;

  constructor(
    private map: MapData,
    private base: BaseView,
    private send: (action: ActionKind, arg: string) => void,
  ) {
    const hud = document.getElementById('hud')!;
    this.btn = document.createElement('button');
    this.btn.id = 'btn-build';
    this.btn.className = 'hidden';
    this.btn.textContent = '🔨 Aménager';
    this.btn.setAttribute('aria-label', 'Aménager ta planque');
    hud.appendChild(this.btn);
    this.bar = document.createElement('div');
    this.bar.id = 'build-bar';
    this.bar.className = 'hidden';
    this.bar.innerHTML = `<div class="bb-info"></div><div class="bb-actions"><button data-b="rot">↻ Tourner</button><button data-b="place" class="go">✔ Poser</button><button data-b="remove">🗑 Retirer</button><button data-b="close">✕</button></div><div class="bb-chips"></div>`;
    hud.appendChild(this.bar);
    this.chips = this.bar.querySelector('.bb-chips')!;
    this.info = this.bar.querySelector('.bb-info')!;
    const stop = (e: Event) => e.stopPropagation();
    this.btn.addEventListener('pointerdown', (e) => {
      stop(e);
      this.setActive(!this.active);
    });
    this.bar.addEventListener('pointerdown', (e) => {
      stop(e);
      const t = e.target as HTMLElement;
      const chip = t.closest('[data-m]') as HTMLElement | null;
      if (chip) {
        this.base.build = { m: chip.dataset.m!, r: this.base.build?.r ?? 0 };
        this.chipsKey = '';
        return;
      }
      const b = (t.closest('[data-b]') as HTMLElement | null)?.dataset.b;
      if (b === 'close') this.setActive(false);
      else if (b === 'rot' && this.base.build) this.base.build = { ...this.base.build, r: (this.base.build.r + 1) % 4 };
      else if (b === 'place') {
        const p = this.base.target;
        if (p && this.base.fits) this.send('build', `place:${p.m}:${p.x}:${p.z}:${p.r}`);
      } else if (b === 'remove' && this.me) {
        const def = this.map.interiors.find((i) => i.id === this.me!.interior);
        const i = def ? moduleNear(def, this.me.base, this.me.x, this.me.z) : -1;
        if (i >= 0) this.send('build', `remove:${i}`);
      }
    });
  }

  private setActive(on: boolean) {
    this.active = on;
    this.bar.classList.toggle('hidden', !on);
    this.btn.classList.toggle('on', on);
    this.base.build = on ? (this.base.build ?? { m: CATALOG[0].id, r: 0 }) : null;
    if (!on) this.base.build = null;
    this.chipsKey = '';
  }

  update(me: PlayerState) {
    this.me = me;
    const home = !!me.interior && this.map.interiors.find((i) => i.id === me.interior)?.kind === 'hideout' && !me.dead;
    this.btn.classList.toggle('hidden', !home);
    if (!home && this.active) this.setActive(false);
    if (!this.active) return;
    const level = levelOf(me.rep);
    const key = `${this.base.build?.m}|${level}|${me.money + me.bank}|${me.base.length}`;
    if (key !== this.chipsKey) {
      this.chipsKey = key;
      this.chips.textContent = '';
      for (const m of CATALOG) {
        const c = document.createElement('button');
        c.dataset.m = m.id;
        const locked = level < m.level;
        c.className = `chip${m.id === this.base.build?.m ? ' sel' : ''}${locked || me.money + me.bank < m.price ? ' dim' : ''}`;
        c.innerHTML = `<span></span><b></b><small></small>`;
        c.querySelector('span')!.textContent = m.icon;
        c.querySelector('b')!.textContent = m.name;
        c.querySelector('small')!.textContent = locked ? `🔒 niv. ${m.level}` : euro(m.price);
        this.chips.appendChild(c);
      }
    }
    const m = this.base.build && moduleById(this.base.build.m);
    const text = m ? `${m.icon} ${m.name} · ${m.desc}${this.base.fits ? '' : ' · ❌ pas de place ici : bouge'} · ${me.base.length}/${MAX_MODULES}` : '';
    if (this.info.textContent !== text) this.info.textContent = text;
    (this.bar.querySelector('.go') as HTMLButtonElement).disabled = !this.base.fits;
  }
}
