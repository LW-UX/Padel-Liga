const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'mobile-dialog-pages.js'), 'utf8');

function setup({ search = '', mobile = true, pathname = '/' } = {}) {
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
  const stack = [{ state: { leagueSection: pathname.includes('infos') ? 'infos' : 'rechner' }, url: `https://liga.test${pathname}${search}` }];
  let index = 0;
  const history = {
    get state() { return stack[index].state; },
    get length() { return stack.length; },
    pushState(state, _, url = window.location.href) { stack.splice(index + 1); stack.push({ state, url }); index += 1; window.location = new URL(url); },
    replaceState(state, _, url = window.location.href) { stack[index] = { state, url }; window.location = new URL(url); },
    back() {
      index -= 1;
      window.location = new URL(stack[index].url);
      listeners.popstate();
    },
    forward() {
      index += 1;
      window.location = new URL(stack[index].url);
      listeners.popstate();
    }
  };
  function flush() {
    observers.forEach(callback => callback());
    while (timers.length) timers.shift()();
  }
  const window = {
    history,
    location: new URL(stack[0].url),
    scrollY: 420,
    PadelKonto: { openDialog() { nodes['auth-dialog'].open = true; } },
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
    URL,
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
  nodes['auth-dialog'].open = true;
  flush();
  assert.equal(entries(), 1);
  nodes['auth-dialog'].open = false;
  flush();
  assert.equal(entries(), 0);
});

test('Spielerprofile führen ihren Verlauf selbst und legen keine mobile Seite an', () => {
  const { nodes, flush, entries } = setup();
  nodes['player-profile-dialog'].open = true;
  flush();
  assert.equal(entries(), 0);
});

test('Ein aus dem Konto geöffnetes Profil übernimmt dessen Zurück-Schritt', () => {
  const { nodes, flush, history, entries } = setup();
  nodes['auth-dialog'].open = true;
  flush();
  assert.equal(entries(), 1);
  history.replaceState({ playerProfile: 'spieler-a', mobileDialogPage: null });
  nodes['auth-dialog'].open = false;
  flush();
  assert.equal(entries(), 1);
  assert.equal(history.state.playerProfile, 'spieler-a');
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

for (const mobile of [false, true]) {
  test(`Konto-URL behält den vorherigen Tab und Anker (${mobile ? 'mobil' : 'Desktop'})`, () => {
    const { window, nodes, flush, history, stack, entries } = setup({ mobile, pathname: '/infos/', search: '?saison=2026-sommer#platzbuchung' });
    const previousUrl = window.location.href;
    nodes['auth-dialog'].open = true;
    flush();
    assert.equal(entries(), 1);
    assert.equal(window.location.pathname, '/infos/');
    assert.equal(window.location.search, '?saison=2026-sommer&konto=1');
    assert.equal(window.location.hash, '#platzbuchung');
    assert.equal(stack[0].state.sectionScrollY, 420);
    nodes['auth-dialog'].close();
    assert.equal(entries(), 0);
    assert.equal(window.location.href, previousUrl);
    history.forward();
    flush();
    assert.equal(nodes['auth-dialog'].open, true);
    assert.equal(entries(), 1, 'Vorwärts öffnet denselben Eintrag');
    history.back();
    flush();
    assert.equal(nodes['auth-dialog'].open, false);
    assert.equal(window.location.href, previousUrl);
  });
}

test('Direkter Konto-Link erhält einen Rückweg auf denselben Tab ohne Konto', () => {
  const { window, nodes, flush, history, entries } = setup({ mobile: false, pathname: '/partien/', search: '?konto=1' });
  nodes['auth-dialog'].open = true;
  flush();
  assert.equal(entries(), 1);
  assert.equal(window.location.search, '?konto=1');
  history.back();
  flush();
  assert.equal(window.location.pathname, '/partien/');
  assert.equal(window.location.search, '');
  assert.equal(nodes['auth-dialog'].open, false);
});

test('Konto übernimmt den mobilen Neuigkeiten-Schritt und ergänzt die URL', () => {
  const { window, nodes, flush, entries } = setup();
  nodes['whats-new-dialog'].open = true;
  flush();
  nodes['whats-new-dialog'].open = false;
  nodes['auth-dialog'].open = true;
  flush();
  assert.equal(entries(), 1);
  assert.equal(window.location.search, '?konto=1');
});
