// 手元の発注書（PDF・写真・Excel）を台帳の読み取りにかけて、結果を出す（確かめ用）。 node readfile.js <ファイル> [raw]
// raw を付けると、取り出した文字の行（位置つき）も出す。ファイルは保存しない
const {chromium}=require('playwright');const {spawn}=require('child_process');const fs=require('fs'),path=require('path');
(async()=>{ const f=process.argv[2], raw=process.argv[3]==='raw';
  const srv=spawn('node',['fakesb-server.js'],{stdio:'ignore',cwd:__dirname}); await new Promise(r=>setTimeout(r,800));
  const b=await chromium.launch({args:['--no-proxy-server']}); const p=await b.newPage(); p.on('pageerror',e=>console.log('ERR',e.message));
  await p.goto('http://localhost:8787/'); await p.waitForTimeout(1500);
  const b64=fs.readFileSync(f).toString('base64'), name=path.basename(f);
  const out=await p.evaluate(async({b64,name})=>{ const bin=atob(b64), u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
    const type=/\.pdf$/i.test(name)?'application/pdf':/\.(png|jpe?g)$/i.test(name)?'image/'+name.split('.').pop():''; const file=new File([u],name,{type});
    let rows,ocr=false; if(/\.pdf$/i.test(name)){ const r=await pdfRows(file); rows=r.rows; ocr=r.ocr; } else if(type){ rows=await ocrRows(file); ocr=true; } else rows=await sheetRows(file);
    const r=pdfToLines(rows); return {ocr,header:r.header,n:rows.length,lines:r.lines,meta:r.meta,raw:rows.map(x=>x.map(c=>Math.round(c.x)+':'+c.t).join('  '))}; },{b64,name});
  console.log(`行 ${out.n}　OCR ${out.ocr}　見出し ${out.header}　明細 ${out.lines.length}行　合計 ${out.lines.reduce((a,l)=>a+Math.round(l.qty*l.price),0)}`);
  out.lines.forEach((l,i)=>console.log(`${i+1}\t${l.spec}\t${l.name}\t${l.qty}\t${l.unit}\t${l.price}\t${l.amt}\t${l.memo}`));
  console.log('案件の情報 '+JSON.stringify(out.meta));
  if(raw)console.log('--- raw ---\n'+out.raw.join('\n'));
  await b.close(); srv.kill(); })();
