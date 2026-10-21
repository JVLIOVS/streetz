import type { InteriorDef } from '../maps/types';

/**
 * Interior rooms described as boxes (pure data): the sim builds colliders from them
 * and the renderer builds meshes from the very same list. y = box center.
 */
export interface RoomBox {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
  /** Purely visual (products on shelves, rugs...). */
  deco?: boolean;
}

export const ROOM_H = 4.6;

export interface RoomLayout {
  boxes: RoomBox[];
  /** Where the player appears when entering (facing -z, into the room). */
  spawn: { x: number; z: number };
  /** Exit trigger, against the +z wall. */
  exit: { x: number; z: number };
  /** Counter position (robbery spot) and the clerk behind it. */
  counter: { x: number; z: number } | null;
  clerk: { x: number; z: number } | null;
}

const PALETTE: Record<InteriorDef['kind'], { floor: number; wall: number; trim: number; counter: number }> = {
  shop: { floor: 0xe9e4d8, wall: 0xfff3d6, trim: 0x2ec95a, counter: 0xd35400 },
  bank: { floor: 0xd8cfc0, wall: 0xf3ead8, trim: 0x2a3f66, counter: 0x6b4423 },
  jewelry: { floor: 0x2b2440, wall: 0xf1e6ff, trim: 0xb56cff, counter: 0xffffff },
  police: { floor: 0xc9d1dc, wall: 0xe6edf5, trim: 0x2f6fe0, counter: 0x3c4a66 },
  hospital: { floor: 0xe8f1f2, wall: 0xffffff, trim: 0xff4057, counter: 0xdfe7ea },
  hideout: { floor: 0x7a5a3c, wall: 0xd9c3a1, trim: 0x3b2516, counter: 0x5b3b22 },
};

const PRODUCTS = [0xff4f6d, 0xffd23f, 0x2f80ed, 0x27ae60, 0xf2994a, 0x9b51e0, 0x56ccf2];

export function roomLayout(def: InteriorDef): RoomLayout {
  const { x: ox, z: oz } = def.origin;
  const w = def.w;
  const d = def.d;
  const pal = PALETTE[def.kind];
  const t = 0.4;
  const boxes: RoomBox[] = [
    { x: ox, y: -0.5, z: oz, sx: w + 2 * t, sy: 1, sz: d + 2 * t, color: pal.floor },
    { x: ox, y: ROOM_H + 0.25, z: oz, sx: w + 2 * t, sy: 0.5, sz: d + 2 * t, color: 0xf7f2e8 },
    { x: ox - w / 2 - t / 2, y: ROOM_H / 2, z: oz, sx: t, sy: ROOM_H, sz: d + 2 * t, color: pal.wall },
    { x: ox + w / 2 + t / 2, y: ROOM_H / 2, z: oz, sx: t, sy: ROOM_H, sz: d + 2 * t, color: pal.wall },
    { x: ox, y: ROOM_H / 2, z: oz - d / 2 - t / 2, sx: w, sy: ROOM_H, sz: t, color: pal.wall },
    { x: ox, y: ROOM_H / 2, z: oz + d / 2 + t / 2, sx: w, sy: ROOM_H, sz: t, color: pal.wall },
    // colored skirting band
    { x: ox, y: 0.3, z: oz - d / 2 + 0.05, sx: w, sy: 0.6, sz: 0.1, color: pal.trim, deco: true },
    // door (visual, on the +z wall)
    { x: ox, y: 1.25, z: oz + d / 2 - 0.05, sx: 1.8, sy: 2.5, sz: 0.1, color: 0x2a2233, deco: true },
  ];
  let counter: RoomLayout['counter'] = null;
  let clerk: RoomLayout['clerk'] = null;
  const cz = oz - d / 2 + 3.2;
  if (def.kind !== 'hideout') {
    boxes.push({ x: ox, y: 0.55, z: cz, sx: Math.min(8, w * 0.55), sy: 1.1, sz: 1.0, color: pal.counter });
    boxes.push({ x: ox, y: 1.12, z: cz, sx: Math.min(8, w * 0.55) + 0.2, sy: 0.06, sz: 1.2, color: 0xf5f5f5, deco: true });
    counter = { x: ox, z: cz + 1.4 };
    clerk = { x: ox, z: cz - 1.3 };
  }
  if (def.kind === 'shop') {
    // Three aisles of shelves full of colorful products
    for (let k = 0; k < 3; k++) {
      const x = ox - w / 2 + 2.5 + k * ((w - 5) / 2);
      const z = oz + 1.5;
      boxes.push({ x, y: 0.8, z, sx: 1.0, sy: 1.6, sz: 5, color: 0xdcdcdc });
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 6; i++) {
          boxes.push({ x: x + (i % 2 ? 0.3 : -0.3), y: 0.35 + row * 0.5, z: z - 2.1 + i * 0.85, sx: 0.45, sy: 0.32, sz: 0.6, color: PRODUCTS[(k * 7 + row * 3 + i) % PRODUCTS.length], deco: true });
        }
      }
    }
    // Fridge wall
    boxes.push({ x: ox + w / 2 - 0.6, y: 1.1, z: oz - 1, sx: 1.0, sy: 2.2, sz: 6, color: 0x9fd8ff });
  } else if (def.kind === 'bank') {
    // Big vault door at the back, columns and benches
    boxes.push({ x: ox + w / 2 - 3, y: 1.6, z: oz - d / 2 + 0.3, sx: 3.2, sy: 3.2, sz: 0.4, color: 0x9aa3ad });
    boxes.push({ x: ox + w / 2 - 3, y: 1.6, z: oz - d / 2 + 0.55, sx: 1.2, sy: 1.2, sz: 0.2, color: 0xd4af37, deco: true });
    for (const sx of [-1, 1]) for (const sz of [-0.15, 0.25]) boxes.push({ x: ox + sx * w * 0.32, y: ROOM_H / 2, z: oz + sz * d, sx: 0.9, sy: ROOM_H, sz: 0.9, color: 0xf7f2e8 });
    boxes.push({ x: ox, y: 0.01, z: oz + 2, sx: 3, sy: 0.02, sz: d * 0.6, color: 0xb03030, deco: true });
  } else if (def.kind === 'jewelry') {
    for (let k = 0; k < 4; k++) {
      const x = ox - w / 2 + 2 + (k % 2) * (w - 4);
      const z = oz - 0.5 + Math.floor(k / 2) * 3.5;
      boxes.push({ x, y: 0.5, z, sx: 1.2, sy: 1.0, sz: 2.4, color: 0x2b2440 });
      boxes.push({ x, y: 1.15, z, sx: 1.1, sy: 0.3, sz: 2.3, color: 0xd6f4ff, deco: true });
      boxes.push({ x, y: 1.05, z, sx: 0.2, sy: 0.12, sz: 0.2, color: 0xffd23f, deco: true });
    }
  } else if (def.kind === 'hideout') {
    boxes.push({ x: ox - w / 2 + 1.5, y: 0.3, z: oz - d / 2 + 2, sx: 2.2, sy: 0.6, sz: 3.2, color: 0x3d5a80 }); // bed
    boxes.push({ x: ox + 2, y: 0.45, z: oz - 1, sx: 3.5, sy: 0.9, sz: 1.5, color: 0x8a4fff }); // sofa
    boxes.push({ x: ox + 2, y: 1.6, z: oz - d / 2 + 0.3, sx: 3, sy: 1.7, sz: 0.2, color: 0x111111, deco: true }); // TV
    boxes.push({ x: ox - 2, y: 0.01, z: oz, sx: 4, sy: 0.02, sz: 3, color: 0xd35400, deco: true }); // rug
  } else {
    // police / hospital waiting rooms: rows of chairs
    for (let k = 0; k < 4; k++) boxes.push({ x: ox - w / 2 + 2 + k * 1.2, y: 0.25, z: oz + 2, sx: 0.9, sy: 0.5, sz: 0.9, color: pal.trim });
  }
  return {
    boxes,
    spawn: { x: ox, z: oz + d / 2 - 1.8 },
    exit: { x: ox, z: oz + d / 2 - 0.6 },
    counter,
    clerk,
  };
}
