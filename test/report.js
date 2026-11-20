// 完了報告と請求：業者ページで報告（写真・追加金額）→ 台帳で承認 → 業者ページで請求書を発行 → 台帳で支払済
// 会社の支払明細書：台帳で作る → 業者ページで確認。  使い方：./reset.sh && node report.js
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
const VT='aa11bb22cc33dd44ee55ff66', VT2='5c1d9e0a7b3f2e6d4a8c1b90';
const ok=(name,cond,extra)=>{ console.log((cond?'OK  ':'NG  ')+name+(extra!==undefined?'  '+JSON.stringify(extra):'')); if(!cond)process.exitCode=1; };
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect();
  const q=(s,p)=>c.query(s,p).then(r=>r.rows);
  // 長沼（専属）：今日の清掃 20,000円。FORCE-ONE（外注・月末締め）：今日の内装 50,000円、承認済みの報告あり（支払明細書用）
  await q("update vendors set token=$1, active=true, close_day=31, taxable=true where id='V1'",[VT]);
  await q("update vendors set token=$1, active=true, close_day=31, taxable=false where id='V2'",[VT2]);
  await q("update procs set start_date=current_date, end_date=null, amt=20000, prog='' where id='P1'");
  await q("insert into procs(id,case_id,kind,who,start_date,amt) values ('P9','C1302','内装','FORCE-ONE',current_date,50000) on conflict (id) do nothing");
  await q("insert into reports(proc_id,case_id,who,done_date,base,st) values ('P9','C1302','FORCE-ONE',current_date,50000,'承認') on conflict (proc_id) do nothing");
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore'}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']});
  const errs=[]; const page=async(o)=>{ const p=await b.newPage(o||{viewport:{width:390,height:800},deviceScaleFactor:2}); p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',d=>{ if(d.type()==='alert')console.log('ALERT',d.message()); d.accept('写真が足りない'); }); return p; };

  // 1) 業者ページで完了報告（写真1枚・追加 3,000円）
  const v=await page(); await v.goto('http://localhost:8787/me.html?t='+VT); await v.waitForTimeout(1500);
  await v.click('[data-m="sched"]'); await v.waitForTimeout(300);
  await v.click('.job [data-rep]'); await v.waitForTimeout(400);
  await v.fill('#rNote','清掃完了。ベランダも清掃済み');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
  await v.setInputFiles('#rFiles',{name:'a.png',mimeType:'image/png',buffer:png}); await v.waitForTimeout(400);
  await v.fill('#rExtra','3000'); await v.fill('#rExtraNote','換気扇の追加清掃');
  await v.screenshot({path:'report-form.png'});
  await v.click('#rSend'); await v.waitForTimeout(2000);
  let r=(await q("select * from reports where proc_id='P1'"))[0];
  ok('報告が保存された',r&&r.st==='報告済'&&r.extra===3000&&r.base===20000&&r.photos.length===1,r&&{st:r.st,extra:r.extra,photos:r.photos});
  ok('工程が完了になった',(await q("select prog from procs where id='P1'"))[0].prog==='完了');
  ok('業者ページに「確認待ち」',(await v.textContent('.job .rst')).includes('確認待ち'));

  // 2) 台帳で写真を見て承認
  const L=await page({viewport:{width:1280,height:900}}); await L.goto('http://localhost:8787/'); await L.waitForTimeout(1500);
  await L.evaluate(()=>{tab='pay';render();}); await L.waitForTimeout(400);
  ok('台帳の支払に確認待ちが出る',(await L.$$('[data-rok]')).length===1);
  await L.click('[data-rphotos]'); await L.waitForTimeout(800);
  const imgOk=await L.$eval('.ask img',im=>im.complete&&im.naturalWidth>0).catch(()=>false);
  ok('写真が台帳で見られる',imgOk);
  await L.click('.ask #askNo');
  await L.click('[data-rok]'); await L.waitForTimeout(1500);
  r=(await q("select * from reports where proc_id='P1'"))[0];
  ok('承認された',r.st==='承認'&&!!r.approved_at);
  ok('追加金額が工程の発注金額に足された',(await q("select amt from procs where id='P1'"))[0].amt===23000);

  // 3) 業者ページで請求書を発行
  await v.goto('http://localhost:8787/me.html?t='+VT); await v.waitForTimeout(1500);
  await v.click('[data-m="bill"]'); await v.waitForTimeout(1000);
  ok('請求に承認済みが出る',(await v.textContent('#blist')).includes('請求できる金額'));
  await v.click('[data-issue]'); await v.waitForTimeout(1500);
  const inv=(await q("select * from invoices where who='長沼俊介'"))[0];
  ok('請求書ができた（23,000＋消費税2,300）',inv&&inv.kind==='請求書'&&inv.subtotal===23000&&inv.tax===2300&&inv.total===25300,inv&&{sub:inv.subtotal,tax:inv.tax,total:inv.total});
  ok('請求書の書面が開く',(await v.textContent('#docBody')).includes('25,300'));
  await v.screenshot({path:'invoice.png'});
  ok('同じ報告で二重に請求できない',(await q("select count(*)::int n from reports where proc_id='P1' and invoice_id=''"))[0].n===0);

  // 4) 台帳：請求書が届き、支払済にできる。FORCE-ONE（免税）に支払明細書を作る
  await L.goto('http://localhost:8787/'); await L.waitForTimeout(1500);
  await L.evaluate(()=>{tab='pay';payMon=THIS_M;render();}); await L.waitForTimeout(400);
  ok('台帳に請求書が出る',(await L.$$('[data-invpaid]')).length===1);
  await L.click('[data-invpaid]'); await L.waitForTimeout(1200);
  ok('支払済になった',(await q("select st from invoices where who='長沼俊介'"))[0].st==='支払済');
  await L.click('[data-mkstmt="FORCE-ONE"]'); await L.waitForTimeout(1500);
  const st=(await q("select * from invoices where who='FORCE-ONE'"))[0];
  ok('支払明細書ができた（免税：消費税なし）',st&&st.kind==='支払明細書'&&st.total===50000&&st.tax===0,st&&{total:st.total,tax:st.tax});
  await L.screenshot({path:'pay-tab.png'});

  // 5) FORCE-ONE の業者ページで支払明細書を確認
  const f=await page(); await f.goto('http://localhost:8787/me.html?t='+VT2); await f.waitForTimeout(1500);
  await f.click('[data-m="bill"]'); await f.waitForTimeout(1000);
  await f.click('[data-doc]'); await f.waitForTimeout(500);
  ok('支払明細書に確認のボタン',await f.$eval('#docOk',x=>!x.hidden));
  await f.click('#docOk'); await f.waitForTimeout(1200);
  ok('業者が確認済みにした',(await q("select st from invoices where who='FORCE-ONE'"))[0].st==='確認済');

  ok('ページのエラーなし',!errs.length,errs);
  await b.close(); srv.kill(); await c.end();
})();
