import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Runtime asset packs built by scripts/build-assets.mjs (all CC0, see docs/CREDITS.md). */
export interface GameAssets {
  character: GLTF;
  city: Map<string, THREE.Object3D>;
  vehicles: Map<string, THREE.Object3D>;
}

let cache: Promise<GameAssets> | null = null;

export function loadAssets(onProgress?: (ratio: number) => void): Promise<GameAssets> {
  if (cache) return cache;
  const loader = new GLTFLoader();
  const files = ['characters.glb', 'city.glb', 'vehicles.glb'];
  const done = new Array(files.length).fill(0);
  const report = () => onProgress?.(done.reduce((a, b) => a + b, 0) / files.length);
  const load = (f: string, i: number) =>
    loader.loadAsync(`./assets/${f}`, (e) => {
      if (e.total) done[i] = e.loaded / e.total;
      report();
    });
  cache = Promise.all(files.map(load)).then(([character, city, vehicles]) => ({
    character,
    city: byName(city),
    vehicles: byName(vehicles),
  }));
  return cache;
}

function byName(g: GLTF): Map<string, THREE.Object3D> {
  const m = new Map<string, THREE.Object3D>();
  // GLTFLoader de-duplicates names with a "_1" suffix when a mesh shares the node name
  for (const c of g.scene.children) {
    m.set(c.name, c);
    m.set(c.name.replace(/_\d+$/, ''), c);
  }
  return m;
}
