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
const tippPageScript = fs.readFileSync(path.join(root, 'js', 'tipp-page.js'), 'utf8');
const appScript = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const ligaPage = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const tippspielPage = fs.readFileSync(path.join(root, 'tipp', 'index.html'), 'utf8');
const pages = [ligaPage, tippspielPage];

test('pages keep their intended context links and account dialogs group private actions in settings', () => {
  assert.match(ligaPage, /class="context-actions global-actions"[\s\S]*data-season-toggle[\s\S]*data-auth-open/);
  assert.doesNotMatch(ligaPage, /id="tippspiel-link"/);
  assert.match(tippspielPage, /class="context-actions global-actions"[\s\S]*id="liga-link"[\s\S]*data-season-toggle[\s\S]*data-auth-open/);

  pages.forEach(source => {
    assert.doesNotMatch(source, /<span>Saison<\/span>/);
    assert.doesNotMatch(source, /class="account-tabs"/);
    assert.doesNotMatch(source, /name="displayName"/);
    assert.match(source, /class="account-header"[\s\S]*data-account-player-profile[\s\S]*data-account-settings/);
    const settingsButton = source.match(/<button class="secondary-button account-settings-button"[^>]*>[\s\S]*?<\/button>/)?.[0] || '';
    assert.doesNotMatch(settingsButton, /<svg\b/);
    assert.match(settingsButton, /<span>Einstellungen<\/span>/);
    assert.match(source, /data-account-settings-panel hidden[\s\S]*data-password-change[\s\S]*data-auth-logout/);
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
  assert.match(ligaPage, /account\.css[^>]*>[\s\S]*js\/account\.js/);
  assert.doesNotMatch(ligaPage, /js\/tippspiel\.js/);
  assert.doesNotMatch(appScript, /PadelTippspiel/);
  assert.match(tippspielPage, /account\.css[^>]*>[\s\S]*js\/account\.js[^>]*>[\s\S]*js\/tipp-page\.js/);
  assert.doesNotMatch(tippspielPage, /<script[^>]+js\/tippspiel\.js/);
  assert.match(tippPageScript, /const accountReady = window\.PadelKonto\.init\(\);[\s\S]*loadScript\('\.\.\/js\/tippspiel\.js[\s\S]*PadelTippspiel\.init\(season, \{ accountReady \}\)/);
  assert.match(accountScript, /window\.PadelKonto = \{/);
  assert.match(accountScript, /function handleAuthSubmit/);
  assert.match(accountScript, /function renderResultTasks/);
  assert.match(accountScript, /function handleTrainingSubmit/);
  assert.match(accountScript, /function getTrainingTaskTimestamp/);
  assert.doesNotMatch(accountScript, /getMatchTimestamp/);
  assert.doesNotMatch(tippspielScript, /function handleAuthSubmit|function renderResultTasks|function handleTrainingSubmit/);
  assert.match(tippspielScript, /window\.PadelKonto\?\.getSession/);
  assert.match(appScript, /renderActiveSection\(\);\s*\} catch \(error\)[\s\S]*return;[\s\S]*await window\.PadelKonto\?\.init\(\)/);
  assert.match(accountScript, /initialize\(\)\.catch\(error =>/);
});

test('directly linked public dialogs open before account initialization', () => {
  const initApp = appScript.match(/async function initApp\(\) \{[\s\S]*?(?=\n\}\n\nconst mobileViewportQuery)/)?.[0] || '';
  const statisticsOpen = initApp.indexOf('PadelMatchStatistics?.open');
  const liveOpen = initApp.indexOf('openLiveTicker(requestedLiveMatch');
  const profileOpen = initApp.indexOf('openPlayerProfile(requestedPlayerProfile)');
  const accountInit = initApp.indexOf('PadelKonto?.init');

  assert.ok(statisticsOpen >= 0 && statisticsOpen < accountInit);
  assert.ok(liveOpen >= 0 && liveOpen < accountInit);
  assert.ok(profileOpen >= 0 && profileOpen < accountInit);
});

test('both account dialogs expose one four-group game overview', () => {
  pages.forEach(source => {
    assert.doesNotMatch(source, /id="result-task-scope"/);
    assert.doesNotMatch(source, /id="admin-played-list"/);
    assert.doesNotMatch(source, /Gespielte Spiele/);
    assert.doesNotMatch(source, /id="admin-all-matches"/);
    assert.doesNotMatch(source, /id="training-history"/);
    assert.match(source, /id="open-results-section"[\s\S]*data-training-toggle/);
    assert.match(source, /<h3 class="sh-title sh-title-with-help">Partienübersicht[\s\S]*?id="account-games-help"[\s\S]*?<\/h3>/);
    assert.match(source, /class="match-scope-toggle account-result-scope-toggle"[^>]*data-account-result-scope-toggle hidden/);
    assert.match(source, /data-account-result-scope="relevant"[^>]*>Relevant<\/button>/);
    assert.match(source, /data-account-result-scope="all"[^>]*>Alle<\/button>/);
    assert.doesNotMatch(source, /<h3 class="sh-title">Trainingsspiele<\/h3>/);
    assert.doesNotMatch(source, /id="training-task-list"/);
    assert.match(source, /<button class="secondary-button account-settings-button"[^>]*data-account-settings/);
    assert.match(source, /<button class="secondary-button"[^>]*data-account-player-profile hidden>Spielerprofil<\/button>/);
    assert.match(source, /<button class="secondary-button"[^>]*data-training-toggle/);
    assert.match(source, /data-auth-logout>Ausloggen<\/button>/);
    assert.match(source, /data-email-notification="resultEntry"/);
    assert.match(source, /data-email-notification="resultConfirmation"/);
    assert.match(source, /data-email-notification="predictionReminder"/);
    assert.match(source, /data-training-toggle>Training hinzufügen<\/button>/);
    assert.match(source, /<div data-training-form-group hidden>[\s\S]*?<div class="spieltag-label">[\s\S]*?Training[\s\S]*?<form class="training-form" id="training-form" hidden>/);
    assert.doesNotMatch(source, /picker-toggle-chevron/);
    assert.doesNotMatch(source, /auth-logout-button|compact-button|account-task-count|result-task-count/);
    assert.doesNotMatch(source, /Ligaübergreifend|Saisonunabhängig/);
  });
  assert.match(pages[0], /<button type="button" class="secondary-button" data-calculator-reset>Zurücksetzen<\/button>/);
  assert.match(pages[0], /class="secondary-button secondary-button--dropdown global-action"[^>]*data-season-toggle/);
  assert.match(pages[0], /class="secondary-button secondary-button--dropdown"[^>]*data-viewer-toggle/);
  assert.match(pages[0], /data-viewer-search role="combobox"[^>]*aria-label="Spieler suchen"[^>]*disabled/);
  assert.match(pages[0], /id="viewer-profile-image"[^>]*alt=""[^>]*hidden/);
  assert.match(pages[0], /id="viewer-profile-emoji"[^>]*aria-hidden="true">👤<\/span>/);
  assert.match(appScript, /function filterViewerOptions\(query = ''\)/);
  assert.match(appScript, /filterViewerOptions\(\);\s*searchInput\.focus\(\{ preventScroll: true \}\);/);
  assert.match(appScript, /function keepViewerSearchVisible\(searchInput\)[\s\S]*targetOffset = Math\.min\(200,[\s\S]*window\.setTimeout\(alignInput, 350\)/);
  assert.match(appScript, /searchInput\.focus\(\{ preventScroll: true \}\);\s*keepViewerSearchVisible\(searchInput\);/);
  assert.match(appScript, /function updateViewerProfileImage\(playerId = '', profileEmoji = '👤'\)/);
  assert.match(appScript, /assets\/players\/\$\{encodeURIComponent\(playerId\)\}\/profile\.webp/);
  assert.match(appScript, /searchInput\.setAttribute\('aria-expanded', 'false'\);\s*searchInput\.blur\(\);\s*searchInput\.disabled = true;/);
  assert.match(appScript, /data-viewer-search-text="\$\{escapeHtml\(option\.name\)\}/);
  assert.match(accountScript, /searchInput\.setAttribute\('aria-expanded', 'false'\);\s*searchInput\.blur\(\);\s*searchInput\.disabled = true;/);
  assert.match(accountScript, /filterTrainingPlayerOptions\(picker\);\s*searchInput\.focus\(\{ preventScroll: true \}\);/);
  assert.match(accountScript, /function keepTrainingPickerSearchVisible\(searchInput\)[\s\S]*targetOffset = Math\.min\(200,[\s\S]*window\.setTimeout\(alignInput, 350\)/);
  assert.match(accountScript, /searchInput\.focus\(\{ preventScroll: true \}\);\s*keepTrainingPickerSearchVisible\(searchInput\);/);
  assert.match(pages[1], /class="secondary-button secondary-button--dropdown global-action"[^>]*data-season-toggle/);
  assert.match(style, /\.sh-title \{[^}]*font-size: var\(--text-heading\);[^}]*font-weight: 400;/);
  assert.match(style, /\.secondary-button \{[\s\S]*font-family: var\(--font-body\);[\s\S]*font-size: 0\.78rem;[\s\S]*font-weight: 500;/);
  assert.match(style, /\.secondary-button--dropdown \{[^}]*position: relative;[^}]*padding-right: 1\.8rem;/);
  assert.doesNotMatch(style, /\.picker-toggle/);
  assert.doesNotMatch(style, /\.calculator-reset-button/);
  assert.doesNotMatch(style, /\.prediction-group-title/);
  assert.doesNotMatch(style, /\.auth-logout-button|\.compact-button|\.account-task-count|\.account-task-league/);
  assert.doesNotMatch(style, /\.picker-toggle-chevron/);
  assert.match(accountScript, /playerProfileButton\.hidden = !isPlayerAccount\(\)/);
  assert.match(accountScript, /get_my_email_notification_preferences/);
  assert.match(accountScript, /update_my_email_notification_preferences/);
  assert.match(accountScript, /resultScopeToggle\.hidden = state\.profile\?\.app_role !== 'admin'/);
  assert.match(accountScript, /state\.resultTaskScope = resultScopeButton\.dataset\.accountResultScope === 'all' \? 'all' : 'relevant'/);
  assert.match(accountScript, /form\.closest\('\[data-training-form-group\]'\)[\s\S]*formGroup\.hidden = !opening/);
  assert.match(accountScript, /closeAuthDialog\(\);[\s\S]*window\.PadelLigaOpenPlayerProfile\(playerId, document\.querySelector\('\[data-auth-open\]'\)\)/);
  assert.match(accountScript, /searchParams\.set\('spielerprofil', playerId\)/);
  assert.match(appScript, /window\.PadelLigaOpenPlayerProfile = openPlayerProfile/);
  assert.match(appScript, /searchParams\.get\('spielerprofil'\)[\s\S]*openPlayerProfile\(requestedPlayerProfile\)/);
  assert.match(style, /#result-task-list > \.account-task-group \{\s*margin-top: 2rem;\s*\}/);
  assert.match(style, /\.account-task-card\.is-actionable \{[\s\S]*border-color: var\(--accent\);/);
  assert.match(style, /\.account-task-card\.is-waiting[\s\S]*opacity: 0\.58/);
  assert.match(style, /\.result-entry-actions \{[\s\S]*align-items: center;[\s\S]*justify-content: space-between;/);
  assert.match(style, /\.result-entry-summary \{[^}]*line-height: 1\.35;[^}]*overflow-wrap: anywhere;/);
  assert.match(style, /\.result-entry-form :where\(input, select\),[\s\S]*\.training-form :where\(input, select\) \{/);
  assert.match(style, /\.training-form :where\(input, select\) \{[\s\S]*min-width: 0;[\s\S]*max-width: 100%;/);
  assert.match(style, /input:is\(\[type="date"\], \[type="time"\]\) \{[^}]*display: block;[^}]*width: auto;[^}]*min-inline-size: 0;[^}]*max-inline-size: 100%;[^}]*text-align: left;/);
  assert.match(style, /\.training-form-meta \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(style, /\.result-entry-timing \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(style, /:where\(\.result-entry-form, \.match-schedule-form, \.training-form\) input:is\(\[type="date"\], \[type="time"\]\) \{[^}]*-webkit-appearance: none;[^}]*width: auto;[^}]*inline-size: auto;[^}]*min-inline-size: 0;[^}]*max-inline-size: 100%;[^}]*align-self: flex-start;[^}]*justify-self: start;/);
  assert.doesNotMatch(style, /input\[type="date"\] \{[^}]*background-image:/);
  assert.doesNotMatch(style, /input\[type="time"\] \{[^}]*background-image:/);
  assert.doesNotMatch(style, /::-webkit-calendar-picker-indicator \{[^}]*opacity: 0;/);
  assert.doesNotMatch(style, /\.training-form input,\s*\.training-form select \{/);
  assert.doesNotMatch(style, /\.result-entry-actions \{[^}]*border-top:/);
});

test('date and time hints are dimmed while Safari and iOS receive controlled text', () => {
  pages.forEach(source => {
    assert.match(source, /class="datetime-input-shell is-empty" data-datetime-field data-datetime-hint="TT\.MM\.JJJJ"><input type="date"/);
    assert.match(source, /class="datetime-input-shell is-empty" data-datetime-field data-datetime-hint="--:--"><input type="time"/);
  });
  assert.match(accountScript, /const isIosWebKit = [\s\S]*const isDesktopSafari = [\s\S]*classList\?\.toggle\('has-controlled-datetime-hints', isIosWebKit \|\| isDesktopSafari\)/);
  assert.match(accountScript, /function syncDateTimeHint\(input\)[\s\S]*classList\.toggle\('is-empty', !input\.value\)/);
  assert.match(accountScript, /data-datetime-hint="TT\.MM\.JJJJ"><input type="date" name="(?:playedOn|scheduledDate)"/);
  assert.match(accountScript, /data-datetime-hint="--:--"><input type="time" name="(?:playedTime|scheduledTime|displayTime)"/);
  assert.match(accountScript, /document\.addEventListener\('input', event => \{\s*syncDateTimeHint\(event\.target\)/);
  assert.match(accountScript, /document\.addEventListener\('change', event => \{\s*syncDateTimeHint\(event\.target\)/);
  assert.match(accountScript, /form\.reset\(\);\s*syncDateTimeHints\(form\);/);
  assert.match(style, /\.datetime-input-shell \{ display: contents; \}/);
  assert.match(style, /\.datetime-input-shell\.is-empty input \{ color: var\(--dim\); \}/);
  assert.match(style, /\.has-controlled-datetime-hints \.datetime-input-shell::after \{[^}]*color: var\(--dim\);[^}]*opacity: 0;/);
  assert.match(style, /\.datetime-input-shell\.is-empty:not\(:focus-within\)::after \{ opacity: 1; \}/);
  assert.match(style, /\.datetime-input-shell\.is-empty:not\(:focus-within\) input \{[^}]*color: transparent;[^}]*-webkit-text-fill-color: transparent;/);
});
