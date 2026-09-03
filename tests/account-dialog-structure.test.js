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
  assert.match(style, /\.auth-dialog \{[\s\S]*width: min\(calc\(100vw - 28px\), 640px\);/);
});

test('both account dialogs expose one four-group game overview', () => {
  pages.forEach(source => {
    assert.doesNotMatch(source, /id="result-task-scope"/);
    assert.doesNotMatch(source, /id="admin-played-list"/);
    assert.doesNotMatch(source, /Gespielte Spiele/);
    assert.doesNotMatch(source, /id="admin-all-matches"/);
    assert.doesNotMatch(source, /id="training-history"/);
    assert.match(source, /id="open-results-section"[\s\S]*data-training-toggle/);
    assert.match(source, /<h3 class="sh-title">Spieleübersicht<\/h3>/);
    assert.doesNotMatch(source, /<h3 class="sh-title">Trainingsspiele<\/h3>/);
    assert.doesNotMatch(source, /id="training-task-list"/);
    assert.match(source, /<button class="secondary-button"[^>]*data-auth-logout/);
    assert.match(source, /<button class="secondary-button"[^>]*data-training-toggle/);
    assert.match(source, /data-auth-logout>Ausloggen<\/button>/);
    assert.match(source, /data-training-toggle>Training hinzufügen<\/button>/);
    assert.doesNotMatch(source, /picker-toggle-chevron/);
    assert.doesNotMatch(source, /auth-logout-button|compact-button|account-task-count|result-task-count/);
    assert.doesNotMatch(source, /Ligaübergreifend|Saisonunabhängig/);
  });
  assert.match(pages[0], /<button type="button" class="secondary-button" data-calculator-reset>Zurücksetzen<\/button>/);
  assert.match(pages[0], /class="secondary-button secondary-button--dropdown"[^>]*data-season-toggle/);
  assert.match(pages[0], /class="secondary-button secondary-button--dropdown"[^>]*data-viewer-toggle/);
  assert.match(pages[1], /class="secondary-button secondary-button--dropdown"[^>]*data-season-toggle/);
  assert.match(style, /\.sh-title \{[^}]*font-size: 2rem;[^}]*font-weight: 400;/);
  assert.match(style, /\.secondary-button \{[\s\S]*font: 500 0\.78rem 'DM Mono', monospace;[\s\S]*background: var\(--surface\);/);
  assert.match(style, /\.secondary-button--dropdown \{[^}]*position: relative;[^}]*padding-right: 2\.1rem;/);
  assert.doesNotMatch(style, /\.picker-toggle/);
  assert.doesNotMatch(style, /\.calculator-reset-button/);
  assert.doesNotMatch(style, /\.prediction-group-title/);
  assert.doesNotMatch(style, /\.auth-logout-button|\.compact-button|\.account-task-count|\.account-task-league/);
  assert.doesNotMatch(style, /\.picker-toggle-chevron/);
  assert.match(style, /#result-task-list > \.prediction-match-group \{[\s\S]*border-top: 1px solid var\(--border\);[\s\S]*padding-top: 24px;/);
  assert.match(style, /\.account-task-card\.is-actionable \{[\s\S]*border-color: var\(--accent\);/);
  assert.match(style, /\.account-task-card\.is-waiting[\s\S]*opacity: 0\.58/);
  assert.match(style, /\.result-entry-actions \{[\s\S]*align-items: center;[\s\S]*justify-content: space-between;/);
  assert.doesNotMatch(style, /\.result-entry-actions \{[^}]*border-top:/);
});
