import type { VehicleType } from './vehicles';

/**
 * Things to spend money on. Each catalog is plain data: add a line to sell something new.
 */

/** Clothes: each item overrides part of the outfit (see Outfit). */
export interface ClothingItem {
  id: string;
  name: string;
  price: number;
  slot: 'top' | 'bottom' | 'shoes' | 'hat' | 'glasses' | 'hair';
  /** Values applied to the outfit when worn. */
  set: Partial<Outfit>;
}

/** What a player wears (overrides of the generated look). Serializable. */
export interface Outfit {
  top?: number;
  topAccent?: number;
  sleeves?: 'short' | 'long';
  bottom?: number;
  shoes?: number;
  hat?: 'none' | 'cap' | 'beanie';
  hatColor?: number;
  glasses?: boolean;
  hairStyle?: 'short' | 'buzz' | 'long' | 'ponytail' | 'afro' | 'bald' | 'mohawk';
  hair?: number;
}

export const CLOTHES: ClothingItem[] = [
  { id: 'hoodie_red', name: 'Sweat à capuche rouge', price: 120, slot: 'top', set: { top: 0xe63946, topAccent: 0xffffff, sleeves: 'long' } },
  { id: 'hoodie_black', name: 'Sweat noir', price: 120, slot: 'top', set: { top: 0x1b1b22, topAccent: 0xffd23f, sleeves: 'long' } },
  { id: 'tracksuit_blue', name: 'Survêt bleu', price: 180, slot: 'top', set: { top: 0x1e6fd9, topAccent: 0xffffff, sleeves: 'long' } },
  { id: 'tee_white', name: 'T-shirt blanc', price: 40, slot: 'top', set: { top: 0xf5f5f5, topAccent: 0x1b1430, sleeves: 'short' } },
  { id: 'tee_gold', name: 'Maillot doré', price: 350, slot: 'top', set: { top: 0xffc93c, topAccent: 0x1b1430, sleeves: 'short' } },
  // price -1: not sold, earned only (login streak day 7)
  { id: 'jacket_streak', name: 'Veste dorée de la série (exclusive)', price: -1, slot: 'top', set: { top: 0xffc93c, topAccent: 0x1b1430, sleeves: 'long' } },
  { id: 'leather', name: 'Veste en cuir', price: 600, slot: 'top', set: { top: 0x3b2418, topAccent: 0x9b6a3a, sleeves: 'long' } },
  { id: 'jeans', name: 'Jean brut', price: 90, slot: 'bottom', set: { bottom: 0x2f4f8f } },
  { id: 'jogger_black', name: 'Jogging noir', price: 80, slot: 'bottom', set: { bottom: 0x15151a } },
  { id: 'cargo', name: 'Pantalon cargo', price: 110, slot: 'bottom', set: { bottom: 0x6b6b3a } },
  { id: 'sneakers_white', name: 'Baskets blanches', price: 150, slot: 'shoes', set: { shoes: 0xf5f5f5 } },
  { id: 'sneakers_red', name: 'Baskets rouges', price: 170, slot: 'shoes', set: { shoes: 0xd63031 } },
  { id: 'cap_gold', name: 'Casquette dorée', price: 90, slot: 'hat', set: { hat: 'cap', hatColor: 0xffc93c } },
  { id: 'cap_black', name: 'Casquette noire', price: 60, slot: 'hat', set: { hat: 'cap', hatColor: 0x15151a } },
  { id: 'beanie_red', name: 'Bonnet rouge', price: 50, slot: 'hat', set: { hat: 'beanie', hatColor: 0xd63031 } },
  { id: 'no_hat', name: 'Tête nue', price: 0, slot: 'hat', set: { hat: 'none' } },
  { id: 'shades', name: 'Lunettes de soleil', price: 120, slot: 'glasses', set: { glasses: true } },
  { id: 'no_shades', name: 'Sans lunettes', price: 0, slot: 'glasses', set: { glasses: false } },
  { id: 'hair_afro', name: 'Coupe afro', price: 70, slot: 'hair', set: { hairStyle: 'afro' } },
  { id: 'hair_mohawk', name: 'Crête', price: 70, slot: 'hair', set: { hairStyle: 'mohawk', hair: 0xd63031 } },
  { id: 'hair_buzz', name: 'Coupe rase', price: 40, slot: 'hair', set: { hairStyle: 'buzz' } },
  { id: 'hair_long', name: 'Cheveux longs', price: 70, slot: 'hair', set: { hairStyle: 'long' } },
];

export interface VehicleOffer {
  type: VehicleType;
  price: number;
}

/** Car dealer: bought vehicles go to your garage (planque). */
export const VEHICLE_OFFERS: VehicleOffer[] = [
  { type: 'moto', price: 1500 },
  { type: 'compact', price: 4000 },
  { type: 'wagon', price: 6000 },
  { type: 'offroad', price: 12000 },
  { type: 'sports', price: 25000 },
];

/** Max vehicles stored in a garage. */
export const GARAGE_SLOTS = 4;

/** Apartments for sale (each one is a new hideout with wardrobe and garage). */
export const APARTMENT_PRICES: Record<string, number> = {
  apartment_rive: 20000,
  apartment_loft: 60000,
};
