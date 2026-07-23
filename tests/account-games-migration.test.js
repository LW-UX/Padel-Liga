const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260723173000_account_games_email_names.sql'),
  'utf8'
);

test('migration derives and verifies official set results', () => {
  assert.match(migration, /create or replace function private\.derive_official_result/);
  assert.match(migration, /greatest\(team_one_sets, team_two_sets\) <> 2/);
  assert.match(migration, /p_actual_sets is distinct from derived_sets/);
});

test('migration returns all-season task context and stable training numbers', () => {
  assert.match(migration, /p_season_id text default null/);
  assert.match(migration, /\(p_season_id is null or match\.season_id = p_season_id\)/);
  assert.match(migration, /league\.label as league_label/);
  assert.match(migration, /row_number\(\) over \(order by session\.created_at, session\.id\)/);
  assert.match(migration, /where session\.status = 'pending'/);
});

test('migration makes email-derived account names immutable to users', () => {
  assert.match(migration, /private\.display_name_from_email\(auth_user\.email\)/);
  assert.match(migration, /drop policy if exists "Users update their display name"/);
  assert.match(migration, /revoke execute on function public\.update_my_profile\(text\)/);
});
