const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260928160000_auto_confirm_results_after_48_hours.sql'),
  'utf8'
);
const matchDecisions = fs.readFileSync(
  path.join(root, 'docs', 'project-decisions', 'matches-and-tournaments.md'),
  'utf8'
);
const accountDecisions = fs.readFileSync(
  path.join(root, 'docs', 'project-decisions', 'accounts-and-workflows.md'),
  'utf8'
);

test('pending league and cup results become official after 48 hours', () => {
  assert.match(migration, /create or replace function private\.auto_confirm_expired_results\(\)/);
  assert.match(migration, /proposal\.status = 'pending'[\s\S]*proposal\.created_at <= now\(\) - interval '48 hours'/);
  assert.match(migration, /for update of proposal, match skip locked/);
  assert.match(migration, /perform pg_advisory_xact_lock\(70317, 20270909\)/);
  assert.match(migration, /set status = 'confirmed',[\s\S]*confirmed_by = null,[\s\S]*resolved_at = now\(\)/);
  assert.match(migration, /set match_at = proposal\.match_at,[\s\S]*result_details = proposal\.result_details,[\s\S]*actual_sets = proposal\.actual_sets,[\s\S]*winner = proposal\.winner/);
});

test('pending training results use the same 48 hour deadline', () => {
  assert.match(migration, /public\.training_sessions[\s\S]*session\.status = 'pending'[\s\S]*session\.created_at <= now\(\) - interval '48 hours'/);
  assert.match(migration, /set status = 'confirmed',[\s\S]*confirmed_by = null,[\s\S]*confirmed_at = now\(\)/);
});

test('the database runs automatic confirmation regularly without a browser visit', () => {
  assert.match(migration, /create extension if not exists pg_cron/);
  assert.match(migration, /cron\.schedule\([\s\S]*'auto-confirm-results-after-48-hours',[\s\S]*'\*\/5 \* \* \* \*'/);
  assert.match(migration, /revoke all on function private\.auto_confirm_expired_results\(\) from public, anon, authenticated/);
});

test('the project decisions define the reset-on-counterproposal rule without a prominent notice', () => {
  assert.match(matchDecisions, /48 Stunden nach dem letzten Vorschlag automatisch bestätigt/);
  assert.match(matchDecisions, /Ein Gegenvorschlag startet die Frist neu/);
  assert.match(accountDecisions, /keinen zusätzlichen Countdown in der Oberfläche/);
});
