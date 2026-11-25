// 協力業者のメニュー：一覧・業者のページ・招待・利用中・登録・使用停止（./reset.sh のあとに node vendor.js）
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
const VT='aa11bb22cc33dd44ee55ff66';
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p).then(r=>r.rows);
  const one=async(s,p)=>(await q(s,p))[0];
  await q("update vendors set token=$1, active=true where id='V1'",[VT]);
  await q("update procs set amt=22000, start_date=current_date where id='P1'");
  await q("insert into reports(id,org,proc_id,case_id,who,done_date,base,extra,st) values ('RV','hq','P1','C1302','長沼俊介',current_date,22000,0,'承認')");
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',x=>x.accept());
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  const T=s=>p.textContent(s).then(t=>t.replace(/\s+/g,' ')), saved=()=>p.waitForTimeout(1700);
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  await p.evaluate(()=>{ window.open=(u)=>{ window.__opened=u; return null; }; });
  ok('左のメニューに「協力業者」がある', !!(await p.$('#tabs [data-t="vendor"]')));
  await p.click('#tabs [data-t="vendor"]'); await p.waitForTimeout(400);
  let t=await T('#main');
  ok('一覧：名前・区分・職種・手配中・今月の発注・業者ページの状態', t.includes('長沼俊介')&&t.includes('専属')&&t.includes('1件')&&t.includes('22,000')&&t.includes('未招待'), t.slice(0,160));
  ok('一覧に入力欄は無い（ここでは書き換えない）', (await p.$$('#main table input, #main table select')).length===0);
  await p.screenshot({path:__dirname+'/vendor1.png'});
  // 招待
  await p.click('tr[data-vn="長沼俊介"] [data-vinvite]'); await p.waitForTimeout(300);
  ok('招待：文面に業者ページのリンクが入っている', (await p.inputValue('#vMsg')).includes('me.html?t='+VT));
  await p.click('[data-vgo="line"]'); await saved();
  ok('LINE で送ると「招待済み」になり、日時が残る', (await T('tr[data-vn="長沼俊介"]')).includes('招待済み')&&!!(await one("select invited_at from vendors where id='V1'")).invited_at&&String(await p.evaluate(()=>window.__opened)).startsWith('https://line.me/'));
  // 業者が開く → 利用中
  const v=await b.newPage({viewport:{width:390,height:800}}); v.on('pageerror',e=>errs.push('me:'+e.message));
  await v.goto('http://localhost:8787/me.html?t='+VT+'&s=1'); await v.waitForTimeout(1200);
  ok('台帳から確かめに開いた（&s=1）だけでは「利用中」にならない', (await one("select seen_at from vendors where id='V1'")).seen_at===null);
  await v.goto('http://localhost:8787/me.html?t='+VT); await v.waitForTimeout(1500);
  ok('業者が業者ページを開くと、開いた日時が残る', !!(await one("select seen_at, first_seen_at from vendors where id='V1'")).seen_at);
  await p.evaluate(()=>dbResync('test')); await p.waitForTimeout(900);
  ok('台帳の一覧が「利用中」に変わる', (await T('tr[data-vn="長沼俊介"]')).includes('利用中'));
  // 業者のページ
  await p.click('tr[data-vn="長沼俊介"] td.nm'); await p.waitForTimeout(400);
  t=await T('#main');
  ok('行を押すと業者のページ：基本情報・取引条件・手配中の現場', t.includes('← 協力業者')&&t.includes('基本情報')&&t.includes('取引条件')&&t.includes('手配中の現場')&&t.includes('プレール'), t.slice(0,120));
  await p.fill('[data-vf="contact"]','見本 一郎'); await p.keyboard.press('Tab'); await p.waitForTimeout(600);
  await p.fill('[data-vf="addr"]','東京都江戸川区見本1-2-3'); await p.keyboard.press('Tab'); await p.waitForTimeout(600);
  await p.selectOption('[data-vf="taxable"]','0'); await saved();
  const dbv=await one("select contact,addr,taxable from vendors where id='V1'");
  ok('担当者・住所・免税が保存される', dbv.contact==='見本 一郎'&&dbv.addr==='東京都江戸川区見本1-2-3'&&dbv.taxable===false, dbv);
  await p.screenshot({path:__dirname+'/vendor2.png'});
  await p.click('[data-vptab="支払"]'); await p.waitForTimeout(300); t=await T('.cpbody');
  ok('支払のタブ：月ごとの発注金額と完了報告', t.includes('22,000')&&t.includes('完了報告（1件）')&&t.includes('承認済み'), t.slice(0,160));
  await p.click('[data-vptab="休み"]'); await p.waitForTimeout(300);
  ok('専属の職人には休みのタブがある', (await T('.cpbody')).includes('休みを入れる'));
  // 記録のある業者は消せない → 使用停止
  await p.click('[data-vptab="基本情報"]'); await p.waitForTimeout(300);
  ok('工程・完了報告のある業者には「削除」が出ない', !(await p.$('[data-delv]'))&&!!(await p.$('[data-vactive="0"]')));
  await p.click('[data-vactive="0"]'); await saved();
  ok('使用停止にできる（記録は残る）', (await one("select active from vendors where id='V1'")).active===false&&(await one("select count(*)::int n from procs where who='長沼俊介'")).n===1);
  await p.click('#vpBack'); await p.waitForTimeout(300);
  ok('使用停止の業者は一覧から外れる', !(await p.$('tr[data-vn="長沼俊介"]')));
  await p.selectOption('#vSt','stop'); await p.waitForTimeout(300);
  ok('「使用停止」で絞ると出る', !!(await p.$('tr[data-vn="長沼俊介"]')));
  await p.selectOption('#vSt',''); await p.waitForTimeout(300);
  // 登録
  await p.click('#vAdd'); await p.waitForTimeout(300); await p.fill('#vaName','見本リペア'); await p.selectOption('#vaKind','リペア補修'); await p.click('#askYes'); await saved();
  const nv=await one("select id,name,def_kind,token is not null tk from vendors where name='見本リペア'");
  ok('名前と職種だけで登録でき、業者のページが開く。リンクは DB が作る', !!nv&&nv.def_kind==='リペア補修'&&nv.tk&&(await T('.cphead')).includes('見本リペア'), nv);
  ok('記録の無い業者には「削除」が出る', !!(await p.$('[data-delv]')));
  // マスタ
  await p.click('#tabs [data-t="master"]'); await p.waitForTimeout(300);
  ok('マスタには顧客と単価が残り、発注先は「協力業者」へ案内', (await T('#main')).includes('発注先は「協力業者」へ')&&!(await p.$('tr[data-v]')));
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
