const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadWindowScript(file) {
  const window = {};
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  vm.runInNewContext(source, { window });
  return window;
}

const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260909130000_cup_2027.sql'),
  'utf8'
);
const achievementMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260909150000_marcel_ligacup_2027_champion.sql'),
  'utf8'
);

test('Cup 2027 is selectable without replacing Sommer 2026 as default', () => {
  const { PADEL_SEASONS } = loadWindowScript('data/seasons.js');
  const cupOption = PADEL_SEASONS.find(season => season.id === 'cup-2027');

  assert.equal(PADEL_SEASONS.find(season => season.default)?.id, '2026');
  assert.equal(
    PADEL_SEASONS.findIndex(season => season.id === 'cup-2027'),
    PADEL_SEASONS.findIndex(season => season.id === 'winter-2026') + 1
  );
  assert.deepEqual(JSON.parse(JSON.stringify(cupOption)), {
    id: 'cup-2027',
    label: 'Cup 2027',
    visualTheme: 'cup',
    file: 'data/data-cup-2027.js',
    default: false
  });
  assert.match(app, /const staticFallbacks = \[\.\.\.staticOptions\.values\(\)\]/);
  assert.match(app, /window\.PADEL_SEASONS = orderSeasonOptions\(\[\.\.\.databaseOptions, \.\.\.staticFallbacks\]\)/);
});

test('Cup 2027 prepares seven knockout matches and sixteen open quarterfinal places', () => {
  const { PADEL_SEASON: season } = loadWindowScript('data/data-cup-2027.js');
  const quarterfinals = season.matches.filter(match => match.stage === 'quarterfinal');
  const semifinals = season.matches.filter(match => match.stage === 'semifinal');
  const finals = season.matches.filter(match => match.stage === 'final');
  const quarterfinalLabels = quarterfinals.flatMap(match => [
    ...match.team1.qualifierLabels,
    ...match.team2.qualifierLabels
  ]);

  assert.equal(season.startDate, '2027-01-01');
  assert.equal(season.competition.tournamentMode, 'knockout-redraw');
  assert.equal(season.participants.length, 0);
  assert.equal(season.matches.length, 7);
  assert.equal(quarterfinals.length, 4);
  assert.equal(semifinals.length, 2);
  assert.equal(finals.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(quarterfinalLabels)),
    Array.from({ length: 16 }, (_, index) => `Teilnehmer ${String(index + 1).padStart(2, '0')}`)
  );
  assert.ok(season.matches.every(match => match.format === 'best-of-three'));
  assert.ok(season.matches.every(match => match.countsForRanking === false));
  assert.ok(season.matches.every(match => match.countsForElo === true));
});

test('Cup mode renders its own navigation and upward knockout funnel', () => {
  assert.match(html, /id="hero-home-button"/);
  assert.match(html, /id="partien-nav-button"/);
  assert.match(app, /tournamentMode === 'knockout-redraw'/);
  assert.match(app, /heroButton\.innerHTML = cupSeason \? 'PADEL<em>CUP<\/em>'/);
  assert.match(app, /!\['partien', 'infos'\]\.includes\(button\.dataset\.section\)/);
  assert.match(app, /if \(cupSeason\) nav\('partien', matchesNavButton\)/);
  assert.match(app, /renderCupTrophy\(\)[\s\S]*renderCupRound\(matches, 'final'/);
  assert.match(app, /4 Sieger · Teams und Gegner neu auslosen/);
  assert.match(app, /renderCupRound\(matches, 'quarterfinal'/);
  assert.match(style, /\.cup-round-final \{ max-width: 360px; \}/);
  assert.match(style, /\.cup-round-quarterfinal \.cup-round-matches \{ grid-template-columns: repeat\(4/);
  assert.match(style, /@media \(max-width: 768px\)[\s\S]*\.cup-round-quarterfinal \.cup-round-matches \{ grid-template-columns: 1fr; \}/);
});

test('Cup migration extends public competition values without assigning players', () => {
  assert.match(migration, /'knockout_redraw'/);
  assert.match(migration, /'quarterfinal'[\s\S]*'semifinal'[\s\S]*'final'/);
  assert.match(migration, /'cup-2027',[\s\S]*'Cup 2027'[\s\S]*'2027-01-01'[\s\S]*false/);
  assert.equal((migration.match(/'cup-2027-(?:quarterfinal|semifinal|final)-\d+'/g) || []).length, 7);
  assert.doesNotMatch(migration, /insert into public\.(?:season_players|match_players)/);
});

test('Cup final awards Champion and Finale badges automatically', () => {
  assert.match(achievementMigration, /kind in \('winner', 'final_four', 'finalist', 'custom'\)/);
  assert.match(achievementMigration, /selected_season\.tournament_mode <> 'knockout_redraw'/);
  assert.match(achievementMigration, /'winner',\s*'Champion',[\s\S]*?200[\s\S]*?member\.team = new\.winner/);
  assert.match(achievementMigration, /'finalist',\s*'Finale',[\s\S]*?100[\s\S]*?member\.team <> new\.winner/);
  assert.match(achievementMigration, /matches_award_knockout_final_achievements/);
});
