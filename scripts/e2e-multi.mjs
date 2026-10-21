// Multiplayer check: two phones in the same headless browser (same-browser transport, ?net=local).
// Alice creates a game, Bob joins with the code; we check both see each other, that Bob's
// moves reach the host and that his punches are resolved by the host.
// Usage: npm run build && node scripts/e2e-multi.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4174', '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server timeout')), 20000);
  server.stdout.on('data', (d) => String(d).includes('4174') && (clearTimeout(t), resolve()));
});
const base = 'http://localhost:4174/?net=local&quality=low&debug';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = { errors: [] };
const fail = (m) => {
  results.errors.push(m);
  console.error('FAIL:', m);
};
try {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const alice = await ctx.newPage();
  const bob = await ctx.newPage();
  for (const [n, p] of [['alice', alice], ['bob', bob]]) {
    p.on('pageerror', (e) => fail(`${n} pageerror: ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && results.errors.push(`${n} console: ${m.text()}`));
  }
  const stats = (p) => p.evaluate(() => window.__streetz.stats());

  await alice.goto(base);
  await alice.locator('#btn-multi').waitFor({ state: 'visible', timeout: 60000 });
  await alice.locator('#btn-multi').tap();
  await alice.locator('#nick').fill('Alice');
  await alice.locator('#btn-host').tap();
  await alice.locator('#players').waitFor({ state: 'visible', timeout: 60000 });
  const code = (await alice.locator('#players').textContent()).split('·')[1].trim();
  results.code = code;

  await bob.goto(base);
  await bob.locator('#btn-multi').waitFor({ state: 'visible', timeout: 60000 });
  await bob.locator('#btn-multi').tap();
  await bob.locator('#nick').fill('Bob');
  await bob.locator('#code').fill(code);
  await bob.locator('#btn-join').tap();
  await bob.locator('#players').waitFor({ state: 'visible', timeout: 60000 });
  await bob.waitForTimeout(3000);

  const a1 = await stats(alice);
  const b1 = await stats(bob);
  results.alicePlayers = a1.players;
  results.bobPlayers = b1.players;
  results.bobPeds = b1.peds;
  results.bobVehicles = b1.vehicles;
  if (a1.players !== 2 || b1.players !== 2) fail(`players: alice sees ${a1.players}, bob sees ${b1.players}`);
  if (b1.peds < 5) fail(`bob sees only ${b1.peds} pedestrians`);
  if (b1.vehicles < 3) fail(`bob sees only ${b1.vehicles} vehicles`);

  // Bob walks forward: the host must see him move
  const bobId = await bob.evaluate(() => window.__streetz.localId);
  const posOnHost = () => alice.evaluate((id) => { const p = window.__streetz.sim.players.get(id).state; return { x: p.x, z: p.z }; }, bobId);
  const before = await posOnHost();
  await bob.evaluate(() => { window.__streetz.controls.keyHeld = () => ({ gas: false, brake: false, handbrake: false, attack: false }); });
  await bob.keyboard.down('KeyW');
  await bob.waitForTimeout(2500);
  await bob.keyboard.up('KeyW');
  await bob.waitForTimeout(800);
  const after = await posOnHost();
  results.bobMovedOnHost = +Math.hypot(after.x - before.x, after.z - before.z).toFixed(1);
  if (results.bobMovedOnHost < 4) fail(`host saw Bob move only ${results.bobMovedOnHost} m`);

  // Bob punches a pedestrian the host spawns next to him
  const pedId = await alice.evaluate((id) => {
    const s = window.__streetz.sim;
    const p = s.players.get(id).state;
    const ped = s.spawnPed(p.x + 1.2, p.z, { mode: 'idle' });
    ped.timer = 999;
    ped.state.temper = 'scared';
    return ped.state.id;
  }, bobId);
  await bob.waitForTimeout(600);
  await bob.locator('#btn-attack').tap();
  await bob.waitForTimeout(1200);
  const ped = await alice.evaluate((id) => { const s = window.__streetz.sim.peds.get(id)?.state; return s && { hp: s.health, max: s.maxHealth }; }, pedId);
  results.pedHealthAfterBobPunch = ped && `${ped.hp}/${ped.max}`;
  if (!ped || !(ped.hp < ped.max)) fail('Bob\'s punch did not reach the host');

  await alice.screenshot({ path: OUT + 'multi-alice.png' });
  await bob.screenshot({ path: OUT + 'multi-bob.png' });
} catch (e) {
  fail(String(e?.stack || e));
} finally {
  await browser.close();
  server.kill();
}
results.ok = results.errors.filter((e) => !e.includes('console:')).length === 0;
writeFileSync(OUT + 'multi-results.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
process.exit(results.ok ? 0 : 1);
