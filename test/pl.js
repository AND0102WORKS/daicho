// 月次（損益の表）：月を押すと案件が出る・粗利率の低い案件・科目の編集（./reset.sh のあとに node pl.js）
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p).then(r=>r.rows);
  const now=new Date(), y=now.getFullYear(), m=now.getMonth()+1, fy=m>=5?y:y-1, M1=`${fy}-07`, M2=`${fy}-08`;
  await q(`insert into cases(id,client,prop,kind,st,live,ord,sales,plan,bill) values
    ('CA','日本財託','見本マンション 101','工事一式','完工',true,'済',1000000,'${M1}-20','${M1}'),
    ('CB','日本財託','見本コーポ 305','工事一式','完工',true,'済',400000,'${M1}-25','${M1}'),
    ('CC','日本財託','見本ハイツ 201','清掃のみ','完工',true,'済',200000,'${M2}-10','${M2}')`);
  await q(`insert into procs(id,case_id,kind,who,start_date,amt) values ('PA','CA','内装','FORCE-ONE','${M1}-15',600000),('PB','CB','内装','FORCE-ONE','${M1}-20',380000),('PC','CC','清掃','長沼俊介','${M2}-09',250000)`);
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1500,height:900}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',x=>x.accept());
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  const T=s=>p.textContent(s).then(t=>t.replace(/\s+/g,' '));
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  await p.evaluate(()=>{ tab='pl'; render(); }); await p.waitForTimeout(400);
  const cell=(row,mm)=>p.$eval(`.plt tr.${row} td[data-plm="${mm}"]`,x=>x.innerText.replace(/\s+/g,' '));
  ok('売上高：7月 1,400,000・8月 200,000', (await cell('sales',M1)).includes('1,400,000')&&(await cell('sales',M2)).includes('200,000'));
  ok('売上総利益：7月 420,000（30.0%）、8月は赤字 -50,000', (await cell('gross',M1)).includes('420,000 30.0%')&&(await cell('gross',M2)).includes('-50,000'), [await cell('gross',M1),await cell('gross',M2)]);
  ok('粗利率が30%未満の月（8月）が上の箱に出て、赤になる', (await T('.kpi .warnk')).includes('8月')&&!!(await p.$(`.plt tr.gross td[data-plm="${M2}"] small.low`))&&!(await p.$(`.plt tr.gross td[data-plm="${M1}"] small.low`)));
  ok('比率は金額と同じマスに出る（月の列は1本）', (await p.$$('.plt thead th')).length===14);
  // 月を押すと案件
  await p.click(`.plt thead th[data-plm="${M1}"]`); await p.waitForTimeout(400);
  let t=await T('.pldrill');
  ok('月を押すと、その月の案件が粗利率の低い順に出る', t.includes('7月の案件 2件')&&t.indexOf('見本コーポ 305')<t.indexOf('見本マンション 101'), t.slice(0,120));
  await p.click('.pldrill [data-plm]'); await p.waitForTimeout(300);
  ok('閉じられる', !(await p.$('.pldrill')));
  // 年度の粗利率の低い案件
  t=await T('.pllow');
  ok('粗利率の低い案件：年度で低い順（赤字の 201 → 5.0% の 305）。30%以上の案件は出ない', t.includes('2件')&&t.includes('赤字 1件')&&t.indexOf('見本ハイツ 201')<t.indexOf('見本コーポ 305')&&!t.includes('見本マンション 101'), t.slice(0,160));
  await p.click('.pllow [data-cpage="CC"]'); await p.waitForTimeout(400);
  ok('物件名を押すと案件ページへ', await p.evaluate(()=>tab==='case'&&cpCase==='CC'));
  // 科目の編集
  await p.evaluate(()=>{ tab='pl'; render(); }); await p.waitForTimeout(300);
  await p.click('[data-plsga="1"]'); await p.waitForTimeout(300);
  ok('内訳をひらくと既定の科目（販管費 16・原価 人件費（外注）＋2）', (await p.$$('.plt tr.dt')).length===19&&(await T('.plt')).includes('旅費交通費'));
  await p.click('#plEdit'); await p.waitForTimeout(300);
  await p.fill('.plrow[data-k="sga"][data-i="1"] input','旅費・交通費');
  await p.click('.plrow[data-k="sga"][data-i="2"] [data-pldel]'); await p.waitForTimeout(200);            // 燃料費を消す
  await p.click('[data-pladd="sga"]'); await p.waitForTimeout(200);
  await p.fill('.plrow[data-k="sga"]:last-of-type input','システム手数料');
  await p.click('.plrow[data-k="sga"][data-i="1"] [data-plmv="-1"]'); await p.waitForTimeout(200);       // 旅費・交通費 を先頭へ
  await p.click('#askYes'); await p.waitForTimeout(1800);
  const st=(await q("select value from settings where key='pl_items'"))[0];
  const names=st?st.value.sga.map(x=>x.name):[];
  ok('科目の編集が保存される（名前の変更・削除・追加・並べ替え）', names[0]==='旅費・交通費'&&names[1]==='人件費（社内）'&&names.indexOf('燃料費')<0&&names[names.length-1]==='システム手数料'&&names.length===16, names);
  await p.reload(); await p.waitForTimeout(1500);
  await p.evaluate(()=>{ tab='pl'; plSga=true; render(); }); await p.waitForTimeout(400);
  t=await T('.plt');
  ok('読み直しても、編集した科目で表が出る', t.includes('旅費・交通費')&&t.includes('システム手数料')&&!t.includes('燃料費'));
  await p.click('#plEdit'); await p.waitForTimeout(300);
  ok('人件費（外注）は変えられない科目として出る', (await T('.plrow.fix')).includes('人件費（外注）'));
  await p.click('#askNo');
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
