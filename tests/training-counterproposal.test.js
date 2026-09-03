const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260903160000_training_counterproposals.sql'),
  'utf8'
);

test('training alternatives are restricted to involved players and admins', () => {
  assert.match(migration, /current_user_id is null/);
  assert.match(migration, /private\.user_email_is_confirmed\(current_user_id\)/);
  assert.match(migration, /session\.status = 'pending'[\s\S]*for update/);
  assert.match(migration, /current_profile\.app_role <> 'admin'[\s\S]*current_profile\.player_id = any\(selected_session\.player_ids\)/);
  assert.match(migration, /Nur beteiligte Spieler dürfen eine Alternative eingeben/);
});

test('training alternatives atomically replace the pending proposal', () => {
  assert.match(migration, /delete from public\.training_sessions[\s\S]*session\.id = selected_session\.id/);
  assert.match(migration, /public\.create_training_session\(p_played_on, p_display_time, p_player_ids, p_rounds\)/);
  assert.match(migration, /grant execute on function public\.replace_pending_training_session[\s\S]*to authenticated/);
});
