import { CLUB_ID, CLUB_URL, type Club, normalizeAvailability, parseClub } from "./data.ts";
import { AvailabilityReadError, playtomicHttpError } from "./errors.ts";
import { publicRequestHeaders } from "./request-headers.ts";
import { fallbackClub } from "./club-metadata.ts";

let metadata: { value: Club; expires: number } | null = null;
let metadataRequest: Promise<Club> | null = null;
const pending = new Map<string, Promise<ReturnType<typeof normalizeAvailability>>>();


async function read(url: string, timeoutMs = 10000) {
  try {
    const response = await fetch(url, { headers: publicRequestHeaders,
      signal: AbortSignal.timeout(timeoutMs), cache: "no-store", redirect: "error" });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw playtomicHttpError(response.status);
    }
    return response;
  } catch (error) {
    if (error instanceof AvailabilityReadError) throw error;
    throw new AvailabilityReadError(error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
      ? "playtomic_timeout" : "playtomic_unavailable");
  }
}

async function providerData<T>(operation: () => T | Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof AvailabilityReadError) throw error;
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      throw new AvailabilityReadError("playtomic_timeout");
    }
    throw new AvailabilityReadError("playtomic_invalid_response");
  }
}

async function getClub() {
  if (metadata && metadata.expires > Date.now()) return metadata.value;
  if (!metadataRequest) {
    metadataRequest = (async () => {
      let value: Club;
      try {
        const response = await read(CLUB_URL, 3000);
        value = await providerData(async () => parseClub(await response.text()));
      } catch {
        // A slow public HTML page must not hide fresh slots from the JSON route.
        value = fallbackClub;
      }
      metadata = { value, expires: Date.now() + 60 * 60 * 1000 };
      return value;
    })().finally(() => { metadataRequest = null; });
  }
  return metadataRequest;
}

export async function availability(date: string) {
  if (!pending.has(date)) {
    const operation = (async () => {
      const url = new URL("https://playtomic.com/api/clubs/availability");
      url.search = new URLSearchParams({ tenant_id: CLUB_ID, date, sport_id: "PADEL" }).toString();
      const [club, raw] = await Promise.all([getClub(), read(url.href).then(response => providerData(() => response.json()))]);
      return providerData(() => normalizeAvailability(raw, club, date));
    })().finally(() => pending.delete(date));
    pending.set(date, operation);
  }
  return await pending.get(date)!;
}
