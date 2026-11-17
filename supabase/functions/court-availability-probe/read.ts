// Operational diagnostics only: no cookies, account data or raw responses leave the server.
import { CLUB_ID, isDate } from "../court-availability/data.ts";
import { normalizePlaytomicSessionCookie } from "../_shared/playtomic-access-code.ts";

export async function probeAvailability(date: string, cookie: string, fetcher: typeof fetch = fetch) {
  if (!isDate(date)) throw new Error("invalid_date");
  const normalized = normalizePlaytomicSessionCookie(cookie);
  const token = /(?:^|; )pt_auth_access_token=([A-Za-z0-9_.-]+)/.exec(normalized)![1];
  // Never forward a refresh token to a data endpoint.
  const accessCookie = `pt_auth_access_token=${token}`;
  const web = new URL("https://playtomic.com/api/clubs/availability");
  web.search = new URLSearchParams({ tenant_id: CLUB_ID, date, sport_id: "PADEL" }).toString();
  const app = new URL("https://api.app.playtomic.io/v1/availability");
  app.search = new URLSearchParams({ tenant_id: CLUB_ID, sport_id: "PADEL",
    start_min: `${date}T00:00:00`, start_max: `${date}T23:59:59` }).toString();
  const routes = [
    { name: "web_cookie", url: web, headers: { Cookie: accessCookie } },
    { name: "app_bearer", url: app, headers: { Authorization: `Bearer ${token}` } },
  ];
  const results = [];
  for (const route of routes) {
    try {
      const response = await fetcher(route.url.href, {
        method: "GET", headers: { ...route.headers, Accept: "application/json" },
        redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
      });
      const row: Record<string, unknown> = { route: route.name, status: response.status };
      // Restrict diagnostics to format, counts and an explicitly recognized error category.
      if (/^application\/json\b/i.test(response.headers.get("content-type") || "")) {
        const reader = response.body?.getReader();
        let size = 0, body = "";
        const decoder = new TextDecoder();
        if (reader) {
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > 2_000_000) { await reader.cancel(); throw new Error("too_large"); }
              body += decoder.decode(chunk.value, { stream: true });
            }
            body += decoder.decode();
          } finally { reader.releaseLock(); }
          const data = JSON.parse(body);
          row.array = Array.isArray(data);
          if (Array.isArray(data)) {
            row.resources = data.length;
            row.slots = data.reduce((count, value) => count + (Array.isArray(value?.slots) ? value.slots.length : 0), 0);
          }
          if (data?.status === "APP_ATTESTATION_REQUIRED") row.reason = "app_attestation_required";
        }
      } else await response.body?.cancel();
      results.push(row);
    } catch { results.push({ route: route.name, reason: "unavailable" }); }
  }
  return results;
}
