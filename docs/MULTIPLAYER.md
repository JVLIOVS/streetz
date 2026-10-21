# STREETZ — Architecture multijoueur

## Ce qui tourne déjà (prototype, version test 3)
- **Pair-à-pair, sans serveur** : WebRTC via la bibliothèque `trystero` (stratégie Nostr : des relais publics gratuits servent uniquement à se trouver, ensuite les téléphones se parlent directement). Code : `src/net/`.
- **Hôte = celui qui crée la partie** (code à 4 caractères). Son téléphone fait tourner la simulation autoritaire (`SimWorld` rôle `authority`) : piétons, trafic, combats, argent, étoiles, objets cassés.
- **Invités (jusqu'à 9)** : `SimWorld` rôle `replica`. Ils simulent eux-mêmes leur perso et la voiture qu'ils conduisent (contrôles instantanés), envoient leur position ~20×/s, et envoient leurs actions (frapper, tirer, monter, braquer…) que l'hôte résout. Le reste du monde est recopié depuis les instantanés de l'hôte (12×/s, zone d'intérêt de 130 m, positions au cm, entités en tableaux de nombres) puis lissé.
- Téléportations décidées par l'hôte (portes, hôpital, sortie de voiture) : compteur `teleportSeq` ; l'hôte ignore les positions d'un invité tant qu'il n'a pas appliqué la dernière.
- Étoiles de recherche par joueur. PvP actif : on peut se frapper / se tirer dessus.
- Test automatique : `npm run build && npm run e2e:multi` (deux téléphones dans le même navigateur, transport local `?net=local`).

### Limites connues du prototype
- Si l'hôte quitte, la partie s'arrête (pas de migration d'hôte).
- Positions des invités non vérifiées par l'hôte (confiance) : suffisant entre potes, pas pour du public.
- ~10–20 % des réseaux mobiles bloquent le WebRTC direct sans serveur relais TURN : à prévoir avec un serveur dédié.

## Architecture cible (version publique)

La v1 est solo, mais le code est structuré pour que la simulation puisse être déplacée sur un serveur sans réécriture.

## Ce qui est déjà en place en v1
- **Simulation isolée** (`src/sim/`) : aucune dépendance à Three.js ni au DOM. Elle tourne en Node (c'est ce que font les tests Vitest).
- **Pas fixe 60 Hz** (`src/core/loop.ts`) : chaque tick est numéroté, la simulation est reproductible à entrées égales.
- **Commandes sérialisables** (`src/core/commands.ts`) : toute action du joueur est un objet JSON `{ type, playerId, tick, … }` qui passe par une `CommandQueue`. Aujourd'hui la file est locale ; demain elle est envoyée au serveur.
- **État sérialisable** : `SimWorld.snapshot()` produit un `WorldSnapshot` JSON (positions, rotations, vitesses, santé, état des entités).
- **Maps en modules de données** : un serveur peut charger la même map (même graine, même génération déterministe).

## Architecture cible

```
 Client (navigateur / Capacitor)                     Serveur (Node + Colyseus)
 ┌──────────────────────────────┐                    ┌─────────────────────────────────┐
 │ input → Command ─────────────┼── WebSocket ──────►│ Room "paris#3" (1 instance)     │
 │ prédiction locale (sim)      │                    │  SimWorld (même code src/sim)   │
 │ réconciliation  ◄────────────┼── snapshots/deltas ┤  tick 30–60 Hz, autorité totale │
 │ rendu interpolé (100 ms)     │                    │  anti-triche : valide commandes │
 └──────────────────────────────┘                    └─────────────────────────────────┘
                                                      Services : comptes, sauvegardes (DB),
                                                      gangs, matchmaking, boutique
```

- **Serveur autoritaire** : Colyseus (Node, rooms, schéma d'état binaire avec deltas) — ou équivalent (Nakama, serveur maison `ws` + `uWebSockets`). Colyseus est retenu car le code sim est déjà en TypeScript et peut être importé tel quel.
- **Rooms = instances de map** : une room par map et par instance (`paris#1`, `paris#2`…), 16–32 joueurs max par instance. Le matchmaking place les membres d'un même gang dans la même instance.

## Synchronisation de position
- Le client envoie ses commandes `move` (axe joystick, yaw caméra, sprint, saut) à chaque tick, avec le numéro de tick.
- **Prédiction côté client** pour le joueur local : il applique ses commandes immédiatement avec la même sim, garde l'historique, et **réconcilie** quand l'état serveur arrive (rejoue les commandes non acquittées).
- **Interpolation** des autres joueurs/PNJ/véhicules avec ~100 ms de retard entre deux snapshots.
- Véhicules : autorité serveur, extrapolation par vitesse côté client ; le conducteur local prédit son véhicule.
- **Intérêt (AOI)** : le serveur n'envoie que les entités dans les chunks proches du joueur (réutilise le découpage en chunks de 125 m).
- Tirs : le client envoie `fire { tick, dir, targetId? }` ; le serveur valide en rembobinant les positions (lag compensation ≤ 200 ms).

## Gangs entre joueurs
- Les gangs deviennent des entités persistantes côté serveur (DB) : membres, rangs, territoires, trésorerie.
- Les territoires sont **par instance** pour les combats, mais leur propriétaire est **global** (synchronisé entre instances via la DB / un service de gangs).
- Guerres de territoire : une attaque déclenche un événement dans l'instance ; les défenseurs PNJ sont complétés par les joueurs du gang défenseur présents.

## Voyage entre maps (avion)
- L'aéroport de chaque map est un point de transition. Le joueur choisit une destination → le client quitte la room courante, charge le module de map (`maps/<id>/`) par import dynamique, et rejoint une room de la nouvelle map.
- L'état du joueur (argent, armes, véhicules stockés, gang) vit côté serveur et suit le joueur ; seul l'état local à la map (position, étoiles) est réinitialisé.
- Écran de chargement « vol » pendant le téléchargement des assets de la map.

## Sauvegarde et comptes
- v1 : `localStorage` via `core/save.ts` avec un format versionné (`version`, `profile`, `progress`).
- v2 : même format envoyé à une API (`PUT /profile`), migration automatique de la sauvegarde locale à la première connexion.
