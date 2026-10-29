# Konten und Arbeitsabläufe

Diese Datei ist die kanonische Quelle für Rollen, Registrierung, Einladungen, Berechtigungen und den privaten Konto-Dialog.

## Konten, Rollen und Identität

- Liga, Cup und Tippspiel verwenden dasselbe Padel-Konto. Es gibt die Rollen `tipper`, `player` und `admin`.
- Öffentliche Selbstregistrierung ist auf die in der Datenbank freigegebenen Firmen-Domains begrenzt. Admins dürfen unabhängig davon eine einzelne gültige Arbeits-E-Mail für ein Spielerprofil vorbereiten.
- E-Mail-Adressen, Spieler-IDs und konkrete Kontozuordnungen werden nicht öffentlich ausgeliefert. Die Allowlist arbeitet mit E-Mail-Hashes. Die öffentliche Tipprangliste liefert ausschließlich den daraus abgeleiteten Wahrheitswert, ob ein Konto mit irgendeinem Spielerprofil verknüpft ist, damit sie Spieler- und Tipper-Icon unterscheiden kann.
- Der Konto-Anzeigename wird aus der E-Mail abgeleitet und kann nicht frei geändert werden. Öffentliche Spielernamen bleiben davon getrennte Stammdaten.
- Ein Tipper-Konto kann später kontrolliert einem Spieler zugeordnet und zur Spielerrolle erweitert werden.
- Nach dem Login wird das verbundene Spielerprofil nach Möglichkeit vorausgewählt. Die sichtbare Spielerauswahl bleibt frei bedienbar und ist keine Sicherheitsgrenze; Berechtigungen werden serverseitig aus Konto, Rolle und Spieler-ID bestimmt.
- Die Systemmails von Supabase für Registrierungsbestätigung und Passwort-Zurücksetzen werden über ein eigenes Firmenpostfach als SMTP-Absender verschickt. Die deutschen Vorlagen liegen kanonisch in `supabase/templates/` und werden in der Supabase-Auth-Konfiguration hinterlegt. Seit dem Wechsel auf den Firmenabsender dürfen die Vorlagen das gebrandete PadelLiga-Layout mit dunklem Hintergrund und hervorgehobenem Aktionsknopf verwenden; der frühere Darstellungsfilter ist nicht mehr maßgeblich.
- Automatische Partie- und Tippmails sind von den Supabase-Auth-Mails getrennt. Eine serverseitige Supabase Edge Function versendet sie über den freigegebenen Transaktionsmaildienst im gebrandeten Layout der Passwort-Zurücksetzen-Mail. Versandaufträge sind idempotent und werden nur an Konten mit bestätigter E-Mail-Adresse zugestellt.
- Einmal verwendbare Bestätigungs-, Einladungs- und Wiederherstellungslinks sind 48 Stunden gültig und führen zuerst auf eine neutrale Liga-Zwischenseite. Erst die bewusste Bestätigung dort öffnet den eigentlichen Supabase-Link, damit automatische Linkprüfungen von Mailprogrammen und Firmenfiltern ihn nicht vor dem Nutzer verbrauchen. Bei der Passwort-Wiederherstellung wird die eigentliche Bestätigungsadresse als Query-Parameter `confirmation_url` an die Zwischenseite übergeben, weil Firmenfilter URL-Fragmente entfernen können.
- Am kontogebundenen PadelTipp einschließlich des Schnelltipps in der Partievorschau dürfen alle Konten mit bestätigter E-Mail teilnehmen. Tipper, Spieler und Admins besitzen dabei denselben einen Tipp je Partie; eine Spielerzuordnung ist nicht erforderlich.

## Spielereinladungen

- Ein Admin ordnet einem bestehenden Spielerprofil eine eindeutige Arbeits-E-Mail zu. Der Spieler erhält einen persönlichen, zeitlich begrenzten Link und legt sein Passwort selbst fest; der Admin erzeugt und kennt kein Passwort.
- Zuordnung und Einladungsvorbereitung sind getrennte Aktionen. Die Anwendung zeigt Link und vorbereitete Nachricht an, versendet aber nicht selbst über einen externen Maildienst.
- Bestehende Konten werden nicht dupliziert. Soweit die Zuordnungen eindeutig sind, kann ein vorhandenes Konto mit dem Spielerprofil verbunden und erneut mit einem Passwort-Einrichtungslink eingeladen werden.
- Die Zugangsverwaltung zeigt nur den Zustand der Zuordnung, nicht die geschützte Adresse selbst.

## Konto-Dialog und Aufgaben

- Der private Konto-Dialog ist vom öffentlichen Spielerprofil getrennt. Bei verknüpften Spielern kann aus dem Konto direkt in das öffentliche Profil gewechselt werden.
- Eingeloggte Nutzer können ihr Passwort direkt im privaten Konto-Dialog ändern; dafür müssen sie ihr aktuelles Passwort erneut bestätigen. Einladung und Passwort-Wiederherstellung verwenden dieselbe geprüfte Passwortmaske ohne diese erneute Bestätigung.
- „Passwort ändern“ und „Ausloggen“ stehen im Konto hinter dem rein textlichen Einstieg „Einstellungen“ ohne zusätzliches Icon. Dort werden zusätzlich drei standardmäßig aktive, einzeln schaltbare E-Mail-Einstellungen für die Erinnerung an Ergebniseintragung, Ergebnisbestätigung und einen noch fehlenden Tipp geführt. Eine Deaktivierung gilt auch für bereits vorgemerkte, noch nicht versandte Nachrichten. Supabase-Auth-Mails bleiben davon unberührt.
- Öffentliche Seiteninhalte und Detailansichten sind unabhängig von privaten Kontoaufgaben nutzbar. Der Aufgabenzähler lädt nach dem Seitenaufbau im Hintergrund; beim Öffnen lädt die Partienübersicht ihren aktuellen Stand und zeigt währenddessen einen Ladezustand mit Wiederholungsmöglichkeit bei Fehlern.
- Mobil ist die ausgeloggte Login-Aktion wie der Desktop-Login gelb gefüllt und trägt dasselbe Benutzer-Icon wie der eingeloggte Konto-Button. Nach der Anmeldung erscheint sie neutral mit diesem Benutzer-Icon und der Beschriftung „Konto“; eine offene Kontoaufgabe markiert sie gelb und zeigt dort ihre Anzahl. Ein gleichzeitig laufendes öffentliches Livespiel hat am geschlossenen Schnellzugriff mit seinem roten Status Vorrang; nach dem Öffnen bleibt die Anzahl an der Kontoaktion sichtbar.
- Partieaufgaben werden saison- und wettbewerbsübergreifend nach ihrem fachlichen Zustand gruppiert: zu bestätigen, Ergebnis eintragen, terminiert und geplant.
- Admins sehen in der Partienübersicht standardmäßig nur relevante Partien ohne die verborgene Test-Saison und können dort auf alle Partien einschließlich Testpartien umschalten. Für andere Rollen erscheint dieser Filter nicht.
- Nur vollständig mit vier unterschiedlichen Spielern besetzte offizielle Partien werden als Aufgabe angeboten. Platzhalter erzeugen keine Terminierungs- oder Ergebnisaktionen.
- Spieler sehen nur eigene Liga- und Trainingsaufgaben. Admins sehen den administrativ zulässigen Umfang; reine Tipper sehen keine Ergebnisaufgaben.
- Eigene wartende Vorschläge sind als nicht aktiv erkennbar. Fremde Vorschläge können bestätigt oder durch eine echte Alternative ersetzt werden.
- Automatische Bestätigung erzeugt keinen zusätzlichen Countdown in der Oberfläche; bis zum Abschluss bleiben die bestehenden offenen Zustände sichtbar.
- Terminierung, Ergebnis, Training und Liveticker-Zuweisung werden innerhalb der jeweiligen Partiekarte bearbeitet. Nach einer erfolgreichen Aktion bleibt der Dialog geöffnet und lädt seine Aufgaben neu.
- Allgemeine Kontomeldungen schweben am unteren Rand des Konto-Dialogs und bleiben beim Scrollen sichtbar. Erfolgsmeldungen verschwinden nach fünf Sekunden automatisch; jede Meldung kann bewusst geschlossen werden, während Fehler und laufende Hinweise ohne Interaktion sichtbar bleiben.
- Nur Admins sehen bei offenen Ligapartien ganz links in der Aktionszeile die endgültige Aktion „Nicht werten“. Danach verschwindet die Partie aus den Kontoaufgaben; Rollen- und Zustandsprüfung erfolgen zusätzlich serverseitig.
- Trainings werden über die Partienübersicht angelegt. Formularfehler erscheinen am verursachenden Formular und überschreiben keine allgemeinen Kontomeldungen.
- Bei einem zukünftigen Training zeigt das Formular nur Termin und vier Teilnehmer als Pflichtangaben. Nach Ablauf des Termins wechselt die Karte in „Ergebnis eintragen“ und bietet dort editierbare Termin- und Teilnehmerfelder sowie Paarungen, Ergebnisformate und Satzstände an. Zusätzliche statische Termin- und Teilnehmerzeilen samt Trennlinie entfallen in diesem Zustand. Weitere Ergebnisblöcke heißen in der Oberfläche „Weitere Paarung“. Terminierte Trainings werden gemeinsam mit den Ligaaufgaben in den Gruppen „Terminiert“ beziehungsweise „Ergebnis eintragen“ geführt.
- Jede Spielerauswahl eines Trainings bietet „Gast hinzufügen“. Danach wird derselbe Teilnehmerplatz zu einem verpflichtenden Namensfeld; der Gastname umfasst zwei bis vierzig Zeichen und kann vor dem Absenden wieder durch einen bestehenden Spieler ersetzt werden.
- Interne Testprofile werden in Trainingsauswahlen nur für Admins und dafür vorgesehene Testkonten angeboten.
- Konto- und Profilmodal sperren den Hintergrundscroll und verwenden konsistente Schließen-, Button-, Dropdown- und Score-Komponenten.

## Offene Entscheidungen

- Der Umfang zukünftiger Adminfunktionen über die bestehende direkte Ergebniseingabe hinaus ist noch nicht abschließend festgelegt.
