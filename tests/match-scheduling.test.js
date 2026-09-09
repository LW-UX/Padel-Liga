const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260909170000_global_elo_match_time.sql'),
  'utf8'
);
const tippspiel = fs.readFileSync(path.join(root, 'js', 'tippspiel.js'), 'utf8');

test('match scheduling is authenticated and restricted to participants or admins', () => {
  assert.match(migration, /create function public\.schedule_match\(p_match_id text, p_match_at timestamp without time zone\)/);
  assert.match(migration, /current_user_id is null then raise exception 'Nicht angemeldet\.'/);
  assert.match(migration, /private\.user_email_is_confirmed\(current_user_id\)/);
  assert.match(migration, /current_profile\.app_role is distinct from 'admin' and user_team is null/);
  assert.match(migration, /Nur beteiligte Spieler dürfen die Partie terminieren\./);
  assert.match(migration, /revoke execute on function public\.schedule_match\(text, timestamp without time zone\) from public, anon/);
  assert.match(migration, /grant execute on function public\.schedule_match\(text, timestamp without time zone\) to authenticated/);
});

test('match scheduling rejects completed and pending matches but permits one-time-field rescheduling', () => {
  assert.match(migration, /selected_match\.actual_sets is not null or selected_match\.result_details is not null/);
  assert.match(migration, /proposal\.status = 'pending'/);
  assert.doesNotMatch(migration, /Die Partie ist bereits terminiert\./);
  assert.match(tippspiel, /data-match-schedule-toggle="\$\{escapeHtml\(task\.match_id\)\}">Termin ändern/);
});

test('match scheduling stores one canonical Berlin timestamp', () => {
  const scheduleFunction = migration.match(
    /create function public\.schedule_match\([\s\S]*?(?=\n\$\$;)/
  )?.[0] || '';
  assert.match(scheduleFunction, /set match_at = p_match_at at time zone 'Europe\/Berlin'/);
  assert.doesNotMatch(scheduleFunction, /scheduled_date|display_time|lock_at|insert into public\.result_proposals/);
  assert.match(migration, /alter table public\.matches[\s\S]*drop column scheduled_date,[\s\S]*drop column display_time,[\s\S]*drop column lock_at/);
});

test('unscheduled league matches retain their existing open betting behavior', () => {
  const predictionOpen = tippspiel.match(
    /function isPredictionOpen\(match\) \{[\s\S]*?(?=\n  function getPredictionWinner)/
  )?.[0] || '';
  assert.match(predictionOpen, /if \(!databaseMatch\.match_at\) return match\.sieger === null/);
  assert.match(predictionOpen, /new Date\(databaseMatch\.match_at\)\.getTime\(\) > Date\.now\(\)/);
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
