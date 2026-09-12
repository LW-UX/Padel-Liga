const test = require('node:test');
const assert = require('node:assert/strict');

async function harness() {
  const { OnlineSession, ONLINE } = await import('../arcade/online.mjs');
  let now = 0, queue = [], endpoints = [], rooms = [];
  const connect = (_, code, callbacks) => {
    const endpoint = { code, callbacks, active: true, online: true };
    endpoints.push(endpoint); queue.push(() => callbacks.onStatus(true));
    return {
      send(data) {
        if (!endpoint.active || !endpoint.online) return false;
        endpoints.filter(e => e !== endpoint && e.active && e.online && e.code === code).forEach(e => {
          const copy = structuredClone(data); queue.push(() => { if (e.active && e.online) e.callbacks.onMessage(copy); });
        });
        return true;
      },
      close() { endpoint.active = false; }
    };
  };
  function flush() { while (queue.length) queue.shift()(); }
  function add(role, id, input = () => ({ x: 0, y: 0 }), code = 'K7MX4P') {
    const room = new OnlineSession({ role, id, code, connect, now: () => now, readInput: input });
    rooms.push(room); flush(); return room;
  }
  function advance(ms) {
    for (let elapsed = 0; elapsed < ms; elapsed += 10) {
      now += 10; rooms.forEach(r => r.tick()); flush(); rooms.forEach(r => r.advance(.01)); flush();
    }
  }
  function link(room, online) {
    const e = endpoints[rooms.indexOf(room)]; e.online = online; e.callbacks.onStatus(online); flush();
  }
  const host = add('host', 'host'); advance(900);
  return { host, add, advance, flush, link, ONLINE };
}

test('room codes normalize typing and reject malformed input', async () => {
  const { normalizeCode, generateCode } = await import('../arcade/online.mjs');
  assert.equal(normalizeCode(' k7m-x4p '), 'K7MX4P');
  for (const value of ['', 'ABC', 'ABCDEF7', 'AAAAA0', '<html>']) assert.throws(() => normalizeCode(value));
  for (let i = 0; i < 100; i++) assert.match(generateCode(), /^[A-HJ-NP-Z2-9]{6}$/);
});

test('host grants exactly one guest seat even when joins race; both must be ready', async () => {
  const h = await harness(), guest = h.add('guest', 'guest'), third = h.add('guest', 'third');
  assert.equal(h.host.peer, 'guest'); assert.equal(guest.peer, 'host');
  assert.equal(third.stage, 'ended'); assert.match(third.message, /voll/);
  h.host.requestReady(); h.flush(); h.advance(4000);
  assert.equal(h.host.stage, 'waiting'); assert.equal(h.host.state.time, 0);
  guest.requestReady(); h.flush(); assert.equal(h.host.stage, 'countdown');
  h.advance(2900); assert.equal(h.host.state.time, 0);
  h.advance(200); assert.equal(h.host.stage, 'playing'); assert.equal(guest.stage, 'playing');
  assert.ok(h.host.state.time > 0);
});

test('wrong and stale codes time out and a host collision cannot create a second room', async () => {
  const h = await harness(), missing = h.add('guest', 'missing', undefined, 'ABCDEF');
  const collision = h.add('host', 'collision');
  assert.equal(collision.stage, 'ended');
  h.advance(11000); assert.equal(missing.stage, 'ended'); assert.match(missing.message, /Kein offenes Spiel/);
  h.host.leave(); const stale = h.add('guest', 'stale'); h.advance(11000);
  assert.equal(stale.stage, 'ended');
});

test('guest movement is rotated once; host alone computes ball and score', async () => {
  const h = await harness(), guest = h.add('guest', 'guest', () => ({ x: 1, y: -1 }));
  h.host.requestReady(); guest.requestReady(); h.flush(); h.advance(3500);
  assert.ok(h.host.state.teams[0].offset < 0); assert.ok(h.host.state.teams[0].y > 3);
  const view = guest.view(); assert.ok(view.teams[1].offset > 0); assert.ok(view.teams[1].y < 17);
  const before = structuredClone(h.host.state);
  h.host.receive({ v: h.ONLINE.protocol, from: 'guest', to: 'host', type: 'snapshot', state: { score: [7, 0] } });
  assert.deepEqual(h.host.state, before);
  h.host.receive({ v: h.ONLINE.protocol, from: 'third', to: 'host', type: 'input', round: 0, seq: 9999, input: { x: 1, y: 1 } });
  assert.ok(h.host.remoteInput.x < 0);
});

test('a lost connection pauses both sides; reconnect requires mutual readiness and expiry closes room', async () => {
  const h = await harness(), guest = h.add('guest', 'guest');
  h.host.requestReady(); guest.requestReady(); h.flush(); h.advance(3200);
  h.link(guest, false); h.advance(1700);
  assert.equal(h.host.stage, 'paused'); assert.equal(guest.stage, 'paused');
  const time = h.host.state.time; h.advance(1000); assert.equal(h.host.state.time, time);
  h.link(guest, true); h.advance(1000);
  assert.equal(h.host.suspended, false); assert.equal(guest.suspended, false);
  assert.equal(h.host.stage, 'paused'); assert.deepEqual(h.host.ready, [false, false]);
  h.host.requestReady(); guest.requestReady(); h.flush(); h.advance(3200);
  assert.equal(h.host.stage, 'playing');
  h.link(guest, false); h.advance(22000); assert.equal(h.host.stage, 'ended'); assert.equal(guest.stage, 'ended');
});

test('visibility pauses countdown and rally; leaving immediately closes the other side', async () => {
  const h = await harness(), guest = h.add('guest', 'guest');
  h.host.requestReady(); guest.requestReady(); h.flush(); h.advance(1000);
  guest.setVisible(false); h.flush(); assert.equal(h.host.stage, 'paused');
  h.advance(4000); assert.equal(h.host.state.time, 0);
  guest.setVisible(true); h.flush(); h.host.requestReady(); guest.requestReady(); h.flush(); h.advance(3200);
  assert.equal(h.host.stage, 'playing'); h.host.setVisible(false); h.flush();
  assert.equal(guest.stage, 'paused'); guest.leave(); h.flush(); assert.equal(h.host.stage, 'ended');
});

test('rematch resets score and clock and ignores actions from a previous round', async () => {
  const h = await harness(), guest = h.add('guest', 'guest');
  h.host.stage = 'over'; Object.assign(h.host.state, { phase: 'over', winner: 1, score: [3, 7], time: 80 });
  h.host.broadcast(); h.flush(); assert.deepEqual(guest.view().score, [7, 3]);
  h.host.requestReady(); guest.requestReady(); h.flush();
  assert.equal(h.host.round, 1); assert.deepEqual(h.host.state.score, [0, 0]); assert.equal(h.host.state.time, 0);
  h.host.receive({ v: h.ONLINE.protocol, from: 'guest', to: 'host', type: 'pause', round: 0 });
  assert.equal(h.host.stage, 'countdown');
});

test('perspective rotation is reversible and malformed or stale snapshots are ignored', async () => {
  const { perspective, validSnapshot } = await import('../arcade/online.mjs');
  const { createState } = await import('../arcade/physics.mjs');
  const state = createState(); state.teams[0].offset = .7; state.ball.vx = 4; state.ball.vy = 7;
  state.effects.push({ x: 2, y: 5, age: .1, kind: 'hit' });
  assert.deepEqual(perspective(perspective(state, 0), 0), state);
  assert.ok(validSnapshot(state)); assert.ok(!validSnapshot({ ...state, ball: { ...state.ball, vx: NaN } }));
  const h = await harness(), guest = h.add('guest', 'guest'), before = structuredClone(guest.state);
  guest.receive({ v: h.ONLINE.protocol, from: 'host', to: 'guest', type: 'snapshot', revision: 999, state: { score: [7, 0] } });
  assert.deepEqual(guest.state, before);
});


test('delayed readiness from before a pause cannot restart the resumed room', async () => {
  const h = await harness(), guest = h.add('guest', 'guest');
  const oldEpoch = h.host.epoch;
  h.host.requestReady(); guest.requestReady(); h.flush(); h.advance(3200);
  guest.requestPause(); h.flush();
  assert.ok(h.host.epoch > oldEpoch);
  h.host.requestReady(); h.flush();
  h.host.receive({ v: h.ONLINE.protocol, from: 'guest', to: 'host', type: 'ready', round: 0, epoch: oldEpoch, value: true });
  assert.equal(h.host.stage, 'paused'); assert.deepEqual(h.host.ready, [false, true]);
  guest.requestReady(); h.flush(); assert.equal(h.host.stage, 'countdown');
});

test('Realtime transport waits for join, rejects unrelated messages and reconnects after socket loss', async t => {
  const { connectRealtime } = await import('../arcade/realtime.mjs');
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const sockets = [], statuses = [], messages = [];
  class Socket {
    constructor(url) { this.url = url; this.readyState = 0; this.bufferedAmount = 0; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.onclose?.(); }
    open() { this.readyState = 1; this.onopen(); }
    receive(message) { this.onmessage({ data: JSON.stringify(message) }); }
  }
  const transport = connectRealtime({ url: 'https://example.supabase.co', publishableKey: 'public-test-key' }, 'K7MX4P', { onMessage: m => messages.push(m), onStatus: ok => statuses.push(ok) }, Socket);
  const first = sockets[0]; first.open();
  assert.equal(transport.send({ type: 'ping' }), false);
  assert.equal(first.sent[0].event, 'phx_join');
  const topic = first.sent[0].topic;
  first.receive({ event: 'phx_reply', ref: '1', topic, payload: { status: 'ok' } });
  assert.equal(transport.send({ type: 'ping' }), true); assert.deepEqual(statuses, [true]);
  first.receive(null); first.receive({ topic: 'another-room', event: 'broadcast', payload: { event: 'game', payload: 'ignored' } });
  first.receive({ topic, event: 'broadcast', payload: { event: 'game', payload: 'received' } });
  assert.deepEqual(messages, ['received']);
  first.close(); assert.deepEqual(statuses, [true, false]);
  t.mock.timers.tick(1000); assert.equal(sockets.length, 2);
  const next = sockets[1]; next.open();
  next.receive({ event: 'phx_reply', ref: '1', topic, payload: { status: 'ok' } });
  assert.deepEqual(statuses, [true, false, true]);
  transport.close(); t.mock.timers.tick(60000); assert.equal(sockets.length, 2);
});

test('old online protocol cannot claim a seat and classic snapshots are rejected', async () => {
  const h = await harness();
  h.host.receive({ v: 1, from: 'old-guest', to: null, type: 'join' });
  assert.equal(h.host.peer, null);
  const guest = h.add('guest', 'guest', undefined, 'ABCDEF');
  guest.receive({ v: 1, from: 'old-host', to: 'guest', type: 'accepted', round: 0 });
  assert.equal(guest.peer, null);
  h.advance(11000); assert.equal(guest.stage, 'ended'); assert.match(guest.message, /Kein offenes Spiel/);
  const { validSnapshot } = await import('../arcade/online.mjs');
  assert.equal(validSnapshot({ ...h.host.state, ruleset: 'classic' }), false);
});

test('guest backward movement produces negative power on the host and in the rotated guest view', async () => {
  const h = await harness(), guest = h.add('guest', 'guest', () => ({ x: 0, y: 1 }));
  h.host.requestReady(); guest.requestReady(); h.flush(); h.advance(3300);
  assert.ok(h.host.state.teams[0].power < -.5);
  assert.ok(guest.view().teams[1].power < -.5);
  assert.equal(guest.view().ruleset, 'v2');
});
