// 通し：新しい案件 → 見積 → 受注 → 工程・打診 → 業者が受ける → 発注書 → 業者が承諾 → 完了報告 → 承認 → 請求書
// 台帳は物件のページ（タブ）だけで進める。業者は業者ページだけ。  ./reset.sh のあとに node e2e.js
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
const VT='toke2e00000000000000001';
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p).then(r=>r.rows);
  await q("update vendors set token=$1, active=true, type='外注', def_kind='清掃', close_day=31, taxable=true where id='V1'",[VT]);
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']});
  const errs=[]; const mk=async o=>{ const p=await b.newPage(o); p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',d=>d.accept()); return p; };
  const L=await mk({viewport:{width:1300,height:900}}), v=await mk({viewport:{width:390,height:800}});
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  const tabTo=async t=>{ await L.click(`.cptabs [data-cptab="${t}"]`); await L.waitForTimeout(400); };
  const todo=()=>L.$$eval('.cptodo span',a=>a.map(x=>x.textContent));
  const reopen=async(t)=>{ await L.reload(); await L.waitForTimeout(1500); if(t)await tabTo(t); };
  const me=async m=>{ await v.goto('http://localhost:8787/me.html?t='+VT); await v.waitForTimeout(1300); if(m){ await v.click(`[data-m="${m}"]`); await v.waitForTimeout(900); } };

  // 1) 新しい案件
  await L.goto('http://localhost:8787/'); await L.waitForTimeout(1500);
  await L.click('#addCase'); await L.fill('#ncProp','通しテスト 101'); await L.fill('#ncAddr','東京都港区1-2-3'); await L.fill('#ncKey','キーボックス 0000');
  await L.selectOption('#ncClient',{index:1}); await L.selectOption('#ncKind','清掃のみ'); await L.click('#askYes'); await L.waitForTimeout(800);
  const cid=await L.evaluate(()=>DB.cases.find(x=>x.prop==='通しテスト 101').id);
  await L.click(`[data-cpage="${cid}"]`); await L.waitForTimeout(500);
  ok('1 案件を作って物件のページを開く。次にやること＝見積', (await todo()).some(t=>t.includes('見積を作って')), await todo());

  // 2) 見積 → 受注
  await tabTo('見積・発注'); await L.click('[data-ested]'); await L.waitForTimeout(500);
  const row='tr[data-l]';
  await L.fill(`${row} [data-lf="name"]`,'ルームクリーニング'); await L.keyboard.press('Tab'); await L.waitForTimeout(400);
  await L.selectOption(`${row} [data-lf="kind"]`,'清掃'); await L.waitForTimeout(400);
  await L.fill(`${row} [data-lf="sell"]`,'30000'); await L.keyboard.press('Tab'); await L.waitForTimeout(400);
  await L.fill(`${row} [data-lf="price"]`,'20000'); await L.keyboard.press('Tab'); await L.waitForTimeout(500);
  await L.fill('[data-est="estAmt"]','30000'); await L.keyboard.press('Tab'); await L.waitForTimeout(500);
  await L.click('[data-estgo^="submit"]'); await L.waitForTimeout(400);
  await L.click('[data-estgo^="won"]'); await L.waitForTimeout(600);
  let cs=(await L.evaluate(id=>{ const x=DB.cases.find(c=>c.id===id); return [x.st,x.sales,x.estAmt]; },cid));
  ok('2 見積 30,000 → 見積提出 → 受注（売上に入る）', cs.join()==='受注,30000,30000', cs);

  // 3) 工程を足して、予定表から打診
  await tabTo('工程'); await L.click(`.kk[data-addkind="${cid}|清掃"]`); await L.waitForTimeout(500);
  const day=await L.evaluate(()=>{ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
  await L.click(`td.av[data-ask="長沼俊介|${day}"]`); await L.waitForTimeout(250); await L.click(`td.av[data-ask="長沼俊介|${day}"]`); await L.waitForTimeout(400);
  ok('3 日付を押すと、業者に伝わる内容（ルームクリーニング）が出る', (await L.textContent('.askits')).includes('ルームクリーニング'));
  await L.click('[data-askgo="ask"]'); await L.waitForTimeout(1800);
  await tabTo('概要'); ok('3 次にやること＝打診の返事待ち', (await todo()).some(t=>t.includes('打診中')), await todo());

  // 4) 業者：打診を見て、詳細を確かめて、受ける
  await me();
  const card=(await v.textContent('.askc')).replace(/\s+/g,' ');
  ok('4 業者ページに打診（物件・内容。金額なし）', card.includes('通しテスト 101')&&card.includes('ルームクリーニング')&&!card.includes('20,000'), card.slice(0,90));
  await v.click('.askc [data-info]'); await v.waitForTimeout(1200);
  ok('4 詳細に住所が出て、鍵情報は出ない', (t=>t.includes('東京都港区1-2-3')&&!t.includes('キーボックス'))(await v.textContent('#docBody')));
  await v.click('#docClose'); await v.click('.askc .ok'); await v.waitForTimeout(1000);

  // 5) 台帳：受諾 → 発注書を作る → 確かめて送付済に
  await reopen('工程');
  ok('5 工程に「受けてもらえた」', (await L.textContent('.askline.ok')).includes('受けてもらえた'));
  await L.click('.askline.ok [data-ocopen]'); await L.waitForTimeout(500);
  ok('5 「発注書を作る」で物件の中の見積・発注タブへ', await L.evaluate(()=>tab==='case'&&cpTab==='見積・発注'));
  await L.click('tr[data-l] .lchk'); await L.waitForTimeout(300); await L.click('#mkOrder'); await L.waitForTimeout(400);
  ok('5 発注の画面に、工程で決めた業者と日が入っている', (await L.$eval('#oqWho',x=>x.value))==='長沼俊介'&&(await L.$eval('#oqS',x=>x.value))===day);
  await L.click('#askYes'); await L.waitForTimeout(1500);
  ok('5 発注書（下書き）が開く。20,000＋消費税', (t=>t.includes('まだ下書き')&&t.includes('22,000'))(await L.textContent('.ob')));
  await L.click('#oSent'); await L.waitForTimeout(2000);
  const o=(await q("select no,st,token from orders where case_id=$1",[cid]))[0];
  ok('5 送付済にする', o&&o.st==='送付済', o&&o.st);

  // 6) 業者：発注書を開いて承諾
  await me('sched');
  ok('6 業者の工程に「発注書を見て承諾する」と、住所・鍵情報', (t=>t.includes('発注書を見て承諾する')&&t.includes('東京都港区1-2-3')&&t.includes('キーボックス 0000'))(await v.textContent('#list')));
  await v.click('a.olink.wait'); await v.waitForTimeout(1300);
  await v.fill('#by','テスト').catch(()=>{}); await v.click('#accept'); await v.waitForTimeout(1200);
  ok('6 承諾', (await q("select st from orders where case_id=$1",[cid]))[0].st==='承諾');

  // 7) 業者：完了報告
  await me('sched'); await v.click('.job [data-rep]'); await v.waitForTimeout(400);
  await v.fill('#rNote','完了しました'); await v.click('#rSend'); await v.waitForTimeout(1800);
  ok('7 完了報告', (await q("select st,base from reports where case_id=$1",[cid])).map(r=>r.st+r.base).join()==='報告済20000');

  // 8) 台帳：次にやること → 承認
  await reopen('概要');
  ok('8 次にやること＝完了報告を承認', (await todo()).some(t=>t.includes('完了報告が届いている')), await todo());
  await L.click('.cptodo[data-cptab="完了報告・請求"]'); await L.waitForTimeout(400);
  await L.click('[data-rok]'); await L.waitForTimeout(1800);
  ok('8 承認', (await q("select st from reports where case_id=$1",[cid]))[0].st==='承認');

  // 9) 業者：請求書を発行
  await me('bill'); await v.click('[data-issue]'); await v.waitForTimeout(1500);
  const inv=(await q("select subtotal,tax,total from invoices where who='長沼俊介'"))[0];
  ok('9 請求書（20,000＋消費税2,000＝22,000）', inv&&inv.subtotal===20000&&inv.tax===2000&&inv.total===22000, inv);
  await reopen('完了報告・請求');
  ok('9 台帳の物件のページに、業者の請求書が出る', (await L.textContent('.cpbody')).includes('請求書'));
  await tabTo('概要');
  const k=(await L.textContent('.cpgrid4')).replace(/\s+/g,' ');
  ok('最後：概要の売上 30,000・原価 20,000・粗利 10,000', k.includes('30,000')&&k.includes('20,000')&&k.includes('10,000'), k.slice(0,120));
  ok('最後：次にやること＝完了日を入れる', (await todo()).some(t=>t.includes('完了日を入れる')), await todo());
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
