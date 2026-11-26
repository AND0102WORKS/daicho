// 請求：月／日付の範囲で絞る・顧客ごと／物件ごと／年間の表・請求書を作る（番号・固定）・入金済み・取り消し（./reset.sh のあとに node bill.js）
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p).then(r=>r.rows);
  const one=async(s,p)=>(await q(s,p))[0];
  await q("update cases set done='2026-11-20' where id='C1302'");
  await q("insert into cases(id,client,prop,kind,st,live,sales,done) values ('CB2','日本財託','見本ハイツ 201','清掃','完工',true,50000,'2026-11-25'),('CB3','見本不動産','見本コーポ 102','修繕','完工',true,30000,'2026-10-10'),('CB4','日本財託','見本ゼロ 1','清掃','完工',true,0,'2026-11-05')");
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',x=>x.accept());
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  const T=s=>p.textContent(s).then(t=>t.replace(/\s+/g,' ')), saved=()=>p.waitForTimeout(1700), w=()=>p.waitForTimeout(350);
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  await p.evaluate(()=>{ window.open=()=>{ const d={write(h){ window.__printed=h; },close(){}}; return {document:d,focus(){},print(){ window.__didPrint=1; }}; }; });
  await p.click('#tabs [data-t="bill"]'); await w();
  await p.selectOption('#iMonth','2026-11'); await w();
  let t=await T('#main');
  // 91,500 + 50,000 = 141,500 → 税込 155,650
  ok('月で選ぶ・顧客ごと：件数・税抜・税込・未請求・合計の行', t.includes('日本財託')&&t.includes('3件')&&t.includes('141,500')&&t.includes('155,650')&&t.includes('未請求')&&t.includes('合計（1社）'), t.slice(0,300));
  await p.click('[data-bview="case"]'); await w(); t=await T('#main');
  ok('物件ごと：物件が1行ずつ出て、下に合計', t.includes('プレール')&&t.includes('見本ハイツ 201')&&t.includes('合計（3件）')&&t.includes('155,650')&&!t.includes('見本コーポ'), t.slice(200,520));
  await p.screenshot({path:__dirname+'/bill2.png'});
  // 日付で選ぶ
  await p.click('[data-bmode="range"]'); await w();
  await p.fill('#bFrom','2026-10-01'); await p.fill('#bTo','2026-11-22'); await p.keyboard.press('Tab'); await w(); t=await T('#main');
  ok('日付で選ぶ：10/1〜11/22 に完工した物件だけ（11/25 は入らない）', t.includes('見本コーポ 102')&&t.includes('プレール')&&!t.includes('見本ハイツ 201')&&t.includes('合計（3件）'), t.slice(200,520));
  await p.click('[data-bview="client"]'); await w(); t=await T('#main');
  ok('日付で選ぶ・顧客ごと：2社の合計', t.includes('見本不動産')&&t.includes('日本財託')&&t.includes('合計（2社）')&&t.includes('121,500'), t.slice(200,520));
  await p.click('tr[data-bcl="見本不動産"]'); await w(); t=await T('#main');
  ok('顧客の行を押すと、その顧客の物件ごとに切り替わる', t.includes('見本コーポ 102')&&!t.includes('プレール')&&t.includes('合計（1件）'));
  await p.selectOption('#bCl',''); await w();
  // 請求書を作る
  await p.click('[data-bmode="month"]'); await w(); await p.click('[data-bview="client"]'); await w();
  await p.click('tr[data-bopen="日本財託"]'); await w(); t=await T('#main');
  ok('顧客の月のページ：下書きの請求書（番号なし）・¥0 の案件の注意', t.includes('← 請求')&&t.includes('請求書')&&t.includes('下書き')&&t.includes('155,650')&&t.includes('¥0 の案件が 1件'), t.slice(0,260));
  await p.click('[data-bact="make"]'); await saved();
  let bl=await one("select no,client,client_id,month,subtotal,tax,total,st,jsonb_array_length(items) n,period_from::text f,period_to::text t,due_date::text due from bills");
  ok('請求書を作ると、番号が付いて DB に残る（税は合計に1回）', !!bl&&/^R-2611-001$/.test(bl.no)&&bl.subtotal===141500&&bl.tax===14150&&bl.total===155650&&bl.n===2&&bl.st==='請求済'&&bl.f==='2026-11-01'&&bl.t==='2026-11-30'&&bl.due==='2026-12-31'&&bl.client_id==='CL1', bl);
  await p.screenshot({path:__dirname+'/bill3.png'});
  // 固定：案件の金額を変えても請求書は変わらない
  await q("update cases set sales=99999 where id='CB2'"); await p.evaluate(()=>dbResync('test')); await p.waitForTimeout(900); t=await T('#main');
  ok('あとから案件の金額を直しても、出した請求書は変わらない', t.includes('155,650')&&t.includes('R-2611-001'));
  await q("update cases set sales=50000 where id='CB2'");
  await q("insert into cases(id,client,prop,kind,st,live,sales,done) values ('CB5','日本財託','見本あとから 3','清掃','完工',true,10000,'2026-11-28')"); await p.evaluate(()=>dbResync('test')); await p.waitForTimeout(900); t=await T('#main');
  ok('請求書を作ったあとに増えた案件は「入っていない案件」として知らせる', t.includes('まだ請求書に入っていない案件が 1件')&&t.includes('見本あとから 3'));
  await p.click('[data-bact="print"]'); await w();
  ok('印刷・PDF：請求書の紙面が開く', String(await p.evaluate(()=>window.__printed||'')).includes('R-2611-001')&&(await p.evaluate(()=>window.__didPrint))===1);
  // 自社の情報
  await p.click('#bCo'); await w(); await p.fill('#co_inv','T0000000000000'); await p.fill('#co_bank','見本銀行 見本支店 普通 0000000'); await p.click('#askYes'); await saved();
  const co=await one("select value from settings where key='co'");
  ok('自社の情報が保存され、請求書に載る', co&&co.value.inv==='T0000000000000'&&(await T('.billdoc')).includes('T0000000000000')&&(await T('.billdoc')).includes('見本銀行'), co);
  // 入金
  await p.click('[data-bact="paid"]'); await w(); await p.fill('#bpDate','2026-12-28'); await p.fill('#bpAmt','155210'); await p.fill('#bpMemo','振込手数料 440'); await p.click('#askYes'); await saved();
  bl=await one("select st,paid_date::text d,paid_amt,memo from bills"); const rc=await one("select amount from receipts where client='日本財託' and month='2026-11'");
  ok('入金済み：入金日・金額・メモが残り、年間の表の入金にも入る', bl.st==='入金済'&&bl.d==='2026-12-28'&&bl.paid_amt===155210&&bl.memo==='振込手数料 440'&&rc&&+rc.amount===155210, {bl,rc});
  ok('入金済みの請求書には「取り消す」が出ない（先に入金を取り消す）', !(await p.$('[data-bact="cancel"]'))&&!!(await p.$('[data-bact="unpaid"]')));
  await p.click('#bBack'); await w(); t=await T('#main');
  ok('一覧：入金済みと番号、入っていない案件の知らせ', t.includes('入金済み 12/28')&&t.includes('R-2611-001')&&t.includes('請求書に入っていない案件 1件'), t.slice(200,560));
  await p.screenshot({path:__dirname+'/bill1.png'});
  await p.click('[data-bview="case"]'); await w(); t=await T('#main');
  ok('物件ごと：請求書に入った物件は番号と入金済み、入っていない物件は未請求', (await T('tr:has-text("見本ハイツ 201")')).includes('R-2611-001')&&(await T('tr:has-text("見本あとから 3")')).includes('未請求'));
  await p.selectOption('#bSt','non'); await w(); t=await T('#main');
  ok('状態で絞る：未請求だけ', t.includes('見本あとから 3')&&!t.includes('見本ハイツ 201'));
  await p.selectOption('#bSt',''); await w();
  // 取り消して作り直す
  await p.click('[data-bview="client"]'); await w(); await p.click('tr[data-bopen="日本財託"]'); await w();
  await p.click('[data-bact="unpaid"]'); await saved();
  ok('入金を取り消せる', (await one("select st from bills")).st==='請求済');
  await p.click('[data-bact="cancel"]'); await saved();
  ok('請求書を取り消すと、記録は残り（取消）、下書きに戻る', (await one("select st from bills")).st==='取消'&&(await T('#main')).includes('下書き'));
  await p.click('[data-bact="make"]'); await saved();
  const b2=await one("select no,total,jsonb_array_length(items) n from bills where st='請求済'");
  ok('作り直すと次の番号で、増えた案件も入る', b2&&b2.no==='R-2611-002'&&b2.n===3&&b2.total===166650, b2);
  // 年間の表
  await p.click('#bBack'); await w(); await p.click('[data-bview="year"]'); await w(); t=await T('#main');
  ok('年間の表：今までの顧客×月の合計と締日の入力が残る', t.includes('計上基準')&&t.includes('日本財託')&&!!(await p.$('input.tm')));
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
