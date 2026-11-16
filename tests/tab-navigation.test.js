const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

function navigation() {
  function element(id) {
    const classes = new Set(id === 'rechner' ? ['active'] : []);
    return { id, hidden: false, dataset: { section: id }, classList: {
      add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name)
    }, setAttribute() {}, removeAttribute() {} };
  }
  const sections = ['start', 'rangliste', 'rechner', 'infos'].map(element);
  const links = sections.map(section => element(section.id));
  const entries = [{ state: { leagueSection: 'rechner' }, url: new URL('https://padelliga.envidual.com/rechner/') }];
  let cursor = 0;
  const window = {
    location: entries[0].url, scrollY: 430, PADEL_SEASONS: [],
    history: {
      get state() { return entries[cursor].state; },
      replaceState(state, _, url) { entries[cursor] = { state, url: new URL(url, window.location) }; window.location = entries[cursor].url; },
      pushState(state, _, url) { entries.splice(++cursor); entries.push({ state, url: new URL(url, window.location) }); window.location = entries[cursor].url; },
      back() { window.location = entries[--cursor].url; },
      forward() { window.location = entries[++cursor].url; }
    },
    scrollTo(options) { window.scrollY = options.top; }
  };
  const document = {
    baseURI: 'https://padelliga.envidual.com/',
    querySelector(selector) {
      if (selector === 'base') return {};
      if (selector === 'main > .section.active') return sections.find(section => section.classList.contains('active'));
      return links.find(link => selector.includes('data-section="' + link.id + '"')) || null;
    },
    querySelectorAll(selector) { return selector === '.section' ? sections : links; },
    getElementById(id) { return sections.find(section => section.id === id) || null; }
  };
  const context = vm.createContext({ window, document, URL, URLSearchParams,
    appReady: true, isDetailEmbed: false, selectedSeason: { id: '2026-winter' },
    calculatorResults: new Map([['partie-1', '6:4']]),
    playerProfilePresentation: 'modal', playerProfileRouteNumber: 0, playerProfileShownRoute: null,
    playerProfileRouteIds: new Map(),
    isNavigationPinned: () => false, getPlayerProfilePanelContext: () => null,
    closePlayerProfile() {}, renderActiveSection() {}, scrollToTopInstantly() {},
    requestAnimationFrame: callback => callback()
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'data/seasons.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/season-routing.js'), 'utf8'), context);
  vm.runInContext(app.slice(app.indexOf('function rememberSectionHistory()'), app.indexOf('async function openLiveTicker(')), context);
  vm.runInContext(app.slice(app.indexOf('function pushPlayerProfileHistory('), app.indexOf('function rememberPlayerProfileHistoryEntry(')), context);
  return { context, window, sections, links, entries };
}

test('tab changes support back and forward without resetting calculator inputs', () => {
  const { context, window, sections, links, entries } = navigation();
  context.updateSectionLinks();
  assert.equal(links.find(link => link.id === 'rechner').href, 'https://padelliga.envidual.com/rechner/');
  context.nav('rangliste');
  assert.equal(window.location.pathname, '/rangliste/');
  assert.equal(entries.length, 2);
  assert.ok(links.find(link => link.id === 'rangliste').classList.contains('active'));
  window.scrollY = 0;
  window.history.back();
  context.syncSectionWithHistory();
  assert.ok(sections.find(section => section.id === 'rechner').classList.contains('active'));
  assert.equal(window.scrollY, 430);
  assert.equal(context.calculatorResults.get('partie-1'), '6:4');
  assert.equal(entries.length, 2, 'restoring history must not create an entry');
  window.history.forward();
  context.syncSectionWithHistory();
  assert.ok(sections.find(section => section.id === 'rangliste').classList.contains('active'));
});

test('opening a profile preserves calculator URL, inputs and scroll as its return target', () => {
  const { context, window, entries } = navigation();
  context.pushPlayerProfileHistory('agnes_k', false);
  assert.equal(window.location.pathname, '/spieler/agnes_k/');
  assert.equal(entries[0].state.sectionScrollY, 430);
  assert.equal(entries[0].state.leagueSection, 'rechner');
  window.scrollY = 0;
  window.history.back();
  context.syncSectionWithHistory();
  assert.equal(window.location.pathname, '/rechner/');
  assert.equal(window.scrollY, 430);
  assert.equal(context.calculatorResults.get('partie-1'), '6:4');
});

test('unavailable sections do not change the URL or history', () => {
  const { context, window, sections, entries } = navigation();
  sections.find(section => section.id === 'infos').hidden = true;
  context.nav('infos');
  assert.equal(window.location.pathname, '/rechner/');
  assert.equal(entries.length, 1);
});
