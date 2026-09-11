const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const physics = import('../arcade/physics.mjs');
function near(a, b, tolerance = 1e-6) { assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`); }
async function scenario(ball) {
  const p = await physics, s = p.createState();
  s.phase = 'rally';
  Object.assign(s.ball, { x: 5, y: 4, z: 1, vx: 0, vy: 0, vz: 0, lastHit: 1, bounces: 0, feed: false }, ball);
  return { p, s };
}
test('direct side and back wall contacts lose the point for the hitter', async () => {
  for (const ball of [{ x: 0.2, vx: -8 }, { y: 0.2, vy: -8 }]) {
    const { p, s } = await scenario(ball);
    p.simulateBall(s, 0.03);
    assert.deepEqual(s.score, [1, 0]); assert.match(s.message, /Wand vor Boden/);
  }
});
test('after a floor bounce both wall types rebound without resetting the bounce count', async () => {
  for (const ball of [{ x: 0.2, vx: -8 }, { y: 0.2, vy: -8 }]) {
    const { p, s } = await scenario({ ...ball, bounces: 1 });
    p.simulateBall(s, 0.03);
    assert.equal(s.phase, 'rally'); assert.equal(s.ball.bounces, 1);
    assert.ok(ball.vx ? s.ball.vx > 0 : s.ball.vy > 0);
  }
});
test('second floor contact awards one point and cannot award it twice', async () => {
  const { p, s } = await scenario({ z: 0.01, vz: -2, bounces: 1 });
  p.simulateBall(s, 0.03); p.simulateBall(s, 0.03);
  assert.deepEqual(s.score, [0, 1]); assert.match(s.message, /Zweimal/);
});
test('a first bounce on the hitter side is an error', async () => {
  const { p, s } = await scenario({ y: 14, z: 0.01, vz: -2 });
  p.simulateBall(s, 0.03); assert.deepEqual(s.score, [1, 0]);
});
test('floor precedes wall at an exact floor/wall corner', async () => {
  const { p, s } = await scenario({ x: 0.2, vx: -8, z: 0.0106, vz: -1 });
  p.simulateBall(s, 0.015);
  assert.equal(s.phase, 'rally'); assert.equal(s.ball.bounces, 1); assert.ok(s.ball.vx > 0);
});
test('net contact is an immediate error; a high crossing remains in play', async () => {
  for (const z of [0.5, 2]) {
    const { p, s } = await scenario({ y: 10.1, vy: -10, z });
    p.simulateBall(s, 0.02);
    assert.equal(s.phase, z < 1 ? 'point' : 'rally');
  }
});
test('swept collision catches a fast ball through a paddle', async () => {
  const { p, s } = await scenario({ x: 2.5, y: 3.8, vy: -100, z: 1 });
  p.simulateBall(s, p.C.step);
  assert.equal(s.ball.lastHit, 0); assert.equal(s.rallyHits, 1); assert.ok(s.ball.vy > 0);
});
test('a high ball passes above a paddle; a descending ball enters its reach', async () => {
  const high = await scenario({ x: 2.5, y: 3.5, vy: -20, z: 3 });
  high.p.simulateBall(high.s, 0.03); assert.equal(high.s.rallyHits, 0);
  const descending = await scenario({ x: 2.5, y: 3, z: 1.7, vz: -4 });
  descending.p.simulateBall(descending.s, 0.02); assert.equal(descending.s.rallyHits, 1);
});
test('automatic feed cannot be volleyed, regular rally can', async () => {
  for (const feed of [true, false]) {
    const { p, s } = await scenario({ x: 2.5, y: 3.4, vy: -10, feed });
    p.simulateBall(s, 0.025); assert.equal(s.rallyHits, feed ? 0 : 1);
  }
});
test('a back-wall return can be hit from behind a paddle', async () => {
  const { p, s } = await scenario({ x: 2.5, y: 2.5, vy: 12, bounces: 1 });
  p.simulateBall(s, 0.03); assert.equal(s.ball.lastHit, 0); assert.equal(s.rallyHits, 1);
});
test('neutral centre shots clear the net and land inside from front and back', async () => {
  const p = await physics;
  for (const y of [11, 14, 19]) for (const z of [0.1, 0.8, 1.6]) {
    const { s } = await scenario({ x: 5, y, z });
    p.hitBall(s, 1, 5);
    const netTime = (10 - y) / s.ball.vy;
    assert.ok(p.heightAt(s.ball, netTime) > p.C.netHeight + p.C.radius);
    near(s.ball.y + s.ball.vy * p.groundTime(s.ball), 2.8);
  }
});
test('full forward power physically hits the back wall before landing on both sides', async () => {
  const p = await physics;
  for (const side of [0, 1]) for (const y of side ? [11, 14, 19] : [1, 6, 9]) for (const z of [0.05, 0.8, 1.6]) {
    const { s } = await scenario({ x: 5, y, z, lastHit: side });
    s.teams[side].power = 1; p.hitBall(s, side, 5);
    assert.equal(p.predictLanding(s.ball).fault, true);
    for (let i = 0; i < 300 && s.phase === 'rally'; i++) p.simulateBall(s, p.C.step);
    assert.match(s.message, /Wand vor Boden/); assert.equal(s.score[1 - side], 1);
  }
});
test('formation respects all boundaries, preserves its gap and reaches both seams', async () => {
  const p = await physics;
  for (const side of [0, 1]) for (const x of [-1, 1]) for (const y of [-1, 1]) {
    const t = p.createState().teams[side];
    for (let i = 0; i < 600; i++) p.moveTeam(t, { x, y }, p.C.step);
    near(t.offset, x * p.C.maxOffset);
    near(t.y, side ? (y < 0 ? 10.9 : 19.35) : (y < 0 ? 0.65 : 9.1));
    near((7.5 + t.offset) - (2.5 + t.offset), 5);
  }
  near(2.5 + p.C.maxOffset + p.C.paddleWidth / 2, 5);
  near(7.5 - p.C.maxOffset - p.C.paddleWidth / 2, 5);
});
test('speed is capped diagonally and hitting a boundary removes the forward power', async () => {
  const p = await physics, t = p.createState().teams[1];
  for (let i = 0; i < 20; i++) p.moveTeam(t, { x: 1, y: -1 }, p.C.step);
  assert.ok(Math.hypot(t.vx, t.vy) <= p.C.speed + 1e-6);
  for (let i = 0; i < 10; i++) {
    p.moveTeam(t, { x: 1, y: 0 }, p.C.step);
    assert.ok(Math.hypot(t.vx, t.vy) <= p.C.speed + 1e-6);
  }
  for (let i = 0; i < 300; i++) p.moveTeam(t, { x: 0, y: -1 }, p.C.step);
  near(t.power, 0); near(t.vy, 0);
});
test('seven points ends the game including 7:6, with pause and reset supported', async () => {
  const { p, s } = await scenario({}); s.score = [6, 6];
  p.awardPoint(s, 1, 'Test'); assert.equal(s.phase, 'over'); assert.deepEqual(s.score, [6, 7]);
  p.reset(s); assert.equal(s.phase, 'ready'); assert.deepEqual(s.score, [0, 0]);
  p.start(s); p.pause(s); const snapshot = JSON.stringify(s); p.step(s);
  assert.equal(JSON.stringify(s), snapshot); p.start(s); assert.equal(s.phase, 'rally');
});
test('point intermission pauses and resumes without skipping the next feed', async () => {
  const { p, s } = await scenario({}); p.awardPoint(s, 1, 'Test'); p.pause(s); p.start(s);
  assert.equal(s.phase, 'point');
  for (let i = 0; i < 110; i++) p.step(s);
  assert.equal(s.phase, 'rally'); assert.equal(s.ball.feed, true);
});
test('30 and 60 frame clocks produce identical movement and physics', async () => {
  const p = await physics;
  function run(fps) {
    const s = p.createState(); p.start(s);
    const clock = p.createClock(() => p.step(s, { x: Math.sin(s.time), y: -0.15 }));
    for (let i = 0; i < fps * 15; i++) clock.advance(1 / fps);
    return s;
  }
  assert.deepEqual(run(30), run(60));
});
test('arcade page uses isolated modules and same-tab navigation preserves the season', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'arcade/index.html'), 'utf8');
  const league = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(!/app\.js|supabase|chart\.js|<dialog/.test(html));
  assert.match(html, /Padel<span>Arcade/);
  assert.match(league, /id="arcade-link" href="arcade\/"/);
  const source = fs.readFileSync(path.join(root, 'js/arcade-link.js'), 'utf8');
  const vm = require('node:vm');
  const link = { getAttribute: () => 'arcade/', href: '' };
  vm.runInNewContext(source, { URL, URLSearchParams, document: { getElementById: () => link }, window: { location: { href: 'https://example.test/Padel-Liga/?saison=winter-2026', search: '?saison=winter-2026' } } });
  assert.equal(link.href, 'https://example.test/Padel-Liga/arcade/?saison=winter-2026');
});
