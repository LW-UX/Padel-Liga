const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { getCrop, getOutputSize, PROFILE_SIZE, THUMB_SIZE } = require('../js/profile-image-editor.js');
const playerImages = require('../js/player-images.js');

const root = path.join(__dirname, '..');

test('der Zuschnitt bleibt quadratisch und verlässt das Bild nie', () => {
  assert.deepEqual(getCrop(1200, 800, 1), { zoom: 1, side: 800, centerX: 600, centerY: 400, left: 200, top: 0 });
  const zoomed = getCrop(1200, 800, 2, 0, 10000);
  assert.equal(zoomed.side, 400);
  assert.equal(zoomed.left, 0);
  assert.equal(zoomed.top, 400);
  assert.equal(getCrop(1200, 800, 99).zoom, 4);
  assert.equal(getCrop(1200, 800, 0.2).zoom, 1);
});

test('gespeichert werden höchstens 600 und 64 Pixel ohne Hochskalieren', () => {
  assert.equal(PROFILE_SIZE, 600);
  assert.equal(THUMB_SIZE, 64);
  assert.equal(getOutputSize(1800, PROFILE_SIZE), 600);
  assert.equal(getOutputSize(431.7, PROFILE_SIZE), 431);
  assert.equal(getOutputSize(431.7, THUMB_SIZE), 64);
  assert.equal(getOutputSize(40, THUMB_SIZE), 40);
});

test('ohne gespeicherte Bildversion erscheint direkt das Emoji', () => {
  assert.equal(playerImages.url('luca_w'), '');
  assert.equal(playerImages.attributes('luca_w'), 'data-player-image="luca_w" data-player-image-variant="profile" hidden');
  assert.equal(playerImages.fallbackAttribute('luca_w'), '');
});

test('Profilbilder werden nur noch aus dem Bildspeicher geladen', () => {
  assert.equal(fs.existsSync(path.join(root, 'assets/players')), false);
  for (const file of ['js/app.js', 'js/live-ticker.js', 'js/match-statistics.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /assets\/players/);
  }
});
