/**
 * Vehicle catalogue. `model` refers to a node of public/assets/city.glb (KayKit)
 * or vehicles.glb (Kenney). Physics values are arcade-tuned.
 */
export type VehicleType = 'compact' | 'sports' | 'wagon' | 'taxi' | 'police' | 'offroad' | 'moto' | 'army' | 'minicopter';

export interface VehicleSpec {
  name: string;
  model: string;
  pack: 'city' | 'vehicles';
  /** Model scale to reach real-world size. */
  scale: number;
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  /** m/s² */
  accel: number;
  /** m/s */
  maxSpeed: number;
  reverseSpeed: number;
  brake: number;
  /** Max wheel angle (rad). */
  steer: number;
  /** Lateral grip (higher = less drift). */
  grip: number;
  /** Max climbable slope (degrees). */
  climb: number;
  health: number;
  /** Seat height for the driver animation. */
  seatY: number;
  twoWheels?: boolean;
  /** How fast the wheel turns towards the stick (1/s). Lower = smoother. */
  steerRate?: number;
  /** Flies (mini-helicopter): gas = up, brake = down, stick = move and turn. */
  fly?: boolean;
}

export const VEHICLES: Record<VehicleType, VehicleSpec> = {
  compact: { name: 'Citadine', model: 'car_hatchback', pack: 'city', scale: 4.6, length: 3.7, width: 1.9, height: 1.6, wheelbase: 2.3, accel: 9, maxSpeed: 30, reverseSpeed: 8, brake: 22, steer: 0.6, grip: 9, climb: 32, health: 100, seatY: 0.35 },
  sports: { name: 'Berline sport', model: 'car_sedan', pack: 'city', scale: 4.6, length: 4.3, width: 1.9, height: 1.6, wheelbase: 2.7, accel: 14, maxSpeed: 44, reverseSpeed: 9, brake: 26, steer: 0.55, grip: 8, climb: 30, health: 110, seatY: 0.35 },
  wagon: { name: 'Break', model: 'car_stationwagon', pack: 'city', scale: 4.6, length: 4.3, width: 1.9, height: 1.6, wheelbase: 2.7, accel: 9.5, maxSpeed: 33, reverseSpeed: 8, brake: 22, steer: 0.55, grip: 9, climb: 30, health: 120, seatY: 0.35 },
  taxi: { name: 'Taxi', model: 'car_taxi', pack: 'city', scale: 4.6, length: 4.3, width: 1.9, height: 1.8, wheelbase: 2.7, accel: 10, maxSpeed: 35, reverseSpeed: 8, brake: 22, steer: 0.55, grip: 9, climb: 30, health: 110, seatY: 0.35 },
  police: { name: 'Voiture de police', model: 'car_police', pack: 'city', scale: 4.6, length: 4.3, width: 1.9, height: 1.8, wheelbase: 2.7, accel: 13, maxSpeed: 42, reverseSpeed: 9, brake: 26, steer: 0.55, grip: 9.5, climb: 30, health: 140, seatY: 0.35 },
  offroad: { name: '4×4', model: 'vehicle-truck-red', pack: 'vehicles', scale: 1.6, length: 4.5, width: 2.4, height: 2.2, wheelbase: 2.9, accel: 12, maxSpeed: 34, reverseSpeed: 10, brake: 24, steer: 0.55, grip: 10, climb: 50, health: 180, seatY: 0.75 },
  army: { name: 'Camion militaire', model: 'vehicle-truck-green', pack: 'vehicles', scale: 1.8, length: 5, width: 2.7, height: 2.5, wheelbase: 3.2, accel: 11, maxSpeed: 30, reverseSpeed: 8, brake: 22, steer: 0.5, grip: 11, climb: 50, health: 420, seatY: 0.85 },
  moto: { name: 'Scooter', model: 'vehicle-motorcycle', pack: 'vehicles', scale: 0.9, length: 2.2, width: 0.9, height: 1.2, wheelbase: 1.9, accel: 12, maxSpeed: 34, reverseSpeed: 4, brake: 24, steer: 0.36, grip: 10, climb: 34, health: 60, seatY: 0.45, twoWheels: true, steerRate: 3.5 },
  minicopter: { name: 'Mini-hélico', model: '', pack: 'vehicles', scale: 1, length: 4.4, width: 2.2, height: 2.3, wheelbase: 2.6, accel: 8, maxSpeed: 24, reverseSpeed: 6, brake: 10, steer: 0.5, grip: 4, climb: 70, health: 160, seatY: 0.6, fly: true },
};

/** Weighted pick for traffic / parked cars. */
export const TRAFFIC_MIX: [VehicleType, number][] = [
  ['compact', 4],
  ['wagon', 3],
  ['taxi', 2],
  ['sports', 1.5],
  ['offroad', 1],
  ['moto', 1],
];
