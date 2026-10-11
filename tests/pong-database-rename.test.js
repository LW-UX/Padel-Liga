const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const renameSql = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261011160000_rename_arcade_to_pong.sql'),
  'utf8'
);
const cleanupSql = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261011170000_remove_arcade_rpc_compatibility.sql'),
  'utf8'
);

test('Pong migration renames persistent leaderboard objects in place', () => {
  for (const statement of [
    'alter table public.arcade_wins rename to pong_wins',
    'alter table public.arcade_name_blocklist rename to pong_name_blocklist',
    'alter index public.arcade_wins_ranking rename to pong_wins_ranking',
    'alter function public.arcade_name_key(text) rename to pong_name_key',
    'rename to get_pong_leaderboard',
    'rename to submit_pong_win',
    'rename to guard_pong_ruleset',
    'rename to pong_ruleset_guard'
  ]) assert.match(renameSql, new RegExp(statement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.doesNotMatch(renameSql, /\b(drop table|truncate|delete from|update public\.arcade_wins)\b/i);
  assert.match(renameSql, /v_existing public\.pong_wins%rowtype/);
  assert.match(renameSql, /from public\.pong_wins where ruleset = p_ruleset/);
});

test('new Pong RPCs retain security and temporary compatibility contracts', () => {
  assert.match(renameSql, /create or replace function public\.get_pong_leaderboard\(/);
  assert.match(renameSql, /create or replace function public\.submit_pong_win\(/);
  assert.match(renameSql, /revoke all on public\.pong_wins from public, anon, authenticated/);
  assert.match(renameSql, /grant execute on function public\.get_pong_leaderboard[\s\S]+to anon, authenticated/);
  assert.match(renameSql, /grant execute on function public\.submit_pong_win[\s\S]+to anon, authenticated/);
  assert.match(renameSql, /create function public\.get_arcade_leaderboard\(/);
  assert.match(renameSql, /create function public\.submit_arcade_win\(/);
  for (const code of ['NAME_INVALID', 'NAME_BLOCKED', 'RULESET_CLOSED']) {
    assert.match(renameSql, new RegExp(`PONG_${code}`));
    assert.match(renameSql, new RegExp(`ARCADE_${code}`));
  }
  assert.match(renameSql, /notify pgrst, 'reload schema'/);
});

test('cleanup removes only the temporary RPC compatibility layer', () => {
  assert.match(cleanupSql, /drop function public\.get_arcade_leaderboard\(uuid, text, text\)/);
  assert.match(cleanupSql, /drop function public\.submit_arcade_win\(uuid, text, integer, integer, integer, integer, text, text\)/);
  assert.doesNotMatch(cleanupSql, /drop (table|function public\.(get|submit)_pong)/i);
  assert.match(cleanupSql, /notify pgrst, 'reload schema'/);
});
