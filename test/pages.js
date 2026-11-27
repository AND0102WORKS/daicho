const {chromium}=require('playwright');const {spawn}=require('child_process');
// テスト用データ：職人（長沼）のリンクと、今日の工程・鍵情報、業者向けの発注1件を用意する（reset.sh の後に単独で動く）
const {Client}=require('pg');
const VT='284b932133d3639bdbddf609', OT='6a5d0b50c23f7f77b31d1b68', OT2='7b6e1c61d34e8a8c42c2e279';
const VT2='5c1d9e0a7b3f2e6d4a8c1b90';   // 業者（FORCE-ONE）の業者ページ
async function prep(){ const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect();
  await c.query("update vendors set token=$1, active=true where id='V1'",[VT]);
  await c.query("update procs set start_date=current_date, end_date=current_date, prog='' where id='P1'");
  await c.query("update cases set key_info='キーボックス 1234' where id='C1302'");
  await c.query("insert into orders(id,no,case_id,who,kind,start_date,st,token) values ('OPG','AW-H9001','C1302','FORCE-ONE','内装',current_date,'送付済',$1) on conflict (id) do update set st='送付済', token=excluded.token",[OT]);
  await c.query("update vendors set token=$1, active=true where id='V2'",[VT2]);
  await c.query("insert into orders(id,no,case_id,who,kind,start_date,st,token) values ('OPG3','AW-H9003','C1302','FORCE-ONE','内装',current_date,'下書き','draft-not-shown') on conflict (id) do nothing");
  // 免税事業者への発注（消費税を足さない）
  await c.query("insert into orders(id,no,case_id,who,kind,start_date,st,token,taxable) values ('OPG2','AW-H9002','C1302','FORCE-ONE','内装',current_date,'送付済',$1,false) on conflict (id) do update set taxable=false, token=excluded.token",[OT2]);
  await c.end(); }
(async()=>{await prep();const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore'});await new Promise(r=>setTimeout(r,800));
const b=await chromium.launch({args:['--no-proxy-server']});
const p=await b.newPage({viewport:{width:390,height:760},deviceScaleFactor:2});p.on('pageerror',e=>console.log('PAGEERR',e.message));
await p.goto('http://localhost:8787/me.html?t=284b932133d3639bdbddf609');await p.waitForTimeout(1200);await p.screenshot({path:'me.png'});
console.log('key_info:',(await p.textContent('body')).includes('キーボックス 1234'));
// 完了は「完了報告」から（報告〜請求の流れは report.js で確かめる）
console.log('report button:',(await p.$eval('.job [data-rep]',e=>e.textContent))==='完了報告をする');
const o=await b.newPage({viewport:{width:800,height:900}});o.on('pageerror',e=>console.log('PAGEERR',e.message));
await o.goto('http://localhost:8787/order.html?t=6a5d0b50c23f7f77b31d1b68');await o.waitForTimeout(1200);await o.screenshot({path:'order.png'});
await o.click('#accept');await o.waitForTimeout(1000);console.log('accepted:',await o.$eval('.act',e=>e.textContent.trim().slice(0,40)));
const o2=await b.newPage({viewport:{width:800,height:900}});o2.on('pageerror',e=>console.log('PAGEERR',e.message));
await o2.goto('http://localhost:8787/order.html?t='+OT2);await o2.waitForTimeout(1200);
const t2=await o2.innerText('#sheet');console.log('tax-exempt:',t2.includes('消費税なし')&&!t2.includes('消費税（10%）'));
// 業者ページ：送付済みの発注が一覧に出る（下書きは出ない）。開いて承諾 → 戻ると承諾済み
const v=await b.newPage({viewport:{width:390,height:760},deviceScaleFactor:2});v.on('pageerror',e=>console.log('PAGEERR',e.message));
await v.goto('http://localhost:8787/me.html?t='+VT2);await v.waitForTimeout(1500);
await v.click('[data-m="orders"]');await v.waitForTimeout(600);   // ホームの「発注書の一覧を見る」
const before=await v.$$eval('#olist .ord',a=>a.map(x=>x.querySelector('.no').textContent+':'+x.querySelector('.st').textContent));
console.log('portal mode:',await v.$eval('[data-m].on',x=>x.dataset.m),'wait:',await v.$eval('#waitCnt',x=>x.textContent),'orders:',before.join(' | '));
await v.screenshot({path:'portal.png'});
await v.click('#olist .ord.wait');await v.waitForTimeout(1500);
console.log('back link:',await v.$eval('#back',(x,t)=>!x.hidden&&x.getAttribute('href').includes(t),VT2));
await v.fill('#by','テスト').catch(()=>{});await v.click('#accept');await v.waitForTimeout(1000);
await v.click('#back');await v.waitForTimeout(1500);
console.log('after accept:',(await v.$$eval('#olist .ord',a=>a.map(x=>x.querySelector('.no').textContent+':'+x.querySelector('.st').textContent))).join(' | '));
await b.close();srv.kill();})();
