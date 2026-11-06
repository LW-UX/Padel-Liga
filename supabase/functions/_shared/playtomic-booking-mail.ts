// Input is MIME-decoded text and (optionally) the decoded calendar attachment.
// This parser neither authenticates a forwarded message nor changes bookings.
export type BookingMail = {
  state: "confirmed" | "cancelled";
  club: string;
  court: string;
  organizer: string;
  date: string;
  time: string;
  duration: number;
  timezone: "Europe/Berlin";
  providerId: string | null;
};

const CLUB = "Lucky Star Padel @ Das Anders";
const normalize = (value: string) => value.normalize("NFC").replace(/\u00a0/g, " ").trim();
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

function requireValue(value: string | undefined): string {
  if (!value?.trim()) throw new Error("Unvollständige Playtomic-Buchungsmail.");
  return normalize(value);
}

function dateValue(value: string) {
  const match = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/.exec(value);
  if (!match) throw new Error("Ungültiger Buchungstag.");
  const [, day, month, year] = match;
  const result = `${year.length === 2 ? "20" : ""}${year}-${month}-${day}`;
  const parsed = new Date(`${result}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new Error("Ungültiger Buchungstag.");
  }
  return result;
}

function calendarId(calendar: string, booking: BookingMail) {
  const unfolded = calendar.replace(/\r?\n[ \t]/g, "");
  const field = (name: string) => {
    const matches = [...unfolded.matchAll(new RegExp(`^${name}:(.*)$`, "gm"))];
    if (matches.length !== 1) throw new Error("Mehrdeutiger Kalenderanhang.");
    return matches[0][1].trim();
  };
  if ((unfolded.match(/^BEGIN:VEVENT\r?$/gm) || []).length !== 1) throw new Error("Mehrdeutiger Kalenderanhang.");
  const uid = /^([0-9a-f-]{36})@playtomic\.io$/i.exec(field("UID"));
  if (!uid || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(uid[1])) {
    throw new Error("Ungültige Playtomic-ID.");
  }
  const instant = (value: string) => {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
    if (!m) throw new Error("Ungültige Kalenderzeit.");
    const date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().replace(/[-:]/g, "").replace(".000", "") !== value) {
      throw new Error("Ungültige Kalenderzeit.");
    }
    return date;
  };
  const start = instant(field("DTSTART"));
  const end = instant(field("DTEND"));
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: booking.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(start).map(part => [part.type, part.value]));
  if (`${parts.year}-${parts.month}-${parts.day}` !== booking.date
    || `${parts.hour}:${parts.minute}` !== booking.time || parts.second !== "00"
    || (end.getTime() - start.getTime()) / 60000 !== booking.duration
    || field("LOCATION") !== booking.club) {
    throw new Error("Kalenderanhang und Buchungsmail widersprechen sich.");
  }
  return uid[1].toLowerCase();
}

export function parsePlaytomicBookingMail(input: { subject: string; text: string; calendar?: string }): BookingMail {
  const subject = normalize(input.subject).replace(/^(?:(?:fwd?|wg|re|aw):\s*)+/i, "");
  const text = normalize(input.text).replace(/\r\n?/g, "\n");
  // Only parse the booking data block. Payment dates and quoted older mails
  // must not accidentally supply fields missing from the current booking.
  let state: BookingMail["state"], club: string, court: string, organizer: string;
  let date: string, time: string, duration: number;
  if (subject === "Playtomic - Buchungsbestätigung / Ticket") {
    state = "confirmed";
    const block = requireValue(text.match(/Reservierungsdaten\s*\n([\s\S]*?)\nInfos über die Bezahlung/)?.[1]);
    const field = (name: string) => requireValue(block.match(new RegExp(`^${name}[ \\t]*\\n?[ \\t]*(.+)$`, "m"))?.[1]);
    organizer = field("Name");
    date = dateValue(field("Datum"));
    const range = field("Zeit").split(/\s*[-–]\s*/);
    if (range.length !== 2 || !range.every(value => clock.test(value))) throw new Error("Ungültige Buchungszeit.");
    time = range[0];
    duration = minutes(range[1]) - minutes(time);
    if (duration <= 0) duration += 24 * 60;
    const location = field("Club");
    const separator = location.lastIndexOf(",");
    if (separator < 0) throw new Error("Platz fehlt in der Buchungsmail.");
    club = normalize(location.slice(0, separator));
    court = requireValue(location.slice(separator + 1));
  } else if (subject === "Buchung storniert") {
    state = "cancelled";
    const match = text.match(/^(.+) hat ein Match von Padel abgebrochen\s*\n+Die Reservierung wurde vom Veranstalter abgesagt und ist nicht mehr verfügbar\.\s*\n+Sport[ \t\n]+Padel\s*\n+Datum und Uhrzeit[ \t\n]+(\d{2}\.\d{2}\.\d{2,4}),\s*(\d{2}:\d{2})\s*\n+Ort[ \t\n]+([^\n]+)\nCourt[ \t\n]+([^\n]+)\nDauer[ \t\n]+(\d+) Minuten\b/m);
    if (!match) throw new Error("Unvollständige Playtomic-Stornierung.");
    [, organizer, date, time, club, court] = match.map(normalize);
    date = dateValue(date);
    duration = Number(match[6]);
  } else throw new Error("Unbekanntes Playtomic-Mailformat.");
  if (club !== CLUB || !clock.test(time) || !Number.isInteger(duration) || duration < 1 || duration > 12 * 60) {
    throw new Error("Ungültige Buchung oder nicht unterstützter Club.");
  }
  const booking: BookingMail = { state, club, court, organizer, date, time, duration, timezone: "Europe/Berlin", providerId: null };
  if (input.calendar) booking.providerId = calendarId(input.calendar, booking);
  return booking;
}

// A tuple match is only a cancellation candidate, not authorization to cancel.
// Rebookings and multiple candidates need event history / manual review.
export function sameBookingSlot(first: BookingMail, second: BookingMail): boolean {
  return (["club", "court", "date", "time", "duration", "timezone", "organizer"] as const)
    .every(key => first[key] === second[key]);
}
