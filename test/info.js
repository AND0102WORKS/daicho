// 業者ページ：案件の詳細・写真（打診のときも見られる。現地調査など、ほかの人が入れた写真も）（./reset.sh のあとに node info.js）
const {chromium}=require('playwright');const {spawn,execSync}=require('child_process');const {Client}=require('pg');
const fs=require('fs'), path=require('path'), STORE=path.join(require('os').tmpdir(),'fakesb-storage','reports');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p);
  const VT='tokinfo0000000000000001';
  await q("update vendors set token=$1, active=true where id='V1'",[VT]);
  await q("update cases set addr='東京都中央区日本橋本町1-1-1', key_info='キーボックス 1234', madori='1LDK' where id='C1302'");
  await q("update procs set who='長沼俊介', start_date=current_date+2, ask='打診中', ask_at=now(), amt=20000 where id='P1'");
  await q("insert into procs(id,case_id,kind,who,start_date) values ('PX','C1302','内装','FORCE-ONE',current_date+1) on conflict do nothing");
  await q("insert into lines(id,case_id,no,name,spec,qty,unit,sell,price,kind,memo) values ('LI1','C1302',1,'ルームクリーニング','全室',1,'式',30000,20000,'清掃','エアコン内部は別途') on conflict do nothing");
  // 写真：現地調査（スタッフ）2枚と、ほかの業者の施工前1枚
  const mk=(p,col)=>{ const f=path.join(STORE,p); fs.mkdirSync(path.dirname(f),{recursive:true}); execSync(`python3 -c "from PIL import Image; Image.new('RGB',(320,240),'${col}').save('${f}')"`); };
  mk('staff/C1302/a.jpg','#8FB3C9'); mk('staff/C1302/b.jpg','#C9B38F'); mk('othertoken000000000000001/PX/c.jpg','#9FC98F');
  await q("insert into photos(case_id,proc_id,who,cat,phase,path) values ('C1302','','スタッフ','現地調査','','staff/C1302/a.jpg'),('C1302','','スタッフ','現地調査','','staff/C1302/b.jpg'),('C1302','PX','FORCE-ONE','クロス貼替','前','othertoken000000000000001/PX/c.jpg') on conflict do nothing");
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const v=await b.newPage({viewport:{width:390,height:900},deviceScaleFactor:2});
  const errs=[]; v.on('pageerror',e=>errs.push(e.message)); v.on('dialog',x=>x.accept());
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  await v.goto('http://localhost:8787/me.html?t='+VT); await v.waitForTimeout(1500);
  ok('打診のカードに「案件の詳細・写真を見る」', !!(await v.$('.askc [data-info="P1"]')));
  await v.click('.askc [data-info="P1"]'); await v.waitForTimeout(1500);
  const t=(await v.textContent('#docBody')).replace(/\s+/g,' ');
  ok('詳細：住所・間取り・依頼元・作業の内容', t.includes('東京都中央区日本橋本町1-1-1')&&t.includes('1LDK')&&t.includes('日本財託')&&t.includes('全室 ルームクリーニング')&&t.includes('エアコン内部は別途'), t.slice(0,200));
  ok('詳細：この現場の工程（ほかの業者の名前は出ない）', t.includes('内装')&&t.includes('（あなた）')&&!t.includes('FORCE-ONE'));
  ok('詳細：鍵情報と金額は出ない', !t.includes('キーボックス')&&!t.includes('20,000')&&!t.includes('20000'));
  const cats=await v.$$eval('#infoPh .pcat',a=>a.map(x=>x.textContent));
  ok('写真：現地調査2枚と、ほかの業者の施工前1枚が見える', cats.join('|')==='現地調査（2枚）|クロス貼替（1枚）'&&(await v.$$('#infoPh img')).length===3, cats);
  ok('写真の場所（ほかの業者のフォルダ名）は画面に出ない', !(await v.$eval('#infoPh',x=>x.innerHTML)).includes('othertoken'));
  ok('写真が実際に表示される', await v.$$eval('#infoPh img',a=>a.every(i=>i.complete&&i.naturalWidth>0)));
  const st=await v.evaluate(async()=>{ const u=document.querySelector('#infoPh img').src.replace(/t=[^&]+/,'t=wrongtoken'); return (await fetch(u)).status; });
  ok('ちがうリンクでは画像も取れない', st===404, st);
  await v.screenshot({path:__dirname+'/info.png',fullPage:false});
  await v.evaluate(()=>document.querySelector('#docm .msheet').scrollTo(0,9999)); await v.waitForTimeout(300);
  await v.screenshot({path:__dirname+'/info2.png',fullPage:false});
  // ほかの業者のリンクでは見られない
  const bad=await v.evaluate(async()=>{ const r=await sb.rpc('my_case_info',{p_token:'wrongtoken',p_proc:'P1'}); const f=await sb.functions.invoke('case-photos',{body:{token:'wrongtoken',proc:'P1'}}); return [r.data,(f.data.photos||[]).length]; });
  ok('ちがうリンクでは詳細も写真も出ない', bad[0]===null&&bad[1]===0, bad);
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
