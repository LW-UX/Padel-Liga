const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260903130000_validate_set_tiebreaks.sql'),
  'utf8'
);

test('server validation defines regulation set and tiebreak score helpers', () => {
  assert.match(migration, /private\.is_valid_regular_set_score/);
  assert.match(migration, /greatest\(p_team_one, p_team_two\) = 6/);
  assert.match(migration, /greatest\(p_team_one, p_team_two\) = 7/);
  assert.match(migration, /private\.is_valid_tiebreak_score/);
  assert.match(migration, /greatest\(p_team_one, p_team_two\) > p_target and abs\(p_team_one - p_team_two\) = 2/);
});

test('server validation separates set tiebreaks from the official set count', () => {
  assert.match(migration, /result_without_set_tiebreaks := regexp_replace/);
  assert.match(migration, /Bei 7:6 oder 6:7 fehlt der Satz-Tiebreak/);
  assert.match(migration, /Satz- und Tiebreak-Sieger stimmen/);
});

test('server validation requires a regulation match tiebreak only after split sets', () => {
  assert.match(migration, /if set_one_winner <> set_two_winner then/);
  assert.match(migration, /Bei 1:1 fehlt der Match-Tiebreak/);
  assert.match(migration, /is_valid_tiebreak_score\(parsed\[12\]::integer, parsed\[13\]::integer, 10\)/);
  assert.match(migration, /Nach einem 2:0 ist kein Match-Tiebreak zulässig/);
});
