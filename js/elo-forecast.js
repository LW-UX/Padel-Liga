(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  if (root) root.PadelEloForecast = Object.freeze(api);
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function getEloPointFactor(score) {
    const regularGames = score.regularSets.reduce(
      (totals, set) => [totals[0] + set[0], totals[1] + set[1]],
      [0, 0]
    );
    const regularDifference = Math.abs(regularGames[0] - regularGames[1]);
    const tiebreakDifference = score.matchTiebreak
      ? (Math.abs(score.matchTiebreak[0] - score.matchTiebreak[1]) / 10) * 3
      : 0;
    return Math.pow(Math.log10(regularDifference + tiebreakDifference + 1), 3) + 2;
  }

  function getAutoTipForecast(teamOneProbability, teamOneElos = [], teamTwoElos = []) {
    const teamOne = Math.round(Number(teamOneProbability));
    if (!Number.isFinite(teamOne)) return null;
    const teamTwo = 100 - teamOne;
    const maximum = values => Math.max(...values.map(Number).filter(Number.isFinite), -Infinity);
    const winner = teamOne > teamTwo ? 1 : teamTwo > teamOne ? 2
      : maximum(teamTwoElos) > maximum(teamOneElos) ? 2 : 1;
    const favorite = Math.max(teamOne, teamTwo);

    let winnerSets;
    if (favorite >= 80) winnerSets = [[6, 0], [6, 0]];
    else if (favorite >= 70) winnerSets = [[6, 1], [6, 1]];
    else if (favorite >= 63) winnerSets = [[6, 2], [6, 2]];
    else if (favorite >= 58) winnerSets = [[6, 3], [6, 3]];
    else if (favorite >= 54) winnerSets = [[6, 4], [6, 4]];
    else winnerSets = [[6, 4], [4, 6], [10, 8]];

    const toTeams = pair => winner === 1 ? [...pair] : [pair[1], pair[0]];
    const regularSets = winnerSets.slice(0, 2).map(toTeams);
    const matchTiebreak = winnerSets[2] ? toTeams(winnerSets[2]) : null;
    const score = { regularSets, matchTiebreak };
    return {
      winner,
      favorite,
      score,
      pointFactor: getEloPointFactor(score),
      entry: {
        set1: regularSets[0].map(String),
        set2: regularSets[1].map(String),
        tb: matchTiebreak ? matchTiebreak.map(String) : ['', '']
      }
    };
  }

  function projectElo(playerElo, opponentElos, won, pointFactor) {
    const oldElo = Number(playerElo);
    const opponents = opponentElos.map(Number);
    if (!Number.isFinite(oldElo) || opponents.length !== 2 || opponents.some(value => !Number.isFinite(value)) || !Number.isFinite(Number(pointFactor))) return null;
    const expected = opponents.reduce(
      (sum, opponentElo) => sum + 1 / (1 + Math.pow(10, (opponentElo - oldElo) / 500)),
      0
    ) / opponents.length;
    return Math.round(oldElo + Number(pointFactor) * 50 * ((won ? 1 : 0) - expected));
  }

  return { getAutoTipForecast, getEloPointFactor, projectElo };
});
