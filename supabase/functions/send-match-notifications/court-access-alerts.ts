export type CourtAccessAlert = {
  incident_id: number;
  user_id: string;
  recipient_email: string;
  reason: string;
  idempotency_key: string;
};

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

export function renderCourtAccessAlert(reason: string, siteUrl: string) {
  const destination = new URL(siteUrl);
  destination.searchParams.set("konto", "1");
  const body = reason === "login_required"
    ? "Die Playtomic-Anmeldung ist nicht mehr gültig. Melde dich bei Playtomic neu an und ersetze den gespeicherten Cookie in den Server-Einstellungen."
    : reason === "configuration"
    ? "Der gespeicherte Playtomic-Lesezugang fehlt oder hat ein ungültiges Format. Hinterlege einen aktuellen Cookie in den Server-Einstellungen."
    : "Der Hallencode konnte bei Playtomic nicht gelesen werden. Bitte prüfe den Abruf. Bei einer vorübergehenden Störung kann ein späterer Aufruf wieder funktionieren; falls die Anmeldung abgelaufen ist, muss der gespeicherte Cookie ersetzt werden.";
  const subject = reason === "login_required" || reason === "configuration"
    ? "PadelLiga: Playtomic-Lesezugang erneuern" : "PadelLiga: Hallencode-Abruf prüfen";
  const footer = "Diese Betriebswarnung wird je Störung einmal an bestätigte Admin-Konten gesendet. Ein erfolgreicher neuer Codeabruf hebt die Warnung automatisch auf.";
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#07080C;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0E1017;border:1px solid #29303F;border-radius:12px;">
    <tr><td style="padding:28px 28px 8px;font-size:28px;font-weight:bold;letter-spacing:1px;color:#FFFFFF;">PADEL<span style="color:#D4F53A;">LIGA</span></td></tr>
    <tr><td style="padding:8px 28px 24px;color:#F3F4F1;font-size:16px;line-height:1.5;">
      <p style="margin:0 0 16px;">Hallo,</p><p style="margin:0 0 8px;font-weight:bold;">Der Hallencode-Abruf funktioniert gerade nicht.</p>
      <p style="margin:0;">${escapeHtml(body)}</p></td></tr>
    <tr><td align="center" style="padding:0 28px 24px;"><a href="${escapeHtml(destination.href)}" style="display:inline-block;background:#D4F53A;color:#07080C;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:8px;">Admin-Konto öffnen</a></td></tr>
    <tr><td style="padding:0 28px 28px;color:#7E828B;font-size:13px;line-height:1.5;">${footer}</td></tr>
  </table></td></tr></table>`;
  return { subject, html, text: `Hallo,\n\nDer Hallencode-Abruf funktioniert gerade nicht.\n${body}\n\nAdmin-Konto öffnen: ${destination.href}\n\n${footer}` };
}

export async function dispatchCourtAccessAlerts(deps: {
  claim: (token: string) => Promise<CourtAccessAlert[]>;
  current: (job: CourtAccessAlert, token: string) => Promise<boolean>;
  complete: (job: CourtAccessAlert, token: string, success: boolean) => Promise<void>;
  send: (job: CourtAccessAlert, mail: ReturnType<typeof renderCourtAccessAlert>) => Promise<boolean>;
  siteUrl: string;
}) {
  const token = crypto.randomUUID();
  const jobs = await deps.claim(token);
  let sent = 0, failed = 0;
  for (const job of jobs) {
    // Recovery or a role change after claiming must suppress obsolete mail.
    if (!await deps.current(job, token)) continue;
    let success = false;
    try { success = await deps.send(job, renderCourtAccessAlert(job.reason, deps.siteUrl)); }
    catch { /* Provider errors may contain private data. Store only success. */ }
    if (success) sent++; else failed++;
    await deps.complete(job, token, success);
  }
  return { claimed: jobs.length, sent, failed };
}
