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
  // 箇条書きの依頼書（・項目　¥金額）と、上に書いてある住所・鍵・間取り・日付
  await p.waitForTimeout(300); await c.query("update cases set addr='',key_info='' where id='C1302'"); await p.reload(); await p.waitForTimeout(1500);
  await p.evaluate(()=>{ tab='order'; oCase='C1302'; oView='make'; render(); }); await p.waitForTimeout(400);
  rows=await read('list-sample.pdf');
  ok('箇条書き：4行。品番が次の行でも1行にまとまる', rows.length===4&&rows[0]==='|ルームクリーニング|1|式|18000|（浴室鏡研磨含む）'&&/シート貼.*TA0000.*\|1\|式\|6000\|/.test(rows[2]), rows);
  ok('箇条書き：合計 34,000', (await p.textContent('.dlg.ested')).includes('34,000'));
  const mv=await p.$$eval('.dlg.ested [data-mv]',a=>a.map(x=>x.value));
  ok('箇条書き：住所・鍵・間取り・日付を読み取る', mv.includes('東京都杉並区見本町１－２－３')&&mv.some(v=>/フェンス\s*0000/.test(v))&&mv.includes('1K')&&mv.includes('2026-11-20'), mv);
  await p.click('#askYes'); await p.waitForTimeout(1800);
  const cs=(await q("select addr,key_info from cases where id='C1302'"))[0];
  ok('箇条書き：取り込むと、案件の住所と鍵情報に入る', cs.addr==='東京都杉並区見本町１－２－３'&&/フェンス/.test(cs.key_info), cs);
  // 表（材・手／工事区分の列つき、備考の折り返し、2ページ目は案内だけ）
  rows=await read('table2-sample.pdf');
  ok('表2：7行。知らない列（材・手・工事区分）は名称に混ざらない', rows.length===7&&rows[1]==='|浴室鏡薬品洗浄|1|式|3000|'&&rows[4].startsWith('|キッチンガスコンロ電池交換（単1×2本）|2|本|250|'), rows);
  ok('表2：折り返した備考は、その行だけに付く', /^\|仕上り調整費\|1\|式\|3000\|建具.*ぐ\s?らつき.*写真撮影.*清掃後/.test(rows[2])&&rows[1].endsWith('|')&&rows[3].endsWith('|'), rows[2]);
  ok('表2：合計 23,560（2ページ目の案内は行にならない）', (await p.textContent('.dlg.ested')).includes('23,560'));
  await p.click('#askNo');
  // 自社の見積の Excel：販売と原価の両方の列、負担の列、空の行
  await p.waitForTimeout(300); rows=await read('est-sample.xlsx');
  ok('見積Excel：5行（空の行を飛ばして、下のルームクリーニング・立会経費まで読む）', rows.length===5&&rows[0].startsWith('キッチン|キッチン水栓交換|1|式|55000|')&&rows[1].startsWith('LDK 洋室|エアコン洗浄|2|台|15000|')&&rows[3].startsWith('|ルームクリーニング|1|式|50000|'), rows);
  ok('見積Excel：負担の列の数字やチェックの列は備考に混ざらない', rows[0].endsWith('|TK-0000 提案 既存水漏れあり'), rows[0]);
  const cps=await p.$$eval('.dlg.ested [data-pf="cprice"]',a=>a.map(x=>+x.value));
  ok('見積Excel：原価の単価も読む。販売の合計 162,200・原価の合計 115,550', JSON.stringify(cps)==='[45000,10000,1150,26000,5000]'&&(await p.textContent('.dlg.ested')).includes('162,200')&&(await p.textContent('.dlg.ested')).includes('115,550'), cps);
  await p.click('#askYes'); await p.waitForTimeout(1800);
  const dbe=await q("select name,sell,price from lines where case_id='C1302' and name in ('エアコン洗浄','立会経費') and src='PDF' order by name");
  ok('見積Excel：取り込むと販売と原価の両方が入る', dbe.length===2&&dbe[0].sell===15000&&dbe[0].price===10000&&dbe[1].sell===0&&dbe[1].price===5000, dbe);
  ok('ページのエラーなし', errs.length===0, errs);
  console.log(res.every(Boolean)?'ALL OK':'SOME NG');
  await c.end(); await b.close(); srv.kill();
})();
