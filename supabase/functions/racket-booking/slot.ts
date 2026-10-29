export type WorkingHour = { weekday: number; from: string; to: string; all_day?: boolean };
export type ClearoomsBooking = {
  id: string;
  desk_id: string;
  date: string;
  end_date: string;
  checkin_status?: string | null;
};
export type SlotPlan =
  | { state: "free" | "partial"; date: string; from: string; until: string; openFrom: string; openUntil: string }
  | { state: "outside_hours"; date: string; openFrom: string | null; openUntil: string | null };
export type BusyWindow = { from: string; until: string };

export const BOOKING_MINUTES = 60;
export const BOOKING_STEP_MINUTES = 30;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDateValue(value: unknown): value is string {
  return typeof value === "string" && datePattern.test(value);
}

export function isTimeValue(value: unknown): value is string {
  return typeof value === "string" && timePattern.test(value);
}

export function toMinutes(time: string) {
  const [hours, minutes] = time.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

export function fromMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// Clearooms nummeriert die Wochentage von Montag (1) bis Sonntag (7).
export function isoWeekday(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
}

export function planSlot(date: string, time: string, workingHours: WorkingHour[]): SlotPlan {
  const requestedStart = toMinutes(time);
  const start = Math.floor(requestedStart / BOOKING_STEP_MINUTES) * BOOKING_STEP_MINUTES;
  const end = Math.ceil((requestedStart + BOOKING_MINUTES) / BOOKING_STEP_MINUTES) * BOOKING_STEP_MINUTES;
  const day = workingHours.find((entry) => Number(entry.weekday) === isoWeekday(date));
  if (!day) return { state: "outside_hours", date, openFrom: null, openUntil: null };
  const open = day.all_day ? 0 : toMinutes(day.from);
  const close = day.all_day ? 24 * 60 : toMinutes(day.to);
  const openFrom = fromMinutes(open);
  const openUntil = day.all_day ? "24:00" : fromMinutes(close);
  const from = Math.max(start, open);
  const until = Math.min(end, close);
  if (until - from < BOOKING_STEP_MINUTES) return { state: "outside_hours", date, openFrom, openUntil };
  return {
    state: from === start && until === end ? "free" : "partial",
    date,
    from: fromMinutes(from),
    until: until === 24 * 60 ? "24:00" : fromMinutes(until),
    openFrom,
    openUntil,
  };
}

function clipToDate(value: string, date: string, fallback: string) {
  return value.startsWith(date) ? value.slice(11, 16) : fallback;
}

// Clearooms liefert Buchungszeiten als lokale Bürozeit im Format "YYYY-MM-DD HH:MM:SS",
// deshalb genügt ein lexikografischer Vergleich.
export function findBusyWindow(
  bookings: ClearoomsBooking[],
  deskId: string,
  slot: { date: string; from: string; until: string },
  ownBookingId: string | null = null,
): BusyWindow | null {
  const slotStart = `${slot.date} ${slot.from}:00`;
  const slotEnd = `${slot.date} ${slot.until === "24:00" ? "23:59:59" : `${slot.until}:00`}`;
  const overlapping = bookings.filter((booking) =>
    booking.desk_id === deskId
    && booking.id !== ownBookingId
    && booking.checkin_status !== "cancelled"
    && booking.date < slotEnd
    && booking.end_date > slotStart
  );
  if (!overlapping.length) return null;
  const from = overlapping.map((booking) => booking.date).sort()[0];
  const until = overlapping.map((booking) => booking.end_date).sort().at(-1) as string;
  return { from: clipToDate(from, slot.date, "00:00"), until: clipToDate(until, slot.date, "24:00") };
}

export function berlinParts(value: string | Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function matchLabel(match: { id: string; display_label?: string | null; competition_stage?: string | null }) {
  if (match.display_label) return match.display_label;
  const number = match.id.match(/\d+$/)?.[0] || match.id;
  switch (match.competition_stage) {
    case "quarterfinal": return `Viertelfinale ${number}`;
    case "semifinal": return `Halbfinale ${number}`;
    case "final_four": return `Final Four ${number}`;
    case "final": return "Finale";
    default: return `Partie ${number}`;
  }
}
