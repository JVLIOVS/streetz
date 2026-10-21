import './ui/style.css';
import { loadSave, writeSave } from './core/save';
import { Game, LOCAL_PLAYER } from './game';
import { Controls } from './input/controls';
import { loadMap } from './maps/registry';
import type { QualityLevel } from './render/quality';
import { GameRenderer } from './render/renderer';
import { SimWorld } from './sim/world';
import { Hud } from './ui/hud';

const $ = (id: string) => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const debug = params.has('debug');

async function boot() {
  const save = loadSave();
  const qParam = params.get('quality') as QualityLevel | null;
  const quality: QualityLevel = qParam && ['low', 'medium', 'high'].includes(qParam) ? qParam : save.settings.quality;

  const status = $('loading');
  status.textContent = 'Chargement de la ville…';
  const map = await loadMap('paris');
  status.textContent = 'Physique…';
  const sim = await SimWorld.create(map);
  sim.addPlayer(LOCAL_PLAYER);
  status.textContent = 'Construction des rues…';
  await new Promise((r) => setTimeout(r, 0));

  const canvas = $('game') as HTMLCanvasElement;
  const view = new GameRenderer(canvas, map, sim, quality);
  const controls = new Controls($('touch'), $('joy-base'), $('joy-knob'));
  const hud = new Hud(map);
  const game = new Game(sim, view, controls, hud, debug);
  game.money = save.progress.money;

  // Warm up: compile shaders and render once behind the start screen
  view.render(LOCAL_PLAYER, 1, 1 / 60, 0);
  status.textContent = '';
  $('btn-play').classList.remove('hidden');

  // Buttons
  const jump = $('btn-jump');
  const sprint = $('btn-sprint');
  const press = (el: HTMLElement, fn: () => void) =>
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
  press(jump, () => controls.pressJump());
  press(sprint, () => controls.toggleSprint());
  controls.onSprintChange = (on) => sprint.classList.toggle('on', on);

  // Pause / quality menu
  const pause = $('pause');
  const qButtons = [...$('quality').querySelectorAll('button')] as HTMLButtonElement[];
  const markQuality = () => qButtons.forEach((b) => b.classList.toggle('on', b.dataset.q === view.quality));
  markQuality();
  press($('btn-pause'), () => {
    game.setPaused(true);
    pause.classList.remove('hidden');
  });
  for (const b of qButtons) {
    b.addEventListener('click', () => {
      const q = b.dataset.q as QualityLevel;
      if (q === view.quality) return;
      view.setQuality(q);
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
      save.progress.money = game.money;
      writeSave(save);
    }
  });

  $('btn-play').addEventListener('click', async () => {
    await enterFullscreen();
    $('start').classList.add('hidden');
    game.start();
    hud.toast('Joystick à gauche · glisse à droite pour la caméra', 3.5);
  });

  (window as unknown as { __streetz: unknown }).__streetz = {
    game,
    sim,
    view,
    stats: () => ({ fps: game.fps, tick: sim.tick, ...view.stats(), player: sim.players.get(LOCAL_PLAYER)!.state }),
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
