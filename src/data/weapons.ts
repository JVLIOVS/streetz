/** Weapon data. Add a weapon here; the sim, the shop and the HUD pick it up. */
export type WeaponId = 'fist' | 'shears' | 'knife' | 'baton' | 'bat' | 'sabre' | 'chainsaw' | 'pistol' | 'smg' | 'shotgun' | 'flamer' | 'rifle' | 'sniper';

export interface WeaponSpec {
  name: string;
  icon: string;
  damage: number;
  /** Max distance (m). */
  range: number;
  /** Seconds between attacks. */
  cooldown: number;
  /** Half-angle of the auto-aim cone (radians). */
  aimCone: number;
  melee: boolean;
  /** Bullets per shot (shotgun). */
  pellets?: number;
  /** Melee knock-back (m/s). */
  knock?: number;
  /** Flamethrower: burns everything in a short cone (ammo = fuel). */
  flame?: boolean;
  /** Animation played (upper body). */
  anim: 'punch' | 'stab' | 'swing' | 'shoot' | 'shoot2';
  /** Price at the gun shop (0 = not sold) and ammo pack. */
  price: number;
  ammoPack: number;
  ammoPrice: number;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  fist: { name: 'Poings', icon: '✊', damage: 26, range: 1.9, cooldown: 0.42, aimCone: 0.9, melee: true, anim: 'punch', price: 0, ammoPack: 0, ammoPrice: 0 },
  shears: { name: 'Sécateur', icon: '✂️', damage: 30, range: 1.8, cooldown: 0.32, aimCone: 0.9, melee: true, knock: 1, anim: 'stab', price: 120, ammoPack: 0, ammoPrice: 0 },
  knife: { name: 'Couteau', icon: '🔪', damage: 44, range: 1.8, cooldown: 0.45, aimCone: 0.9, melee: true, knock: 1.5, anim: 'stab', price: 150, ammoPack: 0, ammoPrice: 0 },
  baton: { name: 'Matraque', icon: '🏒', damage: 36, range: 2.1, cooldown: 0.55, aimCone: 0.9, melee: true, knock: 3, anim: 'swing', price: 200, ammoPack: 0, ammoPrice: 0 },
  bat: { name: 'Batte de baseball', icon: '🏏', damage: 55, range: 2.3, cooldown: 0.7, aimCone: 0.9, melee: true, knock: 6, anim: 'swing', price: 280, ammoPack: 0, ammoPrice: 0 },
  sabre: { name: 'Sabre', icon: '🗡️', damage: 75, range: 2.5, cooldown: 0.5, aimCone: 1.0, melee: true, knock: 5, anim: 'swing', price: 900, ammoPack: 0, ammoPrice: 0 },
  chainsaw: { name: 'Tronçonneuse', icon: '🪚', damage: 24, range: 2.1, cooldown: 0.14, aimCone: 0.9, melee: true, knock: 1.5, anim: 'stab', price: 1500, ammoPack: 0, ammoPrice: 0 },
  pistol: { name: 'Pistolet', icon: '🔫', damage: 40, range: 38, cooldown: 0.28, aimCone: 0.55, melee: false, anim: 'shoot', price: 600, ammoPack: 36, ammoPrice: 120 },
  smg: { name: 'Mitraillette', icon: '💥', damage: 18, range: 30, cooldown: 0.085, aimCone: 0.5, melee: false, anim: 'shoot2', price: 2400, ammoPack: 150, ammoPrice: 250 },
  shotgun: { name: 'Fusil à pompe', icon: '🧨', damage: 20, range: 18, cooldown: 0.9, aimCone: 0.6, melee: false, pellets: 6, anim: 'shoot2', price: 1800, ammoPack: 24, ammoPrice: 200 },
  flamer: { name: 'Lance-flammes', icon: '🔥', damage: 7, range: 9, cooldown: 0.07, aimCone: 0.5, melee: false, flame: true, anim: 'shoot2', price: 3500, ammoPack: 200, ammoPrice: 300 },
  // not sold: rented at rooftop sniper spots, returned when you leave the roof
  sniper: { name: 'Fusil de précision', icon: '🔭', damage: 160, range: 150, cooldown: 1.1, aimCone: 0.16, melee: false, anim: 'shoot2', price: 0, ammoPack: 12, ammoPrice: 0 },
  rifle: { name: "Fusil d'assaut", icon: '🎯', damage: 28, range: 55, cooldown: 0.11, aimCone: 0.45, melee: false, anim: 'shoot2', price: 5000, ammoPack: 150, ammoPrice: 400 },
};

export const WEAPON_ORDER: WeaponId[] = ['fist', 'shears', 'knife', 'baton', 'bat', 'sabre', 'chainsaw', 'pistol', 'smg', 'shotgun', 'flamer', 'rifle', 'sniper'];

/** Bulletproof vest at the gun shop. */
export const ARMOR_PRICE = 400;
