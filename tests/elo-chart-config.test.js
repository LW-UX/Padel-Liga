const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

test('Elo history chart starts at 500 and is 620 pixels high', () => {
  assert.match(appSource, /min:\s*500,\s*max:\s*1250/);
  assert.match(styleSource, /\.chart-wrap\s*\{[^}]*height:\s*620px;/);
});

test('Elo history points are smaller for non-active players', () => {
  assert.match(
    appSource,
    /function getEloChartPointRadius\(playerName\)\s*\{\s*return isParticipantView\(\) && getSelectedViewer\(\)\.name !== playerName \? 2 : 4;\s*\}/
  );
  assert.match(appSource, /pointRadius:\s*getEloChartPointRadius\(p\.name\)/);
  assert.match(appSource, /dataset\.pointRadius = getEloChartPointRadius\(player\.name\)/);
});
