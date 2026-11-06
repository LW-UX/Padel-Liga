# Playtomic-Buchungsmails

`playtomic-booking-mail.ts` bereitet die lokale Formaterkennung vor. Der lokale
Empfangsadapter liegt unter `../receive-court-booking/`; dessen README beschreibt
Einrichtung, Authentifizierung und die noch nicht live geprüften Grenzen.

Eingabe: MIME-dekodierter Betreff, Klartext und optional der dekodierte
`calendar.ics`-Anhang. Die Rohdatei `.eml` muss der spätere Empfangsdienst
dekodieren. HTML-only-Mails sind bislang nicht unterstützt. Der Parser öffnet
keine Links und führt keine Mailinhalte aus.

Die bereitgestellten deutschen Bestätigungen enthalten eine Playtomic-ID in
der Kalenderdatei. Die Stornierungen enthalten keine entsprechende ID im
Klartext. `sameBookingSlot` vergleicht daher Club, Platz, Berliner Datum und
Beginn, Dauer und Veranstalter als Zuordnungskandidaten. Das ist noch keine
Freigabe zur automatischen Stornierung: Bei Wiederbuchung desselben Slots,
mehreren Kandidaten oder widersprüchlichen Ereignissen muss der Import die
Ereignishistorie berücksichtigen und gegebenenfalls eine Prüfung verlangen.

Resend empfängt laut Nutzer bereits unter `buchungen@kiroimyon.resend.app`.
Der produktive Anschluss von Webhook und Datenbank steht noch aus; erlaubte
Weiterleitungsabsender und die tatsächlichen Outlook-Weiterleitungen müssen
vor der Aktivierung geprüft werden.
Ein behaupteter Playtomic-Absender im weitergeleiteten Text ist kein
Authentizitätsnachweis. Mails dürfen erst nach diesen Prüfungen Änderungen
an gespeicherten Buchungen beziehungsweise Partieverknüpfungen auslösen.

Die Tests enthalten nachgebildete Textstrukturen. Originalmails, persönliche
Header, Zahlungsdaten und Trackinglinks werden nicht im Repository abgelegt.
