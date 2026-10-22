// Builds the runtime GLB packs in public/assets/ from the CC0 sources in assets-src/.
//  - characters.glb : KayKit mannequin + the animation clips the game uses (retargeted by bone name)
//  - city.glb       : KayKit City Builder Bits props / cars / buildings, one named root node per asset
//  - vehicles.glb   : Kenney 4x4 trucks and motorcycle
// Run: node scripts/build-assets.mjs
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, resample, mergeDocuments, unpartition, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { mkdirSync, readdirSync } from 'node:fs';

const SRC = new URL('../assets-src/', import.meta.url).pathname;
const OUT = new URL('../public/assets/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const io = new NodeIO();

const CLIPS = {
  'Rig_Medium_General.glb': ['Idle_A', 'Hit_A', 'Hit_B', 'Death_A', 'Death_A_Pose', 'Death_B', 'Interact', 'PickUp', 'Throw'],
  'Rig_Medium_MovementBasic.glb': ['Walking_A', 'Walking_B', 'Running_A', 'Running_B', 'Jump_Start', 'Jump_Idle', 'Jump_Land'],
  'Rig_Medium_MovementAdvanced.glb': ['Running_HoldingRifle', 'Dodge_Forward', 'Crouching'],
  'Rig_Medium_CombatMelee.glb': ['Melee_Unarmed_Attack_Punch_A', 'Melee_Unarmed_Attack_Kick', 'Melee_Unarmed_Idle', 'Melee_1H_Attack_Chop', 'Melee_1H_Attack_Slice_Horizontal', 'Melee_1H_Attack_Stab', 'Melee_2H_Attack_Chop'],
  'Rig_Medium_CombatRanged.glb': ['Ranged_1H_Aiming', 'Ranged_1H_Shoot', 'Ranged_2H_Aiming', 'Ranged_2H_Shoot'],
  'Rig_Medium_Simulation.glb': ['Sit_Chair_Idle', 'Waving', 'Cheering', 'Lie_Idle'],
};

async function buildCharacters() {
  const doc = await io.read(SRC + 'kaykit-anim/Mannequin_Medium.glb');
  const root = doc.getRoot();
  const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  for (const [file, keep] of Object.entries(CLIPS)) {
    const src = await io.read(SRC + 'kaykit-anim/' + file);
    for (const a of src.getRoot().listAnimations()) if (!keep.includes(a.getName())) a.dispose();
    const before = new Set(root.listNodes());
    mergeDocuments(doc, src);
    // Retarget channels from the merged (duplicate) skeleton onto the mannequin's bones
    for (const anim of root.listAnimations()) {
      for (const ch of anim.listChannels()) {
        const t = ch.getTargetNode();
        if (!t || before.has(t)) continue;
        const dst = byName.get(t.getName());
        if (dst) ch.setTargetNode(dst);
        else ch.dispose(); // e.g. handslot bones the mannequin lacks
      }
    }
    for (const n of root.listNodes()) if (!before.has(n)) n.dispose();
    for (const s of root.listScenes().slice(1)) s.dispose();
  }
  // Halve the mannequin's triangle count: dozens of pedestrians must stay cheap on phones.
  // UVs are unused (humans are vertex-colored at runtime): dropping them removes seams.
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const sem of prim.listSemantics()) if (sem.startsWith('TEXCOORD')) prim.setAttribute(sem, null);
    }
  }
  for (const t of root.listTextures()) t.dispose();
  await MeshoptSimplifier.ready;
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.3, error: 0.03 }), resample(), prune(), dedup(), unpartition());
  await io.write(OUT + 'characters.glb', doc);
  console.log('characters.glb', root.listAnimations().map((a) => a.getName()).join(', '));
}

async function buildPack(dir, files, outName) {
  const doc = await io.read(SRC + dir + '/' + files[0]);
  const name0 = files[0].replace(/\.(gltf|glb)$/, '');
  wrap(doc, doc.getRoot().listScenes()[0], name0);
  for (const f of files.slice(1)) {
    const src = await io.read(SRC + dir + '/' + f);
    wrap(src, src.getRoot().listScenes()[0], f.replace(/\.(gltf|glb)$/, ''));
    mergeDocuments(doc, src);
  }
  // Move every merged scene's roots into the first scene
  const [main, ...rest] = doc.getRoot().listScenes();
  for (const s of rest) {
    for (const n of s.listChildren()) main.addChild(n);
    s.dispose();
  }
  await doc.transform(dedup(), prune(), unpartition());
  await io.write(OUT + outName, doc);
  console.log(outName, main.listChildren().map((n) => n.getName()).join(', '));
}

/** Groups a scene's roots under one node named after the asset file. */
function wrap(doc, scene, name) {
  const group = doc.createNode(name);
  for (const n of scene.listChildren()) {
    scene.removeChild(n);
    group.addChild(n);
  }
  scene.addChild(group);
}

await buildCharacters();
await buildPack('kaykit-city', readdirSync(SRC + 'kaykit-city').filter((f) => f.endsWith('.gltf')), 'city.glb');
await buildPack('kenney-racing', readdirSync(SRC + 'kenney-racing').filter((f) => f.endsWith('.glb')), 'vehicles.glb');
