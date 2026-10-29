import { createClient } from "npm:@supabase/supabase-js@2";

type NotificationType =
  | "result_entry"
  | "result_confirmation"
  | "prediction_reminder"
  | "calendar_invitation"
  | "calendar_cancellation";

type NotificationJob = {
  job_id: number;
  notification_type: NotificationType;
  recipient_email: string;
  recipient_name: string;
  season_id: string;
  season_label: string;
  match_id: string;
  match_label: string;
  team_one_label: string;
  team_two_label: string;
  match_at: string;
  actual_sets: string | null;
  result_details: string | null;
  idempotency_key: string;
};

type CalendarDetails = {
  job_id: number;
  calendar_uid: string;
  calendar_sequence: number;
  event_start: string;
};

const CALENDAR_LOCATION = "Lucky Star Padel";
const CALENDAR_DURATION_MINUTES = 60;

const jsonHeaders = { "Content-Type": "application/json" };

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeSiteUrl(value: string) {
  const url = new URL(value);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function formatMatchAt(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date).replace(",", " ·") + " Uhr";
}

function isCalendarJob(job: NotificationJob) {
  return job.notification_type === "calendar_invitation" || job.notification_type === "calendar_cancellation";
}

function formatIcsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcsText(value: unknown) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replace(/\r?\n/g, "\\n");
}

// RFC 5545 limits content lines to 75 octets; longer lines continue after
// CRLF and a single space without splitting a UTF-8 character.
function foldIcsLine(line: string) {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const character of line) {
    const characterBytes = encoder.encode(character).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (currentBytes + characterBytes > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function extractMailAddress(sender: string) {
  return sender.match(/<([^>]+)>/)?.[1]?.trim() || sender.trim();
}

function buildCalendar(job: NotificationJob, calendar: CalendarDetails, organizer: string, destination: string) {
  const cancelled = job.notification_type === "calendar_cancellation";
  const start = new Date(calendar.event_start);
  const end = new Date(start.getTime() + CALENDAR_DURATION_MINUTES * 60 * 1000);
  const description = [
    `${job.season_label} · ${job.match_label}`,
    `${job.team_one_label} vs. ${job.team_two_label}`,
    "",
    `PadelLiga: ${destination}`,
  ].join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//PadelLiga//Partietermine//DE",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${cancelled ? "CANCEL" : "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:${calendar.calendar_uid}`,
    `SEQUENCE:${calendar.calendar_sequence}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${escapeIcsText(`PadelLiga: ${job.team_one_label} vs. ${job.team_two_label}`)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(CALENDAR_LOCATION)}`,
    `ORGANIZER;CN=PadelLiga:mailto:${organizer}`,
    `ATTENDEE;CN="${String(job.recipient_name || job.recipient_email).replace(/["\r\n]/g, "")}";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${job.recipient_email}`,
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
    "X-MICROSOFT-CDO-INTENDEDSTATUS:BUSY",
  ];
  if (!cancelled) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcsText(`PadelLiga: ${job.match_label}`)}`,
      "TRIGGER:-PT1H",
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return {
    method: cancelled ? "CANCEL" : "REQUEST",
    content: lines.map(foldIcsLine).join("\r\n") + "\r\n",
  };
}

function encodeBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function buildDestination(job: NotificationJob, siteUrl: URL) {
  if (job.notification_type === "prediction_reminder") {
    const url = new URL("tipp/", siteUrl);
    url.searchParams.set("saison", job.season_id);
    return url.href;
  }
  const url = new URL(siteUrl);
  url.searchParams.set("saison", job.season_id);
  url.searchParams.set("konto", "1");
  return url.href;
}

function getMailContent(job: NotificationJob, calendar?: CalendarDetails) {
  const matchName = `${job.season_label} · ${job.match_label}`;
  const calendarSubject = `${job.match_label} – PadelLiga ${job.season_label}`;
  if (job.notification_type === "calendar_invitation") {
    const moved = (calendar?.calendar_sequence ?? 0) > 0;
    return {
      subject: calendarSubject,
      intro: moved ? "Eure Partie wurde verschoben." : "Eure Partie ist terminiert.",
      body: moved
        ? "Die Kalendereinladung im Anhang ersetzt den bisherigen Termin in deinem Kalender."
        : "Die Kalendereinladung im Anhang trägt den Termin in deinen Kalender ein. Wird er verschoben oder abgesagt, bekommst du automatisch eine Aktualisierung.",
      action: "Partie ansehen",
      matchName,
    };
  }
  if (job.notification_type === "calendar_cancellation") {
    return {
      subject: `Abgesagt: ${calendarSubject}`,
      intro: "Der Termin eurer Partie entfällt.",
      body: "Die Absage im Anhang entfernt den Termin aus deinem Kalender. Sobald ein neuer Termin feststeht, bekommst du eine neue Einladung.",
      action: "Partie ansehen",
      matchName,
    };
  }
  if (job.notification_type === "result_entry") {
    return {
      subject: `PadelLiga: Ergebnis für ${job.match_label} eintragen`,
      intro: "Das Ergebnis eurer Partie ist noch offen.",
      body: "Der geplante Spielbeginn liegt fünf Stunden zurück. Trage das Ergebnis jetzt ein, damit das andere Team es bestätigen kann.",
      action: "Ergebnis eintragen",
      matchName,
    };
  }
  if (job.notification_type === "result_confirmation") {
    const proposedResult = [job.actual_sets, job.result_details].filter(Boolean).join(" · ");
    return {
      subject: `PadelLiga: Ergebnis für ${job.match_label} bestätigen`,
      intro: "Ein Ergebnis wartet auf deine Bestätigung.",
      body: proposedResult
        ? `Der Vorschlag „${proposedResult}“ wurde vor vier Stunden eingetragen. Bestätige ihn oder sende eine abweichende Alternative.`
        : "Der Ergebnisvorschlag wurde vor vier Stunden eingetragen. Bestätige ihn oder sende eine abweichende Alternative.",
      action: "Ergebnis prüfen",
      matchName,
    };
  }
  return {
    subject: `PadelLiga: Tipp für ${job.match_label} nicht vergessen`,
    intro: "Dein Tipp fehlt noch.",
    body: "Diese Partie beginnt in rund 24 Stunden und du hast noch keinen Tipp abgegeben. Bis zum Spielbeginn kannst du deinen Tipp eintragen und ändern.",
    action: "Jetzt tippen",
    matchName,
  };
}

function renderMail(job: NotificationJob, destination: string, calendar?: CalendarDetails) {
  const content = getMailContent(job, calendar);
  const greeting = job.recipient_name ? `Hallo ${job.recipient_name},` : "Hallo,";
  const matchAt = formatMatchAt(calendar?.event_start ?? job.match_at);
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#07080C;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0E1017;border:1px solid #29303F;border-radius:12px;">
        <tr>
          <td style="padding:28px 28px 8px;">
            <a href="${escapeHtml(destination)}" style="color:#FFFFFF;text-decoration:none;font-size:28px;font-weight:bold;letter-spacing:1px;">PADEL<span style="color:#D4F53A;">LIGA</span></a>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 28px 0;color:#F3F4F1;font-size:16px;line-height:1.5;">
            <p style="margin:0 0 16px;">${escapeHtml(greeting)}</p>
            <p style="margin:0 0 8px;font-weight:bold;">${escapeHtml(content.intro)}</p>
            <p style="margin:0 0 20px;">${escapeHtml(content.body)}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#141823;border:1px solid #29303F;border-radius:8px;">
              <tr><td style="padding:14px 16px 4px;color:#D4F53A;font-size:13px;font-weight:bold;">${escapeHtml(content.matchName)}</td></tr>
              <tr><td style="padding:2px 16px;color:#F3F4F1;font-size:15px;font-weight:bold;">${escapeHtml(job.team_one_label)} <span style="color:#7E828B;font-weight:normal;">vs.</span> ${escapeHtml(job.team_two_label)}</td></tr>
              <tr><td style="padding:4px 16px 14px;color:#A8ADB7;font-size:13px;">${escapeHtml(matchAt)}</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 28px 24px;">
            <a href="${escapeHtml(destination)}" style="display:inline-block;background:#D4F53A;color:#07080C;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:8px;">${escapeHtml(content.action)}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px 20px;color:#A8ADB7;font-size:13px;line-height:1.5;">
            <p style="margin:0 0 8px;">Falls der Knopf nicht funktioniert, öffne diesen Link:</p>
            <p style="margin:0;overflow-wrap:anywhere;word-break:break-word;"><a href="${escapeHtml(destination)}" style="color:#D4F53A;text-decoration:underline;">PadelLiga im Browser öffnen</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px 28px;color:#7E828B;font-size:13px;line-height:1.5;">
            <p style="margin:0 0 8px;">Melde dich bei Fragen gerne beim Hanako-Leben-Squad.</p>
            <p style="margin:0;">Diese automatische E-Mail kannst du jederzeit in deinem PadelLiga-Konto unter „Einstellungen“ ausschalten.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
  const text = `${greeting}

${content.intro}
${content.body}

${content.matchName}
${job.team_one_label} vs. ${job.team_two_label}
${matchAt}

${content.action}: ${destination}

Diese automatische E-Mail kannst du jederzeit in deinem PadelLiga-Konto unter „Einstellungen“ ausschalten.`;
  return { ...content, html, text };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Methode nicht erlaubt." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const sender = Deno.env.get("NOTIFICATION_FROM") || "PadelLiga <noreply@padelliga.envidual.com>";
  const publicSiteUrl = Deno.env.get("PUBLIC_SITE_URL") || "https://padelliga.envidual.com/";
  const authorization = request.headers.get("Authorization") || "";

  if (!supabaseUrl || !serviceRoleKey || !resendApiKey) {
    return jsonResponse({ error: "Benachrichtigungsdienst ist nicht vollständig konfiguriert." }, 500);
  }
  if (authorization !== `Bearer ${serviceRoleKey}`) {
    return jsonResponse({ error: "Nicht erlaubt." }, 401);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${serviceRoleKey}` } },
  });
  const claimToken = crypto.randomUUID();
  const { data, error } = await serviceClient.rpc("claim_due_email_notifications", {
    p_claim_token: claimToken,
    p_limit: 25,
  });
  if (error) return jsonResponse({ error: error.message }, 500);

  const jobs = (data || []) as NotificationJob[];
  const siteUrl = normalizeSiteUrl(publicSiteUrl);
  const calendarDetails = new Map<number, CalendarDetails>();
  if (jobs.some(isCalendarJob)) {
    const { data: calendarRows, error: calendarError } = await serviceClient.rpc(
      "get_claimed_calendar_notifications",
      { p_claim_token: claimToken },
    );
    if (calendarError) {
      console.error("Kalenderdaten konnten nicht geladen werden:", calendarError.message);
    }
    for (const row of (calendarRows || []) as CalendarDetails[]) calendarDetails.set(row.job_id, row);
  }
  let sent = 0;
  let failed = 0;

  for (const job of jobs) {
    const destination = buildDestination(job, siteUrl);
    const calendar = calendarDetails.get(job.job_id);
    const mail = renderMail(job, destination, calendar);
    let success = false;
    let providerMessageId: string | null = null;
    let failureMessage: string | null = null;

    try {
      const attachments = [];
      if (isCalendarJob(job)) {
        if (!calendar) throw new Error("Kalenderdaten für den Versandauftrag fehlen.");
        const invitation = buildCalendar(job, calendar, extractMailAddress(sender), destination);
        attachments.push({
          filename: invitation.method === "CANCEL" ? "padelliga-absage.ics" : "padelliga-termin.ics",
          content: encodeBase64(invitation.content),
          content_type: `text/calendar; charset=utf-8; method=${invitation.method}`,
        });
      }
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendApiKey}`,
          "Idempotency-Key": job.idempotency_key,
        },
        body: JSON.stringify({
          from: sender,
          to: [job.recipient_email],
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          ...(attachments.length ? { attachments } : {}),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.message || `Resend antwortete mit HTTP ${response.status}.`);
      success = true;
      providerMessageId = result?.id || null;
      sent += 1;
    } catch (sendError) {
      failureMessage = sendError instanceof Error ? sendError.message : "Unbekannter Versandfehler.";
      failed += 1;
    }

    const { error: completionError } = await serviceClient.rpc("complete_email_notification", {
      p_job_id: job.job_id,
      p_claim_token: claimToken,
      p_success: success,
      p_provider_message_id: providerMessageId,
      p_error: failureMessage,
    });
    if (completionError) {
      console.error(`Versandstatus für Auftrag ${job.job_id} konnte nicht gespeichert werden:`, completionError.message);
    }
  }

  return jsonResponse({ claimed: jobs.length, sent, failed });
});
