import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Rng } from '../core/rng';
import { toonGradient } from './materials';

/**
 * Humans are the CC0 KayKit mannequin (Rig_Medium) "dressed" procedurally:
 * per-vertex colors by bone region (skin / top / bottom / shoes) plus hair,
 * caps and a face merged into the same skinned geometry → 1 draw call per human.
 */

export type HairStyle = 'short' | 'buzz' | 'long' | 'ponytail' | 'afro' | 'bald' | 'mohawk';
export type HatStyle = 'none' | 'cap' | 'beanie';

export interface HumanLook {
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  hat: HatStyle;
  hatColor: number;
  top: number;
  topAccent: number;
  sleeves: 'short' | 'long';
  bottom: number;
  shoes: number;
  beard: boolean;
  glasses: boolean;
  /** Body proportions. */
  height: number;
  width: number;
}

export const SKIN_TONES = [0xf5d0b0, 0xe8b48c, 0xc68a5e, 0x9c6640, 0x6e4426, 0x4a2c18];
const HAIR_COLORS = [0x1c1410, 0x3b2516, 0x6a4022, 0xb07a3c, 0xe0c070, 0x8a8a8a, 0xc0392b];
const TOPS = [0xff4f6d, 0x2f80ed, 0xf2c94c, 0x27ae60, 0x9b51e0, 0xffffff, 0x222831, 0xf2994a, 0x56ccf2, 0xeb5757];
const BOTTOMS = [0x2f4f8f, 0x1f2933, 0x6b4f3a, 0x4a5568, 0x2d3748, 0xc2b280, 0x111111];
const SHOES = [0xf5f5f5, 0x111111, 0xd64545, 0x2d9cdb, 0x8b5a2b];

export const DEFAULT_LOOK: HumanLook = {
  skin: SKIN_TONES[2],
  hair: HAIR_COLORS[0],
  hairStyle: 'short',
  hat: 'cap',
  hatColor: 0xffd23f,
  top: 0xff3b6b,
  topAccent: 0xffffff,
  sleeves: 'short',
  bottom: 0x2f4f8f,
  shoes: 0xf5f5f5,
  beard: false,
  glasses: false,
  height: 1,
  width: 1,
};

export function randomLook(seed: number): HumanLook {
  const r = new Rng(seed);
  const female = r.chance(0.5);
  const hairStyle: HairStyle = female ? r.pick(['long', 'ponytail', 'afro', 'short'] as const) : r.pick(['short', 'buzz', 'bald', 'afro', 'mohawk', 'short'] as const);
  return {
    skin: r.pick(SKIN_TONES),
    hair: r.pick(HAIR_COLORS),
    hairStyle,
    hat: r.chance(0.25) ? r.pick(['cap', 'beanie'] as const) : 'none',
    hatColor: r.pick(TOPS),
    top: r.pick(TOPS),
    topAccent: r.pick(TOPS),
    sleeves: r.chance(0.5) ? 'short' : 'long',
    bottom: r.pick(BOTTOMS),
    shoes: r.pick(SHOES),
    beard: !female && r.chance(0.3),
    glasses: r.chance(0.15),
    height: female ? r.range(0.92, 1.0) : r.range(0.97, 1.06),
    width: r.range(0.92, 1.12),
  };
}

/** Uniforms for law enforcement (skin and build still vary with the seed). */
export function roleLook(role: 'cop' | 'swat' | 'soldier', seed: number): HumanLook {
  const base = randomLook(seed);
  const common = { beard: false, glasses: role === 'swat', sleeves: 'long' as const, shoes: 0x111111 };
  if (role === 'cop') return { ...base, ...common, top: 0x1f3a7a, topAccent: 0xf2f2f2, bottom: 0x1a2440, hat: 'cap', hatColor: 0x16244a, hairStyle: 'short' };
  if (role === 'swat') return { ...base, ...common, top: 0x1c1c22, topAccent: 0xffd23f, bottom: 0x1c1c22, hat: 'beanie', hatColor: 0x111111, hairStyle: 'buzz' };
  return { ...base, ...common, top: 0x4b5d32, topAccent: 0x3a4a26, bottom: 0x3f4f2a, hat: 'beanie', hatColor: 0x3b4a2a, hairStyle: 'buzz' };
}

// --------------------------------------------------------------------------- template

interface Template {
  /** Rig root (contains bones), cloned per human. */
  rig: THREE.Object3D;
  parts: THREE.SkinnedMesh[];
  boneIndex: Map<string, number>;
  headBox: THREE.Box3;
  clips: Map<string, THREE.AnimationClip>;
  upper: Map<string, THREE.AnimationClip>;
  lower: Map<string, THREE.AnimationClip>;
}

const UPPER_BONES = new Set(['spine', 'chest', 'head', 'upperarm.l', 'lowerarm.l', 'wrist.l', 'hand.l', 'upperarm.r', 'lowerarm.r', 'wrist.r', 'hand.r']);
// three.js strips dots from node names
const norm = (n: string) => n.replace(/\./g, '');
const UPPER = new Set([...UPPER_BONES].map(norm));

let template: Template | null = null;

function buildTemplate(gltf: GLTF): Template {
  const rig = gltf.scene.getObjectByName('Rig_Medium') ?? gltf.scene;
  rig.updateMatrixWorld(true);
  const parts: THREE.SkinnedMesh[] = [];
  rig.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) parts.push(o as THREE.SkinnedMesh);
  });
  const skeleton = parts[0].skeleton;
  const boneIndex = new Map(skeleton.bones.map((b, i) => [b.name, i]));
  const headPart = parts.find((p) => /Head/.test(p.name))!;
  headPart.geometry.computeBoundingBox();
  const headBox = headPart.geometry.boundingBox!.clone();

  const clips = new Map(gltf.animations.map((c) => [c.name, c]));
  const upper = new Map<string, THREE.AnimationClip>();
  const lower = new Map<string, THREE.AnimationClip>();
  for (const c of gltf.animations) {
    const isUpper = (t: THREE.KeyframeTrack) => UPPER.has(t.name.split('.')[0]);
    upper.set(c.name, new THREE.AnimationClip(c.name + '_up', c.duration, c.tracks.filter(isUpper)));
    lower.set(c.name, new THREE.AnimationClip(c.name + '_low', c.duration, c.tracks.filter((t) => !isUpper(t))));
  }
  return { rig, parts, boneIndex, headBox, clips, upper, lower };
}

export function initHumans(gltf: GLTF) {
  template = buildTemplate(gltf);
}

// --------------------------------------------------------------------------- dressing

const _c = new THREE.Color();

function regionOf(bone: string): 'skin' | 'top' | 'sleeve' | 'forearm' | 'bottom' | 'shoes' | 'head' {
  if (bone === 'head') return 'head';
  if (bone.startsWith('hand') || bone.startsWith('wrist')) return 'skin';
  if (bone.startsWith('lowerarm')) return 'forearm';
  if (bone.startsWith('upperarm')) return 'sleeve';
  if (bone === 'chest' || bone === 'spine') return 'top';
  if (bone.startsWith('foot') || bone.startsWith('toes')) return 'shoes';
  return 'bottom'; // hips, legs, root
}

function colorizePart(geo: THREE.BufferGeometry, look: HumanLook, bones: THREE.Bone[]) {
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // dominant bone
    let best = 0;
    let bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > bw) {
        bw = w;
        best = si.getComponent(i, k);
      }
    }
    const reg = regionOf(norm(bones[best]?.name ?? 'hips'));
    let hex: number;
    switch (reg) {
      case 'head':
      case 'skin':
        hex = look.skin;
        break;
      case 'forearm':
        hex = look.sleeves === 'long' ? look.top : look.skin;
        break;
      case 'sleeve':
        hex = look.top;
        break;
      case 'top':
        hex = look.top;
        break;
      case 'shoes':
        hex = look.shoes;
        break;
      default:
        hex = look.bottom;
    }
    _c.setHex(hex);
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** Converts a non-skinned accessory (in bind space) into a geometry rigidly skinned to one bone. */
function rigid(geo: THREE.BufferGeometry, bone: number, color: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.getAttribute('position').count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  const col = new Float32Array(n * 3);
  _c.setHex(color);
  for (let i = 0; i < n; i++) {
    si[i * 4] = bone;
    sw[i * 4] = 1;
    col.set([_c.r, _c.g, _c.b], i * 3);
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'skinIndex', 'skinWeight', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}

function headAccessories(look: HumanLook, t: Template): THREE.BufferGeometry[] {
  const hb = t.headBox;
  const c = hb.getCenter(new THREE.Vector3());
  const s = hb.getSize(new THREE.Vector3());
  const head = t.boneIndex.get('head')!;
  const out: THREE.BufferGeometry[] = [];
  const rx = s.x / 2;
  const ry = s.y / 2;
  const rz = s.z / 2;
  const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(c.x + x, c.y + y, c.z + z);
  // Face (mannequin faces +Z)
  const eyeY = -ry * 0.02;
  const eyeX = rx * 0.36;
  for (const sx of [-1, 1]) {
    const white = new THREE.SphereGeometry(rx * 0.19, 10, 8);
    white.scale(1, 1.25, 0.5);
    out.push(rigid(at(white, sx * eyeX, eyeY, rz * 0.93), head, 0xffffff));
    const pupil = new THREE.SphereGeometry(rx * 0.11, 8, 6);
    pupil.scale(1, 1.3, 0.5);
    out.push(rigid(at(pupil, sx * eyeX, eyeY - ry * 0.02, rz * 1.0), head, 0x1a1420));
    const brow = new THREE.BoxGeometry(rx * 0.4, ry * 0.07, rz * 0.12);
    brow.rotateZ(sx * -0.12);
    out.push(rigid(at(brow, sx * eyeX, eyeY + ry * 0.3, rz * 0.94), head, look.hair));
  }
  const mouth = new THREE.BoxGeometry(rx * 0.35, ry * 0.05, rz * 0.1);
  out.push(rigid(at(mouth, 0, -ry * 0.42, rz * 0.9), head, 0x5a2a2a));
  if (look.beard) {
    const beard = new THREE.SphereGeometry(rx * 0.85, 12, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45);
    beard.scale(1.02, 0.9, 1.0);
    out.push(rigid(at(beard, 0, -ry * 0.05, rz * 0.12), head, look.hair));
  }
  if (look.glasses) {
    const lens = new THREE.BoxGeometry(rx * 1.5, ry * 0.26, rz * 0.12);
    out.push(rigid(at(lens, 0, eyeY + ry * 0.02, rz * 1.02), head, 0x111111));
  }
  // Hair
  const capHair = (scale: number, theta: number) => {
    const g = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, theta);
    g.scale(rx * scale, ry * scale, rz * scale);
    return g;
  };
  switch (look.hairStyle) {
    case 'short': {
      const g = capHair(1.08, Math.PI * 0.42);
      g.rotateX(-0.25);
      out.push(rigid(at(g, 0, ry * 0.08, -rz * 0.05), head, look.hair));
      break;
    }
    case 'buzz': {
      const g = capHair(1.04, Math.PI * 0.38);
      g.rotateX(-0.3);
      out.push(rigid(at(g, 0, ry * 0.06, -rz * 0.04), head, look.hair));
      break;
    }
    case 'long': {
      const g = capHair(1.1, Math.PI * 0.45);
      g.rotateX(-0.3);
      out.push(rigid(at(g, 0, ry * 0.08, -rz * 0.06), head, look.hair));
      const back = new THREE.BoxGeometry(rx * 1.9, ry * 1.5, rz * 0.6);
      out.push(rigid(at(back, 0, -ry * 0.45, -rz * 0.62), head, look.hair));
      break;
    }
    case 'ponytail': {
      const g = capHair(1.08, Math.PI * 0.42);
      g.rotateX(-0.25);
      out.push(rigid(at(g, 0, ry * 0.08, -rz * 0.05), head, look.hair));
      const tail = new THREE.CapsuleGeometry(rx * 0.22, ry * 0.7, 4, 8);
      tail.rotateX(0.5);
      out.push(rigid(at(tail, 0, -ry * 0.1, -rz * 1.15), head, look.hair));
      break;
    }
    case 'afro': {
      const g = new THREE.IcosahedronGeometry(1, 1);
      g.scale(rx * 1.35, ry * 1.15, rz * 1.3);
      out.push(rigid(at(g, 0, ry * 0.35, -rz * 0.15), head, look.hair));
      break;
    }
    case 'mohawk': {
      const g = new THREE.BoxGeometry(rx * 0.35, ry * 0.5, rz * 1.7);
      out.push(rigid(at(g, 0, ry * 0.95, -rz * 0.1), head, look.hair));
      break;
    }
    case 'bald':
      break;
  }
  if (look.hat === 'cap') {
    const g = capHair(1.13, Math.PI * 0.36);
    g.rotateX(-0.15);
    out.push(rigid(at(g, 0, ry * 0.12, -rz * 0.02), head, look.hatColor));
    const visor = new THREE.CylinderGeometry(rx * 0.75, rx * 0.75, ry * 0.06, 16, 1, false, -Math.PI / 2, Math.PI);
    visor.scale(1, 1, 1.2);
    out.push(rigid(at(visor, 0, ry * 0.42, rz * 0.95), head, look.hatColor));
  } else if (look.hat === 'beanie') {
    const g = capHair(1.14, Math.PI * 0.5);
    out.push(rigid(at(g, 0, ry * 0.12, -rz * 0.03), head, look.hatColor));
    const pom = new THREE.SphereGeometry(rx * 0.22, 8, 6);
    out.push(rigid(at(pom, 0, ry * 1.25, 0), head, 0xffffff));
  }
  return out;
}

/** Chest stripe/logo for a bit of graphic flair. */
function torsoAccent(look: HumanLook, t: Template): THREE.BufferGeometry[] {
  const body = t.parts.find((p) => /Body/.test(p.name))!;
  body.geometry.computeBoundingBox();
  const b = body.geometry.boundingBox!;
  const c = b.getCenter(new THREE.Vector3());
  const s = b.getSize(new THREE.Vector3());
  const chest = t.boneIndex.get('chest')!;
  const stripe = new THREE.BoxGeometry(s.x * 0.62, s.y * 0.07, 0.02);
  stripe.translate(c.x, c.y + s.y * 0.18, b.max.z - 0.005);
  return [rigid(stripe, chest, look.topAccent)];
}

// --------------------------------------------------------------------------- materials

const bodyMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x15121c, side: THREE.BackSide });
outlineMat.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace(
    '#include <skinning_vertex>',
    '#include <skinning_vertex>\n#ifdef USE_SKINNING\ntransformed += normalize(objectNormal) * 0.022;\n#endif',
  );
};
// objectNormal is skinned only when the normal chunks run: make sure they do
outlineMat.customProgramCacheKey = () => 'human-outline';

const geoCache = new Map<string, THREE.BufferGeometry>();

function dressedGeometry(look: HumanLook, t: Template): THREE.BufferGeometry {
  const key = JSON.stringify(look);
  const cached = geoCache.get(key);
  if (cached) return cached;
  const bones = t.parts[0].skeleton.bones;
  const geos: THREE.BufferGeometry[] = [];
  for (const p of t.parts) {
    const g = p.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
    colorizePart(g, look, bones);
    geos.push(g.index ? g.toNonIndexed() : g);
  }
  // Mannequin skin indices are float/uint8 depending on export: normalize to Uint16 for merging
  const all = [...geos, ...headAccessories(look, t), ...torsoAccent(look, t)].map((g) => {
    const si = g.getAttribute('skinIndex');
    if (!(si.array instanceof Uint16Array)) g.setAttribute('skinIndex', new THREE.BufferAttribute(Uint16Array.from(si.array as ArrayLike<number>), 4));
    const sw = g.getAttribute('skinWeight');
    if (!(sw.array instanceof Float32Array)) g.setAttribute('skinWeight', new THREE.BufferAttribute(Float32Array.from(sw.array as ArrayLike<number>, (v) => (sw.normalized ? v / 255 : v)), 4));
    return g;
  });
  const merged = mergeGeometries(all, false)!;
  merged.computeBoundingSphere();
  if (geoCache.size > 64) geoCache.clear();
  geoCache.set(key, merged);
  return merged;
}

// --------------------------------------------------------------------------- view

export type BaseAnim = 'idle' | 'walk' | 'run' | 'sprint' | 'jump' | 'fall' | 'ko' | 'drive' | 'cower' | 'wave' | 'aim' | 'guard';
export type OverlayAnim = 'punch' | 'kick' | 'shoot' | 'hit' | 'interact';

const BASE_CLIPS: Record<BaseAnim, { clip: string; loop: boolean; speed?: number }> = {
  idle: { clip: 'Idle_A', loop: true },
  walk: { clip: 'Walking_A', loop: true },
  run: { clip: 'Running_A', loop: true },
  sprint: { clip: 'Running_B', loop: true, speed: 1.25 },
  jump: { clip: 'Jump_Idle', loop: true },
  fall: { clip: 'Jump_Idle', loop: true },
  ko: { clip: 'Death_A', loop: false },
  drive: { clip: 'Sit_Chair_Idle', loop: true },
  cower: { clip: 'Crouching', loop: true },
  wave: { clip: 'Waving', loop: true },
  aim: { clip: 'Ranged_1H_Aiming', loop: true },
  guard: { clip: 'Melee_Unarmed_Idle', loop: true },
};
const OVERLAY_CLIPS: Record<OverlayAnim, { clip: string; speed?: number }> = {
  punch: { clip: 'Melee_Unarmed_Attack_Punch_A', speed: 1.6 },
  kick: { clip: 'Melee_Unarmed_Attack_Kick', speed: 1.4 },
  shoot: { clip: 'Ranged_1H_Shoot', speed: 1.5 },
  hit: { clip: 'Hit_A', speed: 1.3 },
  interact: { clip: 'Interact', speed: 1.5 },
};

/** A dressed, animated human. Scale: ~1.8 m tall. Faces -z at rotation 0 (game convention). */
export class HumanView {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  private outline: THREE.SkinnedMesh;
  private mixer: THREE.AnimationMixer;
  private base: BaseAnim | null = null;
  private baseActions: THREE.AnimationAction[] = [];
  private overlay: THREE.AnimationAction | null = null;
  private overlayT = 0;
  private upperBase: THREE.AnimationAction | null = null;
  readonly handR: THREE.Object3D | null;
  private weapon: THREE.Object3D | null = null;

  constructor(look: HumanLook) {
    const t = template!;
    const rig = cloneSkinned(t.rig);
    // Remove the original part meshes from the clone; keep bones
    const remove: THREE.Object3D[] = [];
    let skeleton: THREE.Skeleton | null = null;
    let bindMatrix: THREE.Matrix4 | null = null;
    rig.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) {
        skeleton ??= sm.skeleton;
        bindMatrix ??= sm.bindMatrix;
        remove.push(o);
      }
    });
    for (const o of remove) o.removeFromParent();
    const geo = dressedGeometry(look, t);
    this.mesh = new THREE.SkinnedMesh(geo, bodyMat);
    this.mesh.bind(skeleton!, bindMatrix!);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.outline = new THREE.SkinnedMesh(geo, outlineMat);
    this.outline.bind(skeleton!, bindMatrix!);
    this.outline.frustumCulled = false;
    rig.add(this.mesh, this.outline);

    // KayKit faces +Z, the game faces -Z; 2.2 units tall → ~1.8 m
    const s = 0.8 * look.height;
    rig.scale.set(s * look.width, s, s * (0.5 + look.width * 0.5));
    rig.rotation.y = Math.PI;
    this.root.add(rig);
    this.mixer = new THREE.AnimationMixer(rig);
    this.handR = rig.getObjectByName('handr') ?? null;
    this.setBase('idle');
  }

  setOutline(on: boolean) {
    this.outline.visible = on;
  }

  setShadow(on: boolean) {
    this.mesh.castShadow = on;
  }

  setWeapon(kind: WeaponModel) {
    if (this.weapon) this.weapon.removeFromParent();
    this.weapon = null;
    if (kind === 'none' || !this.handR) return;
    this.weapon = weaponModel(kind);
    this.handR.add(this.weapon);
  }

  setBase(name: BaseAnim) {
    if (name === this.base) return;
    const t = template!;
    const spec = BASE_CLIPS[name];
    const fade = this.base === null ? 0 : name === 'ko' ? 0.1 : 0.2;
    for (const a of this.baseActions) a.fadeOut(fade);
    const low = this.mixer.clipAction(t.lower.get(spec.clip)!);
    const up = this.mixer.clipAction(t.upper.get(spec.clip)!);
    for (const a of [low, up]) {
      a.reset();
      a.setLoop(spec.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !spec.loop;
      a.timeScale = spec.speed ?? 1;
      a.setEffectiveWeight(1);
      a.fadeIn(fade).play();
    }
    if (this.overlay) up.setEffectiveWeight(0);
    this.baseActions = [low, up];
    this.upperBase = up;
    this.base = name;
  }

  /** Plays a one-shot upper-body action over the current locomotion. */
  playOverlay(name: OverlayAnim) {
    const t = template!;
    const spec = OVERLAY_CLIPS[name];
    const clip = t.upper.get(spec.clip)!;
    if (this.overlay) this.overlay.stop();
    const a = this.mixer.clipAction(clip);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = spec.speed ?? 1;
    a.setEffectiveWeight(1);
    a.play();
    this.overlay = a;
    this.overlayT = clip.duration / a.timeScale;
    this.upperBase?.setEffectiveWeight(0);
  }

  /** Locomotion speed sync: scales walk/run playback with the actual speed. */
  setSpeedScale(k: number) {
    for (const a of this.baseActions) a.timeScale = k;
  }

  update(dt: number) {
    if (this.overlay) {
      this.overlayT -= dt;
      if (this.overlayT <= 0) {
        this.overlay.fadeOut(0.15);
        this.overlay = null;
        this.upperBase?.setEffectiveWeight(1);
        this.upperBase?.fadeIn(0.15);
      }
    }
    this.mixer.update(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}

export type WeaponModel = 'none' | 'pistol' | 'rifle' | 'baton' | 'smg' | 'shotgun' | 'knife' | 'bat';

function weaponModel(kind: Exclude<WeaponModel, 'none'>): THREE.Object3D {
  const g = new THREE.Group();
  const dark = new THREE.MeshToonMaterial({ color: 0x24242c, gradientMap: toonGradient() });
  const accent = new THREE.MeshToonMaterial({ color: 0x8a6d4f, gradientMap: toonGradient() });
  if (kind === 'baton' || kind === 'bat' || kind === 'knife') {
    // held along the forearm, pointing forward
    const len = kind === 'bat' ? 0.85 : kind === 'baton' ? 0.6 : 0.3;
    const mat = kind === 'bat' ? accent : kind === 'knife' ? new THREE.MeshToonMaterial({ color: 0xd8dde3, gradientMap: toonGradient() }) : dark;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(kind === 'bat' ? 0.045 : 0.025, 0.03, len, 8), mat);
    stick.rotation.x = Math.PI / 2;
    stick.position.set(0, 0, len / 2 - 0.05);
    if (kind === 'knife') {
      stick.scale.set(1.6, 1, 0.4);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.12), dark);
      g.add(handle);
    }
    g.add(stick);
  } else if (kind === 'pistol') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.26), dark);
    body.position.set(0, 0.02, 0.1);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.07), accent);
    grip.position.set(0, -0.05, 0.0);
    grip.rotation.x = 0.25;
    g.add(body, grip);
  } else if (kind === 'smg') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.42), dark);
    body.position.set(0, 0.03, 0.15);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.05), dark);
    mag.position.set(0, -0.1, 0.12);
    g.add(body, mag);
  } else if (kind === 'shotgun') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.8), dark);
    body.position.set(0, 0.03, 0.28);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.2), accent);
    pump.position.set(0, -0.03, 0.42);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, 0.22), accent);
    stock.position.set(0, -0.02, -0.15);
    g.add(body, pump, stock);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.7), dark);
    body.position.set(0, 0.03, 0.25);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.22), accent);
    stock.position.set(0, -0.02, -0.15);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.06), dark);
    mag.position.set(0, -0.09, 0.22);
    g.add(body, stock, mag);
  }
  // Hand bone space of the mannequin (scaled 0.8): bring the gun to a natural size/orientation
  g.scale.setScalar(1.25);
  g.rotation.set(-Math.PI / 2, 0, 0);
  return g;
}
