import * as THREE from 'three';
import type { PlayerAnim } from '../sim/player';
import { toon } from './materials';

export interface CharacterLook {
  skin: number;
  hair: number;
  top: number;
  bottom: number;
  shoes: number;
}

export const DEFAULT_LOOK: CharacterLook = {
  skin: 0xc68a5e,
  hair: 0x2b1d14,
  top: 0xff4f6d,
  bottom: 0x2f4f8f,
  shoes: 0xf2f2f2,
};

const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x15121c, side: THREE.BackSide });

/** Adds an inverted-hull outline (toon contour) to a mesh. */
function outlined(geo: THREE.BufferGeometry, mat: THREE.Material, outline = 0.035): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  const o = new THREE.Mesh(geo, OUTLINE);
  // Push the hull along the normals with a uniform scale; good enough on round shapes.
  geo.computeBoundingSphere();
  const r = geo.boundingSphere!.radius;
  o.scale.setScalar(1 + outline / Math.max(0.05, r));
  m.add(o);
  return m;
}

/**
 * Stylized character (big head, chunky limbs) built from primitives,
 * animated procedurally: idle, walk, run, jump, fall.
 */
export class CharacterView {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private torso: THREE.Group;
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private phase = 0;
  private blend = { lean: 0, bob: 0 };

  constructor(look: CharacterLook = DEFAULT_LOOK) {
    const skin = toon(look.skin);
    const hair = toon(look.hair);
    const top = toon(look.top);
    const bottom = toon(look.bottom);
    const shoes = toon(look.shoes);
    const dark = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });

    this.root.add(this.hips);
    this.hips.position.y = 0.92;

    // Torso (hoodie) + hips
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    const chest = outlined(new THREE.CapsuleGeometry(0.27, 0.32, 4, 10), top);
    chest.position.y = 0.33;
    chest.scale.set(1.08, 1, 0.8);
    const pelvis = outlined(new THREE.CapsuleGeometry(0.22, 0.08, 4, 10), bottom);
    pelvis.position.y = 0.02;
    pelvis.scale.set(1.1, 1, 0.85);
    this.torso.add(chest, pelvis);

    // Head
    this.head.position.y = 0.86;
    this.torso.add(this.head);
    const skull = outlined(new THREE.SphereGeometry(0.27, 16, 12), skin);
    const hairCap = outlined(new THREE.SphereGeometry(0.29, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0.02);
    hairCap.position.y = 0.04;
    hairCap.rotation.x = -0.25;
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), white);
      eye.position.set(sx * 0.1, 0.02, -0.235);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), dark);
      pupil.position.set(0, 0, -0.03);
      eye.add(pupil);
      this.head.add(eye);
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skin);
    nose.position.set(0, -0.05, -0.27);
    this.head.add(skull, hairCap, nose);

    // Arms: pivot at the shoulder
    for (const [arm, sx] of [
      [this.armL, -1],
      [this.armR, 1],
    ] as const) {
      arm.position.set(sx * 0.37, 0.55, 0);
      this.torso.add(arm);
      const sleeve = outlined(new THREE.CapsuleGeometry(0.1, 0.32, 4, 8), top);
      sleeve.position.y = -0.22;
      const hand = outlined(new THREE.SphereGeometry(0.095, 10, 8), skin);
      hand.position.y = -0.5;
      arm.add(sleeve, hand);
    }
    // Legs: pivot at the hip
    for (const [leg, sx] of [
      [this.legL, -1],
      [this.legR, 1],
    ] as const) {
      leg.position.set(sx * 0.13, 0, 0);
      this.hips.add(leg);
      const thigh = outlined(new THREE.CapsuleGeometry(0.12, 0.5, 4, 8), bottom);
      thigh.position.y = -0.42;
      const shoe = outlined(new THREE.BoxGeometry(0.2, 0.14, 0.34), shoes, 0.02);
      shoe.position.set(0, -0.86, -0.05);
      leg.add(thigh, shoe);
    }

    // Blob shadow, always visible (cheap and readable even with shadows off)
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.45, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    blob.renderOrder = 1;
    this.root.add(blob);
  }

  /** Called every rendered frame. */
  animate(anim: PlayerAnim, speed: number, dt: number, time: number) {
    const k = 1 - Math.exp(-12 * dt);
    let swing = 0;
    let lean = 0;
    let bob = 0;
    let armUp = 0;
    let legBend = 0;
    if (anim === 'walk' || anim === 'run') {
      this.phase += dt * (anim === 'run' ? 11 : 4 + speed * 1.2);
      const amp = anim === 'run' ? 0.95 : 0.55;
      swing = Math.sin(this.phase) * amp;
      lean = anim === 'run' ? 0.22 : 0.06;
      bob = Math.abs(Math.cos(this.phase)) * (anim === 'run' ? 0.09 : 0.04);
    } else if (anim === 'jump') {
      armUp = 2.4;
      legBend = 0.6;
      lean = -0.05;
    } else if (anim === 'fall') {
      armUp = 1.4;
      legBend = 0.3;
    } else {
      bob = Math.sin(time * 2) * 0.012;
    }
    this.blend.lean += (lean - this.blend.lean) * k;
    this.blend.bob += (bob - this.blend.bob) * k;
    this.hips.position.y = 0.92 + this.blend.bob;
    this.torso.rotation.x = -this.blend.lean;
    const lerp = (o: THREE.Object3D, x: number, z = 0) => {
      o.rotation.x += (x - o.rotation.x) * k;
      o.rotation.z += (z - o.rotation.z) * k;
    };
    lerp(this.legL, swing + legBend);
    lerp(this.legR, -swing - legBend * 0.3);
    lerp(this.armL, -swing * 0.9 + armUp * 0.5, -0.12 - armUp * 0.15);
    lerp(this.armR, swing * 0.9 + armUp * 0.5, 0.12 + armUp * 0.15);
    this.head.rotation.x = this.blend.lean * 0.5;
  }
}
