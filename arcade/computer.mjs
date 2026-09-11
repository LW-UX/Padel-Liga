import { C, clamp, predictLanding } from './physics.mjs';

export function createComputer() {
  let nextDecision = 0, target = { offset: 0, y: 3.2 };
  return {
    reset() { nextDecision = 0; target = { offset: 0, y: 3.2 }; },
    read(state) {
      const team = state.teams[0], b = state.ball;
      if (state.time >= nextDecision) {
        nextDecision = state.time + 0.20;
        if (b.lastHit === 1) {
          const landing = predictLanding(b);
          // React to a short prediction, not perfect knowledge of future input.
          const y = b.bounces ? clamp(b.y + b.vy * 0.24, 1, 8.5) : clamp((landing?.y ?? 3) - 0.65, 1, 7.5);
          const travel = Math.abs(b.vy) > 0.1 ? clamp((y - b.y) / b.vy, 0, 0.7) : 0;
          const x = clamp(b.x + b.vx * travel + Math.sin(state.time * 2.1) * 0.22, 0.2, 9.8);
          const offsets = [2.5, 7.5].map(base => clamp(x - base, -C.maxOffset, C.maxOffset));
          const errors = offsets.map((v, i) => Math.abs([2.5, 7.5][i] + v - x) + Math.abs(v - team.offset) * 0.08);
          target = { offset: offsets[errors[0] <= errors[1] ? 0 : 1], y };
        } else target = { offset: team.offset * 0.7, y: 3.2 };
      }
      return { x: clamp((target.offset - team.offset) * 2.1, -0.82, 0.82), y: clamp((target.y - team.y) * 1.5, -0.65, 0.65) };
    }
  };
}
