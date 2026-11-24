// 2026-11-21 の直し：新しい案件の入力・発注書の確認・業者ページの発注書リンク・再読み込みで同じ画面・打診の状態（./reset.sh のあとに node fix5.js）
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
const sp=__dirname+'/';
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p);
  const VT='tokfix50000000000000001';
  await q("update vendors set token=$1, active=true, type='外注' where id='V1'",[VT]);
  await q("update procs set who='長沼俊介', start_date=current_date+1, ask='' where id='P1'");
  await q("insert into lines(id,case_id,no,name,qty,unit,sell,price,kind) values ('LF1','C1302',1,'ルームクリーニング',1,'式',30000,20000,'清掃') on conflict do nothing");
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1300,height:900},deviceScaleFactor:1});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',x=>x.accept());
  const res=[]; const ok=(name,cond,extra)=>{ res.push(cond); console.log((cond?'OK  ':'NG  ')+name+(extra!==undefined?'  '+JSON.stringify(extra):'')); };
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  // 1) 新しい案件
  const n0=await p.evaluate(()=>DB.cases.length);
  await p.click('#addCase'); await p.waitForTimeout(300);
  ok('案件追加を押しただけでは案件が増えない', await p.evaluate(()=>DB.cases.length)===n0);
  await p.click('#askYes'); await p.waitForTimeout(200);
  ok('空のまま作ると止まる', (await p.textContent('#ncErr')).includes('物件名'));
  await p.screenshot({path:sp+'fix5-newcase.png'});
  await p.fill('#ncProp','テスト物件 101'); await p.fill('#ncAddr','東京都江東区1-1');
  await p.selectOption('#ncClient',{index:1}); await p.selectOption('#ncKind','清掃のみ');
  await p.click('#askYes'); await p.waitForTimeout(500);
  const nc=await p.evaluate(()=>DB.cases.find(x=>x.prop==='テスト物件 101'));
  ok('入れてから案件ができる', !!nc&&nc.addr==='東京都江東区1-1'&&nc.kind==='清掃のみ'&&!!nc.client, nc&&[nc.client,nc.kind]);
  // 4) 再読み込みで同じ画面
  await p.evaluate(()=>{ tab='proc'; pCase='C1302'; render(); }); await p.waitForTimeout(300);
  await p.reload(); await p.waitForTimeout(1500);
  ok('再読み込みしても工程を組むのまま', await p.evaluate(()=>tab==='proc'&&pCase==='C1302'));
  // 5) 打診の状態の行
  await p.evaluate(()=>{ const x=DB.procs.find(q=>q.id==='P1'); x.ask='打診中'; render(); }); await p.waitForTimeout(300);
  ok('工程の行の下に「打診中」と取り消しボタン', await p.$eval('.askline.wait',x=>x.innerText.includes('打診を取り消す')).catch(()=>false));
  await p.screenshot({path:sp+'fix5-ask.png'});
  await p.click('.askline [data-askclr]'); await p.waitForTimeout(300);
  ok('打診を取り消すと、印と一緒に業者・日付も外れる', await p.evaluate(()=>{ const x=DB.procs.find(q=>q.id==='P1'); return x.ask===''&&x.who===''&&!x.date; }));
  // 日付を何度押しても、同じ区分の工程が増えない（入れ替わる）
  const np0=await p.evaluate(()=>DB.procs.filter(q=>q.case==='C1302').length);
  const days=await p.$$eval('.avwrap td.av[data-ask^="長沼俊介|"]',a=>a.slice(0,3).map(x=>x.dataset.ask));
  for(const d of days){ await p.click(`td.av[data-ask="${d}"]`); await p.waitForTimeout(250); await p.click('[data-askgo="only"]'); await p.waitForTimeout(250); }
  const np1=await p.evaluate(()=>DB.procs.filter(q=>q.case==='C1302').length);
  ok('日付を3回押しても工程は増えない', np1===np0, [np0,np1]);
  await p.click('.askline [data-askclr]'); await p.waitForTimeout(300);
  await p.evaluate(()=>{ const x=DB.procs.find(q=>q.id==='P1'); x.who='長沼俊介'; x.date=iso(new Date().getFullYear(),new Date().getMonth()+1,new Date().getDate()); save(); render(); }); await p.waitForTimeout(300);
  await p.evaluate(()=>{ const x=DB.procs.find(q=>q.id==='P1'); x.ask='受諾'; render(); }); await p.waitForTimeout(300);
  ok('受けてもらえたら「発注書を作る」', await p.$eval('.askline.ok',x=>x.innerText.includes('発注書を作る')).catch(()=>false));
  await p.evaluate(()=>{ const x=DB.procs.find(q=>q.id==='P1'); x.ask=''; save(); }); await p.waitForTimeout(1500);
  // 2) 発注を作ると発注書がすぐ開く（下書き）
  await p.evaluate(()=>{ oCase='C1302'; tab='order'; oView='make'; oSel={}; linesOf('C1302').filter(l=>!l.order&&!l.cut).forEach(l=>oSel[l.id]=true); render(); }); await p.waitForTimeout(400);
  await p.click('#mkOrder'); await p.waitForTimeout(300);
  await p.click('#askYes'); await p.waitForTimeout(1200);
  ok('発注を作るとすぐ発注書が開き「まだ下書き」と、住所・鍵情報の未入力の注意が出る', await p.$eval('.ob',x=>x.innerText.includes('まだ下書き')&&x.innerText.includes('鍵情報 が未入力')).catch(()=>false));
  await p.screenshot({path:sp+'fix5-order.png'});
  await p.waitForTimeout(1500);
  const o=(await q("select id,no,st,token from orders order by created_at desc limit 1")).rows[0];
  await q("update procs set start_date=current_date+1 where order_id=$1",[o.id]);
  // 3) 業者ページ：下書きの間は工程に出ない。送付済になると承諾のリンク
  const v=await b.newPage({viewport:{width:390,height:800},deviceScaleFactor:2}); v.on('pageerror',e=>errs.push('me:'+e.message));
  await v.goto('http://localhost:8787/me.html?t='+VT); await v.waitForTimeout(1200); await v.click('[data-m="sched"]'); await v.waitForTimeout(1000);
  const t1=await v.textContent('#list');
  ok('下書きの発注の工程は業者ページに出ない', !(await v.$('a.olink')), t1.slice(0,80));
  await q("update orders set st='送付済', sent=now() where id=$1",[o.id]);
  await v.reload(); await v.waitForTimeout(1200); await v.click('[data-m="sched"]'); await v.waitForTimeout(1000);
  ok('送付済にすると工程に「発注書を見て承諾する」', await v.$eval('a.olink.wait',x=>x.innerText).then(t=>t.includes('承諾')).catch(()=>false));
  await v.screenshot({path:sp+'fix5-me.png',fullPage:true});
  await v.click('a.olink.wait'); await v.waitForTimeout(1200);
  ok('押すと発注書が開く', v.url().includes('order.html'));
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
