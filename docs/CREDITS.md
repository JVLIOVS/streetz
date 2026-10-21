# Crédits et sources

Toutes les ressources sont libres de droits (CC0) ou générées par code. Aucune marque, logo ni lieu réel protégé.
Les fichiers sources sont dans `assets-src/` (avec leurs licences) ; `node scripts/build-assets.mjs` produit `public/assets/*.glb`.

| Ressource | Source | Licence |
|-----------|--------|---------|
| Personnage (mannequin `Rig_Medium`) et 30 animations (marche, course, sprint, saut, coups, tir, KO, assis…) | KayKit — Character Animations 1.1, Kay Lousberg (kaylousberg.com), via le dépôt GitHub NoLimitNexus/game-models | CC0 |
| Habillage des personnages (couleurs, cheveux, casquettes, visage) | Généré par code (`src/render/human.ts`) | Code du projet |
| Voitures (citadine, berline, break, taxi, police), lampadaires, feux, bancs, bouches d'incendie, poubelles, bennes, buissons | KayKit — City Builder Bits 1.0, Kay Lousberg (github.com/KayKit-Game-Assets) | CC0 |
| 4×4 et scooter | Kenney — Starter Kit Racing (github.com/KenneyNL), modèles issus des kits Kenney | CC0 (modèles) |
| Sons du kit Racing (moteur, dérapage, choc) — copiés dans `assets-src/`, pas encore utilisés | Kenney / Landeplage | CC0 |
| Sons en jeu (tirs, coups, explosions, klaxon, moteur, argent) | Synthétisés par code (`src/audio/sound.ts`) | Code du projet |
| Ville, bâtiments haussmanniens, routes, intérieurs, enseignes | Générés par code (`src/render/`, `src/maps/paris/`, `src/sim/interiors.ts`) | Code du projet |
| Moteur 3D | three.js | MIT |
| Physique | Rapier (@dimforge/rapier3d-compat) | Apache-2.0 |
| Optimisation des modèles (build) | glTF-Transform, meshoptimizer | MIT |
