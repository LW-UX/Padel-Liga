import { CLUB_ID, CLUB_URL, type Club, isDate, normalizeAvailability, parseClub } from "./data.ts";
import { AvailabilityReadError, playtomicHttpError } from "./errors.ts";
import { publicRequestHeaders } from "./request-headers.ts";
import { fallbackClub } from "./club-metadata.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return json({ error: "Methode nicht erlaubt." }, 405);
  try {
    const text = await request.text();
    if (text.length > 256) return json({ error: "Ungültige Anfrage." }, 400);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
    if (!isDate(body?.date)) return json({ error: "Bitte ein gültiges Datum wählen." }, 400);
    return json(await availability(body.date));
  } catch (error) {
    const reason = error instanceof AvailabilityReadError ? error.reason : "availability_unavailable";
    console.error("Verfügbarkeit nicht lesbar", reason);
    return json({ error: "Die freien Plätze konnten gerade nicht geladen werden.", reason,
      source: error instanceof AvailabilityReadError ? "playtomic" : "unknown" }, 502);
  }
});
