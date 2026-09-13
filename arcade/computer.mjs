import { C, clamp, predictLanding } from './physics.mjs?v=2026-09-13-easy-balanced';
import { COMPUTER_PROFILES } from './difficulty.mjs?v=2026-09-13-easy-balanced';

export function createComputer({ difficulty = 'hard', random = Math.random } = {}) {
  if (!Object.hasOwn(COMPUTER_PROFILES, difficulty)) throw new Error('Ungültige Schwierigkeitsstufe.');
  const profile = COMPUTER_PROFILES[difficulty];
  const assisted = difficulty !== 'hard';
  let nextDecision = 0, target = { offset: 0, y: 3.2 };
  let incomingShot = null, aimError = 0, reactAt = 0, lastTurn = -Infinity, previousX = 0;
  const noise = () => { const n = random() + random() - 1; return n * Math.abs(n); };
  return {
    // Evaluated at the actual contact, not when the opponent hits the ball.
    stroke: assisted ? ({ offset, team, time }) => {
      const edge = clamp((Math.abs(offset) - 0.35) / 0.65, 0, 1);
      const running = clamp(Math.hypot(team.vx, team.vy) / (C.speed * profile.speed), 0, 1);
      const turning = clamp(1 - (time - lastTurn) / 0.35, 0, 1);
      const rushed = time < reactAt ? 1 : 0;
      const pressure = clamp(edge * 0.55 + running * 0.30 + turning * 0.20 + rushed * 0.25, 0, 1);
      return {
        offset: noise() * (0.015 + 0.28 * pressure * pressure),
        length: 1 + noise() * (0.01 + 0.30 * pressure * pressure)
      };
    } : null,
    reset() {
      nextDecision = 0; target = { offset: 0, y: 3.2 }; incomingShot = null;
      aimError = 0; reactAt = 0; lastTurn = -Infinity; previousX = 0;
    },
    read(state) {
      const team = state.teams[0], b = state.ball;
      if (assisted && state.phase === 'rally') {
        // Sample once per human return, independently of rendering or decision rate.
        // Include the score because rallyHits starts over at each point.
        const shot = b.lastHit === 1 && !b.feed ? `${state.score[0]}:${state.score[1]}:${state.rallyHits}` : null;
        if (shot !== incomingShot) {
          incomingShot = shot;
          aimError = 0;
          if (shot !== null) {
            // Keep pursuing the old target during a real delay after EVERY return.
            reactAt = state.time + profile.delay + random() * profile.delaySpread;
            nextDecision = reactAt;
            aimError = (random() * 2 - 1) * 0.15;
          } else {
            reactAt = 0;
            // A short recovery leaves room behind a CPU drawn towards the net.
            nextDecision = b.feed ? state.time : state.time + 0.30;
          }
        }
      }
      if (state.time >= nextDecision) {
        nextDecision = state.time + profile.reaction;
        if (b.lastHit === 1) {
          const landing = predictLanding(b);
          // React to a short prediction, not perfect knowledge of future input.
          const y = b.bounces ? clamp(b.y + b.vy * 0.24, 1, 8.5) : clamp((landing?.y ?? 3) - 0.65, 1, 7.5);
          const travel = Math.abs(b.vy) > 0.1 ? clamp((y - b.y) / b.vy, 0, assisted && !b.feed ? profile.lookahead : 0.7) : 0;
          const x = clamp(b.x + b.vx * travel + Math.sin(state.time * 2.1) * 0.22 + aimError, 0.2, 9.8);
          const offsets = [2.5, 7.5].map(base => clamp(x - base, -C.maxOffset, C.maxOffset));
          const errors = offsets.map((v, i) => Math.abs([2.5, 7.5][i] + v - x) + Math.abs(v - team.offset) * 0.08);
          target = { offset: offsets[errors[0] <= errors[1] ? 0 : 1], y };

        } else target = { offset: team.offset * 0.7, y: 3.2 };
      }
      const x = clamp((target.offset - team.offset) * 2.1, -0.82, 0.82);
      const y = clamp((target.y - team.y) * 1.5, -0.65, 0.65);
      if (assisted && state.phase === 'rally') {
        if (x * previousX < 0 && Math.abs(x) > 0.1 && Math.abs(team.vx) > 0.5) lastTurn = state.time;
        if (Math.abs(x) > 0.1) previousX = x;
      }
      // Normalize before slowing down so diagonal movement is also 5% slower.
      const scale = 0.95 * (assisted && b.feed ? 0.70 : profile.speed) / Math.max(1, Math.hypot(x, y));
      return { x: x * scale, y: y * scale };
    }
  };
}
