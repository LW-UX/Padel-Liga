const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260903110000_schedule_matches.sql'),
  'utf8'
);
const tippspiel = fs.readFileSync(path.join(root, 'js', 'tippspiel.js'), 'utf8');

test('match scheduling is authenticated and restricted to participants or admins', () => {
  assert.match(migration, /create or replace function public\.schedule_match\(/);
  assert.match(migration, /current_user_id is null then raise exception 'Nicht angemeldet\.'/);
  assert.match(migration, /private\.user_email_is_confirmed\(current_user_id\)/);
  assert.match(migration, /current_profile\.app_role is distinct from 'admin' and user_team is null/);
  assert.match(migration, /Nur beteiligte Spieler dürfen die Partie terminieren\./);
  assert.match(migration, /revoke execute on function public\.schedule_match\(text, date, time\) from public, anon/);
  assert.match(migration, /grant execute on function public\.schedule_match\(text, date, time\) to authenticated/);
});

test('match scheduling rejects completed, pending, and already scheduled matches', () => {
  assert.match(migration, /selected_match\.actual_sets is not null or selected_match\.result_details is not null/);
  assert.match(migration, /proposal\.status = 'pending'/);
  assert.match(migration, /selected_match\.scheduled_date is not null[\s\S]*selected_match\.display_time[\s\S]*selected_match\.lock_at is not null/);
});

test('match scheduling stores the full Berlin schedule without requiring confirmation', () => {
  assert.match(migration, /\(p_scheduled_date \+ p_scheduled_time\) at time zone 'Europe\/Berlin'/);
  assert.match(migration, /scheduled_date = p_scheduled_date/);
  assert.match(migration, /display_time = replace\(left\(p_scheduled_time::text, 5\), ':', '\.'\)/);
  assert.match(migration, /lock_at = scheduled_at/);
  assert.doesNotMatch(migration, /insert into public\.result_proposals/);
  assert.doesNotMatch(migration, /betting_open\s*=/);
});

test('unscheduled league matches retain their existing open betting behavior', () => {
  const predictionOpen = tippspiel.match(
    /function isPredictionOpen\(match\) \{[\s\S]*?(?=\n  function getPredictionWinner)/
  )?.[0] || '';
  assert.match(predictionOpen, /if \(!databaseMatch\.lock_at\) return match\.sieger === null/);
});

test('all four groups render even when they are empty', () => {
  ['Zu bestätigen', 'Ergebnis eintragen', 'Terminierte Spiele', 'Geplante Spiele'].forEach(label => {
    assert.match(tippspiel, new RegExp(`label: '${label}'`));
  });
  assert.match(tippspiel, /group\.items\.length[\s\S]*Derzeit keine Partie\./);
  assert.match(tippspiel, /<div class="spieltag-label"><span>\$\{escapeHtml\(group\.label\)\}<\/span><\/div>/);
  assert.doesNotMatch(tippspiel, /visibleGroups/);
});

test('waiting proposals remain visible but do not count as actionable tasks', () => {
  assert.match(tippspiel, /task\.task_type === 'review' \|\| task\.task_type === 'waiting'/);
  assert.match(tippspiel, /group\.key === 'review'\)\.tasks\.filter\(task => task\.task_type === 'review'\)/);
  assert.match(tippspiel, /Auf Bestätigung warten/);
});

test('review and result-entry cards do not repeat their prefilled date and time', () => {
  assert.match(tippspiel, /\$\{groupKey === 'future' \? `<div class="result-card-timing">/);
  assert.doesNotMatch(tippspiel, /groupKey === 'planned' \? '' : `<div class="result-card-timing">/);
});
