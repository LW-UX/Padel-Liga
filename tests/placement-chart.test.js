const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname,'../js/app.js'),'utf8');
const fn = name => {
 const match=source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
 assert.ok(match, name);return match[0];
};
function contextFor(players) {
 const games=[{spieltag:1,sieger:1,team1:{spieler:['Ludwig W.','Florian Z.']},team2:{spieler:['Jonas L.','Chris M.']}},
  {spieltag:2,sieger:1,team1:{spieler:['Ludwig W.','Jonas L.']},team2:{spieler:['Florian Z.','Chris M.']}}];
 const initial={ 'Ludwig W.':[3,8,12], 'Florian Z.':[3,8,12], 'Jonas L.':[0,-8,4], 'Chris M.':[0,-8,4] };
 const after={ 'Ludwig W.':[6,15,24], 'Florian Z.':[3,1,17], 'Jonas L.':[3,-1,16], 'Chris M.':[0,-15,9] };
 const context=vm.createContext({
  PADEL_DATA:{players:players.map((name,i)=>({id:String(i),name})),matches:games},
  countsForRanking:()=>true,
  getPlayerStats:(player,matches)=>{
   const [punkte,spielDiff,gewonneneSpiele]=(matches.length===1?initial:after)[player.name];
   return {punkte,spielDiff,gewonneneSpiele};
  }
 });
 vm.runInContext(['compareRankingByPoints','assignRankingPlaces','getRankedPlayers','getPlacementSeries','getPlacementDisplayRank','getPlacementTooltipRank','getPlacementLabelPositions'].map(fn).join('\n'),context);
 return context;
}
test('placement histories keep shared sporting places and independent rendering offsets',()=>{
 const names=['Ludwig W.','Florian Z.','Jonas L.','Chris M.'];
 for(const players of [names,[...names].reverse()]){
  const context=contextFor(players);const series=context.getPlacementSeries();
  assert.deepEqual([...series.placementsByPlayer.get('Ludwig W.')],[1,1]);
  assert.deepEqual([...series.placementsByPlayer.get('Florian Z.')],[1,2]);
  assert.equal(series.placementsByPlayer.get('Jonas L.')[0],3);
  assert.equal(series.placementsByPlayer.get('Chris M.')[0],3);
  const one=series.displayPlacementsByPlayer.get('Ludwig W.')[0];
  const other=series.displayPlacementsByPlayer.get('Florian Z.')[0];
  assert.notEqual(one,other);assert.ok(Math.abs((one+other)/2-1)<1e-10);
  assert.deepEqual([...series.tiedNamesByPlayer.get('Ludwig W.')[0]],['Florian Z.']);
  assert.equal(series.tiedNamesByPlayer.get('Ludwig W.')[1].length,0);
  assert.deepEqual([...series.playedByPlayer.get('Ludwig W.')],[true,true]);
 }
});
test('large ties remain inside their actual rank interval and have distinct draw positions',()=>{
 const context=contextFor([]);
 for(const size of [1,2,4,20,100]){
  const positions=Array.from({length:size},(_,index)=>context.getPlacementDisplayRank(3,index,size));
  assert.equal(new Set(positions).size,size);
  assert.ok(positions.every(value=>value>=2.82-1e-10&&value<=3.18+1e-10));
  assert.ok(Math.abs(positions.reduce((sum,value)=>sum+value,0)/size-3)<1e-10);
 }
});
test('tooltips use integer ranks and name the other tied players',()=>{
 const context=contextFor([]);
 const dataset={actualRanksByPoint:[1,2],tiedNamesByPoint:[['Florian Z.'],[]]};
 assert.equal(context.getPlacementTooltipRank(dataset,0),'Geteilter 1. Platz mit Florian Z.');
 assert.equal(context.getPlacementTooltipRank(dataset,1),'Platz: 2');
});
test('end labels remain separated and inside the chart for clustered ties',()=>{
 const context=contextFor([]);
 for(const desiredY of [12,250,480]){
  const entries=Array.from({length:20},(_,index)=>({dataset:{label:`Spieler ${index}`},point:{y:desiredY}}));
  const labels=context.getPlacementLabelPositions(entries,7,493);
  assert.equal(labels.length,20);
  labels.forEach((label,index)=>{
   assert.ok(label.labelY>=7&&label.labelY<=493);
   if(index)assert.ok(label.labelY-labels[index-1].labelY>=14-1e-10);
   assert.equal(label.point.y,desiredY,'point geometry must remain unchanged');
  });
 }
 assert.equal(context.getPlacementLabelPositions([],7,493).length,0);
});
test('chart datasets separate display values from real ranks and tied-player metadata',()=>{
 const context=contextFor(['Ludwig W.','Florian Z.','Jonas L.','Chris M.']);
 Object.assign(context,{
  placementChart:null,hoveredPlacementChartPlayerName:null,
  getChartBaseColor:()=> '#f00',getPlacementChartColor:color=>color,
  getPlacementChartLineWidth:()=>2,getPlacementChartPointRadius:()=>3,getPlacementChartOrder:()=>0,
  getThemeValue:()=>'',externalPlacementTooltip:()=>{},placementLabelPlugin:{},
  document:{getElementById:()=>({getContext:()=>({})})}
 });
 context.Chart=function(ctx,config){context.captured=config;};
 vm.runInContext(fn('initPlacementChart'),context);context.initPlacementChart();
 const dataset=context.captured.data.datasets[0];
 assert.deepEqual([...dataset.actualRanksByPoint],[1,1]);
 assert.notEqual(dataset.data[0],1);assert.equal(dataset.data[1],1);
 assert.deepEqual([...dataset.tiedNamesByPoint[0]],['Florian Z.']);
});

test('crowded end labels draw connectors and use their displaced positions for hover',()=>{
 const hovered=[];const texts=[];let strokes=0;
 const context=contextFor([]);
 Object.assign(context,{getThemeValue:()=> '#777',getPlacementLabelWeight:()=>400,getPlacementLabelColor:()=> '#aaa',setHoveredPlacementChartPlayer:name=>hovered.push(name)});
 vm.runInContext(source.slice(source.indexOf('const placementLabelPlugin ='),source.indexOf('\nconst eloFinalStraightSegmentPlugin'))+'\nthis.plugin=placementLabelPlugin;',context);
 const chart={
  chartArea:{top:0,bottom:500,right:400},
  data:{datasets:Array.from({length:20},(_,index)=>({label:`Player ${index}`,baseColor:'#abc'}))},
  getDatasetMeta:()=>({data:[{x:400,y:30}]}),
  ctx:{save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){strokes++;},fillText(text,x,y){texts.push({text,x,y});},measureText:()=>({width:50})}
 };
 context.plugin.afterDatasetsDraw(chart);
 assert.equal(texts.length,20);assert.ok(strokes>0);
 const box=chart.$placementLabelBoxes[8];
 context.plugin.afterEvent(chart,{event:{type:'mousemove',x:box.left+1,y:(box.top+box.bottom)/2}});
 assert.equal(hovered.at(-1),box.playerName);
 context.plugin.afterEvent(chart,{event:{type:'mouseout'}});
 assert.equal(hovered.at(-1),null);
});
