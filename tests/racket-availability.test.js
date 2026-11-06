const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const root = path.resolve(__dirname, '..');
const dataModule = import(path.join(root, 'supabase/functions/racket-availability/data.ts'));
const handlerModule = import(path.join(root, 'supabase/functions/racket-availability/handler.ts'));
const client = fs.readFileSync(path.join(root, 'js/court-availability.js'), 'utf8');
const date = '2026-11-06';
const request = body => new Request('https://example.invalid/racket-availability', { method: 'POST', body: JSON.stringify(body) });
const booking = (desk, from, until, extra = {}) => ({ id: 'private-id', desk_id: desk,
  date: `${date} ${from}:00`, end_date: `${date} ${until}:00`, user: { email: 'private@example.invalid' }, ...extra });

test('only actual occupied half hours are marked, with no warning in the preceding half hour', async () => {
  const { busyStarts, RACKET_DESK_ID } = await dataModule;
  assert.deepEqual(busyStarts(date, [booking(RACKET_DESK_ID, '18:30', '19:00')]), {
    date, busyStarts: ['18:30']
  });
  assert.deepEqual(busyStarts(date, [booking(RACKET_DESK_ID, '12:00', '13:00')]).busyStarts,
    ['12:00', '12:30'], '11:30 is free and 13:00 is free again');
});

test('cancelled and other resources are ignored; office hours alone never create a marker', async () => {
  const { busyStarts, RACKET_DESK_ID } = await dataModule;
  assert.deepEqual(busyStarts(date, [booking('other', '18:00', '19:00'),
    booking(RACKET_DESK_ID, '18:00', '19:00', { checkin_status: 'cancelled' })]).busyStarts, []);
  assert.deepEqual(busyStarts(date, []).busyStarts, []);
  assert.deepEqual(busyStarts(date, [booking(RACKET_DESK_ID, '06:30', '07:00'),
    booking(RACKET_DESK_ID, '19:30', '20:00')]).busyStarts, ['06:30', '19:30'],
    'actual bookings are displayed without expanding them into another half hour');
});

test('public endpoint accepts no session and only returns date and start times', async () => {
  const { createHandler } = await handlerModule;
  const handler = createHandler(async value => ({ date: value, busyStarts: ['18:00'], user: 'private', id: 'secret' }));
  const response = await handler(request({ date }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { date, busyStarts: ['18:00'] });
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('invalid calendar dates and methods never reach Clearooms; failures are neutral and contain no upstream details', async () => {
  const { createHandler } = await handlerModule;
  const { isDate } = await dataModule;
  let calls = 0;
  const handler = createHandler(async () => { calls++; throw new Error('private upstream response'); });
  for (const value of ['2026-02-29', '2026-11-31', '2026-00-01', '2026-11-06&desk=other', null]) {
    assert.equal((await handler(request({ date: value }))).status, 400);
  }
  assert.equal(isDate('2028-02-29'), true);
  assert.equal((await handler(new Request('https://example.invalid', { method: 'POST', body: '{' }))).status, 400);
  assert.equal((await handler(request({ date, extra: 'x'.repeat(300) }))).status, 400);
  assert.equal((await handler(new Request('https://example.invalid'))).status, 405);
  assert.equal((await handler(new Request('https://example.invalid', { method: 'OPTIONS' }))).status, 200);
  assert.equal(calls, 0);
  const failed = await handler(request({ date }));
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: 'Schlägerbelegung gerade nicht prüfbar.' });
});

test('production reader only fetches daily bookings, rejects malformed upstream responses', async () => {
  const data = await dataModule;
  const { createHandler } = await handlerModule;
  const source = fs.readFileSync(path.join(root, 'supabase/functions/racket-availability/index.ts'), 'utf8');
  let handler, raw = [booking(data.RACKET_DESK_ID, '18:30', '19:00')];
  const calls = [];
  const context = vm.createContext({ ...data, createHandler, Request, Response, AbortSignal, Map, Date, Promise,
    Deno: { env: { get: key => key === 'CLEAROOMS_API_TOKEN' ? 'test-only' : undefined }, serve: value => { handler = value; } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return Response.json(raw);
    } });
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*;\n/gm, '')), context);
  assert.deepEqual(await (await handler(request({ date }))).json(), { date, busyStarts: ['18:30'] });
  assert.deepEqual(calls.map(call => call.url), [
    `https://api.clearooms.com/api/v1/bookings?date=${date}`
  ]);
  assert.ok(calls.every(call => !call.options.method || call.options.method === 'GET'));
  for (const malformed of [{ error: 'blocked' }, [null], [{ desk_id: data.RACKET_DESK_ID, date: 'broken' }]]) {
    raw = malformed;
    assert.equal((await handler(request({ date }))).status, 502);
  }
});

test('calendar displays each occupied half hour even without a selectable court time', () => {
  const grid = { innerHTML: '', style: {}, scrollTop: 0, scrollLeft: 0, contains: () => false };
  const context = { window: {}, grid, document: { activeElement: null }, ownBookings: [], options: {},
    data: { date: '2099-11-06', opening: { from: '07:00', until: '20:00' }, racketBusyStarts: ['18:00', '18:30', '19:30'],
      courts: [{ id: 'hall', name: 'Halle', location: 'indoor' }],
      slots: ['18:15', '19:00'].map(time => ({ id: time, time, courtId: 'hall',
        start: `2099-11-06T${time}:00Z`, end: `2099-11-06T20:00:00Z` })) },
    filter: 'indoor', hoursFilter: 'office', selected: null, preview: null };
  vm.createContext(context);
  const helpers = client.slice(0, client.indexOf('  const dialog ='));
  const functions = client.slice(client.indexOf('  function paintRange()'), client.indexOf('  function hideRacketTooltip()'));
  vm.runInContext(helpers + functions + 'renderGrid(); window.findSelectableSlot = findSelectableSlot; window.renderGrid = renderGrid; })();', context);
  const buttons = [...grid.innerHTML.matchAll(/<button[^]*?<\/button>/g)].map(value => value[0]);
  assert.equal(buttons.length, 2);
  const cell = time => grid.innerHTML.match(new RegExp(`data-court-time="${time}"[^]*?<\\/td>`))?.[0];
  assert.match(cell('18:15'), /court-racket-icon/);
  assert.match(buttons[0], /Schläger bereits belegt\. Platzzeit trotzdem auswählbar\./);
  assert.doesNotMatch(buttons[0], /disabled/);
  assert.doesNotMatch(cell('19:00'), /court-racket-icon|Schläger bereits belegt/);
  assert.match(cell('18:30'), /court-racket-icon/);
  assert.doesNotMatch(cell('18:30'), /<button/, 'the icon does not create a new selectable start');
  assert.match(cell('18:30'), /tabindex="0" role="img"/, 'non-selectable cells retain a keyboard-accessible explanation');
  assert.match(cell('19:30'), /court-racket-icon/, 'continuation cells also show the actual occupation');
  assert.equal(context.window.findSelectableSlot('18:15').id, '18:15');
  context.ownBookings = [{ booking_id: 1, court_resource_id: 'hall', court_name: 'Halle',
    starts_at: '2099-11-06T17:00:00Z', ends_at: '2099-11-06T18:30:00Z' }];
  context.data.racketBusyStarts = ['18:30'];
  context.window.renderGrid();
  assert.doesNotMatch(cell('18:00'), /court-racket-icon/);
  assert.match(cell('18:30'), /court-racket-icon/, 'a long court booking still uses each cell time for racket occupation');
  assert.doesNotMatch(cell('19:00'), /court-racket-icon/);

  context.ownBookings[0].match_id = 'match-one';
  context.ownBookings[0].match_label = 'Partie 7';
  context.window.renderGrid();
  for (const time of ['18:00', '18:30', '19:00']) {
    assert.doesNotMatch(cell(time), /court-racket-icon|Schläger/, 'assigned match fields retain only the match marking');
  }
  assert.match(cell('18:00'), /court-booking-match-number[^>]*>P#<\/span>/);
  assert.match(cell('18:30'), /court-booking-match-number[^>]*>7<\/span>/);

});

test('tooltip distinguishes full occupation from either partially occupied half, including hover on an unmarked cell', () => {
  const context = vm.createContext({ window: {} });
  const helpers = client.slice(0, client.indexOf('  const dialog ='));
  vm.runInContext(helpers + 'window.hint = racketHourHint; })();', context);
  const hint = context.window.hint;
  assert.equal(hint('12:00', ['12:00', '12:30']), 'Schläger bereits belegt. Platzzeit trotzdem auswählbar.');
  assert.equal(hint('12:00', ['12:00']), 'Schläger zum Teil bereits belegt. Platzzeit trotzdem auswählbar.');
  assert.equal(hint('12:00', ['12:30']), 'Schläger zum Teil bereits belegt. Platzzeit trotzdem auswählbar.');
  assert.equal(hint('12:00', []), '');
  assert.equal(hint('23:30', ['00:00']), '', 'the following day is not confused with this morning');
  const rect = () => ({ top: 50, bottom: 86, left: 100, right: 136, width: 36 });
  let assigned = false;
  const cell = { dataset: { courtTime: '12:00' }, classList: { contains: () => assigned }, querySelector: () => null, getBoundingClientRect: rect, setAttribute() {} };
  const tooltip = { hidden: true, style: {}, offsetWidth: 230, offsetHeight: 58 };
  const hoverContext = vm.createContext({
    data: { racketBusyStarts: ['12:30'] }, racketTooltip: tooltip, racketHourHint: hint,
    grid: { querySelectorAll: () => [], getBoundingClientRect: () => ({ top: 0, bottom: 300, left: 0, right: 500 }) },
    dialog: { getBoundingClientRect: () => ({ top: 0, bottom: 500, left: 0, right: 600 }) }
  });
  vm.runInContext(client.slice(client.indexOf('  function hideRacketTooltip()'), client.indexOf('  // Ein nachgeladener Schlägerstatus')), hoverContext);
  hoverContext.showRacketTooltip({ type: 'pointerover', target: { closest: selector => selector === '[data-court-cell]' ? cell : null } });
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.textContent, 'Schläger zum Teil bereits belegt. Platzzeit trotzdem auswählbar.');
  assigned = true;
  hoverContext.showRacketTooltip({ type: 'pointerover', target: { closest: selector => selector === '[data-court-cell]' ? cell : null } });
  assert.equal(tooltip.hidden, true, 'assigned match fields do not warn about their own racket booking');
  assigned = false;
  hoverContext.data.racketBusyStarts = [];
  hoverContext.showRacketTooltip({ type: 'pointerover', target: { closest: selector => selector === '[data-court-cell]' ? cell : null } });
  assert.equal(tooltip.hidden, true);
});

test('late Clearooms responses cannot replace a different day; failures clear stale markers without changing the court data', async () => {
  const definition = client.slice(client.indexOf('  async function loadRacketAvailability('), client.indexOf('  async function load('));
  let resolveOld;
  const pending = new Promise(resolve => { resolveOld = resolve; });
  let applyCount = 0;
  const context = vm.createContext({
    window: { PADEL_SUPABASE_CONFIG: { url: 'https://example.invalid', publishableKey: 'public' } },
    racketController: null, racketAvailability: null, racketStatus: { textContent: '', hidden: true },
    generation: 1, dialog: { open: true }, AbortController, setTimeout, clearTimeout,
    fetch: () => pending, applyRacketAvailability: () => { applyCount++; }
  });
  vm.runInContext(definition, context);
  const old = context.loadRacketAvailability('2026-11-06', 1);
  context.generation = 2;
  context.fetch = async () => Response.json({ date: '2026-11-07', busyStarts: ['19:00'] });
  await context.loadRacketAvailability('2026-11-07', 2);
  resolveOld(Response.json({ date: '2026-11-06', busyStarts: ['18:00'] }));
  await old;
  assert.equal(context.racketAvailability.date, '2026-11-07');
  assert.equal(applyCount, 1);
  context.fetch = async () => Response.json({ error: 'upstream' }, { status: 502 });
  await context.loadRacketAvailability('2026-11-07', 2);
  assert.equal(context.racketAvailability, null);
  assert.equal(applyCount, 2);
  assert.equal(context.racketStatus.hidden, false);
  assert.equal(context.racketStatus.textContent, 'Schlägerbelegung gerade nicht prüfbar.');
});
