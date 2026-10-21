import type { MapData } from './types';

/**
 * Every map is a separate module loaded on demand (separate JS chunk).
 * Future maps (Amérique latine, Afrique, île, Asie) are added here.
 */
export const MAPS: Record<string, { name: string; available: boolean; load?: () => Promise<{ default: MapData }> }> = {
  paris: { name: 'Paris', available: true, load: () => import('./paris/index') },
  latam: { name: 'Amérique latine', available: false },
  africa: { name: 'Afrique', available: false },
  island: { name: 'Île', available: false },
  asia: { name: 'Asie', available: false },
};

export async function loadMap(id: string): Promise<MapData> {
  const entry = MAPS[id];
  if (!entry?.available || !entry.load) throw new Error(`Map "${id}" bientôt disponible`);
  return (await entry.load()).default;
}
