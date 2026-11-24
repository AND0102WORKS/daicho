// 発注書を読み取って明細にする：PDF（文字入り）・Excel・写真（OCR）（./reset.sh のあとに node pdf.js）
// 見本は node mkpdf.js samples/po-sample.pdf（.png なら画像）で作ったもの。xlsx は同じ内容を SheetJS で書いたもの
const {chromium}=require('playwright');const {spawn}=require('child_process');const {Client}=require('pg');
(async()=>{
  const c=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'}); await c.connect(); const q=(s,p)=>c.query(s,p).then(r=>r.rows);
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage({viewport:{width:1300,height:900},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',x=>x.accept());
  const res=[]; const ok=(n,cnd,x)=>{ res.push(cnd); console.log((cnd?'OK  ':'NG  ')+n+(x!==undefined?'  '+JSON.stringify(x):'')); };
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  await p.evaluate(()=>{ tab='order'; oCase='C1302'; oView='make'; render(); }); await p.waitForTimeout(400);
  const read=async(f,wait)=>{ await p.setInputFiles('#pdfFile',__dirname+'/samples/'+f); await p.waitForSelector('.dlg.ested',{timeout:wait||20000}); await p.waitForTimeout(500);
    return p.$$eval('.dlg.ested tr[data-i]',a=>a.map(tr=>['spec','name','qty','unit','price','memo'].map(f=>tr.querySelector(`[data-pf="${f}"]`).value).join('|'))); };
  // PDF
  let rows=await read('po-sample.pdf');
  ok('PDF：6行を読み取る（小計・消費税・合計は入らない）', rows.length===6, rows.length);
  ok('PDF：1行目 LD／クロス貼替（量産品）／42.5㎡／1,500／SP-9901', rows[0]==='LD|クロス貼替（量産品）|42.5|㎡|1500|SP-9901', rows[0]);
  ok('PDF：6行目 場所なし／諸経費／35,990', rows[5]==='|諸経費|1|式|35990|', rows[5]);
  ok('PDF：合計が発注書の小計と合う（225,740）', (await p.textContent('.dlg.ested')).includes('225,740'));
  await p.screenshot({path:__dirname+'/pdf.png'});
  await p.click('.dlg.ested tr[data-i="5"] [data-pf="on"]'); await p.waitForTimeout(300);
  await p.click('#askYes'); await p.waitForTimeout(1800);
  const db=await q("select name,spec,qty::float,unit,sell,price,src from lines where case_id='C1302' and src='PDF' order by no");
  ok('PDF：5行が販売の単価で入る（原価は0）', db.length===5&&db[0].sell===1500&&db[0].price===0&&db[0].qty===42.5&&db[0].spec==='LD', db.map(r=>r.name+':'+r.sell));
  // Excel
  rows=await read('po-sample.xlsx');
  ok('Excel：6行。1行目と6行目', rows.length===6&&rows[0]==='LD|クロス貼替（量産品）|42.5|㎡|1500|SP-9901'&&rows[5]==='|諸経費|1|式|35990|', rows);
  ok('Excel：合計 225,740', (await p.textContent('.dlg.ested')).includes('225,740'));
  await p.click('#askNo'); await p.waitForTimeout(300);
  // 写真（OCR）：読み違いは出てよいが、行と金額が取れること
  const t0=Date.now(); rows=await read('po-sample.png',120000); console.log('OCR '+Math.round((Date.now()-t0)/1000)+'秒\n'+rows.join('\n'));
  const prices=rows.map(r=>+r.split('|')[4]);
  ok('写真：OCR の注意が出る', (await p.textContent('.dlg.ested')).includes('OCR'));
  ok('写真：5行以上を読み、単価 25,000・45,000・38,000 が取れる', rows.length>=5&&[25000,45000,38000].every(v=>prices.indexOf(v)>=0), prices);
  await p.screenshot({path:__dirname+'/ocr.png'});
  await p.click('#askNo');
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
