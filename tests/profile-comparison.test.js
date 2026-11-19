const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
  const context = vm.createContext({ window: {} });
  for (const file of ['score-input.js', 'profile-comparison.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), context);
  }
  return context;
}

function comparisonOptions() {
  const match = { id: 'training', date: '2026-11-01', team: 1, partnerNames: ['Ben'],
    opponentNames: ['Cleo', 'Dan'], matchWeight: 0.5, winWeight: 0.5, lossWeight: 0,
    outcome: 'win', resultDetails: '6:0' };
  return {
    profile: { identity: { id: 'anna', displayName: 'Anna <A>' }, summary: { currentElo: 1200 },
      eloSeries: [{ elo: 1200 }], matches: [match] },
    other: { id: 'ben', name: 'Ben' },
    profiles: new Map([
      ['ben', { summary: { currentElo: 1300 }, eloSeries: [{ elo: 1300 }] }],
      ['cleo', { eloSeries: [{ elo: 1400 }] }], ['dan', { eloSeries: [{ elo: 1500 }] }]
    ]),
    togetherMatches: [match], comparePlayerIds: ['ben', 'cleo', 'dan'],
    playersByName: new Map([['Ben', { id: 'ben' }], ['Cleo', { id: 'cleo' }], ['Dan', { id: 'dan' }]])
  };
}

test('search comparison renders weighted profile graphs with static headings and escaped names', () => {
  const context = setup();
  const html = context.renderPlayerProfileComparisonTables(comparisonOptions());
  assert.match(html, /Im Team \(0,5\)/);
  assert.match(html, /Anna &lt;A&gt;/);
  assert.match(html, /Siege: 0,5 zu 0/);
  assert.match(html, /Ø Elo: 1230 zu 1430/);
  assert.match(html, /Akt\. Elo: 1200 zu 1300/);
  assert.match(html, /Noch nie gegeneinander gespielt/);
  assert.doesNotMatch(html, /<button|data-profile-compare-list|player-profile-compare-matches/);
});

test('profile comparison retains its own expandable match lists through renderer callbacks', () => {
  const context = setup();
  const html = context.renderPlayerProfileComparisonTables({ ...comparisonOptions(),
    renderTitle: (list, title) => `<button data-profile-compare-list="${list}">${title}</button>`,
    renderList: (list, matches) => `<div data-list="${list}">${matches.length}</div>`
  });
  assert.match(html, /<button data-profile-compare-list="team">Im Team \(0,5\)<\/button>/);
  assert.match(html, /<div data-list="team">1<\/div>/);
});

test('comparison marks pending Elo as loading without presenting a partial team average', () => {
  const context = setup();
  const options = comparisonOptions();
  options.profiles.set('ben', undefined);
  const html = context.renderPlayerProfileComparisonTables(options);
  assert.match(html, /Akt\. Elo: wird geladen/);
  assert.match(html, /Ø Elo: wird geladen/);
  assert.doesNotMatch(html, /Ø Elo: 1230/);
});
