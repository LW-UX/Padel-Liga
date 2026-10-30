const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { renderPlayerProfileRowAttributes, renderDiffValue } = require('../js/table-core.js');
const { render } = require('../js/match-statistics.js');
const fixture = require('./fixtures/match-statistics.cjs');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('a player row only becomes a profile link with a known player', () => {
  assert.equal(renderPlayerProfileRowAttributes({ id: 'luca_w', name: 'Luca W.' }), ' data-player-profile-id="luca_w" tabindex="0" role="link" aria-label="Profil von Luca W. öffnen"');
  assert.equal(renderPlayerProfileRowAttributes({ id: 'a"b', name: '<b>' }), ' data-player-profile-id="a&quot;b" tabindex="0" role="link" aria-label="Profil von &lt;b&gt; öffnen"');
  assert.equal(renderPlayerProfileRowAttributes({ id: '', name: 'Gast' }), '');
  assert.equal(renderPlayerProfileRowAttributes({ id: 'luca_w' }), '');
});

test('the difference column signs only non-zero values and keeps its empty state', () => {
  assert.equal(renderDiffValue(4), '<span class="pos">+4</span>');
  assert.equal(renderDiffValue(-4), '<span class="neg">-4</span>');
  assert.equal(renderDiffValue(0), '<span class="neu">0</span>');
  assert.equal(renderDiffValue(5, { played: false }), '<span class="neu">—</span>');
});

test('every player ranking opens the profile through the whole row', () => {
  const app = read('js/app.js');
  assert.match(read('js/live-ticker.js'), /<tr class="r\$\{index \+ 1\}"\$\{window\.PadelTable\.renderPlayerProfileRowAttributes\(/);
  const html = render(fixture());
  assert.match(html, /<tr class="match-statistics-ranking-player[^"]*" data-player-profile-id="[^"]+" tabindex="0" role="link"/);
  assert.doesNotMatch(`${app}\n${read('style.css')}`, /data-profile-player-id/);
});

test('row behavior is not tied to a list of individual tables', () => {
  const style = read('style.css');
  assert.match(style, /table\.rt tbody tr\[data-player-profile-id\] \{ cursor: pointer; \}/);
  assert.match(style, /table\.rt tbody tr\[data-player-profile-id\]:hover td \.player-profile-link \{ color: var\(--accent\); \}/);
  assert.doesNotMatch(style, /:is\(#ranking-table, #all-time-ranking-table, /);
  assert.doesNotMatch(`${style}\n${read('index.html')}\n${read('js/live-ticker.js')}`, /calculator-ranking-table|final-four-table|live-overview-table/);
});

test('both pages load the shared table script before the scripts using it', () => {
  for (const [file, later] of [['index.html', 'js/live-ticker.js'], ['tipp/index.html', '../js/tipp-page.js']]) {
    const page = read(file);
    assert.ok(page.includes('js/table-core.js?v='), file);
    assert.ok(page.indexOf('js/table-core.js?v=') < page.indexOf(later), file);
  }
});
