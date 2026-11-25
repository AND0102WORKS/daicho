// 洗い出しで見つかった穴の直し（./reset.sh のあとに node fix6.js）
//  D1 切れていた間の変更を取り直す／D2 読み直したら控えを捨てる／B1 発注済みの工程の業者・日付／A1 登録の無いメールは入れない
//  C1 追加金額を明細の編集で消さない／C2 受注額が未入力／D3 元に戻すが完了報告も戻す／D4 完了報告のある案件は消せない
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
const VT='aa11bb22cc33dd44ee55ff66', VT2='5c1d9e0a7b3f2e6d4a8c1b90';
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p).then(r=>r.rows);
  await q("update vendors set token=$1, active=true where id='V1'",[VT]); await q("update vendors set token=$1, active=true where id='V2'",[VT2]);
  await q("update cases set st='受注', sales=0 where id='C1302'");
  await q("update procs set amt=0, start_date='2026-11-15', end_date=null where id='P1'");
  await q("insert into lines(id,case_id,no,name,qty,unit,sell,price,kind) values ('LX','C1302',1,'ルームクリーニング',1,'式',30000,20000,'清掃') on conflict do nothing");
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1300,height:900}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',x=>x.accept());
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  const saved=()=>p.waitForTimeout(1500);
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);

  // ---- C2：受注額が未入力 ----
  ok('C2 要確認に「売上なし」が出る', await p.evaluate(()=>issues().some(i=>i.k==='売上なし'&&i.c==='C1302')));
  await p.evaluate(()=>{ tab='order'; oCase='C1302'; oView='make'; render(); }); await p.waitForTimeout(400);
  ok('C2 表の下に「受注額が未入力」とボタン', (await p.textContent('.ln tfoot')).includes('受注額が未入力')&&!!(await p.$('[data-setsales]')));
  await p.click('[data-setsales]'); await saved();
  ok('C2 押すと受注額に明細の合計が入る（30,000）', (await q("select sales from cases where id='C1302'"))[0].sales===30000);

  // ---- B1：発注済みの工程の業者・日付 ----
  await p.evaluate(async()=>{ await createOrder('C1302',['LX'],{who:'長沼俊介',kind:'清掃',start:'2026-11-15',end:'',due:'',naiyo:'',memo:'',proc:'P1'},true); save(); }); await saved();
  let o=(await q("select id,who,st,start_date::text d from orders where case_id='C1302'"))[0];
  ok('B1 発注ができて工程に付く', !!o&&o.who==='長沼俊介'&&o.st==='下書き', o);
  await p.evaluate(()=>setProc('P1','who','FORCE-ONE')); await saved();
  o=(await q("select who from orders where case_id='C1302'"))[0];
  ok('B1 下書きのうちは、工程の業者を変えると発注書の宛先も変わる', o.who==='FORCE-ONE'&&(await q("select who from lines where id='LX'"))[0].who==='FORCE-ONE', o);
  await p.evaluate(()=>{ DB.orders.find(x=>x.case==='C1302').st='送付済'; save(); }); await saved();
  await p.evaluate(()=>setProc('P1','who','長沼俊介')); await saved();
  ok('B1 送ったあとは、工程の業者を変えられない（発注を取り消すよう案内）', (await q("select who from procs where id='P1'"))[0].who==='FORCE-ONE'&&(await p.textContent('#toast')).includes('先に発注を取り消して'));
  await p.evaluate(()=>applyMove('P1','長沼俊介','2026-11-20')); await saved();
  ok('B1 手配ボードの付け替えも止める', (await q("select who from procs where id='P1'"))[0].who==='FORCE-ONE');
  await p.evaluate(()=>setDate('P1','2026-11-18','2026-11-19')); await saved();
  o=(await q("select start_date::text s,end_date::text e from orders where case_id='C1302'"))[0];
  ok('B1 工程の日付を変えると発注書の工期も変わる', o.s==='2026-11-18'&&o.e==='2026-11-19', o);
  // DB を直に：工程だけ別の業者にしても、その業者のページに前の業者宛ての発注書は出ない
  await q("update procs set who='長沼俊介' where id='P1'");
  ok('B1 業者ページ：宛先が自分でない発注書は工程に出ない', (await q("select * from my_job_orders($1)",[VT])).length===0&&true);
  await q("update procs set who='FORCE-ONE' where id='P1'");
  ok('B1 業者ページ：宛先が自分の発注書は出る', (await q("select * from my_job_orders($1)",[VT2])).length===1);

  // ---- D1：切れていた間の変更を取り直す ----
  await q("update orders set st='承諾', accepted_at=now() where case_id='C1302'");          // 業者が承諾（この画面には届いていない）
  await q("insert into procs(id,case_id,kind,who,start_date) values ('PZ','C1302','内装','FORCE-ONE','2026-11-21')");   // 他の人が工程を足した
  await p.evaluate(()=>{ const l=DB.lines.find(x=>x.id==='LX'); l.memo='未保存のメモ'; });   // 手元で直して、まだ保存していない行
  await q("update lines set memo='向こうのメモ' where id='LX'");
  await p.evaluate(()=>dbResync('test')); await p.waitForTimeout(800);
  const d1=await p.evaluate(()=>({st:DB.orders.find(x=>x.case==='C1302').st, pz:!!DB.procs.find(x=>x.id==='PZ'), memo:DB.lines.find(x=>x.id==='LX').memo}));
  ok('D1 取り直すと、業者の承諾と他の人の工程が入る', d1.st==='承諾'&&d1.pz, d1);
  ok('D1 手元で直して未保存の行は、取り直しで消さない', d1.memo==='未保存のメモ', d1);
  await p.evaluate(()=>{ const x=DB.orders.find(o=>o.case==='C1302'); x.memo='メモを直した'; save(); }); await saved();
  ok('D1 そのあと発注を直しても、承諾は元に戻らない', (await q("select st,memo from orders where case_id='C1302'"))[0].st==='承諾');
  await q("delete from procs where id='PZ'"); await p.evaluate(()=>dbResync('test')); await p.waitForTimeout(800);
  ok('D1 向こうで消えた行は、取り直しで消える', await p.evaluate(()=>!DB.procs.find(x=>x.id==='PZ')));

  // ---- C1・D3：追加金額と「元に戻す」 ----
  await q("insert into reports(id,org,proc_id,case_id,who,done_date,note,base,extra,extra_note,st) values ('RX','hq','P1','C1302','FORCE-ONE','2026-11-19','',19000,3000,'追加の清掃','報告済')");
  await p.evaluate(()=>dbResync('test')); await p.waitForTimeout(800);
  await p.evaluate(()=>approveReport('RX')); await saved();
  let r=(await q("select st,base,extra from reports where id='RX'"))[0], pa=(await q("select amt,prog from procs where id='P1'"))[0];
  ok('C1 承認：発注金額＝明細 20,000＋追加 3,000。報告の金額もいまの発注金額に合わせる', r.st==='承認'&&r.base===20000&&pa.amt===23000&&pa.prog==='完了', {r,pa});
  await p.evaluate(()=>{ const l=DB.lines.find(x=>x.id==='LX'); l.price=18000; syncOrderAmt(l.order); save(); }); await saved();
  ok('C1 承認のあとに明細を直しても、追加金額は消えない（18,000＋3,000）', (await q("select amt from procs where id='P1'"))[0].amt===21000);
  await p.evaluate(()=>{ const l=DB.lines.find(x=>x.id==='LX'); snap(); l.price=20000; syncOrderAmt(l.order); save(); }); await saved();
  await q("update reports set st='報告済', approved_at=null where id='RX'"); await q("update procs set amt=20000, prog='' where id='P1'");
  await p.evaluate(()=>dbResync('test')); await p.waitForTimeout(800);
  await p.evaluate(()=>approveReport('RX')); await saved();
  await p.evaluate(()=>undo()); await saved();
  r=(await q("select st from reports where id='RX'"))[0]; pa=(await q("select amt,prog from procs where id='P1'"))[0];
  ok('D3 承認を「元に戻す」と、報告も 報告済 に戻る（金額だけ戻って承認が残る、が起きない）', r.st==='報告済'&&pa.amt===20000&&pa.prog==='', {r,pa});

  // ---- D4：完了報告・送った発注のある案件は消せない ----
  await p.evaluate(()=>{ tab='ledger'; selCase='C1302'; render(); }); await p.waitForTimeout(400);
  await p.click('#delCase'); await p.waitForTimeout(300);
  ok('D4 完了報告のある案件は消せない', (await p.textContent('#toast')).includes('この案件は消せない')&&(await q("select count(*)::int n from cases where id='C1302'"))[0].n===1);

  // ---- D2：読み直したら「元に戻す」の控えを捨てる ----
  ok('D2 読み直すと控えが空になる', await p.evaluate(async()=>{ snap(); const n=undoStack.length; await dbLoad(); return n>0&&undoStack.length===0; }));

  // ---- A1：登録の無いメールは利用者にならない ----
  await q("insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a1','stranger@example.com')");
  ok('A1 登録の無いメールでログインしても profile を作らない', (await q("select count(*)::int n from profiles where email='stranger@example.com'"))[0].n===0);
  await q("insert into role_presets(email,name,org,role) values ('new@example.com','新しい人','hq','staff')");
  await q("insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a2','new@example.com')");
  ok('A1 登録のあるメールは、その役割で profile ができる', ((await q("select role,name from profiles where email='new@example.com'"))[0]||{}).role==='staff');
  await q("insert into role_presets(email,name,org,role) values ('stranger@example.com','あとから登録','hq','viewer')");
  await q("begin"); await q("select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true), set_config('request.jwt.claims','{\"email\":\"stranger@example.com\"}',true)");
  const ep=(await q("select ensure_profile() r"))[0].r; await q("commit");
  ok('A1 あとから登録された人は、次のログインで profile ができる', ep==='viewer'&&(await q("select role from profiles where email='stranger@example.com'"))[0].role==='viewer', ep);

  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
