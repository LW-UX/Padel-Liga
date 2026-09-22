const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const style = [
  fs.readFileSync(path.join(root, 'style.css'), 'utf8'),
  fs.readFileSync(path.join(root, 'account.css'), 'utf8')
].join('\n');
const accountScript = fs.readFileSync(path.join(root, 'js', 'account.js'), 'utf8');
const tippspielScript = fs.readFileSync(path.join(root, 'js', 'tippspiel.js'), 'utf8');
const appScript = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const ligaPage = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const tippspielPage = fs.readFileSync(path.join(root, 'tipp', 'index.html'), 'utf8');
const pages = [ligaPage, tippspielPage];

test('pages keep their intended context links and account dialogs place logout in the header', () => {
  assert.match(ligaPage, /class="context-actions"[\s\S]*data-season-toggle[\s\S]*data-auth-open/);
  assert.doesNotMatch(ligaPage, /id="tippspiel-link"/);
  assert.match(tippspielPage, /class="context-actions"[\s\S]*id="liga-link"[\s\S]*data-season-toggle[\s\S]*data-auth-open/);

  pages.forEach(source => {
    assert.doesNotMatch(source, /<span>Saison<\/span>/);
    assert.doesNotMatch(source, /class="account-tabs"/);
    assert.doesNotMatch(source, /account-settings-panel/);
    assert.doesNotMatch(source, /name="displayName"/);
    assert.match(source, /class="account-header"[\s\S]*data-account-player-profile[\s\S]*data-auth-logout/);
    assert.match(source, /<dialog class="auth-dialog"[^>]*>\s*<button class="modal-close-button auth-dialog-close"/);
  });
  assert.match(style, /\.modal-close-button \{[\s\S]*position: absolute;[\s\S]*top: \d+px;[\s\S]*right: \d+px;/);
  assert.match(style, /\.auth-dialog-card \{[\s\S]*max-height: inherit;[\s\S]*overflow: auto;/);
  assert.match(style, /html:has\(dialog\[open\]\),[\s\S]*body:has\(dialog\[open\]\)[\s\S]*overflow: hidden;[\s\S]*overscroll-behavior: none;/);
  assert.match(style, /\.player-profile-shell \{[\s\S]*overflow: auto;[\s\S]*overscroll-behavior: contain;/);
  assert.match(style, /\.auth-dialog-card \{[\s\S]*overflow: auto;[\s\S]*overscroll-behavior: contain;/);
  assert.match(style, /\.auth-dialog \{[\s\S]*width: min\(calc\(100vw - 16px\), 640px\);/);
});

test('account behavior and styles stay independent from the optional prediction module', () => {
  pages.forEach(source => {
    assert.match(source, /account\.css[^>]*>[\s\S]*js\/account\.js[^>]*>[\s\S]*js\/tippspiel\.js/);
  });
  assert.match(accountScript, /window\.PadelKonto = \{/);
  assert.match(accountScript, /function handleAuthSubmit/);
  assert.match(accountScript, /function renderResultTasks/);
  assert.match(accountScript, /function handleTrainingSubmit/);
  assert.match(accountScript, /function getTrainingTaskTimestamp/);
  assert.doesNotMatch(accountScript, /getMatchTimestamp/);
  assert.doesNotMatch(tippspielScript, /function handleAuthSubmit|function renderResultTasks|function handleTrainingSubmit/);
  assert.match(tippspielScript, /window\.PadelKonto\?\.getSession/);
  assert.match(appScript, /renderInfos\(\);\s*\} catch \(error\)[\s\S]*return;[\s\S]*await window\.PadelKonto\?\.init\(\)/);
  assert.match(accountScript, /initialize\(\)\.catch\(error =>/);
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
    assert.match(source, /<button class="secondary-button"[^>]*data-account-player-profile hidden>Spielerprofil<\/button>/);
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
  assert.match(pages[0], /data-viewer-search role="combobox"[^>]*aria-label="Spieler suchen"/);
  assert.match(pages[0], /id="viewer-profile-image"[^>]*alt=""[^>]*hidden/);
  assert.match(pages[0], /id="viewer-profile-emoji"[^>]*aria-hidden="true">👤<\/span>/);
  assert.match(appScript, /function filterViewerOptions\(query = ''\)/);
  assert.match(appScript, /function updateViewerProfileImage\(playerId = '', profileEmoji = '👤'\)/);
  assert.match(appScript, /assets\/players\/\$\{encodeURIComponent\(playerId\)\}\/profile\.webp/);
  assert.match(appScript, /searchInput\.setAttribute\('aria-expanded', 'false'\);\s*searchInput\.blur\(\);/);
  assert.match(appScript, /data-viewer-search-text="\$\{escapeHtml\(option\.name\)\}/);
  assert.match(accountScript, /searchInput\.setAttribute\('aria-expanded', 'false'\);\s*searchInput\.blur\(\);/);
  assert.match(pages[1], /class="secondary-button secondary-button--dropdown"[^>]*data-season-toggle/);
  assert.match(style, /\.sh-title \{[^}]*font-size: 2rem;[^}]*font-weight: 400;/);
  assert.match(style, /\.secondary-button \{[\s\S]*font-family: 'DM Sans', sans-serif;[\s\S]*font-size: 0\.78rem;[\s\S]*font-weight: 500;/);
  assert.match(style, /\.secondary-button--dropdown \{[^}]*position: relative;[^}]*padding-right: 1\.8rem;/);
  assert.doesNotMatch(style, /\.picker-toggle/);
  assert.doesNotMatch(style, /\.calculator-reset-button/);
  assert.doesNotMatch(style, /\.prediction-group-title/);
  assert.doesNotMatch(style, /\.auth-logout-button|\.compact-button|\.account-task-count|\.account-task-league/);
  assert.doesNotMatch(style, /\.picker-toggle-chevron/);
  assert.match(accountScript, /playerProfileButton\.hidden = !isPlayerAccount\(\)/);
  assert.match(accountScript, /closeAuthDialog\(\);[\s\S]*window\.PadelLigaOpenPlayerProfile\(playerId, document\.querySelector\('\[data-auth-open\]'\)\)/);
  assert.match(accountScript, /searchParams\.set\('spielerprofil', playerId\)/);
  assert.match(appScript, /window\.PadelLigaOpenPlayerProfile = openPlayerProfile/);
  assert.match(appScript, /searchParams\.get\('spielerprofil'\)[\s\S]*openPlayerProfile\(requestedPlayerProfile\)/);
  assert.match(style, /#result-task-list > \.account-task-group \{[\s\S]*border-top: 1px solid var\(--border\);[\s\S]*padding-top: 18px;/);
  assert.match(style, /\.account-task-card\.is-actionable \{[\s\S]*border-color: var\(--accent\);/);
  assert.match(style, /\.account-task-card\.is-waiting[\s\S]*opacity: 0\.58/);
  assert.match(style, /\.result-entry-actions \{[\s\S]*align-items: center;[\s\S]*justify-content: space-between;/);
  assert.match(style, /\.result-entry-summary \{[^}]*line-height: 1\.35;[^}]*overflow-wrap: anywhere;/);
  assert.match(style, /\.result-entry-form :where\(input, select\),[\s\S]*\.training-form :where\(input, select\) \{/);
  assert.doesNotMatch(style, /\.training-form input,\s*\.training-form select \{/);
  assert.doesNotMatch(style, /\.result-entry-actions \{[^}]*border-top:/);
});
