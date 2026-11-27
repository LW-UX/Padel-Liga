import { isDate } from "./data.ts";
import { AvailabilityReadError } from "./errors.ts";
import { availability } from "./reader.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
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
