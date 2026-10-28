const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const tipPage = fs.readFileSync(path.join(root, 'js/tipp-page.js'), 'utf8');
const routing = fs.readFileSync(path.join(root, 'js/season-routing.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261012120000_normalize_season_ids.sql'),
  'utf8'
);

function loadWindowScript(file) {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), { window });
  return window;
}

test('season IDs and filenames use the sortable year-type schema', () => {
  const { PADEL_SEASONS } = loadWindowScript('data/seasons.js');
  const { PADEL_SEASON } = loadWindowScript('data/data-2026-sommer.js');
  const summer = PADEL_SEASONS.find(season => season.id === '2026-sommer');
  const winter = PADEL_SEASONS.find(season => season.id === '2026-winter');
  const testSeason = PADEL_SEASONS.find(season => season.id === '2026-test');

  assert.equal(summer.label, 'Sommer 2026');
  assert.equal(summer.shortLabel, 'So26');
  assert.equal(summer.route, 'so26');
  assert.equal(winter.shortLabel, 'Wi26');
  assert.equal(winter.route, 'wi26');
  assert.equal(testSeason.shortLabel, 'Test');
  assert.equal(testSeason.route, 'test');
  assert.match(summer.file, /^data\/data-2026-sommer\.js/);
  assert.equal(winter.default, true);
  assert.equal(PADEL_SEASON.id, '2026-sommer');
  assert.equal(PADEL_SEASON.matchIdPrefix, 'season-2026');
  assert.match(testSeason.file, /^data\/data-2026-test\.js/);
  assert.deepEqual(
    JSON.parse(JSON.stringify(PADEL_SEASONS.filter(season => !season.hidden).map(season => season.id))),
    ['2026-sommer', '2026-winter', '2027-cup']
  );
});

test('old season links are normalized to the year-type schema', () => {
  assert.match(routing, /'2026': '2026-sommer'/);
  assert.match(routing, /'winter-2026': '2026-winter'/);
  assert.match(routing, /'cup-2027': '2027-cup'/);
  assert.match(routing, /'test-2026': '2026-test'/);
  assert.match(routing, /url\.searchParams\.delete\('saison'\)/);
  assert.match(app, /PadelSeasonRouting\.normalizeCurrentUrl\('league'\)/);
  assert.match(tipPage, /PadelSeasonRouting\.normalizeCurrentUrl\('tipp'\)/);
});

test('season changes and cross-page links use the shared short-path routing', () => {
  assert.match(app, /PadelSeasonRouting\.getSeasonUrl\(id, 'league'/);
  assert.match(app, /PadelSeasonRouting\.getSeasonUrl\(selectedSeason\.id, 'tipp'\)/);
  assert.match(tipPage, /PadelSeasonRouting\.getSeasonUrl\(option\.dataset\.seasonId, 'tipp'/);
  assert.match(tipPage, /PadelSeasonRouting\.getSeasonUrl\(selected\.id, 'league'\)/);
});

test('season buttons use short labels while their menus retain full labels', () => {
  assert.match(app, /seasonLabel\.textContent = selectedSeason\.shortLabel \|\| selectedSeason\.label/);
  assert.match(app, /<span>\$\{season\.label\}<\/span>/);
  assert.match(tipPage, /label\.textContent = selected\.shortLabel \|\| selected\.label/);
  assert.match(tipPage, /<span>\$\{option\.label\}<\/span>/);
});

test('database migration renames every season and cascades all references', () => {
  assert.match(migration, /when '2026' then '2026-sommer'/);
  assert.match(migration, /when 'winter-2026' then '2026-winter'/);
  assert.match(migration, /when 'test-2026' then '2026-test'/);
  assert.match(migration, /when 'cup-2027' then '2027-cup'/);
  assert.equal((migration.match(/on update cascade/g) || []).length, 6);
  assert.match(migration, /where id in \('2026', 'winter-2026', 'test-2026', 'cup-2027'\)/);
  assert.match(migration, /where id in \('2026-sommer', '2026-winter', '2026-test', '2027-cup'\)/);
});
