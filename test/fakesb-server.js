// 手元の PostgreSQL に対する、supabase-js もどきの裏口。テスト専用（RLS は使わない）。
const http=require('http'); const {Client}=require('pg');
const pg=new Client({host:'localhost',user:'postgres',password:'pw',database:'aw'});
const q=(sql,params)=>pg.query(sql,params);
const ident=s=>{ if(!/^[a-z_][a-z0-9_]*$/.test(s))throw new Error('bad ident '+s); return '"'+s+'"'; };
async function handle(body){
  const {op,table,rows,ids,range,fn,args,conflict}=body;
  if(op==='select'){ const r=await q(`select * from ${ident(table)} order by 1 offset $1 limit $2`,[range[0],range[1]-range[0]+1]); return r.rows; }
  if(op==='rpc'){ const names=Object.keys(args); const r=await q(`select * from ${ident(fn)}(${names.map(n=>ident(n)+' => $'+(names.indexOf(n)+1)).join(',')})`,names.map(n=>args[n]));
    if(r.fields.length===1&&r.fields[0].name===fn) return r.rows.length?r.rows[0][fn]:null; return r.rows; }
  if(op==='delete'){ await q(`delete from ${ident(table)} where id = any($1)`,[ids]); return null; }
  if(op==='upsert'){
    for(const row of rows){
      const cols=Object.keys(row); const keys=(conflict||'id').split(',');
      const sql=`insert into ${ident(table)} (${cols.map(ident).join(',')}) values (${cols.map((_,i)=>'$'+(i+1)).join(',')})
        on conflict (${keys.map(ident).join(',')}) do update set ${cols.filter(c=>keys.indexOf(c)<0).map(c=>ident(c)+'=excluded.'+ident(c)).join(',')||'id=excluded.id'}`;
      await q(sql,cols.map(c=>row[c]));
    }
    return null;
  }
  throw new Error('unknown op '+op);
}
pg.connect().then(()=>{
  http.createServer((req,res)=>{
    if(req.method==='GET'){ const fs=require('fs'); const file=/^\/(me|order)\.html/.test(req.url)?req.url.split('?')[0].slice(1):'index.html'; let h=fs.readFileSync(__dirname+'/../site/'+file,'utf8').replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/,'<script src="/fake.js"></script>');
      if(req.url==='/fake.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(__dirname+'/fakesb-client.js'));return;}
      res.setHeader('Content-Type','text/html;charset=utf-8'); res.end(h); return; }
    let b=''; req.on('data',c=>b+=c); req.on('end',async()=>{
    res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Headers','*');
    if(req.method==='OPTIONS'){res.end();return;}
    try{ const data=await handle(JSON.parse(b||'{}')); res.end(JSON.stringify({data})); }
    catch(e){ res.end(JSON.stringify({error:{message:String(e.message||e)}})); }
  }); }).listen(8787,()=>console.log('fakesb on 8787'));
});
