// Explicit integration check: ephemeral Realtime traffic only, no database writes.
// Run with Node 22+: node tools/check-arcade-online.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { OnlineSession, generateCode } from '../arcade/online.mjs';
const sandbox = { window: {} };
vm.runInNewContext(await readFile(new URL('../data/supabase-config.js', import.meta.url), 'utf8'), sandbox);
const config = sandbox.window.PADEL_SUPABASE_CONFIG;
const rooms = [];
const host = new OnlineSession({ role: 'host', code: generateCode(), config }); rooms.push(host);
let previous = performance.now();
const timer = setInterval(() => {
  const now = performance.now(), dt = (now - previous) / 1000; previous = now;
  for (const room of rooms) { room.tick(); room.advance(dt); }
}, 16);
async function until(predicate, label, timeout = 12000) {
  const end = performance.now() + timeout;
  while (!predicate()) {
    if (performance.now() > end) throw new Error(`Zeitüberschreitung: ${label}`);
    await new Promise(r => setTimeout(r, 50));
  }
}
try {
  await until(() => host.stage === 'waiting', 'Host verbinden');
  const guest = new OnlineSession({ role: 'guest', code: host.code, config, readInput: () => ({ x: .5, y: -.3 }) }); rooms.push(guest);
  await until(() => host.peer && guest.peer, 'Gast beitreten');
  const third = new OnlineSession({ role: 'guest', code: host.code, config }); rooms.push(third);
  await until(() => third.closed, 'Vollen Raum ablehnen'); assert.match(third.message, /voll/);
  host.requestReady(); guest.requestReady();
  await until(() => host.stage === 'playing' && guest.stage === 'playing', 'Gemeinsamer Start');
  await until(() => guest.state.time > 2, 'Laufende Synchronisierung');
  assert.ok(Math.abs(host.state.time - guest.state.time) < .5);
  assert.ok(host.state.teams[0].offset < 0);
  guest.requestPause();
  await until(() => host.stage === 'paused' && guest.stage === 'paused', 'Gemeinsame Pause');
  const time = host.state.time;
  await new Promise(r => setTimeout(r, 300)); assert.equal(host.state.time, time);
  host.requestReady(); guest.requestReady();
  await until(() => host.stage === 'playing' && guest.stage === 'playing', 'Fortsetzen');
  host.leave(); await until(() => guest.closed, 'Host verlassen');
  console.log('OK: Live-Realtime – Code, Beitritt, voller Raum, Countdown, Bewegung, Synchronisierung, Pause, Fortsetzen und Verlassen.');
} finally { clearInterval(timer); for (const room of rooms) room.leave(); }
