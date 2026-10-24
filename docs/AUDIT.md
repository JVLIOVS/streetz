# Audit STREETZ — version test 12

Audit réalisé sur le code de la version test 11 (puis corrigé en version test 12). Il croise dix regards : testeur, tech lead, architecte solution, cyber (gouvernance/GRC, tests de vulnérabilité, durcissement), IAM, MCS/MCO, UX/UI, game design, marketing/lancement et monétisation.

Gravité : 🔴 critique · 🟠 importante · 🟡 moyenne · ⚪ mineure. Statut : ✅ corrigé en test 12 · 📌 recommandé (pas fait).

---

## 1. Synthèse

| Domaine | Note | En une phrase |
|---|---|---|
| Fonctionnel / tests | 8/10 | 108 tests unitaires et 2 e2e couvrent le cœur ; le multijoueur réel entre téléphones reste peu testé. |
| Architecture | 7/10 | Séparation sim/rendu/réseau saine et testable ; `world.ts` (2 000 lignes) devient un « objet-dieu ». |
| Sécurité | 5 → 7/10 | Plusieurs failles exploitables par un invité modifié, corrigées ; la triche reste possible tant qu'il n'y a pas de serveur. |
| Conformité (GRC) | 4 → 6/10 | Pas de contrôle d'âge ni d'information sur l'IP en P2P : ajoutés. Pas encore de mentions légales ni de politique de confidentialité. |
| MCO / exploitation | 5 → 6/10 | Pipeline CI simple et fiable ; aucune remontée d'erreurs. Ajout d'un rapport de bug copiable et du numéro de build. |
| UX / UI | 7/10 | HUD lisible, gros boutons, jus ; beaucoup de systèmes à expliquer, panneau de progression dense. |
| Graphisme | 6 → 7/10 | Style cohérent ; trottoirs plats et ciel vide. Ajouts en test 12 : dalles, nuages, soleil, anti-crénelage, rendu des couleurs. |
| Potentiel marché | 6/10 | Bon concept (GTA-like social, jouable dans le navigateur) mais 18+, français seulement, et il manque un serveur pour la rétention en ligne. |

**Top 5 des actions suivantes :** serveur dédié (anti-triche et monde persistant), mentions légales et politique de confidentialité, traduction en anglais, découpage de `world.ts`, test réel à 4 téléphones.

---

## 2. Testeur (QA)

**Couverture**
- Tests unitaires (Vitest), 108 au total, sur la simulation sans écran :
  - déplacements, combats, police, missions, Famille ;
  - économie, réseau ;
  - sécurité (nouveau).
- e2e mobile (Playwright, 844×390 tactile) :
  - âge, menu, joystick, coups, voiture, boutique, mission ;
  - mesure des FPS, captures d'écran.
- e2e multi : 2 à 4 onglets, création, rejoindre une partie, élection d'hôte.

**Constats**

| # | Gravité | Constat | Statut |
|---|---|---|---|
| Q1 | 🟠 | La mission de la Famille « couronne » faisait apparaître des PNJ à une coordonnée brute, donc parfois dans un bâtiment. | ✅ Les ennemis apparaissent sur le trottoir le plus proche. |
| Q2 | 🟠 | L'auto-visée pouvait cibler Momo (le partenaire, invulnérable) et faisait gaspiller des balles. | ✅ Le partenaire et les gardes du corps sont exclus des cibles. |
| Q3 | 🟡 | Les voyous « armés » d'un pistolet ne faisaient que donner des coups de poing. | ✅ Ils tirent à distance (précision modérée, couverture). |
| Q4 | 🟡 | Le multijoueur n'est testé qu'entre onglets du même navigateur : relais nostr, NAT et 4G ne sont pas couverts. | 📌 Session de test à 4 vrais téléphones (Wi-Fi + 4G), protocole dans `docs/MULTIPLAYER.md`. |
| Q5 | ⚪ | Les FPS mesurés en e2e (≈ 5 à 8) viennent du rendu logiciel headless, pas des téléphones. | 📌 Ajouter un vrai téléphone de référence (Android milieu de gamme) au protocole de test. |

---

## 3. Tech lead / architecte solution

**Points forts**
- La simulation pure (`src/sim/`, sans Three.js ni DOM), le pas fixe à 60 Hz et les commandes sérialisables rendent le jeu testable sans écran.
- Le même code tourne en solo, comme hôte ou comme invité.
- Le contenu est piloté par les données (`src/data/`). Ajouter une mission ne demande pas de code.
- Le rendu reste léger : instancing par quartier, matériaux procéduraux, résolution adaptative.

**Constats**

| # | Gravité | Constat | Statut |
|---|---|---|---|
| A1 | 🟠 | `src/sim/world.ts` fait plus de 2 000 lignes : joueurs, combat, véhicules, boutiques, ramassages, population. Chaque nouvelle fonctionnalité y passe, d'où un risque de régressions. | 📌 Extraire `combat.ts`, `shops.ts`, `population.ts` et `pickups.ts`, sur le modèle des systèmes existants (`police`, `law`, `family`…). |
| A2 | 🟠 | Autorité P2P : l'hôte fait foi, mais c'est le téléphone d'un joueur. Un hôte modifié peut tout falsifier. | 📌 Serveur dédié faisant tourner la même simulation (Node + `SimWorld`, déjà sans DOM). C'est le chantier qui débloque monde persistant, territoires, échanges et anti-triche. |
| A3 | 🟡 | 6 Mo au premier chargement, dont 2 Mo pour Rapier (WASM en base64) et 1,9 Mo de personnages. | 📌 Rapier en `.wasm` séparé (compressé par le CDN), personnages en KTX2/Meshopt, chargement des intérieurs à la demande. |
| A4 | 🟡 | Les grades de la Famille sont dérivés des missions faites, sans nouveau champ de sauvegarde. C'est voulu : aucune désynchronisation possible. | ✅ Choix noté dans `DECISIONS.md`. |
| A5 | ⚪ | Le hook de debug `window.__streetz` était exposé à tous les joueurs (triche facilitée, fuite d'état). | ✅ Exposé seulement avec `?debug`, en dev et sous automate de test. |

---

## 4. Cybersécurité — tests de vulnérabilité (revue de code + tests d'attaque)

**Modèle de menace**

| Source | Cas | Ce qu'elle peut faire |
|---|---|---|
| Invité malveillant | Client modifié, cas le plus probable | Envoie n'importe quel JSON à l'hôte. |
| Hôte malveillant | — | Envoie n'importe quel instantané aux invités. |
| Signalisation | Relais nostr publics | Voit les identifiants de salle. |
| Le joueur lui-même | Triche locale (localStorage) | Modifie sa propre sauvegarde. |

| # | Gravité | Vulnérabilité trouvée | Impact | Statut |
|---|---|---|---|---|
| S1 | 🔴 | **Création d'argent infinie** : dépôt bancaire d'un montant négatif (`deposit:-1000000`). | Argent infini (solo et multi). | ✅ Montants forcés à des entiers ≥ 0, test de non-régression. |
| S2 | 🔴 | **Crash de l'hôte à distance** : un invité envoie un profil contenant une arme inconnue (`weapons: ["x"]`), ce qui fait planter `WEAPONS[x].melee`. | La partie de tout le monde s'arrête. | ✅ Profil filtré par listes blanches (armes, véhicules, vêtements, missions, business, logements), nombres bornés. |
| S3 | 🔴 | **Empoisonnement physique** : positions `NaN` ou `Infinity` dans le rapport d'un invité, injectées dans Rapier. | Crash ou monde corrompu. | ✅ `validReport` : nombres finis, bornes du monde, vitesses plafonnées. |
| S4 | 🟠 | **Réparation illégitime** : un dégât de véhicule négatif est accepté, donc le véhicule devient invulnérable. | Triche. | ✅ Dégât borné à [0, 500]. |
| S5 | 🟠 | **Actions arbitraires** : type d'action, taille de l'argument et nombre d'actions par message n'étaient pas limités. | Saturation, comportements imprévus. | ✅ Liste blanche des actions, argument ≤ 48 caractères, 6 actions maximum par message. |
| S6 | 🟠 | **Inondation** : aucune limite de débit par pair. | Déni de service de l'hôte. | ✅ 45 messages/s maximum par pair (normal : 20). |
| S7 | 🟠 | **Injection HTML** : un hôte modifié pouvait glisser du HTML dans les nombres affichés via `innerHTML` (records, primes, contrats). | XSS ou hameçonnage dans l'interface. | ✅ Nombres convertis avant affichage + CSP qui interdit tout script injecté. |
| S8 | 🟡 | **Pseudo piégé** : caractères de contrôle et d'inversion bidi (usurpation visuelle), types non chaîne. | Usurpation, crash. | ✅ `cleanName`. |
| S9 | 🟡 | **Événement privé diffusé** : l'événement « promu » aurait été envoyé à tous les joueurs. | Fuite d'information mineure. | ✅ Ajouté à la liste des événements privés. |
| S10 | 🟡 | **Triche par la sauvegarde** : un joueur peut éditer son localStorage et arriver en ligne niveau 100 avec 10 M€. | Économie en ligne faussée. | 📌 Inévitable sans serveur ; le serveur dédié gardera les profils (A2). |

**Tests ajoutés** (`tests/core.test.ts`) :
- profil hostile ;
- rapports `NaN`, hors du monde ou avec dégâts négatifs ;
- actions inconnues ou trop nombreuses ;
- pseudo piégé ;
- limiteur de débit ;
- dépôt négatif ;
- intérieurs dans les bornes.

---

## 5. Durcissement (hardening)

| # | Gravité | Mesure | Statut |
|---|---|---|---|
| H1 | 🟠 | Politique de sécurité du contenu (CSP) : seulement nos scripts et le WASM de la physique ; connexions limitées à HTTPS/WSS ; ni `object`, ni `base` externe, ni formulaire. | ✅ Dans `index.html`. GitHub Pages ne permet pas d'en-têtes HTTP : `frame-ancestors` (anti-iframe) sera à poser côté serveur ou CDN. |
| H2 | 🟡 | `Referrer-Policy: no-referrer`. | ✅ |
| H3 | 🟡 | Le service worker mettait en cache les pages d'erreur 404/500, ce qui pouvait bloquer un joueur hors ligne sur une page cassée. | ✅ Seules les réponses OK sont gardées ; nouveau nom de cache. |
| H4 | 🟡 | Dépendances : 0 vulnérabilité dans ce qui est livré aux joueurs (three, rapier, trystero). 8 alertes sur les outils de développement (vitest/tinypool, esbuild, sharp), jamais déployés. | ✅ Correctifs sans risque appliqués ; 📌 montée de version vitest/vite au prochain jalon. Le serveur de dev (`--host`) ne doit pas être exposé sur un réseau public. |
| H5 | ⚪ | CI : actions GitHub référencées par étiquette (`@v4`), jeton en écriture sur tout le job. | ✅ `persist-credentials: false`, audit des dépendances de prod dans la CI, Dependabot hebdomadaire. 📌 Épingler les actions par SHA. |

---

## 6. Gouvernance, risque, conformité (GRC) et IAM

**IAM**
- Pas de comptes : l'identité d'un joueur est un identifiant aléatoire par connexion (trystero) et un pseudo libre.
- Le « droit » d'agir sur la partie appartient à l'hôte, élu (plus petit identifiant).

| # | Gravité | Constat | Statut |
|---|---|---|---|
| G1 | 🟠 | Jeu PEGI 18 (violence, sang, armes) sans contrôle d'âge. | ✅ Écran « J'ai 18 ans ou plus » au premier lancement (déclaratif, standard des jeux web). |
| G2 | 🟠 | RGPD : en P2P WebRTC, l'adresse IP de chaque joueur est visible des autres joueurs de la salle, sans que personne en soit informé. | ✅ Mention dans l'écran multijoueur. 📌 Politique de confidentialité complète et mentions légales (éditeur, hébergeur) avant tout lancement public. Le serveur dédié (relais) supprimera l'exposition des IP. |
| G3 | 🟡 | Données stockées : progression dans le localStorage du téléphone, rien côté serveur, aucun traceur. | ✅ Bon point : pas de bannière cookies nécessaire tant qu'il n'y a ni pub ni analytics. |
| G4 | 🟡 | Pas de modération : pseudos et noms de crew libres, visibles par tous en monde ouvert. | 📌 Filtre de mots interdits (FR/EN) et signalement d'un joueur ; plus tard, comptes et bannissements côté serveur. |
| G5 | 🟡 | IAM futur (serveur) : comptes (Apple/Google/e-mail sans mot de passe), rôles joueur / modérateur / admin, journal des actions d'admin, principe du moindre privilège sur la base et la CI. | 📌 À cadrer avec le choix d'hébergement. |
| G6 | ⚪ | Propriété intellectuelle : assets CC0 tracés dans `CREDITS.md`, aucune marque ni lieu réel, sons et musique générés par code. | ✅ Conforme. |

---

## 7. MCS / MCO (maintien en condition de sécurité et opérationnelle)

| # | Gravité | Constat | Statut |
|---|---|---|---|
| M1 | 🟠 | Aucune remontée d'erreurs : quand ça plante chez un testeur, on ne sait rien. | ✅ Journal des 15 dernières erreurs et bouton « 🐞 Copier un rapport de bug » dans la pause (version, build, appareil, FPS, position, mission, erreurs). Rien n'est envoyé : le testeur colle le rapport dans son message. 📌 Plus tard : Sentry ou équivalent auto-hébergé, avec consentement. |
| M2 | 🟡 | La version affichée était saisie à la main. | ✅ Numéro de build (commit) affiché dans la pause et dans les rapports. |
| M3 | 🟡 | Déploiement : chaque push sur `main` part en production après les tests et le build. Pas de pré-prod ni de retour arrière en un clic. | 📌 Branche `staging` publiée sur une autre URL ; retour arrière = re-déployer le commit précédent (gh-pages garde l'historique). |
| M4 | 🟡 | Sauvegardes : profil local versionné (v2) avec migration et assainissement. Un joueur qui change de téléphone perd tout. | 📌 Comptes + sauvegarde serveur (A2). En attendant : export/import d'un code de sauvegarde. |
| M5 | ⚪ | Veille sécurité : Dependabot ajouté, `npm audit` en CI. | ✅ |

---

## 8. UX / UI et web design

| # | Gravité | Constat | Statut |
|---|---|---|---|
| U1 | 🟠 | Trop de systèmes (niveaux, contrats, chaos, respect, casier, fiches, compétences, Famille…) sans hiérarchie claire pour un nouveau joueur. | ✅ La Famille devient le fil conducteur, en tête du panneau 📋 : grade, échelle des 7 grades, prochaine mission, avantage suivant. 📌 Révéler les systèmes progressivement (contrats au niveau 2, casier à la première amende…). |
| U2 | 🟡 | Le panneau de progression est long en paysage (défilement). | 📌 Onglets : Famille · Perso · Contrats · Classement. |
| U3 | 🟡 | Missions verrouillées par niveau : il manquait la raison. | ✅ « 🔒 Niveau X requis » sur le marqueur, dans le toast et dans le panneau. |
| U4 | 🟡 | Rendu sans anti-crénelage en qualité moyenne : les bords crénelés se voient beaucoup sur les toits et les lampadaires. | ✅ MSAA activé en moyen (quasi gratuit sur GPU mobiles « tile-based »). |
| U5 | ⚪ | Accessibilité : boutons étiquetés (`aria-label`), contraste correct, vibrations. Il manque le réglage de taille des boutons et le mode gaucher. | 📌 |

---

## 9. Spécialiste jeu vidéo (game design)

**Boucles**
- Courte : chaos, combo, cash.
- Moyenne : missions, niveaux, déblocages.
- Longue :
  - **grades de la Famille** (nouveau : 7 grades, 11 missions, avantages concrets à chaque promotion) ;
  - business, appartements, respect.

**Grades de la Famille (test 12)**

| Grade | Comment y accéder | Ce que ça apporte |
|---|---|---|
| Guetteur | Prologue | — |
| Petite main | 2 missions | +10 % sur les gains |
| Soldat | 2 missions | Une part de 250 € toutes les 10 minutes |
| Lieutenant | 2 missions | 1 garde du corps |
| Capo | 2 missions | 2 gardes, l'avocat (amendes −30 %) |
| Bras droit | 2 missions | 3 gardes |
| Parrain | Mission finale « La couronne » | 4 gardes, 3 000 € / 10 min, +75 % sur les gains |

Chaque promotion donne une bannière, une fanfare, une prime et un discours du Don.

**Risques**
- Économie inflationniste : les salaires des hauts grades et les business enrichissent vite. 📌 Il faut des puits à argent : immobilier haut de gamme, véhicules de luxe, cosmétiques, cautions plus chères aux hauts grades.
- Contenu solo fini (11 missions). 📌 Missions répétables générées (rackets, livraisons, guerres de rue) par grade, et événements hebdomadaires.

---

## 10. Marketing — exportabilité, lancement, publicité

**Positionnement.** « Le GTA de poche qui se lance en 3 secondes dans le navigateur, entre potes. » Ses forces :
- zéro installation, un lien partageable ;
- le style cartoon assumé ;
- la police « négociable » et la montée dans la Famille, qui donnent des histoires à raconter.

**Exportabilité**

| Frein | Gravité | Piste |
|---|---|---|
| Français uniquement | 🟠 | Anglais en priorité, puis espagnol et portugais (Brésil), où le genre GTA-like mobile est très fort. Les textes sont déjà regroupés dans les données (`src/data/`), donc la traduction est faisable. |
| Décor inspiré de Paris | ⚪ | C'est une force (exotisme) si le jeu reste lisible. Garder des noms fictifs. |
| 18+ | 🟠 | Ciblage publicitaire restreint. Plusieurs portails web (Poki, par exemple) refusent les contenus violents. Viser CrazyGames (contenu mature encadré), itch.io et le site propre. Sur les stores (Capacitor) : classification IARC/PEGI 18, ce qui est accepté. |
| Rétention en ligne sans serveur | 🟠 | Un monde ouvert vide si personne n'est connecté. Le serveur dédié et des bots dans les salles publiques sont prioritaires avant d'acheter du trafic. |

**Plan de lancement proposé**
1. **Bêta fermée** (2 à 4 semaines) : 30 à 100 testeurs via un Discord. On mesure la rétention J1/J7 et la durée de session, et on corrige le top 10 des bugs (bouton 🐞).
2. **Soft launch FR/BE/CH** (web) :
   - contenu organique TikTok et Shorts (moments drôles : police négociable, chaos, promotions) ;
   - créateurs gaming FR petits et moyens, payés à la vidéo ou à la performance ;
   - les publicités payantes montrant armes ou violence sont refusées ou limitées sur la plupart des régies, donc les créas doivent montrer la course-poursuite, l'humour et la progression, pas le sang.
3. **Version anglaise et stores** (Capacitor), avec fiche et vidéo de gameplay, et ASO sur « open world », « crime », « multiplayer ».

**Monétisation (rappel de `GAME_DESIGN.md`, avec contraintes légales)**
- Cosmétiques (tenues, peintures, emotes), passe saisonnier, abonnement « VIP » (bonus de confort, pas de puissance).
- **Pas de loot boxes payantes** : interdites ou encadrées dans plusieurs pays (Belgique, Pays-Bas…), et risque réglementaire en France.
- Pub récompensée optionnelle (x2 sur un contrat). Elle impose une bannière de consentement (CMP) et une mise à jour de la politique de confidentialité.

---

## 11. Graphisme (test 12)

Améliorations faites, sans coût notable en performance :
- **Trottoirs et places pavés** : dalles en quinconce, joints, légère variation de teinte, bordure de trottoir usée, côtés de bordure en pierre.
- **Ciel vivant** : disque solaire avec halo chaud, nuages cartoon qui dérivent. Le tout est calculé dans le shader du ciel, sans texture.
- **Rendu des couleurs** : courbe de tons « neutre » (contraste plus profond sans délaver les couleurs cartoon).
- **Anti-crénelage** en qualité moyenne, ombres douces en qualité haute.

📌 Ensuite :
- jour/nuit avec néons (déjà prévu dans le plan) ;
- occlusion ambiante cuite au pied des bâtiments ;
- reflets d'eau ;
- particules de pluie.

---

## 12. Contre-audit externe (ChatGPT, 24/10) — ce qui a été retenu

| Constat externe | Verdict | Statut |
|---|---|---|
| Profil forgé : compétences à 999, endurance qui soigne au lieu de blesser | Juste (déjà en partie bloqué par `sanitize` en test 12) | ✅ Lecture plafonnée à 10 en plus, dégâts jamais négatifs, test |
| Position à 900 000 m, dégâts véhicule négatifs | Juste, corrigé en test 12 (`validReport`) | ✅ |
| Banque : montants négatifs | Juste, corrigé en test 12 | ✅ |
| Crews identifiés par leur nom (deux crews homonymes = alliés) | Juste | ✅ Identifiant unique de crew |
| Fuite GPU au changement de qualité (104 → 713 géométries) | Juste | ✅ Libération de l'ancienne ville, test e2e (83 → 83) |
| Écart PvP trop fort entre vétéran et novice | Juste | ✅ Bonus de compétences divisés par 2 contre des joueurs |
| CI sans PR | Juste | ✅ Tests et build sur chaque pull request |
| Zone d'intérêt 130 m et fusil de précision 150 m | Juste | ✅ 170 m quand on tient le fusil |
| Serveur autoritaire, comptes, persistance, salles durables | Juste, c'est le chantier n° 1 | 📌 Décision d'hébergement à prendre |
| QG constructible au cœur du produit | Rejoint la demande du testeur | ✅ Première version : planque à aménager, meubles utiles |
| « Suspendre l'expansion du catalogue » | Partiellement : le stuff ajouté sert la boucle (sortir, ramasser, rentrer ranger au coffre) | — |
