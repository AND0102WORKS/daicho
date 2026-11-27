// 発注を業者に知らせる：業者ページの「通知を受け取る」・端末の登録・発注したときの知らせと記録（./reset.sh のあとに node notify.js）
// 実際に携帯へ届くところ（外の通知の仕組み）とメールの送信は、ここでは確かめられない。送る役（Edge Function）はまねで置き換えている
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
const VT='aa11bb22cc33dd44ee55ff66';
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p).then(r=>r.rows);
  const one=async(s,p)=>(await q(s,p))[0];
  await q("update vendors set token=$1, active=true where id='V1'",[VT]);
  await q("insert into lines(id,case_id,name,qty,unit,sell,price,kind) values ('LN1','C1302','ルームクリーニング',1,'式',30000,22000,'清掃'),('LN2','C1302','クロス貼替',1,'式',50000,40000,'内装')");
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']});
  const errs=[]; const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  // 業者ページ
  const vc=await b.newContext({viewport:{width:390,height:800},deviceScaleFactor:2,permissions:['notifications']}); const v=await vc.newPage();   /* 何もしないと「ブロック」の扱いになるので、許可できる状態にして開く */ v.on('pageerror',e=>errs.push('me:'+e.message));
  await v.goto('http://localhost:8787/me.html?t='+VT); await v.waitForTimeout(1800);
  ok('業者ページに通知の案内が出る（確かめ用のブラウザは通知を許可できないので「ブロックされています」になる）', await v.$eval('#pushBar',x=>!x.hidden&&(x.textContent.includes('通知を受け取る')||x.textContent.includes('通知がブロック'))).catch(()=>false));
  await v.screenshot({path:__dirname+'/notify1.png'});
  await v.click('[data-m="help"]'); await v.waitForTimeout(400);
  const hv=await v.$eval('#helpView',x=>({shown:!x.hidden,svg:x.querySelectorAll('svg').length,txt:x.textContent}));
  ok('業者ページのメニューに「使い方」：最初にホーム画面に出す手順（図つき・iPhone と Android）と、発注・工程・完了報告・請求の使い方', hv.shown&&hv.svg===10&&['ホーム画面に出す','ホーム画面に追加','通知を受け取る','発注が届いたら','完了報告','請求する','困ったとき'].every(k=>hv.txt.includes(k)), hv.svg);
  await v.screenshot({path:__dirname+'/manual1.png',fullPage:true});
  await v.click('[data-hos="ios"]'); await v.waitForTimeout(200); ok('iPhone と Android を切り替えられる', await v.$eval('#hosIos',x=>!x.hidden)&&await v.$eval('#hosAnd',x=>x.hidden));
  await (await v.$('#helpView .hsec')).screenshot({path:__dirname+'/manual2.png'});
  const r1=await v.evaluate(t=>sb.rpc('push_subscribe',{p_token:t,p_endpoint:'https://push.example.com/send/abc',p_p256dh:'KEY',p_auth:'AUTH',p_ua:'test'}).then(x=>x.data),VT);
  const r2=await v.evaluate(()=>sb.rpc('push_subscribe',{p_token:'wrong',p_endpoint:'https://push.example.com/send/zzz',p_p256dh:'KEY',p_auth:'AUTH',p_ua:'test'}).then(x=>x.data));
  const r3=await v.evaluate(t=>sb.rpc('push_subscribe',{p_token:t,p_endpoint:'http://evil.example.com/x',p_p256dh:'KEY',p_auth:'AUTH',p_ua:'test'}).then(x=>x.data),VT);
  const rows=await q("select vendor_id,endpoint from vendor_push");
  ok('端末の登録：正しいリンクなら入り、違うリンク・https でない宛先は入らない', r1===true&&r2===false&&r3===false&&rows.length===1&&rows[0].vendor_id==='V1', {r1,r2,r3,rows});
  const s1=await b.newPage(); await s1.goto('http://localhost:8787/me.html?t='+VT+'&s=1'); await s1.waitForTimeout(1500);
  ok('台帳から確かめに開いた（&s=1）ときは、通知の案内を出さない', await s1.$eval('#pushBar',x=>x.hidden)); await s1.close();
  // DB の守り
  const asRole=async(role,sql)=>{ await q('begin'); await q("select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000aa',true)"); await q('set local role '+role); let r; try{ r=await q(sql); }catch(e){ r={err:e.message}; } await q('rollback'); return r; };
  const a1=await asRole('authenticated','select vendor_id from vendor_push'), a2=await asRole('authenticated','select endpoint,auth from vendor_push'), a3=await asRole('anon','select vendor_id from vendor_push'), a4=await asRole('authenticated',"insert into notify_log(kind) values ('push')");
  ok('DB：台帳の人は台数だけ見られ、端末の宛先・鍵は見られない。ログイン無しは何も見られない。記録は書き換えられない', Array.isArray(a1)&&a1.length===1&&!!a2.err&&!!a3.err&&!!a4.err, {a1,a2:a2.err,a3:a3.err,a4:a4.err});
  // 台帳
  const p=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2}); p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',x=>x.accept());
  const T=s=>p.textContent(s).then(t=>t.replace(/\s+/g,' ')), w=()=>p.waitForTimeout(450);
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  await p.evaluate(()=>{ tab='vendor'; vpId='V1'; vpTab='基本情報'; render(); }); await w();
  ok('協力業者のページ：知らせ方（携帯の通知 設定済み 1台・メール 未登録）', (await T('.cpbody')).includes('携帯の通知 設定済み（1台）・メール 未登録'));
  const mk=async(lid,who)=>{ await p.evaluate(l=>{ document.querySelectorAll('.ask').forEach(x=>x.remove()); tab='order'; oFilter='すべて'; oCase='C1302'; oSel={}; oSel[l]=true; render(); },lid); await w();
    await p.click('#mkOrder'); await w(); await p.selectOption('#oqWho',who); await p.click('#askYes'); await p.waitForTimeout(1500); };
  await mk('LN1','長沼俊介');
  ok('発注書（下書き）に、押すと自動で知らせること・届き方が出る', (await T('.ob')).includes('押すと自動で業者に知らせる（携帯の通知 設定済み（1台）・メール 未登録）'));
  await p.screenshot({path:__dirname+'/notify0.png'});
  await p.click('#oSent'); await p.waitForTimeout(4500);
  const lg=await q("select kind,ok,detail,vendor_id from notify_log");
  ok('「発注」を押すと業者に知らせ、記録が残る', lg.length===1&&lg[0].kind==='push'&&lg[0].ok&&lg[0].vendor_id==='V1'&&(await T('#toast')).includes('携帯の通知（1台） で知らせた'), {lg,toast:await T('#toast').catch(()=>'')});
  await p.screenshot({path:__dirname+'/notify2.png'});
  const oid=(await one("select id from orders where who='長沼俊介'")).id;
  await p.evaluate(id=>orderSheet(id),oid); await w();
  ok('発注書に「いつ・何で知らせたか」が出る', /\d+\/\d+ \d\d:\d\d に 携帯の通知 で知らせた/.test(await T('.ob')), (await T('.ob')).slice(-160));
  await p.screenshot({path:__dirname+'/notify3.png'});
  // 通知もメールも無い業者
  await mk('LN2','FORCE-ONE'); await p.click('#oSent'); await p.waitForTimeout(4500);
  ok('携帯の通知もメールも無い業者は、「リンクをコピー」で知らせるよう案内する', (await T('#toast')).includes('未設定')&&(await T('#toast')).includes('リンクをコピー')&&(await q("select 1 from notify_log")).length===1, await T('#toast').catch(()=>''));
  // 止める
  const r4=await v.evaluate(t=>sb.rpc('push_unsubscribe',{p_token:t,p_endpoint:'https://push.example.com/send/abc'}).then(x=>x.data),VT);
  ok('業者が「止める」と、端末の登録が消える', (await q("select 1 from vendor_push")).length===0, r4);
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
