const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const tipPage = fs.readFileSync(path.join(root, 'js', 'tipp-page.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');

test('closing an embedded detail removes its full-screen frame', () => {
  assert.match(tipPage, /const returnFocus = ligaDetailFrame\.returnFocus;[\s\S]*frame\.remove\(\);[\s\S]*ligaDetailFrame\.element = null;[\s\S]*ligaDetailFrame\.ready = false;/);
  assert.match(app, /if \(isDetailEmbed\) postToDetailEmbedParent\(\{ type: 'padel:detail-closed' \}\);[\s\S]*PadelMatchStatistics\.close\(\);/);
  assert.match(app, /dialog\.addEventListener\('close', reportDetailEmbedState\);/);
});

test('file URLs exchange detail messages through their opaque origin', () => {
  assert.match(tipPage, /window\.location\.protocol === 'file:' \? '\*' : window\.location\.origin/);
  assert.match(tipPage, /window\.location\.protocol === 'file:'[\s\S]*event\.origin === 'null'/);
  assert.match(app, /const targetOrigin = window\.location\.protocol === 'file:' \? '\*' : window\.location\.origin;/);
  assert.match(app, /const validOrigin = window\.location\.protocol === 'file:'[\s\S]*event\.origin === 'null'/);
});

test('an embedded profile replaces the match and synchronizes panel or full-screen presentation', () => {
  assert.match(tipPage, /activeView: null/);
  assert.match(tipPage, /type === 'padel:detail-active-view'[\s\S]*?activeView = event\.data\.view === 'profile'/);
  assert.match(tipPage, /type === 'padel:detail-presentation'[\s\S]*?event\.data\.view[\s\S]*?applyLigaDetailFramePresentation/);
  assert.match(tipPage, /activeView === 'profile'[\s\S]*?Spielerprofil als Seitenpanel geöffnet/);
  assert.match(app, /window\.PadelMatchStatistics\?\.syncProfilePresentation\?\.\(presentation/);
});
