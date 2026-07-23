const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const pages = [
  fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
  fs.readFileSync(path.join(root, 'tipp', 'index.html'), 'utf8')
];

test('both account dialogs only expose games and place logout in the header', () => {
  pages.forEach(source => {
    assert.doesNotMatch(source, /class="account-tabs"/);
    assert.doesNotMatch(source, /account-settings-panel/);
    assert.doesNotMatch(source, /name="displayName"/);
    assert.match(source, /class="account-header"[\s\S]*data-auth-logout/);
  });
});

test('both account dialogs have admin lists without the former result dropdown', () => {
  pages.forEach(source => {
    assert.doesNotMatch(source, /id="result-task-scope"/);
    assert.match(source, /id="admin-played-list"/);
    assert.match(source, /<details class="admin-all-matches" id="admin-all-matches" hidden>/);
    assert.doesNotMatch(source, /id="training-history"/);
  });
});
