const germanMonths = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const englishMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const germanDate = /^([A-Za-z]+),\s*(\d{1,2})\.\s*([A-Za-zÄä]+)\s+(\d{4})\s+um\s+((?:[01]\d|2[0-3]):[0-5]\d)$/;
const englishDate = /^([A-Za-z]+),\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(0?[1-9]|1[0-2]):([0-5]\d)\s+(AM|PM)$/;
export const outlookFromHeader = /^(?:Von|From):[ \t]*/gm;

function parseOutlookDate(value: string) {
  const german = germanDate.exec(value);
  if (german) {
    const [, weekday, day, month, year, time] = german;
    return { weekday, day, month: germanMonths.indexOf(month) + 1, year, time };
  }
  const english = englishDate.exec(value);
  if (!english) throw new Error("invalid_forwarded_date");
  const [, weekday, month, day, year, hour, minute, period] = english;
  const hour24 = Number(hour) % 12 + (period === "PM" ? 12 : 0);
  return { weekday, day, month: englishMonths.indexOf(month) + 1, year,
    time: `${String(hour24).padStart(2, "0")}:${minute}` };
}

// Outlook's inline header contains a local, minute-precision date.
// It is content from an already authenticated, explicitly allowed forwarder;
// the displayed original From field is never an authentication mechanism.
export function readOutlookForward(text: string, timezone = "Europe/Berlin") {
  const normalized = text.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
  const headers = [...normalized.matchAll(outlookFromHeader)];
  if (!headers.length) return null;
  if (headers.length !== 1) throw new Error("multiple_forwarded_messages");
  const match = normalized.slice(headers[0].index).match(/^(?:Von|From):\s*([^\n]+)\n\s*(?:Datum|Gesendet|Date|Sent):\s*([^\n]+)\n\s*(?:An|To):\s*[^\n]+\n\s*(?:Betreff|Subject):\s*([^\n]+)\n([\s\S]*)$/);
  if (!match || !/^Playtomic\s*<no-reply@playtomic\.io>$/i.test(match[1].trim())) throw new Error("invalid_forwarded_header");
  const date = parseOutlookDate(match[2].trim());
  const day = `${date.year}-${String(date.month).padStart(2, "0")}-${date.day.padStart(2, "0")}`;
  const noon = new Date(`${day}T12:00:00Z`);
  if (!Number.isFinite(noon.getTime()) || noon.toISOString().slice(0, 10) !== day
    || !["de-DE", "en-US"].some(locale =>
      new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: timezone }).format(noon) === date.weekday)) {
    throw new Error("invalid_forwarded_date");
  }
  const wall = Date.parse(`${day}T${date.time}:00Z`);
  const format = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const candidates = [1, 2].map(offset => wall - offset * 3600000)
    .filter(value => format.format(new Date(value)) === `${day} ${date.time}`);
  if (candidates.length !== 1) throw new Error("ambiguous_forwarded_date");
  return { subject: match[3].trim(), text: match[4].trim(),
    occurredAt: new Date(candidates[0]).toISOString(), precisionSeconds: 60 };
}
