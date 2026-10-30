const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const routingSource = fs.readFileSync(path.join(root, 'js/season-routing.js'), 'utf8');

function loadRouting(href, baseURI) {
  const location = new URL(href);
  const history = {
    state: null,
    replaced: null,
    replaceState(_state, _title, nextUrl) {
      this.replaced = nextUrl;
    }
  };
  const window = { location, history, PADEL_SEASONS: [] };
  const document = {
    baseURI,
    pinnedBase: null,
    querySelector() { return this.pinnedBase; },
    createElement() { return {}; },
    head: { prepend(element) { document.pinnedBase = element; } }
  };
  const context = { window, document, URL, URLSearchParams };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'data/seasons.js'), 'utf8'), context);
  vm.runInNewContext(routingSource, context);
  return { routing: window.PadelSeasonRouting, history, document };
}

test('short paths select their season and produce league and tipping URLs', () => {
  const { routing } = loadRouting(
    'https://lw-ux.github.io/Padel-Liga/wi26/',
    'https://lw-ux.github.io/Padel-Liga/'
  );
  assert.equal(routing.getRequestedSeasonId(), '2026-winter');
  assert.equal(routing.getSeasonUrl('2026-sommer', 'league').href, 'https://lw-ux.github.io/Padel-Liga/so26/');
  assert.equal(routing.getSeasonUrl('2027-cup', 'tipp').href, 'https://lw-ux.github.io/Padel-Liga/tipp/cup27/');
});

test('local file navigation keeps using real index files with query parameters', () => {
  const { routing } = loadRouting(
    'file:///Users/example/Padel-Liga/index.html',
    'file:///Users/example/Padel-Liga/index.html'
  );
  const match = { id: 'winter-2026-partie-7', stage: 'league' };
  const liveMatch = { id: 'season-2026-partie-28', stage: 'final-four', format: 'single-set' };
  assert.equal(
    routing.getSeasonUrl('2026-winter', 'league').href,
    'file:///Users/example/Padel-Liga/index.html?saison=2026-winter'
  );
  assert.equal(
    routing.getSeasonUrl('2026-winter', 'tipp').href,
    'file:///Users/example/Padel-Liga/tipp/index.html?saison=2026-winter'
  );
  assert.equal(
    routing.getMatchUrl('2026-winter', match).href,
    'file:///Users/example/Padel-Liga/index.html?saison=2026-winter&partie=winter-2026-partie-7'
  );
  assert.equal(
    routing.getLiveUrl('2026-sommer', liveMatch, 'overview').href,
    'file:///Users/example/Padel-Liga/index.html?saison=2026-sommer&live=season-2026-partie-28&liveView=overview'
  );
});

test('local PadelTipp links return to the root index file', () => {
  const { routing } = loadRouting(
    'file:///Users/example/Padel-Liga/tipp/index.html?saison=2026-winter',
    'file:///Users/example/Padel-Liga/tipp/index.html'
  );
  assert.equal(
    routing.getSeasonUrl('2026-sommer', 'league').href,
    'file:///Users/example/Padel-Liga/index.html?saison=2026-sommer'
  );
});

test('local development servers use query routes that exist without deploy generation', () => {
  const { routing } = loadRouting(
    'http://localhost:4173/tipp/?saison=2026-winter',
    'http://localhost:4173/tipp/'
  );
  const match = { id: 'winter-2026-partie-7', stage: 'league' };
  const liveMatch = { id: 'season-2026-partie-28', stage: 'final-four', format: 'single-set' };
  assert.equal(
    routing.getSeasonUrl('2026-winter', 'league').href,
    'http://localhost:4173/?saison=2026-winter'
  );
  assert.equal(
    routing.getMatchUrl('2026-winter', match).href,
    'http://localhost:4173/?saison=2026-winter&partie=winter-2026-partie-7'
  );
  assert.equal(
    routing.getLiveUrl('2026-sommer', liveMatch, 'overview').href,
    'http://localhost:4173/?saison=2026-sommer&live=season-2026-partie-28&liveView=overview'
  );
});

test('season changes discard detail routes from the previous season', () => {
  const { routing } = loadRouting(
    'http://localhost:4173/?saison=2026-sommer&partie=season-2026-partie-3&live=season-2026-partie-28&liveView=overview&spielerprofil=spieler-a&ref=wechsel',
    'http://localhost:4173/'
  );
  assert.equal(
    routing.getSeasonUrl('2026-winter', 'league', {
      preserveSearch: true,
      preserveHash: true,
      clearDetails: true
    }).href,
    'http://localhost:4173/?ref=wechsel&saison=2026-winter'
  );
});

test('short match paths resolve the season and the underlying stable match id', () => {
  const { routing } = loadRouting(
    'https://lw-ux.github.io/Padel-Liga/wi26/partie/7/',
    'https://lw-ux.github.io/Padel-Liga/'
  );
  const matches = [
    { id: 'winter-2026-partie-7', stage: 'league' },
    { id: 'winter-2026-semifinal-1', stage: 'semifinal' },
    { id: 'winter-2026-final-1', stage: 'final-four' }
  ];
  assert.equal(routing.getRequestedSeasonId(), '2026-winter');
  assert.equal(routing.getRequestedMatchId(matches), 'winter-2026-partie-7');
  assert.equal(routing.getMatchUrl('2026-winter', matches[0]).href, 'https://lw-ux.github.io/Padel-Liga/wi26/partie/7/');
  assert.equal(routing.getMatchUrl('2026-winter', matches[1]).href, 'https://lw-ux.github.io/Padel-Liga/wi26/partie/halbfinale-1/');
  assert.equal(routing.getMatchSlug(matches[2]), null, 'Final Four remains on the separate live route');
});

test('legacy query links are replaced by the canonical short path and keep detail parameters', () => {
  const { routing, history } = loadRouting(
    'https://lw-ux.github.io/Padel-Liga/?saison=winter-2026&partie=42',
    'https://lw-ux.github.io/Padel-Liga/'
  );
  assert.equal(routing.getRequestedSeasonId(), '2026-winter');
  assert.equal(routing.normalizeCurrentUrl('league'), true);
  assert.equal(history.replaced, '/Padel-Liga/wi26/?partie=42');
});

test('leaving the root page for a short path keeps relative scripts at the site root', () => {
  const { routing, history, document } = loadRouting(
    'https://padelliga.envidual.com/?saison=test-2026&konto=1',
    'https://padelliga.envidual.com/?saison=test-2026&konto=1'
  );
  routing.normalizeCurrentUrl('league');
  assert.equal(history.replaced, '/test/?konto=1');
  assert.equal(document.pinnedBase.href, 'https://padelliga.envidual.com/');
});

test('legacy match query links are normalized after the season matches are available', () => {
  const { routing, history } = loadRouting(
    'https://lw-ux.github.io/Padel-Liga/wi26/?partie=winter-2026-partie-7',
    'https://lw-ux.github.io/Padel-Liga/'
  );
  const matches = [{ id: 'winter-2026-partie-7', stage: 'league' }];
  assert.equal(routing.normalizeCurrentMatchUrl('2026-winter', matches), true);
  assert.equal(history.replaced, '/Padel-Liga/wi26/partie/7/');
});

test('live overview and individual Final Four routes use short paths', () => {
  const { routing } = loadRouting(
    'https://lw-ux.github.io/Padel-Liga/so26/live/',
    'https://lw-ux.github.io/Padel-Liga/'
  );
  const matches = [
    { id: 'season-2026-partie-28', stage: 'final-four', format: 'single-set' },
    { id: 'season-2026-partie-29', stage: 'final-four', format: 'single-set' }
  ];
  assert.deepEqual(
    JSON.parse(JSON.stringify(routing.getRequestedLiveRoute(matches))),
    { matchId: 'season-2026-partie-28', view: 'overview' }
  );
  assert.equal(routing.getLiveUrl('2026-sommer', matches[0], 'overview').href, 'https://lw-ux.github.io/Padel-Liga/so26/live/');
  assert.equal(routing.getLiveUrl('2026-sommer', matches[0]).href, 'https://lw-ux.github.io/Padel-Liga/so26/live/28/');
});

test('legacy live overview queries normalize to the short live route', () => {
  const { routing, history } = loadRouting(
    'https://lw-ux.github.io/Padel-Liga/so26/?live=season-2026-partie-28&liveView=overview',
    'https://lw-ux.github.io/Padel-Liga/'
  );
  const matches = [{ id: 'season-2026-partie-28', stage: 'final-four', format: 'single-set' }];
  assert.equal(routing.normalizeCurrentLiveUrl('2026-sommer', matches), true);
  assert.equal(history.replaced, '/Padel-Liga/so26/live/');
});

test('deployment generation creates direct entry pages with the correct base paths', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'padel-season-routes-'));
  execFileSync(process.execPath, [path.join(root, 'tools/generate-season-routes.mjs'), output], { cwd: root });
  const league = fs.readFileSync(path.join(output, 'wi26', 'index.html'), 'utf8');
  const match = fs.readFileSync(path.join(output, 'wi26', 'partie', '7', 'index.html'), 'utf8');
  const liveOverview = fs.readFileSync(path.join(output, 'so26', 'live', 'index.html'), 'utf8');
  const liveMatch = fs.readFileSync(path.join(output, 'so26', 'live', '28', 'index.html'), 'utf8');
  const tipping = fs.readFileSync(path.join(output, 'tipp', 'wi26', 'index.html'), 'utf8');
  assert.match(league, /<base href="\.\.\/">/);
  assert.match(tipping, /<base href="\.\.\/">/);
  assert.match(match, /<base href="\.\.\/\.\.\/\.\.\/">/);
  assert.match(liveOverview, /<base href="\.\.\/\.\.\/">/);
  assert.match(liveMatch, /<base href="\.\.\/\.\.\/\.\.\/">/);
  assert.match(league, /PADEL<em>LIGA<\/em>/);
  assert.match(match, /PADEL<em>LIGA<\/em>/);
  assert.match(liveOverview, /PADEL<em>LIGA<\/em>/);
  assert.match(liveMatch, /PADEL<em>LIGA<\/em>/);
  assert.match(tipping, /PADEL<em>TIPP<\/em>/);
});
