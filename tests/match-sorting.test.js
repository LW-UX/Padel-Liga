const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

test('match overview defaults to matchdays and exposes date sorting in the ranking position', () => {
  assert.match(html, /id="match-sort-toggle"[\s\S]*class="active" data-match-sort="matchday">Spieltage/);
  assert.match(html, /data-match-sort="date">Datum/);
  assert.match(app, /let matchSortMode = 'matchday'/);
  assert.match(app, /matchSortMode = 'matchday';[\s\S]*rankingSortMode = 'points'/);
  assert.match(app, /matchSortMode === 'date'[\s\S]*renderPartienByDate\(visibleMatches\)/);
});

test('date sorting places matches without a complete date and time last', () => {
  const source = app.match(/function compareMatchesBySchedule\(a, b\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);

  const context = {
    hasScheduledDateTime: match => Boolean(match.datum && match.uhrzeit),
    compareMatchesByNumber: (a, b) => a.nr - b.nr,
    compareMatchesByDateTime: (a, b) => `${a.datum}T${a.uhrzeit}`.localeCompare(`${b.datum}T${b.uhrzeit}`)
  };
  const compareMatchesBySchedule = vm.runInNewContext(
    `(${source.replace('function compareMatchesBySchedule', 'function')})`,
    context
  );
  const matches = [
    { id: 'open-final', nr: 1, spieltag: 8, datum: null, uhrzeit: null },
    { id: 'later', nr: 2, datum: '2026-06-02', uhrzeit: '09.00' },
    { id: 'open-league', nr: 10, spieltag: 3, datum: '2026-05-01', uhrzeit: null },
    { id: 'earlier', nr: 1, datum: '2026-06-01', uhrzeit: '18.00' }
  ];

  assert.deepEqual(
    matches.sort(compareMatchesBySchedule).map(match => match.id),
    ['earlier', 'later', 'open-league', 'open-final']
  );
  assert.match(app, /if \(matchScope === 'open'\) return !hasScheduledDateTime\(match\)/);
  assert.match(app, /return hasScheduledDateTime\(match\) \? 'Terminiert' : 'Ausstehend'/);
});
