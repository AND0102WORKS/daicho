// 工程を組む：「入力済」の区分を押すと、予定表がその区分になり、工程の行が光る（./reset.sh のあとに node kfocus.js）
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect();
  await c.query("insert into vendors(id,name,full_name,type,def_kind) values ('V4','検査B','検査B','専属','AW検査') on conflict do nothing");
  await c.query("insert into procs(id,case_id,kind,who) values ('P2','C1302','AW検査','') on conflict do nothing"); await c.end();
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1300,height:900}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  await p.evaluate(()=>{ tab='proc'; pCase='C1302'; render(); }); await p.waitForTimeout(500);
  const on=()=>p.$eval('.seg button.on',x=>x.textContent);
  const r={before:await on()};
  await p.click('[data-kfocus="清掃"]'); await p.waitForTimeout(300);
  r.after=await on(); r.flash=!!(await p.$('.prow.pflash[data-p="P1"]'));
  const ok=r.before==="AW検査"&&r.after==="清掃"&&r.flash&&errs.length===0;
  console.log((ok?'ALL OK':'SOME NG')+' '+JSON.stringify({r,errs}));
  await b.close(); srv.kill();
})();
