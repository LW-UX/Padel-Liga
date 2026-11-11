# Hallencode ausschließlich lesen

`POST { "matchId": "…" }` beziehungsweise `POST { "trainingId": 123 }` an die
geschützte Edge Function liefert nur einem bestätigten Liga-Konto den aktuellen
Hallencode seiner zugeordneten aktiven Platzbuchung. Berechtigt sind Partie-
beziehungsweise Trainingsteilnehmer und Admins. Trainings laufen intern unter
der Kennung `training:<ID>` durch dieselben geschützten RPCs und denselben
Cache (Migration `20261111150000_training_court_access_codes.sql`); ein
eingetragenes Trainingsergebnis beendet die Ausgabe wie bei Partien.
Nur Indoor-Buchungen der Plätze H1–H4 liefern einen Code. Außenplätze und
unbekannte Platzkennungen lösen keinen Playtomic-Abruf aus und liefern `none`.
Die Provider-ID wird serverseitig ermittelt und nicht vom Browser übernommen. Nach dem Abruf wird
die Berechtigung erneut geprüft. Codes werden ausschließlich im privaten,
zugriffsgeschützten Buchungscache gespeichert. Sitzungsschlüssel liegen nur
als Function-Secret vor. Beide werden nicht protokolliert. HTTP-Antworten sind
`no-store` und enthalten weder Provider-ID noch Sitzungsschlüssel.
Kopierte Cookie-Header werden aus den beiden benannten JWT-Cookies neu
aufgebaut. Zeilenumbrüche zwischen Cookie-Paaren und ein optionales `Cookie:`
am Anfang sind zulässig; fremde Cookies werden ignoriert. Doppelte Anmelde-Cookies
und beschädigte JWT-Werte werden vor einem Netzwerkaufruf abgewiesen.

Playtomic erhält ausschließlich einen GET auf
`https://app.playtomic.com/app_tabs/profile/activity/bookings/<UUID>`.
Weiterleitungen, Scripts, Formulare, Loginversuche und sämtliche Buchungs- oder
Stornierungsaktionen sind ausgeschlossen. Ein fehlender, abgelaufener oder
abgewiesener Zugang liefert nur `unavailable`; es gibt keine automatische
Neuanmeldung. Die bislang geprüfte Sitzung hat keine Erneuerung nachgewiesen.

## Einrichtung durch Codex

1. Nutzerfreigabe für die Datenbankmigration
   `20261106230000_court_access_code_subject.sql` einholen. Sie ergänzt den
   privaten Codecache und ausschließlich für `service_role` ausführbare
   Berechtigungs-, Leseauftrags- und Cache-Schreibfunktionen. Bestehende
   Buchungen werden nicht verändert.
2. Migration ausschließlich über `tools/supabase-mcp.mjs` anwenden und die
   Function `court-access-code` über denselben Helfer bereitstellen.
3. Eine gesondert zur dauerhaften Servernutzung freigegebene Playtomic-Sitzung
   als Function-Secret `PLAYTOMIC_READ_ONLY_SESSION_COOKIE` hinterlegen.
   Eine nur für einen vorübergehenden Test erteilte Freigabe genügt nicht.
   Keine Schlüssel oder Passwörter in Chat, Git oder Frontend hinterlegen.
   `tools/supabase-mcp.mjs store-playtomic-session <Buchungs-ID>` öffnet hierfür
   einen lokalen Eingabehelfer auf Loopback. Erst das ausdrückliche Absenden
   durch den Nutzer und ein erfolgreicher lesender Abruf erlauben die Speicherung
   des Secrets. Der Helfer endet nach Erfolg, spätestens nach 15 Minuten.
4. Abruf mit berechtigtem Konto live prüfen; fremde Konten und abgelaufene oder
   stornierte Buchungen dürfen keinen Code erhalten. Die Website veröffentlicht
   ausschließlich der Nutzer durch seinen GitHub-Push.

`tools/supabase-mcp.mjs probe-court-access-codes <Partie-IDs,kommagetrennt>`
stellt einen kurzlebigen Prüfer mit zufälligem Zugriffsschlüssel bereit. Er
verwendet einen über eine lesende MCP-Abfrage ermittelten bestätigten Admin und
denselben Handler sowie dieselben RPCs wie der produktive Abruf. Er erzeugt
keinen Liga-Login und gibt nur Erfolg, Code-Vorhandensein und Cachetreffer aus,
niemals Codes, Cookie-Werte oder Projektzugangsschlüssel. Der Prüfer wird nach
dem Lauf entfernt. Der Test kann die Codes der angegebenen Partien im privaten
Servercache ablegen; Playtomic wird ausschließlich per GET gelesen.

Partiecard und persönlicher Spieltagscontainer laden bei Bedarf denselben
gespeicherten Code. Der erste Abruf liest Playtomic einmal; ab acht Minuten vor
Beginn wird bei Bedarf einmal erneuert. Ein erster Aufruf innerhalb der letzten
acht Minuten benötigt nur den aktuellen Abruf. Parallele Anfragen werden über
einen 30-Sekunden-Leseauftrag serialisiert; Fehler erhalten eine einminütige
Sperrfrist. Eine fehlgeschlagene Erneuerung gibt keinen alten Code zurück.
Ein offener Browser fragt an der Acht-Minuten-Grenze automatisch neu an; es gibt
keine minütlichen Playtomic-Abfragen und keinen externen Hintergrundabruf.
Ausblenden oder Schließen entfernt Codes aus der Ansicht. Buchungsende oder
Ergebniseintragung beenden die serverseitige Ausgabe. Stornierungen und Änderungen
an Platz oder Buchungszeit verwerfen den Cache; abgelaufene Einträge werden bei
nachfolgenden Codeabrufen bereinigt. Die Mails bleiben die Datenquelle für
Buchungsimport und Stornierungen; Hallencodes ändern keine Buchung.

## Betriebswarnungen

Die ergänzende Migration `20261107000000_court_access_health_alerts.sql`
benötigt vor produktiver Anwendung die Datenbankfreigabe des Nutzers. Sie
ergänzt einen privaten Störungsstatus und eine private Versandwarteschlange,
ohne Buchungen oder Ergebnisse zu verändern. Danach `court-access-code` und
`send-match-notifications` bereitstellen. Letztere nutzt weiterhin ihren
bestehenden Fünf-Minuten-Zeitplan und dieselben Mail-Secrets.

Nur ein echter, berechtigter Leseauftrag kann über
`finish_court_access_code_read_with_health` eine Störung eröffnen oder aufheben.
Cachetreffer, unberechtigte Aufrufe und überholte Leseantworten verändern den
Status nicht. Die vier festen Kategorien sind `login_required`,
`configuration`, `unavailable` und `code_unavailable`. Es werden keine
Cookies, Codes, externen Fehlermeldungen oder Buchungsdetails gespeichert.
`get_my_court_access_health` ist ausschließlich für bestätigte Admins lesbar;
Browserrollen können weder die privaten Tabellen noch Versand-RPCs verwenden.

Pro zusammenhängender Störung entsteht ein Versandauftrag je zu diesem
Zeitpunkt bestätigtem Admin. Versandwiederholungen verwenden dieselbe
Resend-Idempotenzkennung, höchstens fünf Versuche innerhalb von 23 Stunden.
Eine erfolgreiche neue Codeabfrage beendet die Störung und verwirft noch
offene Mails. Unmittelbar vor dem Versand werden Störung, Auftrag und
Admin-Berechtigung erneut geprüft. Bereits von Resend angenommene Mails können
nicht zurückgerufen werden. Alte Versandnachweise werden nach 30 Tagen bei
einem Dispatcher-Lauf bereinigt. Weder Statusabruf noch Mailversand fragen
Playtomic zusätzlich ab. Der Hinweis im Konto verschwindet beim nächsten
Laden des aktuellen Betriebsstatus; eine spätere neue Störung darf erneut
eine Mail auslösen.
