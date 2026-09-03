const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260903170000_training_counter_scores.sql'),
  'utf8'
);

test('training alternatives are restricted to another involved player', () => {
  assert.match(migration, /current_user_id is null/);
  assert.match(migration, /private\.user_email_is_confirmed\(current_user_id\)/);
  assert.match(migration, /session\.status = 'pending'[\s\S]*for update/);
  assert.match(migration, /current_profile\.player_id = any\(selected_session\.player_ids\)/);
  assert.match(migration, /selected_session\.created_by = current_user_id/);
  assert.match(migration, /Nur ein anderer beteiligter Spieler darf eine Alternative eingeben/);
});

test('training alternatives atomically replace the pending proposal', () => {
  assert.match(migration, /delete from public\.training_sessions where id = selected_session\.id/);
  assert.match(migration, /public\.create_training_session\(p_played_on, p_display_time, p_player_ids, p_rounds\)/);
  assert.match(migration, /grant execute on function public\.replace_pending_training_session[\s\S]*to authenticated/);
});

test('submitted trainings cannot be deleted through the browser role', () => {
  assert.match(migration, /revoke execute on function public\.delete_my_pending_training\(bigint\) from public, anon, authenticated/);
});

test('training format and status are stored and derived server-side', () => {
  assert.match(migration, /add column if not exists result_format text/);
  assert.match(migration, /result_format in \('one_set', 'two_sets', 'two_sets_match_tiebreak', 'three_sets'\)/);
  assert.match(migration, /round_is_complete/);
  assert.match(migration, /private\.training_regular_set_state/);
  assert.match(migration, /private\.training_tiebreak_state/);
  assert.match(migration, /'result_format', round\.result_format/);
});

test('profile metrics count only completed regular sets by half', () => {
  assert.match(migration, /private\.profile_training_metrics/);
  assert.match(migration, /training_regular_set_state\(team_one, team_two\) = 'complete'/);
  assert.match(migration, /profile_training_metrics\(p_result_details\)\)\[1\] \* 0\.5::numeric/);
  assert.match(migration, /'winWeight', history\.win_weight/);
  assert.match(migration, /'lossWeight', history\.loss_weight/);
});
