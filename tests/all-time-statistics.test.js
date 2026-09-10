const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260910100000_public_all_time_statistics.sql'),
  'utf8'
);

function evaluateSetDominance(player, matches) {
  const source = app.match(
    /function parseRegularSetScore\(rawSet\) \{[\s\S]*?(?=\nfunction getNormalizedWinnerSetAverages)/
  );
  assert.ok(source, 'set-dominance helpers should be present');
  const context = {
    player,
    matches,
    result: null,
    isSingleSetMatch: match => match.format === 'single-set'
  };
  vm.createContext(context);
  vm.runInContext(`${source[0]}\nresult = getPlayerSetDominance(player, matches);`, context);
  return JSON.parse(JSON.stringify(context.result));
}

test('statistics page exposes an accessible season and all-time switch', () => {
  assert.match(html, /id="statistics-mode-toggle" aria-label="Statistikzeitraum auswählen"/);
  assert.match(html, /aria-pressed="true" data-statistics-mode="season">Saison<\/button>/);
  assert.match(html, /aria-pressed="false" data-statistics-mode="all-time">All-Time<\/button>/);
  assert.equal((html.match(/data-season-only-statistic/g) || []).length, 2);
  assert.match(html, /id="statistics-load-error" role="status" hidden/);
  assert.match(style, /\[data-season-only-statistic\]\[hidden\]\s*\{ display: none; \}/);
});

test('all-time data is loaded lazily, cached, and keeps a separate player filter', () => {
  assert.match(app, /client\.rpc\('get_public_all_time_statistics'\)/);
  assert.match(app, /if \(allTimeStatisticsData\) return allTimeStatisticsData;/);
  assert.match(app, /statisticsPlayerFilters\.set\('all-time', new Set\(data\.players\.map/);
  assert.match(app, /statisticsPlayerFilters\.set\('season', new Set\(PADEL_DATA\.players\.map/);
  assert.match(app, /statisticsLoadError = 'Die All-Time-Statistik konnte nicht geladen werden\./);
  assert.match(app, /element\.hidden = isAllTimeStatistics\(\)/);
});

test('all-time set dominance compares players per regular set', () => {
  const player = { name: 'Spieler A' };
  const matches = [
    {
      sieger: 1,
      ergebnis: '6:2, 4:6 - 10:8',
      format: 'best-of-three',
      team1: { spieler: ['Spieler A', 'Partner'] },
      team2: { spieler: ['Gegner 1', 'Gegner 2'] }
    },
    {
      sieger: 2,
      ergebnis: '1:6',
      format: 'single-set',
      team1: { spieler: ['Gegner 1', 'Partner'] },
      team2: { spieler: ['Spieler A', 'Gegner 2'] }
    }
  ];

  assert.deepEqual(evaluateSetDominance(player, matches), { spielDiff: 7, setCount: 3 });
  assert.match(app, /stats\.spielDiff \/ stats\.setCount/);
  assert.match(app, /Spiele pro \$\{isAllTimeStatistics\(\) \? 'Satz' : 'Partie'\}/);
});

test('public all-time RPC returns only completed official competition data', () => {
  assert.match(migration, /create function public\.get_public_all_time_statistics\(\)/);
  assert.match(migration, /season\.counts_for_profile/);
  assert.match(migration, /match\.actual_sets is not null[\s\S]*match\.winner is not null/);
  assert.match(migration, /match\.match_type in \('season', 'final'\)/);
  assert.match(migration, /where exists \([\s\S]*completed_matches[\s\S]*member\.player_id = player\.id/);
  assert.match(migration, /'eventType', 'initial'/);
  assert.match(migration, /'eventType', 'match'/);
  assert.match(migration, /join completed_matches as match on match\.id = change\.match_id/);
  assert.match(migration, /'seasonLabel', match\.season_label/);
  assert.match(migration, /grant execute on function public\.get_public_all_time_statistics\(\) to anon, authenticated/);
});

test('all-time Elo chart stays continuous and identifies each competition', () => {
  assert.match(app, /const data = getStatisticsData\(\);[\s\S]*const chartEvents = getChartEvents\(data\)/);
  assert.match(app, /spanGaps: true/);
  assert.match(app, /isAllTimeStatistics\(\) && event\.match\?\.seasonLabel/);
  assert.match(app, /isAllTimeStatistics\(\) \? \{ year: '2-digit' \} : \{\}/);
  assert.match(app, /chart\.\$players = players/);
});
