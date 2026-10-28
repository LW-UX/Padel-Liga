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
  const context = { window, document: { baseURI }, URL, URLSearchParams };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'data/seasons.js'), 'utf8'), context);
  vm.runInNewContext(routingSource, context);
  return { routing: window.PadelSeasonRouting, history };
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

test('legacy match query links are normalized after the season matches are available', () => {
  const { routing, history } = loadRouting(
    'https://lw-ux.github.io/Padel-Liga/wi26/?partie=winter-2026-partie-7',
    'https://lw-ux.github.io/Padel-Liga/'
  );
  const matches = [{ id: 'winter-2026-partie-7', stage: 'league' }];
  assert.equal(routing.normalizeCurrentMatchUrl('2026-winter', matches), true);
  assert.equal(history.replaced, '/Padel-Liga/wi26/partie/7/');
});

test('deployment generation creates direct entry pages with the correct base paths', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'padel-season-routes-'));
  execFileSync(process.execPath, [path.join(root, 'tools/generate-season-routes.mjs'), output], { cwd: root });
  const league = fs.readFileSync(path.join(output, 'wi26', 'index.html'), 'utf8');
  const match = fs.readFileSync(path.join(output, 'wi26', 'partie', '7', 'index.html'), 'utf8');
  const tipping = fs.readFileSync(path.join(output, 'tipp', 'wi26', 'index.html'), 'utf8');
  assert.match(league, /<base href="\.\.\/">/);
  assert.match(tipping, /<base href="\.\.\/">/);
  assert.match(match, /<base href="\.\.\/\.\.\/\.\.\/">/);
  assert.match(league, /PADEL<em>LIGA<\/em>/);
  assert.match(match, /PADEL<em>LIGA<\/em>/);
  assert.match(tipping, /PADEL<em>TIPP<\/em>/);
});
