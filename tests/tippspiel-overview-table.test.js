const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'tippspiel.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261030100000_prediction_overview.sql'), 'utf8');

function fn(name) {
  const match = source.match(new RegExp(`  function ${name}\\([^]*?\\n  }`));
  assert.ok(match, name);
  return match[0];
}

function createContext(databaseMatches = new Map()) {
  const context = vm.createContext({
    state: { databaseMatches },
    Date,
    Number,
    escapeHtml: value => String(value ?? ''),
    isOwnMatch: match => match.own === true,
    RACKET_ICON_SVG: '<path d="racket"/>'
  });
  vm.runInContext([
    fn('getActualSets'),
    fn('isCancelledMatch'),
    fn('compareMatchesByNumber'),
    fn('getLastConfirmedMatchId'),
    fn('renderPredictionTableCellContent'),
    fn('renderPredictionTableHiddenCell'),
    fn('renderPredictionTableMatchCell')
  ].join('\n'), context);
  return context;
}

test('overview cells distinguish scored, hidden, passive, cancelled and missing tips', () => {
  const context = createContext(new Map([['m-2', { cancelled_at: '2026-10-01T10:00:00Z' }]]));
  const match = { id: 'm-1' };
  const cancelledMatch = { id: 'm-2' };

  const scored = context.renderPredictionTableMatchCell({ prediction: '2:1', points: 4 }, match);
  assert.match(scored, /is-exact/);
  assert.match(scored, /2:1<span class="prediction-table-points points-4">4<\/span>/);
  assert.match(context.renderPredictionTableMatchCell({ prediction: '2:0', points: 2 }, match), /prediction-table-points points-2">2</);

  const zero = context.renderPredictionTableMatchCell({ prediction: '0:2', points: 0 }, match);
  assert.match(zero, /is-zero/);
  assert.doesNotMatch(zero, /prediction-table-points/);
  const hidden = { prediction: null, is_tipped: true, points: null };
  assert.match(context.renderPredictionTableMatchCell(hidden, match, true), /is-hidden[^>]*>✓/);
  assert.equal(context.renderPredictionTableMatchCell(hidden, match, false), '<td class="prediction-table-cell is-hidden"></td>');
  assert.match(context.renderPredictionTableMatchCell({ is_passive: true, points: 2 }, match), /is-passive[^]*prediction-table-racket[^]*prediction-table-points is-passive">2</);
  assert.doesNotMatch(context.renderPredictionTableMatchCell({ prediction: '2:0', points: null }, cancelledMatch), /prediction-table-points/);
  assert.match(context.renderPredictionTableMatchCell(null, match), /is-empty[^>]*><\/td>/);
  const ownMatch = { id: 'm-3', own: true };
  assert.match(context.renderPredictionTableMatchCell(null, ownMatch, true), /is-own-match[^>]*>–<\/td>/);
  assert.match(context.renderPredictionTableMatchCell(null, ownMatch, false), /is-empty/);
  assert.match(context.renderPredictionTableMatchCell({ is_passive: true, points: 2 }, ownMatch, true), /is-passive/);
});

test('overview focus follows the latest played confirmed result, not the match number', () => {
  const context = createContext(new Map([
    ['partie-3', { actual_sets: '2:0', match_at: '2026-10-20T18:00:00Z' }],
    ['partie-5', { actual_sets: '2:1', match_at: '2026-10-10T18:00:00Z' }],
    ['partie-6', { actual_sets: '1:2', match_at: '2026-10-25T18:00:00Z', cancelled_at: '2026-10-26T10:00:00Z' }],
    ['partie-7', { match_at: '2026-10-28T18:00:00Z' }]
  ]));
  const matches = ['partie-3', 'partie-5', 'partie-6', 'partie-7'].map(id => ({ id }));
  assert.equal(context.getLastConfirmedMatchId(matches), 'partie-3');
  assert.equal(context.getLastConfirmedMatchId([{ id: 'partie-7' }]), null);
});

test('overview query hides tip values until the deadline on every call', () => {
  assert.match(migration, /match\.match_at is not null and match\.match_at <= now\(\)/);
  assert.match(migration, /case when scored\.is_visible then scored\.prediction end/);
  assert.match(migration, /now\(\) >= question\.lock_at as is_visible/);
  assert.match(migration, /case when bonus\.is_visible then bonus\.answers end/);
  assert.match(migration, /grant execute on function public\.get_prediction_overview\(text\) to anon, authenticated/);
});

test('mobile overview rows use player initials or the first letters of first and last name', () => {
  const context = vm.createContext({
    window: { PADEL_PLAYERS: [{ name: 'Ludwig W.', initials: 'LuW' }, { name: 'Marcel M.', initials: 'MzM' }] }
  });
  vm.runInContext(fn('getPredictionAccountShortLabel'), context);
  assert.equal(context.getPredictionAccountShortLabel({ display_name: 'Ludwig W', is_player: true }), 'LuW');
  assert.equal(context.getPredictionAccountShortLabel({ display_name: 'Marcel M', is_player: false }), 'MM');
  assert.equal(context.getPredictionAccountShortLabel({ display_name: 'Moritz Fischer', is_player: false }), 'MF');
  assert.equal(context.getPredictionAccountShortLabel({ display_name: 'Kontakt', is_player: false }), 'KO');
});

test('overview headers mute matches that are not yet open for tips', () => {
  const now = Date.now();
  const context = vm.createContext({
    state: {
      season: { competition: { predictionsEnabled: true } },
      databaseMatches: new Map([
        ['played', { actual_sets: '2:0' }],
        ['scheduled', { betting_open: true, match_at: new Date(now + 86400000).toISOString() }],
        ['window', { betting_open: true }],
        ['later', { betting_open: true }],
        ['closed', { betting_open: false }]
      ])
    },
    Date,
    isOutsidePreviewWindow: match => match.id === 'later'
  });
  vm.runInContext([
    fn('getActualSets'),
    fn('isCancelledMatch'),
    fn('isPredictionTableMatchActive')
  ].join('\n'), context);
  const active = id => context.isPredictionTableMatchActive({ id, sieger: null });
  assert.equal(active('played'), true);
  assert.equal(active('scheduled'), true);
  assert.equal(active('window'), true);
  assert.equal(active('later'), false);
  assert.equal(active('closed'), false);
});

test('overview headers link only matches that are open, started or played', () => {
  const header = fn('renderPredictionTableMatchHeader');
  assert.match(header, /const inner = hasTeams && isActive\s*\?\s*`<a /);
});

test('overview group sums become active as soon as one match of the group is active', () => {
  const table = fn('renderPredictionMatchTable');
  assert.match(table, /groupMatches\.some\(isPredictionTableMatchActive\)/);
  assert.match(table, /<td class="\$\{group\.totalClass\}">/);
});
