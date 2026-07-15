# Padel-Liga 2026 – Elo-Webseite

## Dateien

```
padel-liga/
├── index.html                  ← Seitenstruktur
├── style.css                   ← Layout und Design
├── js/
│   └── app.js                  ← Navigation, Berechnungen und Darstellung
├── data/
│   ├── seasons.js              ← Verfügbare Saisons und Standard-Saison
│   ├── data2026.js             ← Saison 2026: Spieler, Spiele, Kurzinfos, Artikel
│   └── info.js                 ← Globale Regeltexte und allgemeine Infos
└── tools/
    └── elo-calculator.html     ← internes Werkzeug zur Elo-Berechnung
```

## Auf GitHub Pages veröffentlichen

1. GitHub öffnen → **New repository** → Name: `padel-liga-2026`
2. **Public** auswählen → Repository erstellen
3. Alle Dateien hochladen (Upload files)
4. Unter **Settings → Pages → Source: Deploy from branch → main → / (root)** speichern
5. Nach 1–2 Minuten ist die Seite erreichbar unter:
   `https://DEIN-USERNAME.github.io/padel-liga-2026`

## Daten aktualisieren

Nach jedem Spiel öffnest du die passende Saisondatei, zum Beispiel `data/data2026.js`, und aktualisierst:

### Spieler-Elo aktualisieren
```js
{ id: "ludwig_w", name: "Ludwig W.", history: [
  { date: "2026-05-13", elo: 1000, spiel: "Start" },
  { date: "2026-05-13", elo: 1053, spiel: "Spiel 4" },
  { date: "2026-05-19", elo: 1099, spiel: "Spiel 6" },
  { date: "2026-06-01", elo: 1120, spiel: "Spiel 8" }  // ← neu hinzufügen
]},
```

### Neues Spiel hinzufügen
```js
{
  id: "spiel8",
  datum: "2026-06-01",
  spieltag: 3,
  team1: { spieler: ["Ludwig W.", "Jonas L."], saetze: 2 },
  team2: { spieler: ["Greta P.", "Florian Z."], saetze: 1 },
  ergebnis: "6:3, 4:6, 10:7",
  sieger: 1
}
```

Saisonabhängige Texte wie Kurzinfos und Artikel liegen ebenfalls in der Saisondatei. Allgemeine Regeln und Infos liegen in `data/info.js`.

Der Elo-Rechner in `tools/elo-calculator.html` ist ein internes Hilfsmittel und nicht in der Webseite verlinkt.

## Alte Saisons öffnen

Die Saison kann über die URL ausgewählt werden:

```text
index.html?saison=2026
```

Ohne Parameter wird die Standard-Saison aus `data/seasons.js` geladen.
