window.PADEL_SEASON = {
  id: "test-2026",
  label: "Test-Saison",
  title: "Padel-Liga · Test-Saison",
  competition: {
    tournamentMode: "none",
    qualificationPlaces: 0,
    homeRankingLimit: 4,
    regularScheduleLocked: false,
    predictionsEnabled: true
  },
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
    { playerId: "ludi_ionos", startElo: 800 },
    { playerId: "ludwig_w", startElo: 1100 }
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
      team1: { playerIds: ["ludi_gmx", "ludi_ionos"] },
      team2: { playerIds: ["ludi_gmail", "ludwig_w"] }
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
      team1: { playerIds: ["ludi_gmx", "ludwig_w"] },
      team2: { playerIds: ["ludi_gmail", "ludi_ionos"] }
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
      team1: { playerIds: ["ludi_gmail", "ludwig_w"] },
      team2: { playerIds: ["ludi_gmx", "ludi_ionos"] }
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
      team1: { playerIds: ["ludi_gmail", "ludi_ionos"] },
      team2: { playerIds: ["ludi_gmx", "ludwig_w"] }
    }
  ],
  articles: []
};
