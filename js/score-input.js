(function () {
  function parseScorePair(rawTeamOne, rawTeamTwo) {
    const rawValues = [rawTeamOne, rawTeamTwo].map(value => String(value ?? '').trim());
    if (!rawValues[0] && !rawValues[1]) return { empty: true };
    if (!rawValues[0] || !rawValues[1]) return { invalid: true, message: 'Score unvollständig' };

    const values = rawValues.map(Number);
    if (values.some(value => !Number.isInteger(value) || value < 0)) {
      return { invalid: true, message: 'Nur ganze Zahlen ab 0' };
    }
    if (values[0] === values[1]) return { invalid: true, message: 'Gewinner notwendig' };

    return { team1: values[0], team2: values[1], winner: values[0] > values[1] ? 1 : 2 };
  }

  function isValidRegularSet(score) {
    if (!score || score.empty || score.invalid) return false;
    const winnerScore = Math.max(score.team1, score.team2);
    const loserScore = Math.min(score.team1, score.team2);
    return (winnerScore === 6 && loserScore <= 4)
      || (winnerScore === 7 && [5, 6].includes(loserScore));
  }

  function isValidTiebreak(score, target) {
    if (!score || score.empty || score.invalid) return false;
    const winnerScore = Math.max(score.team1, score.team2);
    const loserScore = Math.min(score.team1, score.team2);
    return (winnerScore === target && loserScore <= target - 2)
      || (winnerScore > target && winnerScore - loserScore === 2);
  }

  function sanitizeScoreValue(value) {
    return String(value ?? '').replace(/[^\d]/g, '').slice(0, 2);
  }

  function stepScoreValue(value, delta) {
    const rawValue = String(value ?? '').trim();
    if (Number(delta) < 0 && rawValue === '') return null;
    const current = Number(rawValue || 0);
    return String(Math.max(0, Math.min(99, current + Number(delta))));
  }

  function initializePairValues(values, changedTeamIndex) {
    const nextValues = values.map(value => String(value ?? ''));
    if (!nextValues[changedTeamIndex]) return nextValues;
    const otherTeamIndex = changedTeamIndex === 0 ? 1 : 0;
    if (nextValues[otherTeamIndex] === '') nextValues[otherTeamIndex] = '0';
    return nextValues;
  }

  function setActivePair(scorePair, root = document) {
    root.querySelectorAll('.calculator-score-pair-active').forEach(element => {
      element.classList.remove('calculator-score-pair-active');
    });
    scorePair?.classList.add('calculator-score-pair-active');
  }

  window.PadelScoreInput = Object.freeze({
    initializePairValues,
    isValidRegularSet,
    isValidTiebreak,
    parseScorePair,
    sanitizeScoreValue,
    setActivePair,
    stepScoreValue
  });
})();
