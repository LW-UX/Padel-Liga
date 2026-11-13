const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const fixture = require('./fixtures/match-statistics.cjs');
test('league history tabs, admin entry and saving work on desktop and mobile', {skip: !process.env.PADEL_PLAYWRIGHT_MODULE}, async () => {
 const {chromium} = await import(pathToFileURL(process.env.PADEL_PLAYWRIGHT_MODULE).href);
 const root = path.resolve(__dirname,'..');
 const data=fixture('analysis');data.matchId='m';data.result='6:0, 0:6 – 10:0';data.historyVersion=0;
 const scripts=['elo-forecast','table-core','preview-window','player-images','match-history','panel-layout','match-statistics'];
 let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 html=html.replace('</head>',`<script>
  window.testData=${JSON.stringify(data)};window.savedHistory=null;
  window.PadelKonto={getSession:()=>({user:{email_confirmed_at:'yes'}}),getProfile:()=>({app_role:'admin'}),getClient:()=>({rpc:async(name,args)=>{
   if(name==='get_public_match_detail')return {data:window.testData};
   if(name==='admin_save_match_history'){window.savedHistory=args;return {data:{sections:args.p_sections,version:1}};}
   return {data:null};
  }})};
 </script>${scripts.map(name=>`<script defer src="/js/${name}.js"></script>`).join('')}</head>`);
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const file=path.resolve(root,'.'+decodeURIComponent(pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  const ext=path.extname(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[ext]||'application/octet-stream');res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try {
  browser=await chromium.launch({headless:true,executablePath:process.env.PADEL_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  for(const width of [1280,390]){
   const page=await browser.newPage({viewport:{width,height:900}});const errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.goto(`http://127.0.0.1:${server.address().port}/`);
   await page.evaluate(()=>window.PadelMatchStatistics.open('m',{updateUrl:false}));
   assert.equal(await page.locator('[data-statistics-tab]').count(),0);
   await page.locator('[data-history-edit]').click();
   await page.locator('[data-history-reason]').fill('Spielverlauf nachgetragen');
   await page.locator('[data-history-add="1"][data-history-set="0"]').click();
   await page.locator('[data-history-server="0"][data-history-set="0"]').selectOption('greta_p');
   assert.equal(await page.locator('[data-statistics-tab]').count(),0);
   assert.equal(await page.locator('[data-history-reason]').inputValue(),'Spielverlauf nachgetragen');
   await page.locator('[data-history-save]').click();
   await page.waitForFunction(()=>document.querySelector('[data-history-message]')?.textContent.includes('Endstand'));
   for(let i=1;i<6;i++)await page.locator('[data-history-add="1"][data-history-set="0"]').click();
   for(let i=0;i<6;i++)await page.locator('[data-history-add="2"][data-history-set="1"]').click();
   for(let i=0;i<10;i++)await page.locator('[data-history-add="1"][data-history-set="2"]').click();
   assert.equal(await page.locator('[data-history-reason]').inputValue(),'Spielverlauf nachgetragen');
   await page.locator('[data-history-save]').click();
   await page.waitForSelector('[data-history-edit]');
   const saved=await page.evaluate(()=>window.savedHistory);
   assert.equal(saved.p_expected_version,0);assert.equal(saved.p_sections[2].winners.length,10);
   assert.equal(saved.p_sections[0].servers[0],'greta_p');
   assert.equal(await page.locator('.match-history-set').count(),3);
   assert.equal(await page.locator('.match-history-set').last().locator('h3').textContent(),'Match-Tiebreak · 10:0');
   await page.locator('.match-statistics-tabs').scrollIntoViewIfNeeded();
   const overflow=await page.locator('#detail-view-dialog').evaluate(el=>el.scrollWidth>el.clientWidth+1);
   assert.equal(overflow,false);
   if(process.env.PADEL_HISTORY_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.PADEL_HISTORY_SCREENSHOT_DIR,`match-history-${width}.png`)});
   assert.deepEqual(errors,[]);
   await page.close();
  }
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
