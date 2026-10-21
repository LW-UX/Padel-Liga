const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'tippspiel.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

function fn(name) {
  const match = source.match(new RegExp(`  function ${name}\\([^]*?\\n  }`));
  assert.ok(match, name);
  return match[0];
}

test('desktop tipping cards use date-only metadata and the league Elo probability', () => {
  const state = {
    season: { id: '2026-test' },
    databaseMatches: new Map([['match-1', { match_at: '2026-09-23T10:30:00Z' }]]),
    playerElos: new Map([['a', 1000], ['b', 1000], ['c', 1000], ['d', 1000]])
  };
  const context = vm.createContext({ state, Intl, Date, Math, Number, encodeURIComponent });
  vm.runInContext([
    fn('getBerlinMatchAtParts'),
    fn('formatMatchDate'),
    fn('getWeightedTeamElo'),
    fn('getMatchWinProbability')
  ].join('\n'), context);

  assert.equal(context.formatMatchDate({ id: 'match-1' }), 'Mi, 23.09.');
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.getMatchWinProbability({
      team1: { playerIds: ['a', 'b'] },
      team2: { playerIds: ['c', 'd'] }
    }))),
    { team1: 50, team2: 50 }
  );
});

test('the card center links probability and result to preview or analysis without extra result copy', () => {
  const state = {
    season: { id: '2026-test' },
    databaseMatches: new Map(),
    playerElos: new Map([['a', 1000], ['b', 1000], ['c', 1000], ['d', 1000]])
  };
  const context = vm.createContext({
    state,
    window: { PadelPreviewWindow: { availability: match => match.distant ? 'basic' : 'preview' } },
    Math,
    Number,
    encodeURIComponent,
    escapeHtml: value => String(value)
  });
  vm.runInContext([
    fn('getWeightedTeamElo'),
    fn('getMatchWinProbability'),
    fn('getMatchDetailHref'),
    fn('getPreviewWindowMatch'),
    fn('isOutsidePreviewWindow'),
    fn('renderMatchCenter')
  ].join('\n'), context);
  const match = {
    id: 'test-2026-partie-7',
    team1: { playerIds: ['a', 'b'] },
    team2: { playerIds: ['c', 'd'] }
  };

  const preview = context.renderMatchCenter(match, null, false);
  assert.match(preview, /50 % : 50 %/);
  assert.match(preview, /\.\.\/\?saison=2026-test&amp;partie=test-2026-partie-7|\.\.\/\?saison=2026-test&partie=test-2026-partie-7/);
  assert.match(preview, /Partievorschau öffnen/);

  const distant = context.renderMatchCenter({ ...match, distant: true }, null, false);
  assert.match(distant, /50 % : 50 %/);
  assert.doesNotMatch(distant, /<a |partie=|Partievorschau öffnen/, 'distant matches without a full preview stay unlinked');

  const analysis = context.renderMatchCenter(match, '2:1', false);
  assert.match(analysis, />2:1<\/a>/);
  assert.match(analysis, /Partieanalyse öffnen/);
  assert.doesNotMatch(analysis, /ERGEBNIS|Endstand|VS/);
});

test('the status chip replaces the removed bottom row with the official score states', () => {
  const context = vm.createContext({});
  vm.runInContext(fn('getStatusChip'), context);
  assert.equal(context.getStatusChip({ isOpen: true }).label, 'Offen');
  assert.equal(context.getStatusChip({ actualValue: '2:0', selected: '2:0', points: 4 }).label, 'Exakt · +4');
  assert.equal(context.getStatusChip({ actualValue: '2:1', selected: '2:0', points: 2 }).label, 'Sieger · +2');
  assert.equal(context.getStatusChip({ actualValue: '1:2', selected: '2:0', points: 0 }).label, 'Falsch · 0');
  assert.doesNotMatch(source, /prediction-result-row|prediction-save-state/);
  assert.match(style, /@media \(min-width: 840px\)[\s\S]*\.prediction-match-card:not\(\.is-single-set\)/);
});
