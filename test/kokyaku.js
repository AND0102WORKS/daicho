// 顧客のメニュー（一覧・顧客のページ・入金日）と、発注書の備考テンプレート（./reset.sh のあとに node kokyaku.js）
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p).then(r=>r.rows);
  const one=async(s,p)=>(await q(s,p))[0];
  await q("insert into clients(id,name,full_name) values ('CL2','見本不動産','株式会社 見本不動産')");
  await q("insert into cases(id,client,prop,kind,st,live,sales,done) values ('CK2','日本財託','見本ハイツ 201','清掃','完工',true,50000,current_date)");
  await q("insert into lines(id,case_id,name,qty,unit,sell,price,kind) values ('LK1','C1302','ルームクリーニング',1,'式',30000,22000,'清掃')");
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); let promptAns='';
  p.on('dialog',x=>x.accept(x.type()==='prompt'?promptAns:undefined));
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  const T=s=>p.textContent(s).then(t=>t.replace(/\s+/g,' ')), saved=()=>p.waitForTimeout(1700), w=()=>p.waitForTimeout(400);
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  ok('左のメニューに「顧客」がある', !!(await p.$('#tabs [data-t="client"]')));
  await p.click('#tabs [data-t="client"]'); await w();
  let t=await T('#main');
  ok('一覧：顧客・締めと入金・進行中の案件・今月の請求', t.includes('日本財託')&&t.includes('見本不動産')&&t.includes('月末締め')&&(await T('tr[data-kn="日本財託"]')).includes('1件')&&(await T('tr[data-kn="日本財託"]')).includes('155,650'), t.slice(0,260));
  ok('一覧に入力欄は無い', (await p.$$('#main table input, #main table select')).length===0);
  await p.screenshot({path:__dirname+'/kokyaku1.png'});
  // 顧客のページ
  await p.click('tr[data-kn="日本財託"] td.nm'); await w(); t=await T('#main');
  ok('行を押すと顧客のページ：基本情報・取引条件・4つのタブ', t.includes('← 顧客')&&t.includes('基本情報')&&t.includes('取引条件')&&['案件','請求・入金','発注書の備考'].every(x=>t.includes(x)));
  await p.fill('[data-klf="contact"]','見本 太郎'); await p.keyboard.press('Tab'); await p.waitForTimeout(500);
  await p.fill('[data-klf="addr"]','東京都見本区1-2-3'); await p.keyboard.press('Tab'); await p.waitForTimeout(500);
  await p.selectOption('[data-klf="payM"]','2'); await p.waitForTimeout(500); await p.fill('[data-klf="payD"]','10'); await p.keyboard.press('Tab'); await saved();
  const cl=await one("select contact,addr,pay_m,pay_d from clients where id='CL1'");
  ok('担当者・住所・入金日（翌々月10日）が保存される', cl.contact==='見本 太郎'&&cl.addr==='東京都見本区1-2-3'&&cl.pay_m===2&&cl.pay_d===10&&(await T('.cpsub')).includes('翌々月10日入金'), cl);
  ok('入金予定日がその決まりで出る', await p.evaluate(()=>dueOf('日本財託','2026-11')==='2027-01-10'));
  await p.click('[data-kltab="案件"]'); await w(); t=await T('.cpbody');
  ok('案件のタブ：進行中と完工した案件', t.includes('プレール')&&t.includes('見本ハイツ 201'));
  await p.click('[data-kltab="請求・入金"]'); await w(); t=await T('.cpbody');
  ok('請求・入金のタブ：月ごとの金額と状態', t.includes('月分')&&t.includes('未請求'));
  // 発注書の備考テンプレート
  await p.click('[data-kltab="発注書の備考"]'); await w();
  await p.click('#klTplAdd'); await w(); await p.fill('#tpTitle','完了の仕様（清掃）'); await p.fill('#tpBody','・完了写真は各2枚以上\n・ブレーカーは落として退室'); await p.check('#tpAlways'); await p.click('#askYes'); await saved();
  await p.click('#klTplAdd'); await w(); await p.fill('#tpTitle','クロス貼替の決まり'); await p.fill('#tpBody','・指定品番 SP-0000'); await p.click('#askYes'); await saved();
  let tp=(await one("select tpls from clients where id='CL1'")).tpls;
  ok('テンプレートを顧客ごとに登録できる（いつも入れる の印つき）', tp.length===2&&tp[0].title==='完了の仕様（清掃）'&&tp[0].always===true&&tp[1].always===false&&(await T('.cpbody')).includes('いつも入れる'), tp.map(x=>x.title));
  await p.screenshot({path:__dirname+'/kokyaku2.png'});
  await p.click('[data-tpled="1"]'); await w(); await p.fill('#tpBody','・指定品番 SP-0000\n・巾木はそのまま'); await p.click('#askYes'); await saved();
  ok('テンプレートを直せる', (await one("select tpls from clients where id='CL1'")).tpls[1].body.includes('巾木'));
  // 発注を作る：備考にテンプレート
  await p.evaluate(()=>{ tab='order'; oFilter='すべて'; oCase='C1302'; oSel={}; linesOf('C1302').forEach(l=>oSel[l.id]=true); render(); }); await w();
  await p.click('#mkOrder'); await w();
  ok('発注を作るとき：その顧客のテンプレートがボタンで出て、「いつも入れる」は最初から入っている', (await p.$$('.ask .tchip')).length===2&&(await p.inputValue('#oqMemo')).includes('【完了の仕様（清掃）】')&&!(await p.inputValue('#oqMemo')).includes('クロス')&&!!(await p.$('.ask .tchip.on')));
  await p.click('.ask .tchip[data-tpl="1"]'); await w();
  ok('ボタンを押すと備考に入る', (await p.inputValue('#oqMemo')).includes('【クロス貼替の決まり】\n・指定品番 SP-0000\n・巾木はそのまま'));
  await p.click('.ask .tchip[data-tpl="0"]'); await w();
  ok('もう一度押すと外れる', !(await p.inputValue('#oqMemo')).includes('完了の仕様'));
  await p.click('.ask .tchip[data-tpl="0"]'); await w();
  await p.evaluate(()=>{ const ta=document.getElementById('oqMemo'); ta.value+='\n\n駐車場は3番'; });
  await p.screenshot({path:__dirname+'/kokyaku3.png'});
  await p.selectOption('#oqWho','長沼俊介'); await p.click('#askYes'); await saved();
  const od=await one("select memo,st,token from orders");
  ok('発注書の備考にテンプレートの文面と書き足した分が残る', od.memo.includes('【クロス貼替の決まり】')&&od.memo.includes('【完了の仕様（清掃）】')&&od.memo.includes('駐車場は3番')&&od.st==='下書き', od.memo);
  ok('発注書のボタンは「発注」「リンクをコピー」「業者の画面を見る」「閉じる」だけ', (await p.$$eval('.ob > .askbtn:not(.osmemo .askbtn) .btn',a=>a.map(x=>x.textContent.trim()).join('|')))==='発注|リンクをコピー|業者の画面を見る|閉じる'&&!(await p.$('#oMail'))&&!(await p.$('#oLine')));
  ok('下書きの発注書で、備考を直せる', !!(await p.$('#osMemo'))&&(await p.$$('.ob .tchip.on')).length===2);
  await p.click('.ob .tchip[data-tpl="1"]'); await w(); await p.click('#osMemoSave'); await saved();
  ok('発注書から外して保存できる', !(await one("select memo from orders")).memo.includes('クロス')&&(await T('.ob')).includes('完了写真は各2枚以上'));
  // 業者が見る発注書にも出る
  const v=await b.newPage({viewport:{width:900,height:900}}); v.on('pageerror',e=>errs.push('order:'+e.message));
  await q("update orders set st='送付済', sent=now()");
  await v.goto('http://localhost:8787/order.html?t='+od.token); await v.waitForTimeout(1500);
  ok('業者が開く発注書の伝達事項に、完了の仕様が出る', (await v.textContent('body')).includes('完了写真は各2枚以上')&&(await v.textContent('body')).includes('駐車場は3番'));
  // 名前を変える・登録
  await p.evaluate(()=>{ document.querySelectorAll('.ask').forEach(x=>x.remove()); tab='client'; klTab='基本情報'; render(); }); await w();
  promptAns='日本財託（新）'; await p.click('#klRename'); await saved();
  ok('名前を変えると、案件の顧客名も一緒に変わる', (await one("select client from cases where id='C1302'")).client==='日本財託（新）'&&(await one("select name from clients where id='CL1'")).name==='日本財託（新）');
  await p.click('#klBack'); await w(); promptAns='見本エステート'; await p.click('#klAdd'); await saved();
  ok('顧客を登録でき、顧客のページが開く', !!(await one("select id from clients where name='見本エステート'"))&&(await T('.cphead')).includes('見本エステート'));
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
