import type { VehicleType } from './vehicles';

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
  | { kind: 'kill'; text: string; x: number; z: number; count: number; boss?: string }
  /** A witness follows you to (x, z); thugs ambush you halfway. */
  | { kind: 'escort'; text: string; x: number; z: number; ambush: number }
  /** Destroy a car fleeing through traffic. */
  | { kind: 'destroy'; text: string; vehicle: VehicleType }
  /** Own a firearm with ammo. */
  | { kind: 'armed'; text: string }
  /** Complete a robbery in that building (id or kind). */
  | { kind: 'rob'; text: string; interior: string }
  /** Get rid of the police. */
  | { kind: 'lose'; text: string }
  /** Tutorial: knock somebody out / drive any vehicle / park it in your garage. */
  | { kind: 'ko'; text: string }
  | { kind: 'drive'; text: string }
  | { kind: 'store'; text: string };

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
  /** Started automatically (tutorial), no marker on the map. */
  auto?: boolean;
  reward: number;
  rep: number;
  steps: MissionStep[];
}

export const MISSIONS: MissionDef[] = [
  {
    id: 'tuto',
    name: 'Bienvenue à Belleplace',
    giver: 'Momo',
    pitch: 'Nouveau dans le quartier ? Montre-moi ce que tu vaux.',
    x: 0,
    z: 0,
    auto: true,
    reward: 500,
    rep: 100,
    steps: [
      { kind: 'ko', text: 'Mets un passant K.O. (bouton rouge)' },
      { kind: 'drive', text: 'Vole une voiture (approche-toi, bouton Monter)' },
      { kind: 'store', text: 'Fonce à ta planque et gare-la : elle sera à toi' },
    ],
  },
  {
    id: 'colis',
    name: 'Colis express',
    giver: 'Momo',
    pitch: 'Un colis à livrer sur la Rive Haute. Fais vite, le client attend pas.',
    x: -20,
    z: -62,
    reward: 600,
    rep: 30,
    steps: [
      { kind: 'goto', text: 'Récupère le colis devant la supérette', x: 27, z: -74 },
      { kind: 'door', text: 'Livre le colis à la Résidence de la Rive', interior: 'apartment_rive', time: 90 },
    ],
  },
  {
    id: 'dette',
    name: 'Le mauvais payeur',
    giver: 'Nadia',
    pitch: 'Le Grand Kader me doit 2 000 balles. Va lui rappeler les bonnes manières, à la Cité des Tilleuls.',
    x: -150,
    z: -40,
    requires: 'colis',
    reward: 900,
    rep: 40,
    steps: [
      { kind: 'goto', text: 'Va à la Cité des Tilleuls', x: -300, z: -290, r: 18 },
      { kind: 'kill', text: 'Mets K.O. le Grand Kader et sa bande', x: -300, z: -290, count: 3, boss: 'Grand Kader' },
      { kind: 'goto', text: 'Reviens voir Nadia', x: -150, z: -40 },
    ],
  },
  {
    id: 'temoin',
    name: 'Le témoin',
    giver: 'Inspecteur Roux',
    pitch: 'Un témoin doit déposer au commissariat. Des gars veulent le faire taire : protège-le.',
    x: 75,
    z: -100,
    requires: 'dette',
    reward: 1200,
    rep: 50,
    steps: [{ kind: 'escort', text: 'Escorte le témoin au commissariat', x: -43.5, z: -134, ambush: 3 }],
  },
  {
    id: 'rodeo',
    name: 'Rodéo',
    giver: 'Sonia du garage',
    pitch: 'Un type m’a piqué ma caisse de course. Je la veux en cendres, pas question qu’il la garde.',
    x: 255,
    z: -150,
    requires: 'temoin',
    reward: 1800,
    rep: 60,
    steps: [{ kind: 'destroy', text: 'Détruis la voiture volée (tire dessus ou percute-la)', vehicle: 'sports' }],
  },
  {
    id: 'casse',
    name: 'Le casse du siècle',
    giver: 'Le Professeur',
    pitch: 'La Banque Centrale. Trois temps : tu t’équipes, tu vides le coffre, tu disparais.',
    x: 150,
    z: -118,
    requires: 'rodeo',
    reward: 5000,
    rep: 150,
    steps: [
      { kind: 'armed', text: 'Équipe-toi : une arme à feu chargée (Armurerie)' },
      { kind: 'rob', text: 'Braque la Banque Centrale', interior: 'bank' },
      { kind: 'lose', text: 'Sème la police' },
      { kind: 'door', text: 'Planque-toi : rentre à ta planque', interior: 'hideout' },
    ],
  },
];

export const missionById = (id: string | null) => MISSIONS.find((m) => m.id === id);

/** Replaying a finished mission pays less. */
export const REPLAY_FACTOR = 0.5;
