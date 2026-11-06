export const CLUB_ID = "a8db215f-b515-443c-b4f6-83a4abc046e4";
export const CLUB_URL = "https://playtomic.com/clubs/lucky-star-padel";
export const TIMEZONE = "Europe/Berlin";

export type Court = { id: string; name: string; location: "indoor" | "outdoor" | "other" };
export type Club = { courts: Court[]; openingHours: Record<string, { opening_time: string; closing_time: string }> };
export type Slot = { id: string; courtId: string; start: string; end: string; time: string };

export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function readObject(text: string, start: number) {
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return JSON.parse(text.slice(start, index + 1));
  }
  throw new Error("Unvollständige Clubdaten.");
}

// Die Clubseite liefert Metadaten im öffentlichen Next.js-Stream. Nur das
// abgegrenzte tenant-Objekt lesen, niemals Seitencode ausführen.
export function parseClub(html: string): Club {
  const stream = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g)]
    .map(match => JSON.parse(match[1])).join("");
  const marker = /"tenant":\s*(\{)/g;
  for (const match of stream.matchAll(marker)) {
    const tenant = readObject(stream, match.index! + match[0].lastIndexOf("{"));
    if (tenant.tenant_id !== CLUB_ID) continue;
    if (tenant.address?.timezone !== TIMEZONE || !Array.isArray(tenant.resources) || !tenant.opening_hours) break;
    const courts: Court[] = tenant.resources.filter((resource: any) => resource.sport === "PADEL")
      .map((resource: any) => {
        if (typeof resource.resourceId !== "string" || typeof resource.name !== "string" || !Array.isArray(resource.features)) {
          throw new Error("Ungültige Platzdaten.");
        }
        return { id: resource.resourceId, name: resource.name.trim(),
          location: resource.features.includes("Indoor") ? "indoor" : resource.features.includes("Outdoor") ? "outdoor" : "other" };
      });
    if (!courts.length || new Set(courts.map(court => court.id)).size !== courts.length) break;
    return { courts, openingHours: tenant.opening_hours };
  }
  throw new Error("Playtomic liefert keine lesbaren Platzinformationen.");
}

const berlinFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function berlinParts(value: Date) {
  const p = Object.fromEntries(berlinFormatter.formatToParts(value).map(part => [part.type, part.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function normalizeAvailability(raw: unknown, club: Club, date: string, now = Date.now()) {
  if (!isDate(date) || !Array.isArray(raw)) throw new Error("Ungültige Verfügbarkeitsdaten.");
  const ids = new Set(club.courts.map(court => court.id));
  const slots = new Map<string, Slot>();
  for (const row of raw) {
    if (!row || typeof row.resource_id !== "string" || !isDate(row.start_date) || !Array.isArray(row.slots)) {
      throw new Error("Ungültige Verfügbarkeitsdaten.");
    }
    if (!ids.has(row.resource_id)) continue;
    for (const value of row.slots) {
      if (!value || !Number.isInteger(value.duration) || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value.start_time)) {
        throw new Error("Ungültige Zeitfenster.");
      }
      if (value.duration !== 60) continue;
      // Playtomic interpretiert start_date + start_time in seiner Clubansicht als UTC.
      const start = new Date(`${row.start_date}T${value.start_time}Z`);
      const local = berlinParts(start);
      if (local.date !== date || start.getTime() <= now) continue;
      const id = `${row.resource_id}:${start.toISOString()}`;
      slots.set(id, { id, courtId: row.resource_id, start: start.toISOString(),
        end: new Date(start.getTime() + 60 * 60 * 1000).toISOString(), time: local.time });
    }
  }
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: TIMEZONE })
    .format(new Date(`${date}T12:00:00Z`)).toUpperCase();
  const hours = club.openingHours[weekday];
  if (!hours || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hours.opening_time)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hours.closing_time)) throw new Error("Öffnungszeiten fehlen.");
  return { date, timezone: TIMEZONE, duration: 60, courts: club.courts,
    opening: { from: hours.opening_time, until: hours.closing_time === "00:00" ? "24:00" : hours.closing_time },
    slots: [...slots.values()].sort((a, b) => a.start.localeCompare(b.start) || a.courtId.localeCompare(b.courtId)) };
}
