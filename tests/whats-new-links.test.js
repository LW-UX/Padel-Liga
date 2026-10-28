const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'js', 'whats-new.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'whats-new.css'), 'utf8');

test('release-note feature icons and headings link to their corresponding targets', () => {
  for (const [target, heading] of [
    ['player-profile', 'Spielerprofil'],
    ['matches', 'Partievorschau &amp; Partierückschau'],
    ['account', 'Konto'],
    ['tipping', 'PadelTipp']
  ]) {
    const control = html.match(new RegExp(
      `<button class="whats-new-feature-link"[^>]*data-whats-new-target="${target}">[\\s\\S]*?<\\/button>`
    ))?.[0] || '';
    assert.match(control, /class="whats-new-feature-icon"/);
    assert.match(control, new RegExp(`<h3>${heading}<\\/h3>`));
  }

  assert.match(script, /target === 'matches'[\s\S]*getElementById\('partien-nav-button'\)\?\.click\(\)/);
  assert.match(script, /target === 'account'[\s\S]*getElementById\('auth-button'\)\?\.click\(\)/);
  assert.match(script, /target === 'tipping'[\s\S]*window\.location\.assign\(new URL\('tipp\/', document\.baseURI\)\)/);
  assert.match(script, /target === 'player-profile'[\s\S]*profileButton\.click\(\)[\s\S]*data-viewer-toggle/);
  assert.match(style, /\.whats-new-feature-link:focus-visible/);
});
