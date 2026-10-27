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
- `npm run e2e` — build déjà fait requis : lance `vite preview`, ouvre le jeu en 844×390 tactile, joystick, coup, voiture (monter/conduire/sortir), entrée en boutique, lancement d'une mission, mesure FPS, capture `scripts/out/*.png`
- `npm run e2e:multi` — téléphones dans le même navigateur (`?net=local`) : créer/rejoindre, mouvements et coups relayés, puis monde ouvert (deux joueurs en même temps → un seul hôte)
- URL de debug : `?debug` affiche stats (draw calls, triangles), `?quality=low|medium|high`, `?net=local` (multijoueur entre onglets)

## Règles d'architecture (ne pas casser)
- `src/sim/` : **aucun import** de `three` ni du DOM. Simulation pure, pas fixe 60 Hz, état sérialisable (`snapshot()`).
- Toute action joueur = une `Command` sérialisable (`src/core/commands.ts`) poussée dans la `CommandQueue`. Jamais de mutation directe de la sim depuis l'UI/le rendu.
- `src/render/` lit la sim, ne l'écrit pas (raycast en lecture autorisé).
- `src/net/` est la seule couche (hors commandes) qui écrit dans la sim : rapports d'invités côté hôte, recopie des instantanés côté invité (`role: 'replica'`).
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
- Version test 2 (après retour testeur « trop minimaliste, ville vide ») : persos KayKit animés, piétons, trafic, voitures garées, 7 véhicules conduisibles, combat poing/pistolet + visée assistée, étoiles, 12 bâtiments ouverts (supérettes braquables, banque, bijouterie…), mobilier urbain, sons synthétisés.
- Version test 3 : bagarres (verrouillage, PNJ qui ripostent, barre de vie, butin aléatoire), plus de piétons, mobilier cassable (lampadaires, feux, potelets, bouches d'incendie…), multijoueur P2P 2–10 joueurs (`src/net/`, voir `docs/MULTIPLAYER.md`).
- Version test 4 : police graduelle (agent → voitures → hélico → barrages/RAID → armée, arrestation, zone de recherche), armes (couteau, matraque, batte, pistolet, mitraillette, fusil à pompe, fusil) + armurerie + gilet, boutique de sapes, concession, appartements, planque (garde-robe, garage perso), sauvegarde du profil, 5 missions (`src/data/missions.ts`, `src/sim/missions.ts`), monde ouvert public (salles `PUB1..6`, élection d'hôte) + parties privées par code, scooter plus doux.
- Version test 5 (rétention, phase 1 de `docs/GAME_DESIGN.md`) : niveaux 1–100 + déblocages (`src/data/progression.ts`), compteur de chaos et cascades (`src/sim/progress.ts`), contrats du jour + série de connexion + receleur (`src/data/contracts.ts`, `src/sim/contracts.ts`), colis surprises / voitures dorées / passants VIP, tutoriel auto (mission `tuto`), business de planque (`src/data/business.ts`), récap de session dans la pause, jus (chiffres de dégâts, tremblements, vibrations, ralenti en solo).
- Version test 6 (social, phase 2) : primes entre joueurs (`src/sim/social.ts`), crews (menu pause, pas de tir ami, bonus ensemble), braquage coop « Le Coffre » (`src/sim/heist.ts`), classement de la partie + records de la semaine (`src/data/social.ts`).
- Version test 7 (son) : audio débloqué au premier tap (iOS compris), musique trap procédurale (`src/audio/music.ts`), voix et cris (`src/audio/voices.ts`), ambiance, crissements, hélico, sons par arme et par objet (`src/audio/sound.ts`, piloté par `src/audio/director.ts`), réglages dans la pause.
- Version test 8 : prologue « Le premier coup » avec le partenaire Momo (mission `tuto`, champ `partner`), sang (giclées + flaques), police plus lente à arriver, armes ramassées sur les gens armés.
- Version test 9 : police qui arrête avant de tirer (<4★), amendes, prison (cinématique), banque, perte du cash/armes à la mort, casier, respect, compétences (`src/data/law.ts`, `src/sim/law.ts`).
- Version test 10 : super saut (maintenir Saut), caches et postes de tir sur les toits (`src/sim/roofs.ts`), correctif police après amende.
- Version test 11 : police v3 (payer/refuser l'amende, fichage 3 max, se rendre), stuff perdu marqué 10 min, armes fun (sabre, tronçonneuse, sécateur, lance-flammes), mini-hélico pilotable, jetpack.
- Version test 12 : La Famille (7 grades mafieux, 11 missions, gardes du corps, part, avocat — `src/data/family.ts`, `src/sim/family.ts`), graphisme (dalles, ciel, tonemapping, MSAA), audit complet (`docs/AUDIT.md`) + correctifs sécurité (`src/net/validate.ts`, CSP, sanitize), contrôle d'âge, rapport de bug.
- Version test 13 : stuff (départ en caleçon, 7 emplacements, 4 raretés — `src/data/gear.ts`), planque constructible (`src/data/base.ts`, `src/sim/base.ts`, `src/render/base.ts`, `src/ui/build.ts`), correctifs de l'audit externe (compétences, crews, mémoire GPU, CI sur PR).
- Version test 14 : évolution du perso et Éveil (`src/data/evolution.ts`, `src/sim/powers.ts`, `src/render/powers.ts`), missions de crew et missions ouvertes (`src/sim/ops.ts`).
- Version test 16 : grande carte, interface déplacée hors joystick, Continuer/Nouvelle partie, guide QG, visée par menace, témoin avant la police, conduite, boost (sprint maintenu), toits garnis, butin dans les bâtiments (`src/sim/loot.ts`).
- Reste : serveur dédié pour un vrai monde persistant (à décider avec l'utilisateur : hébergement payant), jour/nuit + néons, gangs/territoires + échanges + caches (serveur), éditeur de perso, bouclier, petit avion.
- Assets : sources CC0 dans `assets-src/`, `node scripts/build-assets.mjs` → `public/assets/`.
