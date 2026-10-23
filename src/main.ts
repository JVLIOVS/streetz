import './ui/style.css';
import { Sound } from './audio/sound';
import { loadSave, writeSave } from './core/save';
import { applyProfile, profileOf } from './sim/player';
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
import { localDay, nowSeconds } from './core/clock';
import { CREW_PRICE } from './data/social';

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

/** `public`: the shared open world (rooms PUB1, PUB2…, the first player there hosts). */
/** Solo `after`: what to do once the prologue is over (first time online: prologue first). */
type Mode = { kind: 'solo'; after?: string } | { kind: 'host'; t: Transport; code: string; public?: boolean } | { kind: 'guest'; t: Transport; code: string; id: string; host: string; public?: boolean };

const PUBLIC_SHARDS = 6;

/** Reloads straight into the open world (host left, or two hosts elected at once). */
function rejoinPublic() {
  const q = new URLSearchParams(location.search);
  q.set('auto', 'public');
  location.replace(`${location.pathname}?${q}`);
}

/**
 * Mobile browsers zoom on double-tap and pinch, even with user-scalable=no (iOS ignores
 * it). Hammering the punch button triggered it. Block those gestures, and if the page
 * still ends up zoomed, snap it back.
 */
function preventZoom() {
  let lastTouch = 0;
  addEventListener(
    'touchend',
    (e) => {
      // only on the game screen: menus need their quick taps to become clicks
      const t = e.target as Element | null;
      if (!t?.closest?.('#hud, #touch')) return;
      const now = performance.now();
      if (now - lastTouch < 350 && e.cancelable) e.preventDefault();
      lastTouch = now;
    },
    { passive: false },
  );
  addEventListener('touchmove', (e) => (e as TouchEvent & { scale?: number }).scale !== undefined && (e as TouchEvent & { scale: number }).scale !== 1 && e.cancelable && e.preventDefault(), { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  const meta = document.querySelector('meta[name=viewport]');
  const base = meta?.getAttribute('content') ?? '';
  const unzoom = () => {
    if (!meta || !window.visualViewport || window.visualViewport.scale <= 1.01) return;
    // rewriting the viewport tag makes the browser go back to scale 1
    meta.setAttribute('content', base.replace('maximum-scale=1', 'maximum-scale=1.0001'));
    requestAnimationFrame(() => meta.setAttribute('content', base));
    scrollTo(0, 0);
  };
  window.visualViewport?.addEventListener('resize', unzoom);
  setInterval(unzoom, 1000);
}
preventZoom();

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

  // Audio must be unlocked by a tap (mobile browsers): any tap on the menus does it
  const sound = new Sound();
  sound.setSettings(save.settings.sfx, save.settings.music);
  const unlock = () => sound.unlock();
  addEventListener('pointerdown', unlock, true);
  addEventListener('touchend', unlock, true);
  addEventListener('click', unlock, true);

  const start = async (mode: Mode) => {
    if (busy) return;
    busy = true;
    void enterFullscreen(); // must happen during the tap
    netStatus.textContent = 'Préparation de la ville…';
    await new Promise((r) => setTimeout(r, 30));
    try {
      await launch(map, assets, quality, save, mode, mode.kind === 'solo' ? 'Toi' : name(), mode.kind === 'guest' ? myLook : -1, sound);
    } catch (err) {
      busy = false;
      netStatus.textContent = `Erreur : ${(err as Error).message}`;
    }
  };

  $('btn-play').addEventListener('click', () => start({ kind: 'solo' }));
  /** First time going online: play the prologue in solo first, then come back here automatically. */
  const prologueFirst = (after: string) => {
    if (loadSave().profile.prologue) return false;
    void start({ kind: 'solo', after });
    return true;
  };
  /** Open world: join the first public room with a host and room left, or host an empty one. */
  const joinPublic = async () => {
    if (busy) return;
    busy = true;
    void enterFullscreen();
    try {
      for (let shard = 1; shard <= PUBLIC_SHARDS; shard++) {
        const code = `PUB${shard}`;
        netStatus.textContent = shard === 1 ? 'Recherche des joueurs en ligne…' : `Serveur ${shard - 1} plein, essai du serveur ${shard}…`;
        const t = await join(code);
        try {
          const { id, host } = await NetClient.connect(t, name(), myLook, loadSave().profile, localNet ? 2500 : 8000);
          busy = false;
          return await start({ kind: 'guest', t, code, id, host, public: true });
        } catch (err) {
          if (String((err as Error).message).includes('pleine')) {
            t.leave();
            continue;
          }
          // nobody hosts this room yet: you do
          busy = false;
          return await start({ kind: 'host', t, code, public: true });
        }
      }
      netStatus.textContent = 'Tous les serveurs sont pleins, réessaie plus tard';
    } catch (err) {
      netStatus.textContent = `Erreur : ${(err as Error).message}`;
    }
    busy = false;
  };
  $('btn-public').addEventListener('click', () => prologueFirst('public') || void joinPublic());
  const hostGame = async () => {
    if (busy) return;
    void enterFullscreen();
    const code = newRoomCode();
    netStatus.textContent = `Création de la partie ${code}…`;
    const t = await join(code);
    await start({ kind: 'host', t, code });
  };
  const auto = params.get('auto') ?? '';
  if (auto === 'public') void joinPublic();
  else if (auto === 'host') void hostGame();
  else if (auto.startsWith('join:')) {
    $('menu').classList.add('hidden');
    $('multi').classList.remove('hidden');
    codeIn.value = auto.slice(5);
    netStatus.textContent = 'Prologue terminé : touche REJOINDRE';
  }
  $('btn-multi').addEventListener('click', () => {
    $('menu').classList.add('hidden');
    $('multi').classList.remove('hidden');
  });
  $('btn-back').addEventListener('click', () => {
    $('multi').classList.add('hidden');
    $('menu').classList.remove('hidden');
    netStatus.textContent = '';
  });
  $('btn-host').addEventListener('click', () => prologueFirst('host') || void hostGame());
  $('btn-join').addEventListener('click', async () => {
    if (busy) return;
    const code = codeIn.value.trim().toUpperCase();
    if (code.length !== 4) {
      netStatus.textContent = 'Entre le code à 4 caractères de ton pote';
      return;
    }
    if (prologueFirst(`join:${code}`)) return;
    busy = true;
    void enterFullscreen();
    netStatus.textContent = `Connexion à la partie ${code}…`;
    try {
      const t = await join(code);
      const { id, host } = await NetClient.connect(t, name(), myLook, loadSave().profile);
      busy = false;
      await start({ kind: 'guest', t, code, id, host });
    } catch (err) {
      busy = false;
      netStatus.textContent = `${(err as Error).message}. Vérifie le code ou demande à ton pote de recréer la partie.`;
    }
  });
}

async function launch(map: MapData, assets: GameAssets, quality: QualityLevel, save: ReturnType<typeof loadSave>, mode: Mode, playerName: string, look: number, sound: Sound) {
  const sim = await SimWorld.create(map, mode.kind === 'guest' ? 'replica' : 'authority');
  sim.density = DENSITY[quality];
  // the sim never reads the clock itself: the calendar is an input
  const tickClock = () => {
    sim.day = localDay();
    sim.now = nowSeconds();
  };
  tickClock();
  setInterval(tickClock, 5000);
  const localId = mode.kind === 'solo' ? LOCAL_PLAYER : mode.kind === 'host' ? mode.t.selfId : mode.id;
  const me = sim.addPlayer(localId);
  applyProfile(me.state, save.profile);
  me.state.name = playerName;
  me.state.look = look;

  const canvas = $('game') as HTMLCanvasElement;
  const view = new GameRenderer(canvas, map, sim, quality, assets);
  const controls = new Controls($('touch'), $('joy-base'), $('joy-knob'));
  const hud = new Hud(map);
  const game = new Game(sim, view, controls, hud, sound, debug, localId);
  // your progression is saved on this phone in every mode (solo, host or guest)
  const persist = () => {
    save.profile = profileOf(game.player);
    writeSave(save);
  };
  game.onSave = persist;
  setInterval(persist, 5000);

  let net: NetSession | null = null;
  if (mode.kind === 'host') {
    const host = new NetHost(mode.t, sim, mode.code);
    const label = mode.public ? `🌍 ${mode.code.slice(3)}` : mode.code;
    host.onPlayersChange = (n) => hud.setPlayers(n, label);
    host.onYield = () => {
      persist();
      host.close();
      rejoinPublic();
    };
    hud.setPlayers(1, label);
    net = host;
  } else if (mode.kind === 'guest') {
    const client = new NetClient(mode.t, sim, localId, mode.host);
    client.onHostLost = () => {
      persist();
      if (mode.public) {
        // the open world goes on: elect a new host among those still here
        hud.toast('L’hôte est parti : reconnexion au monde ouvert…', 4);
        setTimeout(rejoinPublic, 1500);
        return;
      }
      game.setPaused(true);
      $('ko').textContent = 'PARTIE TERMINÉE';
      $('ko').classList.remove('hidden');
      setTimeout(() => location.reload(), 4000);
    };
    const label = mode.public ? `🌍 ${mode.code.slice(3)}` : mode.code;
    hud.setPlayers(1, label);
    setInterval(() => hud.setPlayers(sim.players.size, label), 1000);
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
  // crew: found one (name + price) or leave it, from the pause menu
  const crewBox = $('crew-box');
  const renderCrew = () => {
    const c = game.player.crew;
    crewBox.innerHTML = '';
    if (c) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.style.borderColor = `#${c.color.toString(16).padStart(6, '0')}`;
      tag.textContent = `Crew [${c.name}]`;
      const leave = document.createElement('button');
      leave.textContent = 'Quitter';
      leave.addEventListener('click', () => {
        game.sendAction('crew', 'leave');
        setTimeout(renderCrew, 150);
      });
      crewBox.append(tag, leave);
    } else {
      const input = document.createElement('input');
      input.placeholder = 'Nom du crew';
      input.maxLength = 12;
      const make = document.createElement('button');
      make.textContent = `Fonder · ${CREW_PRICE} €`;
      make.addEventListener('click', () => {
        if (!input.value.trim()) return input.focus();
        game.sendAction('crew', `create:${input.value}`);
        // the sim answers on the next tick (paused in solo: step once)
        setTimeout(renderCrew, 150);
      });
      crewBox.append(input, make);
    }
  };
  tap($('btn-pause'), () => {
    renderCrew();
    $('recap').innerHTML = game.recapHtml();
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
  // sound settings (saved) and radio station
  const aButtons = [...$('audio-set').querySelectorAll('button')] as HTMLButtonElement[];
  const markAudio = () => aButtons.forEach((b) => b.classList.toggle('on', b.dataset.a === 'music' ? save.settings.music : b.dataset.a === 'sfx' ? save.settings.sfx : false));
  markAudio();
  for (const b of aButtons) {
    b.addEventListener('click', () => {
      if (b.dataset.a === 'radio') {
        sound.nextStation();
        return;
      }
      if (b.dataset.a === 'music') save.settings.music = !save.settings.music;
      else save.settings.sfx = !save.settings.sfx;
      sound.setSettings(save.settings.sfx, save.settings.music);
      writeSave(save);
      markAudio();
    });
  }
  sound.onStation = (name) => {
    if (game.player.vehicle >= 0 && save.settings.music) hud.toast(`📻 ${name}`, 1.6);
  };
  $('btn-resume').addEventListener('click', () => {
    pause.classList.add('hidden');
    game.setPaused(false);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      $('recap').innerHTML = game.recapHtml();
      game.setPaused(true);
      pause.classList.remove('hidden');
      sound.suspend();
      persist();
    } else sound.start();
  });

  sound.start();
  $('start').classList.add('hidden');
  game.start();
  if (mode.kind !== 'solo' && mode.public) hud.toast(mode.kind === 'host' ? 'Monde ouvert : tu es le premier, les autres te rejoignent ici' : `Monde ouvert : ${sim.players.size} joueurs connectés`, 4);
  else if (mode.kind === 'host') hud.toast(`Partie ${mode.code} : donne ce code à tes potes !`, 6);
  else if (mode.kind === 'guest') hud.toast(`Connecté à la partie ${mode.code}`, 3);
  else if (mode.after) hud.toast('Avant d’aller en ligne : le prologue avec Momo (✕ pour le passer)', 5);
  else hud.toast('Joystick à gauche · glisse à droite pour la caméra', 3.5);
  // prologue done (or skipped): remember it, and go online if that was the plan
  game.onPrologueDone = () => {
    persist();
    if (mode.kind !== 'solo' || !mode.after) return;
    const after = mode.after;
    hud.toast('Direction le jeu en ligne…', 4);
    setTimeout(() => {
      const q = new URLSearchParams(location.search);
      q.set('auto', after);
      location.replace(`${location.pathname}?${q}`);
    }, 6500);
  };

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
