const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'mobile-dialog-pages.js'), 'utf8');

function setup({ search = '', mobile = true } = {}) {
  const observers = [];
  const listeners = {};
  const timers = [];
  const dialog = () => ({
    open: false,
    close() { this.open = false; flush(); }
  });
  const nodes = {
    'auth-dialog': dialog(),
    'player-profile-dialog': dialog(),
    'whats-new-dialog': dialog(),
    'detail-view-dialog': { open: false }
  };
  const stack = [{ state: null }];
  let index = 0;
  const history = {
    get state() { return stack[index].state; },
    get length() { return stack.length; },
    pushState(state) { stack.splice(index + 1); stack.push({ state }); index += 1; },
    back() {
      index -= 1;
      listeners.popstate();
    }
  };
  function flush() {
    observers.forEach(callback => callback());
    while (timers.length) timers.shift()();
  }
  const window = {
    history,
    location: { search, href: `https://liga.test/${search}` },
    matchMedia: () => ({ matches: mobile }),
    addEventListener: (type, callback) => { listeners[type] = callback; },
    PadelLigaClosePlayerProfile() { nodes['player-profile-dialog'].open = false; }
  };
  vm.runInNewContext(source, {
    window,
    document: {
      documentElement: { classList: { contains: () => false } },
      getElementById: id => nodes[id] || null
    },
    MutationObserver: class {
      constructor(callback) { observers.push(callback); }
      observe() {}
    },
    URLSearchParams,
    setTimeout: callback => timers.push(callback)
  });
  return { window, nodes, flush, history, entries: () => index, stack };
}

test('Zurück-Geste schließt das mobile Konto und lässt die Seite offen', () => {
  const { nodes, flush, history, entries } = setup();
  nodes['auth-dialog'].open = true;
  flush();
  assert.equal(entries(), 1);
  history.back();
  flush();
  assert.equal(nodes['auth-dialog'].open, false);
  assert.equal(entries(), 0);
});

test('Zurück-Geste schließt auch „Was ist neu?“ und der Wechsel ins Konto bleibt ein Schritt', () => {
  const { nodes, flush, history, entries } = setup();
  nodes['whats-new-dialog'].open = true;
  flush();
  assert.equal(entries(), 1);
  history.back();
  flush();
  assert.equal(nodes['whats-new-dialog'].open, false);
  assert.equal(entries(), 0);

  nodes['whats-new-dialog'].open = true;
  flush();
  nodes['whats-new-dialog'].open = false;
  nodes['auth-dialog'].open = true;
  flush();
  assert.equal(entries(), 1);
});

test('Schließen per Button entfernt den Verlaufseintrag wieder', () => {
  const { nodes, flush, entries } = setup();
  nodes['player-profile-dialog'].open = true;
  flush();
  assert.equal(entries(), 1);
  nodes['player-profile-dialog'].open = false;
  flush();
  assert.equal(entries(), 0);
});

test('Der Wechsel vom Konto ins Profil bleibt ein einziger Zurück-Schritt', () => {
  const { nodes, flush, history, entries } = setup();
  nodes['auth-dialog'].open = true;
  flush();
  nodes['auth-dialog'].open = false;
  nodes['player-profile-dialog'].open = true;
  flush();
  assert.equal(entries(), 1);
  history.back();
  flush();
  assert.equal(nodes['player-profile-dialog'].open, false);
  assert.equal(entries(), 0);
});

test('Eine über dem Profil geöffnete Partie behält ihren eigenen Zurück-Schritt', () => {
  const { window, nodes, flush, history, entries } = setup();
  nodes['player-profile-dialog'].open = true;
  flush();
  window.PadelMatchStatistics = { active: true };
  history.pushState({ ...history.state, matchStatistics: 'partie' });
  nodes['player-profile-dialog'].open = false;
  flush();
  assert.equal(entries(), 2);
  window.PadelMatchStatistics.active = false;
  nodes['player-profile-dialog'].open = true;
  history.back();
  flush();
  assert.equal(nodes['player-profile-dialog'].open, true);
  assert.equal(entries(), 1);
});

test('Eine Partie aus dem Profil hinterlässt nach dem Schließen keinen toten Zurück-Schritt', () => {
  const { window, nodes, flush, history, entries } = setup();
  nodes['player-profile-dialog'].open = true;
  flush();
  window.PadelMatchStatistics = { active: true };
  history.pushState({ ...history.state, matchStatistics: 'partie' });
  nodes['player-profile-dialog'].open = false;
  flush();
  window.PadelMatchStatistics.active = false;
  history.back();
  flush();
  assert.equal(entries(), 0);
});

test('Die Zurück-Geste schließt auch den Detailrahmen der Tippseite, ohne dass der Eintrag zurückkehrt', () => {
  const { window, flush, history, entries } = setup();
  let frameOpen = true;
  window.PadelMobileDialogPages.register({ isOpen: () => frameOpen, close: () => { frameOpen = false; } });
  window.PadelMobileDialogPages.sync();
  assert.equal(entries(), 1);
  history.back();
  flush();
  assert.equal(frameOpen, false);
  assert.equal(entries(), 0);

  frameOpen = true;
  window.PadelMobileDialogPages.sync();
  assert.equal(entries(), 1);
  frameOpen = false;
  window.PadelMobileDialogPages.sync();
  flush();
  assert.equal(entries(), 0);
});

test('Profile über einer Partie, breite Ansichten und Einmal-Links erzeugen keinen Eintrag', () => {
  const overDetail = setup();
  overDetail.nodes['detail-view-dialog'].open = true;
  overDetail.nodes['player-profile-dialog'].open = true;
  overDetail.flush();
  assert.equal(overDetail.entries(), 0);

  const desktop = setup({ mobile: false });
  desktop.nodes['player-profile-dialog'].open = true;
  desktop.flush();
  assert.equal(desktop.entries(), 0);

  const authLink = setup({ search: '?auth=recovery' });
  authLink.nodes['auth-dialog'].open = true;
  authLink.flush();
  assert.equal(authLink.entries(), 0);
});
