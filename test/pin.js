// 見積・発注の明細の表：列の固定（ピン）と、広くした備考（./reset.sh のあとに node pin.js）
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect();
  for(let i=0;i<6;i++)await c.query("insert into lines(id,case_id,no,name,spec,qty,unit,sell,price,kind) values ($1,'C1302',$2,$3,'洋室',1,'式',10000,7000,'内装')",['LP'+i,i+1,'クロス貼替 '+i]);
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1280,height:800},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  const open=async()=>{ await p.evaluate(()=>{ tab='order'; oFilter='すべて'; oCase='C1302'; render(); }); await p.waitForTimeout(500); };
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500); await open();
  const memoW=await p.$eval('.lnw thead tr:last-child th:nth-last-child(2)',x=>x.textContent.includes('備考')?x.offsetWidth:0);
  ok('備考の列が広くなっている', memoW>=240, memoW);
  ok('見出しにピンが3つ（場所・名称・工程区分）。最初は固定なし', (await p.$$('.lnw [data-opin]')).length===3&&(await p.$$('.lnw .pinc')).length===0);
  await p.click('.lnw [data-opin="4"]'); await p.waitForTimeout(400);
  const st=()=>p.evaluate(()=>{ const w=document.querySelector('.lnw'); w.scrollLeft=400; const tr=document.querySelector('.lnw tbody tr[data-l]'); const r=w.getBoundingClientRect();
    return {pin:[...tr.children].map(td=>td.classList.contains('pinc')).join(','), nameX:Math.round(tr.children[3].getBoundingClientRect().left-r.left), kindX:Math.round(tr.children[4].getBoundingClientRect().left-r.left),
      headPin:document.querySelectorAll('.lnw thead .pinc').length, on:!!document.querySelector('.lnw [data-opin="4"].on'), scrolled:w.scrollLeft}; });
  let s=await st();
  ok('名称のピンを押すと、名称までの4列が左に固定され、横に動かしても見えたまま（工程区分は名称の下にもぐる）', s.pin.startsWith('true,true,true,true,false')&&s.scrolled>100&&s.nameX>=0&&s.nameX<260&&s.kindX<s.nameX+200&&s.headPin===4&&s.on, s);
  await p.screenshot({path:__dirname+'/pin1.png'});
  await p.reload(); await p.waitForTimeout(1500); await open(); s=await st();
  ok('開き直しても固定のまま（次に押すまで変わらない）', s.pin.startsWith('true,true,true,true,false')&&s.on, s);
  await p.click('[data-omode="見積"]'); await p.waitForTimeout(400);
  ok('表の形（見積）を変えても固定のまま', (await p.$$('.lnw tbody tr[data-l] td.pinc')).length>0);
  await p.click('.lnw [data-opin="4"]'); await p.waitForTimeout(400);
  ok('もう一度押すと外れる', (await p.$$('.lnw .pinc')).length===0&&(await p.evaluate(()=>localStorage.getItem('aw-opin')))==='0');
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
