const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/name-nowrap.js'), 'utf8');
const window = {};
vm.runInNewContext(source, { window, document: {} });
const { protect } = window.PadelNameWrap;

test('Vorname und Nachnamenkürzel stehen mit geschütztem Leerzeichen zusammen', () => {
  assert.equal(protect('gegen Christoph L. & Luca W.'), 'gegen Christoph L. & Luca W.');
  assert.equal(protect('Ludwig W. / Florian Z.'), 'Ludwig W. / Florian Z.');
  assert.equal(protect('Anna-Lena K., Jörg Ö.'), 'Anna-Lena K., Jörg Ö.');
});

test('Übrige Texte, Abkürzungen und Namen ohne Kürzel bleiben unverändert', () => {
  for (const text of ['z. B. morgen', 'Test Gmail', 'Partie 1 · Winter 2026', 'Lucky Star Padel', 'Luca Wagner']) {
    assert.equal(protect(text), text);
  }
});
