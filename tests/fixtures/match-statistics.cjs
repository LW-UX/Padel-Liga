module.exports = function fixture(mode = 'preview') {
  return {
    availability: mode, generatedAt: '2026-10-12T12:00:00Z', matchId: 'season-2026-partie-1',
    seasonId: '2026-sommer', seasonLabel: 'Sommer 2026', qualificationPlaces: 8, label: 'Partie 1', stage: 'league',
    leaguePlayedOrdinal: mode === 'analysis' ? 18 : null,
    matchAt: '2026-10-20T16:00:00Z', result: mode === 'analysis' ? '6:3, 6:4' : null,
    sets: mode === 'analysis' ? '2:0' : null, winner: mode === 'analysis' ? 1 : null, countsForElo: true, probability: 0.61,
    players: [['greta_p','Greta P.',1050,'👩'],['agnes_k','Agnes K.',1100,'👩'],['christoph_l','Christoph L.',1000,'👨'],['marco_m','Marco M.',950,'👨']].map(([id,name,elo,profileEmoji],i) => ({
      playerId:id,displayName:name,profileEmoji,team:i<2?1:2,elo:{before:elo,after:elo+(i<2?36:-36),delta:i<2?36:-36,winMin:elo+40,winMax:elo+85,lossMin:elo-85,lossMax:elo-40,peakBefore:elo+10},
      statistics:{rank:[1,3,6,7][i],tableSize:8,played:4,wins:3-i%2,points:8-i,gameDiff:12-i*6},streak:{outcome:i<2?'win':'loss',length:3},
      form:[
        {matchId:`old-${i}-1`,label:'Partie 1',result:'6:3, 6:4',outcome:i%2?'loss':'win',decidedByMatchTiebreak:false},
        {matchId:`old-${i}-2`,label:'Partie 2',result:'6:4, 4:6, 10:8',outcome:i<2?'win':'loss',decidedByMatchTiebreak:true},
        {matchId:`old-${i}-3`,label:'Partie 3',result:'6:2, 6:2',outcome:i<2?'win':'loss',decidedByMatchTiebreak:false}
      ],
      relationships:i===0?[{kind:'successPartner',playerId:'agnes_k',name:'Agnes K.',matches:4,wins:3}]:[]
    })),
    ranking: [
      ['greta_p','Greta P.',1,2,4,3,8,12],
      ['otto_r','Otto R.',2,1,4,3,7,9],
      ['agnes_k','Agnes K.',3,3,4,2,7,6],
      ['nina_s','Nina S.',4,4,4,2,6,2],
      ['lara_t','Lara T.',5,5,4,2,6,-1],
      ['christoph_l','Christoph L.',6,7,4,3,6,0],
      ['marco_m','Marco M.',7,6,4,2,5,-6],
      ['uwe_v','Uwe V.',8,8,4,1,3,-12]
    ].map(([playerId,displayName,rank,previousRank,played,wins,points,gameDiff]) => ({
      playerId,displayName,statistics:{rank,previousRank,tableSize:8,played,wins,points,gameDiff}
    })),
    rematches:[{id:'old',date:'2026-06-01T16:00:00Z',season:'Sommer 2026',result:'6:2, 6:3',team:1,outcome:'win'}],
    company:{kind:'duel',team1:'Hanako',team2:'Envidual',wins1:3,wins2:2},
    impacts:[{kind:mode==='analysis'?'eloPeak':'eloPeakPossible',playerId:'greta_p'}, {kind:'leaderPossible',playerId:'agnes_k',onWin:true}]
  };
};
