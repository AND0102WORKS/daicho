// 明細の表の切り替え（見積／発注／まとめ）と、原価の数量・単位（./reset.sh のあとに node modes.js）
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p);
  await q("insert into lines(id,case_id,no,name,qty,unit,sell,price,kind) values ('LM1','C1302',1,'クロス貼替',20,'㎡',1500,1000,'内装') on conflict do nothing");
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',x=>x.accept());
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  await p.evaluate(()=>{ tab='order'; oCase='C1302'; oView='make'; render(); }); await p.waitForTimeout(400);
  const L=()=>p.evaluate(()=>{ const l=DB.lines.find(x=>x.id==='LM1'); return {qty:l.qty,unit:l.unit,cqty:l.cqty,cunit:l.cunit,price:l.price,sell:lineSell(l),amt:lineAmt(l)}; });
  await p.click('[data-omode="見積"]'); await p.waitForTimeout(300);
  ok('見積の形：販売と原価の両方に数量・単位・単価', await p.$$eval('tr[data-l="LM1"] [data-lf]',a=>a.map(x=>x.dataset.lf).join(','))==='spec,name,kind,qty,unit,sell,cqty,cunit,price,memo');
  let l=await L(); ok('最初は原価の数量＝販売の数量（20×1,000＝20,000）', l.amt===20000&&l.sell===30000, l);
  await p.screenshot({path:__dirname+'/modes-est.png',clip:{x:0,y:290,width:1440,height:330}});
  // 発注は一式に変える
  await p.fill('tr[data-l="LM1"] [data-lf="cqty"]','1'); await p.keyboard.press('Tab'); await p.waitForTimeout(500);
  await p.selectOption('tr[data-l="LM1"] [data-lf="cunit"]','式'); await p.waitForTimeout(500);
  await p.fill('tr[data-l="LM1"] [data-lf="price"]','18000'); await p.keyboard.press('Tab'); await p.waitForTimeout(600);
  l=await L(); ok('原価だけ 1式×18,000 に。販売は 20㎡×1,500 のまま', l.amt===18000&&l.sell===30000&&+l.qty===20&&l.unit==='㎡'&&l.cunit==='式', l);
  await p.click('[data-omode="発注"]'); await p.waitForTimeout(300);
  ok('発注の形：原価の数量・単位・単価と区分', await p.$$eval('tr[data-l="LM1"] [data-lf]',a=>a.map(x=>x.dataset.lf).join(','))==='spec,name,kind,cqty,cunit,price,memo');
  await p.screenshot({path:__dirname+'/modes-order.png',clip:{x:0,y:290,width:1440,height:330}});
  // 発注を作る → 発注書・業者ページは原価の数量・単位
  await p.evaluate(()=>{ oSel={LM1:true}; render(); }); await p.click('#mkOrder'); await p.waitForTimeout(300);
  await p.selectOption('#oqWho','長沼俊介'); await p.click('#askYes'); await p.waitForTimeout(1500);
  const sheet=await p.textContent('.ob');
  ok('発注書は 1式 18,000', sheet.includes('18,000')&&/1\s*式/.test(sheet.replace(/\s+/g,' ')), sheet.replace(/\s+/g,' ').slice(160,260));
  await p.waitForTimeout(1500);
  const o=(await q("select token from orders order by created_at desc limit 1")).rows[0];
  const ov=(await q("select lines from order_view($1)",[o.token])).rows[0].lines[0];
  ok('業者の発注書（order_view）も 1式×18,000', +ov.qty===1&&ov.unit==='式'&&+ov.price===18000, ov);
  const db=(await q("select qty::float, unit, cost_qty::float, cost_unit, price from lines where id='LM1'")).rows[0];
  ok('データベース：販売 20㎡、原価 1式', db.qty===20&&db.unit==='㎡'&&db.cost_qty===1&&db.cost_unit==='式', db);
  await p.click('#askNo').catch(()=>{}); await p.click('[data-omode="まとめ"]'); await p.waitForTimeout(300);
  ok('まとめの形：入力欄なしで販売・原価・粗利', (await p.$$('tr[data-l="LM1"] [data-lf]')).length===0&&(await p.textContent('tr[data-l="LM1"]')).includes('12,000'));
  await p.screenshot({path:__dirname+'/modes-sum.png',clip:{x:0,y:290,width:1440,height:300}});
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
