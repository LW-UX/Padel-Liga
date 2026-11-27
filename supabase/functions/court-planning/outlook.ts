import { isLunch, type Period } from "./planning.ts";

const graph = "https://graph.microsoft.com";
type Clock = { dateTime: string; timeZone: string };
const calendarFields = ["start", "end", "showAs", "isCancelled"];
const selection = calendarFields.join(",");
type Item = { start: Clock; end: Clock; showAs?: string; isCancelled?: boolean };
export type OutlookHealth = "ready" | "not_configured" | "reconnect" | "unavailable" | "calendar_unavailable";

export class OutlookError extends Error {
  readonly status: OutlookHealth;
  constructor(status: OutlookHealth) {
    super(status);
    this.status = status;
  }
}

function utcInstant(clock: Clock) {
  if (!clock || clock.timeZone?.toLowerCase() !== "utc"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z?$/.test(clock.dateTime)) return NaN;
  return Date.parse(clock.dateTime.endsWith("Z") ? clock.dateTime : clock.dateTime + "Z");
}

function periods(items: Item[]) {
  if (!Array.isArray(items)) throw new OutlookError("calendar_unavailable");
  return items.flatMap(item => {
    if (!item || Object.keys(item).some(key => !calendarFields.includes(key) && key !== "id" && !key.startsWith("@odata."))) {
      throw new OutlookError("calendar_unavailable");
    }
    const status = item.showAs?.toLowerCase();
    if (item.isCancelled === true || status === "free" || status === "workingelsewhere") return [];
    const start = utcInstant(item.start);
    const end = utcInstant(item.end);
    if (!["tentative", "busy", "oof"].includes(status || "") || !Number.isFinite(start) || !(end > start)) {
      throw new OutlookError("calendar_unavailable");
    }
    const period = { start, end };
    return isLunch(period) ? [] : [period];
  });
}

async function graphCalendarPage(url: URL, path: string, token: string, fetcher: typeof fetch) {
  // Never follow a page link that changes the calendar or drops the field selection.
  if (url.origin !== graph || decodeURIComponent(url.pathname) !== decodeURIComponent(path) || url.searchParams.get("$select") !== selection
    || url.searchParams.getAll("$select").length !== 1) {
    throw new OutlookError("calendar_unavailable");
  }
  const response = await fetcher(url, {
    method: "GET", redirect: "error", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new OutlookError(response.status === 401 ? "reconnect" : "calendar_unavailable");
  }
  return await response.json();
}

export async function readOutlookPeriods(token: string, ownEmail: string, emails: string[], range: Period,
  fetcher: typeof fetch = fetch) {
  if (new Set(emails).size !== 4 || emails.length !== 4 || emails.some(email => !email.includes("@"))) {
    throw new OutlookError("calendar_unavailable");
  }
  const params = new URLSearchParams({
    startDateTime: new Date(range.start).toISOString(), endDateTime: new Date(range.end).toISOString(), "$select": selection,
  });
  const calendars = await Promise.all(emails.map(async email => {
    const owner = email === ownEmail ? "me" : `users/${encodeURIComponent(email)}`;
    const path = `/v1.0/${owner}/calendarView`;
    let url: URL | null = new URL(`${path}?${params}`, graph);
    const items: Period[] = [];
    for (let page = 0; url && page < 10; page++) {
      const result = await graphCalendarPage(url, path, token, fetcher);
      items.push(...periods(result.value));
      const next = result["@odata.nextLink"];
      url = next ? new URL(next, graph) : null;
    }
    if (url) throw new OutlookError("calendar_unavailable");
    return items;
  }));
  return calendars.flat();
}

export type OutlookConfig = { tenant: string; client: string; email: string; seedToken: string; secret?: string };
export type OutlookTokenStore = {
  getRefresh: (seed: string) => Promise<string | null>;
  storeRefresh: (seed: string, previous: string, refreshToken: string) => Promise<void>;
};

let savedAccess: { key: string; token: string; expires: number } | null = null;
let pendingAccess: { key: string; token: Promise<string> } | null = null;

export async function outlookAccess(config: OutlookConfig, store: OutlookTokenStore) {
  const { tenant, client, email, seedToken, secret } = config;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seedToken));
  const seed = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const key = [tenant, client, email, seed].join(":");
  if (savedAccess?.key === key && savedAccess.expires > Date.now()) return savedAccess.token;
  if (pendingAccess?.key === key) return pendingAccess.token;
  const refresh = (async () => {
    const previous = await store.getRefresh(seed) || seedToken;
    const form = new URLSearchParams({ client_id: client, grant_type: "refresh_token", refresh_token: previous,
      scope: "https://graph.microsoft.com/Calendars.ReadBasic offline_access" });
    if (secret) form.set("client_secret", secret);
    const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST", body: form, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) {
      const { error } = await response.json().catch(() => ({}));
      throw new OutlookError(["invalid_grant", "invalid_client", "interaction_required"].includes(error) ? "reconnect" : "unavailable");
    }
    const result = await response.json();
    if (typeof result.access_token !== "string" || !Number.isFinite(result.expires_in)) throw new OutlookError("unavailable");
    if (typeof result.refresh_token === "string" && result.refresh_token !== previous) {
      await store.storeRefresh(seed, previous, result.refresh_token);
    }
    savedAccess = { key, token: result.access_token, expires: Date.now() + (result.expires_in - 120) * 1000 };
    return result.access_token as string;
  })().finally(() => { if (pendingAccess?.key === key) pendingAccess = null; });
  pendingAccess = { key, token: refresh };
  return refresh;
}
