import type { ActionKind } from '../core/commands';
import { CLOTHES, GARAGE_SLOTS, VEHICLE_OFFERS } from '../data/shop';
import { VEHICLES } from '../data/vehicles';
import { ARMOR_PRICE, WEAPON_ORDER, WEAPONS } from '../data/weapons';
import type { PlayerState } from '../sim/player';
import { levelOf, requiredLevel } from '../data/progression';
import { BUSINESSES, bizCap, bizStock } from '../data/business';

export type MenuKind = 'gunshop' | 'clothes' | 'dealer' | 'wardrobe' | 'garage' | 'business';

interface Row {
  label: string;
  sub: string;
  button: string;
  disabled?: boolean;
  on?: boolean;
  action?: { action: ActionKind; arg: string };
}

const euro = (n: number) => `${n.toLocaleString('fr-FR')} €`;

/**
 * Shop / wardrobe / garage panel. It only sends commands (buy, wear, garage_out):
 * the simulation validates everything (money, location) like a server would.
 */
export class MenuPanel {
  private el: HTMLElement;
  private list: HTMLElement;
  private title: HTMLElement;
  private kind: MenuKind | null = null;
  private lastKey = '';

  constructor(
    private send: (action: ActionKind, arg: string) => void,
    private onClose: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'menu-panel';
    this.el.className = 'hidden';
    this.el.innerHTML = `<div class="mp-head"><span class="mp-title"></span><button class="mp-close" aria-label="Fermer">✕</button></div><div class="mp-list"></div>`;
    document.getElementById('hud')!.appendChild(this.el);
    this.list = this.el.querySelector('.mp-list')!;
    this.title = this.el.querySelector('.mp-title')!;
    this.el.querySelector('.mp-close')!.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.close();
    });
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  get isOpen() {
    return this.kind !== null;
  }

  open(kind: MenuKind) {
    this.kind = kind;
    this.lastKey = '';
    this.el.classList.remove('hidden');
  }

  close() {
    if (!this.kind) return;
    this.kind = null;
    this.el.classList.add('hidden');
    this.onClose();
  }

  /** Re-renders when the player's inventory or money changed. */
  update(s: PlayerState) {
    if (!this.kind) return;
    // walking away from the counter / wardrobe closes the panel
    const still = s.context && ((this.kind === 'wardrobe' && s.context.kind === 'wardrobe') || (this.kind === 'garage' && s.context.kind === 'garage') || (this.kind === 'business' && s.context.kind === 'business') || (s.context.kind === 'shop' && s.context.target === this.kind));
    if (!still) {
      this.close();
      return;
    }
    const key = JSON.stringify([this.kind === 'business' ? Math.floor(Date.now() / 3000) : 0, s.biz, s.rep, s.money, s.weapons, s.ammo, s.armor, s.clothes, s.outfit, s.garage]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const { title, rows } = this.rows(this.kind, s);
    // level-gated items show what level unlocks them (the next goal to grind for)
    const level = levelOf(s.rep);
    for (const r of rows) {
      if (r.action?.action !== 'buy' || r.on) continue;
      const need = requiredLevel(r.action.arg);
      if (need > level) {
        r.disabled = true;
        r.button = `🔒 Niv. ${need}`;
      }
    }
    this.title.textContent = `${title} · ${euro(s.money)}`;
    this.list.innerHTML = '';
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'mp-row' + (r.on ? ' on' : '');
      row.innerHTML = `<div class="mp-txt"><b></b><small></small></div><button></button>`;
      row.querySelector('b')!.textContent = r.label;
      row.querySelector('small')!.textContent = r.sub;
      const b = row.querySelector('button')!;
      b.textContent = r.button;
      b.disabled = !!r.disabled;
      if (r.action) {
        const a = r.action;
        b.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          if (!b.disabled) this.send(a.action, a.arg);
        });
      }
      this.list.appendChild(row);
    }
  }

  private rows(kind: MenuKind, s: PlayerState): { title: string; rows: Row[] } {
    switch (kind) {
      case 'gunshop': {
        const rows: Row[] = [];
        for (const id of WEAPON_ORDER) {
          const w = WEAPONS[id];
          if (w.price <= 0) continue;
          const owned = s.weapons.includes(id);
          if (!owned) rows.push({ label: `${w.icon} ${w.name}`, sub: w.melee ? 'Corps à corps' : `Arme à feu · ${w.ammoPack} balles`, button: euro(w.price), disabled: s.money < w.price, action: { action: 'buy', arg: `weapon:${id}` } });
          else if (!w.melee) rows.push({ label: `${w.icon} Munitions ${w.name}`, sub: `+${w.ammoPack} (tu en as ${s.ammo[id]})`, button: euro(w.ammoPrice), disabled: s.money < w.ammoPrice, action: { action: 'buy', arg: `ammo:${id}` } });
          else rows.push({ label: `${w.icon} ${w.name}`, sub: 'Déjà à toi', button: '✓', disabled: true, on: true });
        }
        rows.push({ label: '🦺 Gilet pare-balles', sub: `Armure ${Math.round(s.armor)} / 100`, button: euro(ARMOR_PRICE), disabled: s.armor >= 100 || s.money < ARMOR_PRICE, action: { action: 'buy', arg: 'armor' } });
        return { title: 'Armurerie', rows };
      }
      case 'clothes':
        return {
          title: 'Boutique Swagg',
          rows: CLOTHES.filter((c) => c.price > 0).map((c) => {
            const owned = s.clothes.includes(c.id);
            return { label: c.name, sub: owned ? 'À toi : touche pour porter' : slotName(c.slot), button: owned ? 'Porter' : euro(c.price), disabled: !owned && s.money < c.price, on: owned, action: { action: 'buy', arg: `cloth:${c.id}` } };
          }),
        };
      case 'dealer':
        return {
          title: 'Concession Bolide',
          rows: VEHICLE_OFFERS.map((o) => ({
            label: VEHICLES[o.type].name,
            sub: `Livré à ta planque · garage ${s.garage.length}/${GARAGE_SLOTS}`,
            button: euro(o.price),
            disabled: s.money < o.price || s.garage.length >= GARAGE_SLOTS,
            action: { action: 'buy', arg: `car:${o.type}` },
          })),
        };
      case 'wardrobe': {
        const free = CLOTHES.filter((c) => c.price === 0);
        const owned = CLOTHES.filter((c) => s.clothes.includes(c.id));
        const rows: Row[] = [...owned, ...free].map((c) => ({ label: c.name, sub: slotName(c.slot), button: 'Porter', action: { action: 'wear', arg: c.id } }));
        if (owned.length === 0) rows.unshift({ label: 'Ta garde-robe est vide', sub: 'Achète des sapes à la Boutique Swagg 👕', button: '—', disabled: true });
        return { title: 'Garde-robe', rows };
      }
      case 'business': {
        const now = Math.floor(Date.now() / 1000);
        const rows: Row[] = BUSINESSES.map((b) => {
          const own = s.biz.find((x) => x.id === b.id);
          if (!own) return { label: b.name, sub: `Rapporte ${euro(b.rate)}/h, même quand tu n'es pas là`, button: euro(b.price), disabled: s.money < b.price, action: { action: 'buy', arg: `biz:${b.id}` } };
          const stock = bizStock(own, now);
          const full = stock >= bizCap(b.id);
          return { label: `${b.name}${full ? ' · PLEIN ⚠' : ''}`, sub: `${euro(stock)} / ${euro(bizCap(b.id))} · ${euro(b.rate)}/h`, button: 'Encaisser', disabled: stock <= 0, on: true, action: { action: 'collect', arg: b.id } };
        });
        return { title: 'Mes business', rows };
      }
      case 'garage': {
        const rows: Row[] = s.garage.map((g, i) => ({ label: VEHICLES[g.type].name, sub: 'Sortir et partir avec', button: 'Sortir', action: { action: 'garage_out', arg: String(i) } }));
        if (rows.length === 0) rows.push({ label: 'Garage vide', sub: 'Gare un véhicule devant ta planque, ou achètes-en un à la concession', button: '—', disabled: true });
        return { title: `Garage ${s.garage.length}/${GARAGE_SLOTS}`, rows };
      }
    }
  }
}

function slotName(slot: string) {
  return { top: 'Haut', bottom: 'Bas', shoes: 'Chaussures', hat: 'Couvre-chef', glasses: 'Accessoire', hair: 'Coiffure' }[slot] ?? slot;
}
