window.PADEL_SEASON = {
  id: "2026-winter",
  label: "Winter 2026",
  title: "Padel-Liga Winter 2026",
  startDate: "2026-10-01",
  resultsEntryEnabled: true,
  competition: {
    tournamentMode: "top8-semifinals",
    qualificationPlaces: 8,
    homeRankingLimit: 4,
    regularScheduleLocked: false,
    predictionsEnabled: false
  },
  organizations: ["Headsquare", "Hanako", "Envidual"],
  leagues: [
    { id: "main", label: "Padel-Liga Winter 2026", default: true }
  ],
  shortInfo: [
    "Jeder Teilnehmer hat 6 Partien.",
    "Partner und Gegner werden jede Partie neu gelost.",
    "Es gibt kein fixes Datum, sondern Zeitfenster. Die Spieler stimmen sich selbst ab.",
    "Eine Partie hat 2 Gewinnsätze, bei 1:1 entscheidet der Match-Tie-Break bis 10 Punkte.",
    "Die Top 8 nach jeweils 6 Partien qualifizieren sich für das Halbfinale.",
    "Die vier Spieler der beiden siegreichen Halbfinalteams spielen im Final Four um den Titel."
  ],
  matchdays: [],
  participants: [
    { playerId: "marco_m", startElo: 1199 },
    { playerId: "luca_w", startElo: 1090 },
    { playerId: "jonas_l", startElo: 953 },
    { playerId: "marcel_m", startElo: 1179 },
    { playerId: "ludwig_w", startElo: 1145 },
    { playerId: "chris_m", startElo: 934 },
    { playerId: "andreas_l", startElo: 1051 },
    { playerId: "lukas_p", startElo: 1155 },
    { playerId: "greta_p", startElo: 838 },
    { playerId: "raphael_h", startElo: 936 },
    { playerId: "christoph_l", startElo: 787 },
    { playerId: "leonie_r", startElo: 704 },
    { playerId: "niklas_k", startElo: 784 },
    { playerId: "martin_b", startElo: 566 },
    { playerId: "agnes_k", startElo: 564 },
    { playerId: "florian_z", startElo: 814 },
    { playerId: "lisa_s", startElo: 800 },
    { playerId: "christian_h", startElo: 800 },
    { playerId: "lukas_t", startElo: 750 },
    { playerId: "yonatan_g", startElo: 800 }
  ],
  matches: [
    {
      id: "winter-2026-semifinal-1",
      type: "season",
      stage: "semifinal",
      seasonId: "2026-winter",
      format: "best-of-three",
      countsForRanking: false,
      countsForElo: true,
      matchday: 1,
      date: null,
      time: null,
      result: null,
      sets: null,
      winner: null,
      displayLabel: "Halbfinale 1",
      team1: { playerIds: [], qualifierRanks: [1, 2], qualifierLabels: ["Platz 1", "Platz 2"] },
      team2: { playerIds: [], qualifierRanks: [7, 8], qualifierLabels: ["Platz 7", "Platz 8"] }
    },
    {
      id: "winter-2026-semifinal-2",
      type: "season",
      stage: "semifinal",
      seasonId: "2026-winter",
      format: "best-of-three",
      countsForRanking: false,
      countsForElo: true,
      matchday: 1,
      date: null,
      time: null,
      result: null,
      sets: null,
      winner: null,
      displayLabel: "Halbfinale 2",
      team1: { playerIds: [], qualifierRanks: [3, 4], qualifierLabels: ["Platz 3", "Platz 4"] },
      team2: { playerIds: [], qualifierRanks: [5, 6], qualifierLabels: ["Platz 5", "Platz 6"] }
    },
    {
      id: "winter-2026-final-1",
      type: "season",
      stage: "final-four",
      seasonId: "2026-winter",
      format: "single-set",
      countsForRanking: false,
      countsForElo: true,
      matchday: 2,
      date: null,
      time: null,
      result: null,
      sets: null,
      winner: null,
      displayLabel: "Final Four 1",
      team1: { playerIds: [], qualifierRanks: [1, 2], qualifierLabels: ["Finalist 1", "Finalist 2"] },
      team2: { playerIds: [], qualifierRanks: [3, 4], qualifierLabels: ["Finalist 3", "Finalist 4"] }
    },
    {
      id: "winter-2026-final-2",
      type: "season",
      stage: "final-four",
      seasonId: "2026-winter",
      format: "single-set",
      countsForRanking: false,
      countsForElo: true,
      matchday: 2,
      date: null,
      time: null,
      result: null,
      sets: null,
      winner: null,
      displayLabel: "Final Four 2",
      team1: { playerIds: [], qualifierRanks: [1, 4], qualifierLabels: ["Finalist 1", "Finalist 4"] },
      team2: { playerIds: [], qualifierRanks: [2, 3], qualifierLabels: ["Finalist 2", "Finalist 3"] }
    },
    {
      id: "winter-2026-final-3",
      type: "season",
      stage: "final-four",
      seasonId: "2026-winter",
      format: "single-set",
      countsForRanking: false,
      countsForElo: true,
      matchday: 2,
      date: null,
      time: null,
      result: null,
      sets: null,
      winner: null,
      displayLabel: "Final Four 3",
      team1: { playerIds: [], qualifierRanks: [1, 3], qualifierLabels: ["Finalist 1", "Finalist 3"] },
      team2: { playerIds: [], qualifierRanks: [2, 4], qualifierLabels: ["Finalist 2", "Finalist 4"] }
    }
  ],
  homeAnnouncement: {
    label: "Saisonstart Winter 2026",
    title: "Die Liga startet!",
    body: [
      {
        type: "p",
        text: "Das Teilnehmerfeld steht, die Elo-Werte wurden berechnet und der Spielplan ist erstellt."
      },
      {
        type: "p",
        text: "Zwanzig Spieler gehen in die Wintersaison, darunter vier Neulinge: Christian H., Lisa S., Lukas T. und Yonatan G. Wie schlagen sie sich gegen die Spieler mit Sommer-Erfahrung?"
      },
      {
        type: "p",
        text: "Luca W. startet als amtierender Champion. Verteidigt er seinen Titel? Nach Elo liegt er zum Auftakt nur auf Platz fünf. Dass das aber nichts heißen muss, hat die letzte Saison gezeigt."
      },
      {
        type: "p",
        text: "Der Weg ins Final Four wird länger: Diesmal ziehen die Top 8 ins Halbfinale ein. Headsquare und Envidual stellen je acht Spieler, Hanako vier - das Firmenduell geht in die nächste Runde."
      },
      {
        type: "p",
        text: "Ab jetzt kann es losgehen!"
      }
    ],
    link: { label: "Zur Partienübersicht", target: "partien" }
  },
  articles: []
};