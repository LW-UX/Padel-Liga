import { createClient } from "npm:@supabase/supabase-js@2";
import { berlinParts, isDate } from "../court-availability/data.ts";
import { availability } from "../court-availability/reader.ts";
import { berlinDateOffset, berlinMidnight, bestSlot, fitsOutlook, mergePeriods, minuteMs, outlookColumns, rankSlots, suggestionState, toPeriod,
  type Availability, type Booking, type Game, type Preference, type Candidate } from "./planning.ts";
import { outlookAccess, OutlookError, readOutlookPeriods, type OutlookHealth } from "./outlook.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "private, no-store",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const options = { auth: { persistSession: false, autoRefreshToken: false } };

type Subject = { members: { email: string | null; preference: Preference }[]; games: Game[]; bookings: Booking[] };
const payload = (games: Game[] = []) => ({
  outlook: null as string[] | null, fitsOutlook: false, games: mergePeriods(games.map(toPeriod)), suggestion: suggestionState(null, false),
});

const courtDays = new Map<string, { value: Promise<Availability>; expires: number }>();
let workers = 0;
const waiters: (() => void)[] = [];

// Bound provider parallelism across concurrent searches within the same worker.
async function readCourtDay(day: string) {
  if (workers >= 4) await new Promise<void>(resolve => waiters.push(resolve));
  else workers++;
  try { return await availability(day); }
  finally {
    const next = waiters.shift();
    if (next) next();
    else workers--;
  }
}

function courtDay(day: string) {
  for (const [date, result] of courtDays) if (result.expires <= Date.now()) courtDays.delete(date);
  const pending = courtDays.get(day);
  if (pending) return pending.value;
  const value = readCourtDay(day).catch(error => {
    if (courtDays.get(day)?.value === value) courtDays.delete(day);
    throw error;
  });
  courtDays.set(day, { value, expires: Date.now() + 60_000 });
  return value;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return json(null, 405);
  const authorization = request.headers.get("Authorization");
  if (!authorization) return json(null, 401);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      ...options, global: { headers: { Authorization: authorization } },
    });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user?.email_confirmed_at) return json(null, 401);
    const text = await request.text();
    if (text.length > 512) return json(null, 400);
    const { matchId, date, location, includeSuggestion = true, proposedStart } = JSON.parse(text);
    if (typeof matchId !== "string" || !matchId || matchId.length > 160 || !isDate(date)
      || typeof includeSuggestion !== "boolean" || !["indoor", "outdoor"].includes(location)) return json(null, 400);

    const startToRecheck = typeof proposedStart === "string" ? Date.parse(proposedStart) : NaN;
    const today = berlinParts(new Date()).date;
    if (date < today) return json(null, 400);
    const endDate = berlinDateOffset(today, 14);
    const searchRange = { start: berlinMidnight(today), end: berlinMidnight(endDate) };
    const selectedRange = date < endDate ? searchRange
      : { start: berlinMidnight(date), end: berlinMidnight(berlinDateOffset(date, 1)) };
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, options);
    const subject = async ({ start, end }: typeof searchRange) => {
      const { data, error } = await admin.rpc("get_court_planning_subject", {
        p_user_id: user.id, p_match_id: matchId, p_from: new Date(start).toISOString(), p_until: new Date(end).toISOString(),
      });
      if (error) throw new Error("subject_unavailable");
      return data as Subject | null;
    };
    const group = await subject(searchRange);
    if (!group) return json(null, 404);
    const selectedGroup = selectedRange === searchRange ? group : await subject(selectedRange);
    if (!selectedGroup) return json(null, 404);
    const reply = payload(selectedGroup.games);

    const startedAt = new Date().toISOString();
    const health = async (status: OutlookHealth) => {
      try {
        const { error } = await admin.rpc("record_court_outlook_health", {
          p_match_id: matchId, p_started_at: startedAt, p_status: status,
        });
        if (error) throw new Error("health_write_failed");
      } catch {
        console.error("Outlook-Betriebsstatus konnte nicht gespeichert werden.");
      }
    };
    const tenant = Deno.env.get("COURT_OUTLOOK_TENANT_ID") ?? "";
    const client = Deno.env.get("COURT_OUTLOOK_CLIENT_ID") ?? "";
    const seedToken = Deno.env.get("COURT_OUTLOOK_REFRESH_TOKEN");
    const email = Deno.env.get("COURT_OUTLOOK_ACCOUNT")?.trim().toLowerCase();
    if (![tenant, client].every(id => /^[a-f\d-]{36}$/i.test(id)) || !seedToken || !email?.includes("@")) {
      await health("not_configured");
      return json(reply);
    }
    const emails = group.members.map(member => member.email || "");
    if (emails.length !== 4 || new Set(emails).size !== 4 || emails.some(address => !address.includes("@"))) {
      return json(reply);
    }
    try {
      const token = await outlookAccess({ tenant, client, email, seedToken, secret: Deno.env.get("COURT_OUTLOOK_CLIENT_SECRET") }, {
        async getRefresh(seed) {
          const { data, error } = await admin.rpc("get_court_outlook_refresh_token", { p_seed: seed });
          if (error) throw new OutlookError("unavailable");
          return data;
        },
        async storeRefresh(seed, previous, refreshToken) {
          const { error } = await admin.rpc("store_court_outlook_refresh_token", {
            p_seed: seed, p_previous: previous, p_token: refreshToken,
          });
          if (error) throw new OutlookError("unavailable");
        },
      });
      const [outlook, selectedOutlook] = await Promise.all([
        readOutlookPeriods(token, email, emails, searchRange),
        selectedRange === searchRange ? null : readOutlookPeriods(token, email, emails, selectedRange),
      ]).catch(error => { throw error instanceof OutlookError ? error : new OutlookError("calendar_unavailable"); });
      reply.outlook = outlookColumns(mergePeriods(selectedOutlook ?? outlook), date);
      if (Number.isFinite(startToRecheck) && berlinParts(new Date(startToRecheck)).date === date) {
        reply.fitsOutlook = fitsOutlook({ start: startToRecheck, end: startToRecheck + 60 * minuteMs }, selectedOutlook ?? outlook);
      }
      await health("ready");

      if (!includeSuggestion) return json(reply);
      const dates = Array.from({ length: 14 }, (_, offset) => berlinDateOffset(today, offset));
      const games = group.games.map(toPeriod);
      const preferences = group.members.map(member => member.preference);
      const days = await Promise.allSettled(dates.map(courtDay));
      const candidates = days.flatMap((day): Candidate[] => day.status === "fulfilled"
        ? rankSlots(day.value, location, outlook, games, group.bookings, preferences) : []);
      reply.suggestion = suggestionState(bestSlot(candidates), days.every(day => day.status === "fulfilled"));
    } catch (error) {
      if (reply.outlook === null) await health(error instanceof OutlookError ? error.status : "unavailable");
    }
    return json(reply);
  } catch {
    return json(null, 400);
  }
});
