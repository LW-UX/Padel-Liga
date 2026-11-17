import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { isDate } from '../supabase/functions/court-availability/data.ts';
import { normalizeAvailabilityCookie, normalizeBrowserUserAgent } from '../supabase/functions/court-availability-probe/browser-cookie.ts';

const messages = {
  playtomic_access_denied: 'Playtomic weist den Abruf auch mit diesem Cookie ab. Es wurde nichts gespeichert.',
  playtomic_login_required: 'Playtomic akzeptiert diese Anmeldung nicht. Es wurde nichts gespeichert.',
  playtomic_timeout: 'Playtomic antwortet gerade nicht rechtzeitig. Es wurde nichts gespeichert.',
  playtomic_unavailable: 'Playtomic ist für unseren Server gerade nicht erreichbar. Es wurde nichts gespeichert.',
  playtomic_rate_limited: 'Playtomic begrenzt gerade die Abfragen. Bitte später erneut versuchen. Es wurde nichts gespeichert.',
  playtomic_invalid_response: 'Playtomic liefert keine lesbaren Platzdaten. Es wurde nichts gespeichert.',
};

// Invoked only through the approved Supabase helper. Credentials stay in memory;
// the browser session is persisted only after the user submits and the server probe succeeds.
export async function startAvailabilitySessionSetup({ date, probe, storeSession, onResult = () => {}, lifetimeMs = 30 * 60 * 1000 }) {
  if (!isDate(date) || typeof probe !== 'function' || typeof storeSession !== 'function') throw new Error('Ungültige Einrichtung.');
  const path = `/${randomUUID()}`;
  const nonce = randomUUID();
  let completed = false, busy = false, finish;
  const done = new Promise(resolve => { finish = resolve; });
  const page = (message = '') => `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Playtomic-Cookie prüfen</title>
    <style nonce="${nonce}">body{font:16px/1.5 system-ui,sans-serif;max-width:700px;margin:40px auto;padding:0 20px;color:#222}input,button{font:inherit;box-sizing:border-box;padding:10px}input[type=password]{width:100%}label{display:block;margin:18px 0}button{cursor:pointer}li{margin:8px 0}.notice{padding:12px;background:#f2f2f2}</style>
    <h1>Playtomic-Cookie prüfen</h1>
    ${message ? `<p class="notice" role="status">${message}</p>` : ''}
    <p>Wir prüfen vom Liga-Server aus, ob dieser Cookie freie Plätze laden kann. Erst bei erfolgreichem Test wird er getrennt als geschütztes Server-Secret gespeichert. Der Hallencode-Zugang bleibt unverändert.</p>
    <ol><li>Öffne die <a href="https://playtomic.com/clubs/lucky-star-padel" target="_blank" rel="noopener noreferrer">Playtomic-Clubseite</a> und zeige die freien Plätze an.</li>
    <li>Öffne in Firefox die Netzwerkanalyse mit <strong>⌥⌘E</strong>. Lade die Playtomic-Seite neu und öffne die freien Plätze erneut.</li>
    <li>Suche in der Anfrageliste nach <strong>availability</strong>. Wähle eine erfolgreich geladene Anfrage (Status 200). Unter <strong>Kopfzeilen → Anfragekopfzeilen → Cookie</strong> kopierst du den vollständigen Wert. Gemeint ist „Cookie“, nicht „Set-Cookie“.</li>
    <li>Füge den Wert unten ein. Bitte keine Cookies in den Chat kopieren.</li></ol>
    <p>Öffne diese Eingabeseite im selben Browser wie Playtomic. Falls du keine erfolgreiche „availability“-Anfrage findest, gib im Chat Bescheid.</p>
    <form method="post"><label>Prüftag <input type="date" name="date" value="${date}" required></label>
    <label>Cookie der Verfügbarkeitsanfrage <input type="password" name="session" autocomplete="off" spellcheck="false" required></label>
    <input type="hidden" name="userAgent" id="user-agent"><button type="submit">Prüfen und bei Erfolg speichern</button></form>
    <p>Nur lesende Abfragen. Keine Buchungen oder Kontoänderungen. Erneuerungstoken und bekannte Analyse-/Zahlungscookies werden entfernt.</p>
    <script nonce="${nonce}">document.getElementById('user-agent').value=navigator.userAgent;</script></html>`;
  const server = createServer(async (request, response) => {
    const respond = (status, text, html = false) => {
      response.writeHead(status, { 'Content-Type': html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` });
      response.end(text);
    };
    const origin = `http://127.0.0.1:${server.address()?.port}`;
    if (request.headers.host !== new URL(origin).host || request.url !== path || completed) return respond(404, 'Nicht verfügbar.');
    if (request.method === 'GET') return respond(200, page(), true);
    if (request.method !== 'POST' || request.headers.origin !== origin) return respond(403, 'Nicht erlaubt.');
    if (busy) return respond(409, 'Der Test läuft bereits.');
    busy = true;
    let raw = '', cookie = '';
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 100_000) return respond(413, 'Eingabe zu groß.');
        chunks.push(chunk);
      }
      raw = Buffer.concat(chunks).toString('utf8');
      chunks.length = 0;
      const fields = new URLSearchParams(raw);
      raw = '';
      const testDate = fields.get('date');
      if (!isDate(testDate)) return respond(400, page('Bitte einen gültigen Prüftag wählen.'), true);
      try {
        cookie = normalizeAvailabilityCookie(fields.get('session') || '');
        fields.delete('session');
      } catch { return respond(400, page('Bitte den vollständigen Cookie-Wert der Verfügbarkeitsanfrage einfügen.'), true); }
      const userAgent = normalizeBrowserUserAgent(fields.get('userAgent') || '');
      const result = await probe({ date: testDate, cookie, userAgent });
      // Only explicit, validated success can authorize persistence.
      if (result?.state !== 'available' || !Number.isInteger(result.courts) || result.courts <= 0
        || !Number.isInteger(result.slots) || result.slots < 0) {
        const reason = Object.hasOwn(messages, result?.error) ? result.error : 'probe_unavailable';
        onResult({ state: 'failed', reason });
        return respond(502, page(messages[reason] || 'Der Test konnte nicht abgeschlossen werden. Es wurde nichts gespeichert.'), true);
      }
      await storeSession({ cookie, userAgent });
      cookie = '';
      onResult({ state: 'stored', courts: result.courts, slots: result.slots });
      completed = true;
      respond(200, 'Test erfolgreich. Der separate Verfügbarkeits-Cookie ist auf dem Server gespeichert. Die Hallencode-Sitzung blieb unverändert. Du kannst diese Seite schließen.');
      stop('stored');
    } catch {
      onResult({ state: 'failed', reason: 'setup_unavailable' });
      respond(502, page('Test oder Server-Hinterlegung fehlgeschlagen. Bitte erneut versuchen.'), true);
    } finally { raw = ''; cookie = ''; busy = false; }
  });
  const stop = state => {
    completed = true;
    clearTimeout(expiry);
    server.close();
    server.closeIdleConnections();
    finish(state);
  };
  const expiry = setTimeout(() => stop('expired'), lifetimeMs);
  await new Promise((resolve, reject) => {
    server.once('error', error => { clearTimeout(expiry); reject(error); });
    server.listen(0, '127.0.0.1', resolve);
  });
  return { url: `http://127.0.0.1:${server.address().port}${path}`, done, close: () => stop('closed') };
}
