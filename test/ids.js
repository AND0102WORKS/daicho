// 業者・顧客を番号でつなぐ土台（./reset.sh のあとに node ids.js）
//  名前から番号を自動で埋める／マスタで名前を変えると、完了報告・請求書・支払済み・入金の記録も一緒に変わる
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p).then(r=>r.rows);
  const one=async s=>(await q(s))[0];
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  ok('最初から入っている工程に業者の番号が入っている', (await one("select vendor_id from procs where id='P1'")).vendor_id==='V1');
  ok('案件に顧客の番号が入っている', !!(await one("select client_id from cases where id='C1302'")).client_id);
  await q("insert into procs(id,case_id,kind,who) values ('PN1','C1302','内装','FORCE-ONE'),('PN2','C1302','内装',''),('PN3','C1302','内装','マスタに無い人')");
  const pn=await q("select id,vendor_id from procs where id like 'PN%' order by id");
  ok('工程を足すと番号が入る。業者が空・マスタに無い名前なら番号は空', pn[0].vendor_id==='V2'&&pn[1].vendor_id===null&&pn[2].vendor_id===null, pn);
  await q("insert into vendors(id,name,full_name,type,def_kind) values ('V9','マスタに無い人','','外注','内装')");
  ok('あとからマスタに足すと、その名前の工程に番号が入る', (await one("select vendor_id from procs where id='PN3'")).vendor_id==='V9');
  // お金の記録
  await q("insert into reports(id,org,proc_id,case_id,who,done_date,base,extra,st) values ('RI','hq','P1','C1302','長沼俊介','2026-11-19',22000,0,'承認')");
  await q("insert into invoices(id,org,who,month,subtotal,tax,total,st) values ('IV1','hq','長沼俊介','2026-11',22000,2200,24200,'発行')");
  await q("insert into payments(org,who,month,amount) values ('hq','長沼俊介','2026-11',24200)");
  await q("insert into receipts(org,client,month,amount) values ('hq','日本財託','2026-11',100650)");
  ok('完了報告・請求書・支払済み・入金の記録にも番号が入る', (await one("select vendor_id from reports where id='RI'")).vendor_id==='V1'&&(await one("select vendor_id from invoices where id='IV1'")).vendor_id==='V1'
    &&(await one("select vendor_id from payments where who='長沼俊介'")).vendor_id==='V1'&&!!(await one("select client_id from receipts where client='日本財託'")).client_id);
  // 台帳で業者名を変える（マスタの入力欄と同じ動き）
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1300,height:900}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',x=>x.accept());
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  await p.evaluate(()=>{ tab='master'; mTab='発注先'; render(); }); await p.waitForTimeout(400);
  await p.fill('tr[data-v="長沼俊介"] .mv[data-f="name"]','長沼 俊介（新）'); await p.keyboard.press('Tab'); await p.waitForTimeout(2200);
  const after={v:(await one("select name from vendors where id='V1'")).name, p:(await one("select who,vendor_id from procs where id='P1'")),
    r:(await one("select who,vendor_id from reports where id='RI'")), i:(await one("select who from invoices where id='IV1'")).who, pay:(await one("select who,amount from payments where vendor_id='V1'"))};
  ok('業者名を変えると、工程の名前も変わり、番号はそのまま', after.v==='長沼 俊介（新）'&&after.p.who==='長沼 俊介（新）'&&after.p.vendor_id==='V1', after.p);
  ok('完了報告・請求書・支払済みの記録も新しい名前になる（古い名前のまま取り残されない）', after.r.who==='長沼 俊介（新）'&&after.r.vendor_id==='V1'&&after.i==='長沼 俊介（新）'&&after.pay.who==='長沼 俊介（新）'&&after.pay.amount===24200, after);
  ok('業者の請求の一覧（my_billing）が、名前を変えたあとも承認済みの報告と請求書を返す', (b=>b.items.length===1&&b.items[0].proc_id==='P1'&&b.invoices.length===1)((await one("select my_billing((select token from vendors where id='V1')) b")).b));
  // 顧客名を変える
  await p.evaluate(()=>{ mTab='顧客'; render(); }); await p.waitForTimeout(400);
  const cid=(await one("select client_id from cases where id='C1302'")).client_id;
  await p.fill('tr[data-cm="日本財託"] .mc[data-f="name"]','日本財託（新）'); await p.keyboard.press('Tab'); await p.waitForTimeout(2200);
  const ca=await one("select client,client_id from cases where id='C1302'"), rc=await one("select client,amount from receipts where client_id='"+cid+"'");
  ok('顧客名を変えると、案件・入金の記録も新しい名前になり、番号はそのまま', ca.client==='日本財託（新）'&&ca.client_id===cid&&rc.client==='日本財託（新）'&&rc.amount===100650, {ca,rc});
  ok('顧客名を変えても、業者への支払済みの記録は変わらない', (await one("select count(*)::int n from payments where who='長沼 俊介（新）'")).n===1);
  const mis=await one(`select (select count(*) from procs p join vendors v on v.id=p.vendor_id where v.name<>p.who)+(select count(*) from procs p where coalesce(who,'')<>'' and vendor_id is null and exists(select 1 from vendors v where v.name=p.who))
    +(select count(*) from cases c join clients x on x.id=c.client_id where x.name<>c.client) n`);
  ok('名前と番号の食い違いは 0 件', +mis.n===0, mis);
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
