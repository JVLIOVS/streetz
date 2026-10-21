import './ui/style.css';
import { Sound } from './audio/sound';
import { loadSave, writeSave } from './core/save';
import { Game, LOCAL_PLAYER, type NetSession } from './game';
import { Controls } from './input/controls';
import { loadMap } from './maps/registry';
import type { MapData } from './maps/types';
import { NetClient } from './net/client';
import { NetHost } from './net/host';
import { joinLocalRoom, joinOnlineRoom, newRoomCode, type Transport } from './net/transport';
import { loadAssets, type GameAssets } from './render/assets';
import type { QualityLevel } from './render/quality';
import { GameRenderer } from './render/renderer';
import { SimWorld } from './sim/world';
import { Hud } from './ui/hud';

const $ = (id: string) => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const debug = params.has('debug');
/** `?net=local` uses a same-browser channel instead of the internet (tests, debugging). */
const localNet = params.get('net') === 'local';

const DENSITY: Record<QualityLevel, { peds: number; traffic: number; parkedRadius: number }> = {
  low: { peds: 24, traffic: 9, parkedRadius: 55 },
  medium: { peds: 38, traffic: 13, parkedRadius: 70 },
  high: { peds: 50, traffic: 18, parkedRadius: 85 },
};

type Mode = { kind: 'solo' } | { kind: 'host'; t: Transport; code: string } | { kind: 'guest'; t: Transport; code: string; id: string; host: string };

async function boot() {
  const save = loadSave();
  const qParam = params.get('quality') as QualityLevel | null;
  const quality: QualityLevel = qParam && ['low', 'medium', 'high'].includes(qParam) ? qParam : save.settings.quality;

  const status = $('loading');
  status.textContent = 'Chargement de la ville…';
  const assetsP = loadAssets((r) => (status.textContent = `Chargement des modèles… ${Math.round(r * 100)} %`));
  const map = await loadMap('paris');
  const assets = await assetsP;
  status.textContent = '';
  $('menu').classList.remove('hidden');

  // --- Lobby
  const netStatus = $('net-status');
  const nick = $('nick') as HTMLInputElement;
  const codeIn = $('code') as HTMLInputElement;
  nick.value = localStorage.getItem('streetz.nick') ?? '';
  let myLook = Number(localStorage.getItem('streetz.look'));
  if (!Number.isFinite(myLook) || myLook <= 0) {
    myLook = 1 + Math.floor(Math.random() * 1e6);
    localStorage.setItem('streetz.look', String(myLook));
  }
  const name = () => {
    const n = nick.value.trim().slice(0, 14) || `Joueur${Math.floor(Math.random() * 90 + 10)}`;
    localStorage.setItem('streetz.nick', n);
    return n;
  };
  const join = (code: string) => (localNet ? Promise.resolve(joinLocalRoom(code)) : joinOnlineRoom(code));
  let busy = false;

  const start = async (mode: Mode) => {
    if (busy) return;
    busy = true;
    void enterFullscreen(); // must happen during the tap
    netStatus.textContent = 'Préparation de la ville…';
    await new Promise((r) => setTimeout(r, 30));
    try {
      await launch(map, assets, quality, save, mode, mode.kind === 'solo' ? 'Toi' : name(), mode.kind === 'guest' ? myLook : -1);
    } catch (err) {
      busy = false;
      netStatus.textContent = `Erreur : ${(err as Error).message}`;
    }
  };

  $('btn-play').addEventListener('click', () => start({ kind: 'solo' }));
  $('btn-multi').addEventListener('click', () => {
    $('menu').classList.add('hidden');
    $('multi').classList.remove('hidden');
  });
  $('btn-back').addEventListener('click', () => {
    $('multi').classList.add('hidden');
    $('menu').classList.remove('hidden');
    netStatus.textContent = '';
  });
  $('btn-host').addEventListener('click', async () => {
    if (busy) return;
    void enterFullscreen();
    const code = newRoomCode();
    netStatus.textContent = `Création de la partie ${code}…`;
    const t = await join(code);
    await start({ kind: 'host', t, code });
  });
  $('btn-join').addEventListener('click', async () => {
    if (busy) return;
    const code = codeIn.value.trim().toUpperCase();
    if (code.length !== 4) {
      netStatus.textContent = 'Entre le code à 4 caractères de ton pote';
      return;
    }
    busy = true;
    void enterFullscreen();
    netStatus.textContent = `Connexion à la partie ${code}…`;
    try {
      const t = await join(code);
      const { id, host } = await NetClient.connect(t, name(), myLook);
      busy = false;
      await start({ kind: 'guest', t, code, id, host });
    } catch (err) {
      busy = false;
      netStatus.textContent = `${(err as Error).message}. Vérifie le code ou demande à ton pote de recréer la partie.`;
    }
  });
}

async function launch(map: MapData, assets: GameAssets, quality: QualityLevel, save: ReturnType<typeof loadSave>, mode: Mode, playerName: string, look: number) {
  const sim = await SimWorld.create(map, mode.kind === 'guest' ? 'replica' : 'authority');
  sim.density = DENSITY[quality];
  const localId = mode.kind === 'solo' ? LOCAL_PLAYER : mode.kind === 'host' ? mode.t.selfId : mode.id;
  const me = sim.addPlayer(localId);
  me.state.money = mode.kind === 'solo' ? save.progress.money : 500;
  me.state.name = playerName;
  me.state.look = look;

  const canvas = $('game') as HTMLCanvasElement;
  const view = new GameRenderer(canvas, map, sim, quality, assets);
  const controls = new Controls($('touch'), $('joy-base'), $('joy-knob'));
  const hud = new Hud(map);
  const sound = new Sound();
  const game = new Game(sim, view, controls, hud, sound, debug, localId);
  const persist = () => {
    if (mode.kind !== 'solo') return; // multiplayer money lives in the session
    save.progress.money = game.player.money;
    writeSave(save);
  };
  game.onSave = persist;

  let net: NetSession | null = null;
  if (mode.kind === 'host') {
    const host = new NetHost(mode.t, sim, mode.code);
    host.onPlayersChange = (n) => hud.setPlayers(n, mode.code);
    hud.setPlayers(1, mode.code);
    net = host;
  } else if (mode.kind === 'guest') {
    const client = new NetClient(mode.t, sim, localId, mode.host);
    client.onHostLost = () => {
      game.setPaused(true);
      $('ko').textContent = 'PARTIE TERMINÉE';
      $('ko').classList.remove('hidden');
      setTimeout(() => location.reload(), 4000);
    };
    hud.setPlayers(1, mode.code);
    setInterval(() => hud.setPlayers(sim.players.size, mode.code), 1000);
    net = client;
  }
  game.net = net;

  // Let the city fill up a little, then warm up shaders behind the start screen
  if (mode.kind !== 'guest') for (let i = 0; i < 40; i++) sim.step([]);
  view.render(localId, 1, 1 / 60, 0);

  // --- Buttons
  const tap = (el: HTMLElement, fn: () => void) =>
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('pressed');
      setTimeout(() => el.classList.remove('pressed'), 120);
      fn();
    });
  tap($('btn-jump'), () => controls.pressJump());
  const sprint = $('btn-sprint');
  tap(sprint, () => controls.toggleSprint());
  controls.onSprintChange = (on) => sprint.classList.toggle('on', on);
  controls.bindHold($('btn-attack'), 'attack', () => controls.pushAction('attack'));
  controls.bindHold($('btn-gas'), 'gas');
  controls.bindHold($('btn-brake'), 'brake');
  controls.bindHold($('btn-handbrake'), 'handbrake');
  tap($('btn-horn'), () => controls.pushAction('horn'));
  tap($('btn-action'), () => controls.pushAction('use'));
  tap($('btn-weapon'), () => controls.pushAction('weapon'));

  // --- Pause / quality menu
  const pause = $('pause');
  const qButtons = [...$('quality').querySelectorAll('button')] as HTMLButtonElement[];
  const markQuality = () => qButtons.forEach((b) => b.classList.toggle('on', b.dataset.q === view.quality));
  markQuality();
  tap($('btn-pause'), () => {
    game.setPaused(true);
    pause.classList.remove('hidden');
  });
  for (const b of qButtons) {
    b.addEventListener('click', () => {
      const q = b.dataset.q as QualityLevel;
      if (q === view.quality) return;
      view.setQuality(q);
      sim.density = DENSITY[q];
      save.settings.quality = q;
      writeSave(save);
      markQuality();
    });
  }
  $('btn-resume').addEventListener('click', () => {
    pause.classList.add('hidden');
    game.setPaused(false);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game.setPaused(true);
      pause.classList.remove('hidden');
      sound.suspend();
      persist();
    } else sound.start();
  });

  sound.start();
  $('start').classList.add('hidden');
  game.start();
  if (mode.kind === 'host') hud.toast(`Partie ${mode.code} : donne ce code à tes potes !`, 6);
  else if (mode.kind === 'guest') hud.toast(`Connecté à la partie ${mode.code}`, 3);
  else hud.toast('Joystick à gauche · glisse à droite pour la caméra', 3.5);

  (window as unknown as { __streetz: unknown }).__streetz = {
    game,
    sim,
    view,
    controls,
    net,
    localId,
    stats: () => ({ fps: game.fps, tick: sim.tick, ...view.stats(), player: sim.players.get(localId)!.state, peds: sim.peds.size, vehicles: sim.vehicles.size, players: sim.players.size }),
  };
}

async function enterFullscreen() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  try {
    if (!document.fullscreenElement) await (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.());
  } catch {
    /* iOS Safari has no fullscreen API for pages: the PWA install gives fullscreen there */
  }
  try {
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch {
    /* not supported everywhere */
  }
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

boot().catch((err) => {
  console.error(err);
  $('loading').textContent = `Erreur : ${err?.message ?? err}`;
});
