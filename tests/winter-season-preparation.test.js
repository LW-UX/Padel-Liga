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

test('Winter 2026 is the repository default season', () => {
  const { PADEL_SEASONS } = loadWindowScript('data/seasons.js');
  const winter = PADEL_SEASONS.find(season => season.default);

  assert.equal(winter?.id, '2026-winter');
  assert.equal(winter.databaseId, 'winter-2026');
  assert.equal(winter.label, 'Winter 2026');
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
  const testSeason = PADEL_SEASONS.find(season => season.id === '2026-test');
  const app = fs.readFileSync(path.join(repositoryRoot, 'js/app.js'), 'utf8');
  const tipPage = fs.readFileSync(path.join(repositoryRoot, 'js/tipp-page.js'), 'utf8');

  assert.equal(testSeason.hidden, true);
  assert.match(app, /getAllSeasonOptions\(\)\.filter\(season => !season\.hidden\)/);
  assert.match(app, /getAllSeasonOptions\(\)\.find\(season => season\.id === requestedSeasonId\)/);
  assert.match(tipPage, /getAllSeasonOptions\(\)\.filter\(option => !option\.hidden\)/);
  assert.match(tipPage, /getAllSeasonOptions\(\)\.find\(option => option\.id === requested\)/);
});
