# STREETZ — contexte projet

Prototype de jeu mobile open world (style GTA-like stylisé façon Fortnite/Brawl Stars), 18+, dans un quartier fictif inspiré de Paris (~1 km²). Web mobile plein écran **paysage**, PWA, déployé sur GitHub Pages, emballable plus tard avec Capacitor.
L'utilisateur n'est pas développeur : il teste sur son téléphone et donne son ressenti. On décide seul les détails (noter dans `docs/DECISIONS.md`), on ne pose une question que si c'est coûteux à défaire.

Brief complet : voir l'historique / `docs/PLAN.md` (architecture + jalons). Jalon en cours : voir la section « État » ci-dessous.

## Stack
TypeScript + Vite + Three.js (0.169) + Rapier (`@dimforge/rapier3d-compat`). Tests : Vitest (logique) + Playwright-core (headless mobile, Chromium dans `/opt/pw-browsers`).

## Commandes
- `npm run dev` — serveur de dev (http://localhost:5173)
- `npm run build` — typecheck + build dans `dist/`
- `npm test` — tests unitaires de la simulation
- `npm run e2e` — build déjà fait requis : lance `vite preview`, ouvre le jeu en 844×390 tactile, simule le joystick, mesure FPS, capture `scripts/out/*.png`
- URL de debug : `?debug` affiche stats (draw calls, triangles), `?quality=low|medium|high`

## Règles d'architecture (ne pas casser)
- `src/sim/` : **aucun import** de `three` ni du DOM. Simulation pure, pas fixe 60 Hz, état sérialisable (`snapshot()`).
- Toute action joueur = une `Command` sérialisable (`src/core/commands.ts`) poussée dans la `CommandQueue`. Jamais de mutation directe de la sim depuis l'UI/le rendu.
- `src/render/` lit la sim, ne l'écrit pas (raycast en lecture autorisé).
- Données de map dans `src/maps/<id>/`, chargées par `import()` dans `src/maps/registry.ts`. Missions/armes/véhicules/gangs en données dans `src/data/`.
- Génération procédurale déterministe (RNG à graine `src/core/rng.ts`).
- Perf : instancing par chunk, pools d'objets, pas d'allocation dans les boucles chaudes (réutiliser les `Vector3` temporaires).

## Conventions
- Code et identifiants en anglais, textes du jeu et docs en français.
- 1 unité = 1 m, Y vers le haut, map dans x,z ∈ [-500, 500].
- Un commit par fonctionnalité, message clair en français.
- Assets : CC0 uniquement ou générés par code → `docs/CREDITS.md`. Aucune marque/lieu réel.
- Fin de jalon : build + tests + e2e verts, déploiement, résumé de 5 lignes à l'utilisateur.

## Docs
`docs/PLAN.md` (plan/jalons), `docs/DECISIONS.md` (décisions en une ligne), `docs/CREDITS.md`, `docs/MULTIPLAYER.md`.

## État
- Jalon 1 (Socle) : terminé en local (build, 24 tests unitaires, e2e headless OK). Dépôt `JVLIOVS/streetz`, jeu en ligne sur https://jvliovs.github.io/streetz/ (déployé par GitHub Actions à chaque push sur `main`).
- Prochain : jalon 2 (ville complète + véhicules + PNJ + jour/nuit).
