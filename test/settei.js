// 設定：事業者情報・利用者（役割・振込先を見られる印・停止）（./reset.sh のあとに node settei.js）
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p).then(r=>r.rows);
  const one=async(s,p)=>(await q(s,p))[0];
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',x=>x.accept());
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  const T=s=>p.textContent(s).then(t=>t.replace(/\s+/g,' ')), saved=()=>p.waitForTimeout(1700), w=()=>p.waitForTimeout(450);
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  ok('左のメニューが「設定」になっている', (await T('#tabs [data-t="master"]')).includes('設定'));
  await p.click('#tabs [data-t="master"]'); await w();
  let t=await T('#main');
  ok('設定の中に 事業者情報・利用者・発注単価（顧客は左のメニューへ）', ['事業者情報','利用者','発注単価','顧客は「顧客」へ'].every(x=>t.includes(x)));
  // 事業者情報
  await p.click('[data-mtab2="事業者情報"]'); await w();
  await p.fill('#co_name','見本株式会社'); await p.fill('#co_addr','東京都見本区1-2-3'); await p.fill('#co_inv','T0000000000000'); await p.click('#coSave'); await saved();
  const co=await one("select value from settings where key='co'");
  ok('事業者情報を設定で登録できる', co&&co.value.name==='見本株式会社'&&co.value.addr==='東京都見本区1-2-3'&&co.value.inv==='T0000000000000', co);
  await p.screenshot({path:__dirname+'/settei1.png'});
  // 利用者
  await p.click('[data-mtab2="利用者"]'); await p.waitForTimeout(900); t=await T('#main');
  ok('利用者：今の利用者が出て、自分の役割は変えられない', t.includes('hq@example.com')&&t.includes('自分')&&!(await p.$('tr[data-uem="hq@example.com"] [data-uf="role"]')), t.slice(0,260));
  await p.fill('#uName','見本 花子'); await p.fill('#uEmail','Hanako@Example.com'); await p.selectOption('#uRole','staff'); await p.check('#uFin'); await p.click('#uAdd'); await saved();
  let pr=await one("select email,name,role,fin from role_presets where email='hanako@example.com'");
  ok('利用者を足せる（メールは小文字でそろう・役割・経理の印）', !!pr&&pr.name==='見本 花子'&&pr.role==='staff'&&pr.fin===true&&(await T('tr[data-uem="hanako@example.com"]')).includes('まだ入っていない'), pr);
  await p.screenshot({path:__dirname+'/settei2.png'});
  await p.selectOption('tr[data-uem="hanako@example.com"] [data-uf="role"]','viewer'); await saved();
  await p.uncheck('tr[data-uem="hanako@example.com"] [data-uf="fin"]'); await saved();
  pr=await one("select role,fin from role_presets where email='hanako@example.com'");
  ok('役割と経理の印を変えられる', pr.role==='viewer'&&pr.fin===false, pr);
  // もう入っている人（profile がある）を停止する
  await q("insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000c1','old@example.com') on conflict do nothing");
  await q("insert into profiles(id,email,name,org,role,fin) values ('00000000-0000-0000-0000-0000000000c1','old@example.com','やめた人','hq','staff',true) on conflict (id) do update set role='staff', fin=true");
  await p.click('[data-mtab2="利用者"]'); await p.waitForTimeout(900);
  ok('もう入っている人は「利用中」', (await T('tr[data-uem="old@example.com"]')).includes('利用中'));
  await p.selectOption('tr[data-uem="old@example.com"] [data-uf="role"]','none'); await saved();
  const op=await one("select role,fin from profiles where email='old@example.com'");
  ok('停止にすると、役割が none になり経理の印も外れる', op.role==='none'&&op.fin===false&&(await T('tr[data-uem="old@example.com"]')).includes('停止'), op);
  // DB：管理者でない人は使えない・自分は下げられない
  const asUser=async(uid,sql,args)=>{ await q('begin'); await q("select set_config('request.jwt.claim.sub',$1,true)",[uid]); let r; try{ r=await q(sql,args); }catch(e){ r={err:e.message}; } await q('rollback'); return r; };
  await q("update profiles set role='staff' where email='old@example.com'");
  const a1=await asUser('00000000-0000-0000-0000-0000000000c1',"select staff_user_save('x@example.com','x','hq',true)"), a2=await asUser('00000000-0000-0000-0000-0000000000c1',"select staff_users() u");
  ok('DB：管理者でない人は利用者を変えられず、一覧も空', !!a1.err&&Array.isArray(a2)&&JSON.stringify(a2[0].u)==='[]', {a1,a2});
  const a3=await asUser('00000000-0000-0000-0000-0000000000aa',"select staff_user_save('hq@example.com','','staff',false)");
  ok('DB：自分の役割は下げられない（管理者がいなくなるのを防ぐ）', !!a3.err, a3);
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
