const test = require('node:test');
const assert = require('node:assert/strict');
const physics = import('../arcade/physics.mjs');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const absent = [{ offset: 100, y: 100 }, { offset: 100, y: 100 }];
function rally(p, side, ball = {}) {
  const s = p.createState(); s.phase = 'rally';
  Object.assign(s.ball, { x: .2, y: side ? 18 : 2, z: 1, vx: -8, vy: 0, vz: 0, lastHit: side, bounces: 0, feed: false }, ball);
  return s;
}

test('own side glass and rear glass are legal before the opponent bounce on both halves', async () => {
  const p = await physics;
  for (const side of [0, 1]) for (const rear of [false, true]) {
    const s = rally(p, side, rear ? { x: 5, y: side ? 19.8 : .2, vx: 0, vy: side ? 8 : -8 } : {});
    p.simulateBall(s, .03, absent);
    assert.equal(s.phase, 'rally'); assert.equal(s.ball.bounces, 0);
    near(rear ? Math.abs(s.ball.vy) : s.ball.vx, 6.4);
    assert.equal(s.ball.lastHit, side); assert.equal(s.rallyHits, 0);
  }
});

test('direct own fence and opponent glass lose the point while legal post-bounce mesh rebounds', async () => {
  const p = await physics;
  for (const side of [0, 1]) {
    for (const opponent of [false, true]) {
      const s = rally(p, side, { y: opponent ? (side ? 2 : 18) : (side ? 14 : 6) });
      p.simulateBall(s, .03, absent);
      assert.equal(s.score[1 - side], 1);
      assert.match(s.message, opponent ? /Wand vor Boden/ : /Zaun vor Boden/);
    }
    const s = rally(p, side, { y: side ? 6 : 14, bounces: 1 });
    p.simulateBall(s, .03, absent);
    near(s.ball.vx, 8 * .86); assert.equal(s.ball.bounces, 1); assert.equal(s.phase, 'rally');
  }
});

test('glass boundaries are mirrored and the exact four-metre join belongs to mesh', async () => {
  const p = await physics;
  for (const [y, material] of [[3.999, 'wall'], [4, 'fence'], [10, 'fence'], [16, 'fence'], [16.001, 'wall']]) {
    assert.equal(p.boundaryMaterial('x', y), material);
    assert.equal(p.boundaryMaterial('x', 20 - y), material);
  }
  assert.equal(p.boundaryMaterial('y', 0), 'wall');
});

test('own glass does not excuse a first own-floor bounce, a fence contact, or a double contact', async () => {
  const p = await physics;
  for (const side of [0, 1]) {
    const s = rally(p, side); p.simulateBall(s, .02, absent);
    Object.assign(s.ball, { z: .01, vz: -2 }); p.simulateBall(s, .02, absent);
    assert.equal(s.score[1 - side], 1); assert.match(s.message, /Boden auf eigener Seite/);
    const fence = rally(p, side); p.simulateBall(fence, .02, absent);
    Object.assign(fence.ball, { x: .2, y: side ? 15 : 5, vx: -8 }); p.simulateBall(fence, .02, absent);
    assert.match(fence.message, /Zaun vor Boden/);
    const double = rally(p, side); p.simulateBall(double, .02, absent);
    p.hitBall(double, side, double.ball.x); assert.match(double.message, /Doppelkontakt/);
  }
});

test('a forward stroke via own side glass reaches the opponent floor and prediction matches', async () => {
  const p = await physics;
  for (const side of [0, 1]) {
    const s = rally(p, side, { x: .15, y: side ? 18 : 2, lastHit: 1 - side });
    p.hitBall(s, side, .7);
    const predicted = p.predictLanding(s.ball), duration = p.groundTime(s.ball);
    assert.equal(predicted.fault, false);
    p.simulateBall(s, duration, absent);
    assert.equal(s.phase, 'rally'); assert.equal(s.ball.bounces, 1);
    assert.equal(p.sideAt(s.ball.y), 1 - side);
    near(predicted.x, s.ball.x); near(predicted.y, s.ball.y);
  }
});

test('front-on glass loses 20 percent while grazing contact preserves tangential and vertical speed', async () => {
  const p = await physics;
  for (const vy of [0, 20]) {
    const s = rally(p, 0, { vy, vz: 3 });
    p.simulateBall(s, .01, absent);
    near(s.ball.vx, 6.4); near(s.ball.vy, vy); near(s.ball.vz, 3 - p.C.gravity * .01);
    const ratio = Math.hypot(s.ball.vx, s.ball.vy) / Math.hypot(8, vy);
    if (vy === 0) near(ratio, .8); else assert.ok(ratio > .95);
  }
});

test('simultaneous ground/glass and double-wall corner contacts agree with prediction', async () => {
  const p = await physics;
  const ground = rally(p, 1, { y: 2, z: .0106, vz: -1 });
  assert.equal(p.predictLanding(ground.ball).fault, false);
  p.simulateBall(ground, .011, absent); assert.equal(ground.ball.bounces, 1); near(ground.ball.vx, 6.4);
  const corner = rally(p, 1, { y: 19.8, vy: 8 });
  const predicted = p.predictLanding(corner.ball), duration = p.groundTime(corner.ball);
  p.simulateBall(corner, .011, absent); near(corner.ball.vx, 6.4); near(corner.ball.vy, -6.4);
  p.simulateBall(corner, duration - .011, absent);
  near(corner.ball.x, predicted.x); near(corner.ball.y, predicted.y);
});

test('backward shots retain 60 percent horizontal speed and the neutral vertical arc at all hit heights', async () => {
  const p = await physics;
  for (const side of [0, 1]) for (const y of [11, 14, 17, 19]) for (const z of [.1, .8, 1.6]) {
    const neutral = rally(p, side, { x: 5, y: side ? y : 20 - y, z, lastHit: 1 - side });
    const soft = structuredClone(neutral); soft.teams[side].power = -1;
    p.hitBall(neutral, side, 5.3); p.hitBall(soft, side, 5.3);
    near(soft.ball.vx, neutral.ball.vx * .6); near(soft.ball.vy, neutral.ball.vy * .6);
    near(soft.ball.vz, neutral.ball.vz); near(p.groundTime(soft.ball), p.groundTime(neutral.ball));
    assert.equal(Math.sign(soft.ball.vy), side ? -1 : 1);
  }
});

test('soft shots land in the opponent front half, but full backward power from the baseline hits the net', async () => {
  const p = await physics;
  for (const side of [0, 1]) for (const y of [11, 14, 17, 19]) {
    const s = rally(p, side, { x: 5, y: side ? y : 20 - y, lastHit: 1 - side, vx: 0 });
    s.teams[side].power = -1; p.hitBall(s, side, 5);
    p.simulateBall(s, p.groundTime(s.ball), absent);
    if (y === 19) { assert.equal(s.score[1 - side], 1); assert.match(s.message, /Im Netz/); }
    else { assert.equal(s.ball.bounces, 1); assert.equal(s.phase, 'rally'); assert.ok(side ? s.ball.y >= 5 && s.ball.y < 10 : s.ball.y > 10 && s.ball.y <= 15); }
  }
});

test('signed power follows smoothed actual movement and decays at the rear limit on both sides', async () => {
  const p = await physics;
  for (const side of [0, 1]) {
    const team = p.createState().teams[side];
    for (let i = 0; i < 12; i++) p.moveTeam(team, { x: 0, y: side ? 1 : -1 }, p.C.step);
    assert.ok(team.power < -.7 && team.power > -1);
    for (let i = 0; i < 300; i++) p.moveTeam(team, { x: 0, y: side ? 1 : -1 }, p.C.step);
    near(team.power, 0); near(team.vy, 0);
  }
});

test('ruleset is captured by state, copied into a win and never supplied as a save-time fallback', async () => {
  const p = await physics, l = await import('../arcade/leaderboard.mjs');
  const s = p.createState(); p.start(s); assert.equal(s.ruleset, 'v2');
  Object.assign(s, { phase: 'over', winner: 1, score: [2, 7] });
  const entry = l.winningEntry(s, 'round', 'easy'); s.ruleset = 'classic';
  assert.equal(entry.ruleset, 'v2'); assert.ok(Object.isFrozen(entry));
  p.reset(s); assert.equal(s.ruleset, 'v2');
  const api = l.createLeaderboardApi({}, () => assert.fail('must not send an unversioned result'));
  assert.throws(() => api.save({ ...entry, ruleset: undefined }, 'Ludi'), /Spielversion/);
});

test('an archived-version error asks for a reload rather than a retry', async () => {
  const { createLeaderboardApi } = await import('../arcade/leaderboard.mjs');
  const api = createLeaderboardApi({ url: 'https://example.test', publishableKey: 'public' }, async () => ({ ok: false, status: 400, json: async () => ({ message: 'ARCADE_RULESET_CLOSED' }) }));
  await assert.rejects(api.save({ roundId: 'old', ruleset: 'classic' }, 'Ludi'), /lade die Seite neu/);
});
