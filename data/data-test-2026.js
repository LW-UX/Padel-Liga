window.PADEL_SEASON = {
  id: "test-2026",
  label: "Test-Saison",
  title: "Padel-Liga · Test-Saison",
  startDate: "2026-07-01",
  databaseResults: true,
  resultsEntryEnabled: true,
  organizations: ["Testbetrieb"],
  leagues: [
    { id: "main", label: "Test-Liga", default: true }
  ],
  shortInfo: [
    "Diese Saison dient ausschließlich zum Testen der neuen Ergebnis- und Bestätigungsabläufe.",
    "Ein Spieler trägt das Ergebnis ein, ein Spieler des gegnerischen Teams bestätigt oder macht einen Gegenvorschlag.",
    "Bestätigte Ergebnisse aktualisieren Tabelle und Elo automatisch."
  ],
  matchdays: [
    { spieltag: 1, startDate: "2026-07-15", endDate: "2026-07-16" },
    { spieltag: 2, startDate: "2026-12-01", endDate: "2026-12-03" }
  ],
  participants: [
    { playerId: "ludi_gmx", startElo: 800 },
    { playerId: "ludi_gmail", startElo: 800 },
    { playerId: "ludwig_w", startElo: 1100 },
    { playerId: "agnes_k", startElo: 750 },
    { playerId: "greta_p", startElo: 900 },
    { playerId: "raphael_h", startElo: 1100 },
    { playerId: "luca_w", startElo: 800 },
    { playerId: "lukas_p", startElo: 1150 }
  ],
  matches: [
    {
      id: "test-2026-partie-1",
      type: "season",
      seasonId: "test-2026",
      countsForRanking: true,
      countsForElo: true,
      matchday: 1,
      date: "2026-07-15",
      time: "18.00",
      result: null,
      sets: null,
      winner: null,
      team1: { playerIds: ["ludi_gmx", "agnes_k"] },
      team2: { playerIds: ["ludi_gmail", "raphael_h"] }
    },
    {
      id: "test-2026-partie-2",
      type: "season",
      seasonId: "test-2026",
      countsForRanking: true,
      countsForElo: true,
      matchday: 1,
      date: "2026-07-16",
      time: "18.00",
      result: null,
      sets: null,
      winner: null,
      team1: { playerIds: ["ludi_gmx", "greta_p"] },
      team2: { playerIds: ["ludi_gmail", "ludwig_w"] }
    },
    {
      id: "test-2026-partie-3",
      type: "season",
      seasonId: "test-2026",
      countsForRanking: true,
      countsForElo: true,
      matchday: 2,
      date: "2026-12-01",
      time: "18.00",
      result: null,
      sets: null,
      winner: null,
      team1: { playerIds: ["ludi_gmail", "luca_w"] },
      team2: { playerIds: ["ludi_gmx", "lukas_p"] }
    },
    {
      id: "test-2026-partie-4",
      type: "season",
      seasonId: "test-2026",
      countsForRanking: true,
      countsForElo: true,
      matchday: 2,
      date: "2026-12-03",
      time: "18.00",
      result: null,
      sets: null,
      winner: null,
      team1: { playerIds: ["ludwig_w", "ludi_gmx"] },
      team2: { playerIds: ["ludi_gmail", "agnes_k"] }
    }
  ],
  articles: []
};
