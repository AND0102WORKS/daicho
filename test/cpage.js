// 案件ページ（物件が主役）：物件の下のタブで、概要・案件情報・見積/発注・工程・写真・完了報告/請求（./reset.sh のあとに node cpage.js）
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p);
  await q("insert into vendors(id,name,full_name,type,def_kind) values ('V3','國吉','國吉','専属','清掃') on conflict do nothing");
  await q("insert into cases(id,client,prop,kind,st,live,ord,sales,memo) values ('C2','クレアスレント','コンシェリア恵比寿 102','清掃のみ','受注',true,'未',50000,'') on conflict do nothing");
  await q("insert into lines(id,case_id,no,name,qty,unit,sell,price,kind) values ('LC1','C1302',1,'ルームクリーニング',1,'式',30000,20000,'清掃'),('LC2','C2',1,'エアコン洗浄',2,'台',8000,5000,'清掃') on conflict do nothing");
  await q("update procs set who='', start_date=null where id='P1'");
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1300,height:900},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',x=>x.accept());
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  const T=s=>p.textContent(s).then(t=>t.replace(/\s+/g,' '));
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  await p.click('[data-cpage="C1302"]'); await p.waitForTimeout(400);
  ok('物件名を押すと案件ページ（概要）が開き、タブが6つ', (await p.$$eval('.cptabs button',a=>a.map(x=>x.childNodes[0].textContent)).then(a=>a.join('|')))==='概要|案件情報|見積・発注|工程|写真|完了報告・請求');
  let t=await T('.cpbody');
  ok('概要：次にやること（住所・鍵が未入力／業者が決まっていない）', t.includes('次にやること')&&t.includes('鍵情報が未入力')&&t.includes('清掃の業者が決まっていない'), t.slice(0,200));
  await p.screenshot({path:__dirname+'/cpage1.png'});
  // 次にやること → 案件情報 へ
  await p.click('.cptodo[data-cptab="案件情報"]'); await p.waitForTimeout(300);
  ok('「次にやること」を押すとそのタブへ', (await p.$eval('.cptabs button.on',x=>x.childNodes[0].textContent))==='案件情報');
  await p.fill('[data-cf="addr"]','東京都江東区豊洲5-1'); await p.keyboard.press('Tab'); await p.waitForTimeout(300);
  await p.fill('[data-cf="keyInfo"]','キーボックス 1234'); await p.keyboard.press('Tab'); await p.waitForTimeout(1800);
  const db=(await q("select addr,key_info from cases where id='C1302'")).rows[0];
  ok('案件情報：入れると保存される', db.addr==='東京都江東区豊洲5-1'&&db.key_info==='キーボックス 1234', db);
  await p.screenshot({path:__dirname+'/cpage2.png'});
  // 見積・発注
  await p.click('.cptabs [data-cptab="見積・発注"]'); await p.waitForTimeout(400);
  ok('見積・発注：この物件の明細が出る', await p.$eval('tr[data-l="LC1"] [data-lf="name"]',x=>x.value)==='ルームクリーニング'&&!(await p.$('tr[data-l="LC2"]')));
  await p.fill('tr[data-l="LC1"] [data-lf="price"]','21000'); await p.keyboard.press('Tab'); await p.waitForTimeout(600);
  ok('明細を直すと、案件ページのまま保存される', await p.evaluate(()=>tab==='case'&&DB.lines.find(l=>l.id==='LC1').price===21000));
  await p.screenshot({path:__dirname+'/cpage3.png'});
  // 工程：日付を押して工程に入れる
  await p.click('.cptabs [data-cptab="工程"]'); await p.waitForTimeout(500);
  const day=await p.$eval('.avwrap td.av[data-ask^="國吉|"]',x=>x.dataset.ask);
  await p.click(`td.av[data-ask="${day}"]`); await p.waitForTimeout(250); await p.click(`td.av[data-ask="${day}"]`); await p.waitForTimeout(300); await p.click('[data-askgo="ok"]'); await p.waitForTimeout(400);
  ok('工程：予定表の日付を押すと、この物件の工程に入る（案件ページのまま）', await p.evaluate(()=>tab==='case'&&DB.procs.find(x=>x.id==='P1').who==='國吉'));
  await p.screenshot({path:__dirname+'/cpage4.png'});
  await p.click('[data-ocopen="C1302"]'); await p.waitForTimeout(400);
  ok('「発注へ」は、物件の中の見積・発注タブに切り替わる', await p.evaluate(()=>tab==='case'&&cpTab==='見積・発注'));
  // 別の物件に切り替えても、取り違えない
  await p.click('#cpBack'); await p.waitForTimeout(300); await p.click('[data-cpage="C2"]'); await p.waitForTimeout(400);
  ok('別の物件を開くと概要から', await p.evaluate(()=>cpCase==='C2'&&cpTab==='概要')&&(await T('.cphead h2'))==='コンシェリア恵比寿 102');
  await p.click('.cptabs [data-cptab="見積・発注"]'); await p.waitForTimeout(400);
  ok('別の物件の見積・発注には、その物件の明細だけ', !!(await p.$('tr[data-l="LC2"]'))&&!(await p.$('tr[data-l="LC1"]')));
  await p.fill('tr[data-l="LC2"] [data-lf="price"]','5500'); await p.keyboard.press('Tab'); await p.waitForTimeout(1800);
  const dl=(await q("select id,price from lines where id in ('LC1','LC2') order by id")).rows.map(r=>r.id+':'+r.price).join(',');
  ok('直したのは開いている物件の行だけ', dl==='LC1:21000,LC2:5500', dl);
  await p.click('.cptabs [data-cptab="工程"]'); await p.waitForTimeout(400);
  ok('工程タブも、開いている物件のもの', await p.evaluate(()=>pCase==='C2'));
  // 写真・完了報告／請求・再読み込み
  await p.click('.cptabs [data-cptab="写真"]'); await p.waitForTimeout(300); ok('写真タブ', (await T('.cpbody')).includes('パソコンから入れる'));
  await p.click('.cptabs [data-cptab="完了報告・請求"]'); await p.waitForTimeout(300); ok('完了報告・請求タブ', (await T('.cpbody')).includes('請求・支払'));
  await p.reload(); await p.waitForTimeout(1500);
  ok('再読み込みしても、同じ物件・同じタブ', await p.evaluate(()=>tab==='case'&&cpCase==='C2'&&cpTab==='完了報告・請求'));
  // 上の大きなタブも今までどおり使える
  await p.click('#tabs [data-t="proc"]'); await p.waitForTimeout(400); ok('上の「工程を組む」タブも今までどおり', await p.evaluate(()=>tab==='proc')&&!!(await p.$('.avblock, .card')));
  await p.click('#tabs [data-t="order"]'); await p.waitForTimeout(400); ok('上の「見積・発注」タブも今までどおり', await p.evaluate(()=>tab==='order'));
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
