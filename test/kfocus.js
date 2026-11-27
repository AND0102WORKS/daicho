// 工程を組む：区分のボタンはいつでも押せる。もうある区分を押すと、同じ区分の工程をもう1本足す（2社に頼むとき）。
// 足すと予定表がその区分になり、足した行が光る。日付を押すと、空いている方の工程に入る（./reset.sh のあとに node kfocus.js）
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect();
  await c.query("insert into vendors(id,name,full_name,type,def_kind) values ('V3','國吉','國吉','専属','清掃'),('V4','検査B','検査B','専属','AW検査') on conflict do nothing");
  await c.query("insert into procs(id,case_id,kind,who) values ('P2','C1302','AW検査','') on conflict do nothing");
  await c.query("update cases set memo='清掃 AW検査' where id='C1302'"); await c.end();
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1300,height:900}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',x=>x.accept());
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  await p.evaluate(()=>{ tab='proc'; pCase='C1302'; render(); }); await p.waitForTimeout(500);
  const on=()=>p.$eval('.seg button.on',x=>x.textContent);
  const cnt=k=>p.evaluate(k=>DB.procs.filter(x=>x.case==='C1302'&&x.kind===k).length,k);
  const chip=await p.$('.kk[data-addkind="C1302|清掃"]');
  ok('もうある区分（清掃）のボタンも押せる形で出る', !!chip&&(await chip.innerText()).includes('入力済 1'), chip&&await chip.innerText());
  await chip.click(); await p.waitForTimeout(400);
  ok('押すと清掃の工程が2本になる', (await cnt('清掃'))===2);
  ok('予定表が清掃になり、足した行が光る', (await on())==='清掃'&&!!(await p.$('.prow.pflash')));
  await p.screenshot({path:__dirname+'/kfocus.png'});
  // 2社目：國吉さんの日付を押すと、空いている方（2本目）に入る
  const day=await p.$eval('.avwrap td.av[data-ask^="國吉|"]',x=>x.dataset.ask);
  await p.click(`td.av[data-ask="${day}"]`); await p.waitForTimeout(250); await p.click(`td.av[data-ask="${day}"]`); await p.waitForTimeout(300); await p.click('[data-askgo="ok"]'); await p.waitForTimeout(400);
  const whos=await p.evaluate(()=>DB.procs.filter(x=>x.case==='C1302'&&x.kind==='清掃').map(x=>x.who).sort());
  ok('清掃が2社（長沼俊介・國吉）になる', whos.join(',')==='國吉,長沼俊介', whos);
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await b.close(); srv.kill();
})();
