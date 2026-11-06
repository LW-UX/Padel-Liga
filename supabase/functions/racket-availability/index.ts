import { busyStarts, RACKET_DESK_ID, RACKET_OFFICE_ID } from "./data.ts";
import { createHandler } from "./handler.ts";
import type { ClearoomsBooking, WorkingHour } from "../racket-booking/slot.ts";

const API = "https://api.clearooms.com/api/v1";
let hours: { value: WorkingHour[]; expires: number } | null = null;
const pending = new Map<string, Promise<ReturnType<typeof busyStarts>>>();

// Dieser öffentliche Endpunkt kann ausschließlich die feste Schlägerressource lesen.
async function read(path: string) {
  const token = Deno.env.get("CLEAROOMS_API_TOKEN")?.trim();
  if (!token) throw new Error("Clearooms nicht konfiguriert.");
  const response = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(8000), cache: "no-store",
  });
  if (!response.ok) throw new Error("Clearooms nicht erreichbar.");
  return await response.json();
}

async function workingHours(): Promise<WorkingHour[]> {
  if (hours && hours.expires > Date.now()) return hours.value;
  const office = await read(`/offices/${RACKET_OFFICE_ID}`);
  if (!Array.isArray(office?.working_hours) || !office.working_hours.every((day: WorkingHour) => day
    && Number(day.weekday) >= 1 && Number(day.weekday) <= 7
    && (day.all_day || /^\d{2}:\d{2}/.test(day.from) && /^\d{2}:\d{2}/.test(day.to)))) {
    throw new Error("Ungültige Bürozeiten.");
  }
  hours = { value: office.working_hours, expires: Date.now() + 10 * 60 * 1000 };
  return hours.value;
}

async function availability(date: string) {
  if (!pending.has(date)) {
    const operation = (async () => {
      const [working, bookings] = await Promise.all([workingHours(), read(`/bookings?date=${date}`)]);
      if (!Array.isArray(bookings) || !bookings.every((booking: ClearoomsBooking) => booking
        && typeof booking.desk_id === "string"
        && (booking.desk_id !== RACKET_DESK_ID || booking.checkin_status === "cancelled"
          || typeof booking.id === "string" && typeof booking.date === "string" && typeof booking.end_date === "string"
            && Number.isFinite(Date.parse(booking.date.replace(" ", "T")))
            && Number.isFinite(Date.parse(booking.end_date.replace(" ", "T"))) && booking.date < booking.end_date))) {
        throw new Error("Ungültige Belegung.");
      }
      return busyStarts(date, working, bookings);
    })().finally(() => pending.delete(date));
    pending.set(date, operation);
  }
  return await pending.get(date)!;
}

Deno.serve(createHandler(availability));
