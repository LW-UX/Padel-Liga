const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repositoryRoot = path.join(__dirname, '..');
function loadWindowScript(file) {
  const window = {};
  const source = fs.readFileSync(path.join(repositoryRoot, file), 'utf8');
  vm.runInNewContext(source, { window });
  return window;
}

test('Sommer 2026 remains the repository default while Winter is selectable', () => {
  const { PADEL_SEASONS } = loadWindowScript('data/seasons.js');
  const { PADEL_SEASON } = loadWindowScript('data/data-winter-2026.js');

  assert.equal(PADEL_SEASONS.find(season => season.default)?.id, '2026');
  assert.equal(PADEL_SEASON.id, 'winter-2026');
  assert.equal(PADEL_SEASON.label, 'Winter 2026');
  assert.equal(PADEL_SEASON.startDate, '2026-10-01');
  assert.deepEqual(
    JSON.parse(JSON.stringify(PADEL_SEASON.competition)),
    {
      tournamentMode: 'top8-semifinals',
      qualificationPlaces: 8,
      homeRankingLimit: 4,
      regularScheduleLocked: false,
      predictionsEnabled: true
    }
  );
  assert.equal(PADEL_SEASON.matches.length, 5);
  assert.equal(PADEL_SEASON.matchdays.length, 0);
});

test('Winter contains two semifinals and the three rotating Final Four sets', () => {
  const { PADEL_SEASON } = loadWindowScript('data/data-winter-2026.js');
  const semifinals = PADEL_SEASON.matches.filter(match => match.stage === 'semifinal');
  const finalFour = PADEL_SEASON.matches.filter(match => match.stage === 'final-four');

  assert.deepEqual(
    JSON.parse(JSON.stringify(semifinals.map(match => [
      match.team1.qualifierRanks,
      match.team2.qualifierRanks,
      match.format
    ]))),
    [[[1, 2], [7, 8], 'best-of-three'], [[3, 4], [5, 6], 'best-of-three']]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(finalFour.map(match => [
      match.team1.qualifierRanks,
      match.team2.qualifierRanks,
      match.format
    ]))),
    [
      [[1, 2], [3, 4], 'single-set'],
      [[1, 4], [2, 3], 'single-set'],
      [[1, 3], [2, 4], 'single-set']
    ]
  );
});

test('Winter 2026 has no participants before the live roster is confirmed', () => {
  const { PADEL_SEASON } = loadWindowScript('data/data-winter-2026.js');
  assert.deepEqual(JSON.parse(JSON.stringify(PADEL_SEASON.participants)), []);
});

test('the cleanup removes Winter participants and the automation keeps Sommer active', () => {
  const cleanupMigration = fs.readFileSync(
    path.join(repositoryRoot, 'supabase/migrations/20260922110000_clear_winter_2026_players.sql'),
    'utf8'
  );
  const automationMigration = fs.readFileSync(
    path.join(repositoryRoot, 'supabase/migrations/20260902120000_season_tournament_automation.sql'),
    'utf8'
  );

  assert.match(cleanupMigration, /delete from public\.season_players\s+where season_id = 'winter-2026'/);
  assert.match(automationMigration, /tournament_mode = 'direct_final_four'[\s\S]*is_active = true[\s\S]*where id = '2026'/);
  assert.match(automationMigration, /tournament_mode = 'top8_semifinals'[\s\S]*regular_schedule_locked = false[\s\S]*is_active = false[\s\S]*where id = 'winter-2026'/);
});

test('the test season is hidden from pickers but remains available by direct URL', () => {
  const { PADEL_SEASONS } = loadWindowScript('data/seasons.js');
  const testSeason = PADEL_SEASONS.find(season => season.id === 'test-2026');
  const app = fs.readFileSync(path.join(repositoryRoot, 'js/app.js'), 'utf8');
  const tipPage = fs.readFileSync(path.join(repositoryRoot, 'js/tipp-page.js'), 'utf8');

  assert.equal(testSeason.hidden, true);
  assert.match(app, /getAllSeasonOptions\(\)\.filter\(season => !season\.hidden\)/);
  assert.match(app, /getAllSeasonOptions\(\)\.find\(season => season\.id === requestedSeasonId\)/);
  assert.match(tipPage, /getAllSeasonOptions\(\)\.filter\(option => !option\.hidden\)/);
  assert.match(tipPage, /getAllSeasonOptions\(\)\.find\(option => option\.id === requested\)/);
});
