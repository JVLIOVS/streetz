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
  server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
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
  });
  if (moved < 10) fail(`player moved only ${moved.toFixed(1)} m with the joystick`);
  if (!['jump', 'fall'].includes(midAir.player.anim) && midAir.player.grounded) fail('jump button had no effect');

  // Pause menu opens
  await page.locator('#btn-pause').tap();
  if (!(await page.locator('#pause').isVisible())) fail('pause menu did not open');
  await page.screenshot({ path: OUT + 'pause.png' });
  await page.locator('#btn-resume').tap();
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
