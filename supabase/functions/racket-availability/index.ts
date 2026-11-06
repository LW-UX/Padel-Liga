import { busyStarts, RACKET_DESK_ID } from "./data.ts";
import { createHandler } from "./handler.ts";
import type { ClearoomsBooking } from "../racket-booking/slot.ts";

const API = "https://api.clearooms.com/api/v1";
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

async function availability(date: string) {
  if (!pending.has(date)) {
    const operation = (async () => {
      const bookings = await read(`/bookings?date=${date}`);
      if (!Array.isArray(bookings) || !bookings.every((booking: ClearoomsBooking) => booking
        && typeof booking.desk_id === "string"
        && (booking.desk_id !== RACKET_DESK_ID || booking.checkin_status === "cancelled"
          || typeof booking.id === "string" && typeof booking.date === "string" && typeof booking.end_date === "string"
            && Number.isFinite(Date.parse(booking.date.replace(" ", "T")))
            && Number.isFinite(Date.parse(booking.end_date.replace(" ", "T"))) && booking.date < booking.end_date))) {
        throw new Error("Ungültige Belegung.");
      }
      return busyStarts(date, bookings);
    })().finally(() => pending.delete(date));
    pending.set(date, operation);
  }
  return await pending.get(date)!;
}

Deno.serve(createHandler(availability));
