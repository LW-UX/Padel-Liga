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
const hours = Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, from: '07:00', to: '20:00' }));
const date = '2026-11-06';
const request = body => new Request('https://example.invalid/racket-availability', { method: 'POST', body: JSON.stringify(body) });
const booking = (desk, from, until, extra = {}) => ({ id: 'private-id', desk_id: desk,
  date: `${date} ${from}:00`, end_date: `${date} ${until}:00`, user: { email: 'private@example.invalid' }, ...extra });

test('busy starts cover the whole booking hour, including its second half, with exclusive end boundaries', async () => {
  const { busyStarts, RACKET_DESK_ID } = await dataModule;
  assert.deepEqual(busyStarts(date, hours, [booking(RACKET_DESK_ID, '18:30', '19:00')]), {
    date, busyStarts: ['18:00', '18:30']
  });
  assert.deepEqual(busyStarts(date, hours, [booking(RACKET_DESK_ID, '18:00', '19:00')]).busyStarts,
    ['17:30', '18:00', '18:30']);
});

test('cancelled and other resources are ignored; closed hours have no marker, partial office hours do', async () => {
  const { busyStarts, RACKET_DESK_ID } = await dataModule;
  assert.deepEqual(busyStarts(date, hours, [booking('other', '18:00', '19:00'),
    booking(RACKET_DESK_ID, '18:00', '19:00', { checkin_status: 'cancelled' })]).busyStarts, []);
  const allDay = [booking(RACKET_DESK_ID, '00:00', '23:59')];
  const starts = busyStarts(date, hours, allDay).busyStarts;
  assert.equal(starts[0], '06:30', 'the intended hour is shortened to 07:00–07:30');
  assert.equal(starts.at(-1), '19:30', 'the last intended hour is shortened to 19:30–20:00');
  assert.equal(starts.includes('20:00'), false);
  assert.deepEqual(busyStarts(date, [], allDay).busyStarts, []);
  assert.deepEqual(busyStarts(date, hours, []).busyStarts, []);
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

test('production reader only fetches the fixed office and daily bookings, rejects malformed upstream responses', async () => {
  const data = await dataModule;
  const { createHandler } = await handlerModule;
  const source = fs.readFileSync(path.join(root, 'supabase/functions/racket-availability/index.ts'), 'utf8');
  let handler, raw = [booking(data.RACKET_DESK_ID, '18:30', '19:00')];
  const calls = [];
  const context = vm.createContext({ ...data, createHandler, Request, Response, AbortSignal, Map, Date, Promise,
    Deno: { env: { get: key => key === 'CLEAROOMS_API_TOKEN' ? 'test-only' : undefined }, serve: value => { handler = value; } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return Response.json(url.includes('/offices/') ? { working_hours: hours } : raw);
    } });
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*;\n/gm, '')), context);
  assert.deepEqual(await (await handler(request({ date }))).json(), { date, busyStarts: ['18:00', '18:30'] });
  assert.deepEqual(calls.map(call => call.url), [
    `https://api.clearooms.com/api/v1/offices/${data.RACKET_OFFICE_ID}`,
    `https://api.clearooms.com/api/v1/bookings?date=${date}`
  ]);
  assert.ok(calls.every(call => !call.options.method || call.options.method === 'GET'));
  for (const malformed of [{ error: 'blocked' }, [null], [{ desk_id: data.RACKET_DESK_ID, date: 'broken' }]]) {
    raw = malformed;
    assert.equal((await handler(request({ date }))).status, 502);
  }
});

test('calendar keeps marked times selectable, rounds quarter hours and leaves free starts without an icon', () => {
  const grid = { innerHTML: '', style: {}, scrollTop: 0, scrollLeft: 0, contains: () => false };
  const context = { window: {}, grid, document: { activeElement: null }, ownBookings: [], options: {},
    data: { date: '2099-11-06', opening: { from: '07:00', until: '20:00' }, racketBusyStarts: ['18:00'],
      courts: [{ id: 'hall', name: 'Halle', location: 'indoor' }],
      slots: ['18:15', '19:00'].map(time => ({ id: time, time, courtId: 'hall',
        start: `2099-11-06T${time}:00Z`, end: `2099-11-06T20:00:00Z` })) },
    filter: 'indoor', hoursFilter: 'office', selected: null, preview: null };
  vm.createContext(context);
  const helpers = client.slice(0, client.indexOf('  const dialog ='));
  const functions = client.slice(client.indexOf('  function paintRange()'), client.indexOf('  function hideRacketTooltip()'));
  vm.runInContext(helpers + functions + 'renderGrid(); window.findSelectableSlot = findSelectableSlot; })();', context);
  const buttons = [...grid.innerHTML.matchAll(/<button[^]*?<\/button>/g)].map(value => value[0]);
  assert.equal(buttons.length, 2);
  assert.match(buttons[0], /court-racket-icon/);
  assert.match(buttons[0], /Schläger bereits belegt\. Platzzeit trotzdem auswählbar\./);
  assert.doesNotMatch(buttons[0], /disabled/);
  assert.doesNotMatch(buttons[1], /court-racket-icon|Schläger bereits belegt/);
  assert.equal(context.window.findSelectableSlot('18:15').id, '18:15');
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
