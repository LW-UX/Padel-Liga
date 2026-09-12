const test = require('node:test');
const assert = require('node:assert/strict');
const physics = import('../arcade/physics.mjs');
const computer = import('../arcade/computer.mjs');
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`); }
function seeded(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }

test('easy movement is twenty percent slower in every direction, including diagonal', async () => {
  const { createComputer } = await computer, p = await physics;
  for (const offset of [-1.8, 0, 1.8]) for (const y of [1, 3.2, 8]) {
    const state = p.createState(); state.ball.lastHit = 0;
    Object.assign(state.teams[0], { offset, y });
    const hard = createComputer({ difficulty: 'hard' }).read(state);
    const easy = createComputer({ difficulty: 'easy' }).read(state);
    near(easy.x, hard.x * .8); near(easy.y, hard.y * .8);
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

test('mistakes are sampled once per return and persist across decisions, but never affect feeds', async () => {
  const { createComputer } = await computer, p = await physics;
  let calls = 0;
  const values = [0.05, 0.8, 0.5, 0.9, 0.5];
  const cpu = createComputer({ difficulty: 'easy', random: () => values[calls++] });
  const state = p.createState(); state.phase = 'rally'; cpu.read(state); assert.equal(calls, 0);
  Object.assign(state.ball, { feed: false, x: 2.5, vx: 0, vy: 0 }); state.rallyHits = 2;
  let firstInput;
  for (const time of [.41, .82, 1.23]) {
    state.time = time;
    const input = cpu.read(state);
    assert.ok(input.x > .5, 'A large rightward error remains on later decisions');
    if (firstInput) assert.deepEqual(input, firstInput, 'The mistaken target stays fixed');
    firstInput = input;
  }
  assert.equal(calls, 3);
  // Point intermissions and pauses must not consume another mistake.
  state.score[0]++; state.phase = 'point'; cpu.read(state); assert.equal(calls, 3);
  state.phase = 'paused'; cpu.read(state); assert.equal(calls, 3);
  // New point with the same rallyHits is a new return.
  state.phase = 'rally'; state.time = 1.64; cpu.read(state); assert.equal(calls, 5);
  cpu.reset(); state.ball.feed = true; state.time = 0;
  near(cpu.read(state).x, 0); assert.equal(calls, 5);
  const hard = createComputer({ difficulty: 'hard', random: () => assert.fail('hard sampled a mistake') });
  state.ball.feed = false; hard.read(state);
});

test('small errors remain bounded and resetting reproduces the initial controller state', async () => {
  const { createComputer } = await computer, p = await physics;
  for (const value of [0, .25, .5, .75, 1]) {
    let draw = 0;
    const cpu = createComputer({ difficulty: 'easy', random: () => ++draw % 2 ? .5 : value });
    const state = p.createState(); state.phase = 'rally'; state.ball.feed = false;
    const input = cpu.read(state);
    near(input.x, (value * 2 - 1) * .25 * 2.1 * .95 * .8);
    state.time = 10; state.ball.x = 9; cpu.read(state);
    cpu.reset(); near(cpu.read(p.createState()).x, 0);
  }
});

test('stroke mistakes persist per return, reset on feeds, and are never sampled on hard', async () => {
  const { createComputer } = await computer, p = await physics;
  for (const [outcome, expected] of [[.1, null], [.28, 'long'], [.34, 'wide'], [.6, null]]) {
    let calls = 0;
    const cpu = createComputer({ difficulty: 'easy', random: () => calls++ === 0 ? outcome : .5 });
    const state = p.createState(); state.phase = 'rally';
    cpu.read(state); assert.equal(calls, 0); assert.equal(cpu.shotError, null);
    state.ball.feed = false; cpu.read(state);
    const sampled = calls;
    for (const phase of ['rally', 'paused', 'point']) {
      state.phase = phase; state.time += 1; cpu.read(state);
      assert.equal(cpu.shotError, expected); assert.equal(calls, sampled);
    }
    p.feed(state); cpu.read(state); assert.equal(cpu.shotError, null);
    state.ball.feed = false; state.ball.lastHit = 1; cpu.read(state);
    assert.ok(calls > sampled);
    cpu.reset(); assert.equal(cpu.shotError, null);
  }
  const hard = createComputer({ difficulty: 'hard', random: () => assert.fail('hard sampled a mistake') });
  const state = p.createState(); state.phase = 'rally'; state.ball.feed = false;
  hard.read(state); assert.equal(hard.shotError, null);
});

test('easy stroke mistakes travel from an actual paddle hit to the rear or side wall before scoring', async () => {
  const { createComputer } = await computer, p = await physics;
  for (const [outcome, error] of [[.28, 'long'], [.34, 'wide']]) for (const x of [2.5, 7.5]) {
    const state = p.createState(); state.phase = 'rally';
    Object.assign(state.ball, { x, y: 3.4, z: .8, vx: 0, vy: -8, vz: 0, lastHit: 1, feed: false });
    state.teams[1].offset = x < 5 ? 1.8 : -1.8;
    let calls = 0;
    const cpu = createComputer({ difficulty: 'easy', random: () => calls++ === 0 ? outcome : .5 });
    while (state.rallyHits === 0 && state.time < 1) p.step(state, { x: 0, y: 0 }, cpu.read(state), cpu.shotError);
    assert.equal(state.ball.lastHit, 0); assert.equal(state.rallyHits, 1);
    assert.equal(cpu.shotError, error); assert.equal(state.phase, 'rally');
    assert.deepEqual(state.score, [0, 0], 'Choosing a mistake or hitting never awards a point');
    const hitTime = state.time;
    while (state.phase === 'rally' && state.time < 5) p.step(state, { x: 0, y: 0 }, cpu.read(state), cpu.shotError);
    assert.ok(state.time - hitTime > .1, 'The erroneous shot has a visible flight');
    assert.deepEqual(state.score, [0, 1]); assert.match(state.message, /(?:Wand|Zaun) vor Boden/);
    assert.equal(state.ball.bounces, 0);
    if (error === 'long') near(state.ball.y, p.C.length - p.C.radius);
    else near(state.ball.x, x < 5 ? p.C.radius : p.C.width - p.C.radius);
  }
});

async function play(difficulty, seed, active, fps = 60, duration = 180) {
  const p = await physics, { createComputer } = await computer;
  const state = p.createState(), cpu = createComputer({ difficulty, random: seeded(seed) });
  const human = createComputer({ difficulty: 'hard' });
  p.start(state);
  const clock = p.createClock(() => {
    let input = { x: 0, y: 0 };
    if (active) {
      // Mirror the same active return strategy onto the player's half.
      const view = { ...state, teams: [{ ...state.teams[1], offset: -state.teams[1].offset, y: 20 - state.teams[1].y }],
        ball: { ...state.ball, x: 10 - state.ball.x, y: 20 - state.ball.y, vx: -state.ball.vx, vy: -state.ball.vy, lastHit: 1 - state.ball.lastHit } };
      const move = human.read(view); input = { x: -move.x, y: -move.y };
    }
    p.step(state, input, cpu.read(state), cpu.shotError);
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


test('committed mistakes physically miss returnable balls at the centre and both formation limits', async () => {
  const p = await physics, { createComputer } = await computer;
  for (const x of [.9, 2.5, 4.1, 5.9, 7.5, 9.1]) for (const direction of [.2, .8]) {
    for (const mistake of [false, true]) {
      const state = p.createState(); state.phase = 'rally';
      Object.assign(state.ball, { x, y: 17, z: .8, lastHit: 0, feed: false });
      p.hitBall(state, 1, x);
      // A 15% draw now produces a mistake; the old 10% policy did not.
      const samples = mistake ? [.15, direction, .5] : [.9, .5]; let draw = 0;
      const cpu = createComputer({ difficulty: 'easy', random: () => samples[draw++ % samples.length] });
      while (state.phase === 'rally' && state.ball.lastHit === 1 && state.time < 10) p.step(state, { x: 0, y: 0 }, cpu.read(state));
      if (mistake) {
        assert.deepEqual(state.score, [0, 1], `Miss expected at x=${x}, direction=${direction}`);
        assert.match(state.message, /Zweimal aufgesprungen/);
        assert.equal(state.rallyHits, 1, 'No invisible stroke or artificial point');
      } else {
        assert.equal(state.ball.lastHit, 0, `Normal CPU must return x=${x}`);
        assert.deepEqual(state.score, [0, 0]);
      }
    }
  }
});
