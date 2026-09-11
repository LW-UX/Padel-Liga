const test = require('node:test');
const assert = require('node:assert/strict');
const leaderboard = import('../arcade/leaderboard.mjs');
const physics = import('../arcade/physics.mjs');
test('only a completed human win creates an immutable leaderboard entry', async () => {
  const { winningEntry } = await leaderboard;
  for (const state of [
    { phase: 'over', winner: 0, score: [7, 4], time: 30 },
    { phase: 'rally', winner: 1, score: [0, 7], time: 30 },
    { phase: 'over', winner: 1, score: [7, 7], time: 30 }
  ]) assert.equal(winningEntry(state, 'round'), null);
  const state = { phase: 'over', winner: 1, score: [2, 7], time: 45.6784 };
  const entry = winningEntry(state, 'round'); state.score[0] = 0;
  assert.deepEqual(entry, { roundId: 'round', humanScore: 7, computerScore: 2, durationMs: 45678 });
  assert.ok(Object.isFrozen(entry));
});
test('playing time stops during pause and after a match, and resets for a new match', async () => {
  const p = await physics, s = p.createState(); p.start(s);
  p.step(s); const before = s.time; p.pause(s);
  for (let i = 0; i < 60; i++) p.step(s);
  assert.equal(s.time, before); p.start(s); p.step(s); assert.ok(s.time > before);
  s.phase = 'over'; const finished = s.time; p.step(s); assert.equal(s.time, finished);
  p.reset(s); assert.equal(s.time, 0);
});
test('public names are trimmed, bounded and reject invisible controls', async () => {
  const { normalizeName, formatDuration } = await leaderboard;
  assert.equal(normalizeName('  Ludwig  '), 'Ludwig');
  for (const name of ['', '   ', 'a'.repeat(17), 'A\nB', 'A\u200bB']) assert.throws(() => normalizeName(name));
  assert.equal(formatDuration(65432), '1:05,43'); assert.equal(formatDuration(3600000), '60:00,00');
  assert.equal(formatDuration(65436), '1:05,44'); assert.equal(formatDuration(59999), '1:00,00');
});
test('saving retries reuse the same round and public API payload excludes league identities', async () => {
  const { createLeaderboardApi } = await leaderboard; const calls = [];
  const api = createLeaderboardApi({ url: 'https://example.test', publishableKey: 'public-key' }, async (url, options) => {
    calls.push({ url, options }); return { ok: true, json: async () => ({ rank: 1 }) };
  });
  const entry = { roundId: 'same-round', humanScore: 7, computerScore: 2, durationMs: 34000 };
  await api.save(entry, ' Ludi '); await api.save(entry, ' Ludi '); await api.list('same-round');
  assert.equal(calls[0].options.body, calls[1].options.body);
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_round_id: 'same-round', p_name: 'Ludi', p_human_score: 7, p_computer_score: 2, p_duration_ms: 34000 });
  assert.deepEqual(JSON.parse(calls[2].options.body), { p_round_id: 'same-round' });
  assert.equal(calls[0].options.headers.apikey, 'public-key');
});
test('missing database setup and connection failures give actionable errors', async () => {
  const { createLeaderboardApi } = await leaderboard;
  const config = { url: 'https://example.test', publishableKey: 'public' };
  await assert.rejects(createLeaderboardApi(config, async () => ({ ok: false, status: 404 })).list(), /eingerichtet/);
  await assert.rejects(createLeaderboardApi(config, async () => { throw new Error('timeout'); }).list(), /erneut/);
});
test('name policy accepts letters and digits but rejects spaces, punctuation, emoji and oversize names', async () => {
  const { normalizeName } = await leaderboard;
  for (const name of ['Ludi2026', 'Jörg42', 'Zoë', '张伟', 'Marschall', 'Nazim', 'Adolf', 'Hermann', 'x'.repeat(16)]) assert.equal(normalizeName(name), name);
  for (const name of ['Ludi Test', 'Ludi_42', 'Ludi-42', 'Ludi!', '🎾', 'x'.repeat(17)]) assert.throws(() => normalizeName(name));
  assert.equal(normalizeName('Jo\u0308rg'), 'Jörg');
});
test('blocked names cannot bypass case, simple leetspeak, suffixes or repeated letters', async () => {
  const { normalizeName } = await leaderboard;
  for (const name of ['HiTlEr', 'H1tler99', 'Hiiitler', 'Arschloch', '4rschloch', 'NAZI123', 'HeilHitler', 'JosefMengele', 'Goebbels']) assert.throws(() => normalizeName(name), /nicht erlaubt/);
});
test('the private database blacklist starts with exactly the same rules as the browser', async () => {
  const fs = require('node:fs'); const path = require('node:path');
  const { BLOCKED_NAME_RULES } = await import('../arcade/name-policy.mjs');
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260911160000_arcade_leaderboard.sql'), 'utf8');
  const seeded = [...sql.matchAll(/^  \('([^']+)', '(contains|exact)'\)/gm)].map(([, term, match]) => ({ term, match }));
  assert.deepEqual(seeded, BLOCKED_NAME_RULES);
  assert.match(sql, /revoke all on public\.arcade_name_blocklist from public, anon, authenticated/);
});
test('a server-side name rejection is shown as a name error rather than a connection failure', async () => {
  const { createLeaderboardApi } = await leaderboard;
  const api = createLeaderboardApi({ url: 'https://example.test', publishableKey: 'public' }, async () => ({ ok: false, status: 400, json: async () => ({ message: 'ARCADE_NAME_BLOCKED' }) }));
  await assert.rejects(api.save({ roundId: 'round' }, 'Ludi'), /Name ist nicht erlaubt/);
});
