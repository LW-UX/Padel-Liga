import { findBusyWindow, fromMinutes, planSlot, type ClearoomsBooking, type WorkingHour } from "../racket-booking/slot.ts";

export const RACKET_DESK_ID = "0dc76a62-3077-44fd-bd29-8f808b1343f3";
export const RACKET_OFFICE_ID = "10cd1cd5-eb22-4793-94e9-e33a1af506f5";

export function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

// Nur Startzeiten verlassen den Server; weder Buchungs- noch Personendaten.
export function busyStarts(date: string, workingHours: WorkingHour[], bookings: ClearoomsBooking[]) {
  const result: string[] = [];
  for (let start = 0; start < 24 * 60; start += 30) {
    const time = fromMinutes(start);
    const plan = planSlot(date, time, workingHours);
    if (plan.state !== "outside_hours" && findBusyWindow(bookings, RACKET_DESK_ID, plan)) result.push(time);
  }
  return { date, busyStarts: result };
}
