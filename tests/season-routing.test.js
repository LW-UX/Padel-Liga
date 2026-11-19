const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const routingSource = fs.readFileSync(path.join(root, 'js/season-routing.js'), 'utf8');

function loadRouting(href, baseURI) {
  const location = new URL(href);
  const history = {
    state: null,
    replaced: null,
    replaceState(_state, _title, nextUrl) {
      this.replaced = nextUrl;
    }
  };
  const window = { location, history, PADEL_SEASONS: [] };
  const seasonPickerLabel = { textContent: '' };
  const document = {
    baseURI,
    pinnedBase: null,
    getElementById(id) { return id === 'season-picker-label' ? seasonPickerLabel : null; },
    querySelector() { return this.pinnedBase; },
    createElement() { return {}; },
    head: { prepend(element) { document.pinnedBase = element; } }
  };
  const context = { window, document, URL, URLSearchParams };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'data/seasons.js'), 'utf8'), context);
  vm.runInNewContext(routingSource, context);
  return { routing: window.PadelSeasonRouting, history, document, seasonPickerLabel };
}

test('the season picker labels the default and explicit routes before season data loads', () => {
  const defaultPage = loadRouting('https://example.test/', 'https://example.test/');
  assert.equal(defaultPage.seasonPickerLabel.textContent, 'Wi26');
  assert.equal(loadRouting('https://example.test/so26/partien/', 'https://example.test/').seasonPickerLabel.textContent, 'So26');
  assert.equal(loadRouting('https://example.test/tipp/?saison=cup-2027', 'https://example.test/tipp/').seasonPickerLabel.textContent, 'Cup27');
  for (const file of ['index.html', 'tipp/index.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(html.includes(`id="season-picker-label">${defaultPage.seasonPickerLabel.textContent}</span>`));
  }
});

test('account links use one short global path, including project bases and tipping', () => {
  for (const [href, baseURI, expected] of [
    ['https://padelliga.envidual.com/infos/?konto=1', 'https://padelliga.envidual.com/', 'https://padelliga.envidual.com/konto/'],
    ['https://lw-ux.github.io/Padel-Liga/so26/infos/', 'https://lw-ux.github.io/Padel-Liga/', 'https://lw-ux.github.io/Padel-Liga/konto/'],
    ['https://padelliga.envidual.com/tipp/', 'https://padelliga.envidual.com/tipp/', 'https://padelliga.envidual.com/konto/']
  ]) {
    const { routing } = loadRouting(href, baseURI);
    assert.equal(routing.getAccountUrl().href, expected);
  }
  const direct = loadRouting('https://padelliga.envidual.com/konto/', 'https://padelliga.envidual.com/');
  assert.equal(direct.routing.isAccountRequested(), true);
  const local = loadRouting('http://localhost:4173/?bereich=infos#platzbuchung', 'http://localhost:4173/');
  assert.equal(local.routing.getAccountUrl().href, 'http://localhost:4173/?bereich=infos&konto=1#platzbuchung');
});

test('short paths select their season and produce league and tipping URLs', () => {
  const { routing } = loadRouting(
    'https://lw-ux.github.io/Padel-Liga/wi26/',
    'https://lw-ux.github.io/Padel-Liga/'
  );
  assert.equal(routing.getRequestedSeasonId(), '2026-winter');
  assert.equal(routing.getSeasonUrl('2026-sommer', 'league').href, 'https://lw-ux.github.io/Padel-Liga/so26/');
  assert.equal(routing.getSeasonUrl('2027-cup', 'tipp').href, 'https://lw-ux.github.io/Padel-Liga/tipp/cup27/');
});

test('default season tabs omit the prefix while explicit season links stay readable', () => {
  for (const section of ['rangliste', 'partien', 'rechner', 'statistik', 'infos']) {
    const { routing } = loadRouting(`https://padelliga.envidual.com/${section}/`, 'https://padelliga.envidual.com/');
    const id = section === 'statistik' ? 'verlauf' : section;
    assert.equal(routing.getRequestedSection(), id);
    assert.equal(routing.getSectionUrl('2026-winter', id).pathname, `/${section}/`);
    assert.equal(routing.getSectionUrl('2026-sommer', id).pathname, `/so26/${section}/`);
  }
  const { routing } = loadRouting('https://padelliga.envidual.com/wi26/rechner/', 'https://padelliga.envidual.com/');
  assert.equal(routing.getRequestedSeasonId(), '2026-winter');
  assert.equal(routing.getRequestedSection(), 'rechner');
  assert.equal(routing.getSeasonUrl('2026-winter').pathname, '/');
  assert.equal(routing.getSeasonUrl('2026-winter', 'tipp').pathname, '/tipp/');
  assert.equal(routing.getPlayerProfileUrl('2026-winter', 'agnes_k').pathname, '/spieler/agnes_k/');
});

test('seasonal tab entry paths resolve below a GitHub project base', () => {
  const { routing } = loadRouting('https://lw-ux.github.io/Padel-Liga/so26/statistik/', 'https://lw-ux.github.io/Padel-Liga/');
  assert.equal(routing.getRequestedSeasonId(), '2026-sommer');
  assert.equal(routing.getRequestedSection(), 'verlauf');
  assert.equal(routing.getSectionUrl('2026-sommer', 'rechner').pathname, '/Padel-Liga/so26/rechner/');
});

test('local tab URLs use existing entry files and clear detail parameters', () => {
  const { routing } = loadRouting('http://localhost:4173/?saison=2026-winter&bereich=rechner&spielerprofil=agnes_k', 'http://localhost:4173/');
  assert.equal(routing.getRequestedSection(), 'rechner');
  assert.equal(routing.getSectionUrl('2026-winter', 'verlauf', { preserveSearch: true }).href,
    'http://localhost:4173/?saison=2026-winter&bereich=verlauf');
  assert.equal(routing.getPlayerProfileUrl('2026-winter', 'agnes_k', { preserveSearch: true }).href,
    'http://localhost:4173/?saison=2026-winter&spielerprofil=agnes_k');
});

test('local file navigation keeps using real index files with query parameters', () => {
  const { routing } = loadRouting(
    'file:///Users/example/Padel-Liga/index.html',
    'file:///Users/example/Padel-Liga/index.html'
  );
  const match = { id: 'winter-2026-partie-7', stage: 'league' };
  const liveMatch = { id: 'season-2026-partie-28', stage: 'final-four', format: 'single-set' };
  assert.equal(
    routing.getSeasonUrl('2026-winter', 'league').href,
    'file:///Users/example/Padel-Liga/index.html?saison=2026-winter'
  );
  assert.equal(
    routing.getSeasonUrl('2026-winter', 'tipp').href,
    'file:///Users/example/Padel-Liga/tipp/index.html?saison=2026-winter'
  );
  assert.equal(
    routing.getMatchUrl('2026-winter', match).href,
    'file:///Users/example/Padel-Liga/index.html?saison=2026-winter&partie=winter-2026-partie-7'
  );
  assert.equal(
    routing.getLiveUrl('2026-sommer', liveMatch, 'overview').href,
    'file:///Users/example/Padel-Liga/index.html?saison=2026-sommer&live=season-2026-partie-28&liveView=overview'
  );
});

test('local PadelTipp links return to the root index file', () => {
  const { routing } = loadRouting(
    'file:///Users/example/Padel-Liga/tipp/index.html?saison=2026-winter',
    'file:///Users/example/Padel-Liga/tipp/index.html'
  );
  assert.equal(
    routing.getSeasonUrl('2026-sommer', 'league').href,
    'file:///Users/example/Padel-Liga/index.html?saison=2026-sommer'
  );
});

test('local development servers use query routes that exist without deploy generation', () => {
  const { routing } = loadRouting(
    'http://localhost:4173/tipp/?saison=2026-winter',
    'http://localhost:4173/tipp/'
  );
  const match = { id: 'winter-2026-partie-7', stage: 'league' };
  const liveMatch = { id: 'season-2026-partie-28', stage: 'final-four', format: 'single-set' };
  assert.equal(
    routing.getSeasonUrl('2026-winter', 'league').href,
    'http://localhost:4173/?saison=2026-winter'
  );
  assert.equal(
    routing.getMatchUrl('2026-winter', match).href,
    'http://localhost:4173/?saison=2026-winter&partie=winter-2026-partie-7'
  );
  assert.equal(
    routing.getLiveUrl('2026-sommer', liveMatch, 'overview').href,
    'http://localhost:4173/?saison=2026-sommer&live=season-2026-partie-28&liveView=overview'
  );
});

test('season changes discard detail routes from the previous season', () => {
  const { routing } = loadRouting(
    'http://localhost:4173/?saison=2026-sommer&partie=season-2026-partie-3&live=season-2026-partie-28&liveView=overview&spielerprofil=spieler-a&ref=wechsel',
    'http://localhost:4173/'
  );
  assert.equal(
    routing.getSeasonUrl('2026-winter', 'league', {
      preserveSearch: true,
      preserveHash: true,
      clearDetails: true
    }).href,
    'http://localhost:4173/?ref=wechsel&saison=2026-winter'
  );
});

test('short match paths resolve the season and the underlying stable match id', () => {
  const { routing } = loadRouting(
    'https://lw-ux.github.io/Padel-Liga/wi26/partie/7/',
    'https://lw-ux.github.io/Padel-Liga/'
  );
  const matches = [
    { id: 'winter-2026-partie-7', stage: 'league' },
    { id: 'winter-2026-semifinal-1', stage: 'semifinal' },
    { id: 'winter-2026-final-1', stage: 'final-four' }
  ];
  assert.equal(routing.getRequestedSeasonId(), '2026-winter');
  assert.equal(routing.getRequestedMatchId(matches), 'winter-2026-partie-7');
  assert.equal(routing.getMatchUrl('2026-winter', matches[0]).href, 'https://lw-ux.github.io/Padel-Liga/partie/7/');
  assert.equal(routing.getMatchUrl('2026-winter', matches[1]).href, 'https://lw-ux.github.io/Padel-Liga/partie/halbfinale-1/');
  assert.equal(routing.getMatchSlug(matches[2]), null, 'Final Four remains on the separate live route');
});

test('legacy query links are replaced by the canonical short path and keep detail parameters', () => {
  const { routing, history } = loadRouting(
    'https://lw-ux.github.io/Padel-Liga/?saison=winter-2026&partie=42',
    'https://lw-ux.github.io/Padel-Liga/'
  );
  assert.equal(routing.getRequestedSeasonId(), '2026-winter');
  assert.equal(routing.normalizeCurrentUrl('league'), true);
  assert.equal(history.replaced, '/Padel-Liga/?partie=42');
});

test('leaving the root page for a short path keeps relative scripts at the site root', () => {
  const { routing, history, document } = loadRouting(
    'https://padelliga.envidual.com/?saison=test-2026&konto=1',
    'https://padelliga.envidual.com/?saison=test-2026&konto=1'
  );
  routing.normalizeCurrentUrl('league');
  assert.equal(history.replaced, '/test/?konto=1');
  assert.equal(document.pinnedBase.href, 'https://padelliga.envidual.com/');
});

test('legacy match query links are normalized after the season matches are available', () => {
  const { routing, history } = loadRouting(
    'https://lw-ux.github.io/Padel-Liga/wi26/?partie=winter-2026-partie-7',
    'https://lw-ux.github.io/Padel-Liga/'
  );
  const matches = [{ id: 'winter-2026-partie-7', stage: 'league' }];
  assert.equal(routing.normalizeCurrentMatchUrl('2026-winter', matches), true);
  assert.equal(history.replaced, '/Padel-Liga/partie/7/');
});

test('live overview and individual Final Four routes use short paths', () => {
  const { routing } = loadRouting(
    'https://lw-ux.github.io/Padel-Liga/so26/live/',
    'https://lw-ux.github.io/Padel-Liga/'
  );
  const matches = [
    { id: 'season-2026-partie-28', stage: 'final-four', format: 'single-set' },
    { id: 'season-2026-partie-29', stage: 'final-four', format: 'single-set' }
  ];
  assert.deepEqual(
    JSON.parse(JSON.stringify(routing.getRequestedLiveRoute(matches))),
    { matchId: 'season-2026-partie-28', view: 'overview' }
  );
  assert.equal(routing.getLiveUrl('2026-sommer', matches[0], 'overview').href, 'https://lw-ux.github.io/Padel-Liga/so26/live/');
  assert.equal(routing.getLiveUrl('2026-sommer', matches[0]).href, 'https://lw-ux.github.io/Padel-Liga/so26/live/28/');
});

test('legacy live overview queries normalize to the short live route', () => {
  const { routing, history } = loadRouting(
    'https://lw-ux.github.io/Padel-Liga/so26/?live=season-2026-partie-28&liveView=overview',
    'https://lw-ux.github.io/Padel-Liga/'
  );
  const matches = [{ id: 'season-2026-partie-28', stage: 'final-four', format: 'single-set' }];
  assert.equal(routing.normalizeCurrentLiveUrl('2026-sommer', matches), true);
  assert.equal(history.replaced, '/Padel-Liga/so26/live/');
});

test('player profiles use short season paths and keep query links locally', () => {
  const { routing } = loadRouting(
    'https://lw-ux.github.io/Padel-Liga/wi26/partie/7/?ref=x',
    'https://lw-ux.github.io/Padel-Liga/'
  );
  const players = [{ id: 'agnes_k' }, { id: 'chris_m' }];
  assert.equal(
    routing.getPlayerProfileUrl('2026-winter', 'agnes_k', { preserveSearch: true }).href,
    'https://lw-ux.github.io/Padel-Liga/spieler/agnes_k/?ref=x'
  );
  assert.equal(routing.getPlayerIdFromPath(players, '/Padel-Liga/wi26/spieler/chris_m/'), 'chris_m');
  assert.equal(routing.getPlayerIdFromPath(players, '/Padel-Liga/wi26/spieler/unbekannt/'), null);
  assert.equal(routing.getRequestedPlayerProfileId(players), null);

  const local = loadRouting('http://localhost:8765/?saison=2026-winter', 'http://localhost:8765/');
  assert.equal(
    local.routing.getPlayerProfileUrl('2026-winter', 'agnes_k').href,
    'http://localhost:8765/?saison=2026-winter&spielerprofil=agnes_k'
  );
});

test('legacy profile queries normalize to the short profile route', () => {
  const { routing, history } = loadRouting(
    'https://lw-ux.github.io/Padel-Liga/wi26/?spielerprofil=agnes_k',
    'https://lw-ux.github.io/Padel-Liga/'
  );
  const players = [{ id: 'agnes_k' }];
  assert.equal(routing.getRequestedPlayerProfileId(players), 'agnes_k');
  assert.equal(routing.normalizeCurrentPlayerProfileUrl('2026-winter', players), true);
  assert.equal(history.replaced, '/Padel-Liga/spieler/agnes_k/');
});

test('deployment generation creates direct entry pages with the correct base paths', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'padel-season-routes-'));
  const mock = path.join(output, 'mock-database.mjs');
  fs.writeFileSync(mock, `globalThis.fetch = async () => ({ ok: true, json: async () => ({ matches: [
    { id: 'winter-2026-partie-7', stage: 'league' },
    { id: 'season-2026-partie-28', stage: 'final-four', format: 'single-set' }
  ] }) });`);
  execFileSync(process.execPath, ['--import', mock, path.join(root, 'tools/generate-season-routes.mjs'), output], { cwd: root });
  for (const route of ['konto', 'rechner', 'statistik', 'so26/rechner', 'wi26/rangliste', 'spieler/agnes_k', 'partie/7']) {
    const html = fs.readFileSync(path.join(output, route, 'index.html'), 'utf8');
    const depth = route.split('/').length;
    assert.ok(html.includes(`<base href="${'../'.repeat(depth)}">`), route);
  }

  const league = fs.readFileSync(path.join(output, 'wi26', 'index.html'), 'utf8');
  const match = fs.readFileSync(path.join(output, 'wi26', 'partie', '7', 'index.html'), 'utf8');
  const liveOverview = fs.readFileSync(path.join(output, 'so26', 'live', 'index.html'), 'utf8');
  const liveMatch = fs.readFileSync(path.join(output, 'so26', 'live', '28', 'index.html'), 'utf8');
  const tipping = fs.readFileSync(path.join(output, 'tipp', 'wi26', 'index.html'), 'utf8');
  const profile = fs.readFileSync(path.join(output, 'wi26', 'spieler', 'agnes_k', 'index.html'), 'utf8');
  assert.match(profile, /<base href="\.\.\/\.\.\/\.\.\/">/);
  assert.match(league, /<base href="\.\.\/">/);
  assert.match(tipping, /<base href="\.\.\/">/);
  assert.match(match, /<base href="\.\.\/\.\.\/\.\.\/">/);
  assert.match(liveOverview, /<base href="\.\.\/\.\.\/">/);
  assert.match(liveMatch, /<base href="\.\.\/\.\.\/\.\.\/">/);
  assert.match(league, /Padel<em>Liga<\/em>/);
  assert.match(match, /Padel<em>Liga<\/em>/);
  assert.match(liveOverview, /Padel<em>Liga<\/em>/);
  assert.match(liveMatch, /Padel<em>Liga<\/em>/);
  assert.match(tipping, /Padel<em>Tipp<\/em>/);
});

test('match list anchors are short and distinct across rounds', () => {
  const { routing } = loadRouting('https://example.test/partien/', 'https://example.test/');
  for (const [match, expected] of [
    [{ id: 'winter-2026-partie-17', stage: 'league' }, '17'],
    [{ id: 'cup-2027-semifinal-1', stage: 'semifinal' }, 'halbfinale-1'],
    [{ id: 'cup-2027-quarterfinal-1', stage: 'quarterfinal' }, 'viertelfinale-1'],
    [{ id: 'winter-2026-final-1', stage: 'final-four' }, 'final-four-1']
  ]) assert.equal(routing.getMatchListAnchor(match), expected);
});

test('short and legacy search anchors reveal the same match card', () => {
  const { routing } = loadRouting('https://example.test/partien/', 'https://example.test/');
  const match = { id: 'winter-2026-partie-17', stage: 'league' };
  const source = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const reveal = source.slice(source.indexOf('function revealSearchTarget()'), source.indexOf('window.PadelLigaRevealSearchTarget ='));
  for (const anchor of ['17', `suchpartie-${match.id}`]) {
    let focused = false;
    let scrolled = false;
    const card = { focus: () => { focused = true; }, scrollIntoView: () => { scrolled = true; } };
    vm.runInNewContext(`${reveal}\nrevealSearchTarget();`, {
      appReady: true, isDetailEmbed: false, URL,
      window: { location: { href: `https://example.test/partien/#${anchor}` }, PadelSeasonRouting: routing },
      PADEL_DATA: { matches: [match] }, CSS: { escape: value => value },
      document: {
        getElementById: () => ({ classList: { contains: () => true } }),
        querySelector: selector => selector.includes(match.id) ? card : null
      }
    });
    assert.ok(focused && scrolled, anchor);
  }
});

test('all-time search anchor loads the all-time statistics before scrolling to the ranking', async () => {
  const source = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const reveal = source.slice(source.indexOf('function revealSearchTarget()'), source.indexOf('window.PadelLigaRevealSearchTarget ='));
  let finishLoading;
  let scrolled = false;
  let allTime = false;
  const loading = new Promise(resolve => { finishLoading = resolve; });
  vm.runInNewContext(`${reveal}\nrevealSearchTarget();`, {
    appReady: true, isDetailEmbed: false, URL,
    window: { location: { href: 'https://liga.test/statistik/#ewige-rangliste', hash: '#ewige-rangliste' } },
    setStatisticsMode: mode => {
      assert.equal(mode, 'all-time');
      return loading.then(() => { allTime = true; });
    },
    isAllTimeStatistics: () => allTime,
    document: { getElementById: id => id === 'verlauf'
      ? { classList: { contains: () => true } }
      : id === 'all-time-ranking-profile-layout' ? { scrollIntoView: () => { scrolled = true; } } : null }
  });
  assert.equal(scrolled, false);
  finishLoading();
  await loading;
  await Promise.resolve();
  assert.equal(scrolled, true);
});

test('match-time search anchor opens season statistics and reveals early-bird and late-riser facts', async () => {
  const source = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const reveal = source.slice(source.indexOf('function revealSearchTarget()'), source.indexOf('window.PadelLigaRevealSearchTarget ='));
  let scrolled = false;
  vm.runInNewContext(`${reveal}\nrevealSearchTarget();`, {
    appReady: true, isDetailEmbed: false, URL,
    window: { location: { href: 'https://liga.test/statistik/#stats-time-performance', hash: '#stats-time-performance' } },
    setStatisticsMode: async mode => { assert.equal(mode, 'season'); },
    isAllTimeStatistics: () => false,
    document: { getElementById: id => id === 'verlauf'
      ? { classList: { contains: () => true } }
      : id === 'stats-time-performance' ? { scrollIntoView: () => { scrolled = true; } } : null }
  });
  await Promise.resolve();
  assert.equal(scrolled, true);
});

test('info search anchors reveal the matching section without expanding an article', () => {
  const source = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const reveal = source.slice(source.indexOf('function revealSearchTarget()'), source.indexOf('window.PadelLigaRevealSearchTarget ='));
  const infoData = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'data/info.js'), 'utf8'), { window: infoData });
  const sectionId = source.match(/function sectionId\(title\) \{[\s\S]*?\n\}/)[0];
  const slug = vm.runInNewContext(`${sectionId}\nsectionId`);
  const search = require('../js/site-search-core');
  const groupAnchors = infoData.PADEL_INFO.sections.flatMap(section => (section.groups || [])
    .map(group => search.infoGroupAnchor(section.title, group.title)));
  const anchors = ['kurzinfo', ...infoData.PADEL_INFO.sections.map(section => slug(section.title)), ...groupAnchors, 'artikel', 'turniermodus'];
  for (const anchor of anchors) {
    let scrolled = false;
    vm.runInNewContext(`${reveal}\nrevealSearchTarget();`, {
      appReady: true, isDetailEmbed: false, URL,
      window: { location: { href: `https://liga.test/infos/#${anchor}` } },
      document: { getElementById: id => id === 'infos'
        ? { classList: { contains: () => true } }
        : id === anchor ? { classList: { contains: name => name === 'info-group' && groupAnchors.includes(anchor) }, scrollIntoView: () => { scrolled = true; } } : null }
    });
    assert.equal(scrolled, true, anchor);
  }
});


test('info subgroup anchors match their search destinations', () => {
  const source = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const renderer = source.match(/function renderInfoSection\(section, id\) \{[\s\S]*?\n\}/)[0];
  const infoData = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'data/info.js'), 'utf8'), { window: infoData });
  const search = require('../js/site-search-core');
  const context = vm.createContext({
    window: { PadelSearchCore: search, PadelSeasonRouting: { getAccountUrl: () => new URL('https://liga.test/konto/') } },
    escapeHtml: value => String(value), selectedSeason: { id: 'winter' }
  });
  vm.runInContext(renderer, context);
  for (const section of infoData.PADEL_INFO.sections) {
    const html = context.renderInfoSection(section, 'parent');
    for (const group of section.groups || []) {
      assert.ok(html.includes(`id="${search.infoGroupAnchor(section.title, group.title)}"`), group.title);
    }
  }
  assert.match(search.renderQualificationFlow(true), /id="turniermodus"\s+class="qualification-flow info-anchor"/);
});
