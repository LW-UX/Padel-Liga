import { findBusyWindow, fromMinutes, type ClearoomsBooking } from "../racket-booking/slot.ts";

export const RACKET_DESK_ID = "0dc76a62-3077-44fd-bd29-8f808b1343f3";

export function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

// Jede Zeit bezeichnet ausschließlich ihre eigene halbe Stunde, keinen möglichen Spielbeginn.
export function busyStarts(date: string, bookings: ClearoomsBooking[]) {
  const result: string[] = [];
  for (let start = 0; start < 24 * 60; start += 30) {
    const time = fromMinutes(start);
    const cell = { date, from: time, until: fromMinutes(start + 30) };
    if (findBusyWindow(bookings, RACKET_DESK_ID, cell)) result.push(time);
  }
  return { date, busyStarts: result };
}
