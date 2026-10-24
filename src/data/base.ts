/**
 * Your hideout, built by you: furniture and equipment ("modules") placed on a 1 m grid.
 * Some modules do something (heal, keep your stuff safe, upgrade it, train, bank),
 * the rest is for show. Pure data: placement rules live in src/sim/base.ts.
 */

export type ModuleUse = 'bed' | 'locker' | 'bench' | 'board' | 'safe' | 'training';

/** A box of the module's model, in meters, relative to its footprint center (y = bottom). */
export interface ModuleBox {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
}

export interface ModuleDef {
  id: string;
  name: string;
  icon: string;
  /** Footprint in grid cells (1 m), before rotation. */
  w: number;
  d: number;
  price: number;
  level: number;
  use?: ModuleUse;
  /** What it does, shown in the build catalog. */
  desc: string;
  boxes: ModuleBox[];
}

const b = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number): ModuleBox => ({ x, y, z, sx, sy, sz, color });

export const MODULES: ModuleDef[] = [
  // ------------------------------------------------------------ useful
  {
    id: 'bed',
    name: 'Lit',
    icon: '🛏',
    w: 2,
    d: 3,
    price: 600,
    level: 1,
    use: 'bed',
    desc: 'Dors : soigne entièrement',
    boxes: [b(0, 0, 0, 1.9, 0.45, 2.8, 0x6b4423), b(0, 0.45, 0.2, 1.8, 0.2, 2.3, 0xf5f5f5), b(0, 0.45, -1.1, 1.6, 0.25, 0.5, 0xffffff), b(0, 0, -1.35, 1.9, 1.0, 0.1, 0x6b4423)],
  },
  {
    id: 'locker',
    name: 'Coffre à stuff',
    icon: '🧳',
    w: 1,
    d: 1,
    price: 1500,
    level: 1,
    use: 'locker',
    desc: 'Range 6 pièces de stuff : elles restent ici même si tu tombes',
    boxes: [b(0, 0, 0, 0.9, 0.6, 0.6, 0x6b4423), b(0, 0.6, 0, 0.92, 0.12, 0.62, 0x4a2e17), b(0, 0.3, 0.31, 0.15, 0.15, 0.02, 0xffd23f)],
  },
  {
    id: 'bench',
    name: 'Établi',
    icon: '🛠',
    w: 2,
    d: 1,
    price: 2500,
    level: 3,
    use: 'bench',
    desc: 'Améliore une pièce que tu portes (rareté +1)',
    boxes: [b(0, 0, 0, 1.9, 0.9, 0.8, 0x8a5a2b), b(0, 0.9, 0, 2, 0.08, 0.9, 0x5b3b22), b(-0.5, 0.98, 0, 0.3, 0.15, 0.2, 0x9aa3ad), b(0.5, 0.98, 0.1, 0.5, 0.05, 0.1, 0xd63031)],
  },
  {
    id: 'board',
    name: 'Tableau des coups',
    icon: '📌',
    w: 2,
    d: 1,
    price: 600,
    level: 1,
    use: 'board',
    desc: 'Montre ta prochaine mission de la Famille sur la carte',
    boxes: [b(0, 0.8, 0, 1.8, 1.2, 0.1, 0x7a5a3c), b(0, 0.9, 0.06, 1.6, 1.0, 0.02, 0xf2e2c0), b(-0.4, 1.1, 0.08, 0.3, 0.2, 0.01, 0xff3b4f), b(0.3, 0.8, 0.08, 0.4, 0.3, 0.01, 0x2f80ed), b(-0.7, 0, 0, 0.08, 0.8, 0.08, 0x3b2516), b(0.7, 0, 0, 0.08, 0.8, 0.08, 0x3b2516)],
  },
  {
    id: 'training',
    name: 'Sac de frappe',
    icon: '🥊',
    w: 1,
    d: 1,
    price: 1200,
    level: 2,
    use: 'training',
    desc: 'Entraîne-toi : +XP (toutes les 10 min)',
    boxes: [b(0, 0, 0, 0.6, 0.06, 0.6, 0x222831), b(0, 0.06, 0, 0.08, 2.2, 0.08, 0x555b66), b(0, 0.6, 0, 0.45, 1.1, 0.45, 0xd63031)],
  },
  {
    id: 'safe',
    name: 'Coffre-fort',
    icon: '🔐',
    w: 1,
    d: 1,
    price: 4000,
    level: 5,
    use: 'safe',
    desc: 'Ton compte en banque, depuis chez toi',
    boxes: [b(0, 0, 0, 0.9, 1.1, 0.8, 0x3c4048), b(0, 0.55, 0.41, 0.25, 0.25, 0.04, 0xc0c4cc)],
  },
  // ------------------------------------------------------------ for show
  { id: 'sofa', name: 'Canapé', icon: '🛋', w: 3, d: 1, price: 700, level: 1, desc: 'Pour recevoir ton crew', boxes: [b(0, 0, 0, 2.8, 0.45, 0.9, 0x8a4fff), b(0, 0.45, -0.35, 2.8, 0.5, 0.2, 0x7040e0), b(-1.3, 0.45, 0, 0.2, 0.25, 0.9, 0x7040e0), b(1.3, 0.45, 0, 0.2, 0.25, 0.9, 0x7040e0)] },
  { id: 'rug', name: 'Tapis', icon: '🟥', w: 3, d: 2, price: 200, level: 1, desc: 'Ça change tout', boxes: [b(0, 0, 0, 2.8, 0.02, 1.8, 0xd35400), b(0, 0.02, 0, 2.2, 0.01, 1.2, 0xf2c94c)] },
  { id: 'plant', name: 'Plante', icon: '🪴', w: 1, d: 1, price: 120, level: 1, desc: 'Un peu de vert', boxes: [b(0, 0, 0, 0.45, 0.45, 0.45, 0xb5651d), b(0, 0.45, 0, 0.7, 0.8, 0.7, 0x27ae60)] },
  { id: 'lamp', name: 'Lampe', icon: '💡', w: 1, d: 1, price: 250, level: 1, desc: 'Ambiance tamisée', boxes: [b(0, 0, 0, 0.4, 0.05, 0.4, 0x222831), b(0, 0.05, 0, 0.06, 1.5, 0.06, 0x222831), b(0, 1.5, 0, 0.5, 0.35, 0.5, 0xffe7a3)] },
  { id: 'tv', name: 'Grande télé', icon: '📺', w: 2, d: 1, price: 900, level: 1, desc: 'Pour les matchs', boxes: [b(0, 0, 0, 1.8, 0.5, 0.5, 0x2a2a30), b(0, 0.5, 0, 1.7, 1.0, 0.08, 0x111111), b(0, 0.55, 0.05, 1.6, 0.9, 0.01, 0x3fa7ff)] },
  { id: 'speaker', name: 'Enceinte', icon: '🔊', w: 1, d: 1, price: 600, level: 2, desc: 'Le son de la planque', boxes: [b(0, 0, 0, 0.6, 1.2, 0.5, 0x111111), b(0, 0.75, 0.26, 0.4, 0.4, 0.01, 0x555b66), b(0, 0.3, 0.26, 0.25, 0.25, 0.01, 0x555b66)] },
  { id: 'neon', name: 'Néon STREETZ', icon: '🌈', w: 2, d: 1, price: 1500, level: 4, desc: 'Ta planque, ton nom', boxes: [b(0, 1.6, 0, 1.8, 0.5, 0.06, 0xff3b9a), b(0, 1.45, 0, 1.6, 0.06, 0.06, 0x5ee8ff)] },
  { id: 'pool', name: 'Billard', icon: '🎱', w: 3, d: 2, price: 5000, level: 8, desc: 'La classe', boxes: [b(0, 0, 0, 2.4, 0.75, 1.4, 0x5b3b22), b(0, 0.75, 0, 2.3, 0.06, 1.3, 0x1e8449)] },
  { id: 'cash', name: 'Tas de billets', icon: '💸', w: 1, d: 1, price: 8000, level: 10, desc: 'Pour impressionner', boxes: [b(0, 0, 0, 0.8, 0.3, 0.6, 0x5ee86a), b(0.05, 0.3, 0, 0.6, 0.2, 0.5, 0x3fbf5a)] },
  { id: 'statue', name: 'Statue dorée', icon: '🗿', w: 1, d: 1, price: 20000, level: 15, desc: 'Réservée aux parrains', boxes: [b(0, 0, 0, 0.8, 0.4, 0.8, 0x222831), b(0, 0.4, 0, 0.5, 1.2, 0.4, 0xffc93c), b(0, 1.6, 0, 0.35, 0.35, 0.35, 0xffc93c)] },
];

export const moduleById = (id: string) => MODULES.find((m) => m.id === id);

/** One placed module: grid cell of its footprint corner and quarter turns. */
export interface Placed {
  m: string;
  x: number;
  z: number;
  r: number;
}

export const MAX_MODULES = 24;
/** Stuff kept in the locker (max pieces). */
export const LOCKER_SIZE = 6;
/** Workbench: price to upgrade a piece from rarity r to r + 1. */
export const UPGRADE_PRICE = [800, 2500, 7000];
/** Punching bag: XP and cooldown (seconds). */
export const TRAINING_XP = 40;
export const TRAINING_COOLDOWN = 600;

/** What every hideout starts with. */
export const STARTER_BASE: Placed[] = [
  { m: 'bed', x: 1, z: 1, r: 0 },
  { m: 'rug', x: 7, z: 6, r: 0 },
];
