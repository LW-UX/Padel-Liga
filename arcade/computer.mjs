import { C, clamp, predictLanding } from './physics.mjs';
import { DIFFICULTIES, requireDifficulty } from './difficulty.mjs?v=2026-09-12-easy-errors';

export function createComputer({ difficulty = 'hard', random = Math.random } = {}) {
  const profile = DIFFICULTIES[requireDifficulty(difficulty)];
  let nextDecision = 0, target = { offset: 0, y: 3.2 };
  let incomingShot = null, aimError = 0, mistakeOffset = null, shotError = null;
  return {
    get shotError() { return shotError; },
    reset() { nextDecision = 0; target = { offset: 0, y: 3.2 }; incomingShot = null; aimError = 0; mistakeOffset = null; shotError = null; },
    read(state) {
      const team = state.teams[0], b = state.ball;
      if (difficulty === 'easy' && state.phase === 'rally') {
        // Sample once per human return, independently of rendering or decision rate.
        // Include the score because rallyHits starts over at each point.
        const shot = b.lastHit === 1 && !b.feed ? `${state.score[0]}:${state.score[1]}:${state.rallyHits}` : null;
        if (shot !== incomingShot) {
          incomingShot = shot;
          aimError = 0;
          mistakeOffset = null;
          shotError = null;
          if (shot !== null) {
            // Mutually exclusive mistakes: 25% positioning, 6% too long,
            // 6% too wide. A stroke error still needs a real paddle contact.
            const outcome = random(), miss = outcome < 0.25;
            shotError = outcome >= 0.25 && outcome < 0.31 ? 'long'
              : outcome >= 0.31 && outcome < 0.37 ? 'wide' : null;
            aimError = miss ? (random() < 0.5 ? -1 : 1) * (1.25 + random() * 0.4) : (random() * 2 - 1) * 0.25;
          }
        }
      }
      if (state.time >= nextDecision) {
        nextDecision = state.time + profile.reaction;
        if (b.lastHit === 1) {
          const landing = predictLanding(b);
          // React to a short prediction, not perfect knowledge of future input.
          const y = b.bounces ? clamp(b.y + b.vy * 0.24, 1, 8.5) : clamp((landing?.y ?? 3) - 0.65, 1, 7.5);
          const travel = Math.abs(b.vy) > 0.1 ? clamp((y - b.y) / b.vy, 0, 0.7) : 0;
          const misjudged = Math.abs(aimError) > 1;
          const x = clamp(b.x + b.vx * travel + Math.sin(state.time * 2.1) * 0.22 + (misjudged ? 0 : aimError), 0.2, 9.8);
          const offsets = [2.5, 7.5].map(base => clamp(x - base, -C.maxOffset, C.maxOffset));
          const errors = offsets.map((v, i) => Math.abs([2.5, 7.5][i] + v - x) + Math.abs(v - team.offset) * 0.08);
          target = { offset: offsets[errors[0] <= errors[1] ? 0 : 1], y };
          if (misjudged) {
            if (mistakeOffset === null) {
              // Applying error to the ball before formation clamping often erased
              // it near a boundary, or let the other paddle rescue the return.
              // Pick an attainable wrong position and commit to it for this shot.
              const candidates = [aimError, -aimError].map(error => clamp(target.offset + error, -C.maxOffset, C.maxOffset));
              const clearance = offset => Math.min(...[2.5, 7.5].map(base => Math.abs(base + offset - x)));
              mistakeOffset = clearance(candidates[0]) >= C.paddleWidth / 2 + C.radius + 0.3
                ? candidates[0] : candidates[1];
            }
            target.offset = mistakeOffset;
          }
        } else target = { offset: team.offset * 0.7, y: 3.2 };
      }
      const x = clamp((target.offset - team.offset) * 2.1, -0.82, 0.82);
      const y = clamp((target.y - team.y) * 1.5, -0.65, 0.65);
      // Normalize before slowing down so diagonal movement is also 5% slower.
      const scale = 0.95 * profile.speed / Math.max(1, Math.hypot(x, y));
      return { x: x * scale, y: y * scale };
    }
  };
}
