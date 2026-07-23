const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

test('result overview neither loads nor renders per-match Elo adjustments', () => {
  assert.doesNotMatch(appSource, /\.from\(['"]match_elo_changes['"]\)/);
  assert.doesNotMatch(appSource, /mc-elo-changes/);
  assert.doesNotMatch(styleSource, /mc-elo-changes/);
});
