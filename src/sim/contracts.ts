import { ALL_CONTRACTS_BONUS, dailyContracts, FENCE_PRICES, FENCE_SCRAP, FENCE_SPOT, GOLD_PAINT, GOLD_PRICE, STREAK_CLOTH, STREAK_REWARDS, type ContractStat } from '../data/contracts';
import { VEHICLES, type VehicleType } from '../data/vehicles';
import { bizStock } from '../data/business';
import { weekOf } from '../data/social';
import { emptyWeek } from './player';
import type { ContextAction, Player } from './player';
import type { SimWorld } from './world';

const FENCE_RADIUS = 9;
const ORDERS = Object.keys(FENCE_PRICES) as VehicleType[];

/**
 * Daily contracts, login streak and the fence (receleur) who orders specific cars.
 * The current day comes from outside (`SimWorld.day`), the sim never reads the clock.
 */
export class ContractSystem {
  /** Fence drop-off point, on the road. */
  readonly fence: { x: number; z: number };
  private notified = new Set<string>();

  constructor(private w: SimWorld) {
    let best = { x: FENCE_SPOT.x, z: FENCE_SPOT.z };
    let bd = Infinity;
    for (const l of w.lanes.lanes) {
      const x = (l.ax + l.bx) / 2;
      const z = (l.az + l.bz) / 2;
      const d = Math.hypot(x - FENCE_SPOT.x, z - FENCE_SPOT.z);
      if (d < bd && l.speed < 20) {
        bd = d;
        best = { x, z };
      }
    }
    this.fence = best;
  }

  update() {
    if (this.w.tick % 30 !== 0) return;
    for (const p of this.w.players.values()) {
      const s = p.state;
      if (!s.fenceOrder) s.fenceOrder = ORDERS[this.w.rng.int(0, ORDERS.length - 1)];
      if (this.w.day <= 0) continue;
      if (s.week.id !== weekOf(this.w.day)) s.week = emptyWeek(weekOf(this.w.day));
      if (s.contractsDay !== this.w.day) {
        s.contractsDay = this.w.day;
        s.contracts = dailyContracts(this.w.day);
      }
      if (s.streakDay !== this.w.day) this.login(p);
      // businesses produced while you were away: come and collect
      if (this.w.now > 0 && !this.notified.has(s.id) && s.biz.length) {
        this.notified.add(s.id);
        const total = s.biz.reduce((a, b) => a + bizStock(b, this.w.now), 0);
        if (total > 0) this.w.toast(p, `💼 Tes business ont produit ${total.toLocaleString('fr-FR')} € : passe les encaisser à ta planque`);
      }
    }
  }

  /** Counts progress on today's contracts (`max`: keep the best value instead of adding). */
  track(p: Player, stat: ContractStat, amount: number, max = false) {
    const s = p.state;
    let finished = false;
    for (const c of s.contracts) {
      if (c.stat !== stat || c.progress >= c.goal) continue;
      c.progress = Math.min(c.goal, max ? Math.max(c.progress, amount) : c.progress + amount);
      if (c.progress < c.goal) continue;
      finished = true;
      const cash = Math.round(c.cash * this.w.family.pay(p));
      s.money += cash;
      this.w.events.push({ type: 'contract', playerId: s.id, text: c.text, cash, all: false });
      this.w.toast(p, `📋 Contrat réussi : ${c.text} · +${cash.toLocaleString('fr-FR')} €`);
      this.w.progress.addXp(p, c.xp);
    }
    if (finished && s.contracts.length > 0 && s.contracts.every((c) => c.progress >= c.goal)) {
      s.money += ALL_CONTRACTS_BONUS.cash;
      this.w.events.push({ type: 'contract', playerId: s.id, text: 'Tous les contrats du jour', cash: ALL_CONTRACTS_BONUS.cash, all: true });
      this.w.toast(p, `🏆 Tous les contrats du jour ! Bonus +${ALL_CONTRACTS_BONUS.cash.toLocaleString('fr-FR')} € — reviens demain pour 3 nouveaux`);
      this.w.progress.addXp(p, ALL_CONTRACTS_BONUS.xp);
    }
  }

  /** First session of the day: the streak grows (or slips back one day if a day was missed). */
  private login(p: Player) {
    const s = p.state;
    const day = this.w.day;
    if (s.streakDay === day - 1) s.streak++;
    else if (s.streakDay > 0) s.streak = Math.max(1, s.streak - 1);
    else s.streak = 1;
    s.streakDay = day;
    const k = ((s.streak - 1) % 7) + 1;
    const cash = STREAK_REWARDS[k - 1];
    s.money += cash;
    let extra = '';
    if (k === 7 && !s.clothes.includes(STREAK_CLOTH)) {
      s.clothes.push(STREAK_CLOTH);
      extra = ' + Veste dorée exclusive (garde-robe)';
    }
    this.w.events.push({ type: 'streak', playerId: s.id, day: k, cash });
    this.w.toast(p, `🔥 Série de connexion : jour ${k}/7 · +${cash.toLocaleString('fr-FR')} €${extra}`);
  }

  // ------------------------------------------------------------------ fence

  /** Price the fence pays for this car (0 if it can't be sold). */
  price(p: Player, vehicleId: number): number {
    const v = this.w.vehicles.get(vehicleId);
    if (!v || v.state.wrecked || v.police || v.state.type === 'army') return 0;
    const cond = 0.4 + 0.6 * Math.max(0, v.state.health / v.spec.health);
    if (v.state.paint === GOLD_PAINT) return Math.round(GOLD_PRICE * cond);
    if (v.state.type === p.state.fenceOrder) return Math.round((FENCE_PRICES[v.state.type] ?? FENCE_SCRAP) * cond);
    return FENCE_SCRAP;
  }

  context(p: Player): ContextAction | null {
    const s = p.state;
    if (s.vehicle < 0 || Math.hypot(this.fence.x - s.x, this.fence.z - s.z) > FENCE_RADIUS) return null;
    const price = this.price(p, s.vehicle);
    if (!price) return null;
    return { kind: 'fence', label: `Vendre · ${price.toLocaleString('fr-FR')} €`, target: s.vehicle };
  }

  sell(p: Player) {
    const s = p.state;
    const id = s.vehicle;
    const v = this.w.vehicles.get(id);
    const price = this.price(p, id);
    if (!v || !price || Math.hypot(this.fence.x - s.x, this.fence.z - s.z) > FENCE_RADIUS) return;
    const ordered = v.state.type === s.fenceOrder || v.state.paint === GOLD_PAINT;
    this.w.leaveVehicleOf(p);
    this.w.removeVehicle(id);
    s.money += price;
    this.w.events.push({ type: 'money', playerId: s.id, amount: price });
    if (ordered) {
      this.w.progress.addXp(p, v.state.paint === GOLD_PAINT ? 200 : 30);
      this.track(p, 'fence', 1);
      s.fenceOrder = ORDERS[this.w.rng.int(0, ORDERS.length - 1)];
      this.w.toast(p, `💰 Le receleur est ravi. Prochaine commande : ${VEHICLES[s.fenceOrder].name}`);
    } else this.w.toast(p, `Casse auto : ${price} €. Le receleur veut une ${VEHICLES[s.fenceOrder!].name}`);
  }
}
