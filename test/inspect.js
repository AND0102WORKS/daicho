// 使い方：./reset.sh && node inspect.js
// 業者ページ：検査担当（清掃と兼任）の工程タブ
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p);
  const VT='insp00000000000000000001';
  const d=n=>{const x=new Date();x.setDate(x.getDate()+n);return x.toISOString().slice(0,10);};
  await q("update vendors set token=$1, active=true, type='専属', def_kind='清掃', kinds='清掃,AW検査' where id='V1'",[VT]);
  await q("insert into vendors(id,name,full_name,type,def_kind) values ('V5','三永内装','三永内装','外注','内装') on conflict do nothing");
  await q("update cases set madori='1LDK', addr='東京都江東区豊洲5-1' where id='C1302'");
  await q("insert into cases(id,client,prop,kind,st,live,ord,sales,memo,addr) values ('C2','クレアスレント','コンシェリア恵比寿 102','清掃','受注',true,'未',50000,'ﾙｰﾑｸﾘｰﾆﾝｸﾞ（1K）','東京都渋谷区恵比寿1-1'),('C3','クレアスレント','パレステュディオ神楽坂 307','清掃','受注',true,'未',80000,'2LDK','東京都新宿区神楽坂2-2') on conflict do nothing");
  await q(`update procs set who='長沼俊介', start_date='${d(0)}', prog='完了' where id='P1'`);
  await q(`insert into procs(id,case_id,kind,who,start_date) values
    ('I1','C1302','AW検査','長沼俊介','${d(0)}'),('W1','C1302','内装','三永内装','${d(-2)}'),
    ('I2','C2','AW検査','長沼俊介','${d(0)}'),('W2','C2','清掃','國吉','${d(-1)}'),
    ('I3','C3','AW検査','長沼俊介','${d(1)}'),('W3','C3','清掃','國吉','${d(0)}'),('W4','C3','リペア補修','三永内装','${d(-1)}') on conflict do nothing`);
  await q(`insert into reports(proc_id,case_id,who,done_date,st) values ('P1','C1302','長沼俊介','${d(0)}','承認'),('W1','C1302','三永内装','${d(-2)}','報告済'),('W2','C2','國吉','${d(-1)}','承認') on conflict do nothing`);
  await q(`insert into lines(id,case_id,no,name,qty,unit,sell,price,kind) values ('S1','C1302',1,'巾木補修',1,'式',3000,0,'自社施工'),('S2','C1302',2,'建具調整',1,'式',2000,0,'自社施工'),('S3','C1302',3,'網戸張替',2,'枚',2000,0,'自社施工'),('S4','C1302',4,'戸当たり',1,'式',1000,0,'自社施工') on conflict do nothing`);
  await c.end();
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:390,height:800},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:8787/me.html?t='+VT); await p.waitForTimeout(1500);
  await p.click('[data-m="sched"]'); await p.waitForTimeout(1200);
  await p.screenshot({path:'insp-page.png',fullPage:true});
  const t=await p.textContent('#list');
  console.log(JSON.stringify({hasVol:t.includes('検査 2件'),hasRoute:t.includes('回る順番'),sizes:await p.$$eval('.sz',a=>a.map(x=>x.textContent)),errs}));
  await b.close(); srv.kill();
})();
