# STREETZ — Plan de développement

Prototype de jeu d'action open world mobile (web, paysage), Three.js + Rapier, déployé sur GitHub Pages.

## 1. Architecture

Trois couches strictement séparées, pour pouvoir passer en multijoueur (serveur autoritaire) sans réécriture :

```
 Entrées (input/)  ──►  Commandes sérialisables  ──►  Simulation (sim/)  ──►  État sérialisable  ──►  Rendu (render/) + UI (ui/)
 joystick, boutons      { type:'move', tick, … }      pas fixe 60 Hz,          snapshot JSON             Three.js, interpolation
 clavier (debug)                                       Rapier, règles                                     entre deux ticks
```

- **sim/** ne connaît pas Three.js ni le DOM. Elle consomme des `Command` et produit un `WorldSnapshot`. C'est le code qui tournera tel quel sur un serveur Node.
- **render/** lit l'état de la sim (lecture seule) et interpole entre le tick précédent et le tick courant.
- **input/** traduit les gestes en `Command`, qui passent par une file (`CommandQueue`) — en v2 cette file sera envoyée au serveur.
- **maps/** : chaque map est un module de données (`maps/paris/index.ts`) chargé par `import()` dynamique via `maps/registry.ts`. Le moteur ne contient aucune donnée de map.
- **data/** (à partir du jalon 4) : missions, armes, véhicules, gangs décrits en TS/JSON.

### Boucle
`core/loop.ts` : accumulateur à pas fixe (1/60 s, max 5 ticks de rattrapage), rendu à chaque `requestAnimationFrame` avec facteur d'interpolation `alpha`.

### Performance
- Bâtiments : `InstancedMesh` par type de géométrie × chunk (1 draw call par chunk et par matériau).
- Chunks de 125 m (grille 8×8 sur 1 km²) : visibilité selon la distance au joueur + frustum culling Three.js par chunk.
- LOD : au-delà d'une distance, les chunks utilisent une version sans détails (toits/façades simplifiés).
- Pools d'objets pour PNJ, véhicules, projectiles (jalons 2-3).
- Ombres : une seule lumière directionnelle, shadow map qui suit le joueur, taille selon la qualité (désactivée en Bas).
- Résolution adaptative : `pixelRatio` ajusté dynamiquement selon le temps de frame moyen.
- Qualité Bas / Moyen / Haut : pixelRatio max, ombres, distance de vue, densité PNJ.

## 2. Arborescence

```
streetz/
├─ CLAUDE.md                 contexte pour les sessions suivantes
├─ index.html                point d'entrée, UI DOM
├─ public/                   manifest PWA, service worker, icônes
├─ src/
│  ├─ main.ts                bootstrap (chargement, écrans)
│  ├─ core/                  boucle, commandes, bus d'événements, sauvegarde
│  ├─ sim/                   simulation pure (Rapier, entités, règles)
│  ├─ render/                Three.js : scène, matériaux toon, ville, persos, caméra
│  ├─ input/                 tactile + clavier → commandes
│  ├─ ui/                    HUD, menus (DOM/CSS)
│  ├─ maps/                  registry + une map par dossier (paris/)
│  └─ data/                  missions, armes, véhicules, gangs (jalons 3+)
├─ tests/                    tests unitaires Vitest (logique de jeu)
├─ scripts/                  test headless mobile (Playwright) + mesure FPS
├─ docs/                     PLAN, DECISIONS, CREDITS, MULTIPLAYER
└─ .github/workflows/        build + tests + déploiement GitHub Pages
```

## 3. Jalons

| # | Jalon | Contenu | Critère de sortie |
|---|-------|---------|-------------------|
| 1 | Socle | Vite/TS, Rapier, boucle fixe, commandes, ville en blocs instanciés, perso au joystick, caméra 3e pers., HUD FPS, PWA, CI Pages | Build + tests verts, 60 FPS desktop / mesure headless mobile, lien en ligne |
| 2 | Ville + véhicules | Map Paris complète (boulevards, fleuve, ponts, cités, zone commerciale, périph, parc en relief), chunks + LOD, jour/nuit 20 min, néons, 4 véhicules arcade, PNJ piétons + trafic sur graphe | Conduire les 4 véhicules, 4×4 qui grimpe le parc |
| 3 | Combat + police | Poing/pistolet/fusil, visée assistée, santé/armure, crimes → étoiles 1-5, police/barrages/unité lourde, perte d'étoiles, respawn hôpital/commissariat | Semer 3★ |
| 4 | Missions + braquage | Moteur de missions data-driven, 5 missions (livraison, poursuite, escorte, élimination, braquage), braquage banque 3 phases rejouable | Enchaîner les 5 missions |
| 5 | Gangs | 3 gangs, QG/planque, zones de territoire, vagues de défenseurs, contre-attaques, revenus passifs | Prendre un territoire |
| 6 | Finitions | Éditeur de perso, boutique cosmétique (paiement désactivé), tutoriel 60 s, menus, options, sons/musique CC0, équilibrage, passe perf | Parcours complet de la « définition de terminé » |

## 4. Tests
- `npm test` : Vitest sur la simulation (boucle, commandes, déplacement, sérialisation, puis étoiles, missions, territoires…).
- `npm run e2e` : Chromium headless, viewport téléphone (844×390 paysage, tactile), simule le joystick, mesure FPS / draw calls, capture d'écran dans `scripts/out/`.
- CI : build + tests à chaque push sur `main`, puis déploiement Pages.
