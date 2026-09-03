const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'data', 'data-test-2026.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260902110000_add_test_result_matches.sql'),
  'utf8'
);
const scheduleMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260903100000_unset_test_match_schedule.sql'),
  'utf8'
);

const context = { window: {} };
vm.runInNewContext(source, context);
const season = context.window.PADEL_SEASON;

test('test season keeps all ten matches and leaves matches 7, 9 and 10 unscheduled', () => {
  const addedMatches = season.matches.filter(match => /-partie-(?:5|6|7|8|9|10)$/.test(match.id));
  const unscheduledMatches = season.matches.filter(match => /-partie-(?:7|9|10)$/.test(match.id));

  assert.equal(season.matches.length, 10);
  assert.equal(addedMatches.length, 6);
  assert.ok(addedMatches.every(match => match.result === null && match.sets === null && match.winner === null));
  assert.equal(unscheduledMatches.length, 3);
  assert.ok(unscheduledMatches.every(match => match.date === null && match.time === null));
  assert.match(scheduleMigration, /scheduled_date = null/);
  assert.match(scheduleMigration, /display_time = null/);
  assert.match(scheduleMigration, /lock_at = null/);
});

test('Ludi GMX and Ludi Gmail oppose each other in every new test match', () => {
  const addedMatches = season.matches.slice(4);

  addedMatches.forEach(match => {
    const gmxTeam = match.team1.playerIds.includes('ludi_gmx') ? 1 : 2;
    const gmailTeam = match.team1.playerIds.includes('ludi_gmail') ? 1 : 2;
    assert.notEqual(gmxTeam, gmailTeam, match.id);
  });

  assert.equal((migration.match(/'test-2026-partie-(?:5|6|7|8|9|10)'/g) || []).length, 30);
});
