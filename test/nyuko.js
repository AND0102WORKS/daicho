// 案件の入口：届いた依頼元の発注書は、人が確かめてから「いまある案件」にくっつける（./reset.sh のあとに node nyuko.js）
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p).then(r=>r.rows);
  const one=async(s,p)=>(await q(s,p))[0];
  // 岸本さんが先に立てた案件（立会依頼・一覧表の時点。まだ受注前）
  await q("insert into cases(id,client,prop,kind,st,live,sales) values ('CN1','日本財託','見本ハイツ 201','清掃のみ','現調済',true,0),('CN2','日本財託','見本コーポ 102','工事一式','受付',true,0),('CN3','クレアスレント','見本ハイツ 201','清掃のみ','完工',true,0)");
  await q("update cases set done=current_date where id='CN3'");
  // 依頼元の発注書（あとから届く）
  await q(`insert into inbox(key,case_no,client,prop,room,net,plan,items,po_lines) values
    ('KN1','AW-2611-0101','日本財託','見本ハイツ','201',45000,'2026-12-10','ルームクリーニング','[{"name":"ルームクリーニング","qty":1,"unit":"式","price":45000}]'),
    ('KN2','AW-2611-0102','日本財託','見本コーポ102号室','',80000,null,'クロス貼替',null),
    ('KN3','AW-2611-0103','日本財託','見本あたらしい','305',30000,null,'清掃',null)`);
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',x=>x.accept());
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  const T=s=>p.textContent(s).then(t=>t.replace(/\s+/g,' ')), saved=()=>p.waitForTimeout(1800), w=()=>p.waitForTimeout(400);
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(2200);
  const n0=(await one("select count(*)::int n from cases")).n;
  ok('開いただけでは、勝手にくっつけない・案件も増えない', (await one("select coalesce(recv,'') r, sales from cases where id='CN1'")).r===''&&n0===4, n0);
  ok('上の帯に「依頼元の発注書が3件 届いている」と「確かめて取り込む」', (await T('.selbar')).includes('依頼元の発注書が 3件 届いている')&&(await T('#impInbox')).includes('確かめて取り込む'));
  await p.click('#impInbox'); await w();
  const cards=await p.$$eval('.ibx',a=>a.map(x=>({t:x.querySelector('.ibh').textContent.replace(/\s+/g,' '),v:x.querySelector('.ibsel').value,opts:[...x.querySelectorAll('.ibsel option')].map(o=>o.value)})));
  ok('ぴったり同じ物件：その案件を最初から選んである（完工済みの同名の案件は候補に出ない）', cards[0].v==='m:CN1'&&cards[0].t.includes('同じ物件の案件がある')&&cards[0].opts.indexOf('m:CN3')<0, cards[0]);
  ok('名前が近い物件：候補に出して「確かめてください」', cards[1].v==='m:CN2'&&cards[1].t.includes('名前が近い案件がある'), cards[1]);
  ok('見つからない物件：「新しい案件として作る」を選んであり、赤い印。ほかの案件からも選べる', cards[2].v==='new'&&cards[2].t.includes('台帳に同じ物件が見つからない')&&cards[2].opts.indexOf('m:CN1')>=0, cards[2]);
  await p.screenshot({path:__dirname+'/nyuko1.png'});
  // 同じ案件を2回選ぶと取り込めない
  await p.selectOption('.ibx[data-i="2"] .ibsel','m:CN1'); await w();
  ok('同じ案件を2回選ぶと、注意が出て取り込めない', (await T('#ibsum')).includes('同じ案件を2回選んでいます')&&await p.$eval('#askYes',x=>x.disabled));
  await p.selectOption('.ibx[data-i="2"] .ibsel','later'); await w();
  await p.click('#askYes'); await saved();
  const c1=await one("select recv,sales,st,want::text w from cases where id='CN1'"), c2=await one("select recv,sales,st from cases where id='CN2'"), n1=(await one("select count(*)::int n from cases")).n;
  ok('くっつけた案件に、受注額・希望日が入り、状態が「受注」に進む', c1.recv==='KN1'&&c1.sales===45000&&c1.st==='受注'&&c1.w==='2026-12-10'&&c2.recv==='KN2'&&c2.sales===80000&&c2.st==='受注', {c1,c2});
  ok('案件は増えない（同じ物件が2つできない）。「あとで」にした1件は残る', n1===n0&&(await T('.selbar')).includes('依頼元の発注書が 1件 届いている'), n1);
  // 残りを新しい案件として取り込む
  await p.click('#impInbox'); await w(); await p.selectOption('.ibsel','new'); await p.click('#askYes'); await saved();
  const nw=await one("select prop,client,st,sales,recv from cases where recv='KN3'");
  ok('見つからなかった発注書は、新しい案件として作れる', !!nw&&nw.prop==='見本あたらしい 305'&&nw.st==='受注'&&nw.sales===30000&&(await one("select count(*)::int n from cases")).n===n0+1, nw);
  // くっつけた案件で、依頼元の明細を取り込める
  await p.evaluate(()=>{ tab='order'; oFilter='すべて'; oCase='CN1'; render(); }); await w();
  ok('くっつけた案件の「見積・発注」で、依頼元の発注書の明細を取り込める', !!(await p.$('#impPO')));
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
