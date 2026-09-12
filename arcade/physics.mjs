import { RULESET } from './ruleset.mjs?v=2026-09-12-rules-v2';

// Court coordinates: metres, origin at the computer's back-left corner.
// z is height above the floor. Rendering never changes collision coordinates.
export const C = Object.freeze({
  width: 10, length: 20, net: 10, netHeight: 0.9, gravity: 12,
  radius: 0.12, paddleWidth: 1.4, paddleDepth: 0.28, reach: 1.65,
  maxOffset: 1.8, speed: 5.2, acceleration: 78, step: 1 / 60,
  bounce: 0.76, wallBounce: 0.80, fenceBounce: 0.86, glassLength: 4,
  shortReduction: 0.40, targetScore: 7
});
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const EPS = 1e-8;
export const sideAt = y => y < C.net ? 0 : 1;
// At the join itself the central mesh takes precedence, on both halves.
export const boundaryMaterial = (axis, y) => axis === 'y' || y < C.glassLength || y > C.length - C.glassLength ? 'wall' : 'fence';
function boundaryContact(ball, axis) {
  const material = boundaryMaterial(axis, ball.y);
  return {
    material,
    fault: ball.bounces === 0 && (material === 'fence' || sideAt(ball.y) !== ball.lastHit),
    damping: material === 'wall' ? C.wallBounce : C.fenceBounce
  };
}
export const heightAt = (b, t) => b.z + b.vz * t - C.gravity * t * t / 2;
export function groundTime(b) {
  return (b.vz + Math.sqrt(Math.max(0, b.vz * b.vz + 2 * C.gravity * b.z))) / C.gravity;
}
export function createState() {
  return {
    ruleset: RULESET, phase: 'ready', resumePhase: 'rally', score: [0, 0], time: 0,
    teams: [0, 1].map(side => ({ side, offset: 0, y: side ? 17 : 3, vx: 0, vy: 0, power: 0 })),
    ball: { x: 2.5, y: 17, z: 0.8, vx: 0, vy: 0, vz: 0, lastHit: 1, bounces: 0, feed: true, contactSide: null },
    message: 'Bereit für eine kurze Partie?', rallyHits: 0, bestRally: 0,
    pointTimer: 0, effects: [], winner: null
  };
}
export function reset(state) { Object.assign(state, createState()); }
export function pause(state) {
  if (state.phase === 'rally' || state.phase === 'point') {
    state.resumePhase = state.phase;
    state.phase = 'paused';
  }
}
export function start(state) {
  if (state.phase === 'paused') state.phase = state.resumePhase;
  else if (state.phase === 'ready') feed(state);
}
export function feed(state) {
  const total = state.score[0] + state.score[1];
  const server = total % 2 ? 0 : 1;
  state.teams.forEach(t => Object.assign(t, { offset: 0, y: t.side ? 17 : 3, vx: 0, vy: 0, power: 0 }));
  const x = total % 4 < 2 ? 2.5 : 7.5;
  Object.assign(state.ball, { x, y: server ? 17 : 3, z: 0.8, lastHit: server, bounces: 0, feed: true, contactSide: null });
  // Safe diagonal opening ball; it is intentionally not an official serve.
  const t = 1.6;
  const targetX = x < C.width / 2 ? C.width - 2 : 2;
  state.ball.vx = (targetX - x) / t;
  state.ball.vy = (server ? -13 : 13) / t;
  state.ball.vz = (C.gravity * t * t / 2 - state.ball.z) / t;
  state.rallyHits = 0;
  state.phase = 'rally';
  state.message = 'Anspiel · erst aufspringen lassen';
}
export function awardPoint(state, winner, reason) {
  if (state.phase !== 'rally') return;
  state.score[winner]++;
  state.winner = winner;
  state.message = `${winner ? 'Dein Punkt' : 'Punkt Computer'} · ${reason}`;
  state.phase = state.score[winner] >= C.targetScore ? 'over' : 'point';
  state.pointTimer = 1.8;
  state.bestRally = Math.max(state.bestRally, state.rallyHits);
}
function approach(value, target, amount) {
  return value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);
}
export function moveTeam(team, input, dt) {
  const norm = Math.max(1, Math.hypot(input.x || 0, input.y || 0));
  let vx = approach(team.vx, (input.x || 0) / norm * C.speed, C.acceleration * dt);
  let vy = approach(team.vy, (input.y || 0) / norm * C.speed, C.acceleration * dt);
  const speedScale = Math.max(1, Math.hypot(vx, vy) / C.speed);
  vx /= speedScale; vy /= speedScale;
  const oldX = team.offset, oldY = team.y;
  team.offset = clamp(oldX + vx * dt, -C.maxOffset, C.maxOffset);
  team.y = clamp(oldY + vy * dt, team.side ? 10.9 : 0.65, team.side ? 19.35 : 9.1);
  team.vx = (team.offset - oldX) / dt;
  team.vy = (team.y - oldY) / dt;
  const forward = clamp(team.vy * (team.side ? -1 : 1) / C.speed, -1, 1);
  team.power += (forward - team.power) * (1 - Math.exp(-dt / 0.10));
}
export function hitBall(state, side, paddleX, team = state.teams[side], shotError = null) {
  const b = state.ball;
  if (!b.feed && b.lastHit === side) {
    awardPoint(state, 1 - side, 'Doppelkontakt');
    return;
  }
  b.contactSide = side;
  const direction = side ? -1 : 1;
  const offset = clamp((b.x - paddleX) / (C.paddleWidth / 2 + C.radius), -1, 1);
  const targetY = side ? 2.8 : 17.2;
  const distance = Math.abs(targetY - b.y);
  const mistake = side === 0 && !b.feed ? shotError : null;
  const power = mistake === 'long' ? 1 : clamp(team.power, 0, 1);
  const soft = mistake === 'long' ? 1 : 1 + C.shortReduction * clamp(team.power, -1, 0);
  // At full forward speed the predicted first bounce is beyond the back wall.
  // The resulting flight is simulated until a collision decides the point.
  const wallDistance = side ? b.y - C.radius : C.length - C.radius - b.y;
  const travel = distance + (wallDistance + 2.4 - distance) * power * power;
  // Neutral and hard strokes retain their original arc. Backward movement
  // slows horizontal travel only, so a soft stroke can genuinely hit the net.
  const netFraction = clamp(Math.abs(C.net - b.y) / travel, 0.02, 0.98);
  const needed = C.netHeight + 0.22 - b.z * (1 - netFraction);
  const duration = Math.max(1.05, Math.sqrt(Math.max(0, 2 * needed / (C.gravity * netFraction * (1 - netFraction)))));
  b.vy = direction * travel / duration;
  b.vx = Math.abs(b.vy) * offset * 0.32;
  if (mistake === 'wide') {
    // Aim beyond the nearer side wall before the planned first bounce.
    // The normal collision rules decide the point when the ball gets there.
    const wallX = b.x <= C.width / 2 ? -0.5 : C.width + 0.5;
    b.vx = (wallX - b.x) / (duration * 0.65);
  }
  b.vx *= soft;
  b.vy *= soft;
  b.vz = (C.gravity * duration * duration / 2 - b.z) / duration;
  b.lastHit = side;
  b.bounces = 0;
  b.feed = false;
  state.rallyHits++;
  state.bestRally = Math.max(state.bestRally, state.rallyHits);
  state.message = power > 0.85 ? 'Viel Druck · Achtung, Wand!' : soft < 0.94 ? 'Kurz gespielt · Achtung, Netz!' : 'Ballwechsel';
  state.effects.push({ x: b.x, y: b.y, age: 0, kind: 'hit' });
}
function axisInterval(position, velocity, half) {
  if (Math.abs(velocity) < EPS) return Math.abs(position) <= half ? [-Infinity, Infinity] : null;
  const a = (-half - position) / velocity, b = (half - position) / velocity;
  return [Math.min(a, b), Math.max(a, b)];
}
function paddleTime(b, paddle, remaining) {
  const xi = axisInterval(b.x - paddle.x, b.vx - paddle.vx, C.paddleWidth / 2 + C.radius);
  const yi = axisInterval(b.y - paddle.y, b.vy - paddle.vy, C.paddleDepth / 2 + C.radius);
  if (!xi || !yi) return null;
  const entry = Math.max(0, xi[0], yi[0]), leave = Math.min(remaining, xi[1], yi[1]);
  if (entry > leave + EPS) return null;
  if (heightAt(b, entry) >= -EPS && heightAt(b, entry) <= C.reach + EPS) return entry;
  // A ball may descend into reach while still overlapping the moving paddle.
  const disc = b.vz * b.vz + 2 * C.gravity * (b.z - C.reach);
  if (disc < 0) return null;
  const descend = (b.vz + Math.sqrt(disc)) / C.gravity;
  return descend >= entry && descend <= leave ? descend : null;
}
function advance(b, t) {
  b.x += b.vx * t; b.y += b.vy * t;
  b.z = Math.max(0, heightAt(b, t)); b.vz -= C.gravity * t;
}
export function simulateBall(state, dt, origins = state.teams.map(t => ({ ...t })), computerShotError = null) {
  const b = state.ball;
  let remaining = dt, elapsed = 0;
  for (let iteration = 0; remaining > EPS && iteration < 20 && state.phase === 'rally'; iteration++) {
    const events = [];
    const add = (time, type, priority, extra = {}) => {
      if (time >= -EPS && time <= remaining + EPS) events.push({ time: Math.max(0, time), type, priority, ...extra });
    };
    add(groundTime(b), 'ground', 0);
    if (Math.abs(b.vx) > EPS) add(((b.vx > 0 ? C.width - C.radius : C.radius) - b.x) / b.vx, 'wallX', 2);
    if (Math.abs(b.vy) > EPS) {
      add(((b.vy > 0 ? C.length - C.radius : C.radius) - b.y) / b.vy, 'wallY', 2);
      const netTime = (C.net - b.y) / b.vy;
      if (netTime > EPS) add(netTime, 'net', 1);
    }
    // A stroke starts inside the paddle's collision volume. Suppress that same
    // continuous overlap until the ball leaves it, then count a new contact.
    if (b.contactSide != null) {
      const team = state.teams[b.contactSide], origin = origins[b.contactSide];
      const touching = b.z <= C.reach && [2.5, 7.5].some(base =>
        Math.abs(b.x - (base + origin.offset + team.vx * elapsed)) <= C.paddleWidth / 2 + C.radius + EPS
        && Math.abs(b.y - (origin.y + team.vy * elapsed)) <= C.paddleDepth / 2 + C.radius + EPS);
      if (!touching) b.contactSide = null;
    }
    for (const side of [0, 1]) {
      if (b.contactSide === side || (b.feed && (b.bounces === 0 || side === b.lastHit))) continue;
      const team = state.teams[side], origin = origins[side];
      for (const base of [2.5, 7.5]) {
        const paddle = { x: base + origin.offset + team.vx * elapsed, y: origin.y + team.vy * elapsed, vx: team.vx, vy: team.vy };
        const t = paddleTime(b, paddle, remaining);
        if (t !== null) add(t, 'paddle', 3, { side, x: paddle.x + team.vx * t });
      }
    }
    events.sort((a, c) => Math.abs(a.time - c.time) < EPS ? a.priority - c.priority : a.time - c.time);
    const event = events[0];
    if (!event) { advance(b, remaining); break; }
    advance(b, event.time); remaining -= event.time; elapsed += event.time;
    if (event.type === 'ground') {
      if (sideAt(b.y) === b.lastHit && b.bounces === 0) awardPoint(state, 1 - b.lastHit, 'Boden auf eigener Seite');
      else if (b.bounces >= 1) awardPoint(state, b.lastHit, 'Zweimal aufgesprungen');
      else {
        b.bounces++; b.z = 0; b.vz = Math.abs(b.vz) * C.bounce;
        state.effects.push({ x: b.x, y: b.y, age: 0, kind: 'bounce' });
        state.message = 'Einmal aufgesprungen · Wandspiel erlaubt';
      }
    } else if (event.type === 'wallX' || event.type === 'wallY') {
      const axis = event.type === 'wallX' ? 'x' : 'y';
      const contact = boundaryContact(b, axis);
      if (contact.fault) awardPoint(state, 1 - b.lastHit, contact.material === 'fence' ? 'Zaun vor Boden' : 'Wand vor Boden');
      else {
        b[`v${axis}`] *= -contact.damping;
        state.effects.push({ x: b.x, y: b.y, age: 0, kind: 'wall' });
      }
    } else if (event.type === 'net') {
      if (b.z <= C.netHeight + C.radius) {
        const returned = b.bounces > 0;
        awardPoint(state, returned ? b.lastHit : 1 - b.lastHit, returned ? 'Nach Aufsprung zurück ins Netz' : 'Im Netz');
      }
    } else {
      hitBall(state, event.side, event.x, state.teams[event.side], event.side === 0 ? computerShotError : null);
    }
  }
}
export function step(state, human = { x: 0, y: 0 }, computer = { x: 0, y: 0 }, computerShotError = null) {
  if (state.phase !== 'rally' && state.phase !== 'point') return;
  state.time += C.step;
  state.effects.forEach(e => { e.age += C.step; });
  state.effects = state.effects.filter(e => e.age < 0.4);
  if (state.phase === 'point') {
    state.pointTimer -= C.step;
    if (state.pointTimer <= 0) feed(state);
    return;
  }
  const origins = state.teams.map(t => ({ ...t }));
  moveTeam(state.teams[0], computer, C.step);
  moveTeam(state.teams[1], human, C.step);
  simulateBall(state, C.step, origins, computerShotError);
}
// Frame rate changes only presentation; each call consumes 60 Hz simulation ticks.
export function createClock(tick) {
  let accumulator = 0;
  return {
    advance(seconds) {
      accumulator += clamp(seconds, 0, 0.1);
      while (accumulator + EPS >= C.step) { tick(); accumulator -= C.step; }
    },
    reset() { accumulator = 0; }
  };
}
export function predictLanding(ball) {
  const b = { ...ball };
  // Follow rebounds up to the next floor contact, for the visual landing aid.
  let remaining = groundTime(b);
  for (let i = 0; i < 8; i++) {
    const tx = Math.abs(b.vx) < EPS ? Infinity : ((b.vx > 0 ? C.width - C.radius : C.radius) - b.x) / b.vx;
    const ty = Math.abs(b.vy) < EPS ? Infinity : ((b.vy > 0 ? C.length - C.radius : C.radius) - b.y) / b.vy;
    const t = Math.min(tx, ty);
    // Ground wins simultaneous contacts, just as in the live simulation.
    if (t >= remaining - EPS || t < -EPS) return { x: b.x + b.vx * remaining, y: b.y + b.vy * remaining, fault: false };
    b.x += b.vx * t; b.y += b.vy * t; remaining -= t;
    for (const axis of ['x', 'y']) {
      if (Math.abs((axis === 'x' ? tx : ty) - t) >= EPS) continue;
      const contact = boundaryContact(b, axis);
      if (contact.fault) return { x: b.x, y: b.y, fault: true };
      b[`v${axis}`] *= -contact.damping;
    }
  }
  return null;
}
