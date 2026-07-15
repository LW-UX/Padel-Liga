# Padel-Liga – Datenmodell für mehrere Saisons

Die statische Webseite trennt dauerhafte Spielerdaten, saisonabhängige Daten und Trainingsspiele. Alle Verknüpfungen erfolgen über stabile IDs; Namen werden nur einmal zentral gepflegt.

## Dateien

```text
padel-liga/
├── index.html
├── style.css
├── js/
│   └── app.js                    Navigation, Berechnungen und Darstellung
├── data/
│   ├── players.js                Globale Spieler-Stammdaten
│   ├── seasons.js                Verfügbare Saisons und Standard-Saison
│   ├── data2026.js               Teilnehmer, Ligaspiele und Inhalte der Saison 2026
│   ├── training-matches.js       Saisonunabhängige Trainingsspiele
│   └── info.js                   Globale Regeln und allgemeine Infos
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

## Auf GitHub Pages veröffentlichen

Unter **Settings → Pages → Source: Deploy from branch → main → / (root)** aktivieren. Die Seite benötigt keinen Build-Schritt.
