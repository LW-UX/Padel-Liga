const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260914100000_unschedule_matches.sql'),
  'utf8'
);
const tippspiel = fs.readFileSync(path.join(root, 'js', 'tippspiel.js'), 'utf8');

test('match unscheduling is authenticated and restricted to participants or admins', () => {
  assert.match(migration, /create or replace function public\.unschedule_match\(p_match_id text\)/);
  assert.match(migration, /current_user_id is null then raise exception 'Nicht angemeldet\.'/);
  assert.match(migration, /private\.user_email_is_confirmed\(current_user_id\)/);
  assert.match(migration, /current_profile\.app_role is distinct from 'admin' and user_team is null/);
  assert.match(migration, /Nur beteiligte Spieler dürfen die Terminierung aufheben\./);
  assert.match(migration, /revoke execute on function public\.unschedule_match\(text\) from public, anon/);
  assert.match(migration, /grant execute on function public\.unschedule_match\(text\) to authenticated/);
});

test('match unscheduling rejects completed and pending matches and clears the canonical time', () => {
  assert.match(migration, /selected_match\.actual_sets is not null or selected_match\.result_details is not null/);
  assert.match(migration, /proposal\.status = 'pending'/);
  assert.match(migration, /set match_at = null/);
});

test('future match cards confirm and submit schedule deletion', () => {
  assert.match(tippspiel, /data-match-unschedule="\$\{escapeHtml\(task\.match_id\)\}">Termin löschen/);
  assert.match(tippspiel, /window\.confirm\('Soll der Termin dieser Partie wirklich gelöscht werden\?'\)/);
  assert.match(tippspiel, /state\.client\.rpc\('unschedule_match', \{ p_match_id: matchId \}\)/);
});
