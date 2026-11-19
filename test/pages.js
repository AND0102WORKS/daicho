const {chromium}=require('playwright');const {spawn}=require('child_process');
// テスト用データ：職人（長沼）のリンクと、今日の工程・鍵情報、業者向けの発注1件を用意する（reset.sh の後に単独で動く）
const {Client}=require('pg');
const VT='284b932133d3639bdbddf609', OT='6a5d0b50c23f7f77b31d1b68';
async function prep(){ const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect();
  await c.query("update vendors set token=$1, active=true where id='V1'",[VT]);
  await c.query("update procs set start_date=current_date, end_date=current_date, prog='' where id='P1'");
  await c.query("update cases set key_info='キーボックス 1234' where id='C1302'");
  await c.query("insert into orders(id,no,case_id,who,kind,start_date,st,token) values ('OPG','AW-H9001','C1302','FORCE-ONE','内装',current_date,'送付済',$1) on conflict (id) do update set st='送付済', token=excluded.token",[OT]);
  await c.end(); }
(async()=>{await prep();const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore'});await new Promise(r=>setTimeout(r,800));
const b=await chromium.launch({args:['--no-proxy-server']});
const p=await b.newPage({viewport:{width:390,height:760},deviceScaleFactor:2});p.on('pageerror',e=>console.log('PAGEERR',e.message));
await p.goto('http://localhost:8787/me.html?t=284b932133d3639bdbddf609');await p.waitForTimeout(1200);await p.screenshot({path:'me.png'});
console.log('key_info:',(await p.textContent('body')).includes('キーボックス 1234'));
await p.click('button.done');await p.waitForTimeout(800);console.log('done:',await p.$eval('button.done',e=>e.textContent));
const o=await b.newPage({viewport:{width:800,height:900}});o.on('pageerror',e=>console.log('PAGEERR',e.message));
await o.goto('http://localhost:8787/order.html?t=6a5d0b50c23f7f77b31d1b68');await o.waitForTimeout(1200);await o.screenshot({path:'order.png'});
await o.click('#accept');await o.waitForTimeout(1000);console.log('accepted:',await o.$eval('.act',e=>e.textContent.trim().slice(0,40)));
await b.close();srv.kill();})();
