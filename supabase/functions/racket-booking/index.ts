import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  berlinParts,
  type ClearoomsBooking,
  findBusyWindow,
  isDateValue,
  isTimeValue,
  matchLabel,
  planSlot,
  type WorkingHour,
} from "./slot.ts";

const CLEAROOMS_API = "https://api.clearooms.com/api/v1";
const RACKET_DESK_ID = "0dc76a62-3077-44fd-bd29-8f808b1343f3";
const RACKET_OFFICE_ID = "10cd1cd5-eb22-4793-94e9-e33a1af506f5";
const TEST_PLAYER_IDS = new Set(["ludi_gmail", "ludi_gmx", "ludi_ionos", "test_net"]);
const WORKING_HOURS_CACHE_MS = 10 * 60 * 1000;

type SubjectType = "match" | "training";
type Subject = { type: SubjectType; id: string };
type BookingRow = {
  subject_type: SubjectType;
  subject_id: string;
  state: "booked" | "partial" | "busy" | "outside_hours" | "failed";
  clearooms_booking_id: string | null;
  booked_from: string | null;
  booked_until: string | null;
  busy_from: string | null;
  busy_until: string | null;
};
type Desired =
  | { kind: "none" }
  | { kind: "frozen" }
  | { kind: "slot"; date: string; time: string; guestName: string };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

let workingHoursCache: { value: WorkingHour[]; fetchedAt: number } | null = null;

class ClearoomsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function clearooms(method: string, path: string, body?: unknown) {
  const token = Deno.env.get("CLEAROOMS_API_TOKEN")?.trim();
  if (!token) throw new ClearoomsError(0, "CLEAROOMS_API_TOKEN fehlt.");
  const response = await fetch(`${CLEAROOMS_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!response.ok) {
    const message = (parsed as { message?: string })?.message || `Clearooms antwortet mit HTTP ${response.status}.`;
    throw new ClearoomsError(response.status, message);
  }
  return parsed;
}

async function getWorkingHours() {
  if (workingHoursCache && Date.now() - workingHoursCache.fetchedAt < WORKING_HOURS_CACHE_MS) {
    return workingHoursCache.value;
  }
  const office = await clearooms("GET", `/offices/${RACKET_OFFICE_ID}`) as { working_hours?: WorkingHour[] };
  const value = Array.isArray(office?.working_hours) ? office.working_hours : [];
  workingHoursCache = { value, fetchedAt: Date.now() };
  return value;
}

async function listDayBookings(date: string) {
  const bookings = await clearooms("GET", `/bookings?date=${date}`);
  return (Array.isArray(bookings) ? bookings : []) as ClearoomsBooking[];
}

async function deleteBooking(bookingId: string) {
  try {
    await clearooms("DELETE", `/bookings/${encodeURIComponent(bookingId)}`);
  } catch (error) {
    if (!(error instanceof ClearoomsError && error.status === 404)) throw error;
  }
}

async function createBooking(date: string, from: string, until: string, guestName: string) {
  const created = await clearooms("POST", "/bookings", {
    desk_id: RACKET_DESK_ID,
    date: `${date} ${from}:00`,
    end_date: `${date} ${until === "24:00" ? "23:59" : until}:00`,
    guest_name: guestName,
  });
  const booking = (Array.isArray(created) ? created[0] : created) as { id?: string } | null;
  if (!booking?.id) throw new ClearoomsError(0, "Clearooms hat keine Buchungsnummer geliefert.");
  return booking.id;
}

function berlinTimestamp(date: string, time: string) {
  return `${date} ${time === "24:00" ? "23:59" : time}:00 Europe/Berlin`;
}

function describeRow(row: BookingRow | null) {
  if (!row) return { state: "none" };
  const booked = row.booked_from && row.booked_until
    ? { date: berlinParts(row.booked_from).date, from: berlinParts(row.booked_from).time, until: berlinParts(row.booked_until).time }
    : {};
  const busy = row.busy_from && row.busy_until
    ? { busyFrom: berlinParts(row.busy_from).time, busyUntil: berlinParts(row.busy_until).time }
    : {};
  return { state: row.state, ...booked, ...busy };
}

async function readRow(admin: SupabaseClient, subject: Subject) {
  const { data, error } = await admin.from("racket_bookings")
    .select("*")
    .eq("subject_type", subject.type)
    .eq("subject_id", subject.id)
    .maybeSingle();
  if (error) throw error;
  return data as BookingRow | null;
}

async function writeRow(admin: SupabaseClient, subject: Subject, values: Partial<BookingRow>) {
  const row = {
    subject_type: subject.type,
    subject_id: subject.id,
    clearooms_booking_id: null,
    booked_from: null,
    booked_until: null,
    busy_from: null,
    busy_until: null,
    ...values,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await admin.from("racket_bookings")
    .upsert(row, { onConflict: "subject_type,subject_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as BookingRow;
}

async function loadProfile(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from("profiles").select("player_id, app_role").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data as { player_id: string | null; app_role: string | null } | null;
}

// Liefert den Sollzustand der Schlägerbuchung und prüft dabei, ob das Konto die Partie verwalten darf.
async function resolveMatch(admin: SupabaseClient, matchId: string, userId: string): Promise<Desired | "forbidden"> {
  const { data: match, error } = await admin.from("matches")
    .select("id, season_id, display_label, competition_stage, match_at, cancelled_at, actual_sets, result_details")
    .eq("id", matchId)
    .maybeSingle();
  if (error) throw error;
  if (!match) return { kind: "none" };

  const profile = await loadProfile(admin, userId);
  if (profile?.app_role !== "admin") {
    const { data: member } = await admin.from("match_players")
      .select("player_id")
      .eq("match_id", matchId)
      .eq("player_id", profile?.player_id ?? "")
      .maybeSingle();
    if (!member) return "forbidden";
  }

  const { data: season } = await admin.from("seasons").select("counts_for_profile").eq("id", match.season_id).maybeSingle();
  if (season?.counts_for_profile === false) return { kind: "none" };
  if (match.actual_sets || match.result_details) return { kind: "frozen" };
  const { count } = await admin.from("result_proposals")
    .select("id", { count: "exact", head: true })
    .eq("match_id", matchId)
    .eq("status", "pending");
  if (count) return { kind: "frozen" };
  if (match.cancelled_at || !match.match_at) return { kind: "none" };
  if (new Date(match.match_at).getTime() <= Date.now()) return { kind: "frozen" };
  const { date, time } = berlinParts(match.match_at);
  return { kind: "slot", date, time, guestName: `${matchLabel(match)} – PadelLiga` };
}

async function resolveTraining(admin: SupabaseClient, sessionId: string, userId: string): Promise<Desired | "forbidden"> {
  if (!/^\d+$/.test(sessionId)) return { kind: "none" };
  const { data: session, error } = await admin.from("training_sessions")
    .select("id, played_on, display_time, player_ids, created_by, status")
    .eq("id", Number(sessionId))
    .maybeSingle();
  if (error) throw error;
  if (!session) return { kind: "none" };

  const profile = await loadProfile(admin, userId);
  const playerIds = (session.player_ids || []) as string[];
  const mayManage = profile?.app_role === "admin"
    || session.created_by === userId
    || Boolean(profile?.player_id && playerIds.includes(profile.player_id));
  if (!mayManage) return "forbidden";

  if (playerIds.some((playerId) => TEST_PLAYER_IDS.has(playerId))) return { kind: "none" };
  if (session.status !== "scheduled") return { kind: "frozen" };
  const time = String(session.display_time).slice(0, 5);
  if (!isDateValue(session.played_on) || !isTimeValue(time)) return { kind: "frozen" };
  const now = berlinParts(new Date());
  if (`${session.played_on} ${time}` <= `${now.date} ${now.time}`) return { kind: "frozen" };
  return { kind: "slot", date: session.played_on, time, guestName: "Training – PadelLiga" };
}

async function reconcile(admin: SupabaseClient, subject: Subject, desired: Desired) {
  const row = await readRow(admin, subject);
  if (desired.kind === "frozen") return describeRow(row);

  if (desired.kind === "none") {
    if (row?.clearooms_booking_id) await deleteBooking(row.clearooms_booking_id);
    if (row) {
      const { error } = await admin.from("racket_bookings").delete()
        .eq("subject_type", subject.type).eq("subject_id", subject.id);
      if (error) throw error;
    }
    return { state: "none" };
  }

  const plan = planSlot(desired.date, desired.time, await getWorkingHours());
  const ownBookingId = row?.clearooms_booking_id ?? null;
  if (plan.state === "outside_hours") {
    if (ownBookingId) await deleteBooking(ownBookingId);
    await writeRow(admin, subject, { state: "outside_hours" });
    return { state: "outside_hours", date: plan.date, openFrom: plan.openFrom, openUntil: plan.openUntil };
  }

  const dayBookings = await listDayBookings(plan.date);
  const result = { date: plan.date, from: plan.from, until: plan.until, openFrom: plan.openFrom, openUntil: plan.openUntil };
  const ownBookingExists = Boolean(ownBookingId && dayBookings.some((booking) =>
    booking.id === ownBookingId && booking.checkin_status !== "cancelled"));
  const stored = describeRow(row) as { date?: string; from?: string; until?: string };
  if (ownBookingExists && stored.date === plan.date && stored.from === plan.from && stored.until === plan.until) {
    return { state: plan.state === "partial" ? "partial" : "booked", ...result };
  }

  const busy = findBusyWindow(dayBookings, RACKET_DESK_ID, plan, ownBookingId);
  if (ownBookingId) await deleteBooking(ownBookingId);
  if (busy) {
    await writeRow(admin, subject, {
      state: "busy",
      busy_from: berlinTimestamp(plan.date, busy.from),
      busy_until: berlinTimestamp(plan.date, busy.until),
    });
    return { state: "busy", ...result, busyFrom: busy.from, busyUntil: busy.until };
  }

  try {
    const bookingId = await createBooking(plan.date, plan.from, plan.until, desired.guestName);
    const state = plan.state === "partial" ? "partial" : "booked";
    await writeRow(admin, subject, {
      state,
      clearooms_booking_id: bookingId,
      booked_from: berlinTimestamp(plan.date, plan.from),
      booked_until: berlinTimestamp(plan.date, plan.until),
    });
    return { state, ...result };
  } catch (error) {
    await writeRow(admin, subject, { state: "failed" });
    console.error("Schlägerbuchung fehlgeschlagen", error instanceof Error ? error.message : error);
    return { state: "failed", ...result };
  }
}

async function check(admin: SupabaseClient, body: Record<string, unknown>) {
  const { date, time } = body;
  if (!isDateValue(date) || !isTimeValue(time)) return jsonResponse({ error: "Datum und Uhrzeit sind erforderlich." }, 400);
  const subject = readSubject(body);
  const row = subject ? await readRow(admin, subject) : null;
  const plan = planSlot(date, time, await getWorkingHours());
  if (plan.state === "outside_hours") return jsonResponse({ ...plan });
  const busy = findBusyWindow(await listDayBookings(date), RACKET_DESK_ID, plan, row?.clearooms_booking_id ?? null);
  return jsonResponse(busy ? { ...plan, state: "busy", busyFrom: busy.from, busyUntil: busy.until } : { ...plan });
}

async function status(admin: SupabaseClient, body: Record<string, unknown>) {
  const readIds = (value: unknown) => (Array.isArray(value) ? value : []).map(String).filter(Boolean).slice(0, 100);
  const matchIds = readIds(body.matchIds);
  const trainingIds = readIds(body.trainingIds);
  const rows: BookingRow[] = [];
  for (const [type, ids] of [["match", matchIds], ["training", trainingIds]] as const) {
    if (!ids.length) continue;
    const { data, error } = await admin.from("racket_bookings").select("*").eq("subject_type", type).in("subject_id", ids);
    if (error) throw error;
    rows.push(...(data as BookingRow[]));
  }
  return jsonResponse({
    bookings: rows.map((row) => ({ subjectType: row.subject_type, subjectId: row.subject_id, ...describeRow(row) })),
  });
}

function readSubject(body: Record<string, unknown>): Subject | null {
  const type = body.subjectType;
  const id = String(body.subjectId ?? "").trim();
  if ((type !== "match" && type !== "training") || !id) return null;
  return { type, id };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Methode nicht erlaubt." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Schlägerbuchung ist nicht vollständig konfiguriert." }, 500);
  }
  if (!authorization) return jsonResponse({ error: "Nicht angemeldet." }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) return jsonResponse({ error: "Nicht angemeldet." }, 401);
  if (!userData.user.email_confirmed_at) return jsonResponse({ error: "Bitte zuerst die E-Mail-Adresse bestätigen." }, 403);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  try {
    if (body.action === "check") return await check(admin, body);
    if (body.action === "status") return await status(admin, body);
    if (body.action === "sync") {
      const subject = readSubject(body);
      if (!subject) return jsonResponse({ error: "Partie oder Training fehlt." }, 400);
      const desired = subject.type === "match"
        ? await resolveMatch(admin, subject.id, userData.user.id)
        : await resolveTraining(admin, subject.id, userData.user.id);
      if (desired === "forbidden") return jsonResponse({ error: "Keine Berechtigung für diese Schlägerbuchung." }, 403);
      return jsonResponse(await reconcile(admin, subject, desired));
    }
    return jsonResponse({ error: "Unbekannte Aktion." }, 400);
  } catch (error) {
    console.error("Schlägerbuchung nicht prüfbar", error instanceof Error ? error.message : error);
    return jsonResponse({ state: "unavailable" });
  }
});
