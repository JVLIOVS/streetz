# Décisions (une ligne chacune)

- 2026-10-21 — Versions figées : three 0.169, @dimforge/rapier3d-compat 0.14, Vite 5, TypeScript 5.6, Vitest 2.
- 2026-10-21 — `base: './'` dans Vite : chemins relatifs, fonctionne à la fois sur GitHub Pages (sous-dossier) et dans Capacitor.
- 2026-10-21 — Simulation à 60 Hz fixe, rendu interpolé ; 1 unité = 1 mètre ; Y vers le haut ; la map couvre x,z ∈ [-500, 500].
- 2026-10-21 — Rapier tourne dans la couche sim (et pourra tourner côté serveur) ; le rendu ne fait que des requêtes en lecture (raycast caméra).
- 2026-10-21 — Personnage : `KinematicCharacterController` Rapier (plus stable et plus « arcade » qu'un corps dynamique).
- 2026-10-21 — Déplacement relatif à la caméra : le yaw caméra est inclus dans la commande `move` (le serveur n'a pas besoin de connaître la caméra).
- 2026-10-21 — Tests headless en 844×390 (390×844 tourné, paysage imposé) ; en portrait le jeu affiche « Tourne ton téléphone ».
- 2026-10-21 — Les FPS headless (rendu logiciel SwiftShader) sous-estiment fortement un vrai GPU ; on suit aussi draw calls et triangles comme indicateurs.
- 2026-10-21 — Pas de vite-plugin-pwa : manifest + service worker écrits à la main (moins de dépendances).
- 2026-10-21 — Assets 100 % générés par code au jalon 1 (aucun téléchargement), look toon via `MeshToonMaterial` + dégradé 3 tons.
- 2026-10-21 — Chunks de 125 m (8×8) : un `InstancedMesh` par chunk et par matériau, affichés selon la distance de vue de la qualité choisie.
- 2026-10-21 — Génération de la ville déterministe (RNG à graine) : même ville sur tous les appareils et, plus tard, sur le serveur.
- 2026-10-21 — Sprint = bouton bascule (pas maintenu) pour garder le pouce droit libre pour la caméra ; il se coupe quand on lâche le joystick.
- 2026-10-21 — Compteur FPS visible en bas à gauche pendant le prototype (utile pour les retours de test) ; `?debug` ajoute draw calls/triangles.
- 2026-10-21 — Quais à -3,5 m, eau à -4,5 m, ponts au niveau de la rue : on peut passer sous les ponts à pied ; tomber à l'eau ramène au point de départ (en attendant l'hôpital au jalon 3).
- 2026-10-21 — Périphérique au niveau du sol (2×2 voies, 22 m), fermé par des murs antibruit en bordure de map.
- 2026-10-21 — playwright-core 1.56 (aligné sur le Chromium préinstallé) pour les tests headless.
- 2026-10-21 — Déploiement via la branche `gh-pages` (poussée par le workflow) plutôt que la source « GitHub Actions » : aucun réglage manuel de Pages requis.
