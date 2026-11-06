const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

test('Outlook HTML from the shared previews is decoded without original files or tracking URLs', {
  skip: !process.env.PADEL_HTML_TO_TEXT_MODULE && 'Set PADEL_HTML_TO_TEXT_MODULE to the installed html-to-text module',
}, async () => {
  const { convert } = await import(pathToFileURL(process.env.PADEL_HTML_TO_TEXT_MODULE).href);
  const { readOutlookForward } = await import('../supabase/functions/receive-court-booking/outlook-forward.ts');
  const { parsePlaytomicBookingMail } = await import('../supabase/functions/_shared/playtomic-booking-mail.ts');
  // Structure observed in the Resend previews, with personal data removed.
  const row = (label, value) => `<div class="table-row"><span><b>${label} </b></span><span>${value}</span></div>`;
  for (const duration of [60, 90]) {
    for (const cancelled of [false, true]) {
      const subject = cancelled ? 'Buchung storniert' : 'Playtomic - Buchungsbestätigung / Ticket';
      const date = cancelled ? 'Montag, 5. Oktober 2026 um 11:21' : 'Donnerstag, 1. Oktober 2026 um 10:56';
      const body = cancelled ? `<h1>Testgruppe hat ein Match von Padel abgebrochen</h1>
        <p>Die Reservierung wurde vom Veranstalter abgesagt und ist nicht mehr verfügbar.</p>
        ${row('Sport', 'Padel')}${row('Datum und Uhrzeit', '06.10.26, 12:30')}
        ${row('Ort', 'Lucky Star Padel @ Das Anders')}${row('Court', 'Indoor H2')}${row('Dauer', `${duration} Minuten`)}`
        : `<h1>Buchungsbestätigung / Ticket</h1><h2>Reservierungsdaten</h2>
          ${row('Name', 'Testgruppe')}${row('Datum', '06.10.26')}${row('Zeit', duration === 60 ? '12:30-13:30' : '12:30-14:00')}
          ${row('Club', 'Lucky Star Padel @ Das Anders , Indoor H2')}<h2>Infos über die Bezahlung</h2>`;
      const html = `<html><body><div id="ms-outlook-mobile-signature">Testsignatur</div>
        <div id="mail-editor-reference-message-container"><div><b>Von: </b>Playtomic &lt;no-reply@playtomic.io&gt;<br>
        <b>Datum: </b>${date}<br><b>An: </b>Test &lt;test@example.com&gt;<br><b>Betreff: </b>${subject}<br><br></div>
        <div id="mail-editor-reference-message-body">${body}</div></div></body></html>`;
      const text = convert(html, { wordwrap: false, selectors: [
        { selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' },
        ...['h1', 'h2', 'h3'].map(selector => ({ selector, options: { uppercase: false } })),
      ] });
      const forwarded = readOutlookForward(text);
      const booking = parsePlaytomicBookingMail(forwarded);
      assert.equal(booking.duration, duration);
      assert.equal(booking.state, cancelled ? 'cancelled' : 'confirmed');
      assert.equal(booking.time, '12:30');
      assert.equal(forwarded.occurredAt, cancelled ? '2026-10-05T09:21:00.000Z' : '2026-10-01T08:56:00.000Z');
    }
  }
});
