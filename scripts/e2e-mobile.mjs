// Headless mobile check: landscape phone viewport (390x844 rotated), touch input,
// joystick + camera drag, FPS measurement, screenshots in scripts/out/.
// Usage: npm run build && npm run e2e   (BASE_URL=... to test a deployed build)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const quality = process.env.QUALITY || 'medium';
let server = null;
let base = process.env.BASE_URL;
if (!base) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
  base = 'http://localhost:4173/';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('preview server timeout')), 20000);
    server.stdout.on('data', (d) => {
      if (String(d).includes('4173')) {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const results = { quality, errors: [] };
let failed = false;
const fail = (msg) => {
  failed = true;
  results.errors.push(msg);
  console.error('FAIL:', msg);
};

try {
  // ---- portrait: must ask to rotate
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(base);
    const rotateVisible = await page.locator('#rotate').isVisible();
    results.portraitRotatePrompt = rotateVisible;
    if (!rotateVisible) fail('portrait: rotate prompt not shown');
    await page.screenshot({ path: OUT + 'portrait.png' });
    await ctx.close();
  }

  // ---- landscape gameplay
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && results.errors.push('console: ' + m.text()));
  page.on('pageerror', (e) => fail('pageerror: ' + e.message));
  const t0 = Date.now();
  await page.goto(`${base}?debug&quality=${quality}`);
  // first launch: the 18+ question comes before the menu
  await page.locator('#btn-adult').waitFor({ state: 'visible', timeout: 60000 });
  results.ageGate = true;
  await page.screenshot({ path: OUT + 'age.png' });
  await page.locator('#btn-adult').tap();
  await page.locator('#btn-play').waitFor({ state: 'visible', timeout: 60000 });
  results.loadSeconds = (Date.now() - t0) / 1000;
  await page.screenshot({ path: OUT + 'start.png' });
  await page.locator('#btn-play').tap();
  await page.waitForTimeout(1500);

  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const stats = () => page.evaluate(() => window.__streetz.stats());
  const measureFps = (ms) =>
    page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          let n = 0;
          const start = performance.now();
          const f = (t) => {
            n++;
            if (t - start < ms) requestAnimationFrame(f);
            else resolve((n * 1000) / (t - start));
          };
          requestAnimationFrame(f);
        }),
      ms,
    );

  const before = await stats();
  results.idleFps = await measureFps(3000);

  // Joystick: thumb down on the left, push forward and hold, while the right thumb drags the camera
  const joy = { x: 160, y: 270, id: 1 };
  await touch('touchStart', [joy]);
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', [{ ...joy, y: joy.y - i * 10 }]);
    await page.waitForTimeout(16);
  }
  const held = { ...joy, y: joy.y - 60 };
  const fpsWalk = measureFps(4000);
  for (let i = 0; i < 20; i++) {
    const cam = { x: 600 + i * 4, y: 200, id: 2 };
    await touch('touchMove', i === 0 ? [held] : [held, cam]);
    if (i === 0) await touch('touchStart', [held, cam]);
    await page.waitForTimeout(100);
  }
  await touch('touchEnd', [held]);
  results.walkFps = await fpsWalk;
  // Sprint + jump
  await page.locator('#btn-sprint').tap();
  await touch('touchStart', [joy]);
  await touch('touchMove', [held]);
  await page.waitForTimeout(1500);
  await page.locator('#btn-jump').tap();
  await page.waitForTimeout(400);
  const midAir = await stats();
  await page.screenshot({ path: OUT + 'gameplay.png' });
  await page.waitForTimeout(1500);
  await touch('touchEnd', []);
  const after = await stats();

  const moved = Math.hypot(after.player.x - before.player.x, after.player.z - before.player.z);
  Object.assign(results, {
    moved: +moved.toFixed(1),
    jumpedAnim: midAir.player.anim,
    drawCalls: after.calls,
    triangles: after.triangles,
    pixelRatio: after.pixelRatio,
    tick: after.tick,
    peds: after.peds,
    vehicles: after.vehicles,
  });
  if (moved < 10) fail(`player moved only ${moved.toFixed(1)} m with the joystick`);
  if (!['jump', 'fall'].includes(midAir.player.anim) && midAir.player.grounded) fail('jump button had no effect');
  if (after.peds < 8) fail(`only ${after.peds} pedestrians`);
  if (after.vehicles < 8) fail(`only ${after.vehicles} vehicles`);

  // Punch button
  const seq0 = (await stats()).player.actionSeq;
  await page.locator('#btn-attack').tap();
  await page.waitForTimeout(300);
  if ((await stats()).player.actionSeq === seq0) fail('attack button had no effect');

  // Walk up to the sports car parked next to the square, get in with the contextual button, drive, get out
  await page.evaluate(() => {
    const s = window.__streetz;
    s.sim.players.get('local').teleport(-58, 0.3, -72.6, Math.PI);
  });
  await page.waitForTimeout(600);
  const ctxLabel = await page.locator('#btn-action').textContent();
  results.contextNearCar = ctxLabel?.trim();
  if (!/MONTER/.test(ctxLabel ?? '')) fail(`expected "Monter" near the car, got "${ctxLabel}"`);
  await page.locator('#btn-action').tap();
  await page.waitForTimeout(400);
  const inCar = await stats();
  if (inCar.player.vehicle < 0) fail('could not get in the car');
  const gas = await page.locator('#btn-gas').boundingBox();
  await touch('touchStart', [{ x: gas.x + gas.width / 2, y: gas.y + gas.height / 2, id: 5 }]);
  let topSpeed = 0;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(250);
    topSpeed = Math.max(topSpeed, Math.abs((await stats()).player.speed));
  }
  await page.screenshot({ path: OUT + 'driving.png' });
  await touch('touchEnd', []);
  const driven = await stats();
  driven.player.speed = topSpeed;
  results.carSpeed = +topSpeed.toFixed(1);
  if (topSpeed < 5) fail(`car too slow: ${driven.player.speed} held=${JSON.stringify(await page.evaluate(() => [window.__streetz.controls.held, window.__streetz.controls.state]))} pos=${driven.player.x.toFixed(1)},${driven.player.z.toFixed(1)}`);
  await page.locator('#btn-action').tap();
  await page.waitForTimeout(400);
  if ((await stats()).player.vehicle >= 0) fail('could not get out of the car');

  // Enter a shop through its door
  await page.evaluate(() => {
    const s = window.__streetz;
    const d = s.sim.map.interiors.find((i) => i.kind === 'shop').door;
    s.sim.players.get('local').teleport(d.x - Math.sin(d.yaw) * 1.4, 0.3, d.z - Math.cos(d.yaw) * 1.4, d.yaw + Math.PI);
  });
  await page.waitForTimeout(500);
  await page.locator('#btn-action').tap();
  await page.waitForTimeout(800);
  const inside = await stats();
  results.interior = inside.player.interior;
  if (!inside.player.interior) fail('could not enter the shop');
  await page.screenshot({ path: OUT + 'shop.png' });

  // New players get the tutorial first
  results.tutorial = await page.locator('#objective .obj-txt').textContent();
  if (!results.tutorial) fail('tutorial did not start');
  await page.locator('#objective .obj-x').tap();
  await page.waitForTimeout(400);
  // Progression panel (level, daily contracts, streak, fence)
  await page.locator('#btn-level').tap();
  await page.waitForTimeout(400);
  results.contracts = await page.locator('#progress-panel .pp-row').count();
  if (results.contracts < 4) fail('progression panel is empty');
  await page.screenshot({ path: OUT + 'progress.png' });
  await page.locator('#progress-panel .pp-close').tap();

  // Start the first mission from its marker: the objective banner appears
  await page.evaluate(() => {
    const s = window.__streetz;
    const p = s.sim.players.get('local');
    p.state.interior = null;
    const g = s.sim.missions.givers[0];
    p.teleport(g.x, 0.3, g.z, 0);
  });
  await page.waitForTimeout(600);
  await page.locator('#btn-action').tap();
  await page.waitForTimeout(800);
  results.mission = await page.locator('#objective .obj-txt').textContent();
  if (!(await page.locator('#objective').isVisible())) fail('mission did not start');
  await page.screenshot({ path: OUT + 'mission.png' });

  // Pause menu opens
  await page.locator('#btn-pause').tap();
  if (!(await page.locator('#pause').isVisible())) fail('pause menu did not open');
  await page.screenshot({ path: OUT + 'pause.png' });
  await page.locator('#btn-resume').tap();

  // GPU memory stays flat when the quality is changed again and again
  const mem = await page.evaluate(async () => {
    const v = window.__streetz.view;
    const m = () => ({ ...v.renderer.info.memory });
    v.setQuality('low');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const before = m();
    for (const q of ['high', 'medium', 'low', 'high', 'medium', 'low']) {
      v.setQuality(q);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    return { before, after: m() };
  });
  results.gpuMemory = mem;
  if (mem.after.geometries > mem.before.geometries * 1.3 + 10) fail(`GPU leak on quality change: ${mem.before.geometries} → ${mem.after.geometries} geometries`);
  await ctx.close();
} catch (e) {
  fail(String(e?.stack || e));
} finally {
  await browser.close();
  server?.kill();
}

results.ok = !failed;
writeFileSync(OUT + 'results.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
