const {chromium}=require('playwright');const fs=require('fs');const {spawn}=require('child_process');
(async()=>{
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore'}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const pg=await b.newPage({viewport:{width:1500,height:900}});
  pg.on('pageerror',e=>console.log('PAGEERR',e.message)); pg.on('console',m=>{ if(m.type()==='error')console.log('CONSOLE',m.text()); });
  const html=fs.readFileSync('../site/index.html','utf8').replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/,'');
  await pg.goto('http://localhost:8787/'); await pg.waitForTimeout(1500);
  const st=await pg.evaluate(()=>({me:ME&&ME.role,cases:DB.cases.length,procs:DB.procs.length,vend:DB.vendors.length,inbox:INBOX&&INBOX.length,state:dbState,tab}));
  console.log('loaded',st);
  // 1) 案件の欄を直す
  await pg.evaluate(()=>{const c=DB.cases.find(x=>x.id==='C1302'); c.memo='テスト備考'; c.plan='2026-11-22'; c.keyx='有'; save();});
  await pg.waitForTimeout(1200);
  // 2) 発注書の取り込み（inbox.po_lines）
  await pg.evaluate(()=>{tab='order';oFilter='すべて';oCase='C1302';render();});
  await pg.click('#impPO'); await pg.waitForTimeout(300);
  console.log('after import lines:',await pg.evaluate(()=>linesOf('C1302').map(l=>l.name+':'+l.qty+':'+l.no).join(' | ')));
  await pg.waitForTimeout(1200);
  // 3) 1行消す
  await pg.evaluate(()=>{const l=linesOf('C1302')[0]; DB.lines=DB.lines.filter(x=>x.id!==l.id); save();});
  await pg.waitForTimeout(1200);
  // 4) 発注を作る（採番）
  await pg.evaluate(()=>{linesOf('C1302').forEach(l=>oSel[l.id]=true); render();});
  await pg.click('#mkOrder'); await pg.waitForTimeout(200); await pg.selectOption('#oqWho','長沼俊介'); await pg.click('#askYes'); await pg.waitForTimeout(1500);
  console.log('orders:',await pg.evaluate(()=>DB.orders.map(o=>o.no+'/'+o.who+'/'+o.st).join(',')),'state:',await pg.evaluate(()=>dbState));
  // 5) 再読み込みして確認
  await pg.goto('http://localhost:8787/'); await pg.waitForTimeout(1500);
  console.log('after reload:',await pg.evaluate(()=>({memo:DB.cases.find(x=>x.id==='C1302').memo,plan:DB.cases.find(x=>x.id==='C1302').plan,keyx:DB.cases.find(x=>x.id==='C1302').keyx,
    lines:linesOf('C1302').map(l=>l.name+':'+l.qty+':'+l.no+':'+(l.cut?'cut':'')+':'+l.order).join(' | '),orders:DB.orders.map(o=>o.no+'/'+o.who+'/'+o.start+'~'+o.end),procs:DB.procs.map(p=>p.id+':'+p.kind+':'+p.date+':'+p.order).join(' | ')})));
  await pg.screenshot({path:'v4.png'});
  await b.close(); srv.kill();
})();
