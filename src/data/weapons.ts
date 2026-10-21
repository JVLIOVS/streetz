/** Weapon data. Add a weapon here; the sim and the HUD pick it up. */
export type WeaponId = 'fist' | 'pistol' | 'rifle';

export interface WeaponSpec {
  name: string;
  damage: number;
  /** Max distance (m). */
  range: number;
  /** Seconds between attacks. */
  cooldown: number;
  /** Half-angle of the auto-aim cone (radians). */
  aimCone: number;
  melee: boolean;
  /** Bullets given when picked up / bought. */
  ammoPack: number;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  fist: { name: 'Poings', damage: 26, range: 1.9, cooldown: 0.42, aimCone: 0.9, melee: true, ammoPack: 0 },
  pistol: { name: 'Pistolet', damage: 40, range: 38, cooldown: 0.28, aimCone: 0.55, melee: false, ammoPack: 60 },
  rifle: { name: "Fusil d'assaut", damage: 28, range: 55, cooldown: 0.11, aimCone: 0.45, melee: false, ammoPack: 150 },
};

export const WEAPON_ORDER: WeaponId[] = ['fist', 'pistol', 'rifle'];
