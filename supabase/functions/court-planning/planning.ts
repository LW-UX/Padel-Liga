import { berlinParts, type Slot } from "../court-availability/data.ts";
import type { availability } from "../court-availability/reader.ts";

export type Period = { start: number; end: number };
export type Game = { starts_at: string; ends_at: string };
export type Booking = Game & { court_resource_id: string | null; court_name: string };
export type Preference = "morning" | "midday" | "evening" | null;
export type Availability = Awaited<ReturnType<typeof availability>>;
export type Location = "indoor" | "outdoor";

export const minuteMs = 60_000;
export const toPeriod = (game: Game): Period => ({ start: Date.parse(game.starts_at), end: Date.parse(game.ends_at) });
export const overlaps = (a: Period, b: Period) => a.start < b.end && b.start < a.end;
const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export function berlinDateOffset(date: string, days: number) {
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

export function berlinMidnight(date: string) {
  const midnightUtc = Date.parse(`${date}T00:00:00Z`);
  const previousEvening = new Date(midnightUtc - 6 * 60 * minuteMs);
  const offset = minute(berlinParts(previousEvening).time) - 18 * 60;
  return midnightUtc - offset * minuteMs;
}

export function isLunch({ start, end }: Period) {
  const from = berlinParts(new Date(start));
  const until = berlinParts(new Date(end));
  return from.date === until.date && from.time === "12:00" && until.time === "13:00"
    && start % minuteMs === 0 && end % minuteMs === 0;
}

export function mergePeriods(periods: Period[]) {
  const merged: Period[] = [];
  for (const period of [...periods].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const current = merged.at(-1);
    if (current && period.start <= current.end) current.end = Math.max(current.end, period.end);
    else merged.push({ ...period });
  }
  return merged;
}

export function outlookColumns(periods: Period[], date: string) {
  const columns = new Set<string>();
  const begin = berlinMidnight(date);
  const end = berlinMidnight(berlinDateOffset(date, 1));
  const step = 30 * minuteMs;
  for (let start = begin; start < end; start += step) {
    if (periods.some(period => overlaps(period, { start, end: start + step }))) {
      columns.add(berlinParts(new Date(start)).time);
    }
  }
  return [...columns];
}

export function timePreference(time: string): Preference {
  const start = minute(time);
  if (start < 10 * 60 + 30) return "morning";
  return start <= 14 * 60 + 30 ? "midday" : "evening";
}

export function fitsOutlook(play: Period, outlook: Period[]) {
  const buffer = outlook.some(period => period.end === play.start) ? 30 : 15;
  const calendarWindow = { start: play.start, end: play.end + buffer * minuteMs };
  return !outlook.some(period => overlaps(calendarWindow, period));
}

export function rankSlots(day: Availability, location: Location, outlook: Period[], games: Period[],
  bookings: Booking[], preferences: Preference[], now = Date.now()) {
  const bounds = { from: Math.max(minute(day.opening.from), 7 * 60), until: Math.min(minute(day.opening.until), 20 * 60) };
  const courts = new Map(day.courts.map((court, order) => [court.id, { ...court, order }]));
  const normalized = (name: string) => name.toLocaleLowerCase("de-DE").replace(/[^a-z0-9]+/g, " ").trim();
  const blockingBookings = bookings.flatMap(booking => {
    const courtId = courts.has(booking.court_resource_id || "") ? booking.court_resource_id
      : day.courts.find(court => normalized(court.name) === normalized(booking.court_name))?.id;
    return courtId ? [{ ...toPeriod(booking), courtId }] : [];
  });
  const candidates: { slot: Slot; date: string; courtName: string; order: number; score: number }[] = [];
  for (const slot of day.slots) {
    const court = courts.get(slot.courtId);
    const play = { start: Date.parse(slot.start), end: Date.parse(slot.end) };
    if (!court || court.location !== location || play.start <= now || minute(slot.time) % 30 !== 0
      || minute(slot.time) < bounds.from || minute(slot.time) + 60 > bounds.until
      || blockingBookings.some(booking => booking.courtId === slot.courtId && overlaps(play, booking))
      || games.some(game => overlaps(play, game)) || !fitsOutlook(play, outlook)) continue;
    candidates.push({ slot, date: day.date, courtName: court.name, order: court.order,
      score: preferences.filter(preference => preference === timePreference(slot.time)).length });
  }
  return candidates;
}

export type Candidate = ReturnType<typeof rankSlots>[number];

export function bestSlot(candidates: Candidate[]) {
  return [...candidates].sort((a, b) => b.score - a.score
    || a.slot.start.localeCompare(b.slot.start) || a.order - b.order)[0] ?? null;
}

export function suggestionState(candidate: Candidate | null, complete: boolean) {
  if (candidate) return { state: "suggested", slot: { ...candidate.slot, date: candidate.date, courtName: candidate.courtName } };
  return { state: complete ? "no_match" : "hidden" };
}
