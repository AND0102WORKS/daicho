// 試験運用の前の直し（./reset.sh のあとに node pre.js）
//  発注書ページの鍵情報は作業日の前後だけ／下書きの発注書のリンクは業者ページに渡さない／承諾後に中身を変えたら承諾を取り消す／発注の取り消しの歯止め
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
const VT='aa11bb22cc33dd44ee55ff66';
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p).then(r=>r.rows);
  const one=async(s,p)=>(await q(s,p))[0];
  await q("update vendors set token=$1, active=true where id='V1'",[VT]);
  await q("update cases set st='受注', addr='東京都江東区豊洲5-1', key_info='キーボックス 1234' where id='C1302'");
  await q("update procs set amt=0, start_date=current_date+10, end_date=null where id='P1'");
  await q("insert into lines(id,case_id,no,name,qty,unit,sell,price,kind) values ('LX','C1302',1,'ルームクリーニング',1,'式',30000,20000,'清掃') on conflict do nothing");
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1300,height:900}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); let dlg=[]; p.on('dialog',x=>{ dlg.push(x.message()); x.accept(); });
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  const saved=()=>p.waitForTimeout(1600);
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  const day=n=>p.evaluate(n=>fmtD(new Date(Date.now()+n*864e5)),n);
  const d10=await day(10);
  await p.evaluate(async d=>{ await createOrder('C1302',['LX'],{who:'長沼俊介',kind:'清掃',start:d,end:'',due:'',naiyo:'',memo:'',proc:'P1'},true); save(); },d10); await saved();
  const o=await one("select id,token,st from orders where case_id='C1302'");
  // ---- 下書きの発注書のリンク ----
  let jo=await one("select * from my_job_orders($1)",[VT]);
  ok('下書きのうちは、業者ページに発注書のリンクを渡さない', jo&&jo.order_st==='下書き'&&jo.order_token===null, jo);
  await p.evaluate(()=>{ const x=DB.orders.find(o=>o.case==='C1302'); nextOrderSt(x.id); }); await saved();
  jo=await one("select * from my_job_orders($1)",[VT]);
  ok('送付済にすると、リンクが渡る', jo.order_st==='送付済'&&jo.order_token===o.token, jo);
  // ---- 鍵情報 ----
  let ov=await one("select key_info from order_view($1)",[o.token]);
  ok('発注書：作業日が10日先なら、鍵情報は出さない（案内だけ）', ov.key_info==='（作業日の3日前から表示されます）', ov);
  await p.evaluate(()=>setDate('P1',fmtD(new Date(Date.now()+2*864e5)),'')); await saved();
  ov=await one("select key_info,start_date::text s from order_view($1)",[o.token]);
  ok('工程を2日先にすると発注書の工期も変わり、鍵情報が出る', ov.key_info==='キーボックス 1234', ov);
  await q("update orders set start_date=current_date-5, end_date=current_date-3 where id=$1",[o.id]);
  ok('作業が終わって2日たつと、鍵情報は出なくなる', (await one("select key_info from order_view($1)",[o.token])).key_info==='（作業日の3日前から表示されます）');
  await p.evaluate(()=>{ save(); }); await saved();
  // ---- 承諾後に中身を変える ----
  await q("select order_accept($1,'長沼')",[o.token]); await p.evaluate(()=>dbResync('test')); await p.waitForTimeout(800);
  let os=await one("select st, accepted_at is not null acc, accepted_by from orders where id=$1",[o.id]);
  ok('業者が承諾：状態が承諾、承諾の日時が入る', os.st==='承諾'&&os.acc&&os.accepted_by==='長沼', os);
  await p.evaluate(()=>{ tab='order'; oCase='C1302'; oView='make'; oMode='発注'; render(); }); await p.waitForTimeout(400);
  await p.fill('tr[data-l="LX"] [data-lf="price"]','25000'); await p.keyboard.press('Tab'); await saved();
  os=await one("select st, accepted_at is not null acc, accepted_by from orders where id=$1",[o.id]);
  ok('承諾後に単価を変えると、承諾が取り消されて送付済に戻る（日時も消える）', os.st==='送付済'&&!os.acc&&os.accepted_by==='', os);
  ok('取り消したことが画面に出る', (await p.textContent('#toast')).includes('承諾を取り消した'));
  ok('発注金額は新しい単価になる', (await one("select amt from procs where id='P1'")).amt===25000);
  // ---- 発注の取り消し ----
  dlg=[]; await p.evaluate(id=>delOrder(id),o.id); await saved();
  ok('送ったあとの発注の取り消しは、確かめてから（業者に伝えるよう案内）', dlg.length===1&&dlg[0].includes('業者に伝えて')&&(await q("select 1 from orders where id=$1",[o.id])).length===0, dlg);
  const pa=await one("select order_id, amt from procs where id='P1'");
  ok('残した工程は発注が外れ、発注金額は0に戻る（明細と二重に数えない）', (pa.order_id||'')===''&&pa.amt===0, pa);
  // 完了報告がある発注は取り消せない
  await p.evaluate(async()=>{ await createOrder('C1302',['LX'],{who:'長沼俊介',kind:'清掃',start:fmtD(new Date()),end:'',due:'',naiyo:'',memo:'',proc:'P1'},true); save(); }); await saved();
  const o2=await one("select id from orders where case_id='C1302'");
  await q("insert into reports(id,org,proc_id,case_id,who,done_date,base,extra,st) values ('RP','hq','P1','C1302','長沼俊介',current_date,25000,0,'報告済')");
  await p.evaluate(()=>dbResync('test')); await p.waitForTimeout(800);
  dlg=[]; await p.evaluate(id=>delOrder(id),o2.id); await saved();
  ok('完了報告が出ている発注は取り消せない', dlg.length===0&&(await q("select 1 from orders where id=$1",[o2.id])).length===1&&(await p.textContent('#toast')).includes('取り消せない'));
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
