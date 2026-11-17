// A separate, operator-supplied browser session. Never uses the hall-code store.
import { CLUB_ID, CLUB_URL, isDate, normalizeAvailability, parseClub } from "../court-availability/data.ts";
import { AvailabilityReadError, playtomicHttpError } from "../court-availability/errors.ts";

export function normalizeAvailabilityCookie(input: string): string {
  if (typeof input !== "string" || new TextEncoder().encode(input).byteLength > 32_768
    || /[\r\n\0]/.test(input.trim())) throw new Error("invalid_cookie");
  const values = new Map<string, string>();
  for (const part of input.trim().replace(/^cookie\s*:\s*/i, "").split(";")) {
    if (!part.trim()) continue;
    const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=([\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*)$/.exec(part.trim());
    if (!match) throw new Error("invalid_cookie");
    const [, name, value] = match;
    // No refresh token is ever sent to a data endpoint or stored for this test.
    // Preserve unfamiliar security cookies so we do not repeat the JWT-only test.
    if (name === "pt_auth_refresh_token" || /^(?:_ga(?:_|$)|_gid$|_gat|_gcl_|__utm|_fb[pc]$|_hj|_cl[cs]k$|__stripe_|hubspotutk$|__hs)/i.test(name)) continue;
    if (values.has(name)) throw new Error("invalid_cookie");
    values.set(name, value);
  }
  if (!values.size) throw new Error("invalid_cookie");
  return [...values].map(([name, value]) => `${name}=${value}`).join("; ");
}

export function normalizeBrowserUserAgent(input: string) {
  if (typeof input !== "string" || input.length > 512 || /[^\x20-\x7E]/.test(input)) throw new Error("invalid_user_agent");
  return input.trim();
}

export async function probeBrowserCookie(date: string, input: string, userAgent = "", fetcher: typeof fetch = fetch) {
  if (!isDate(date)) throw new Error("invalid_date");
  const cookie = normalizeAvailabilityCookie(input);
  const agent = normalizeBrowserUserAgent(userAgent);
  const headers: Record<string, string> = { Cookie: cookie, Accept: "application/json, text/html" };
  if (agent) headers["User-Agent"] = agent;
  const url = new URL("https://playtomic.com/api/clubs/availability");
  url.search = new URLSearchParams({ tenant_id: CLUB_ID, date, sport_id: "PADEL" }).toString();
  const read = async (target: string) => {
    let response: Response;
    try {
      response = await fetcher(target, { method: "GET", headers, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) });
    } catch (error) {
      throw new AvailabilityReadError(error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
        ? "playtomic_timeout" : "playtomic_unavailable");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw playtomicHttpError(response.status, /(?:^|; )pt_auth_access_token=/.test(cookie));
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AvailabilityReadError("playtomic_invalid_response");
    let size = 0, text = "";
    const decoder = new TextDecoder();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 2_000_000) { await reader.cancel(); throw new AvailabilityReadError("playtomic_invalid_response"); }
        text += decoder.decode(part.value, { stream: true });
      }
      return text + decoder.decode();
    } catch (error) {
      if (error instanceof AvailabilityReadError) throw error;
      throw new AvailabilityReadError(error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
        ? "playtomic_timeout" : "playtomic_unavailable");
    } finally { reader.releaseLock(); }
  };
  // First prove that the exact availability route accepts the session.
  const raw = await read(url.href);
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error();
    const club = parseClub(await read(CLUB_URL));
    const result = normalizeAvailability(parsed, club, date);
    return { state: "available", courts: result.courts.length, slots: result.slots.length };
  } catch (error) {
    if (error instanceof AvailabilityReadError) throw error;
    throw new AvailabilityReadError("playtomic_invalid_response");
  }
}
