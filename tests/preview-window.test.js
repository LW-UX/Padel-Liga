const assert = require('node:assert/strict');
const test = require('node:test');
const { availability, opensOn } = require('../js/preview-window.js');

const season = {
  competition: { tournamentMode: 'top8-semifinals' },
  matchdays: [
    { spieltag: 1, startDate: '2026-10-05', endDate: '2026-10-09' },
    { spieltag: 2, startDate: '2026-10-19', endDate: '2026-10-23' },
    { spieltag: 3, startDate: '2026-11-02', endDate: '2026-11-06' },
    { spieltag: 4, startDate: '2026-11-16', endDate: '2026-11-20' }
  ],
  matches: []
};
const match = spieltag => ({
  id: `partie-${spieltag}`,
  stage: 'league',
  spieltag,
  sieger: null,
  countsForElo: true,
  team1: { playerIds: ['a', 'b'] },
  team2: { playerIds: ['c', 'd'] }
});
const at = date => new Date(`${date}T12:00:00Z`);

test('tips and full previews share the current and next matchday window', () => {
  const now = at('2026-10-21');
  assert.equal(availability(match(1), season, now), 'preview', 'overdue');
  assert.equal(availability(match(2), season, now), 'preview', 'current');
  assert.equal(availability(match(3), season, now), 'preview', 'next');
  assert.equal(availability(match(4), season, now), 'basic');
  assert.equal(availability({ ...match(4), matchAt: '2026-11-18T17:00:00Z' }, season, now), 'preview', 'scheduled');
});

test('a distant match opens the day after the window two matchdays earlier ends', () => {
  assert.equal(opensOn(match(4), season, at('2026-10-21')), '2026-10-24');
  assert.equal(opensOn(match(3), season, at('2026-10-21')), null, 'already open');
  assert.equal(opensOn({ ...match(4), matchAt: '2026-11-18T17:00:00Z' }, season, at('2026-10-21')), null);
});

test('without a computable window the opening date stays unknown', () => {
  const cup = { competition: { tournamentMode: 'knockout-redraw' }, matchdays: [], matches: [
    { ...match(1), stage: 'quarterfinal' }, { ...match(2), stage: 'semifinal' }
  ] };
  assert.equal(availability(cup.matches[1], cup, at('2026-10-21')), 'basic');
  assert.equal(opensOn(cup.matches[1], cup, at('2026-10-21')), null);
});
