import { WEAPONS } from '../data/weapons';
import { CHAOS_WINDOW, levelProgress, nextUnlock } from '../data/progression';
import { STREAK_REWARDS } from '../data/contracts';
import { VEHICLES } from '../data/vehicles';
import type { MapData } from '../maps/types';
import type { PlayerState } from '../sim/player';
import { Minimap } from './minimap';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;


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
  private objective = $('objective');
  private objText = $('objective').querySelector('.obj-txt') as HTMLElement;
  private objTime = $('objective').querySelector('.obj-time') as HTMLElement;
  private lvlNum = $('lvl-num');
  private xpFill = $('xp-fill');
  private ctrBadge = $('ctr-badge');
  private nextGoal = $('next-goal');
  private chaosEl = $('chaos');
  private chaosMult = $('chaos').querySelector('.ch-mult') as HTMLElement;
  private chaosScore = $('chaos').querySelector('.ch-score') as HTMLElement;
  private chaosBar = $('chaos').querySelector('.ch-bar i') as HTMLElement;
  private popups = $('popups');
  private panel = $('progress-panel');
  private panelBody = $('progress-panel').querySelector('.pp-body') as HTMLElement;
  private panelKey = '';
  private cashTimer = 0;
  /** ✕ on the objective banner: abandon the mission. */
  onAbort?: () => void;
  private toastTimer = 0;
  private last: Record<string, string | number | boolean> = {};

  constructor(private map: MapData) {
    $('hud').classList.remove('hidden');
    this.minimap = new Minimap($('minimap') as HTMLCanvasElement, map);
    this.objective.querySelector('.obj-x')!.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onAbort?.();
    });
    this.objective.addEventListener('pointerdown', (e) => e.stopPropagation());
    $('btn-level').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.panel.classList.toggle('hidden');
      this.panelKey = '';
    });
    this.panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.panel.querySelector('.pp-close')!.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.panel.classList.add('hidden');
    });
  }

  /** Level badge, XP bar, next unlock, chaos combo and the progression panel. */
  /** Other players in the game (for the live leaderboard). */
  others: PlayerState[] = [];

  updateProgress(s: PlayerState) {
    const lp = levelProgress(s.rep);
    if (this.changed('lvl', lp.level)) this.lvlNum.textContent = String(lp.level);
    const xp = `${Math.round((lp.cur / lp.need) * 100)}%`;
    if (this.changed('xp', xp)) this.xpFill.style.width = xp;
    const next = nextUnlock(lp.level);
    const goal = next ? `Niv. ${next.level} : ${next.label}` : '';
    if (this.changed('goal', goal)) this.nextGoal.textContent = goal;
    const allDone = s.contracts.length > 0 && s.contracts.every((c) => c.progress >= c.goal);
    if (this.changed('ctrDone', allDone)) this.ctrBadge.classList.toggle('done', allDone);
    // chaos combo
    const on = s.chaosTimer > 0 && s.chaos > 0;
    if (this.cashTimer <= 0 && this.changed('chaosOn', on)) {
      this.chaosEl.classList.remove('cash');
      this.chaosEl.classList.toggle('hidden', !on);
    }
    if (on) {
      if (this.changed('chaosMult', s.chaosMult)) this.chaosMult.textContent = `×${s.chaosMult}`;
      if (this.changed('chaosScore', Math.round(s.chaos))) {
        this.chaosScore.textContent = Math.round(s.chaos).toLocaleString('fr-FR');
        this.chaosEl.classList.remove('bump');
        void this.chaosEl.offsetWidth;
        this.chaosEl.classList.add('bump');
      }
      this.chaosBar.style.width = `${(s.chaosTimer / CHAOS_WINDOW) * 100}%`;
    }
    if (!this.panel.classList.contains('hidden')) this.renderPanel(s, lp);
  }

  /** Combo cashed in: the score flies away as money. */
  chaosCashed(score: number, cash: number) {
    this.chaosEl.classList.remove('hidden', 'bump');
    this.chaosScore.textContent = cash > 0 ? `+${cash.toLocaleString('fr-FR')} €` : 'PERDU';
    void this.chaosEl.offsetWidth;
    this.chaosEl.classList.add('cash');
    this.cashTimer = 0.9;
    this.last.chaosOn = false;
    void score;
  }

  levelUp(level: number, unlocks: string[]) {
    const el = $('levelup');
    el.querySelector('b')!.textContent = String(level);
    el.querySelector('span')!.textContent = unlocks.length ? `Débloqué : ${unlocks.join(' · ')}` : '';
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }

  /** Floating text at a screen position (damage numbers, stunts). */
  popup(x: number, y: number, text: string, cls: string) {
    if (this.popups.childElementCount > 14) this.popups.firstElementChild?.remove();
    const el = document.createElement('div');
    el.className = `pop ${cls}`;
    el.textContent = text;
    el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -50%)`;
    el.addEventListener('animationend', () => el.remove());
    this.popups.appendChild(el);
  }

  private renderPanel(s: PlayerState, lp: { level: number; cur: number; need: number }) {
    const board = [s, ...this.others].map((p) => [p.name, p.rep, p.crew?.name ?? '', p.bounty]);
    const key = JSON.stringify([s.rep, s.contracts.map((c) => c.progress), s.streak, s.fenceOrder, s.contractsDay, s.week, board]);
    if (key === this.panelKey) return;
    this.panelKey = key;
    const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    const bar = (r: number) => `<div class="pp-bar"><i style="width:${Math.min(100, r * 100).toFixed(0)}%"></i></div>`;
    let h = `<div class="pp-sec">NIVEAU ${lp.level}</div><div class="pp-row">${lp.cur} / ${lp.need} XP${bar(lp.cur / lp.need)}</div>`;
    const next = nextUnlock(lp.level);
    if (next) h += `<div class="pp-row">🔓 Niveau ${next.level} : ${esc(next.label)}</div>`;
    h += `<div class="pp-sec">CONTRATS DU JOUR</div>`;
    if (!s.contracts.length) h += `<div class="pp-row">Chargement…</div>`;
    for (const c of s.contracts) {
      const done = c.progress >= c.goal;
      h += `<div class="pp-row${done ? ' done' : ''}">${done ? '✔ ' : ''}${esc(c.text)}<small>+${c.cash.toLocaleString('fr-FR')} €</small>${bar(c.progress / c.goal)}<span>${c.progress} / ${c.goal}</span></div>`;
    }
    h += `<div class="pp-row">🏆 Les 3 contrats : bonus 1 500 € · nouveaux contrats demain</div>`;
    const k = s.streak > 0 ? ((s.streak - 1) % 7) + 1 : 0;
    h += `<div class="pp-sec">SÉRIE DE CONNEXION 🔥</div><div class="pp-row">Jour ${k}/7 · demain : +${STREAK_REWARDS[k % 7].toLocaleString('fr-FR')} €${k === 6 ? ' + veste dorée exclusive' : ''}${bar(k / 7)}</div>`;
    if (this.others.length) {
      h += `<div class="pp-sec">CLASSEMENT DE LA PARTIE</div>`;
      const all = [s, ...this.others].sort((a, b) => b.rep - a.rep);
      all.forEach((p, i) => {
        const medal = ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`;
        h += `<div class="pp-row${p === s ? ' me' : ''}">${medal} ${p.crew ? `[${esc(p.crew.name)}] ` : ''}${esc(p.name)}<small>Niv. ${levelProgress(p.rep).level}${p.bounty > 0 ? ` · 🎯 ${p.bounty.toLocaleString('fr-FR')} €` : ''}</small></div>`;
      });
    }
    const wk = s.week;
    h += `<div class="pp-sec">TES RECORDS DE LA SEMAINE</div><div class="pp-row">Meilleur combo : <b>${wk.best.toLocaleString('fr-FR')}</b> · K.O. : <b>${wk.kos}</b><br>Joueurs K.O. : <b>${wk.pvp}</b> · primes : <b>${wk.bounties}</b> · braquages coop : <b>${wk.heists}</b></div>`;
    if (s.fenceOrder) h += `<div class="pp-sec">RECELEUR 💰</div><div class="pp-row">Il veut : <b>${esc(VEHICLES[s.fenceOrder].name)}</b>. Vole-la et amène-la au point 💰 de la carte. Une voiture dorée vaut une fortune.</div>`;
    this.panelBody.innerHTML = h;
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
      this.weaponIcon.textContent = WEAPONS[w].icon;
      this.attackIcon.textContent = WEAPONS[w].icon;
      this.attackLbl.textContent = WEAPONS[w].melee ? 'FRAPPER' : 'TIRER';
      this.attackBtn.classList.toggle('gun', !WEAPONS[w].melee);
    }
    const ammo = WEAPONS[w].melee ? WEAPONS[w].name : String(s.ammo[w]);
    if (this.changed('ammo', ammo)) this.weaponAmmo.textContent = ammo;
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
    // one progress bar for robberies and arrests
    const bar = s.arrest > 0.05 ? s.arrest : s.robbery;
    const barLabel = s.arrest > 0.05 ? 'ARRESTATION… BOUGE !' : 'BRAQUAGE';
    if (this.changed('rob', bar >= 0)) this.robbery.classList.toggle('hidden', bar < 0);
    if (this.changed('robLabel', barLabel)) (this.robbery.firstElementChild as HTMLElement).textContent = barLabel;
    if (bar >= 0) this.robberyBar.style.width = `${bar * 100}%`;
    const obj = s.mission ? s.objective : '';
    if (this.changed('obj', obj)) {
      this.objective.classList.toggle('hidden', !obj);
      this.objText.textContent = obj;
    }
    const t = s.mission && s.missionTimer >= 0 ? Math.ceil(s.missionTimer) : -1;
    if (this.changed('objTime', t)) {
      this.objTime.textContent = t >= 0 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : '';
      this.objTime.classList.toggle('hurry', t >= 0 && t <= 15);
    }
    if (this.changed('ko', s.dead)) this.ko.classList.toggle('hidden', !s.dead);
  }

  private tags = new Map<string, HTMLElement>();

  /** Nicknames floating above the other players. */
  setNameTags(tags: { id: string; name: string; sub?: string; color?: number; hunted?: boolean; x: number; y: number }[]) {
    const keep = new Set(tags.map((t) => t.id));
    for (const [id, el] of this.tags) {
      if (!keep.has(id)) {
        el.remove();
        this.tags.delete(id);
      }
    }
    for (const t of tags) {
      let el = this.tags.get(t.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'name-tag';
        $('hud').appendChild(el);
        this.tags.set(t.id, el);
      }
      const key = `${t.name}|${t.sub ?? ''}|${t.color ?? ''}|${t.hunted}`;
      if (el.dataset.key !== key) {
        el.dataset.key = key;
        el.textContent = t.name;
        el.style.borderColor = t.color !== undefined ? `#${t.color.toString(16).padStart(6, '0')}` : '';
        el.classList.toggle('hunted', !!t.hunted);
        if (t.sub) {
          const sub = document.createElement('small');
          sub.textContent = t.sub;
          el.appendChild(sub);
        }
      }
      el.style.transform = `translate(${t.x.toFixed(0)}px, ${t.y.toFixed(0)}px) translate(-50%, -100%)`;
    }
  }

  setPlayers(count: number, code: string | null) {
    const el = $('players');
    el.classList.toggle('hidden', !code);
    el.textContent = code ? `👥 ${count} · ${code}` : '';
  }

  /** Floating health bar at screen position (x, y) in px, or hidden when null. */
  setTargetBar(pos: { x: number; y: number; ratio: number } | null) {
    if (this.changed('tbar', !!pos)) this.targetHp.classList.toggle('hidden', !pos);
    if (!pos) return;
    this.targetHp.style.transform = `translate(${pos.x.toFixed(0)}px, ${pos.y.toFixed(0)}px)`;
    const w = `${Math.max(0, pos.ratio * 100).toFixed(0)}%`;
    if (this.changed('tfill', w)) this.targetFill.style.width = w;
  }

  /** Your own bounty: amount and time left to survive. */
  setBounty(amount: number, timer: number) {
    const el = $('bounty');
    if (this.changed('bountyOn', amount > 0)) el.classList.toggle('hidden', amount <= 0);
    if (amount <= 0) return;
    const t = Math.ceil(timer);
    const text = `🎯 Ta tête vaut ${amount.toLocaleString('fr-FR')} € · survis ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    if (this.changed('bountyTxt', text)) el.textContent = text;
  }

  updateZone(x: number, z: number, interior: string | null) {
    let name: string;
    if (interior) name = this.map.interiors.find((i) => i.id === interior)?.name ?? 'Intérieur';
    else name = this.map.zones.find((zn) => zn.kind !== 'river' && x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1)?.name ?? 'Belleplace';
    if (this.changed('zone', name)) this.zoneEl.textContent = name;
  }

  toast(text: string, seconds = Math.max(2.4, text.length / 16)) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = seconds;
  }

  setDebug(text: string) {
    this.fpsEl.textContent = text;
  }

  update(dt: number) {
    if (this.cashTimer > 0) {
      this.cashTimer -= dt;
      if (this.cashTimer <= 0) {
        this.chaosEl.classList.add('hidden');
        this.chaosEl.classList.remove('cash');
      }
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }
}
