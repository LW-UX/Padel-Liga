// Outlook's German inline header contains a local, minute-precision date.
// It is content from an already authenticated, explicitly allowed forwarder;
// the displayed original From field is never an authentication mechanism.
export function readOutlookForward(text: string, timezone = "Europe/Berlin") {
  const normalized = text.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
  const headers = [...normalized.matchAll(/^Von:[ \t]*/gm)];
  if (!headers.length) return null;
  if (headers.length !== 1) throw new Error("multiple_forwarded_messages");
  const match = normalized.slice(headers[0].index).match(/^Von:\s*([^\n]+)\n\s*(?:Datum|Gesendet):\s*([^\n]+)\n\s*An:\s*[^\n]+\n\s*Betreff:\s*([^\n]+)\n([\s\S]*)$/);
  if (!match || !/^Playtomic\s*<no-reply@playtomic\.io>$/i.test(match[1].trim())) throw new Error("invalid_forwarded_header");
  const date = /^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag),\s*(\d{1,2})\.\s*(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+(\d{4})\s+um\s+(\d{2}:\d{2})$/.exec(match[2].trim());
  if (!date || !/^([01]\d|2[0-3]):[0-5]\d$/.test(date[5])) throw new Error("invalid_forwarded_date");
  const months = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const day = `${date[4]}-${String(months.indexOf(date[3]) + 1).padStart(2, "0")}-${date[2].padStart(2, "0")}`;
  const noon = new Date(`${day}T12:00:00Z`);
  if (!Number.isFinite(noon.getTime()) || noon.toISOString().slice(0, 10) !== day
    || new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: timezone }).format(noon) !== date[1]) {
    throw new Error("invalid_forwarded_date");
  }
  const wall = Date.parse(`${day}T${date[5]}:00Z`);
  const format = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const candidates = [1, 2].map(offset => wall - offset * 3600000)
    .filter(value => format.format(new Date(value)) === `${day} ${date[5]}`);
  if (candidates.length !== 1) throw new Error("ambiguous_forwarded_date");
  return { subject: match[3].trim(), text: match[4].trim(),
    occurredAt: new Date(candidates[0]).toISOString(), precisionSeconds: 60 };
}
