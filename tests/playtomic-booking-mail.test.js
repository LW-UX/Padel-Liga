const assert = require('node:assert/strict');
const test = require('node:test');
const modulePromise = import('../supabase/functions/_shared/playtomic-booking-mail.ts');

// Mail structure matches the supplied samples; no original mail or personal
// headers, payment information, tracking URLs or real booking IDs are stored.
const confirmation = (date = '06.10.26', range = '12:30-13:30') => ({
  subject: 'Playtomic - Buchungsbestätigung / Ticket',
  text: `Buchungsbestätigung / Ticket\nReservierungsdaten\nName Testgruppe\nDatum ${date}\nZeit ${range}\nClub Lucky Star Padel @ Das Anders , Indoor H2\nInfos über die Bezahlung\nZahlungsdatum 01.10.26, 10:55`,
});
const cancellation = (date = '06.10.26', time = '12:30', court = 'Indoor H2', duration = 60) => ({
  subject: 'Buchung storniert',
  text: `Testgruppe hat ein Match von Padel abgebrochen\n\nDie Reservierung wurde vom Veranstalter abgesagt und ist nicht mehr verfügbar.\n\nSport Padel\nDatum und Uhrzeit ${date}, ${time}\nOrt Lucky Star Padel @ Das Anders\nCourt ${court}\nDauer ${duration} Minuten`,
});
const calendar = (start = '20261006T103000Z', end = '20261006T113000Z') =>
  `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:00000000-0000-0000-0000-000000000001@playtomic.io\r\nDTSTART:${start}\r\nDTEND:${end}\r\nLOCATION:Lucky Star Padel @ Das Anders \r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

test('Bestätigung und Stornierung desselben Termins passen zusammen', async () => {
  const { parsePlaytomicBookingMail: parse, sameBookingSlot } = await modulePromise;
  const booking = parse({ ...confirmation(), calendar: calendar() });
  const cancelled = parse(cancellation());
  assert.equal(booking.providerId, '00000000-0000-0000-0000-000000000001');
  assert.equal(cancelled.providerId, null);
  assert.equal(booking.state, 'confirmed');
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(booking.date, '2026-10-06');
  assert.equal(booking.time, '12:30');
  assert.equal(booking.duration, 60);
  assert.equal(sameBookingSlot(booking, cancelled), true);
});

test('andere Termine, Plätze, Dauern und Buchende werden nicht zugeordnet', async () => {
  const { parsePlaytomicBookingMail: parse, sameBookingSlot } = await modulePromise;
  assert.equal(sameBookingSlot(parse(confirmation('13.11.26', '12:00-13:00')),
    parse(cancellation('08.10.26', '18:00', 'CUPRA Court 2', 90))), false);
  for (const message of [cancellation('07.10.26'), cancellation(undefined, '13:00'),
    cancellation(undefined, undefined, 'Indoor H1'), cancellation(undefined, undefined, undefined, 90),
    { ...cancellation(), text: cancellation().text.replace('Testgruppe', 'Andere Gruppe') }]) {
    assert.equal(sameBookingSlot(parse(confirmation()), parse(message)), false);
  }
});

test('Weiterleitungsbetreff, CRLF und getrennte Beschriftungen werden gelesen', async () => {
  const { parsePlaytomicBookingMail: parse } = await modulePromise;
  const original = confirmation();
  const forwarded = { subject: `WG: Fwd: ${original.subject}`,
    text: original.text.replace(/^(Name|Datum|Zeit|Club) /gm, '$1\n').replace(/\n/g, '\r\n') };
  assert.deepEqual(parse(forwarded), parse(original));
});

test('90 Minuten und Ende nach Mitternacht behalten die tatsächliche Dauer', async () => {
  const { parsePlaytomicBookingMail: parse } = await modulePromise;
  assert.equal(parse(cancellation('08.10.26', '18:00', 'CUPRA Court 2', 90)).duration, 90);
  assert.equal(parse(confirmation(undefined, '23:30-01:00')).duration, 90);
});

test('Zahlungsdatum ersetzt keinen fehlenden Termin; ungültige Werte werden abgewiesen', async () => {
  const { parsePlaytomicBookingMail: parse } = await modulePromise;
  for (const message of [confirmation('31.02.26'), confirmation(undefined, '25:00-26:00'),
    confirmation(undefined, '12:30-12:30'), cancellation(undefined, undefined, undefined, 0),
    { ...confirmation(), text: confirmation().text.replace('Datum 06.10.26\n', '') },
    { ...confirmation(), text: confirmation().text.replace('Lucky Star', 'Anderer Club') },
    { ...cancellation(), text: cancellation().text.replace('Sport Padel', 'Sport Tennis') },
    { ...confirmation(), subject: 'Beliebige Nachricht' }]) assert.throws(() => parse(message));
});

test('Kalenderzeiten müssen einschließlich Sommer-/Winterzeit zur Mail passen', async () => {
  const { parsePlaytomicBookingMail: parse } = await modulePromise;
  assert.ok(parse({ ...confirmation('13.11.26', '12:00-13:00'), calendar: calendar('20261113T110000Z', '20261113T120000Z') }));
  for (const value of [calendar('20261006T113000Z', '20261006T123000Z'),
    calendar('20261006T103000Z', '20261006T120000Z'),
    calendar().replace('20261006T103000Z', '20260230T103000Z'),
    calendar().replace('END:VEVENT', 'END:VEVENT\r\nBEGIN:VEVENT\r\nEND:VEVENT')]) {
    assert.throws(() => parse({ ...confirmation(), calendar: value }));
  }
});
