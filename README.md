# Padel-Liga – Datenmodell für mehrere Saisons

Die statische Webseite trennt dauerhafte Spielerdaten, saisonabhängige Daten und Trainingsspiele. Alle Verknüpfungen erfolgen über stabile IDs; Namen werden nur einmal zentral gepflegt.

Die fortlaufenden Projektentscheidungen stehen in [`docs/PROJECT_DECISIONS.md`](docs/PROJECT_DECISIONS.md) und werden bei neuen oder geänderten Entscheidungen aktualisiert.

## Dateien

```text
padel-liga/
├── index.html
├── tipp/
│   └── index.html                 Eigenständige Padeltipp-Seite
├── style.css
├── js/
│   ├── app.js                    Navigation, Berechnungen und Darstellung
│   └── tippspiel.js              Login, Tipps und Tippspiel-Tabelle
├── data/
│   ├── players.js                Globale Spieler-Stammdaten
│   ├── seasons.js                Verfügbare Saisons und Standard-Saison
│   ├── data2026.js               Teilnehmer, Ligaspiele und Inhalte der Saison 2026
│   ├── data-test-2026.js          Temporäre Test-Saison für Ergebnisabläufe
│   ├── training-matches.js       Saisonunabhängige Trainingsspiele
│   ├── supabase-config.js         Öffentliche Supabase-Verbindungsdaten
│   └── info.js                   Globale Regeln und allgemeine Infos
├── supabase/
│   └── migrations/               Datenbankschema, Rechte und Startdaten
├── docs/
│   └── PROJECT_DECISIONS.md      Fortlaufendes Projektgedächtnis
└── tools/
    └── elo-calculator.html       Internes Elo-Hilfsmittel
```

## Spieler

Jeder Spieler wird genau einmal in `data/players.js` angelegt. Die ID bleibt dauerhaft unverändert, auch wenn sich der Anzeigename ändert oder der Spieler eine Saison aussetzt.

```js
{ id: "agnes_k", name: "Agnes K.", initials: "AK", firma: "Headsquare" }
```

Die Firma gehört ebenfalls zu den dauerhaften Stammdaten und wird nicht in den einzelnen Saisons wiederholt.

## Saison-Teilnehmer

Eine Saison enthält nur ihre tatsächlichen Teilnehmer. `startElo` ist der eingefrorene Stand des offiziellen, saisonübergreifenden Elo-Kontos beim Saisonstart.

```js
participants: [
  {
    playerId: "agnes_k",
    startElo: 750
  }
]
```

Bei der nächsten Teilnahme wird der letzte offizielle Elo-Wert als neuer `startElo` übernommen. Setzt ein Spieler eine Saison aus, bleibt sein Elo währenddessen unverändert.

## Mehrere Ligen vorbereiten

Eine Saison kann neutral eine oder später mehrere Ligen definieren. Für 2026 existiert nur die bisherige Liga:

```js
leagues: [
  { id: "main", label: "Padel-Liga 2026", default: true }
]
```

Solange eine Saison nur eine Liga besitzt, müssen Teilnehmer und Spiele kein `leagueId` angeben; die einzige Liga wird automatisch verwendet. Bei mehreren Ligen wird die Zuordnung ausdrücklich gespeichert:

```js
{ playerId: "agnes_k", startElo: 708, leagueId: "liga-b" }

{
  id: "season-2027-liga-b-partie-1",
  leagueId: "liga-b",
  // weitere Spieldaten
}
```

Es ist bewusst noch kein Final-, Aufstiegs- oder Ligamodus festgelegt. Die bestehende Oberfläche zeigt weiterhin nur die als Standard markierte Liga. Eine Liga-Auswahl und besondere Regeln werden erst ergänzt, wenn der tatsächliche Modus feststeht.

## Ligaspiele

Spieler werden ausschließlich über IDs referenziert. Match-IDs sind global eindeutig und enthalten die Saison.

```js
{
  id: "season-2026-partie-31",
  type: "season",
  seasonId: "2026",
  countsForRanking: true,
  countsForElo: true,
  matchday: 7,
  date: "2026-08-06",
  time: "12.30",
  team1: { playerIds: ["agnes_k", "ludwig_w"] },
  team2: { playerIds: ["raphael_h", "greta_p"] },
  result: "6:4, 3:6 – 10:7",
  sets: "2:1",
  winner: 1
}
```

Offene Spiele verwenden für `result`, `sets` und `winner` jeweils `null`.

## Elo

Elo-Verläufe werden nicht mehr manuell gespeichert. Die Anwendung berechnet sie reproduzierbar aus:

- dem `startElo` des Saison-Teilnehmers,
- allen abgeschlossenen Spielen derselben Saison mit `countsForElo: true`,
- Datum, Uhrzeit, Ergebnis und stabiler Match-ID.

Der Saisonverlauf beginnt mit dem eingefrorenen Startwert und enthält nur Elo-Änderungen dieser Saison. Der Endwert wird zum Startwert der nächsten Teilnahme. Trainingsspiele verändern den Elo nicht; offizielle Final-Four-Spiele können ihn als Saisonspiele verändern. Sobald die Finalisten feststehen, werden dort die Platzhalter durch ihre echten `playerIds` ersetzt.

## Trainingsspiele

Trainingsspiele liegen saisonunabhängig in `data/training-matches.js`. Auch Spieler, die nicht an der aktuellen Saison teilnehmen, dürfen dort vorkommen; sie müssen lediglich in `players.js` angelegt sein.

```js
{
  id: "training-2026-08-12-01",
  type: "training",
  date: "2026-08-12",
  time: "18.00",
  team1: { playerIds: ["agnes_k", "ludwig_w"] },
  team2: { playerIds: ["raphael_h", "greta_p"] },
  result: "6:4, 3:6 – 10:7",
  sets: "2:1",
  winner: 1,
  countsForRanking: false,
  countsForElo: false
}
```

Die beiden Flags müssen bei Trainingsspielen immer `false` sein. Die Anwendung prüft dies beim Laden, damit ein Trainingsspiel nicht versehentlich Tabelle oder Elo verändert.

## Weitere Saison anlegen

1. Eine neue Saisondatei nach dem Muster von `data/data2026.js` erstellen.
2. Nur die Teilnehmer dieser Saison samt eingefrorenem `startElo` eintragen.
3. Alle Spiele mit neuen, global eindeutigen Match-IDs und Spieler-IDs anlegen.
4. Die Saison in `data/seasons.js` registrieren und bei Bedarf als Standard markieren.

Alte Saisondateien bleiben erhalten. Dadurch können frühere Saisonstände weiterhin über die URL geladen und später in saisonübergreifenden Ansichten zusammengeführt werden:

```text
index.html?saison=2026
```

## Tippspiel und Benutzerkonten

Das Tippspiel liegt unter `/tipp/` und verwendet Supabase für Benutzerkonten, gespeicherte Tipps und die öffentliche Tabelle. Getippt wird das Satzergebnis:

- exakt richtiges Ergebnis: 4 Punkte,
- richtiger Sieger bei anderem Satzergebnis: 2 Punkte,
- falscher Sieger: 0 Punkte.

Ein Tipp kann bis zum in der Datenbank hinterlegten Spielbeginn geändert werden. Spiele ohne festgelegte Uhrzeit bleiben zunächst offen. Sobald bei einem Spiel `actual_sets` gesetzt wird, schließt die Datenbank das Spiel automatisch für weitere Tipps und die Tabelle berechnet die Punkte neu.

Die Datenbank trennt Spieler, Saisons, Ligen, Saison-Teilnahmen, Spiele, Benutzerkonten und Tipps. Dadurch kann eine spätere Saison mehrere Ligen erhalten, ohne für die aktuelle Saison bereits einen konkreten Spiel- oder Finalmodus festzulegen.

## Spielergebnisse und Rollen

Die Saison 2026 bleibt unverändert dateibasiert. Die temporäre Saison `test-2026` erprobt den künftigen Datenbankablauf:

- Neue Konten erhalten zunächst die Rolle `tipper`.
- Vorab hinterlegte und bestätigte E-Mail-Adressen werden automatisch einem Spielerprofil zugeordnet.
- Spielernamen werden zentral gepflegt und können im Konto nicht geändert werden.
- Ein beteiligter Spieler schlägt ein Ergebnis mit dem tatsächlichen Datum und der tatsächlichen Uhrzeit vor. Ein Spieler des anderen Teams bestätigt oder macht einen Gegenvorschlag.
- Der tatsächliche Termin darf vom Plan abweichen, aber nicht in der Zukunft liegen. Mit der Bestätigung wird er zum offiziellen Spieltermin.
- Nur bestätigte Ergebnisse aktualisieren Rangliste und Elo. Die vier Elo-Änderungen werden unveränderbar je Partie gespeichert und unter dem Ergebnis angezeigt.
- Admins können Resultate ohne Bestätigung direkt eintragen.
- Liga-Partien können nicht durch Spieler angelegt werden.

Der Konto-Dialog trennt „Spiele“ und „Einstellungen“. Unter „Spiele“ zeigt der Filter „Offen“ nur bereits fällige Partien und laufende Bestätigungen; „Alle Spiele“ enthält zusätzlich zukünftige und bestätigte Saisonpartien. Unter „Einstellungen“ können reine Tipper ihren Namen ändern und alle Konten sich ausloggen. Unbestätigte Vorschläge sind nicht an der öffentlichen Partie sichtbar. Tipps schließen weiterhin ausschließlich zum hinterlegten Spielbeginn.

## Trainingsspiele

Spieler können im Konto-Dialog ein saisonunabhängiges Training mit Datum, Uhrzeit und genau vier Spielern anlegen. Eine Trainingskarte kann mehrere Spielabschnitte mit wechselnden Paarungen derselben vier Spieler enthalten. Jeder Abschnitt enthält einen oder zwei tatsächlich gespielte Sätze; ein Stand von 1:1 ist zulässig. Ein anderer beteiligter Spieler muss das Training bestätigen. Trainings verändern kein Elo.

## Registrierung nach E-Mail-Domain

Die Migration legt die geschützte Tabelle `private.signup_email_domains` sowie den Hook `private.hook_restrict_signup_by_email_domain` an. Solange keine Domains eingetragen sind, bleiben Registrierungen wie bisher möglich. Sobald die erlaubten Domains gepflegt sind, wird der Hook unter **Authentication → Hooks → Before User Created** aktiviert:

```text
pg-functions://postgres/private/hook_restrict_signup_by_email_domain
```

Bereits vorhandene Konten bleiben davon unberührt. Einzelne vorab hinterlegte Spieler-E-Mail-Adressen sind auch außerhalb der später freigegebenen Domains zulässig.

Die Datei `data/supabase-config.js` enthält ausschließlich die öffentliche Projekt-URL und den öffentlichen Publishable Key. Ein Supabase Secret Key gehört weder in diese Datei noch an eine andere Stelle im Repository. Schreibzugriffe sind zusätzlich durch Row Level Security abgesichert: Benutzer können nur ihr eigenes Profil und ihre eigenen, noch offenen Tipps bearbeiten.

Für E-Mail-Bestätigungen sollte unter **Supabase → Authentication → URL Configuration** die veröffentlichte Adresse als Site URL und Redirect URL eingetragen sein:

```text
https://lw-ux.github.io/Padel-Liga/
```

Für die lokale Entwicklung kann zusätzlich beispielsweise `http://localhost:4173/**` als Redirect URL freigegeben werden.

Die Seite für Login-Tests nicht direkt als `file://…/index.html` öffnen, sondern im Projektordner über einen kleinen lokalen Webserver starten:

```text
python3 -m http.server 4173
```

Danach `http://localhost:4173/` im Browser öffnen. So besitzt die Seite eine gültige Herkunft und Bestätigungslinks können zuverlässig zurückkehren.

### Ergebnisse im Tippspiel aktualisieren

Bis es eine eigene Ergebnis-Eingabemaske gibt, werden abgeschlossene Partien kontrolliert in Supabase aktualisiert. Maßgeblich sind in `public.matches`:

- `result_details`: angezeigtes Detailergebnis,
- `actual_sets`: `2:0`, `2:1`, `1:2` oder `0:2`,
- `winner`: `1` oder `2`.

Das Setzen von `actual_sets` stellt `betting_open` automatisch auf `false`. Die statischen Saisondaten bleiben während der Übergangsphase ebenfalls die Quelle für Rangliste und Elo; Spielresultate sollten deshalb an beiden Stellen gleich gepflegt werden.

## Auf GitHub Pages veröffentlichen

Unter **Settings → Pages → Source: Deploy from branch → main → / (root)** aktivieren. Die Seite benötigt keinen Build-Schritt.
