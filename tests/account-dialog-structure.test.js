const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
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
    assert.match(source, /<dialog class="auth-dialog"[^>]*>\s*<button class="modal-close-button auth-dialog-close"/);
  });
  assert.match(style, /\.modal-close-button \{[\s\S]*position: absolute;[\s\S]*top: \d+px;[\s\S]*right: \d+px;/);
  assert.match(style, /\.auth-dialog-card \{[\s\S]*max-height: inherit;[\s\S]*overflow: auto;/);
  assert.match(style, /html:has\(dialog\[open\]\),[\s\S]*body:has\(dialog\[open\]\)[\s\S]*overflow: hidden;[\s\S]*overscroll-behavior: none;/);
  assert.match(style, /\.player-profile-shell \{[\s\S]*overflow: auto;[\s\S]*overscroll-behavior: contain;/);
  assert.match(style, /\.auth-dialog-card \{[\s\S]*overflow: auto;[\s\S]*overscroll-behavior: contain;/);
});

test('both account dialogs have admin lists without the former result dropdown', () => {
  pages.forEach(source => {
    assert.doesNotMatch(source, /id="result-task-scope"/);
    assert.match(source, /id="admin-played-list"/);
    assert.match(source, /<details class="admin-all-matches" id="admin-all-matches" hidden>/);
    assert.doesNotMatch(source, /id="training-history"/);
  });
});
