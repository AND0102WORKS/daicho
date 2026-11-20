// 日程の打診：工程を組むの予定表で打診 → 業者ページで受ける／断る → 台帳に反映（./reset.sh のあとに node ask.js）
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p);
  await q("update vendors set type='専属', def_kind='清掃', kinds='AW検査' where id='V1'");
  await q("insert into vendors(id,name,full_name,type,def_kind,kinds,token,active) values ('V3','國吉','國吉','専属','清掃','','tokkuniyoshi0000000001',true),('V4','検査B','検査B','専属','AW検査','','tokkensab000000000001',true) on conflict do nothing");
  await q(`update procs set start_date=null, who='' where id='P1'`);
  await q(`insert into procs(id,case_id,kind,who) values ('P2','C1302','AW検査','') on conflict do nothing`);
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:'/home/user/daicho/test'}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1300,height:900},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',x=>x.accept());
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  await p.evaluate(()=>{tab='proc';pCase='C1302';pHide=true;render();}); await p.waitForTimeout(800);
  const sp=__dirname+'/';
  // 清掃：國吉さん 11/25 に打診
  await p.click('td.av[data-ask="國吉|2026-11-25"]'); await p.waitForTimeout(300);
  await p.screenshot({path:sp+'ask1.png'});
  await p.click('[data-askgo="only"]'); await p.waitForTimeout(400);
  // 検査：検査Bさん 11/27 に打診
  await p.click('[data-avk="AW検査"]'); await p.waitForTimeout(200);
  await p.click('td.av[data-ask="検査B|2026-11-27"]'); await p.waitForTimeout(200); await p.click('[data-askgo="only"]');
  await p.waitForTimeout(2500);
  const r1=(await q("select id,kind,who,start_date::text,ask from procs where case_id='C1302' order by id")).rows;
  // 業者ページ（國吉）：受ける
  const v=await b.newPage({viewport:{width:390,height:800},deviceScaleFactor:2}); v.on('dialog',x=>x.accept()); v.on('pageerror',e=>errs.push('me:'+e.message));
  await v.goto('http://localhost:8787/me.html?t=tokkuniyoshi0000000001'); await v.waitForTimeout(1500);
  await v.screenshot({path:sp+'ask2.png'});
  const card=await v.$$eval('.askc',a=>a.map(x=>x.innerText.replace(/\s+/g,' ')));
  await v.click('.askc .ok'); await v.waitForTimeout(800);
  // 業者ページ（検査B）：断る
  await v.goto('http://localhost:8787/me.html?t=tokkensab000000000001'); await v.waitForTimeout(1500);
  await v.click('.askc .ng'); await v.waitForTimeout(800);
  const r2=(await q("select id,kind,who,start_date::text,ask from procs where case_id='C1302' order by id")).rows;
  await p.reload(); await p.waitForTimeout(1500); await p.evaluate(()=>{tab='proc';pCase='C1302';pHide=true;render();}); await p.waitForTimeout(800);
  await p.screenshot({path:sp+'ask3.png'});
  const warns=await p.$$eval('.card',a=>a.map(x=>x.innerText).join(' ').match(/[^\n]*(打診|辞退|都合)[^\n]*/g));
  console.log(JSON.stringify({r1,card,r2,warns,errs},null,0));
  await c.end(); await b.close(); srv.kill();
})();
