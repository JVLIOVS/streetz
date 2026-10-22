# STREETZ — Rétention et modèle économique

Ce document rassemble ce qui marche le mieux en psychologie du jeu et en jeu mobile, puis l'applique à STREETZ. Il propose aussi un modèle économique et un ordre de réalisation.
Les chiffres de marché sont des ordres de grandeur du secteur. Ce ne sont pas des promesses : on mesurera les nôtres.

---

## 1. Les grands principes (l'essentiel en une page)

| Principe | Ce que ça dit | Ce qu'on en tire |
|---|---|---|
| **Boucles imbriquées** | Un bon jeu a 3 boucles : *30 secondes* (action → retour immédiat), *une session de 5 à 15 min* (un objectif → une récompense), *plusieurs semaines* (progression, collection, statut). | Chaque seconde, chaque session et chaque semaine doivent avoir leur « prochaine chose à faire ». |
| **Autodétermination** (Deci & Ryan) | On reste quand on se sent **libre** (autonomie), **bon** (compétence) et **lié aux autres** (relation). | Monde ouvert = autonomie. Progression visible = compétence. Crews, coop, rivalités = relation. |
| **Flow** (Csikszentmihalyi) | Le plaisir maximal se trouve entre ennui et frustration : un défi qui monte au rythme du joueur. | Police graduelle (déjà là), missions de plus en plus dures, difficulté qui s'adapte un peu. |
| **Récompense variable** (Skinner, modèle *Hook* de Nir Eyal) | Une récompense *imprévisible* motive bien plus qu'une récompense fixe. Le cycle : déclencheur → action → récompense variable → investissement. | Butin aléatoire, voitures rares, colis surprises, contrats du jour tirés au hasard. |
| **Investissement / effet IKEA** | Plus on a construit quelque chose, plus on y tient. | Planque à aménager, garage de collection, perso personnalisé, crew. |
| **Effet Zeigarnik** | Une tâche inachevée reste en tête. | Toujours afficher le **prochain objectif** et ce qu'il manque (« plus que 350 € pour le fusil à pompe »). |
| **Gradient d'objectif** | On accélère quand on approche du but. | Barres de progression visibles, qu'on voit presque pleines en fin de session. |
| **Progrès offert** (*endowed progress*) | Une carte de fidélité déjà tamponnée 2 fois se remplit plus vite. | Le premier niveau démarre déjà rempli à 30 %. Une série de connexions démarre à « 1/7 ». |
| **Aversion à la perte** | Perdre fait 2 fois plus mal que gagner ne fait plaisir. | Série quotidienne qu'on ne veut pas casser ; revenus de la planque qui plafonnent si on ne passe pas les récupérer. **À doser** : trop de punition fait fuir. |
| **Preuve sociale / statut** | On veut ce que les autres ont et être vu. | Classements, voitures et tenues rares visibles dans le monde partagé, titres sous le pseudo. |
| **Types de joueurs** (Bartle) | Tueurs, accomplisseurs, explorateurs, sociables. | Tueurs → primes PvP, chaos. Accomplisseurs → missions, collection. Explorateurs → secrets, toits, cascades. Sociables → crews, coop. |
| **Les 8 moteurs** (Octalysis, Yu-kai Chou) | Sens, accomplissement, créativité, possession, social, rareté, imprévu, peur de perdre. | Les 4 premiers (« chapeau blanc ») font revenir *avec plaisir*. Les 4 derniers (« chapeau noir ») font revenir *par tension* : à utiliser avec parcimonie. |
| **Le « jus »** (*game feel*) | Le même coup de poing est 10 fois plus satisfaisant avec un arrêt sur image, un tremblement d'écran, un son et des particules. | Priorité n°1, et c'est peu coûteux à faire. |

**Ce que font les meilleurs** :
- **GTA Online** : chaos libre, business qui rapportent, braquages en coop, voitures de prestige.
- **Brawl Stars et Fortnite** : passe de saison, cosmétiques, défis du jour et de la semaine, événements limités.
- **Clash Royale** : coffres à ouvrir, collection.
- **Free Fire et PUBG Mobile** : sessions courtes, prise en main en 30 secondes.
- **Roblox (Jailbreak)** : flics contre voleurs entre joueurs, une boucle simple et sociale.

---

## 2. Diagnostic de STREETZ aujourd'hui

**Déjà là (bonne base)** :
- Liberté totale et chaos.
- Police graduelle, qui crée une tension naturelle.
- Butin aléatoire sur les piétons.
- Armes et véhicules à acheter, planque et garage, 5 missions.
- Monde partagé.

**Ce qui manque pour que les joueurs reviennent** :
1. **Rien ne mesure la progression du joueur** : la réputation existe mais ne débloque rien et ne se voit pas.
2. **Aucune raison de revenir demain** : pas de contrats du jour, pas de série, pas d'événement.
3. **Les 5 missions s'épuisent en 30 minutes** : il faut du contenu qui se renouvelle tout seul.
4. **Les coups et les explosions manquent de jus.**
5. **Le multijoueur n'a pas encore de but commun** : pas de coop obligatoire, pas de primes, pas de crews, pas de classement.
6. **Les 5 premières minutes ne guident pas le joueur** (pas de tutoriel). Le secteur perd typiquement 60 % des joueurs au premier jour : c'est là que tout se joue.

---

## 3. Les mécaniques à ajouter (appliquées à STREETZ)

### A. Boucle de 30 secondes : le chaos qui paie
- **Jus** :
  - Arrêt sur image de 50 à 80 ms à chaque coup.
  - Tremblement d'écran proportionnel aux dégâts, chiffres de dégâts qui s'envolent.
  - Ralenti de 0,3 s sur un K.O. ou une explosion.
  - Vibration du téléphone, sons plus gros.
- **Compteur de CHAOS** : chaque méfait (coup, objet cassé, voiture explosée, cascade) remplit un combo multiplicateur ×1 à ×5 qui retombe si on s'arrête. À la fin de la série, on encaisse de l'argent et de l'XP. Ça transforme le défouloir en jeu à score.
- **Cascades** : saut en voiture, dérapage long, conduite à contresens. Petits bonus affichés en direct (« DÉRAPAGE ! +120 »).
- **Récompenses variables dans la rue** :
  - Colis lumineux cachés (argent, munitions, rarement une arme).
  - **Voiture dorée rare** : apparaît 1 fois sur 50 dans la circulation et rapporte gros chez le receleur.
  - Piéton « VIP » plein aux as.

### B. Boucle de session (5–15 min) : toujours un objectif
- **Contrats du jour** : 3 contrats tirés au hasard chaque jour, renouvelés à minuit. Exemples : « Casse 20 lampadaires », « Livre 3 colis », « Sème 3★ ».
  - Faits par des **générateurs** (livraison, poursuite, élimination, vol de voiture sur commande, course) : le contenu devient infini sans rien écrire à la main.
- **Le receleur** : il commande des voitures précises (« une Berline sport rouge »). Volée, livrée, payée. C'est un *job board* qui se renouvelle sans fin, façon GTA.
- **Affichage du prochain objectif en permanence** : prochain niveau, prochaine arme abordable, prochain contrat. C'est l'effet Zeigarnik.
- **Fin de session satisfaisante** : un écran récapitulatif (« Aujourd'hui : +4 200 €, 2 contrats, niveau 7 → 8 ») qui donne envie de « finir la barre ».

### C. Boucle longue (semaines) : progression, collection, statut
- **Niveaux** (réputation → niveau 1 à 100, barre visible sous l'argent) :
  - Chaque niveau débloque quelque chose : arme, véhicule, tenue, emote, mission, quartier, business.
  - On doit **voir ce qui se débloque ensuite** : silhouette grisée, « Niveau 12 : Mitraillette ».
- **Business de la planque** (revenu passif à la GTA Online) :
  - On achète un garage clandestin, un atelier ou un labo de faux billets.
  - Ils produisent de l'argent toutes les heures, **plafonné à environ 8 h**, ce qui ramène le joueur 2 à 3 fois par jour.
  - Des missions de livraison permettent de vendre le stock et le défendre contre les autres joueurs : PvP naturel.
- **Collection** : un « Garage-dex » des véhicules volés et une garde-robe complète, avec des récompenses par série complétée.
- **Série de connexions** : récompense croissante sur 7 jours (le jour 7 donne une voiture ou une tenue exclusive). Si la série casse, **on recule d'un cran, on ne repart pas à zéro** (moins punitif, mieux noté).
- **Événements hebdomadaires** : « Semaine des braquages » (×2 sur les banques), « Nuit des rodéos »…

### D. Social et multijoueur (le moteur le plus puissant à long terme)
- **Primes entre joueurs** : un joueur à 4★ ou plus devient une **cible avec une prime** visible par tous. Le chasseur touche la prime. Si la cible survit 3 minutes, elle la double. C'est du flics contre voleurs entre joueurs, la boucle qui a fait le succès de Jailbreak sur Roblox.
- **Braquages en coop** : la grosse banque demande 2 à 4 joueurs (un qui pirate, un qui conduit, un qui couvre). Les gains sont partagés, avec des rôles à jouer.
- **Crews (gangs de joueurs)** : nom, couleur, logo sur les voitures. Territoires de quartier qui rapportent de l'argent au crew, et guerres de territoire le week-end.
- **Classements** : hebdomadaires (chaos, argent gagné, primes), par quartier et entre amis, remis à zéro chaque semaine pour que tout le monde garde une chance.
- **Être vu** : titres sous le pseudo (« Roi du Rodéo »), voitures rares et tenues saisonnières visibles par tous. C'est ce qui fait vendre les cosmétiques.

### E. Les 5 premières minutes (onboarding)
- **0:00 – Action immédiate**, pas de menu. Une voiture de police te course, il faut fuir. On apprend en faisant.
- **0:30 – Premier gros gain garanti** : un braquage guidé de supérette, +500 €.
- **2:00 – Première voiture à toi**, garée à ta planque. L'investissement commence.
- **4:00 – Premier niveau atteint**, avec une animation et un déblocage.
- **5:00** : le jeu propose les contrats du jour et montre les autres joueurs.
- **Règle** : aucun texte de plus de 8 mots ; une flèche et une action à la fois.

### F. Rappels (plus tard, avec l'appli Capacitor)
- Notifications utiles et rares, au maximum 1 par jour :
  - « Ton labo est plein. »
  - « Ta série du jour 6 t'attend : voiture exclusive demain. »
  - « Ton crew attaque la Cité ce soir. »
- Jamais de fausse urgence.

---

## 4. Le modèle économique

### Recommandation : gratuit, cosmétiques et passe de saison, **jamais de « payer pour gagner »**
Pourquoi : dans un jeu PvP en monde partagé, 95 à 98 % des joueurs ne paient jamais. Ce sont **eux le contenu** : les cibles, les rivaux, le monde vivant. Si les payeurs écrasent les autres avec des armes achetées, les non-payeurs partent, et le monde meurt pour tout le monde, payeurs compris. Fortnite et Brawl Stars font l'essentiel de leurs revenus avec des cosmétiques et un passe.

| Source | Contenu | Prix indicatif | Poids attendu |
|---|---|---|---|
| **Passe de rue** (saison de 8 semaines) | Une piste gratuite et une piste premium : 50 paliers de tenues, peintures, emotes, klaxons, effets de traînée, titres. Il rapporte assez de monnaie premium pour acheter le passe suivant si on le termine, ce qui fidélise. | 5,99 € | **La plus grosse part, et la plus stable** |
| **Boutique cosmétique tournante** | Tenues, skins de voiture, emotes, décoration de planque. Rotation quotidienne et hebdomadaire. | 1–15 € | Forte (pousse aussi au « reviens demain ») |
| **Pack de démarrage** (une seule fois, jours 1–3) | Tenue exclusive + voiture cosmétique + monnaie. Le premier achat est l'étape la plus dure : le rendre évident. | 1,99–4,99 € | Convertit les nouveaux joueurs |
| **Abonnement « VIP »** | Monnaie quotidienne + garage agrandi + business ×1,5 en confort (pas en combat). | 4,99 €/mois | Revenu récurrent |
| **Publicités récompensées** (optionnelles) | « Regarde une pub : ×2 sur ce contrat ». Seulement si le joueur choisit. | — | Monétise les 95 % de non-payeurs |
| **Accélérateurs de confort** | Doubler la production d'un business pendant 1 h, livraison instantanée d'une voiture. | Petits montants | Modérée, à doser |

**Une seule monnaie premium** (« Diamants »), en plus de l'argent du jeu (€ STREETZ) qui, lui, se gagne en jouant.
- Règle de l'UE (principes de la CPC, 2024) : le **prix en vrais euros** doit être affiché à côté du prix en Diamants.
- Pas de paquets de Diamants conçus pour laisser des « restes » inutilisables.

### À éviter absolument (risque légal, magasins d'applis, réputation)
- **Coffres aléatoires payants** :
  - Interdits de fait en Belgique.
  - Apple et Google imposent d'afficher les probabilités.
  - Le PEGI les signale sur la fiche du jeu.
  - Le cadre européen se durcit.
  - **À la place** : coffres aléatoires **gagnés en jouant** (très efficaces) et achats directs **à prix affiché** en boutique.
- **Casino avec une monnaie achetable** : c'est assimilable à un jeu d'argent, et GTA a dû le retirer dans plusieurs pays. Si on fait un casino, ce sera uniquement avec l'argent gagné en jouant, jamais avec des Diamants.
- **Armes ou statistiques de combat payantes** : c'est du « payer pour gagner », et ça tue le PvP.
- **Fausses urgences, abonnements cachés, prix trompeurs** : avis négatifs, risque de refus sur les stores, et ce sont des pratiques interdites en droit de la consommation européen.

### Les chiffres qui compteront (à mesurer dès le lancement)
- **Rétention à J1, J7 et J30** (part des joueurs qui reviennent après 1, 7 et 30 jours). Repères du secteur pour un bon jeu d'action mobile : environ 40 % à J1, 15 % à J7, 5 % à J30. C'est l'indicateur n°1 : sans rétention, l'argent ne sert à rien.
- **Durée et nombre de sessions par jour.**
- **Conversion** : part des joueurs qui font un premier achat. Typiquement 2 à 5 %.
- **ARPDAU** (revenu moyen par joueur actif et par jour) et **LTV** (revenu total par joueur sur sa vie dans le jeu). La LTV doit dépasser le **coût d'acquisition** d'un joueur par la pub, sinon on perd de l'argent à chaque installation.
- Il faudra un outil de mesure (événements anonymes, consentement RGPD).

### Ce que ça demande techniquement
Pour vendre quoi que ce soit, il faut d'abord :
1. **Des comptes joueurs** et une sauvegarde en ligne (aujourd'hui elle est sur le téléphone, donc facile à tricher).
2. **Un serveur qui fait autorité** : sinon les achats et la progression se trichent.
3. **Le paiement** : Stripe sur le web, ou les achats intégrés Apple/Google via Capacitor (commission de 15 à 30 %).
4. Un statut d'**entreprise** (micro-entreprise au minimum), des CGV et une politique de confidentialité.

---

## 5. Ordre de réalisation proposé

**Phase 1 — rendre le jeu « collant », sans argent réel** — ✅ faite (version test 5) :
1. Le jus (arrêt sur image, tremblement d'écran, ralenti, vibrations) et le compteur de CHAOS.
2. Les niveaux 1–100 avec barre d'XP et déblocages visibles.
3. Les contrats du jour générés au hasard, le receleur, la série de connexions.
4. Les colis surprises, la voiture dorée, le piéton VIP.
5. Le tutoriel des 5 premières minutes et l'écran récapitulatif de fin de session.
6. Les business de la planque avec revenu passif plafonné.

**Phase 2 — social** (le monde ouvert P2P suffit pour tester, un serveur pour le vrai) :
primes entre joueurs, braquage en coop, crews et territoires, classements hebdomadaires.

**Phase 3 — monétisation** (nécessite serveur, comptes et paiement) :
boutique cosmétique, Passe de rue saison 1, pack de démarrage, puis VIP et publicités récompensées.

**Décisions à prendre par le propriétaire du projet avant la phase 3** :
- l'hébergement du serveur (environ 5 à 20 €/mois au début) ;
- le statut juridique ;
- web seul, ou applis sur les stores (compte Apple 99 $/an, Google 25 $ une fois).
