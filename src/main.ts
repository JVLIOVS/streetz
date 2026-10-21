import './ui/style.css';
import { Sound } from './audio/sound';
import { loadSave, writeSave } from './core/save';
import { Game, LOCAL_PLAYER } from './game';
import { Controls } from './input/controls';
import { loadMap } from './maps/registry';
import { loadAssets } from './render/assets';
import type { QualityLevel } from './render/quality';
import { GameRenderer } from './render/renderer';
import { SimWorld } from './sim/world';
import { Hud } from './ui/hud';

const $ = (id: string) => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const debug = params.has('debug');

const DENSITY: Record<QualityLevel, { peds: number; traffic: number; parkedRadius: number }> = {
  low: { peds: 14, traffic: 8, parkedRadius: 55 },
  medium: { peds: 22, traffic: 12, parkedRadius: 70 },
  high: { peds: 30, traffic: 16, parkedRadius: 85 },
};

async function boot() {
  const save = loadSave();
  const qParam = params.get('quality') as QualityLevel | null;
  const quality: QualityLevel = qParam && ['low', 'medium', 'high'].includes(qParam) ? qParam : save.settings.quality;

  const status = $('loading');
  status.textContent = 'Chargement de la ville…';
  const assetsP = loadAssets((r) => (status.textContent = `Chargement des modèles… ${Math.round(r * 100)} %`));
  const map = await loadMap('paris');
  const assets = await assetsP;
  status.textContent = 'Physique…';
  const sim = await SimWorld.create(map);
  sim.density = DENSITY[quality];
  const me = sim.addPlayer(LOCAL_PLAYER);
  me.state.money = save.progress.money;
  status.textContent = 'Construction des rues…';
  await new Promise((r) => setTimeout(r, 0));

  const canvas = $('game') as HTMLCanvasElement;
  const view = new GameRenderer(canvas, map, sim, quality, assets);
  const controls = new Controls($('touch'), $('joy-base'), $('joy-knob'));
  const hud = new Hud(map);
  const sound = new Sound();
  const game = new Game(sim, view, controls, hud, sound, debug);
  const persist = () => {
    save.progress.money = game.player.money;
    writeSave(save);
  };
  game.onSave = persist;

  // Let the city fill up a little, then warm up shaders behind the start screen
  for (let i = 0; i < 40; i++) sim.step([]);
  view.render(LOCAL_PLAYER, 1, 1 / 60, 0);
  status.textContent = '';
  $('btn-play').classList.remove('hidden');

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

  $('btn-play').addEventListener('click', async () => {
    sound.start();
    await enterFullscreen();
    $('start').classList.add('hidden');
    game.start();
    hud.toast('Joystick à gauche · glisse à droite pour la caméra', 3.5);
  });

  (window as unknown as { __streetz: unknown }).__streetz = {
    game,
    sim,
    view,
    controls,
    stats: () => ({ fps: game.fps, tick: sim.tick, ...view.stats(), player: sim.players.get(LOCAL_PLAYER)!.state, peds: sim.peds.size, vehicles: sim.vehicles.size }),
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
