const test = require('node:test');
const assert = require('node:assert/strict');
const physics = import('../arcade/physics.mjs');
const computer = import('../arcade/computer.mjs');
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`); }
function seeded(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }

test('easy movement is forty-five percent slower in every direction, including diagonal', async () => {
  const { createComputer } = await computer, p = await physics;
  for (const offset of [-1.8, 0, 1.8]) for (const y of [1, 3.2, 8]) {
    const state = p.createState(); state.ball.lastHit = 0; state.ball.feed = false;
    Object.assign(state.teams[0], { offset, y });
    const hard = createComputer({ difficulty: 'hard' }).read(state);
    const easy = createComputer({ difficulty: 'easy' }).read(state);
    near(easy.x, hard.x * .55); near(easy.y, hard.y * .55);
  }
});

test('easy decisions wait 0.4 seconds while hard still reacts after 0.2 seconds', async () => {
  const { createComputer } = await computer, p = await physics;
  for (const difficulty of ['easy', 'hard']) {
    const cpu = createComputer({ difficulty }), state = p.createState();
    cpu.read(state); state.ball.x = 8;
    state.time = .21;
    const middle = cpu.read(state);
    assert.equal(middle.x > 0, difficulty === 'hard');
    state.time = .41; assert.ok(cpu.read(state).x > 0);
  }
});

test('every human return waits a full reaction delay even just before a scheduled decision', async () => {
  const { createComputer } = await computer, p = await physics;
  for (const draw of [0, .5, 1]) {
    let calls = 0;
    const cpu = createComputer({ difficulty: 'easy', random: () => { calls++; return draw; } });
    const state = p.createState(); state.phase = 'rally'; state.ball.lastHit = 0; state.ball.feed = false;
    const old = cpu.read(state);
    state.time = .39; Object.assign(state.ball, { lastHit: 1, feed: false, x: 9 });
    cpu.read(state); const ready = state.time + .45 + draw * .15;
    for (const time of [.40, ready - .001]) {
      state.time = time; assert.deepEqual(cpu.read(state), old);
    }
    state.time = ready + .00001; assert.ok(cpu.read(state).x > 0);
    assert.equal(calls, 2, 'Delay and small prediction error are sampled once');
    state.phase = 'paused'; cpu.read(state); assert.equal(calls, 2);
    state.phase = 'rally'; state.rallyHits += 2; state.time += .1;
    const prior = cpu.read(state); state.ball.x = 0.5; state.time += .24;
    assert.deepEqual(cpu.read(state), prior, 'A later return also gets a full delay');
    cpu.reset(); state.ball.feed = true; state.time = 0; cpu.read(state);
    assert.equal(calls, 4, 'Reset and automatic feed consume no randomness');
  }
});

test('easy stays forward briefly after a return rather than retreating immediately', async () => {
  const { createComputer } = await computer, p = await physics;
  const cpu = createComputer({ difficulty: 'easy', random: () => .5 });
  const state = p.createState(); state.phase = 'rally'; state.ball.feed = false;
  Object.assign(state.ball, { x: 2.5, y: 8, vy: 0, bounces: 1 });
  cpu.read(state); state.time = .61; const forward = cpu.read(state);
  assert.ok(forward.y > 0);
  state.ball.lastHit = 0; state.ball.feed = false; state.time = .62; cpu.read(state);
  state.time = .90; assert.deepEqual(cpu.read(state), forward);
  state.time = .93; assert.ok(cpu.read(state).y < forward.y);
});

test('contact scatter is continuous, mostly small, and increases under pressure', async () => {
  const { createComputer } = await computer, p = await physics;
  const sample = (offset, vx) => {
    const cpu = createComputer({ difficulty: 'easy', random: seeded(37) });
    return Array.from({ length: 2000 }, () => cpu.stroke({ offset, team: { ...p.createState().teams[0], vx }, time: 10 }));
  };
  const calm = sample(0, 0), stressed = sample(.95, 3.4);
  const magnitude = a => a.reduce((sum, v) => sum + Math.abs(v.offset) + Math.abs(v.length - 1), 0);
  assert.ok(magnitude(stressed) > magnitude(calm) * 5);
  assert.ok(stressed.filter(v => Math.abs(v.length - 1) < .05).length > 1400);
  assert.ok(stressed.some(v => v.length > 1.1)); assert.ok(stressed.some(v => v.length < .9));
  assert.ok(stressed.some(v => v.offset < -.1)); assert.ok(stressed.some(v => v.offset > .1));
  assert.ok(calm.every(v => Math.abs(v.offset) <= .015 && Math.abs(v.length - 1) <= .01));
  const hard = createComputer({ difficulty: 'hard', random: () => assert.fail('hard used randomness') });
  assert.equal(hard.stroke, null); hard.read(p.createState());
});

async function play(difficulty, seed, active, fps = 60, duration = 360, strength = 1) {
  const p = await physics, { createComputer } = await computer;
  const state = p.createState(), cpu = createComputer({ difficulty, random: seeded(seed) });
  const human = createComputer({ difficulty: 'hard' });
  p.start(state);
  const clock = p.createClock(() => {
    let input = { x: 0, y: 0 };
    if (active) {
      // This is a reproducible reference controller, not a human win-rate estimate.
      const view = { ...state, teams: [{ ...state.teams[1], offset: -state.teams[1].offset, y: 20 - state.teams[1].y }],
        ball: { ...state.ball, x: 10 - state.ball.x, y: 20 - state.ball.y, vx: -state.ball.vx, vy: -state.ball.vy, lastHit: 1 - state.ball.lastHit } };
      const move = human.read(view); input = { x: -move.x * strength, y: -move.y * strength };
    }
    p.step(state, input, cpu.read(state), cpu.stroke);
  });
  for (let i = 0; i < fps * duration && state.phase !== 'over'; i++) clock.advance(1 / fps);
  return state;
}

test('easy can be beaten by active returns, sustains rallies, and does not reward standing still', async t => {
  let activeWins = 0, idleWins = 0, bestRally = 0, easyPoints = 0, hardPoints = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const idle = await play('easy', seed, false), active = await play('easy', seed, true);
    idleWins += idle.phase === 'over' && idle.winner === 1;
    activeWins += active.phase === 'over' && active.winner === 1;
    bestRally = Math.max(bestRally, active.bestRally); easyPoints += active.score[1];
    hardPoints += (await play('hard', seed, true)).score[1];
  }
  t.diagnostic(`100 seeds: easy active wins=${activeWins}, idle wins=${idleWins}, active points easy=${easyPoints}/hard=${hardPoints}, longest rally=${bestRally}`);
  // Occasional lucky wins are possible with genuine random stroke errors;
  // standing still must remain unreliable across a broad, reproducible sample.
  assert.ok(idleWins <= 5, `Standing still won ${idleWins}/100 matches`);
  assert.ok(activeWins >= 50); assert.ok(bestRally >= 10);
  assert.ok(easyPoints > hardPoints, 'The same return strategy earns more points against easy');
});

test('seeded CPU matches behave identically at 30 and 60 FPS on both difficulties', async () => {
  for (const difficulty of ['easy', 'hard']) assert.deepEqual(await play(difficulty, 7, true, 30, 15), await play(difficulty, 7, true, 60, 15));
});

test('difficulty preferences default to easy and tolerate blocked or invalid storage', async () => {
  const { readDifficulty, saveDifficulty, requireDifficulty } = await import('../arcade/difficulty.mjs');
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
    assert.equal(readDifficulty(), 'easy'); assert.doesNotThrow(() => saveDifficulty('hard'));
    let stored = 'invalid';
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => stored, setItem: (_, value) => { stored = value; } } });
    assert.equal(readDifficulty(), 'easy'); saveDifficulty('hard'); assert.equal(readDifficulty(), 'hard');
    assert.throws(() => requireDifficulty('medium'));
  } finally { if (old) Object.defineProperty(globalThis, 'localStorage', old); else delete globalThis.localStorage; }
});



test('placing the ball behind a CPU drawn forwards wins through a genuine missed contact', async () => {
  const p = await physics, { createComputer } = await computer;
  for (const side of [-1, 1]) for (const difficulty of ['easy', 'hard']) {
    const state = p.createState(); state.phase = 'rally';
    Object.assign(state.teams[0], { offset: side * 1.8, y: 6 });
    const x = side < 0 ? 2.5 : 7.5;
    Object.assign(state.ball, { x, y: 11, z: .8, lastHit: 0, feed: false });
    p.hitBall(state, 1, x + side * .6);
    const cpu = createComputer({ difficulty, random: () => .5 });
    while (state.phase === 'rally' && state.ball.lastHit === 1 && state.time < 5) p.step(state, { x: 0, y: 0 }, cpu.read(state), cpu.stroke);
    if (difficulty === 'easy') {
      assert.deepEqual(state.score, [0, 1]); assert.match(state.message, /Zweimal aufgesprungen/);
      assert.equal(state.rallyHits, 1, 'Point comes from missing the ball, not a forced bad shot');
    } else assert.equal(state.ball.lastHit, 0);
  }
});

test('pressured contacts sometimes stray out, mostly stay in, and retain the normal angle limit', async () => {
  const p = await physics, { createComputer } = await computer;
  const cpu = createComputer({ difficulty: 'easy', random: seeded(37) });
  let faults = 0;
  for (let i = 0; i < 1000; i++) {
    const s = p.createState(); s.phase = 'rally';
    Object.assign(s.ball, { x: 7.5, y: 3, z: .8, lastHit: 1, feed: false });
    s.teams[0].vx = 3.4;
    p.hitBall(s, 0, 7.5 - .5 * (p.C.paddleWidth / 2 + p.C.radius), s.teams[0], cpu.stroke);
    assert.equal(s.phase, 'rally'); assert.deepEqual(s.score, [0, 0]);
    assert.ok(Math.abs(s.ball.vx / s.ball.vy) <= .32 + 1e-9);
    faults += p.predictLanding(s.ball).fault === true;
  }
  assert.ok(faults > 0 && faults < 200, `${faults}/1000 marginal running contacts stray out`);
});

test('easy is beatable with a slower return controller within three minutes', async () => {
  let wins = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const state = await play('easy', seed, true, 60, 180, .7);
    wins += state.phase === 'over' && state.winner === 1;
  }
  assert.ok(wins >= 24, `${wins}/30 wins with a reduced-speed controller`);
});
