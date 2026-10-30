const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {availability,entry,render,graphGeometry,analysisResultY,skeleton,headerMeta,playedOrderLabel}=require('../js/match-statistics.js');
const fixture=require('./fixtures/match-statistics.cjs');
const source=fs.readFileSync(path.resolve(__dirname,'../js/match-statistics.js'),'utf8');
const appSource=fs.readFileSync(path.resolve(__dirname,'../js/app.js'),'utf8');
const indexSource=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const styleSource=fs.readFileSync(path.resolve(__dirname,'../style.css'),'utf8');
const statisticsStyleSource=fs.readFileSync(path.resolve(__dirname,'../match-statistics.css'),'utf8');
const now=new Date('2026-10-12T10:00Z');
const match={id:'m',type:'season',stage:'league',countsForElo:true,sieger:null,spieltag:1,team1:{playerIds:['a','b']},team2:{playerIds:['c','d']}};
const season={competition:{tournamentMode:'top8'},matchdays:Array.from({length:5},(_,i)=>({spieltag:i+1,startDate:`2026-${String(10+Math.floor(i/2)).padStart(2,'0')}-${i%2?'15':'01'}`,endDate:`2026-${String(10+Math.floor(i/2)).padStart(2,'0')}-${i%2?'28':'14'}`})),matches:[match]};
test('preview windows include current, next, overdue, scheduled and season start',()=>{
 for(const spieltag of [1,2])assert.equal(availability({...match,spieltag},season,now),'preview');
 assert.equal(availability({...match,spieltag:3},season,now),'basic');
 assert.equal(availability({...match,spieltag:5,matchAt:'2026-12-20T12:00Z'},season,now),'preview');
 assert.equal(availability(match,season,new Date('2026-12-20T12:00Z')),'preview');
 assert.equal(availability(match,season,new Date('2026-09-01T12:00Z')),'preview');
 const gap={...season,matchdays:[{spieltag:1,startDate:'2026-09-01',endDate:'2026-09-10'},{spieltag:2,startDate:'2026-10-20',endDate:'2026-10-30'},{spieltag:3,startDate:'2026-11-01',endDate:'2026-11-15'}]};
 assert.equal(availability({...match,spieltag:3},gap,now),'preview');
});
test('unsupported games have no action, completed non-Elo games keep analysis',()=>{
 for(const patch of [{type:'training'},{stage:'final-four'},{countsForElo:false},{cancelledAt:'2026-01-01'},{team1:{playerIds:[]}}]) assert.equal(availability({...match,...patch},season,now),null);
 assert.equal(availability({...match,countsForElo:false,sieger:1},season,now),'analysis');
 assert.equal(availability({...match,stage:'semifinal'},season,now),null);
 assert.equal(availability({...match,stage:'semifinal'},{...season,matches:[{...match,sieger:1}]},now),'preview');
});
test('cup preview is limited to the occupied active round',()=>{
 const cup={...season,competition:{tournamentMode:'knockout_redraw'},matches:[{...match,stage:'quarterfinal'}]};
 assert.equal(availability({...match,stage:'quarterfinal'},cup,now),'preview');
 assert.equal(availability({...match,stage:'final'},cup,now),'basic');
});
test('preview availability is exposed without the former details icon and only for full previews',()=>{
 assert.equal(entry(match,season).mode,'preview');
 assert.equal(entry(match,season).icon,'');
 assert.equal(entry({...match,spieltag:5},season),null,'distant matches without a full preview stay unlinked');
 assert.equal(entry({...match,sieger:1},season).icon,'');
});
test('edited direct links cannot open previews outside the full preview window',()=>{
 const opening=source.match(/async function open\(matchId[\s\S]*?window\.PadelLiveTicker\?\.close\(\);/)?.[0]||'';
 assert.match(opening,/availability\(seasonMatch, season\) === 'basic'[\s\S]*rejectUnavailable/,'season matches are checked before the dialog opens');
 assert.match(source,/data\.availability === 'basic'\) \{ rejectUnavailable/,'server responses without a full preview are not rendered');
 assert.match(appSource,/window\.PadelLigaGetSeasonData = \(\) => PADEL_DATA;/);
});
test('article match blocks link regular statistics and Final Four histories with yellow score feedback',()=>{
 assert.match(appSource,/const statisticsDetail = window\.PadelMatchStatistics\?\.entry\(match, PADEL_DATA\)/);
 assert.match(appSource,/getMatchStage\(match\) === 'final-four'[\s\S]*data-live-open-match/);
 assert.match(appSource,/class="article-match-action"/);
 assert.match(statisticsStyleSource,/\.article-match-action:is\(:hover, :focus-visible\) ~ \.article-match-result \{ color: var\(--accent\); \}/);
});
test('content order, exclusions, escaped data and empty sections',()=>{
 const d=fixture();d.players[0].displayName='<img src=x onerror=alert(1)>';
 const html=render(d);assert.doesNotMatch(html,/<img src=x/);assert.match(html,/Erfolgspartner/);
 assert.match(html,/class="match-statistics-context"[\s\S]*?Firmenduell[\s\S]*?<strong>Rematch #1<\/strong>[\s\S]*?6:2, 6:3[\s\S]*?spielt mit ihrer aktuellen Erfolgspartnerin[\s\S]*?\(3 von 4\)/);
 assert.doesNotMatch(html,/match-statistics-player-notes/);
 assert.doesNotMatch(html,/Vorgeschichte der Partie/);
 assert.ok(html.indexOf('match-statistics-context')<html.indexOf('Form der letzten 5 Partien'));assert.ok(html.indexOf('Form der letzten 5 Partien')<html.indexOf('Rangliste'));
 assert.ok(html.indexOf('Rangliste')<html.indexOf('Was sich verändern kann'));assert.ok(html.indexOf('Was sich verändern kann')<html.indexOf('Elo-Entwicklung'));
 assert.equal((html.match(/match-statistics-form-player/g)||[]).length,4);
 assert.equal((html.match(/match-statistics-form-team/g)||[]).length,2);
 assert.match(html,/class="match-statistics-form-team match-statistics-team-1" data-form-team="1">[\s\S]*?match-statistics-form-player match-statistics-team-1[\s\S]*?match-statistics-form-player match-statistics-team-1/);
 assert.match(html,/class="match-statistics-form-team match-statistics-team-2" data-form-team="2">[\s\S]*?match-statistics-form-player match-statistics-team-2[\s\S]*?match-statistics-form-player match-statistics-team-2/);
 assert.equal((html.match(/class="form-chip/g)||[]).length,20);
 assert.equal((html.match(/data-form-player=/g)||[]).length,20);
 assert.equal((html.match(/data-form-match-id=/g)||[]).length,20);
 assert.equal((html.match(/data-form-competition=/g)||[]).length,20);
 assert.equal((html.match(/form-tiebreak/g)||[]).length,8);
 assert.match(appSource,/function getOrCreateFormTooltip\(anchor\)[\s\S]*?document\.documentElement\.classList\.contains\('is-detail-embed'\)[\s\S]*?isEmbeddedDetail\s*\? 'dialog\[open\]'\s*:\s*'dialog\[open\]:not\(\[data-presentation="panel"\]\)'[\s\S]*?modalHost \|\| document\.body[\s\S]*?host\.appendChild\(tooltip\)/);
 assert.match(appSource,/const tooltipEl = getOrCreateFormTooltip\(anchor\);/);
 assert.match(html,/Partie 2 · Sieg im Match-Tie-Break · 6:4, 4:6, 10:8/);
 assert.match(html,/data-form-player="Agnes K\." data-form-match-id="old-1-2"/);
 assert.equal((html.match(/id="match-statistics-form-help"/g)||[]).length,1);
 assert.equal((html.match(/id="match-statistics-elo-help"/g)||[]).length,1);
 assert.match(statisticsStyleSource,/\.match-statistics-form-row \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
 assert.match(statisticsStyleSource,/\.match-statistics-form-team \{[\s\S]*?display: grid;[\s\S]*?gap: 1\.5rem;/);
 assert.match(statisticsStyleSource,/\.match-statistics-form-chips \.form-chip \{[\s\S]*?opacity: 1;/);
 assert.match(statisticsStyleSource,/@media \(max-width: 768px\) \{[\s\S]*?\.match-statistics-form-row \{ grid-template-columns: minmax\(0, 1fr\);/);
 assert.ok(html.indexOf('Elo-Entwicklung')<html.indexOf('Werte und Prognosen können sich'));assert.doesNotMatch(html,/Stand:/);
 assert.doesNotMatch(html,/<title>|Dominanz|Auszeichnungen|Lieblingspartner/);
 assert.match(html,/<h3><span class="match-statistics-heading">Elo-Entwicklung<span class="th-help-wrap match-statistics-heading-help">/);
 assert.match(html,/data-help-tooltip-anchor>\?<\/span>[\s\S]*Die Fächer zeigen die Bereiche der möglichen Elo-Werte nach der Partie: grün bei einem Sieg und rot bei einer Niederlage\. Die gestrichelte Linie zeigt die Elo-Prognose des wahrscheinlichsten Ergebnisses\./);
 assert.doesNotMatch(html,/Auto-Tipp/);
 d.rematches=[];d.company=null;d.impacts=[];d.countsForElo=false;d.players.forEach(player=>{player.relationships=[];});const empty=render(d);
 assert.doesNotMatch(empty,/match-statistics-context|Vorgeschichte|Elo-Entwicklung/);assert.match(empty,/Keine bedeutenden Auswirkungen/);
 assert.match(render({...d,availability:'basic'}),/ausführliche Vorschau folgt/);
 assert.doesNotMatch(render({...d,availability:'basic'}),/Rangliste/);
});
test('multiple pairings of one training overlap but occupy one of five form groups',()=>{
 const d=fixture();
 d.players[0].form[2]={groupId:'training-7',kind:'training',date:'2026-07-01T16:00:00Z',competition:'Training',matches:[
  {matchId:'training-7-1',label:'Training · Paarung 1',result:'6:3',outcome:'win',partnerNames:['Agnes K.'],opponentNames:['Christoph L.','Marco M.']},
  {matchId:'training-7-2',label:'Training · Paarung 2',result:'4:6',outcome:'loss',partnerNames:['Marco M.'],opponentNames:['Agnes K.','Christoph L.']},
  {matchId:'training-7-3',label:'Training · Paarung 3',result:'6:4',outcome:'win',partnerNames:['Christoph L.'],opponentNames:['Agnes K.','Marco M.']}
 ]};
 const html=render(d);
 const player=html.match(/<div class="match-statistics-form-player match-statistics-team-1">[\s\S]*?<\/div>/)?.[0]||'';
 assert.equal((player.match(/match-statistics-form-group/g)||[]).length,5);
 assert.equal((player.match(/data-form-match-id=/g)||[]).length,7);
 assert.match(player,/match-statistics-form-group is-multi-match/);
 assert.match(player,/data-form-competition="Training"[\s\S]*?data-form-partner="Agnes K\."[\s\S]*?data-form-opponents="Christoph L\. &amp; Marco M\."/);
 assert.match(statisticsStyleSource,/\.match-statistics-form-group\.is-multi-match \.form-chip \+ \.form-chip \{ margin-left: -7\.33px; \}/);
});
test('relationship facts combine each player\'s statements in one centered sentence',()=>{
 const d=fixture();
 d.players[0].relationships=[
  {kind:'successPartner',playerId:'agnes_k',name:'Agnes K.',matches:4,wins:3},
  {kind:'fearedPartner',playerId:'marco_m',name:'Marco M.',matches:3,wins:1},
  {kind:'favoriteOpponent',playerId:'christoph_l',name:'Christoph L.',matches:3,wins:2},
  {kind:'fearedOpponent',playerId:'marco_m',name:'Marco M.',matches:4,wins:1}
 ];
 d.players[2].relationships=[
  {kind:'successPartner',playerId:'marco_m',name:'Marco M.',matches:4,wins:3},
  {kind:'fearedPartner',playerId:'agnes_k',name:'Agnes K.',matches:3,wins:1},
  {kind:'favoriteOpponent',playerId:'marco_m',name:'Marco M.',matches:3,wins:2},
  {kind:'fearedOpponent',playerId:'agnes_k',name:'Agnes K.',matches:4,wins:1}
 ];
 const html=render(d);
 const context=html.match(/<section class="match-statistics-context"[\s\S]*?<\/section>/)?.[0]||'';
 assert.equal((context.match(/match-statistics-context-fact match-statistics-relationship/g)||[]).length,2);
 assert.match(context,/Firmenduell/);
 assert.match(context,/<strong>Rematch #1<\/strong>/);
 assert.match(context,/data-player-profile-id="greta_p"[\s\S]*spielt mit ihrer aktuellen Erfolgspartnerin[\s\S]*, spielt mit ihrem aktuellen Angstpartner[\s\S]*, trifft auf ihren aktuellen Lieblingsgegner[\s\S]* und trifft auf ihren aktuellen Angstgegner/);
 assert.match(context,/data-player-profile-id="christoph_l"[\s\S]*spielt mit seinem aktuellen Erfolgspartner[\s\S]*, spielt mit seiner aktuellen Angstpartnerin[\s\S]*, trifft auf seinen aktuellen Lieblingsgegner[\s\S]* und trifft auf seine aktuelle Angstgegnerin/);
 assert.equal((context.match(/data-player-profile-id="greta_p"/g)||[]).length,1);
 assert.equal((context.match(/data-player-profile-id="christoph_l"/g)||[]).length,2);
});
test('two relationship facts are connected with und without a comma',()=>{
 const d=fixture();
 d.players[0].relationships.push({kind:'fearedOpponent',playerId:'marco_m',name:'Marco M.',matches:3,wins:1});
 const context=render(d).match(/<section class="match-statistics-context"[\s\S]*?<\/section>/)?.[0]||'';
 assert.match(context,/Greta P\.[\s\S]*spielt mit ihrer aktuellen Erfolgspartnerin[\s\S]*\(3 von 4\)<\/span> und trifft auf ihren aktuellen Angstgegner[\s\S]*\(1 von 3\)<\/span>\.<\/p>/);
 assert.doesNotMatch(context,/<\/span>, und/);
});
test('rematches and earlier duels form one numbered multiline fact',()=>{
 const d=fixture();
 d.rematches.push({id:'older',date:'2026-05-01T16:00:00Z',season:'Winter 2025',result:'4:6, 6:4, 10:8',team:2,outcome:'loss'});
 const html=render(d);
 const history=html.match(/<p class="match-statistics-context-fact match-statistics-rematches">[\s\S]*?<\/p>/)?.[0]||'';
 assert.match(history,/<strong>Rematch #2<\/strong>[\s\S]*?6:2, 6:3<\/span><br><span><strong>Früheres Duell<\/strong>/);
 assert.match(history,/6:4, 4:6, 8:10/);
 assert.equal((html.match(/match-statistics-rematches/g)||[]).length,1);
});
test('possible Elo peaks use an outline icon and achieved peaks use a filled icon',()=>{
 const preview=render(fixture());
 const previewImpactPanel=preview.match(/<section class="match-statistics-section match-statistics-impact-panel">[\s\S]*?<\/section>/)?.[0]||'';
 assert.match(previewImpactPanel,/Greta P\.[\s\S]*?Kann einen neuen Elo-Höchstwert erreichen\./);
 assert.equal((preview.match(/Kann einen neuen Elo-Höchstwert erreichen\./g)||[]).length,1);
 assert.doesNotMatch(preview,/Neuer Höchstwert möglich/);
 assert.match(preview,/class="match-statistics-peak-star possible"/);
 assert.match(preview,/href="#statistics-peak-star-icon"[^>]+width="14" height="14" class="match-statistics-peak-star possible"/);
 assert.doesNotMatch(preview,/★/);
 const analysis=render(fixture('analysis'));
 const impactPanel=analysis.match(/<section class="match-statistics-section match-statistics-impact-panel">[\s\S]*?<\/section>/)?.[0]||'';
 assert.match(impactPanel,/Greta P\.[\s\S]*?Erreicht einen neuen Elo-Höchstwert\./);
 assert.equal((analysis.match(/Erreicht einen neuen Elo-Höchstwert\./g)||[]).length,1);
 assert.match(analysis,/class="match-statistics-peak-star achieved"/);
 assert.match(analysis,/class="match-statistics-value match-statistics-delta-value pos">\+36<\/text>/);
 assert.match(analysis,/class="match-statistics-value match-statistics-delta-value neg">-36<\/text>/);
 assert.match(statisticsStyleSource,/\.match-statistics-peak-star\.possible \{ fill: none; stroke: var\(--positiv\); \}/);
 assert.match(statisticsStyleSource,/\.match-statistics-peak-star\.achieved \{ fill: var\(--statistics-player-color, var\(--statistics-team-color, var\(--accent\)\)\);/);
 assert.match(statisticsStyleSource,/\.match-statistics-svg \.match-statistics-delta-value\.pos \{ fill: var\(--positiv\); \}/);
 assert.match(statisticsStyleSource,/\.match-statistics-svg \.match-statistics-delta-value\.neg \{ fill: var\(--negativ\); \}/);
});
test('significant impacts are grouped as facts below each affected player',()=>{
 const d=fixture();
 d.impacts.push(
  {kind:'qualificationPossible',playerId:'agnes_k',places:4,onWin:true}
 );
 const html=render(d);
 const panel=html.match(/<section class="match-statistics-section match-statistics-impact-panel">[\s\S]*?<\/section>/)?.[0]||'';
 assert.equal((panel.match(/data-player-profile-id="agnes_k"/g)||[]).length,1);
 assert.match(panel,/Agnes K\.[\s\S]*Kann bei einem Sieg die Tabellenführung übernehmen\.[\s\S]*Kann bei einem Sieg die Top 4 erreichen\./);
 assert.doesNotMatch(panel,/Agnes K\. kann|Team 1 gewinnt/);
});
test('impossible ranking impacts are not displayed',()=>{
 const d=fixture();
 d.impacts=[
  {kind:'leaderPossible',playerId:'agnes_k',onWin:false},
  {kind:'leaderLossPossible',playerId:'agnes_k',onWin:true},
  {kind:'qualificationPossible',playerId:'agnes_k',places:4,onWin:false},
  {kind:'qualificationLossPossible',playerId:'agnes_k',places:4,onWin:true}
 ];
 const html=render(d);
 assert.match(html,/Keine bedeutenden Auswirkungen\./);
 assert.doesNotMatch(html,/bei einer Niederlage die Tabellenführung übernehmen|bei einer Niederlage die Top 4 erreichen/);
 assert.doesNotMatch(html,/bei einem Sieg (?:die Tabellenführung verlieren|aus den Top 4 fallen)/);
});
test('ranking and streak impacts use the approved wording',()=>{
 const d=fixture('analysis');
 d.impacts=[
  {kind:'leaderGained',playerId:'greta_p'},
  {kind:'leaderLost',playerId:'agnes_k'},
  {kind:'streakStarted',playerId:'greta_p',outcome:'win',length:3},
  {kind:'streakStarted',playerId:'agnes_k',outcome:'loss',length:3},
  {kind:'streakExtended',playerId:'christoph_l',outcome:'win',length:4},
  {kind:'streakExtended',playerId:'marco_m',outcome:'loss',length:4},
  {kind:'streakEnded',playerId:'greta_p',outcome:'win',length:5},
  {kind:'streakEnded',playerId:'agnes_k',outcome:'loss',length:5}
 ];
 const html=render(d);
 for(const text of [
  'Übernimmt die Tabellenführung.', 'Verliert die Tabellenführung',
  'Beginnt eine Siegesserie: 3 in Folge.', 'Eine Niederlagenserie beginnt: 3 in Folge.',
  'Verlängert die Siegesserie auf 4.', 'Niederlagenserie verlängert sich auf 4.',
  'Siegesserie nach 5 Partien beendet.', 'Beendet die Niederlagenserie nach 5 Partien.'
 ]) assert.ok(html.includes(text),text);
 const preview=fixture();
 preview.impacts=[
  {kind:'streakPossible',playerId:'greta_p',outcome:'win',length:2},
  {kind:'streakPossible',playerId:'agnes_k',outcome:'loss',length:2},
  {kind:'streakPossible',playerId:'christoph_l',outcome:'win',length:4},
  {kind:'streakPossible',playerId:'marco_m',outcome:'loss',length:4}
 ];
 const previewHtml=render(preview);
 for(const text of [
  'Kann eine Siegesserie von drei Partien erreichen.', 'Kann eine Niederlagenserie von drei Partien verhindern.',
  'Kann die Siegesserie von 4 Partien ausbauen.', 'Kann die Niederlagenserie von 4 Partien beenden.'
 ]) assert.ok(previewHtml.includes(text),text);
});
test('team-wide match outcomes appear once in the general match context',()=>{
 for(const [impact,text] of [
  [{kind:'favoriteConfirmed',team:1,probability:.85},'Team 1 bestätigt Favoritenrolle bei zuvor 85 % Gewinnchance.'],
  [{kind:'upset',team:2,probability:.39},'Team 2 sorgt für eine statistische Überraschung bei zuvor 39 % Gewinnchance.']
 ]) {
  const d=fixture('analysis');
  d.impacts.push(impact);
  const html=render(d);
  const context=html.match(/<section class="match-statistics-context"[\s\S]*?<\/section>/)?.[0]||'';
  const panel=html.match(/<section class="match-statistics-section match-statistics-impact-panel">[\s\S]*?<\/section>/)?.[0]||'';
  assert.equal(html.split(text).length-1,1);
  assert.ok(context.includes(text));
  assert.doesNotMatch(panel,/Favoritenrolle|statistische Überraschung/);
 }
});
test('favorite confirmation starts at 55 percent',()=>{
 for(const [probability,visible] of [[.54999,false],[.55,true]]) {
  const d=fixture('analysis');
  d.impacts.push({kind:'favoriteConfirmed',team:1,probability});
  const html=render(d);
  assert.equal(html.includes('bestätigt Favoritenrolle'),visible);
 }
});
test('statistical upset starts at 45 percent',()=>{
 for(const [probability,visible] of [[.45001,false],[.45,true]]) {
  const d=fixture('analysis');
  d.impacts.push({kind:'upset',team:2,probability});
  const html=render(d);
  assert.equal(html.includes('statistische Überraschung'),visible);
 }
});
test('interactive player names use the accent color in the statistics dialog',()=>{
 assert.match(statisticsStyleSource,/#detail-view-dialog\[data-mode="statistics"\] \.player-profile-link:is\(:hover, :focus-visible, :active\) \{ color: var\(--accent\) !important; border-color: var\(--accent\); \}/);
});
test('the selected viewer is blue and bold throughout the statistics dialog',()=>{
 const html=render(fixture(),'agnes_k');
 assert.equal((html.match(/viewer-player/g)||[]).length,6);
 assert.match(html,/match-detail-player-name viewer-player">Agnes K\./);
 assert.match(html,/pname player-profile-link viewer-player" data-player-profile-id="agnes_k"/);
 assert.match(html,/match-statistics-impact-player-name player-profile-link viewer-player" data-player-profile-id="agnes_k"/);
 assert.match(html,/match-statistics-relationship-name player-profile-link viewer-player" data-player-profile-id="agnes_k"/);
 assert.match(html,/match-statistics-player-label viewer-player">Agnes K\./);
 assert.doesNotMatch(render(fixture()),/viewer-player/);
 assert.match(appSource,/window\.PadelLigaGetSelectedViewerId = \(\) => isParticipantView\(\) \? selectedViewerId : null;/);
 assert.match(source,/render\(activeData, window\.PadelLigaGetSelectedViewerId\?\.\(\), \{/);
 assert.match(statisticsStyleSource,/#detail-view-dialog\[data-mode="statistics"\] \.viewer-player \{ color: var\(--accent2\); font-weight: 700; \}/);
 assert.match(statisticsStyleSource,/\.match-statistics-svg \.match-statistics-player-label\.viewer-player \{ fill: var\(--accent2\); font-weight: 700; \}/);
 assert.match(statisticsStyleSource,/\.match-statistics-context \{[\s\S]*?text-align: center;/);
});
test('match header and full ranking follow ticker and ranking conventions',()=>{
 const d=fixture();d.players[0].profileEmoji='👩';
 const html=render(d);
 const analysisHtml=render({...d,availability:'analysis'});
 assert.equal(headerMeta(d),'Sommer 2026 · 20.10.2026');
 assert.equal(playedOrderLabel({...d,availability:'analysis',leaguePlayedOrdinal:18}),'Gespielt als 18. Partie');
 assert.equal(playedOrderLabel(d),'');
 assert.doesNotMatch(html,/Partievorschau|Partieanalyse/);
 assert.match(html,/<div class="match-detail-meta"><span class="match-detail-status">Offen<\/span><\/div>/);
 assert.match(analysisHtml,/<div class="match-detail-meta"><span class="match-detail-status is-finished">Beendet<\/span><\/div>/);
 assert.match(html,/Gewinnchance[\s\S]*match-probability match-detail-probability match-statistics-probability[\s\S]*match-probability-value">61<\/span>[\s\S]*match-probability-separator"[^>]*>:<\/span>[\s\S]*match-probability-value">39<\/span>[\s\S]*match-detail-score-note">Prozent<\/span>/);
 assert.match(analysisHtml,/61% : 39%/);
 assert.doesNotMatch(html,/20\.10\.2026/);assert.match(html,/match-detail-player-emoji" hidden>👩/);
 assert.match(html,/class="rt match-statistics-ranking"/);
 assert.equal((html.match(/match-statistics-ranking-gap/g)||[]).length,0);
 assert.equal((html.match(/match-statistics-ranking-player/g)||[]).length,4);
 assert.equal((html.match(/match-statistics-ranking-other/g)||[]).length,4);
 assert.equal((html.match(/match-statistics-ranking-qualified/g)||[]).length,8);
 assert.match(html,/match-statistics-ranking-player r1 match-statistics-ranking-qualified[\s\S]*?match-statistics-rank-position">1<\/span>/);
 assert.match(html,/match-statistics-ranking-player r3 match-statistics-ranking-qualified[\s\S]*?match-statistics-rank-position">3<\/span>/);
 assert.doesNotMatch(render({...d,qualificationPlaces:0}),/match-statistics-ranking-qualified/);
 assert.match(statisticsStyleSource,/table\.rt\.match-statistics-ranking \.col-diff \{ padding-right: 1rem; \}/);
 assert.match(statisticsStyleSource,/\.match-statistics-ranking tbody tr\.match-statistics-ranking-player td:last-child \{\s*box-shadow: inset -3px 0 0 var\(--statistics-team-color\);/);
 assert.match(statisticsStyleSource,/#detail-view-dialog\[data-mode="statistics"\] \.match-detail-team \.match-detail-player-photo \{\s*border: 2px solid var\(--statistics-team-color\);/);
 const withoutBoundary={...d};delete withoutBoundary.qualificationPlaces;
 global.window={PADEL_SEASONS:[{id:'2026-sommer',qualificationPlaces:4},{id:'2026-winter',databaseId:'winter-2026',qualificationPlaces:8}]};
 try {
  assert.equal((render(withoutBoundary).match(/match-statistics-ranking-qualified/g)||[]).length,4);
  assert.equal((render({...withoutBoundary,seasonId:'winter-2026'}).match(/match-statistics-ranking-qualified/g)||[]).length,8);
 } finally { delete global.window; }
 assert.match(html,/match-statistics-ranking-layout/);
 assert.match(html,/match-statistics-section match-statistics-ranking-panel/);
 assert.match(html,/match-statistics-section match-statistics-impact-panel/);
 assert.equal((html.match(/<section class="match-statistics-section[^"]*"><h3>/g)||[]).length,4);
 assert.doesNotMatch(html,/spieltag-label/);
 assert.doesNotMatch(html,/Siege in Folge|Niederlagen in Folge/);
 assert.match(statisticsStyleSource,/\.match-statistics-ranking tbody tr\.match-statistics-ranking-other td \{[\s\S]*?font-size: var\(--text-xs\);/);
 assert.match(html,/<th class="col-rank"><span aria-hidden="true">#<\/span><span class="sr-only">Platz<\/span><\/th>/);
 assert.match(html,/<th class="col-wins">Siege<\/th>/);
 assert.match(html,/<td class="col-wins">3<\/td>/);
 assert.match(statisticsStyleSource,/\.match-statistics-ranking :is\(th, td\):is\(\.col-games, \.col-wins, \.col-points, \.col-diff\) \{[\s\S]*?text-align: center;[\s\S]*?font-variant-numeric: tabular-nums;/);
 assert.match(statisticsStyleSource,/@media \(max-width: 768px\) \{[\s\S]*?\.match-statistics-ranking \.col-wins \{ display: none; \}/);
 assert.match(statisticsStyleSource,/table\.rt\.match-statistics-ranking \{ width: 100%; min-width: 0;[\s\S]*?table-layout: fixed;/);
 assert.match(statisticsStyleSource,/\.match-statistics-ranking \.player-profile-link \{[\s\S]*?text-overflow: ellipsis;/);
});
test('completed league order is rendered below title and season metadata in text-xs',()=>{
 assert.match(indexSource,/<h2 id="detail-view-title">FINAL FOUR<\/h2>\s*<div class="sh-meta" id="detail-view-context"><\/div>\s*<div class="detail-view-played-order" id="match-statistics-played-order" hidden><\/div>/);
 assert.match(styleSource,/\.detail-view-played-order \{[\s\S]*?font-size: var\(--text-xs\);/);
 assert.match(source,/function restore\(\) \{[\s\S]*?setPlayedOrder\(\);/);
});
test('completed rankings align historical movement in a dedicated column',()=>{
 const preview=render(fixture());
 assert.doesNotMatch(preview,/match-statistics-rank-change/);
 assert.doesNotMatch(preview,/col-rank-change/);
 const analysis=render(fixture('analysis'));
 assert.match(analysis,/<th class="col-rank-change"><span class="sr-only">Platzänderung<\/span><\/th>/);
 assert.match(analysis,/match-statistics-rank-position">1<\/span><\/td><td class="col-rank-change"><span class="match-statistics-rank-change up" aria-label="Tabellenplatz verbessert">↑<\/span>/);
 assert.match(analysis,/match-statistics-rank-position">2<\/span><\/td><td class="col-rank-change"><span class="match-statistics-rank-change down" aria-label="Tabellenplatz verschlechtert">↓<\/span>/);
 assert.match(analysis,/match-statistics-rank-position">3<\/span><\/td><td class="col-rank-change"><span class="match-statistics-rank-change same" aria-label="Tabellenplatz unverändert">–<\/span>/);
 assert.match(analysis,/class="rt match-statistics-ranking has-rank-change"/);
 assert.match(statisticsStyleSource,/table\.rt\.match-statistics-ranking \.col-rank \{[\s\S]*?text-align: center;[\s\S]*?font-variant-numeric: tabular-nums;/);
 assert.match(statisticsStyleSource,/\.match-statistics-ranking\.has-rank-change \.col-rank \{[\s\S]*?width: 40px;[\s\S]*?padding-left: 8px;[\s\S]*?padding-right: 2px;/);
 assert.match(statisticsStyleSource,/\.match-statistics-ranking \.col-rank-change \{[\s\S]*?width: 24px;[\s\S]*?padding-left: 0;[\s\S]*?padding-right: 8px;[\s\S]*?text-align: center;/);
 assert.match(statisticsStyleSource,/\.match-statistics-rank-change\.up \{ color: var\(--positiv\); \}/);
 assert.match(statisticsStyleSource,/\.match-statistics-rank-change\.down \{ color: var\(--negativ\); \}/);
});
test('alternating between match and profile reuses one browser history entry',()=>{
 assert.match(source,/prepareProfileOpen[\s\S]*?history\.replaceState\(\{ \.\.\.window\.history\.state, statisticsProfile: playerId/);
 assert.doesNotMatch(source,/prepareProfileOpen[\s\S]*?history\.pushState\(\{ \.\.\.window\.history\.state, statisticsProfile: playerId/);
 assert.match(source,/profileReplacesDetail = sharedDetailFlow;[\s\S]*?dialog\(\)\?\.open\) dialog\(\)\.close\(\)/);
 assert.match(source,/function syncProfilePresentation[\s\S]*?type: 'padel:detail-presentation'[\s\S]*?view: 'profile'/);
 assert.match(source,/if \(profileReplacesDetail\) \{\s*close\(\);\s*return true;/);
 assert.match(source,/if \(replacedDetail\) \{[\s\S]*?PadelLigaClosePlayerProfile\?\.\(\{ fromHistory: true, restoreFocus: false \}\)/);
 assert.match(source,/profile\?\.querySelector\('\.player-profile-shell'\)\?\.scrollTop \|\| 0/);
 assert.match(source,/const profileShell = document\.querySelector\('#player-profile-dialog \.player-profile-shell'\)/);
 assert.match(source,/const replacing = isDetailEmbed \|\| Boolean\(getRequestedMatchId\(\)\) \|\| Boolean\(currentRoute\)/);
 assert.match(source,/PadelSeasonRouting\?\.getMatchUrl\(season\?\.id, seasonMatch \|\| matchId/);
 assert.match(source,/detail-view-title'\)\.textContent = retainedActiveData\?\.label \|\| 'PARTIE'/);
 assert.match(source,/detail-view-context'\)\.textContent = retainedActiveData[\s\S]*?headerMeta\(retainedActiveData\)/);
 assert.match(source,/setPlayedOrder\(retainedActiveData\)/);
});
test('embedded detail view closes without leaving the tipp page through shared history',()=>{
 assert.match(source,/function close\(\) \{\s*if \(!active\) return;[\s\S]*?if \(!isDetailEmbed && window\.history\.state\?\.matchStatistics\) window\.history\.back\(\);/);
 assert.match(source,/if \(direct && !isDetailEmbed\) \{[\s\S]*?history\.pushState/);
});
test('homepage match cards link only their center values without a details icon',()=>{
 const renderer=appSource.match(/function renderHomeMatchCard\(match, options = \{\}\) \{[\s\S]*?(?=\nfunction getCurrentArticle)/)?.[0]||'';
 assert.match(renderer,/window\.PadelMatchStatistics\?\.entry\(match, PADEL_DATA\)/);
 assert.match(renderer,/<button type="button" class="mini-match-status\$\{statusClass\} mini-match-status-action" \$\{statistics\.attributes\}>\$\{centerContent\}<\/button>/);
 assert.doesNotMatch(renderer,/\.icon|mc-score-details-icon/);
});
test('match score hover colors every value and keeps the icon in the lower line',()=>{
 assert.match(styleSource,/button\.mc-score:hover :is\(\.mc-score-main, \.mc-prob, \.mc-result-prob, \.mc-score-detail, \.mc-score-details-icon\)/);
 assert.match(styleSource,/:is\(#spielplan, #final-four-spielplan\) \.mc\.played button\.mc-score \.mc-score-detail \{\s*pointer-events: auto;/);
 assert.match(styleSource,/\.mc-score-result-with-details \{[\s\S]*?display: inline-flex/);
 assert.match(styleSource,/\.mc-score-details-icon \{[\s\S]*?position: static;[\s\S]*?margin-left: 5px;[\s\S]*?transform: none/);
});
test('graph remains finite and clipped for identical, tight and extreme Elo values',()=>{
 for(const values of [[1000,1000,1000,1000],[1000,1001,1002,1003],[1,500,1800,9000]]){
  const d=fixture();d.players.forEach((p,i)=>{p.elo={before:values[i],after:values[i],delta:0,winMin:values[i],winMax:values[i],lossMin:values[i],lossMax:values[i]};});
  const g=graphGeometry(d.players,false);assert.ok(g.max>g.min);for(const p of d.players)assert.ok(Number.isFinite(g.y(p.elo.before)));
  assert.doesNotMatch(render(d),/NaN|Infinity/);assert.equal((render(d).match(/<clipPath/g)||[]).length,4);
 }
 const html=render(fixture());
 assert.match(html,/viewBox="0 0 1000 590" width="1000" height="590"/);
 assert.match(html,/class="match-statistics-value match-statistics-start-value">1\.050<\/text>/);
 assert.match(html,/<use href="#statistics-peak-star-icon"[^>]+class="match-statistics-peak-star possible"\/><text x="[^"]+" y="[^"]+" text-anchor="end" class="match-statistics-value match-statistics-win-value">↗ 1\.135<\/text><text x="[^"]+" y="[^"]+" text-anchor="end" class="match-statistics-value match-statistics-win-value">↘ 1\.090<\/text>/);
 assert.match(html,/<text x="[^"]+" y="[^"]+" text-anchor="end" class="match-statistics-value match-statistics-loss-value">↗ 1\.010<\/text><text x="[^"]+" y="[^"]+" text-anchor="end" class="match-statistics-value match-statistics-loss-value">↘ 965<\/text>/);
 assert.doesNotMatch(html,/match-statistics-(?:win|loss)-value[\s\S]*?\sbis\s[\s\S]*?<\/text>/);
 assert.doesNotMatch(html,/match-statistics-elo-values|Ausgangswert:|Bei Sieg:|Bei Niederlage:/);
 const geometry=graphGeometry(fixture().players,false);assert.equal(geometry.y(geometry.max),28);
 const layoutGeometry={plotTop:28,nameY:556,y:value=>value};
 assert.equal(analysisResultY(layoutGeometry,100,200),170);
 assert.equal(analysisResultY(layoutGeometry,100,30),54);
 assert.equal(analysisResultY(layoutGeometry,100,510),480);
 assert.ok([200,30,510].every((endpoint,index)=>Math.abs(endpoint-[170,54,480][index])>=24));
 assert.match(skeleton(),/role="status"/);assert.match(skeleton(),/aria-hidden="true"/);assert.doesNotMatch(skeleton(),/tabindex|<button/);
});
test('preview Elo projections use uniform confidence bands with a dashed forecast path',()=>{
 const html=render(fixture());
 assert.equal((html.match(/match-statistics-projection-band win/g)||[]).length,4);
 assert.equal((html.match(/match-statistics-projection-band loss/g)||[]).length,4);
 assert.doesNotMatch(html,/match-statistics-projection-band-strip|fill-opacity=/);
 assert.ok(html.indexOf('match-statistics-projection-band loss')<html.indexOf('match-statistics-projection-band win'));
 assert.doesNotMatch(html,/<linearGradient|<stop/);
 assert.doesNotMatch(html,/match-statistics-projection-dot/);
 assert.equal((html.match(/match-statistics-forecast-line win/g)||[]).length,2);
 assert.equal((html.match(/match-statistics-forecast-line loss/g)||[]).length,2);
 assert.equal((html.match(/match-statistics-forecast-dot/g)||[]).length,4);
 const bandPaths=[...html.matchAll(/<path d="([^"]+)" class="match-statistics-projection-band (?:win|loss)"\/>/g)].map(match=>match[1]);
 assert.equal(bandPaths.length,8);assert.ok(bandPaths.every(path=>path.includes(' C')&&path.endsWith(' Z')));
 assert.match(statisticsStyleSource,/\.match-statistics-projection-band \{ stroke: none; fill-opacity: \.5; \}/);
 const forecastPaths=[...html.matchAll(/<path d="([^"]+)" class="match-statistics-forecast-line (?:win|loss)"\/>/g)].map(match=>match[1]);
 assert.equal(forecastPaths.length,4);assert.ok(forecastPaths.every(path=>path.includes(' C')));
 const analysisPaths=[...render(fixture('analysis')).matchAll(/<path d="([^"]+)" class="match-statistics-line"\/>/g)].map(match=>match[1]);
 assert.equal(analysisPaths.length,4);assert.ok(analysisPaths.every(path=>path.includes(' C')));
});
test('the auto-tip result panel stays absent while the Elo forecast path remains',()=>{
 for(const data of [fixture(),fixture('analysis'),fixture('basic'),{...fixture(),probability:null},{...fixture(),countsForElo:false}]){
  assert.doesNotMatch(render(data),/Auto-Tipp|match-statistics-autotip/);
 }
 assert.match(render(fixture()),/match-statistics-forecast-line/);
 assert.doesNotMatch(source,/renderAutoTipForecast|match-statistics-autotip/);
 assert.doesNotMatch(statisticsStyleSource,/match-statistics-autotip/);
 assert.match(appSource,/window\.PadelEloForecast\.getAutoTipForecast/);
});
test('played Elo graphs keep solid 20 percent ranges behind the actual line',()=>{
 const html=render(fixture('analysis'));
 assert.equal((html.match(/match-statistics-projection-range win/g)||[]).length,4);
 assert.equal((html.match(/match-statistics-projection-range loss/g)||[]).length,4);
 assert.doesNotMatch(html,/match-statistics-projection-band-strip/);
 assert.doesNotMatch(html,/<linearGradient|<stop/);
 assert.match(statisticsStyleSource,/\.match-statistics-projection-range \{ stroke: none; fill-opacity: \.2; \}/);
 const firstRange=html.indexOf('match-statistics-projection-range');
 const firstLine=html.indexOf('match-statistics-line');
 assert.ok(firstRange>=0&&firstRange<firstLine,'the actual Elo line must be painted above the possible ranges');
});
test('Elo graph keeps four mobile player choices and groups only the panel by team',()=>{
 const html=render(fixture());
 assert.match(html,/class="site-nav" data-statistics-graph-picker="player" role="group" aria-label="Spieler für Elo-Entwicklung auswählen"/);
 assert.equal((html.match(/data-statistics-graph-select=/g)||[]).length,4);
 assert.match(html,/<button type="button" class="active" data-statistics-graph-select="greta_p" aria-pressed="true">Greta P\.<\/button>/);
 assert.match(html,/class="site-nav" data-statistics-graph-picker="team" role="group" aria-label="Team für Elo-Entwicklung auswählen"/);
 assert.equal((html.match(/data-statistics-graph-team-select=/g)||[]).length,2);
 assert.match(html,/<button type="button" class="active" data-statistics-graph-team-select="1" aria-pressed="true">Team 1<\/button>/);
 assert.match(html,/<button type="button" data-statistics-graph-team-select="2" aria-pressed="false">Team 2<\/button>/);
 assert.doesNotMatch(html,/match-statistics-graph-team-(?:label|players|player)/);
 assert.equal((html.match(/data-statistics-graph-player=/g)||[]).length,4);
 assert.equal((html.match(/data-statistics-graph-team="1"/g)||[]).length,2);
 assert.equal((html.match(/data-statistics-graph-team="2"/g)||[]).length,2);
 assert.equal((html.match(/match-statistics-player-graph[^\"]*is-player-selected/g)||[]).length,1);
 assert.equal((html.match(/match-statistics-player-graph[^\"]*is-team-selected/g)||[]).length,2);
 assert.ok(html.lastIndexOf('data-statistics-graph-team="1"')>html.lastIndexOf('data-statistics-graph-team="2"'));
 assert.match(html,/data-statistics-graph-player="marco_m"[^>]*--statistics-mobile-offset:-705px;--statistics-panel-offset:-235px/);
 assert.match(source,/graphPlayerButton = event\.target\.closest\('\[data-statistics-graph-select\]'\)[\s\S]*?classList\.toggle\('is-player-selected', player === selected\)[\s\S]*?selected\.parentElement\.append\(selected\)/);
 assert.match(source,/graphTeamButton = event\.target\.closest\('\[data-statistics-graph-team-select\]'\)[\s\S]*?selectedPlayers = players\.filter\([\s\S]*?classList\.toggle\('is-team-selected', selectedPlayers\.includes\(player\)\)[\s\S]*?selectedPlayers\.forEach\(player => player\.parentElement\.append\(player\)\)/);
 assert.match(statisticsStyleSource,/\[data-statistics-graph-picker\] \{[^}]*margin: 1rem 0 0;/);
 assert.doesNotMatch(statisticsStyleSource,/\.match-statistics-graph-team-(?:button|label|players|player)/);
 assert.match(statisticsStyleSource,/@media \(max-width: 768px\) \{[\s\S]*?#detail-view-dialog:not\(\[data-presentation="panel"\]\) \[data-statistics-graph-picker="player"\] \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
 assert.match(statisticsStyleSource,/#detail-view-dialog:not\(\[data-presentation="panel"\]\) \.match-statistics-player-graph\.is-player-selected \{ opacity: 1; \}/);
 assert.match(statisticsStyleSource,/#detail-view-dialog\[data-presentation="panel"\] \[data-statistics-graph-picker="team"\] \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
 assert.match(statisticsStyleSource,/#detail-view-dialog\[data-presentation="panel"\] \.match-statistics-player-graph\.is-team-selected \{ opacity: 1; \}/);
 assert.match(statisticsStyleSource,/\.match-statistics-graph \{[^}]*container-type: inline-size;/);
 assert.match(statisticsStyleSource,/#detail-view-dialog\[data-presentation="panel"\] \.match-statistics-player-graph\.match-statistics-team-player-2 \{\s*transform: translateX\(calc\(var\(--statistics-panel-offset\) \+ min\(0px, calc\(50cqw - 500px\)\)\)\);/);
});
