// Isolated in-memory PostgreSQL QA. Never connects to Supabase or uses credentials.
// Pass the local @electric-sql/pglite module path as the first argument.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

if (!process.argv[2]) throw new Error('Pfad zum lokalen @electric-sql/pglite-Modul fehlt.');
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const sql = async file => db.exec(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
const call = async (query, params = []) => (await db.query(query, params)).rows;

try {
  await db.exec('create role anon; create role authenticated;');
  for (const migration of [
    'supabase/migrations/20260911160000_arcade_leaderboard.sql',
    'supabase/migrations/20260911200000_arcade_leaderboard_details.sql',
    'supabase/migrations/20260911210000_arcade_difficulty.sql',
    'supabase/migrations/20260912120000_arcade_rulesets.sql'
  ]) await sql(migration);

  const roundId = '10000000-0000-4000-8000-000000000111';
  await call("select public.submit_arcade_win($1, 'QAMigration', 7, 3, 65432, 17, 'easy', 'v2')", [roundId]);
  const before = await call('select * from public.arcade_wins order by round_id');

  await sql('supabase/migrations/20261011160000_rename_arcade_to_pong.sql');

  const after = await call('select * from public.pong_wins order by round_id');
  assert.deepEqual(after, before);
  const [{ result: pongResult }] = await call("select public.get_pong_leaderboard($1, 'easy', 'v2') result", [roundId]);
  const [{ result: compatibilityResult }] = await call("select public.get_arcade_leaderboard($1, 'easy', 'v2') result", [roundId]);
  assert.deepEqual(pongResult, compatibilityResult);
  assert.equal(pongResult.entries[0].name, 'QAMigration');
  assert.equal(pongResult.entries[0].bestRally, 17);

  const objects = await call(`
    select relname as name from pg_class join pg_namespace n on n.oid = relnamespace
      where n.nspname = 'public' and relname like 'pong_%'
    union all
    select proname as name from pg_proc join pg_namespace n on n.oid = pronamespace
      where n.nspname = 'public' and proname like '%pong%'
    order by name
  `);
  for (const expected of ['get_pong_leaderboard', 'guard_pong_ruleset', 'pong_name_blocklist', 'pong_name_key', 'pong_wins', 'pong_wins_ranking', 'submit_pong_win']) {
    assert.ok(objects.some(({ name }) => name === expected), `${expected} fehlt`);
  }

  await sql('supabase/migrations/20261011170000_remove_arcade_rpc_compatibility.sql');
  const legacyFunctions = await call(`
    select proname from pg_proc join pg_namespace n on n.oid = pronamespace
    where n.nspname = 'public' and proname in ('get_arcade_leaderboard', 'submit_arcade_win')
  `);
  assert.deepEqual(legacyFunctions, []);
  assert.deepEqual(await call('select * from public.pong_wins order by round_id'), before);

  console.log('PASS: Pong-Umbenennung erhält Daten, Rechtevertrag und Rangliste; Übergang und Bereinigung funktionieren.');
} finally {
  await db.close();
}
