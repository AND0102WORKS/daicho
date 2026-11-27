// 業者ページ：ホーム（いま、やること）・案件（返事する／進行中／報告／過去）・下のメニュー（./reset.sh のあとに node gyousha.js）
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
const VT='aa11bb22cc33dd44ee55ff66';
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p).then(r=>r.rows);
  await q("update vendors set token=$1, active=true, type='外注' where id='V1'",[VT]);
  await q("update cases set addr='東京都見本区1-2-3', key_info='キーボックス 0000' where id='C1302'");
  await q("update procs set start_date=current_date-5, amt=22000 where id='P1'");   // 作業日を過ぎて報告なし → 報告待ち
  const mk=(id,prop)=>q("insert into cases(id,client,prop,kind,st,live,sales) values ($1,'日本財託',$2,'清掃','受注',true,50000)",[id,prop]);
  await mk('G1','見本きょう 101'); await mk('G2','見本これから 202'); await mk('G3','見本しょうだく 303'); await mk('G4','見本かくにん 404'); await mk('G5','見本さしもどし 505'); await mk('G6','見本しょうにん 606'); await mk('G7','見本しはらい 707');
  await q("update cases set addr='東京都見本区1-2-3', key_info='キーボックス 0000' where id='G1'");
  const pr=(id,cs,d,amt,extra)=>q(`insert into procs(id,case_id,kind,who,start_date,amt${extra?',order_id':''}) values ($1,$2,'清掃','長沼俊介',current_date+$3::int,$4${extra?",'"+extra+"'":''})`,[id,cs,d,amt]);
  await pr('PG1','G1',0,30000); await pr('PG2','G2',5,31000); await pr('PG3','G3',8,32000,'OG3'); await pr('PG4','G4',-3,33000); await pr('PG5','G5',-4,34000); await pr('PG6','G6',-6,35000); await pr('PG7','G7',-40,36000);
  await q("insert into orders(id,no,case_id,who,kind,st,token,proc_id,start_date) values ('OG3','AW-H0901','G3','長沼俊介','清掃','送付済','ordtokeng3000000000001','PG3',current_date+8)");
  const rp=(id,pid,cs,st,d,base,extra,inv,reply)=>q("insert into reports(id,org,proc_id,case_id,who,done_date,base,extra,st,invoice_id,reply) values ($1,'hq',$2,$3,'長沼俊介',current_date+$4::int,$5,$6,$7,$8,$9)",[id,pid,cs,d,base,extra,st,inv||'',reply||'']);
  await rp('RG4','PG4','G4','報告済',-3,33000,5000); await rp('RG5','PG5','G5','差し戻し',-4,34000,0,'','施工後の写真が足りません'); await rp('RG6','PG6','G6','承認',-6,35000,0);
  await q("insert into invoices(id,org,who,kind,month,period_from,period_to,items,subtotal,tax,total,taxable,st,issued_at,paid_date) values ('IG7','hq','長沼俊介','請求書',to_char(current_date-40,'YYYY-MM'),current_date-60,current_date-30,$1,36000,3600,39600,true,'支払済',now()-interval '30 days',current_date-10)",[JSON.stringify([{report_id:'RG7',proc_id:'PG7',prop:'見本しはらい 707',kind:'清掃',base:36000,extra:0}])]);
  await rp('RG7','PG7','G7','承認',-40,36000,0,'IG7');
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const v=await b.newPage({viewport:{width:390,height:800},deviceScaleFactor:2});
  const errs=[]; v.on('pageerror',e=>errs.push(e.message)); v.on('dialog',x=>x.accept());
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  const T=s=>v.textContent(s).then(t=>t.replace(/\s+/g,' ')), w=()=>v.waitForTimeout(500);
  await v.goto('http://localhost:8787/me.html?t='+VT); await v.waitForTimeout(2200);
  ok('開くとホーム。下に5つのメニュー（ホーム・案件・予定・請求・使い方）', (await v.$eval('.bnav [data-m].on',x=>x.dataset.m))==='home'&&(await v.$$eval('.bnav [data-m]',a=>a.map(x=>x.dataset.m).join(',')))==='home,cases,sched,bill,help');
  let t=await T('#homeView');
  ok('ホーム「いま、やること」：承諾・差し戻し・完了報告・請求が件数つきで出る', t.includes('発注書を見て承諾する')&&t.includes('差し戻された報告を直す')&&t.includes('完了報告を出す')&&t.includes('請求できます')&&t.includes('35,000'), t.slice(0,260));
  ok('ホーム「今日・明日の現場」：今日の現場が「作業中」で出て、住所と鍵が見える', t.includes('見本きょう 101')&&t.includes('作業中')&&(await T('#homeView .k-now')).includes('東京都見本区1-2-3')&&(await T('#homeView .k-now')).includes('キーボックス 0000'));
  ok('下のメニューに、やることの件数が赤い数字で出る', (await v.$eval('#nbHome',x=>!x.hidden&&x.textContent))==='3'&&(await v.$eval('#nbBill',x=>!x.hidden&&x.textContent))==='1', [await v.$eval('#nbHome',x=>x.textContent),await v.$eval('#nbBill',x=>x.textContent)]);
  await v.screenshot({path:__dirname+'/gyousha1.png'});
  // 案件：返事する
  await v.click('.todo[data-ctab="ans"]'); await w(); t=await T('#clist');
  ok('やることを押すと「案件 › 返事する」：承諾待ちの発注書', (await v.$eval('.bnav [data-m].on',x=>x.dataset.m))==='cases'&&(await v.$eval('#cchips .on',x=>x.dataset.ctab))==='ans'&&t.includes('見本しょうだく 303')&&t.includes('承諾待ち')&&t.includes('発注書を見て承諾する')&&!t.includes('見本きょう'), t.slice(0,160));
  ok('ホームの中身は消えている（同じカードが2か所に残らない）', (await v.$$('#homeView .job')).length===0);
  // 進行中
  await v.click('#cchips [data-ctab="go"]'); await w(); t=await T('#clist');
  ok('進行中：今日の現場（作業中）が上、まだ先の現場（これから）が下。作業日を過ぎたものは入らない', t.indexOf('見本きょう 101')>=0&&t.indexOf('見本きょう 101')<t.indexOf('見本これから 202')&&t.includes('これから')&&!t.includes('プレール')&&!t.includes('見本しょうだく'), t.slice(0,200));
  await v.screenshot({path:__dirname+'/gyousha2.png'});
  // 報告
  await v.click('#cchips [data-ctab="rep"]'); await w(); t=await T('#clist');
  const order=['見本さしもどし 505','プレール','見本かくにん 404','見本しょうにん 606'].map(x=>t.indexOf(x));
  ok('報告：差し戻し → 報告待ち → 確認待ち → 承認済み の順に並ぶ', order.every((x,i)=>x>=0&&(i===0||order[i-1]<x)), order);
  ok('報告：差し戻しの理由、追加の申請中、承認済みは「請求できます」', t.includes('施工後の写真が足りません')&&t.includes('追加 ¥5,000・申請中')&&t.includes('請求できます')&&t.includes('報告待ち'));
  ok('報告待ちのカードから、そのまま完了報告を出せる', !!(await v.$('#clist .k-due [data-rep]'))&&!!(await v.$('#clist .k-due [data-photo]')));
  await v.screenshot({path:__dirname+'/gyousha3.png'});
  await v.click('#clist .k-due [data-rep]'); await w();
  ok('完了報告の窓が開く', await v.$eval('#rm',x=>!x.hidden)&&(await T('#rProp')).includes('プレール'));
  await v.click('#rSend'); await v.waitForTimeout(2500);
  ok('報告を送ると「確認待ち」に変わる', (await q("select st from reports where proc_id='P1'"))[0].st==='報告済'&&(await T('#clist .job[data-id="P1"]')).includes('確認待ち'));
  // 過去
  await v.click('#cchips [data-ctab="past"]'); await w(); t=await T('#clist');
  ok('過去：支払済みの現場が月ごとにまとまり、件数と金額が出る', t.includes('見本しはらい 707')&&t.includes('支払済み')&&/\d{4}年 \d+月/.test(t)&&t.includes('1件')&&t.includes('36,000'), t.slice(0,160));
  await v.fill('#cq','ないもの'); await w();
  ok('過去：物件名で探せる', (await T('#clist')).includes('終わった現場はまだありません')&&(await v.$eval('#cq',x=>x===document.activeElement)));
  await v.screenshot({path:__dirname+'/gyousha4.png'});
  // ほかのメニュー
  await v.click('.bnav [data-m="sched"]'); await w(); ok('予定：今までの日付順の一覧', (await T('#list')).includes('見本きょう 101'));
  await v.click('.bnav [data-m="bill"]'); await v.waitForTimeout(900); ok('請求：承認済みの分が出る', (await T('#blist')).includes('見本しょうにん 606'));
  await v.click('.bnav [data-m="home"]'); await w(); await v.click('[data-m="orders"]'); await w();
  ok('ホームの下から「発注書の一覧」も見られる', (await T('#olist')).includes('AW-H0901'));
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
