/**
 * Hideout businesses: bought once, they produce cash every hour, even while you are
 * offline, up to a cap (8 h). Collecting means coming back to the hideout.
 */
export interface BusinessDef {
  id: string;
  name: string;
  price: number;
  /** € per hour. */
  rate: number;
}

export const BIZ_CAP_HOURS = 8;

export const BUSINESSES: BusinessDef[] = [
  { id: 'atelier', name: 'Atelier de pièces détachées', price: 8000, rate: 400 },
  { id: 'imprimerie', name: 'Imprimerie de faux billets', price: 25000, rate: 1200 },
  { id: 'garage', name: 'Garage clandestin', price: 60000, rate: 3000 },
];

export const businessById = (id: string) => BUSINESSES.find((b) => b.id === id);

/** Stock available at `now` (epoch seconds), capped. */
export function bizStock(b: { id: string; stock: number; last: number }, now: number): number {
  const def = businessById(b.id);
  if (!def || now <= 0 || b.last <= 0) return b.stock;
  const produced = (Math.max(0, now - b.last) / 3600) * def.rate;
  return Math.min(def.rate * BIZ_CAP_HOURS, Math.floor(b.stock + produced));
}

export const bizCap = (id: string) => (businessById(id)?.rate ?? 0) * BIZ_CAP_HOURS;
