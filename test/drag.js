// 明細の行をドラッグして並べ替える（./reset.sh のあとに node drag.js）
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p);
  await q(`insert into lines(id,case_id,no,name,qty,unit,sell,price,kind) values
    ('D1','C1302',1,'クロス貼替',20,'㎡',1500,1000,'内装'),('D2','C1302',2,'巾木交換',5,'m',800,500,'内装'),('D3','C1302',3,'床補修',1,'式',9000,6000,'内装'),
    ('D4','C1302',4,'ルームクリーニング',1,'式',30000,20000,'清掃') on conflict do nothing`);
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',x=>x.accept());
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  await p.evaluate(()=>{ tab='order'; oCase='C1302'; oView='make'; oMode='見積'; render(); }); await p.waitForTimeout(400);
  const names=()=>p.$$eval('tr[data-l]',a=>a.map(x=>x.querySelector('[data-lf="name"]').value));
  const drag=async(from,to,below)=>{ const a=await (await p.$(`[data-ldrag="${from}"]`)).boundingBox(), t=await (await p.$(`tr[data-l="${to}"]`)).boundingBox();
    await p.mouse.move(a.x+10,a.y+a.height/2); await p.mouse.down(); await p.mouse.move(a.x+30,a.y+a.height/2+4,{steps:3});
    const y=t.y+(below?t.height*0.8:t.height*0.2); await p.mouse.move(t.x+200,y,{steps:8}); await p.waitForTimeout(150);
    if(from==='D3'&&to==='D1')await p.screenshot({path:__dirname+'/drag.png',clip:{x:0,y:290,width:1440,height:330}});
    await p.mouse.up(); await p.waitForTimeout(500); };
  ok('最初の順番', (await names()).join('>')==='クロス貼替>巾木交換>床補修>ルームクリーニング', await names());
  await drag('D3','D1',false);
  ok('床補修を一番上へ', (await names()).join('>')==='床補修>クロス貼替>巾木交換>ルームクリーニング', await names());
  await drag('D3','D2',true);
  ok('床補修を巾木交換の下へ', (await names()).join('>')==='クロス貼替>巾木交換>床補修>ルームクリーニング', await names());
  await drag('D2','D4',true);
  ok('巾木交換を清掃の区分へ動かすと区分が変わる', await p.evaluate(()=>DB.lines.find(l=>l.id==='D2').kind)==='清掃', await names());
  await p.waitForTimeout(1500);
  const db=(await q("select name,no,kind from lines where case_id='C1302' order by no")).rows.map(r=>r.no+':'+r.name+'/'+r.kind);
  ok('データベースに順番が残る', db.join(',')==='1:クロス貼替/内装,2:床補修/内装,3:ルームクリーニング/清掃,4:巾木交換/清掃', db);
  await p.reload(); await p.waitForTimeout(1500);
  ok('再読み込みしても同じ順番', (await names()).join('>')==='クロス貼替>床補修>ルームクリーニング>巾木交換', await names());
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
