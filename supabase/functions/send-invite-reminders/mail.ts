const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const intro = "wir hatten dich zur PadelLiga eingeladen, dein Zugang ist aber noch nicht aktiviert. Der damalige Link ist inzwischen abgelaufen, deshalb bekommst du hier einen neuen.";
const linkNote = "Über den Knopf legst du dein eigenes Passwort fest. Der Link ist 48 Stunden gültig und kann nur einmal verwendet werden.";
const why = "Ohne ein aktives Konto können wir dir keine Kalendereinladungen schicken oder den Zugangscode zur Halle anzeigen.";
const featuresIntro = "Des Weiteren kannst du mit deinem Spielerzugang:";
const features = [
  "deine offenen Aufgaben sehen,",
  "Termine eintragen,",
  "Ergebnisse melden oder bestätigen.",
];
const privacy = "Dein Passwort kennt nur du, auch der Administrator nicht.";
const ignore = "Falls du von all dem nicht profitieren möchtest, kannst du diese Mail einfach ignorieren.";
const action = "Zugang einrichten";

export function renderInviteReminder(name: string, link: string, test = false) {
  const firstName = name.trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Hallo ${firstName},` : "Hallo,";
  const subject = `${test ? "[Test] " : ""}Dein PadelLiga-Zugang wartet noch auf dich`;
  const testNote = test
    ? "Testmail: Der Knopf meldet dich mit deinem eigenen Konto an und öffnet die Passwortmaske wie bei den Spielern. Wenn du dort nichts speicherst, bleibt dein Passwort unverändert."
    : "";
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#07080C;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0E1017;border:1px solid #29303F;border-radius:12px;">
    <tr><td style="padding:28px 28px 8px;font-size:28px;font-weight:bold;letter-spacing:1px;color:#FFFFFF;">PADEL<span style="color:#D4F53A;">LIGA</span></td></tr>
    ${testNote ? `<tr><td style="padding:8px 28px 0;"><p style="margin:0;padding:10px 12px;border:1px dashed #D4F53A;border-radius:8px;color:#D4F53A;font-size:13px;line-height:1.5;">${escapeHtml(testNote)}</p></td></tr>` : ""}
    <tr><td style="padding:8px 28px 0;color:#F3F4F1;font-size:16px;line-height:1.5;">
      <p style="margin:0 0 16px;">${escapeHtml(greeting)}</p>
      <p style="margin:0 0 20px;">${escapeHtml(intro)}</p>
    </td></tr>
    <tr><td align="center" style="padding:0 28px 8px;">
      <a href="${escapeHtml(link)}" style="display:inline-block;background:#D4F53A;color:#07080C;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:8px;">${action}</a>
      <p style="margin:16px 0 0;color:#A8ADB7;font-size:12px;line-height:1.5;">${escapeHtml(linkNote)}</p>
    </td></tr>
    <tr><td style="padding:20px 28px 0;color:#F3F4F1;font-size:15px;line-height:1.5;">
      <p style="margin:0 0 16px;">${escapeHtml(why)}</p>
      <p style="margin:0 0 8px;">${escapeHtml(featuresIntro)}</p>
      <ul style="margin:0 0 16px;padding-left:20px;">${features.map(item => `<li style="margin:0 0 4px;">${escapeHtml(item)}</li>`).join("")}</ul>
      <p style="margin:0 0 20px;">${escapeHtml(privacy)}</p>
    </td></tr>
    <tr><td style="padding:0 28px 28px;color:#7E828B;font-size:13px;line-height:1.5;">
      <p style="margin:0 0 8px;">${escapeHtml(ignore)}</p>
      <p style="margin:0;">Viele Grüße<br>Dein Hanako-Leben-Squad</p>
    </td></tr>
  </table></td></tr></table>`;
  const text = `${testNote ? `${testNote}\n\n` : ""}${greeting}

${intro}

${action}: ${link}

${linkNote}

${why}

${featuresIntro}
${features.map(item => `- ${item}`).join("\n")}

${privacy}

${ignore}

Viele Grüße
Dein Hanako-Leben-Squad`;
  return { subject, html, text };
}
