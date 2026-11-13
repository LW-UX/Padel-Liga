const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.resolve(__dirname,'../js/app.js'),'utf8');
const source = app.slice(app.indexOf('const PLAYER_PROFILE_HERO_CONDENSE_SCROLL'), app.indexOf('function updatePlayerProfileRankingHighlights()'));
function setup({scrollHeight=680,clientHeight=600,offsetHeight=648}={}) {
 const classes=new Set();
 const hero={offsetHeight:200,classList:{contains:name=>classes.has(name),add:name=>classes.add(name),remove:name=>classes.delete(name)}};
 const content={offsetHeight,style:{minHeight:'',removeProperty(name){if(name==='min-height')this.minHeight='';}}};
 const shell={scrollTop:0,scrollHeight,clientHeight};
 const document={querySelector:()=>shell,getElementById:id=>id==='player-profile-hero'?hero:content};
 const context=vm.createContext({document});vm.runInContext(source,context);
 return {shell,hero,content,update:()=>context.updatePlayerProfileHeroCondensed()};
}
test('short profiles condense without requiring a full header height of spare scroll',()=>{
 const {shell,hero,content,update}=setup();
 shell.scrollTop=49;update();
 assert.equal(hero.classList.contains('is-condensed'),true);
 assert.equal(content.style.minHeight,'648px');
});
test('the header keeps its scroll reserve until the user returns to the top',()=>{
 const {shell,hero,content,update}=setup();
 shell.scrollTop=60;update();
 content.offsetHeight=510;shell.scrollTop=20;update();
 assert.equal(hero.classList.contains('is-condensed'),true);
 assert.equal(content.style.minHeight,'648px');
 shell.scrollTop=8;update();
 assert.equal(hero.classList.contains('is-condensed'),false);
 assert.equal(content.style.minHeight,'');
 content.offsetHeight=700;shell.scrollTop=50;update();
 assert.equal(content.style.minHeight,'700px');
});
test('profiles without overflow start expanded and do not acquire an artificial scroll area',()=>{
 const {hero,content,update}=setup({scrollHeight:600,clientHeight:600});
 update();assert.equal(hero.classList.contains('is-condensed'),false);
 assert.equal(content.style.minHeight,'');
});
