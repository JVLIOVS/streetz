import type { VehicleType } from './vehicles';
import type { WeaponId } from './weapons';

/**
 * Story missions, as pure data. Each mission is a list of steps run by the
 * simulation (src/sim/missions.ts). Mission entities (thugs, witness, target car)
 * are ordinary sim entities: other players can see them, help or get in the way.
 */
export type MissionStep =
  /** Reach a point (on foot or by car). `time` = countdown in seconds. */
  | { kind: 'goto'; text: string; x: number; z: number; r?: number; time?: number }
  /** Reach the door of a building (id, or kind for unique buildings). */
  | { kind: 'door'; text: string; interior: string; time?: number }
  /** Knock out a group of thugs spawned around (x, z). */
  | { kind: 'kill'; text: string; x: number; z: number; count: number; boss?: string; armed?: boolean }
  /** A witness follows you to (x, z); thugs ambush you halfway. */
  | { kind: 'escort'; text: string; x: number; z: number; ambush: number }
  /** Destroy a car fleeing through traffic. */
  | { kind: 'destroy'; text: string; vehicle: VehicleType }
  /** Own a firearm with ammo. */
  | { kind: 'armed'; text: string }
  /** Complete a robbery in that building (id, or any building of that kind). */
  | { kind: 'rob'; text: string; interior: string }
  /** Get rid of the police. */
  | { kind: 'lose'; text: string }
  /** Tutorial: knock somebody out / drive any vehicle / park it in your garage. */
  | { kind: 'ko'; text: string }
  | { kind: 'drive'; text: string }
  | { kind: 'store'; text: string }
  /** Hold this weapon (switch with the weapon button). */
  | { kind: 'equip'; text: string; weapon: WeaponId }
  /** Break street props. */
  | { kind: 'break'; text: string; count: number }
  /** Get noticed: reach this many stars. */
  | { kind: 'wanted'; text: string; stars: number };

/** Extras any step can have: a partner line when it starts, a weapon handed over. */
export type MissionStepFull = MissionStep & {
  say?: string;
  give?: { weapon: WeaponId; ammo: number };
  /** You carry this item during the step: knocked out, it falls where you dropped and you must go back for it. */
  carry?: string;
};

export interface MissionDef {
  id: string;
  name: string;
  /** Who gives the job (shown in the start toast). */
  giver: string;
  pitch: string;
  /** Where the job starts (snapped to the nearest sidewalk). */
  x: number;
  z: number;
  requires?: string;
  /** Player level needed. */
  level?: number;
  /** Rank in the Family this job belongs to (src/data/family.ts): finish them all to be promoted. */
  family?: number;
  /** Started automatically (tutorial), no marker on the map. */
  auto?: boolean;
  /** A partner (bot) who follows you and talks you through the job. */
  partner?: string;
  /** Partner's last words. */
  outro?: string;
  reward: number;
  rep: number;
  steps: MissionStepFull[];
}

export const MISSIONS: MissionDef[] = [
  {
    // The prologue: a bank job with Momo, who teaches every button on the way.
    id: 'tuto',
    name: 'Le premier coup',
    giver: 'Momo',
    pitch: 'Yo, moi c’est Momo. On va braquer la Banque Centrale, toi et moi. Mais d’abord, montre-moi ce que tu vaux.',
    x: 0,
    z: 0,
    auto: true,
    partner: 'Momo',
    reward: 1500,
    rep: 250,
    steps: [
      { kind: 'ko', text: 'Mets un passant K.O. (bouton rouge, tape plusieurs fois)', say: 'Choisis un passant et mets-le K.O. Le bouton rouge, c’est tes poings.' },
      {
        kind: 'equip',
        weapon: 'pistol',
        give: { weapon: 'pistol', ammo: 36 },
        text: 'Sors le pistolet : touche l’arme en haut à droite',
        say: 'Pas mal. Tiens, un pistolet. Touche ton arme en haut à droite pour le sortir.',
      },
      { kind: 'break', count: 3, text: 'Tire sur 3 objets de la rue (la visée est automatique)', say: 'Entraîne-toi : tire sur des poubelles ou des lampadaires. Ça vise tout seul.' },
      { kind: 'drive', text: 'Vole une voiture : approche-toi d’une portière, bouton Monter', say: 'Il nous faut une caisse. Vole celle que tu veux, je monte avec toi.' },
      { kind: 'door', interior: 'bank', text: 'Conduis jusqu’à la banque (colonne jaune, flèche sur la carte)', say: 'Direction la Banque Centrale. Suis la colonne jaune, gaz à droite, frein à gauche.' },
      { kind: 'rob', interior: 'bank', text: 'Entre et braque le comptoir : reste près jusqu’au bout', say: 'On entre. Va au comptoir, appuie sur Braquer et reste collé jusqu’à la fin. Je surveille la porte.' },
      { kind: 'lose', text: 'Sème la police : sors du cercle de la carte et cache-toi', say: 'L’alarme ! Sors, prends une autre caisse ou un scooter, et sème-les : quitte le cercle sur la carte et planque-toi. Le garage 🔧 repeint les voitures.' },
      { kind: 'door', interior: 'hideout', text: 'Rentre à ta planque pour partager le butin', say: 'On les a semés ! Rendez-vous à ta planque, maison jaune sur la carte.' },
    ],
    outro:
      'Bien joué, associé. Maintenant la ville est à toi : missions avec les « ! » jaunes, contrats du jour 📋, le receleur €, les colis… ou fous juste le bordel. À plus !',
  },
  // ---------------------------------------------------------- Guetteur
  {
    id: 'colis',
    name: 'Colis express',
    giver: 'Momo',
    pitch: 'La Famille Corvi cherche des petits nouveaux. Livre ce colis sur la Rive Haute, vite, et on parlera de toi au Don.',
    x: -20,
    z: -62,
    family: 1,
    reward: 600,
    rep: 30,
    steps: [
      { kind: 'goto', text: 'Récupère le colis devant la supérette', x: 27, z: -74 },
      { kind: 'door', text: 'Livre le colis à la Résidence de la Rive', interior: 'apartment_rive', time: 90, carry: 'le colis' },
    ],
  },
  {
    id: 'dette',
    name: 'Le mauvais payeur',
    giver: 'Nadia',
    pitch: 'Le Grand Kader doit 2 000 balles à la Famille. Va lui rappeler les bonnes manières, à la Cité des Tilleuls.',
    x: -150,
    z: -40,
    requires: 'colis',
    family: 1,
    reward: 900,
    rep: 40,
    steps: [
      { kind: 'goto', text: 'Va à la Cité des Tilleuls', x: -300, z: -290, r: 18 },
      { kind: 'kill', text: 'Mets K.O. le Grand Kader et sa bande', x: -300, z: -290, count: 3, boss: 'Grand Kader' },
      { kind: 'goto', text: 'Reviens voir Nadia', x: -150, z: -40 },
    ],
  },
  // ---------------------------------------------------------- Petite main
  {
    id: 'temoin',
    name: 'Le témoin',
    giver: 'Inspecteur Roux',
    pitch: 'Je suis l’homme de la Famille dans la police. Un témoin doit déposer contre un rival : protège-le jusqu’au commissariat.',
    x: 75,
    z: -100,
    requires: 'dette',
    family: 2,
    reward: 1200,
    rep: 50,
    steps: [{ kind: 'escort', text: 'Escorte le témoin au commissariat', x: -43.5, z: -134, ambush: 3 }],
  },
  {
    id: 'racket',
    name: 'L’impôt du quartier',
    giver: 'Nadia',
    pitch: 'Les supérettes ne paient plus leur protection. Fais-leur comprendre. Deux suffiront, les autres entendront parler.',
    x: -60,
    z: 40,
    requires: 'temoin',
    level: 3,
    family: 2,
    reward: 1400,
    rep: 60,
    steps: [
      { kind: 'rob', text: 'Braque une supérette', interior: 'shop' },
      { kind: 'lose', text: 'Sème la police' },
      { kind: 'rob', text: 'Braque une autre supérette', interior: 'shop' },
      { kind: 'lose', text: 'Sème la police, puis on est quittes' },
    ],
  },
  // ---------------------------------------------------------- Soldat
  {
    id: 'rodeo',
    name: 'Rodéo',
    giver: 'Sonia du garage',
    pitch: 'Un type m’a piqué ma caisse de course, une voiture de la Famille. Je la veux en cendres.',
    x: 255,
    z: -150,
    requires: 'racket',
    level: 4,
    family: 3,
    reward: 1800,
    rep: 60,
    steps: [{ kind: 'destroy', text: 'Détruis la voiture volée (tire dessus ou percute-la)', vehicle: 'sports' }],
  },
  {
    id: 'convoi',
    name: 'Le convoi',
    giver: 'Sonia du garage',
    pitch: 'Des rivaux attendent une livraison à l’aéroport. On arrive avant eux, on les sèche, on rentre.',
    x: 300,
    z: -250,
    requires: 'rodeo',
    level: 5,
    family: 3,
    reward: 2400,
    rep: 80,
    steps: [
      { kind: 'drive', text: 'Prends une voiture', say: 'Prends une caisse rapide, l’aéroport c’est loin.' },
      { kind: 'goto', text: 'Fonce à l’aéroport avant les rivaux', x: -400, z: 380, r: 14, time: 150 },
      { kind: 'kill', text: 'Mets K.O. les rivaux et leur chauffeur', x: -400, z: 380, count: 4, boss: 'Le Chauffeur' },
      { kind: 'door', text: 'Rentre à la planque', interior: 'hideout' },
    ],
  },
  // ---------------------------------------------------------- Lieutenant
  {
    id: 'guerre',
    name: 'Guerre de territoire',
    giver: 'Don Corvi',
    pitch: 'Tu es Lieutenant maintenant. Les Tilleuls veulent notre rue. Montre-leur à qui elle appartient. Prends ton garde avec toi.',
    x: -80,
    z: -190,
    requires: 'convoi',
    level: 7,
    family: 4,
    reward: 3500,
    rep: 110,
    steps: [
      { kind: 'goto', text: 'Va au cœur de la Cité des Tilleuls', x: -340, z: -250, r: 18 },
      { kind: 'kill', text: 'Mets K.O. le Roi des Tilleuls et ses gars (ils sont armés)', x: -340, z: -250, count: 6, boss: 'Le Roi des Tilleuls', armed: true },
      { kind: 'lose', text: 'Sème la police' },
    ],
  },
  {
    id: 'casse',
    name: 'Le casse du siècle',
    giver: 'Le Professeur',
    pitch: 'La Banque Centrale, pour le Don. Trois temps : tu t’équipes, tu vides le coffre, tu disparais.',
    x: 150,
    z: -118,
    requires: 'guerre',
    level: 8,
    family: 4,
    reward: 5000,
    rep: 150,
    steps: [
      { kind: 'armed', text: 'Équipe-toi : une arme à feu chargée (Armurerie)' },
      { kind: 'rob', text: 'Braque la Banque Centrale', interior: 'bank' },
      { kind: 'lose', text: 'Sème la police' },
      { kind: 'door', text: 'Planque-toi : rentre à ta planque', interior: 'hideout' },
    ],
  },
  // ---------------------------------------------------------- Capo
  {
    id: 'traitre',
    name: 'Le traître',
    giver: 'Don Corvi',
    pitch: 'Lucky nous a vendus aux flics. Il fuit en 4×4 avec ses gardes. Personne ne trahit la Famille.',
    x: 220,
    z: 60,
    requires: 'casse',
    level: 10,
    family: 5,
    reward: 6000,
    rep: 180,
    steps: [
      { kind: 'destroy', text: 'Arrête le 4×4 de Lucky (détruis-le)', vehicle: 'offroad' },
      { kind: 'kill', text: 'Mets K.O. Lucky et ses gardes', x: 300, z: 300, count: 4, boss: 'Lucky', armed: true, say: 'Il s’est réfugié dans le parc. Finis le travail.' },
    ],
  },
  {
    id: 'bijoux',
    name: 'Les diamants du Don',
    giver: 'Le Professeur',
    pitch: 'Le Don veut un cadeau pour sa fille : la vitrine entière de la Bijouterie Saphir.',
    x: 230,
    z: -90,
    requires: 'traitre',
    level: 11,
    family: 5,
    reward: 7000,
    rep: 200,
    steps: [
      { kind: 'armed', text: 'Prends une arme à feu chargée' },
      { kind: 'rob', text: 'Braque la Bijouterie Saphir', interior: 'jewelry' },
      { kind: 'lose', text: 'Sème la police' },
      { kind: 'door', text: 'Apporte les diamants à la planque', interior: 'hideout', carry: 'les diamants' },
    ],
  },
  // ---------------------------------------------------------- Bras droit
  {
    id: 'couronne',
    name: 'La couronne',
    giver: 'Don Corvi',
    pitch: 'Je suis vieux. Le Parrain des Quais veut ma place. Écrase-le et la Famille est à toi.',
    x: -130,
    z: 100,
    requires: 'bijoux',
    level: 13,
    family: 6,
    reward: 15000,
    rep: 400,
    steps: [
      { kind: 'wanted', text: 'Montre à la ville qui commande : atteins 3 étoiles', stars: 3 },
      { kind: 'lose', text: 'Sème la police' },
      { kind: 'kill', text: 'Mets K.O. le Parrain des Quais et sa garde', x: 290, z: 330, count: 7, boss: 'Le Parrain des Quais', armed: true },
      { kind: 'door', text: 'Rentre à la planque : la ville t’appartient', interior: 'hideout' },
    ],
  },
];

export const missionById = (id: string | null) => MISSIONS.find((m) => m.id === id);

/** Replaying a finished mission pays less. */
export const REPLAY_FACTOR = 0.5;
