const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/court-availability.js'), 'utf8');
const date = '2099-11-04';
const booking = { booking_id: 12, court_resource_id: '8778f800-6d2d-46d8-b2b5-fbe35d9ad5b5',
  court_name: 'Indoor H2', starts_at: `${date}T17:00:00Z`, ends_at: `${date}T18:30:00Z` };
const appointment = { id: 'match:7', time: '12:00', duration: 60, label: 'Partie 7', shortLabel: 'P.7' };
function setup() {
  const elements = new Map();
  const element = key => {
    if (!elements.has(key)) elements.set(key, { hidden: false, textContent: '', classList: { toggle() {} } });
    return elements.get(key);
  };
  const grid = { innerHTML: '', style: {}, scrollTop: 0, scrollLeft: 0, contains: () => false,
    querySelectorAll: () => [], setAttribute() {}, replaceChildren() { this.innerHTML = ''; },
    getBoundingClientRect: () => ({ height: 200 }) };
  const context = vm.createContext({ window: { PADEL_SUPABASE_CONFIG: { url: 'https://example.invalid', publishableKey: 'public' },
    PadelKonto: { getCourtBookings: async () => [booking], getCourtAppointments: async () => [appointment] } },
    dialog: { open: true, querySelector: element }, grid, document: { hidden: false, activeElement: null },
    dateInput: { value: date, validity: { valid: true } }, status: {}, racketStatus: {},
    generation: 0, controller: null, racketController: null, racketAvailability: null,
    data: null, selected: null, preview: null, ownBookings: [], availableBookings: [], revealBookingId: null,
    filter: 'indoor', hoursFilter: 'office', options: {},
    AbortController, setTimeout, clearTimeout,
    hideRacketTooltip() {}, updateDateControls() {}, loadRacketAvailability() {},
    setSelection(value) { context.selected = value; },
    fetch: async () => Response.json({ error: 'upstream blocked' }, { status: 502 }) });
  const helpers = source.slice(0, source.indexOf('  const dialog ='));
  const rendering = source.slice(source.indexOf('  function paintRange()'), source.indexOf('  function hideRacketTooltip()'));
  const loading = source.slice(source.indexOf('  async function load('), source.indexOf('  function finishClose()'));
  vm.runInContext(helpers + rendering + loading + 'window.test = { load, renderGrid, findSelectableSlot }; })();', context);
  return { context, api: context.window.test, grid, element };
}

test('Playtomic failure retains fresh bookings and appointments, with only eligible confirmed bookings selectable', async () => {
  const { context, api, grid, element } = setup();
  await api.load();
  assert.match(grid.innerHTML, /is-unknown/);
  assert.doesNotMatch(grid.innerHTML, /class="is-free"|class="is-unavailable"/);
  assert.match(grid.innerHTML, /data-court-slot="booking-12"/);
  assert.match(grid.innerHTML, />P\.7<\/span>/);
  assert.equal(api.findSelectableSlot('booking-12').duration, 90);
  assert.equal(element('[data-court-outage]').hidden, false);
  assert.equal(element('[data-court-free-legend]').hidden, true);
  assert.equal(element('[data-court-unavailable-label]').textContent, 'Nicht prüfbar');
  assert.equal(context.status.textContent, '');
  context.ownBookings[0] = { ...booking, match_id: 'other' };
  api.renderGrid();
  assert.equal(api.findSelectableSlot('booking-12'), undefined);
  assert.doesNotMatch(grid.innerHTML, /data-court-slot="booking-12"/);
  context.filter = 'outdoor';
  api.renderGrid();
  assert.equal(element('[data-court-outage]').hidden, false);
  assert.match(grid.innerHTML, />P\.7<\/span>/);
});

test('guests and failed personal reads get an unknown calendar; successful retries restore live availability', async () => {
  const { context, api, grid, element } = setup();
  context.window.PadelKonto = undefined;
  context.fetch = async () => { throw new Error('timeout'); };
  await api.load();
  assert.match(grid.innerHTML, /is-unknown/);
  assert.doesNotMatch(grid.innerHTML, /data-court-slot=/);
  context.window.PadelKonto = { getCourtBookings: async () => { throw new Error('offline'); } };
  await api.load();
  assert.doesNotMatch(grid.innerHTML, /data-court-slot=/);
  context.fetch = async () => Response.json({ date, opening: { from: '07:00', until: '24:00' },
    courts: [{ id: 'hall', name: 'Halle', location: 'indoor' }],
    slots: [{ id: 'live', courtId: 'hall', time: '18:00', start: `${date}T17:00:00Z`, end: `${date}T18:00:00Z` }] });
  await api.load();
  assert.match(grid.innerHTML, /data-court-slot="live"/);
  assert.doesNotMatch(grid.innerHTML, /is-unknown/);
  assert.equal(element('[data-court-outage]').hidden, true);
  assert.equal(element('[data-court-free-legend]').hidden, false);
  assert.equal(element('[data-court-unavailable-label]').textContent, 'Belegt');
  context.fetch = async () => Response.json({ date, slots: [] });
  await api.load(true);
  assert.match(grid.innerHTML, /is-unknown/);
  assert.doesNotMatch(grid.innerHTML, /data-court-slot="live"/);
});

test('a late response for an earlier date cannot overwrite the active fallback calendar', async () => {
  const { context, api } = setup();
  let finish;
  context.fetch = () => new Promise(resolve => { finish = resolve; });
  const old = api.load();
  context.dateInput.value = '2099-11-05';
  context.fetch = async () => Response.json({}, { status: 502 });
  await api.load();
  finish(Response.json({}, { status: 502 }));
  await old;
  assert.equal(context.data.date, '2099-11-05');
  assert.equal(context.data.availabilityUnavailable, true);
});


test('bookings without a provider court ID remain visible even when the public court name has changed', async () => {
  const { context, api, grid } = setup();
  context.window.PadelKonto.getCourtBookings = async () => [{ ...booking, court_resource_id: null, court_name: 'Neuer Sponsor Indoor H2' }];
  await api.load();
  assert.match(grid.innerHTML, /Neuer Sponsor Indoor H2/);
  assert.equal(api.findSelectableSlot('booking-12').bookingId, 12);
});

test('the calendar explains provider failures while preserving bookings and discards unknown error text', async () => {
  const { context, api, grid, element } = setup();
  const cases = [
    ['playtomic_timeout', /Playtomic antwortet gerade nicht/],
    ['playtomic_unavailable', /Playtomic.*nicht erreichbar/],
    ['playtomic_access_denied', /Playtomic lässt die Platzabfrage.*nicht zu/],
    ['playtomic_login_required', /Playtomic akzeptiert die Anmeldung nicht mehr/],
    ['playtomic_rate_limited', /Zu viele Abfragen bei Playtomic/],
    ['playtomic_invalid_response', /Playtomic.*nicht lesbar/],
    ['unknown', /Ursache noch unklar/],
    ['__proto__', /Ursache noch unklar/],
  ];
  for (const [reason, message] of cases) {
    context.fetch = async () => Response.json({ source: 'playtomic', reason, error: '<script>secret</script>' }, { status: 502 });
    await api.load();
    const text = element('[data-court-outage-reason]').textContent;
    assert.match(text, message);
    assert.doesNotMatch(text, /secret|<script>/);
    if (reason === 'playtomic_access_denied') assert.doesNotMatch(text, /abgelaufen|nicht mehr akzeptiert/);
    assert.match(grid.innerHTML, /data-court-slot="booking-12"/);
    context.filter = 'outdoor';
    api.renderGrid();
    assert.equal(element('[data-court-outage-reason]').textContent, text);
    context.filter = 'indoor';
  }
  for (const upstream of [
    async () => { throw new Error('browser offline'); },
    async () => new Response('Gateway Timeout', { status: 504 }),
    async () => Response.json({ source: 'unknown', reason: 'playtomic_login_required' }, { status: 502 }),
  ]) {
    context.fetch = upstream;
    await api.load();
    assert.match(element('[data-court-outage-reason]').textContent, /Ursache noch unklar/);
  }
  context.fetch = async () => Response.json({ date, courts: [], slots: [], opening: { from: '07:00', until: '24:00' } });
  await api.load();
  assert.equal(element('[data-court-outage-reason]').textContent, '');
  assert.equal(element('[data-court-outage]').hidden, true);
});
