const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(repositoryRoot, 'supabase/migrations/20260902120000_season_tournament_automation.sql'),
  'utf8'
);
const appSource = fs.readFileSync(path.join(repositoryRoot, 'js/app.js'), 'utf8');
const tippspielSource = fs.readFileSync(path.join(repositoryRoot, 'js/tippspiel.js'), 'utf8');

test('tournament advancement waits for a locked and completed league schedule', () => {
  assert.match(migration, /selected_season\.regular_schedule_locked[\s\S]*league_match_count > 0[\s\S]*open_league_match_count = 0/);
  assert.match(migration, /where match\.season_id = p_season_id and match\.competition_stage = 'league' and match\.counts_for_ranking/);
  assert.match(migration, /create trigger matches_advance_tournament[\s\S]*after insert or update of actual_sets, winner/);
});

test('Summer seeds its final four from the frozen top four and awards players automatically', () => {
  assert.match(migration, /selected_season\.tournament_mode = 'direct_final_four'[\s\S]*'final_four', stats\.rank, stats\.player_id, stats\.rank/);
  assert.match(migration, /perform private\.populate_tournament_stage\(p_season_id, 'final_four', 'final_four'\)/);
  assert.match(migration, /perform private\.award_final_four_players\(p_season_id\)/);
  assert.match(migration, /perform private\.award_tournament_winner\(p_season_id\)/);
  assert.match(migration, /kind, title[\s\S]*'winner', 'Gewinner'/);
});

test('Winter freezes the top eight, promotes both winning pairs and preserves league order', () => {
  assert.match(migration, /selected_season\.tournament_mode = 'top8_semifinals'[\s\S]*'semifinal', stats\.rank, stats\.player_id, stats\.rank/);
  assert.match(migration, /member\.team = match\.winner/);
  assert.match(migration, /\(row_number\(\) over \(order by qualifier\.league_rank\)\)::smallint/);
  assert.match(migration, /qualified_from_match_id/);
});

test('tournament games affect Elo and profiles but never league points', () => {
  assert.match(migration, /'semifinal', 'best-of-three'[\s\S]*false, true/);
  assert.match(migration, /'final_four', 'single-set'[\s\S]*false, true/);
  assert.match(migration, /match\.counts_for_elo/);
  assert.match(appSource, /getMatchStage\(match\) === 'semifinal'/);
  assert.match(appSource, /getMatchStage\(match\) === 'final-four'/);
});

test('started follow-up rounds are protected and advancement is idempotent', () => {
  assert.match(migration, /target_match\.actual_sets is not null[\s\S]*public\.result_proposals[\s\S]*public\.predictions/);
  assert.match(migration, /raise exception 'Die bereits begonnene Partie % darf nicht neu besetzt werden\.'/);
  assert.match(migration, /on conflict \(season_id, stage, seed\) do nothing/g);
  assert.match(migration, /not exists \([\s\S]*achievement\.kind = 'final_four'/);
  assert.match(migration, /not exists \([\s\S]*achievement\.kind = 'winner'/);
});

test('one-set tips use exact 4, correct winner 2 and wrong winner 0 points', () => {
  const winnerSource = tippspielSource.match(
    /function getPredictionWinner\(value, format\) \{[\s\S]*?(?=\n  function getPredictionPoints)/
  )?.[0] || '';
  const pointsSource = tippspielSource.match(
    /function getPredictionPoints\(prediction, actualValue, format = 'best-of-three'\) \{[\s\S]*?(?=\n  function formatMatchDate)/
  )?.[0] || '';
  const getPredictionPoints = Function(`${winnerSource}\n${pointsSource}\nreturn getPredictionPoints;`)();

  assert.equal(getPredictionPoints('6:4', '6:4', 'single-set'), 4);
  assert.equal(getPredictionPoints('7:5', '6:2', 'single-set'), 2);
  assert.equal(getPredictionPoints('4:6', '6:2', 'single-set'), 0);
  assert.equal(getPredictionPoints('2:1', '2:0'), 2);
  assert.match(migration, /team_one_games = 7 and team_two_games in \(5, 6\)/);
  assert.match(migration, /when scored\.prediction = scored\.actual_value then 4[\s\S]*then 2[\s\S]*else 0/);
});

test('public APIs expose competition stage and result format additively', () => {
  assert.match(migration, /'competition', jsonb_build_object\(/);
  assert.match(migration, /'qualificationPlaces', season\.qualification_places/);
  assert.match(migration, /'stage', replace\(match\.competition_stage/);
  assert.match(migration, /match_format text,[\s\S]*competition_stage text/);
});
