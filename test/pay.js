// 支払：月／日付の範囲で絞る・業者ごと／物件ごと／年間の表・支払明細書・支払済み・振込の一覧・業者ごとの支払日（./reset.sh のあとに node pay.js）
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p).then(r=>r.rows);
  const one=async(s,p)=>(await q(s,p))[0];
  await q("insert into cases(id,client,prop,kind,st,live,sales,done) values ('CP2','日本財託','見本コーポ 102','修繕','完工',true,60000,'2026-10-20')");
  await q("insert into procs(id,case_id,kind,who,start_date,amt) values ('PP2','C1302','内装','FORCE-ONE','2026-11-18',80000),('PP3','CP2','内装','FORCE-ONE','2026-10-20',30000)");
  await q("insert into invoices(id,org,who,kind,month,period_from,period_to,items,subtotal,tax,total,taxable,st,issued_at) values ('IV1','hq','FORCE-ONE','請求書','2026-10','2026-10-01','2026-10-31','[]',30000,3000,33000,true,'発行',now())");
  await q("insert into reports(id,org,proc_id,case_id,who,done_date,base,extra,st) values ('RP1','hq','P1','C1302','長沼俊介','2026-11-15',22000,0,'承認')");
  await q("insert into reports(id,org,proc_id,case_id,who,done_date,base,extra,st,invoice_id) values ('RP3','hq','PP3','CP2','FORCE-ONE','2026-10-20',30000,0,'承認','IV1')");
  await q("insert into vendor_bank(vendor_id,org,bank) values ('V2','hq','見本銀行 見本支店 普通 0000000')");
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',x=>x.accept());
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  const T=s=>p.textContent(s).then(t=>t.replace(/\s+/g,' ')), saved=()=>p.waitForTimeout(1700), w=()=>p.waitForTimeout(350);
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  await p.click('#tabs [data-t="pay"]'); await w();
  await p.selectOption('#payMon','2026-11'); await w();
  let t=await T('#main');
  // 長沼 22,000（税込 24,200）＋ FORCE-ONE 80,000（税込 88,000）
  ok('月で選ぶ・業者ごと：2社・件数・税抜・税込・合計の行', t.includes('長沼俊介')&&t.includes('FORCE-ONE')&&t.includes('合計（2社）')&&t.includes('102,000')&&t.includes('112,200'), t.slice(0,420));
  ok('状態：承認済みは「支払明細書がまだ」、報告の無い工程は「完了報告がまだ」', (await T('tr[data-pwho="長沼俊介"]')).includes('支払明細書がまだ')&&(await T('tr[data-pwho="FORCE-ONE"]')).includes('完了報告がまだ'));
  ok('締め・支払の決まりと支払予定日が出る（既定は月末締め・翌月末払い）', (await T('tr[data-pwho="長沼俊介"]')).includes('月末締め・翌月末払い')&&(await T('tr[data-pwho="長沼俊介"]')).includes('12/31'));
  await p.screenshot({path:__dirname+'/pay1.png'});
  await p.click('[data-pview="proc"]'); await w(); t=await T('#main');
  ok('物件ごと：工程が1行ずつ、下に合計', t.includes('プレール')&&t.includes('合計（2件）')&&t.includes('102,000')&&t.includes('112,200')&&!t.includes('見本コーポ'), t.slice(300,640));
  await p.screenshot({path:__dirname+'/pay2.png'});
  // 日付で選ぶ
  await p.click('[data-pmode="range"]'); await w();
  await p.fill('#pFrom','2026-10-01'); await p.fill('#pTo','2026-11-16'); await p.keyboard.press('Tab'); await w(); t=await T('#main');
  ok('日付で選ぶ：10/1〜11/16 に完了した工程だけ（11/18 は入らない）', t.includes('見本コーポ 102')&&t.includes('プレール')&&t.includes('合計（2件）')&&t.includes('52,000'), t.slice(300,640));
  await p.click('[data-pview="vendor"]'); await w(); t=await T('#main');
  ok('日付で選ぶ・業者ごと：請求書の出ている業者は「支払予定」と書類', (await T('tr[data-pwho="FORCE-ONE"]')).includes('支払予定')&&(await T('tr[data-pwho="FORCE-ONE"]')).includes('請求書 ¥33,000'));
  await p.click('tr[data-pwho="FORCE-ONE"] td.nm'); await w(); t=await T('#main');
  ok('業者の行を押すと、その業者の物件ごとに切り替わる', t.includes('見本コーポ 102')&&t.includes('合計（1件）'));
  await p.selectOption('#pWho',''); await w();
  // 支払明細書を作る → 支払済み
  await p.click('[data-pmode="month"]'); await w(); await p.click('[data-pview="vendor"]'); await w();
  await p.click('[data-mkstmt="長沼俊介"]'); await saved();
  const iv=await one("select id,kind,month,total,st from invoices where who='長沼俊介'");
  ok('支払明細書を作れる（承認済みの完了報告から）', !!iv&&iv.kind==='支払明細書'&&iv.month==='2026-11'&&iv.total===24200&&(await T('tr[data-pwho="長沼俊介"]')).includes('支払予定'), iv);
  await p.click('tr[data-pwho="長沼俊介"] [data-invpaid]'); await saved();
  ok('支払済みにできる', (await one("select st from invoices where who='長沼俊介'")).st==='支払済'&&(await T('tr[data-pwho="長沼俊介"]')).includes('支払済'));
  // 振込の一覧（経理の印のある人だけ）
  await p.click('#pBank'); await w(); t=await T('.ask');
  ok('振込の一覧：未払いの書類・振込先・金額', t.includes('小出貴明')&&t.includes('見本銀行')&&t.includes('33,000')&&!t.includes('長沼'), t.slice(0,200));
  await p.click('#askNo'); await w();
  await p.evaluate(()=>{ ME.fin=false; render(); }); await w();
  ok('経理の印の無い人には「振込の一覧」が出ない', !(await p.$('#pBank')));
  await p.evaluate(()=>{ ME.fin=true; render(); }); await w();
  // 業者ごとの支払日
  await p.evaluate(()=>{ tab='vendor'; vpId='V2'; vpTab='基本情報'; render(); }); await w();
  await p.selectOption('[data-vf="payM"]','2'); await w(); await p.fill('[data-vf="payD"]','10'); await p.keyboard.press('Tab'); await saved();
  const vd=await one("select pay_m,pay_d from vendors where id='V2'");
  await p.click('#tabs [data-t="pay"]'); await w();
  ok('業者ごとに支払日を決められる（翌々月10日払い → 11月締めは 1/10）', vd.pay_m===2&&vd.pay_d===10&&(await T('tr[data-pwho="FORCE-ONE"]')).includes('翌々月10日払い')&&(await T('tr[data-pwho="FORCE-ONE"]')).includes('1/10'), vd);
  // 年間の表
  await p.click('[data-pview="year"]'); await w(); t=await T('#main');
  ok('年間の表：今までの業者×月の表が残る', t.includes('発注先')&&t.includes('登録番号')&&t.includes('合計（税込）'));
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
