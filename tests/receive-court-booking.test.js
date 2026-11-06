const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../supabase/functions/receive-court-booking/handler.ts');
const recipient = 'buchungen@kiroimyon.resend.app';
const id = '00000000-0000-0000-0000-000000000001';
const text = 'Reservierungsdaten\nName Testgruppe\nDatum 06.10.26\nZeit 12:30-13:30\nClub Lucky Star Padel @ Das Anders , Indoor H2\nInfos über die Bezahlung';
const mail = () => ({ from: { address: 'no-reply@playtomic.io' }, date: '2026-10-01T08:55:40Z',
  subject: 'Playtomic - Buchungsbestätigung / Ticket', text, attachments: [] });

async function setup(overrides = {}) {
  const { createBookingWebhook } = await modulePromise;
  const writes = [], requests = [];
  const received = { to: [recipient], from: 'Forwarder <booker@example.com>',
    authentication: { dmarc: 'pass' }, raw: { download_url: 'https://download.example.com/mail' } };
  const config = { apiKey: 'test-key', signingSecret: 'test-secret', recipient, forwarders: ['booker@example.com'] };
  const deps = {
    verify: body => JSON.parse(body),
    parseMime: async () => mail(),
    record: async params => { writes.push(params); return { status: 'active' }; },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return new Response(url.startsWith('https://api.resend.com/') ? JSON.stringify(received) : 'raw mail');
    },
    ...overrides.deps,
  };
  const handler = createBookingWebhook({ ...config, ...overrides.config }, deps);
  const send = async (event = { type: 'email.received', data: { email_id: id } }) => {
    const response = await handler(new Request('https://project.example.com/webhook', {
      method: 'POST', body: JSON.stringify(event), headers: { 'svix-id': 'test-event' },
    }));
    return { status: response.status, body: await response.json() };
  };
  return { handler, send, writes, requests, received };
}

test('signierter Eingang lädt Mail und schreibt ausschließlich normalisierte RPC-Werte', async () => {
  const ctx = await setup();
  assert.equal((await ctx.send()).body.status, 'processed');
  assert.deepEqual(ctx.writes, [{ p_provider_booking_id: null, p_court_resource_id: null,
    p_court_name: 'Indoor H2', p_organizer: 'Testgruppe', p_starts_at: '2026-10-06T10:30:00.000Z',
    p_ends_at: '2026-10-06T11:30:00.000Z', p_cancelled: false, p_source_occurred_at: '2026-10-01T08:55:40.000Z', p_source_precision_seconds: 1 }]);
  assert.equal(ctx.requests[0].options.headers.Authorization, 'Bearer test-key');
  assert.equal(ctx.requests[1].options.headers, undefined, 'kein API-Key am Download');
});

test('fehlende Konfiguration und falsche Signatur lesen und schreiben nichts', async () => {
  for (const options of [{ config: { signingSecret: '' } }, { config: { forwarders: [] } },
    { deps: { verify: () => { throw new Error('invalid signature'); } } }]) {
    const ctx = await setup(options);
    assert.ok((await ctx.send()).status >= 400);
    assert.equal(ctx.requests.length, 0);
    assert.equal(ctx.writes.length, 0);
  }
});

test('fremder Empfänger, fremder Absender und fehlende DMARC-Bestätigung ändern nichts', async () => {
  for (const change of [received => { received.to = ['other@example.com']; },
    received => { received.from = 'attacker@example.com'; },
    received => { received.authentication.dmarc = 'fail'; }, received => { delete received.authentication; }]) {
    const ctx = await setup(); change(ctx.received);
    assert.notEqual((await ctx.send()).body.status, 'processed');
    assert.equal(ctx.requests.length, 1, 'kein Rohmailabruf für fremden Eingang');
    assert.equal(ctx.writes.length, 0);
  }
});

test('andere Events und ungültige Mail-IDs werden nicht abgerufen', async () => {
  const ctx = await setup();
  assert.equal((await ctx.send({ type: 'email.sent' })).body.status, 'ignored');
  assert.equal((await ctx.send({ type: 'email.received', data: { email_id: '../keys' } })).status, 400);
  assert.equal(ctx.requests.length, 0);
});

test('Umleitung übernimmt Originalabsender, Empfänger und sekundengenauen Zeitpunkt', async () => {
  const ctx = await setup({ config: { forwarders: ['no-reply@playtomic.io'], originalRecipients: ['booker@example.com'] },
    deps: { parseMime: async () => ({ ...mail(), to: [{ name: 'Test', address: 'Booker@example.com' }] }) } });
  ctx.received.from = 'Playtomic <no-reply@playtomic.io>';
  assert.equal((await ctx.send()).body.status, 'processed');
  assert.equal(ctx.writes[0].p_source_occurred_at, '2026-10-01T08:55:40.000Z');
  assert.equal(ctx.writes[0].p_source_precision_seconds, 1);
});

test('Umleitung nimmt keine Buchung für fremde Empfänger oder direkt an Resend an', async () => {
  for (const recipients of [undefined, [{ address: 'other@example.com' }], [{ address: recipient }]]) {
    const ctx = await setup({ config: { forwarders: ['no-reply@playtomic.io'], originalRecipients: ['booker@example.com'] },
      deps: { parseMime: async () => ({ ...mail(), to: recipients }) } });
    ctx.received.from = 'no-reply@playtomic.io';
    assert.equal((await ctx.send()).body.reason, 'original_recipient');
    assert.equal(ctx.writes.length, 0);
  }
});

test('Umleitung verlangt weiter DMARC und lehnt normale Weiterleitung im Umleitungsmodus ab', async () => {
  const ctx = await setup({ config: { forwarders: ['no-reply@playtomic.io'], originalRecipients: ['booker@example.com'] },
    deps: { parseMime: async () => ({ ...mail(), to: [{ address: 'booker@example.com' }] }) } });
  assert.equal((await ctx.send()).body.reason, 'sender_authentication');
  ctx.received.from = 'no-reply@playtomic.io';
  ctx.received.authentication.dmarc = 'fail';
  assert.equal((await ctx.send()).body.reason, 'sender_authentication');
  assert.equal(ctx.writes.length, 0);
});

test('Originalmail als Anlage liefert ursprüngliches Datum statt Weiterleitungszeit', async () => {
  let parses = 0;
  const ctx = await setup({ deps: { parseMime: async () => ++parses === 1 ? {
    ...mail(), from: { address: 'booker@example.com' }, date: '2026-11-06T00:00:00Z',
    attachments: [{ filename: 'original.eml', mimeType: 'message/rfc822', content: 'original' }],
  } : mail() } });
  assert.equal((await ctx.send()).body.status, 'processed');
  assert.equal(ctx.writes[0].p_source_occurred_at, '2026-10-01T08:55:40.000Z');
  assert.equal(parses, 2);
});

test('Inline-Weiterleitung ohne verlässliche Originalzeit wird zur Prüfung zurückgestellt', async () => {
  const ctx = await setup({ deps: { parseMime: async () => ({ ...mail(), from: { address: 'booker@example.com' } }) } });
  assert.equal((await ctx.send()).body.status, 'needs_review');
  assert.equal(ctx.writes.length, 0);
});

test('deutscher Outlook-Weiterleitungskopf liefert Originaldatum und minütliche Genauigkeit', async () => {
  const forwarded = { ...mail(), from: { address: 'booker@example.com' }, subject: 'WG: Padel',
    date: '2026-11-06T00:00:00Z', text: `Testsignatur\nVon: Playtomic <no-reply@playtomic.io>\nDatum: Donnerstag, 1. Oktober 2026 um 10:56\nAn: Test <booker@example.com>\nBetreff: Playtomic - Buchungsbestätigung / Ticket\n\n${text}` };
  const ctx = await setup({ deps: { parseMime: async () => forwarded } });
  assert.equal((await ctx.send()).body.status, 'processed');
  assert.equal(ctx.writes[0].p_source_occurred_at, '2026-10-01T08:56:00.000Z');
  assert.equal(ctx.writes[0].p_source_precision_seconds, 60);
});

test('Outlook-Stornierung und Buchung stimmen trotz verspäteter Weiterleitung im Slot überein', async () => {
  const body = `Testgruppe hat ein Match von Padel abgebrochen\n\nDie Reservierung wurde vom Veranstalter abgesagt und ist nicht mehr verfügbar.\n\nSport Padel\nDatum und Uhrzeit 06.10.26, 12:30\nOrt Lucky Star Padel @ Das Anders\nCourt Indoor H2\nDauer 60 Minuten`;
  const ctx = await setup({ deps: { parseMime: async () => ({ ...mail(), from: { address: 'booker@example.com' },
    subject: 'WG: Buchung storniert', date: '2026-11-06T00:00:00Z',
    text: `Von: Playtomic <no-reply@playtomic.io>\nDatum: Montag, 5. Oktober 2026 um 11:21\nAn: Test <booker@example.com>\nBetreff: Buchung storniert\n\n${body}` }) } });
  assert.equal((await ctx.send()).body.status, 'processed');
  assert.equal(ctx.writes[0].p_cancelled, true);
  assert.equal(ctx.writes[0].p_source_occurred_at, '2026-10-05T09:21:00.000Z');
  assert.equal(ctx.writes[0].p_starts_at, '2026-10-06T10:30:00.000Z');
});

test('uneindeutige, beschädigte und mehrfach zitierte Outlook-Datumszeilen ändern nichts', async () => {
  const { readOutlookForward } = await import('../supabase/functions/receive-court-booking/outlook-forward.ts');
  const header = date => `Von: Playtomic <no-reply@playtomic.io>\nDatum: ${date}\nAn: Test <test@example.com>\nBetreff: Buchung storniert\n\nBody`;
  for (const date of ['Montag, 31. Februar 2026 um 11:21', 'Dienstag, 5. Oktober 2026 um 11:21',
    'Sonntag, 25. Oktober 2026 um 02:30', 'Sonntag, 29. März 2026 um 02:30', 'Montag, 5. Oktober 2026 um 25:21']) {
    assert.throws(() => readOutlookForward(header(date)));
  }
  assert.throws(() => readOutlookForward(header('Montag, 5. Oktober 2026 um 11:21') + '\n' + header('Montag, 5. Oktober 2026 um 11:21')));
  assert.throws(() => readOutlookForward(header('Montag, 5. Oktober 2026 um 11:21').replace('no-reply@playtomic.io', 'attacker@example.com')));
  assert.equal(readOutlookForward(header('Montag, 5. Januar 2026 um 11:21')).occurredAt, '2026-01-05T10:21:00.000Z');
});

test('90-Minuten-Buchung wird nicht auf eine Stunde gekürzt', async () => {
  const ctx = await setup({ deps: { parseMime: async () => ({ ...mail(), text: text.replace('12:30-13:30', '12:30-14:00') }) } });
  const result = await ctx.send();
  assert.equal(result.body.status, 'processed');
  assert.equal(ctx.writes.length, 1);
  assert.equal(ctx.writes[0].p_starts_at, '2026-10-06T10:30:00.000Z');
  assert.equal(ctx.writes[0].p_ends_at, '2026-10-06T12:00:00.000Z');
});

test('nur 60 und 90 Minuten werden importiert, andere Dauern benötigen Prüfung', async () => {
  for (const end of ['13:00', '14:30']) {
    const ctx = await setup({ deps: { parseMime: async () => ({ ...mail(), text: text.replace('12:30-13:30', `12:30-${end}`) }) } });
    assert.equal((await ctx.send()).body.reason, 'unsupported_duration');
    assert.equal(ctx.writes.length, 0);
  }
});

test('Stornierung übergibt den Originalzeitpunkt und den Stornierungsstatus', async () => {
  for (const duration of [60, 90]) {
  const ctx = await setup({ deps: { parseMime: async () => ({ ...mail(), subject: 'Buchung storniert',
    date: '2026-10-05T09:21:17Z', text: `Testgruppe hat ein Match von Padel abgebrochen\n\nDie Reservierung wurde vom Veranstalter abgesagt und ist nicht mehr verfügbar.\n\nSport Padel\nDatum und Uhrzeit 06.10.26, 12:30\nOrt Lucky Star Padel @ Das Anders\nCourt Indoor H2\nDauer ${duration} Minuten` }) } });
  assert.equal((await ctx.send()).body.status, 'processed');
  assert.equal(ctx.writes[0].p_cancelled, true);
  assert.equal(ctx.writes[0].p_source_occurred_at, '2026-10-05T09:21:17.000Z');
  assert.equal(Date.parse(ctx.writes[0].p_ends_at) - Date.parse(ctx.writes[0].p_starts_at), duration * 60000);
  }
});

test('Sommer/Winterzeit korrekt, doppelte oder fehlende Zeitumstellungsstunde wird abgewiesen', async () => {
  const { bookingInstants } = await modulePromise;
  const input = { timezone: 'Europe/Berlin', duration: 60, date: '2026-11-13', time: '12:00' };
  assert.equal(bookingInstants(input).start, '2026-11-13T11:00:00.000Z');
  assert.equal(bookingInstants({ ...input, date: '2026-07-01' }).start, '2026-07-01T10:00:00.000Z');
  for (const date of ['2026-10-25', '2026-03-29']) assert.throws(() => bookingInstants({ ...input, date, time: '02:30' }));
});

test('temporärer Datenbankfehler fordert Wiederholung an ohne Fehlerdetails preiszugeben', async () => {
  const ctx = await setup({ deps: { record: async () => { throw new Error('private-token-or-mail'); } } });
  const result = await ctx.send();
  assert.equal(result.status, 503);
  assert.equal(JSON.stringify(result).includes('private-token'), false);
});

test('überlange Anfrage wird vor Signaturprüfung und API-Abruf abgewiesen', async () => {
  let verified = false;
  const ctx = await setup({ deps: { verify: () => { verified = true; } } });
  const response = await ctx.handler(new Request('https://project.example.com/webhook', { method: 'POST', body: 'a'.repeat(150000) }));
  assert.equal(response.status, 400);
  assert.equal(verified, false);
  assert.equal(ctx.requests.length, 0);
});

test('bestätigte Kontoadressen dürfen dynamisch weiterleiten und verlieren die Freigabe bei einer Adressänderung', async () => {
  const registered = new Set(['member@example.com']);
  const lookups = [];
  const ctx = await setup({ config: { forwarders: [] }, deps: {
    hasRegisteredEmail: async emails => { lookups.push(emails); return emails.some(email => registered.has(email)); },
    parseMime: async () => ({ ...mail(), from: { address: 'member@example.com' },
      text: `Von: Playtomic <no-reply@playtomic.io>\nDatum: Donnerstag, 1. Oktober 2026 um 10:56\nAn: Test <member@example.com>\nBetreff: Playtomic - Buchungsbestätigung / Ticket\n\n${text}` }),
  } });
  ctx.received.from = 'Member <MEMBER@example.com>';
  assert.equal((await ctx.send()).body.status, 'processed');
  assert.deepEqual(lookups, [['member@example.com']]);
  registered.clear();
  assert.equal((await ctx.send()).body.reason, 'sender_authentication');
  assert.equal(ctx.writes.length, 1);
});

test('neue registrierte Originalempfänger sind bei Umleitungen ohne statischen Eintrag erlaubt', async () => {
  const ctx = await setup({ config: { forwarders: ['no-reply@playtomic.io'], originalRecipients: [] }, deps: {
    hasRegisteredEmail: async emails => emails.includes('new@example.com'),
    parseMime: async () => ({ ...mail(), to: [{ group: [{ address: 'NEW@example.com' }] }] }),
  } });
  ctx.received.from = 'no-reply@playtomic.io';
  assert.equal((await ctx.send()).body.status, 'processed');
});

test('Kontoprüfung erfolgt erst nach Signatur, Empfangsadresse und DMARC; anonyme Originalempfänger bleiben gesperrt', async () => {
  for (const change of [ctx => { ctx.received.to = ['elsewhere@example.com']; },
    ctx => { ctx.received.authentication.dmarc = 'fail'; }]) {
    const ctx = await setup({ deps: { hasRegisteredEmail: async () => assert.fail('Kein Kontolookup vor Authentifizierung') } });
    change(ctx);
    assert.notEqual((await ctx.send()).body.status, 'processed');
    assert.equal(ctx.writes.length, 0);
  }
  const ctx = await setup({ config: { forwarders: ['no-reply@playtomic.io'], originalRecipients: [] }, deps: {
    hasRegisteredEmail: async () => false,
    parseMime: async () => ({ ...mail(), to: [{ address: 'stranger@example.com' }] }),
  } });
  ctx.received.from = 'no-reply@playtomic.io';
  assert.equal((await ctx.send()).body.reason, 'original_recipient');
  assert.equal(ctx.writes.length, 0);
});

test('Fehler bei der Kontoprüfung führen zur Wiederholung und geben keine privaten Details aus', async () => {
  const ctx = await setup({ deps: { hasRegisteredEmail: async () => { throw Error('private-account-data'); } } });
  ctx.received.from = 'member@example.com';
  const response = await ctx.send();
  assert.equal(response.status, 503);
  assert.equal(ctx.writes.length, 0);
  assert.equal(ctx.requests.length, 1);
  assert.equal(JSON.stringify(response).includes('private-account-data'), false);
});

test('eine Kontofreigabe ersetzt weder Playtomic-Mailformat noch die explizite Umleitungsquelle', async () => {
  const ctx = await setup({ config: { forwarders: [] }, deps: {
    hasRegisteredEmail: async () => true,
    parseMime: async () => ({ from: { address: 'member@example.com' }, subject: 'Hallo', text: 'Beliebige Mail', attachments: [] }),
  } });
  ctx.received.from = 'member@example.com';
  assert.equal((await ctx.send()).body.status, 'needs_review');
  assert.equal(ctx.writes.length, 0);
  ctx.received.from = 'no-reply@playtomic.io';
  assert.equal((await ctx.send()).body.reason, 'sender_authentication');
  assert.equal(ctx.writes.length, 0);
});
