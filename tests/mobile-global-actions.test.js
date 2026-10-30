const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const liga = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const tipp = fs.readFileSync(path.join(root, 'tipp', 'index.html'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const actions = fs.readFileSync(path.join(root, 'js', 'global-actions.js'), 'utf8');
const account = fs.readFileSync(path.join(root, 'js', 'account.js'), 'utf8');
const liveTicker = fs.readFileSync(path.join(root, 'js', 'live-ticker.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');

test('Liga and PadelTipp share the accessible mobile global action shell', () => {
  [liga, tipp].forEach(page => {
    assert.match(page, /style\.css\?v=[^\"]+\"/);
    assert.match(page, /account\.css\?v=[^\"]+\"/);
    assert.match(page, /global-actions\.js[^>]*>/);
    assert.match(page, /class="context-actions global-actions"[^>]*data-global-actions/);
    assert.match(page, /data-global-actions-list/);
    assert.match(page, /data-global-actions-dismiss[^>]*aria-label="Schnellzugriffe schließen"/);
    assert.match(page, /data-global-actions-toggle[^>]*aria-expanded="false"[^>]*aria-controls="global-actions-list"/);
    assert.match(page, /data-global-actions-badge hidden/);
    assert.match(page, /data-auth-open/);
    assert.match(page, /id="season-picker"/);
    assert.match(page, /data-auth-open[\s\S]*class="auth-user-icon"[\s\S]*d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0"[\s\S]*class="auth-button-label">Login<\/span>/);
    assert.match(page, /data-season-toggle[\s\S]*class="season-picker-trophy"[\s\S]*viewBox="0 0 28 32"[\s\S]*class="season-picker-trophy-line"[\s\S]*id="season-picker-label"/);
  });

  assert.match(liga, /data-global-actions-list[\s\S]*data-live-open-active[\s\S]*id="external-game-link"[\s\S]*id="tipp-link"[\s\S]*id="season-picker"[\s\S]*data-auth-open/);
  assert.match(liga, /class="secondary-button secondary-button--with-icon global-action" id="tipp-link"[^>]*aria-label="PadelTipp öffnen"[\s\S]*<svg viewBox="0 0 24 24"[\s\S]*<span class="global-action-label">PadelTipp<\/span>/);
  assert.match(tipp, /data-global-actions-list[\s\S]*id="liga-link"[\s\S]*id="external-game-link"[\s\S]*id="season-picker"[\s\S]*data-auth-open/);
  assert.match(tipp, /id="liga-link"[^>]*>[\s\S]*<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"\/><\/svg>[\s\S]*<span>Zurück zur Liga<\/span>/);
  assert.doesNotMatch(tipp.match(/id="liga-link"[^>]*>[\s\S]*?<\/a>/)?.[0] || '', /<svg[^>]+class=/);
  assert.match(style, /\.secondary-button--icon svg,\s*\.global-actions \.text-link svg \{ width: 20px; height: 20px;/);
  assert.match(style, /\.global-actions \.text-link svg \{ display: none; \}[\s\S]*@media \(max-width: 768px\)[\s\S]*\.global-actions \.text-link svg \{ display: block; \}/);
});

test('the mobile speed dial stays separate from the local navigation', () => {
  assert.match(style, /@media \(max-width: 768px\)[\s\S]*\.context-actions\.global-actions\s*\{[\s\S]*position: fixed;/);
  assert.match(style, /\.global-actions-dismiss\s*\{[\s\S]*background: var\(--shadow-color\);[\s\S]*opacity: 0;[\s\S]*transition: opacity 160ms ease;/);
  assert.match(style, /\.global-actions\.open \.global-actions-dismiss\s*\{\s*opacity: 1;\s*pointer-events: auto;/);
  assert.match(style, /body:has\(dialog\[open\]\) \.context-actions\.global-actions\s*\{\s*display: none;/);
  assert.match(style, /\.global-actions \.season-menu\s*\{[\s\S]*right: calc\(100% \+ 8px\);/);
  assert.match(style, /\.global-actions-list\s*\{\s*display: contents;/);
  assert.match(style, /\.season-picker-trophy\s*\{[\s\S]*width: 20px;[\s\S]*height: 20px;/);
  assert.match(style, /\.season-picker-trophy-line\s*\{[\s\S]*stroke-width: 1\.65;[\s\S]*vector-effect: non-scaling-stroke;/);
  assert.doesNotMatch(style, /\.global-actions[^{}]*\{[^}]*\border\s*:/);
  assert.match(style, /\.global-actions \.auth-button\.global-action/);
  assert.match(style, /\.auth-button\.global-action:not\(\.is-authenticated\)\s*\{[\s\S]*background: var\(--accent\);[\s\S]*color: var\(--bg\);/);
  assert.match(style, /\.auth-button\.global-action\.is-authenticated\s*\{[\s\S]*background: var\(--surface\);[\s\S]*color: var\(--text\);/);
  assert.match(account, /class="auth-user-icon"[\s\S]*d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0"[\s\S]*auth-button-label">Login/);
  assert.doesNotMatch(`${liga}\n${tipp}\n${account}`, /auth-login-icon/);
  assert.doesNotMatch(liga, /<nav class="site-nav"[^>]*>[\s\S]*data-global-actions-toggle/);
});

test('LIVE wins the FAB state while account tasks remain independently visible', () => {
  assert.match(actions, /if \(hasLive\) \{[\s\S]*badge\.textContent = '1';[\s\S]*Ein Livespiel läuft/);
  assert.match(actions, /if \(hasAccountTasks\) \{[\s\S]*String\(accountTaskCount\)[\s\S]*Kontoaufgabe/);
  assert.match(style, /\.global-actions\.has-account-tasks:not\(\.has-live\) \.global-actions-toggle/);
  assert.match(style, /\.global-actions\.has-live \.global-actions-toggle/);
  assert.match(style, /\.global-actions\.open \.global-actions-toggle-badge\s*\{\s*display: none;/);
  assert.match(account, /PadelGlobalActions\?\.setAccountTaskCount\(taskCount\)/);
  assert.match(liveTicker, /PadelGlobalActions\?\.setLiveActive\(showGlobalLiveAction\)/);
});

test('outside click, Escape and viewport changes close the speed dial', () => {
  assert.match(actions, /data-global-actions-dismiss/);
  assert.match(actions, /event\.key !== 'Escape'/);
  assert.match(actions, /close\(openRoot, \{ restoreFocus: true \}\)/);
  assert.match(actions, /mobileViewport\.addEventListener\?\.\('change', syncViewport\)/);
  assert.match(actions, /toggleAttribute\('inert', !interactive\)/);
});

test('choosing a player closes the mobile dial and restores its button focus, while desktop keeps picker focus', () => {
  const selectViewerSource = app.slice(app.indexOf('function selectViewer(id)'), app.indexOf('function updateViewerProfileImage'));
  for (const mobile of [true, false]) {
    const calls = [];
    const picker = {
      classList: { contains: () => true },
      closest: () => mobile ? {} : null,
      querySelector: () => ({ focus: () => calls.push('picker-focus') })
    };
    const context = {
      document: { getElementById: () => picker },
      window: { PadelGlobalActions: { close: options => {
        assert.equal(options.restoreFocus, true);
        calls.push('dial-close');
      } } },
      selectedViewerId: 'previous',
      storeViewerId: id => calls.push(`store:${id}`),
      closeViewerMenu: () => calls.push('picker-close'),
      isParticipantView: () => true,
      updateViewerPicker: () => calls.push('picker-update'),
      updateChartViewerFocus() {},
      invalidateSections() {},
      renderActiveSection() {}
    };
    vm.runInNewContext(`${selectViewerSource}\nselectViewer('chosen');`, context);
    assert.equal(context.selectedViewerId, 'chosen');
    assert.deepEqual(calls, ['store:chosen', 'picker-close', 'picker-update', mobile ? 'dial-close' : 'picker-focus']);
  }
});
