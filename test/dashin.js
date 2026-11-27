// 工程を組む：予定表のマスは2回押す（開始日 → 完了日）→ 確かめの窓（打診する／承諾済み／やめる）。押すまで何も入らない（./reset.sh のあとに node dashin.js）
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p).then(r=>r.rows);
  const one=async(s,p)=>(await q(s,p))[0];
  await q("update vendors set token='aa11bb22cc33dd44ee55ff66', active=true where id='V1'");
  await q("insert into vendor_push(org,vendor_id,endpoint,p256dh,auth) values ('hq','V1','https://push.example.com/x','K','A')");
  await q("insert into lines(id,case_id,no,name,spec,qty,unit,sell,price,kind) values ('LD1','C1302',1,'ルームクリーニング','全室',1,'式',30000,22000,'清掃'),('LD2','C1302',2,'','',1,'式',0,0,'清掃')");
  const before=await one("select who,start_date::text s,end_date::text e,coalesce(ask,'') ask from procs where id='P1'");
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',x=>x.accept());
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  const T=s=>p.textContent(s).then(t=>t.replace(/\s+/g,' ')), w=()=>p.waitForTimeout(400);
  const now=()=>one("select who,start_date::text s,end_date::text e,coalesce(ask,'') ask from procs where id='P1'");
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  await p.evaluate(()=>{ tab='proc'; pCase='C1302'; pHide=true; avOne='清掃'; render(); }); await p.waitForTimeout(800);
  const days=await p.$$eval('.avwrap td.av.free[data-ask^="長沼俊介|"]',a=>a.map(x=>x.dataset.ask));
  const A=days[days.length-6], B=days[days.length-4], sel=d=>`td.av[data-ask="${d}"]`;
  // 1回目：開始日
  await p.click(sel(A)); await w();
  ok('1回目のクリック：開始日に色が付き、案内が出る。窓は出ず、工程にも何も入らない', await p.$eval(sel(A),x=>x.classList.contains('sel1'))&&(await T('.avhelp')).includes('終わりの日を押してください')&&!(await p.$('.ask'))&&JSON.stringify(await now())===JSON.stringify(before));
  await p.screenshot({path:__dirname+'/dashin1.png'});
  await p.keyboard.press('Escape'); await w();
  ok('Esc でやり直せる', !(await p.$('td.av.sel1'))&&!(await T('.avhelp')).includes('終わりの日'));
  // 2回目：完了日 → 確かめの窓
  await p.click(sel(A)); await w(); await p.click(sel(B)); await w();
  let t=await T('.ask');
  const dA=A.split('|')[1], dB=B.split('|')[1], mdj=d=>(+d.slice(5,7))+'/'+(+d.slice(8,10));
  ok('2回目のクリック：確かめの窓に期間が出る。ボタンは「やめる・承諾済み・打診する」の3つ', t.includes(mdj(dA))&&t.includes(mdj(dB))&&t.includes('まだ何も入っていません')&&(await p.$$eval('.ask [data-askgo]',a=>a.map(x=>x.textContent.trim()).join('|')))==='やめる|承諾済み|打診する', t.slice(0,120));
  ok('伝わる内容：名前のある明細だけ（空の行は出ない）。携帯に通知が出ることも分かる', t.includes('全室 ルームクリーニング')&&t.includes('明細 1件')&&!/・\s*1式/.test(t)&&t.includes('携帯に通知が出ます'));
  ok('窓が出ている間も、まだ何も保存されていない', JSON.stringify(await now())===JSON.stringify(before));
  await p.screenshot({path:__dirname+'/dashin2.png'});
  await p.click('.ask [data-askgo="undo"]'); await p.waitForTimeout(1500);
  ok('「やめる」：何も入らない', JSON.stringify(await now())===JSON.stringify(before)&&!(await p.$('.ask')));
  // 打診する
  await p.click(sel(A)); await w(); await p.click(sel(B)); await w(); await p.click('.ask [data-askgo="ask"]'); await p.waitForTimeout(4500);
  let n=await now(); const lg=await q("select proc_id,kind,ok from notify_log");
  ok('「打診する」：工程に開始日〜完了日で入り、打診中になる', n.who==='長沼俊介'&&n.s===dA&&n.e===dB&&n.ask==='打診中', n);
  ok('業者の携帯に通知し、記録が残る', lg.length===1&&lg[0].proc_id==='P1'&&lg[0].ok&&(await T('#toast')).includes('携帯の通知（1台） で打診を知らせた'), {lg,toast:await T('#toast').catch(()=>'')});
  // 1日だけ・承諾済み
  await p.evaluate(()=>{ const x=DB.procs.find(y=>y.id==='P1'); x.ask=''; x.who=''; x.date=''; x.end=''; save(); render(); }); await p.waitForTimeout(1800);
  await p.click(sel(B)); await w(); await p.click(sel(B)); await w();
  ok('同じマスを2回押すと1日だけ', (await T('.ask')).includes(mdj(dB))&&!(await T('.ask')).includes('〜'));
  await p.click('.ask [data-askgo="ok"]'); await p.waitForTimeout(1800); n=await now();
  ok('「承諾済み」：打診は送らず、確定（受諾）の工程として入る', n.who==='長沼俊介'&&n.s===dB&&(n.e===null||n.e===dB)&&n.ask==='受諾'&&(await q("select 1 from notify_log")).length===1, n);
  // 通知が未設定の業者
  await q("delete from vendor_push"); await p.evaluate(()=>dbResync('test')); await p.waitForTimeout(900);
  await p.evaluate(()=>{ const x=DB.procs.find(y=>y.id==='P1'); x.ask=''; x.who=''; x.date=''; x.end=''; save(); render(); }); await p.waitForTimeout(1800);
  await p.click(sel(A)); await w(); await p.click(sel(A)); await w();
  ok('通知が未設定の業者：窓で分かる', (await T('.ask')).includes('携帯の通知が未設定'));
  await p.click('.ask [data-askgo="ask"]'); await p.waitForTimeout(4500);
  ok('押したあと「文面をコピー」で知らせるよう案内する', (await T('#toast')).includes('未設定')&&(await T('#toast button')).includes('文面をコピー'), await T('#toast').catch(()=>''));
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
