import { CLUB_ID, CLUB_URL, type Club, isDate, normalizeAvailability } from "./data.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
let metadata: { value: Club; expires: number } | null = null;
let metadataRequest: Promise<Club> | null = null;
const pending = new Map<string, Promise<ReturnType<typeof normalizeAvailability>>>();

async function read(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (!response.ok) throw new Error(`Playtomic HTTP ${response.status}`);
  return response;
}

async function getClub() {
  if (metadata && metadata.expires > Date.now()) return metadata.value;
  if (!metadataRequest) {
    metadataRequest = (async () => {
      const { parseClub } = await import("./data.ts");
      const value = parseClub(await (await read(CLUB_URL)).text());
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
      const [club, raw] = await Promise.all([getClub(), read(url.href).then(response => response.json())]);
      return normalizeAvailability(raw, club, date);
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
    console.error("Verfügbarkeit nicht lesbar", error instanceof Error ? error.message : "Unbekannter Fehler");
    return json({ error: "Die freien Plätze konnten gerade nicht geladen werden." }, 502);
  }
});
