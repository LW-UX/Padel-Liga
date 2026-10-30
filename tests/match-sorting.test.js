const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

test('match overview defaults to matchdays and exposes date sorting in the ranking position', () => {
  assert.match(html, /id="match-sort-toggle"[\s\S]*class="active" data-match-sort="matchday"[^>]*>.*Spieltage/);
  assert.match(html, /data-match-sort="date"[^>]*>.*Datum/);
  assert.match(app, /let matchSortMode = 'matchday'/);
  assert.match(app, /matchSortMode = 'matchday';[\s\S]*rankingSortMode = 'points'/);
  assert.match(app, /matchSortMode === 'date'[\s\S]*renderPartienByDate\(visibleMatches\)/);
});

test('switching match sorting reuses the ranking movement animation for stable match cards', () => {
  assert.match(app, /renderPartien\(\{ animateSort: true \}\)/);
  assert.match(app, /data-match-entry="\$\{escapeHtml\(m\.id\)\}"/);
  assert.match(app, /getRankingRowPositions\(partienSection, '\.mc', 'matchEntry'\)/);
  assert.match(app, /animateRankingRows\(partienSection, '\.mc', previousPositions, 'matchEntry'\)/);
  assert.match(fs.readFileSync(path.join(root, 'js', 'table-core.js'), 'utf8'), /function animateRankingRows\([^]*prefers-reduced-motion: reduce[^]*520ms cubic-bezier/);
});

test('league and Final Four match plans share score-detail hover and mobile click behavior', () => {
  assert.match(style, /:is\(#spielplan, #final-four-spielplan\) \.mc\.played \.mc-score-detail/);
  assert.match(style, /:is\(#spielplan, #final-four-spielplan\):has\(\.mc\.played:hover\)/);
  assert.match(app, /document\.querySelectorAll\('#spielplan, #final-four-spielplan'\)\.forEach\(matchPlan => \{/);
  assert.match(app, /matchPlan\.classList\.toggle\('played-details-visible'\)/);
});

test('date sorting places matches without a complete date and time last', () => {
  const source = app.match(/function compareMatchesBySchedule\(a, b\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);

  const context = {
    hasMatchSortDate: match => Boolean(match.sortDate || match.datum && match.uhrzeit),
    compareMatchesByNumber: (a, b) => a.nr - b.nr,
    compareMatchesByDateTime: (a, b) => `${a.sortDate || a.datum}T${a.uhrzeit || '99.99'}`
      .localeCompare(`${b.sortDate || b.datum}T${b.uhrzeit || '99.99'}`)
  };
  const compareMatchesBySchedule = vm.runInNewContext(
    `(${source.replace('function compareMatchesBySchedule', 'function')})`,
    context
  );
  const matches = [
    { id: 'open-final', nr: 1, spieltag: 8, datum: null, uhrzeit: null },
    { id: 'later', nr: 2, datum: '2026-06-02', uhrzeit: '09.00' },
    { id: 'cancelled', nr: 5, sortDate: '2026-06-01', datum: null, uhrzeit: null },
    { id: 'open-league', nr: 10, spieltag: 3, datum: '2026-05-01', uhrzeit: null },
    { id: 'earlier', nr: 1, datum: '2026-06-01', uhrzeit: '18.00' }
  ];

  assert.deepEqual(
    matches.sort(compareMatchesBySchedule).map(match => match.id),
    ['earlier', 'cancelled', 'later', 'open-league', 'open-final']
  );
  assert.match(app, /function getMatchSortDate\(match\)[\s\S]*getMatchdayInfo\(match\.spieltag\)\?\.startDate/);
  assert.match(app, /scheduledMatches = sortedMatches\.filter\(hasMatchSortDate\)/);
  assert.match(app, /if \(matchScope === 'open'\) return match\.sieger === null/);
  assert.doesNotMatch(app, /function getPendingMatchLabel/);
  assert.match(app, /statistics\?\.mode === 'preview' \? renderMatchForecastLine\(m\) : ''/);
});

test('a repeated click reverses the match order and switching starts ascending again', () => {
  const source = app.match(/function setMatchSort\(mode\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const context = { matchSortMode: 'matchday', matchSortDescending: false, renderPartien: () => {} };
  vm.runInNewContext(`${source}; this.setMatchSort = setMatchSort;`, context);

  context.setMatchSort('matchday');
  assert.equal(context.matchSortDescending, true);
  context.setMatchSort('matchday');
  assert.equal(context.matchSortDescending, false);
  context.setMatchSort('matchday');
  context.setMatchSort('date');
  assert.equal(context.matchSortMode, 'date');
  assert.equal(context.matchSortDescending, false);
});

test('descending date sorting keeps matches without a date last', () => {
  const applySource = app.match(/function applyMatchSortDirection\(items\) \{[\s\S]*?\n\}/)?.[0];
  const sortSource = app.match(/function sortMatchesBySchedule\(matches\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(applySource && sortSource);
  const context = {
    matchSortDescending: true,
    hasMatchSortDate: match => Boolean(match.datum),
    compareMatchesBySchedule: (a, b) => a.order - b.order
  };
  vm.runInNewContext(`${applySource}\n${sortSource}\nthis.sortMatchesBySchedule = sortMatchesBySchedule;`, context);

  const matches = [
    { id: 'earlier', order: 1, datum: '2026-06-01' },
    { id: 'open-first', order: 3, datum: null },
    { id: 'later', order: 2, datum: '2026-06-02' },
    { id: 'open-second', order: 4, datum: null }
  ];
  assert.deepEqual(
    Array.from(context.sortMatchesBySchedule(matches), match => match.id),
    ['later', 'earlier', 'open-second', 'open-first']
  );
});

test('open scope includes scheduled matches without a result and excludes completed matches', () => {
  const source = app.match(/function matchesCurrentMatchScope\(match\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);

  const context = {
    matchScope: 'open',
    isViewerMatch: () => false,
    isCancelledMatch: match => Boolean(match.cancelledAt)
  };
  const matchesCurrentMatchScope = vm.runInNewContext(
    `(${source.replace('function matchesCurrentMatchScope', 'function')})`,
    context
  );

  assert.equal(matchesCurrentMatchScope({ sieger: null, datum: '2026-09-20', uhrzeit: '18.00' }), true);
  assert.equal(matchesCurrentMatchScope({ sieger: null, cancelledAt: '2026-10-08T12:00:00Z' }), false);
  assert.equal(matchesCurrentMatchScope({ sieger: 1, datum: null, uhrzeit: null }), false);
});
