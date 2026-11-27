const assert = require('node:assert/strict');
const test = require('node:test');

const planning = import('../supabase/functions/court-planning/planning.ts');
const outlook = import('../supabase/functions/court-planning/outlook.ts');
const date = '2026-11-27';
const utc = time => Date.parse(`${date}T${time}:00Z`);
const period = (start, end) => ({ start: utc(start), end: utc(end) });
const asClock = time => ({ dateTime: `${date}T${time}:00.0000000`, timeZone: 'UTC' });
const asEvent = (start, end, showAs = 'busy') => ({ start: asClock(start), end: asClock(end), showAs });

test('merges consecutive times across calendars, but preserves a whole free column', async () => {
  const { mergePeriods, outlookColumns, berlinMidnight, berlinDateOffset } = await planning;
  const merged = mergePeriods([period('13:30', '15:00'), period('15:30', '16:00'), period('13:00', '13:30'), period('14:00', '15:00')]);
  assert.deepEqual(merged, [period('13:00', '15:00'), period('15:30', '16:00')]);
  assert.deepEqual(outlookColumns(merged, date), ['14:00', '14:30', '15:00', '15:30', '16:30']);
  assert.equal(berlinDateOffset('2026-12-31', 1), '2027-01-01');
  assert.equal(berlinMidnight('2026-10-26') - berlinMidnight('2026-10-25'), 25 * 60 * 60 * 1000);
  assert.equal(berlinMidnight('2027-03-29') - berlinMidnight('2027-03-28'), 23 * 60 * 60 * 1000);
});

test('a just-ended meeting needs a 30-minute group buffer and exact buffer boundaries are valid', async () => {
  const { fitsOutlook } = await planning;
  const play = period('13:00', '14:00');
  assert.equal(fitsOutlook(play, [period('14:15', '14:45')]), true);
  assert.equal(fitsOutlook(play, [period('14:14', '14:45')]), false);
  assert.equal(fitsOutlook(play, [period('12:00', '13:00'), period('14:15', '14:45')]), false);
  assert.equal(fitsOutlook(play, [period('12:00', '13:00'), period('14:30', '14:45')]), true);
  assert.equal(fitsOutlook(play, [period('12:00', '12:59'), period('14:15', '14:45')]), true);
});

test('scores at 10:30 and 14:30, allows zero wishes, and excludes overlap and occupied courts', async () => {
  const { rankSlots, bestSlot, suggestionState, timePreference } = await planning;
  assert.deepEqual(['10:00', '10:30', '14:30', '15:00'].map(timePreference), ['morning', 'midday', 'midday', 'evening']);
  const slots = ['09:00', '09:30', '13:30', '14:00'].flatMap(start => ['court2', 'court1'].map(courtId => ({
    id: `${courtId}/${start}`, courtId, start: new Date(utc(start)).toISOString(),
    end: new Date(utc(start) + 60 * 60_000).toISOString(), time: `${Number(start.slice(0, 2)) + 1}:${start.slice(3)}`,
  })));
  const day = { date, opening: { from: '07:00', until: '23:00' }, slots,
    courts: ['court1', 'court2'].map(id => ({ id, location: 'indoor', name: id })) };
  const booked = [{ court_resource_id: 'court1', court_name: 'H1',
    starts_at: new Date(utc('14:00')).toISOString(), ends_at: new Date(utc('15:00')).toISOString() }];
  const ranked = rankSlots(day, 'indoor', [], [period('13:00', '14:00')], booked, ['evening'], utc('08:00'));
  assert.equal(bestSlot(ranked).slot.id, 'court2/14:00');
  const neutral = bestSlot(rankSlots(day, 'indoor', [], [], [], [null], utc('08:00')));
  assert.equal(neutral.slot.id, 'court1/09:00');
  assert.equal(neutral.score, 0);
  assert.equal(suggestionState(neutral, false).state, 'suggested');
  assert.equal(suggestionState(null, false).state, 'hidden');
  assert.equal(suggestionState(null, true).state, 'no_match');
});

test('all Outlook requests select only time and availability fields and skip exact Berlin lunch', async () => {
  const { readOutlookPeriods } = await outlook;
  const emails = ['a@test.invalid', 'b@test.invalid', 'c@test.invalid', 'owner@test.invalid'];
  const range = period('10:00', '16:00');
  const paths = [];
  const fetcher = async (url, options) => {
    const path = decodeURIComponent(url.pathname);
    paths.push(path);
    assert.equal(options.method, 'GET');
    assert.equal(url.searchParams.get('$select'), 'start,end,showAs,isCancelled');
    if (path.includes('/users/a@')) {
      return Response.json({ value: [asEvent('11:00', '12:00')] });
    }
    if (path.includes('/users/b@') && !url.searchParams.has('$skiptoken')) {
      const next = new URL(url);
      next.searchParams.set('$skiptoken', 'second-page');
      return Response.json({ value: [], '@odata.nextLink': next.href });
    }
    if (path.includes('/users/b@')) {
      return Response.json({ value: [asEvent('11:45', '12:15')] });
    }
    if (path.includes('/users/c@')) return Response.json({ value: [] });
    assert.equal(path, '/v1.0/me/calendarView');
    return Response.json({ value: [asEvent('11:15', '11:30'), { ...asEvent('13:00', '14:00'), isCancelled: true }] });
  };
  assert.deepEqual(await readOutlookPeriods('token', emails[3], emails, range, fetcher), [
    period('11:45', '12:15'), period('11:15', '11:30'),
  ]);
  assert.equal(paths.length, 5);
  assert.deepEqual(new Set(paths), new Set(['/v1.0/me/calendarView',
    ...emails.slice(0, 3).map(email => '/v1.0/users/' + email + '/calendarView')]));
});

test('an unreachable calendar, extra fields or an unrestricted next link make Outlook unavailable', async () => {
  const { readOutlookPeriods } = await outlook;
  const emails = ['a@test.invalid', 'b@test.invalid', 'c@test.invalid', 'd@test.invalid'];
  for (const failure of ['denied', 'extra_fields', 'missing_selection']) {
    const paths = [];
    const fetcher = async url => {
      paths.push(url);
      assert.equal(url.searchParams.get('$select'), 'start,end,showAs,isCancelled');
      if (!decodeURIComponent(url.pathname).includes('/users/a@')) return Response.json({ value: [] });
      if (failure === 'denied') return new Response(null, { status: 403 });
      if (failure === 'extra_fields') return Response.json({ value: [{ ...asEvent('11:00', '12:00'), subject: 'private' }] });
      const next = new URL(url);
      next.searchParams.delete('$select');
      return Response.json({ value: [], '@odata.nextLink': next.href });
    };
    await assert.rejects(readOutlookPeriods('token', 'owner@test.invalid', emails, period('10:00', '16:00'), fetcher),
      /calendar_unavailable/);
    assert.equal(paths.length, 4);
    assert.ok(paths.every(url => url.pathname.endsWith('/calendarView')));
  }
});
