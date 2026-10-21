import RAPIER from '@dimforge/rapier3d-compat';

let ready: Promise<typeof RAPIER> | null = null;

/** Loads the Rapier WASM once (works in the browser and in Node for tests / a future server). */
export function initPhysics(): Promise<typeof RAPIER> {
  if (!ready) ready = RAPIER.init().then(() => RAPIER);
  return ready;
}

export { RAPIER };

/** Collision groups: 16 bits membership << 16 | 16 bits filter. */
export const GROUP = {
  STATIC: 0x0001,
  PLAYER: 0x0002,
  QUERY: 0x0004,
  PED: 0x0008,
  VEHICLE: 0x0010,
  /** Trees, fountains: block movement but not the camera. */
  PROP: 0x0020,
  /** Breakable street furniture: blocks walkers, cars plow through it. */
  BREAKABLE: 0x0040,
};
export const groups = (membership: number, filter: number) => ((membership & 0xffff) << 16) | (filter & 0xffff);
