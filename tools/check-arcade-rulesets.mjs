// Isolated in-memory PostgreSQL QA. Never connects to Supabase or uses credentials.
// Pass the local @electric-sql/pglite module path, or install it in your QA runtime.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { PGlite } = await import(process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : '@electric-sql/pglite');
const db = new PGlite();
const sql = async file => db.exec(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
const call = async (query, params = []) => (await db.query(query, params)).rows;
const rejected = async (query, params, pattern) => assert.rejects(call(query, params), pattern);
try {
  await db.exec('create role anon; create role authenticated;');
  await sql('supabase/migrations/20260911160000_arcade_leaderboard.sql');
  const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'];
  await call("select public.submit_arcade_win($1, 'QAOriginal', 7, 1, 50000)", [ids[0]]);
  await sql('supabase/migrations/20260911200000_arcade_leaderboard_details.sql');
  await call("select public.submit_arcade_win($1, 'QADetails', 7, 2, 60000, 12)", [ids[1]]);
  await sql('supabase/migrations/20260911210000_arcade_difficulty.sql');
  await call("select public.submit_arcade_win($1, 'QADifficulty', 7, 3, 70000, 14, 'easy')", [ids[2]]);
  await sql('tests/arcade-difficulty.acceptance.sql');
  const before = await call('select * from public.arcade_wins order by round_id');
  await sql('supabase/migrations/20260912120000_arcade_rulesets.sql');
  const after = await call('select * from public.arcade_wins order by round_id');
  assert.deepEqual(after.map(({ ruleset, ...row }) => { assert.equal(ruleset, 'classic'); return row; }), before);
  for (const difficulty of ['easy', 'hard']) {
    const [{ result }] = await call("select public.get_arcade_leaderboard(null, $1, 'v2') result", [difficulty]);
    assert.deepEqual(result.entries, []); assert.equal(result.ownEntry, null);
  }
  // Original 5-argument and later 6/7-argument retries stay compatible and read-only.
  await call("select public.submit_arcade_win($1, 'QAOriginal', 7, 1, 50000)", [ids[0]]);
  await call("select public.submit_arcade_win($1, 'QADetails', 7, 2, 60000, 12)", [ids[1]]);
  await call("select public.submit_arcade_win($1, 'QADifficulty', 7, 3, 70000, 14, 'easy')", [ids[2]]);
  await rejected("select public.submit_arcade_win($1, 'QAOriginal', 7, 1, 50000, null, 'hard', 'v2')", [ids[0]], /bereits eingetragen/);
  for (const query of [
    "update public.arcade_wins set display_name = 'Changed' where round_id = $1",
    "update public.arcade_wins set ruleset = 'v2' where round_id = $1",
    'delete from public.arcade_wins where round_id = $1'
  ]) await rejected(query, [ids[0]], /ARCADE_RULESET_CLOSED/);
  await rejected("insert into public.arcade_wins (round_id, display_name, human_score, computer_score, duration_ms) values (gen_random_uuid(), 'QANew', 7, 1, 30000)", [], /ARCADE_RULESET_CLOSED/);
  await sql('tests/arcade-leaderboard.acceptance.sql');
  await sql('tests/arcade-rulesets.acceptance.sql');
  assert.deepEqual(await call('select * from public.arcade_wins order by round_id'), after);
  // No callable unguarded overload survives the migration.
  const functions = await call("select proname, pronargs from pg_proc join pg_namespace n on n.oid = pronamespace where n.nspname = 'public' and proname in ('get_arcade_leaderboard','submit_arcade_win') order by proname");
  assert.deepEqual(functions, [{ proname: 'get_arcade_leaderboard', pronargs: 3 }, { proname: 'submit_arcade_win', pronargs: 8 }]);
  console.log('PASS: three generations of legacy results preserved; Classic frozen; v2 empty; ranks, retries, validation, anonymous access and overloads verified.');
} finally { await db.close(); }
