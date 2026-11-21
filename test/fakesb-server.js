// 手元の PostgreSQL に対する、supabase-js もどきの裏口。テスト専用（RLS は使わない）。
const http=require('http'); const {Client}=require('pg');
const pg=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'});
const q=(sql,params)=>pg.query(sql,params);
const ident=s=>{ if(!/^[a-z_][a-z0-9_]*$/.test(s))throw new Error('bad ident '+s); return '"'+s+'"'; };
const JSONCOLS={};   // 表ごとの json/jsonb 列（配列・オブジェクトを JSON の文字列にして渡す）
async function jsonCols(t){ if(!JSONCOLS[t]){ const r=await q("select column_name from information_schema.columns where table_name=$1 and data_type in ('json','jsonb')",[t]); JSONCOLS[t]=new Set(r.rows.map(x=>x.column_name)); } return JSONCOLS[t]; }
// 写真の保存領域（Supabase Storage）のまね：ファイルに置いて /storage/ で返す
const fs=require('fs'), path=require('path'), STORE=path.join(require('os').tmpdir(),'fakesb-storage');
async function handle(body){
  const {op,table,rows,ids,range,fn,args,conflict}=body;
  if(op==='upload'){ const f=path.join(STORE,body.bucket,body.path); fs.mkdirSync(path.dirname(f),{recursive:true}); fs.writeFileSync(f,Buffer.from(body.b64,'base64')); return {path:body.path}; }
  if(op==='select'){ const r=await q(`select * from ${ident(table)} order by 1 offset $1 limit $2`,[range[0],range[1]-range[0]+1]); return r.rows; }
  if(op==='rpc'){ Object.keys(args).forEach(k=>{ if(args[k]!==null&&typeof args[k]==='object')args[k]=JSON.stringify(args[k]); });   // jsonb の引数
    const names=Object.keys(args); const r=await q(`select * from ${ident(fn)}(${names.map(n=>ident(n)+' => $'+(names.indexOf(n)+1)).join(',')})`,names.map(n=>args[n]));
    if(r.fields.length===1&&r.fields[0].name===fn) return r.rows.length?r.rows[0][fn]:null; return r.rows; }
  if(op==='delete'){ await q(`delete from ${ident(table)} where id = any($1)`,[ids]); return null; }
  if(op==='upsert'){
    const jc=await jsonCols(table);
    for(const row of rows){
      Object.keys(row).forEach(c=>{ if(jc.has(c)&&row[c]!==null&&typeof row[c]==='object')row[c]=JSON.stringify(row[c]); });
      const cols=Object.keys(row); const keys=(conflict||'id').split(',');
      const sql=`insert into ${ident(table)} (${cols.map(ident).join(',')}) values (${cols.map((_,i)=>'$'+(i+1)).join(',')})
        on conflict (${keys.map(ident).join(',')}) do update set ${cols.filter(c=>keys.indexOf(c)<0).map(c=>ident(c)+'=excluded.'+ident(c)).join(',')||'id=excluded.id'}`;
      await q(sql,cols.map(c=>row[c]));
    }
    return null;
  }
  throw new Error('unknown op '+op);
}
const SCHEMA=process.env.FAKESB_SCHEMA||'', DOCS=__dirname+'/../docs/'+(SCHEMA?SCHEMA+'/':'');   // FAKESB_SCHEMA=test でテスト用の棚・docs/test/ のページ
pg.connect().then(()=>pg.query("select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000aa',false)"))
  .then(()=>SCHEMA?pg.query('set search_path = '+ident(SCHEMA).replace(/"/g,'')+', public, extensions'):null).then(()=>{   // 本部ユーザーとして
  http.createServer((req,res)=>{
    if(req.method==='GET'&&req.url.startsWith('/storage/')){ const f=path.join(STORE,decodeURIComponent(req.url.slice(9).split('?')[0]));
      if(fs.existsSync(f)){ res.setHeader('Content-Type','image/jpeg'); res.end(fs.readFileSync(f)); } else { res.statusCode=404; res.end(); } return; }
    if(req.method==='GET'){ const file=/^\/(me|order)\.html/.test(req.url)?req.url.split('?')[0].slice(1):'index.html'; let h=fs.readFileSync(DOCS+file,'utf8').replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/,'<script src="/fake.js"></script>');
      if(req.url==='/fake.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(__dirname+'/fakesb-client.js'));return;}
      res.setHeader('Content-Type','text/html;charset=utf-8'); res.end(h); return; }
    let b=''; req.on('data',c=>b+=c); req.on('end',async()=>{
    res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Headers','*');
    if(req.method==='OPTIONS'){res.end();return;}
    try{ const data=await handle(JSON.parse(b||'{}')); res.end(JSON.stringify({data})); }
    catch(e){ res.end(JSON.stringify({error:{message:String(e.message||e)}})); }
  }); }).listen(8787,()=>console.log('fakesb on 8787'));
});
