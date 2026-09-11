import { C, clamp, createState, createClock, start, pause, reset, step, moveTeam } from './physics.mjs';
import { connectRealtime } from './realtime.mjs';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ZERO = Object.freeze({ x: 0, y: 0 });
export const ONLINE = Object.freeze({ silence: 1500, expiry: 20000, joinTimeout: 10000, countdown: 3000, protocol: 1 });
export function generateCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), n => ALPHABET[n % ALPHABET.length]).join('');
}
export function normalizeCode(value) {
  const code = String(value).replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error('Bitte gib den sechsstelligen Raumcode ein.');
  return code;
}
export function cleanInput(input) {
  if (!input || !Number.isFinite(input.x) || !Number.isFinite(input.y)) return { ...ZERO };
  return { x: clamp(input.x, -1, 1), y: clamp(input.y, -1, 1) };
}
// Rotate the court, including velocities and ownership, while leaving ball height upright.
export function perspective(state, side) {
  const view = structuredClone(state);
  if (side === 0) {
    view.score.reverse();
    view.winner = view.winner === null ? null : 1 - view.winner;
    view.teams.reverse();
    view.teams.forEach((t, i) => Object.assign(t, { side: i, offset: -t.offset, y: C.length - t.y, vx: -t.vx, vy: -t.vy }));
    Object.assign(view.ball, { x: C.width - view.ball.x, y: C.length - view.ball.y, vx: -view.ball.vx, vy: -view.ball.vy, lastHit: 1 - view.ball.lastHit, contactSide: view.ball.contactSide == null ? null : 1 - view.ball.contactSide });
    view.effects.forEach(e => Object.assign(e, { x: C.width - e.x, y: C.length - e.y }));
  }
  if (['point', 'over'].includes(view.phase)) view.message = `${view.winner === 1 ? 'Dein Punkt' : 'Punkt Gegner'} · ${view.message.split(' · ').slice(1).join(' · ')}`;
  return view;
}
export function validSnapshot(s) {
  const finite = (o, keys) => o && keys.every(k => Number.isFinite(o[k]) && Math.abs(o[k]) < 1e6);
  return s && ['ready', 'rally', 'point', 'paused', 'over'].includes(s.phase)
    && ['rally', 'point'].includes(s.resumePhase) && [null, 0, 1].includes(s.winner)
    && Array.isArray(s.score) && s.score.length === 2 && s.score.every(n => Number.isInteger(n) && n >= 0 && n <= 7)
    && finite(s, ['time', 'pointTimer', 'rallyHits', 'bestRally']) && s.time >= 0
    && Array.isArray(s.teams) && s.teams.length === 2 && s.teams.every((t, i) => t.side === i && finite(t, ['offset', 'y', 'vx', 'vy', 'power']))
    && finite(s.ball, ['x', 'y', 'z', 'vx', 'vy', 'vz', 'bounces']) && [0, 1].includes(s.ball.lastHit)
    && typeof s.ball.feed === 'boolean' && typeof s.message === 'string' && s.message.length < 200
    && Array.isArray(s.effects) && s.effects.length <= 40 && s.effects.every(e => finite(e, ['x', 'y', 'age']) && ['hit', 'wall', 'bounce'].includes(e.kind));
}

// Host is the sole authority for seats, readiness, physics and score. Room messages
// are ephemeral; the code grants access, not verified identity or ranked fairness.
export class OnlineSession {
  constructor({ role, code, config, onChange = () => {}, readInput = () => ZERO, now = () => performance.now(), connect = connectRealtime, id = crypto.randomUUID() }) {
    this.role = role; this.code = normalizeCode(code); this.id = id;
    this.now = now; this.onChange = onChange; this.readInput = readInput;
    this.side = role === 'host' ? 1 : 0;
    this.state = createState(); this.stage = 'connecting'; this.message = 'Verbindung wird aufgebaut …';
    this.ready = [false, false]; this.round = 0; this.epoch = 0; this.revision = 0; this.receivedRevision = -1;
    this.remoteInput = ZERO; this.inputAt = 0; this.inputSequence = 0; this.receivedInput = -1;
    this.connected = false; this.peer = null; this.lastPeer = null; this.startedAt = now(); this.lastSent = -Infinity;
    this.visible = true; this.peerVisible = true; this.suspended = false; this.closed = false;
    this.clock = createClock(() => {
      if (this.role === 'host') step(this.state, this.visible ? cleanInput(this.readInput()) : ZERO, this.now() - this.inputAt < 250 ? this.remoteInput : ZERO);
      else if (this.predicted && this.stage === 'playing' && this.state.phase === 'rally') moveTeam(this.predicted, this.visible ? cleanInput(this.readInput()) : ZERO, C.step);
    });
    this.transport = connect(config, this.code, { onMessage: m => this.receive(m), onStatus: ok => this.connection(ok) });
  }
  emit() { this.onChange(this); }
  send(type, data = {}, to = this.peer) {
    return this.transport?.send({ v: ONLINE.protocol, from: this.id, to, type, ...data });
  }
  connection(ok) {
    if (this.closed) return;
    this.connected = ok;
    if (ok) {
      if (this.stage === 'connecting' && this.role === 'host') {
        this.probeUntil = this.now() + 800;
        this.send('probe', {}, null);
      } else if (this.role === 'guest' && !this.peer) this.send('join', {}, null);
      if (this.peer) this.send('ping', { visible: this.visible });
    } else if (this.peer) this.hold('Verbindung unterbrochen. Wir warten auf die Rückkehr …');
    this.emit();
  }
  receive(m) {
    if (this.closed || !m || m.v !== ONLINE.protocol || typeof m.from !== 'string' || m.from.length > 80 || m.from === this.id || (m.to && m.to !== this.id)) return;
    if (this.role === 'host' && m.type === 'probe') {
      if (this.stage !== 'connecting' || this.id < m.from) this.send('occupied', {}, m.from);
      return;
    }
    if (this.role === 'host' && m.type === 'occupied' && this.stage === 'connecting') {
      this.end('Dieser Code ist bereits vergeben. Bitte erstelle ein neues Spiel.'); return;
    }
    if (this.role === 'host' && m.type === 'join') {
      if (this.stage === 'connecting') return;
      if (this.peer && this.peer !== m.from) { this.send('reject', { reason: 'Das Spiel ist bereits voll.' }, m.from); return; }
      if (!this.peer && this.stage !== 'waiting') return;
      if (!this.peer) { this.peer = m.from; this.lastPeer = this.now(); this.ready = [false, false]; this.message = 'Ihr seid zu zweit. Seid ihr bereit?'; }
      this.send('accepted', { round: this.round }, m.from); this.broadcast(); this.emit(); return;
    }
    if (this.role === 'guest' && !this.peer && m.type === 'reject') { this.end('Das Spiel ist bereits voll.'); return; }
    if (this.role === 'guest' && !this.peer && m.type === 'accepted') {
      this.peer = m.from; this.lastPeer = this.now(); this.stage = 'waiting'; this.message = 'Ihr seid zu zweit. Seid ihr bereit?'; this.send('ping', { visible: this.visible }); this.emit(); return;
    }
    if (m.from !== this.peer) return;
    // Only recognized, structurally valid peer messages refresh the lease.
    if (m.type === 'snapshot' && this.role === 'guest') {
      if (!Number.isInteger(m.epoch) || m.epoch < this.epoch || !Number.isInteger(m.revision) || m.revision <= this.receivedRevision || !Number.isInteger(m.round) || m.round < this.round || !validSnapshot(m.state)
        || !['waiting', 'countdown', 'playing', 'paused', 'over'].includes(m.stage)
        || !Array.isArray(m.ready) || m.ready.length !== 2 || !m.ready.every(v => typeof v === 'boolean')
        || !Number.isFinite(m.countdown) || typeof m.message !== 'string' || m.message.length > 200) return;
      this.lastPeer = this.now(); this.receivedRevision = m.revision;
      const discontinuity = this.round !== m.round || this.state.phase !== m.state.phase || this.state.score.some((n, i) => n !== m.state.score[i]);
      this.previousSnapshot = this.state; this.state = m.state; this.snapshotAt = this.now();
      this.round = m.round; this.epoch = m.epoch; this.ready = m.ready; this.stage = m.stage; this.message = m.message;
      this.countdown = m.countdown; this.suspended = false;
      const own = perspective(this.state, 0).teams[1];
      if (!this.predicted || discontinuity || Math.hypot(this.predicted.offset - own.offset, this.predicted.y - own.y) > 1.5) this.predicted = { ...own };
      this.emit(); return;
    }
    if (m.type === 'ping' && typeof m.visible === 'boolean') {
      this.lastPeer = this.now(); this.peerVisible = m.visible;
      if (this.role === 'host') {
        if (!m.visible) this.hold('Partie pausiert. Beide müssen bereit sein.');
        else if (this.suspended && this.connected) { this.suspended = false; this.message = 'Wieder verbunden. Beide müssen bereit sein.'; }
      }
      this.emit(); return;
    }
    if (m.type === 'leave') { this.end(this.role === 'guest' ? 'Der Host hat das Spiel verlassen.' : 'Dein Gegner hat das Spiel verlassen.'); return; }
    if (this.role !== 'host' || m.round !== this.round) return;
    if (m.type === 'input' && Number.isInteger(m.seq) && m.seq > this.receivedInput && Number.isFinite(m.input?.x) && Number.isFinite(m.input?.y)) {
      this.lastPeer = this.now(); this.receivedInput = m.seq; this.inputAt = this.now();
      const input = cleanInput(m.input); this.remoteInput = { x: -input.x, y: -input.y };
    } else if (m.type === 'ready' && m.epoch === this.epoch && typeof m.value === 'boolean') {
      this.lastPeer = this.now(); this.setReady(0, m.value);
    } else if (m.type === 'pause' && m.epoch === this.epoch) { this.lastPeer = this.now(); this.hold('Partie pausiert. Beide müssen bereit sein.'); }
  }
  broadcast() {
    if (this.role !== 'host' || !this.peer || this.closed) return;
    this.send('snapshot', { state: this.state, stage: this.stage, message: this.message, ready: this.ready, round: this.round, epoch: this.epoch, revision: ++this.revision, countdown: this.stage === 'countdown' ? Math.max(0, this.countdownUntil - this.now()) : 0 });
  }
  hold(message) {
    if (this.closed) return;
    if (this.role === 'host' && (['playing', 'countdown'].includes(this.stage) || this.ready.some(Boolean))) this.epoch++;
    if (['playing', 'countdown'].includes(this.stage)) {
      pause(this.state); this.stage = 'paused'; this.ready = [false, false]; this.clock.reset();
    }
    this.ready = [false, false];
    this.remoteInput = ZERO;
    this.message = message;
    this.broadcast(); this.emit();
  }
  setReady(side, value) {
    if (!this.peer || this.suspended || !this.connected || !this.visible || !this.peerVisible || !['waiting', 'paused', 'over'].includes(this.stage)) return;
    this.ready[side] = value;
    if (this.ready.every(Boolean)) {
      if (this.stage === 'over') { reset(this.state); this.round++; this.receivedInput = -1; }
      this.stage = 'countdown'; this.countdownUntil = this.now() + ONLINE.countdown;
      this.remoteInput = ZERO; this.clock.reset(); this.message = 'Gleich geht’s los …';
    }
    this.broadcast(); this.emit();
  }
  requestReady() {
    if (this.role === 'host') this.setReady(1, !this.ready[1]);
    else this.send('ready', { round: this.round, epoch: this.epoch, value: !this.ready[0] });
  }
  requestPause() {
    if (!['playing', 'countdown'].includes(this.stage)) return;
    if (this.role === 'host') this.hold('Partie pausiert. Beide müssen bereit sein.');
    else { this.send('pause', { round: this.round, epoch: this.epoch }); this.hold('Pause wird angefordert …'); }
  }
  setVisible(value) {
    this.visible = value;
    if (!value) this.requestPause();
    this.send('ping', { visible: value });
  }
  tick() {
    if (this.closed) return;
    const now = this.now();
    if (this.stage === 'connecting' && this.role === 'host' && this.connected && now >= this.probeUntil) {
      this.stage = 'waiting'; this.message = 'Teile den Code. Du wartest auf deinen Gegner.'; this.emit();
    }
    if (!this.peer && (this.role === 'guest' || this.stage === 'connecting') && now - this.startedAt > ONLINE.joinTimeout) {
      this.end(this.connected ? 'Kein offenes Spiel gefunden. Prüfe den Code und ob der Host noch wartet.' : 'Keine Verbindung möglich. Bitte versuche es erneut.'); return;
    }
    if (this.peer && now - this.lastPeer > ONLINE.expiry) { this.end('Die Verbindung wurde nicht wiederhergestellt. Bitte erstellt ein neues Spiel.'); return; }
    if (this.peer && (!this.connected || now - this.lastPeer > ONLINE.silence) && !this.suspended) {
      this.suspended = true; this.hold('Verbindung unterbrochen. Wir warten auf die Rückkehr …');
    }
    if (this.role === 'host' && this.stage === 'countdown' && now >= this.countdownUntil && !this.suspended) {
      start(this.state); this.stage = 'playing'; this.message = 'Ihr spielt gegeneinander.'; this.ready = [false, false]; this.remoteInput = ZERO; this.clock.reset(); this.broadcast(); this.emit();
    }
    const interval = this.stage === 'playing' || this.stage === 'countdown' ? 50 : 500;
    if (now - this.lastSent >= interval) {
      this.lastSent = now;
      if (!this.peer && this.role === 'guest' && this.connected) this.send('join', {}, null);
      if (this.peer) {
        if (this.role === 'host') this.broadcast();
        else if (this.stage === 'playing' && !this.suspended) this.send('input', { round: this.round, seq: ++this.inputSequence, input: this.visible ? cleanInput(this.readInput()) : ZERO });
      }
    }
    if (this.peer && now - (this.lastPing ?? -Infinity) >= 500) { this.lastPing = now; this.send('ping', { visible: this.visible }); }
  }
  advance(dt) {
    if (this.closed || this.stage !== 'playing' || this.suspended) return;
    this.clock.advance(dt);
    if (this.role === 'host' && this.state.phase === 'over') { this.stage = 'over'; this.message = 'Partie beendet. Bereit zur Revanche?'; this.ready = [false, false]; this.broadcast(); this.emit(); }
    if (this.role === 'guest' && this.predicted && this.state.phase === 'rally') {
      const own = perspective(this.state, 0).teams[1], age = clamp((this.now() - this.snapshotAt) / 1000, 0, .1);
      const alpha = 1 - Math.exp(-8 * Math.min(dt, .1));
      this.predicted.offset += (clamp(own.offset + own.vx * age, -C.maxOffset, C.maxOffset) - this.predicted.offset) * alpha;
      this.predicted.y += (clamp(own.y + own.vy * age, 10.9, 19.35) - this.predicted.y) * alpha;
    }
  }
  view() {
    const view = perspective(this.state, this.side);
    if (this.role === 'guest' && this.stage === 'playing' && !this.suspended && view.phase === 'rally') {
      // Interpolate remote objects across one 50 ms snapshot interval. Own paddles
      // predict immediately and converge to the host's authoritative position.
      if (this.previousSnapshot?.phase === 'rally' && this.previousSnapshot.score.every((n, i) => n === this.state.score[i])) {
        const old = perspective(this.previousSnapshot, 0), t = clamp((this.now() - this.snapshotAt) / 50, 0, 1);
        for (const key of ['x', 'y', 'z']) view.ball[key] = old.ball[key] + (view.ball[key] - old.ball[key]) * t;
        for (const key of ['offset', 'y']) view.teams[0][key] = old.teams[0][key] + (view.teams[0][key] - old.teams[0][key]) * t;
      }
      if (this.predicted) view.teams[1] = { ...this.predicted };
    }
    return view;
  }
  end(message) {
    if (this.closed) return;
    this.closed = true; this.stage = 'ended'; this.message = message; pause(this.state); this.transport?.close(); this.emit();
  }
  leave() { this.send('leave'); this.end('Du hast das Spiel verlassen.'); }
}
