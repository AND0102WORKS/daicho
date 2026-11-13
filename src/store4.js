/* ================= v4：Supabase が正。DB（メモリ）は画面用の写し =================
   方針：
   ・開くときに表を読んで DB を組み立てる。保存は「変わった行だけ upsert、消えた行は delete」。
   ・他の人の変更は Realtime（postgres_changes）で行単位に受け取り、その行だけ差し替える。
   ・合流・墓標・箱分け・採番ロックは無い（サーバー側で行単位に決まる）。
   ・列名と JS の項目名が違うものだけ MAP で変換する。 */
const M={seed:'db',cases:[],procs:[],clients:[],vendors:[],off:{},
  kensa:'',          /* AW検査の担当：発注先マスタで既定の工程区分が AW検査 の人（読み込み時に入る） */
  status:["受付","現調済","見積提出","受注","発注書送付","施工中","清掃済","完工","報告済","請求済"],
  senzoku:[],        /* 専属職人：発注先マスタの区分が 専属 の人（読み込み時に入る。配列は同じものを使い回す） */
  termNote:{},asof:'Supabase'};
const SB_URL='__SB_URL__', SB_KEY='__SB_KEY__';
let sb=null, SESSION=null, ME=null, ORG='hq';
let DB=null, undoStack=[];
let reseeded=false;
const DEV=(()=>{ try{ let d=localStorage.getItem('aw-dev'); if(!d){ d='-'+Math.random().toString(36).slice(2,5); localStorage.setItem('aw-dev',d);} return d; }catch(e){ return '-'+Math.random().toString(36).slice(2,5); } })();
let dbState='', dbDirty=false, dbBusy=false, dbSaveTimer=null;
const AWLOG=(()=>{try{return JSON.parse(localStorage.getItem('aw-log')||'[]');}catch(e){return [];}})();
function alog(ev,x){ try{ AWLOG.push([new Date().toISOString().slice(5,19),DEV,ev,x==null?'':String(x).slice(0,160)]); while(AWLOG.length>80)AWLOG.shift(); localStorage.setItem('aw-log',JSON.stringify(AWLOG)); }catch(e){} }

/* ---- 表と JS 項目の対応 ---- */
const TABLES={
  cases: {cols:['id','org','client','prop','kind','st','live','ord','ord_by','sales','add_amt','bill','kisan','want','plan','plan_manual','done','keyx','warr','recv','case_no','src','memo','items','report','photo','addr','key_info'],
          map:{add:'add_amt',planManual:'plan_manual',caseNo:'case_no',ordBy:'ord_by',keyInfo:'key_info'}, dates:['kisan','want','plan','done'], bools:['live','plan_manual']},
  procs: {cols:['id','org','case_id','kind','who','start_date','end_date','amt','month','prog','order_id','auto','memo'],
          map:{case:'case_id',date:'start_date',end:'end_date',order:'order_id'}, dates:['start_date','end_date'], bools:['auto']},
  lines: {cols:['id','org','case_id','no','name','spec','qty','unit','sell','price','kind','who','memo','cut','src','order_id'],
          map:{case:'case_id',order:'order_id'}, dates:[], bools:['cut']},
  orders:{cols:['id','org','no','case_id','who','kind','start_date','end_date','due','naiyo','memo','st','sent','proc_id'],
          map:{case:'case_id',start:'start_date',end:'end_date',proc:'proc_id'}, dates:['start_date','end_date','due','sent'], bools:[]},
  vendors:{cols:['id','org','name','full_name','type','def_kind','inv','bank','close_day','site','phone','email','active','src'],
          map:{full:'full_name',defKind:'def_kind',close:'close_day'}, dates:[], bools:['active']},
  clients:{cols:['id','org','name','full_name','mail','method','close_day','site','note','src'],
          map:{full:'full_name',close:'close_day'}, dates:[], bools:[]},
  prices:{cols:['id','org','name','alias','kind','unit','price','who','client','memo'], map:{}, dates:[], bools:[]},
};
const REV={}; Object.keys(TABLES).forEach(t=>{ REV[t]={}; Object.entries(TABLES[t].map).forEach(([j,c])=>{REV[t][c]=j;}); });
/* 行（DBの列）→ JS のレコード */
function rowToRec(t,row){
  const T=TABLES[t], r={};
  Object.keys(row).forEach(c=>{ if(c==='updated_at'||c==='created_at')return;   /* token は読むだけ（職人・業者のリンク用。書き戻さない） */
    let v=row[c]; const j=REV[t][c]||c;
    if(v===null||v===undefined) v=(T.bools.indexOf(c)>=0)?false:'';
    if(T.dates.indexOf(c)>=0&&v){ if(v instanceof Date) v=`${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`; else v=String(v).slice(0,10); }
    if(t==='lines'&&c==='cut') v=v?1:0;
    r[j]=v; });
  if(t==='vendors'||t==='clients'){ if(r.full==null)r.full=''; }
  return r;
}
/* JS のレコード → 行 */
function recToRow(t,rec){
  const T=TABLES[t], row={};
  T.cols.forEach(c=>{ const j=REV[t][c]||c; let v=rec[j];
    if(c==='org'){ row.org=rec.org||ORG; return; }
    if(v===undefined) return;
    if(T.dates.indexOf(c)>=0) v=(v&&/^\d{4}-\d{2}-\d{2}/.test(String(v)))?String(v).slice(0,10):null;
    else if(T.bools.indexOf(c)>=0) v=!!v;
    else if(['sales','add_amt','amt','sell','price','close_day','site'].indexOf(c)>=0||(t==='lines'&&c==='no')) v=(v===''||v==null)?(c==='no'?null:0):(+v||0);
    else if(c==='qty') v=(v===''||v==null)?0:(+v||0);
    else if(v===null) v='';
    row[c]=v; });
  return row;
}
const sig=r=>{ const o={}; Object.keys(r).sort().forEach(k=>{ if(k!=='_u'&&k!=='token')o[k]=r[k]; }); return JSON.stringify(o); };
/* 職人・業者向けページのリンク */
const siteBase=()=>location.origin+location.pathname.replace(/[^/]*$/,'');
const vendorLink=v=>v&&v.token?siteBase()+'me.html?t='+v.token:'';
const orderLink=o=>o&&o.token?siteBase()+'order.html?t='+o.token:'';
function copyText(t,msg){ navigator.clipboard.writeText(t).then(()=>toast(msg||'コピーした')).catch(()=>prompt('コピーできなかった。手で選んでコピー：',t)); }
let recLast={};   /* 'table:id' → sig。変わった行を見つけるため */
const COLS={cases:1,procs:1,lines:1,orders:1,vendors:1,clients:1,prices:1};
function rememberAll(){ recLast={}; Object.keys(COLS).forEach(t=>(DB[t]||[]).forEach(r=>{ if(r.id)recLast[t+':'+r.id]=sig(r); })); kvLast=JSON.stringify(kvObj()); }
let kvLast='';
const kvObj=()=>({recv:DB.recv||{},paid:DB.paid||{},off:DB.off||{},basis:DB.basis||'完工'});

/* ---- 読み込み ---- */
async function fetchAll(t,select){
  const out=[]; let from=0; const step=1000;
  for(;;){ const {data,error}=await sb.from(t).select(select||'*').range(from,from+step-1); if(error)throw error; out.push(...(data||[])); if(!data||data.length<step)break; from+=step; }
  return out;
}
async function dbLoad(){
  const [cases,procs,lines,orders,vendors,clients,prices,recv,paid,off,settings]=await Promise.all([
    fetchAll('cases'),fetchAll('procs'),fetchAll('lines'),fetchAll('orders'),fetchAll('vendors'),fetchAll('clients'),fetchAll('prices'),
    fetchAll('receipts'),fetchAll('payments'),fetchAll('days_off'),fetchAll('settings')]);
  DB={cases:cases.map(r=>rowToRec('cases',r)),procs:procs.map(r=>rowToRec('procs',r)),lines:lines.map(r=>rowToRec('lines',r)),
      orders:orders.map(r=>rowToRec('orders',r)),vendors:vendors.map(r=>rowToRec('vendors',r)),clients:clients.map(r=>rowToRec('clients',r)),
      prices:prices.map(r=>rowToRec('prices',r)),
      recv:{},paid:{},off:{},basis:'完工',seed:'db',seq:0,pseq:0,lseq:0,oseq:0,prseq:0};
  recv.forEach(r=>{DB.recv[r.client+'|'+r.month]=r.amount;});
  paid.forEach(r=>{DB.paid[r.who+'|'+r.month]=r.amount;});
  off.forEach(r=>{(DB.off[r.who]=DB.off[r.who]||{})[r.month]=(r.days||[]).slice();});
  settings.forEach(r=>{ if(r.key==='basis')DB.basis=r.value; });
  /* 案件は新しいものが上。採番は既存の最大＋1 から */
  DB.cases.sort((a,b)=>String(b.id).localeCompare(String(a.id)));
  const mx=(arr,re)=>arr.reduce((m,r)=>{const k=re.exec(String(r.id)); return k?Math.max(m,+k[1]):m;},0);
  DB.seq=mx(DB.cases,/^[CRN](\d+)/); DB.pseq=mx(DB.procs,/^[PQ](\d+)/); DB.lseq=mx(DB.lines,/^L(\d+)/); DB.prseq=mx(DB.prices,/^PR(\d+)/);
  migrate(); rememberAll();
  M.senzoku.length=0; DB.vendors.filter(v=>v.type==='専属').forEach(v=>M.senzoku.push(v.name));
  M.kensa=(DB.vendors.find(v=>v.defKind==='AW検査')||{}).name||'';
  dbState='読み込んだ '+new Date().toTimeString().slice(0,5);
  alog('load','cases='+DB.cases.length+' procs='+DB.procs.length+' lines='+DB.lines.length+' orders='+DB.orders.length);
}
function migrate(){
  if(!DB.basis)DB.basis='完工';
  DB.cases.forEach(c=>{ if(!c.ord)c.ord='未'; if(c.live==null)c.live=true; if(c.keyx==null)c.keyx=''; if(c.warr==null)c.warr=''; });
}
function reset(){ toast('v4 では「元データに戻す」は無い（データベースが正）'); }
function load(){ DB={cases:[],procs:[],lines:[],orders:[],vendors:[],clients:[],prices:[],recv:{},paid:{},off:{},basis:'完工',seed:'db',seq:0,pseq:0,lseq:0,oseq:0,prseq:0}; }

/* ---- 保存：変わった行だけ ---- */
function save(){ dbSaveSoon(); }
function dbSaveSoon(){ dbDirty=true; clearTimeout(dbSaveTimer); dbSaveTimer=setTimeout(dbSaveNow,400); }
async function dbSaveNow(){
  if(!sb||!dbDirty)return; if(dbBusy){dbSaveSoon();return;}
  dbBusy=true; dbDirty=false;
  try{
    /* 画面側で id 無しで作られたマスタ行に id を振る */
    (DB.vendors||[]).forEach(v=>{ if(!v.id)v.id='V'+Math.random().toString(36).slice(2,10); });
    (DB.clients||[]).forEach(c=>{ if(!c.id)c.id='CL'+Math.random().toString(36).slice(2,10); });
    for(const t of Object.keys(COLS)){
      const arr=DB[t]||[], seen=new Set(), ups=[], dels=[];
      const after=[];
      arr.forEach(r=>{ if(!r.id)return; seen.add(r.id); const k=t+':'+r.id, sg=sig(r); if(recLast[k]!==sg){ ups.push(recToRow(t,r)); after.push([k,sg]); } });
      Object.keys(recLast).forEach(k=>{ if(k.indexOf(t+':')!==0)return; const id=k.slice(t.length+1); if(!seen.has(id))dels.push(id); });
      if(dels.length){ const {error}=await sb.from(t).delete().in('id',dels); if(error)throw error; dels.forEach(id=>delete recLast[t+':'+id]); alog('del '+t,dels.length); }
      for(let i=0;i<ups.length;i+=200){ const {error}=await sb.from(t).upsert(ups.slice(i,i+200),{onConflict:'id'}); if(error)throw error; }
      after.forEach(([k,sg])=>{recLast[k]=sg;});     /* 成功してから「保存済み」にする（失敗分は次回また書く） */
      if(ups.length)alog('upsert '+t,ups.length);
    }
    const kv=JSON.stringify(kvObj());
    if(kv!==kvLast){
      const recv=Object.entries(DB.recv||{}).map(([k,v])=>{const [client,month]=k.split('|'); return {org:ORG,client,month,amount:+v||0};});
      const paid=Object.entries(DB.paid||{}).map(([k,v])=>{const [who,month]=k.split('|'); return {org:ORG,who,month,amount:+v||0};});
      const off=[]; Object.entries(DB.off||{}).forEach(([who,m])=>Object.entries(m||{}).forEach(([month,days])=>off.push({org:ORG,who,month,days:(days||[]).map(Number)})));
      if(recv.length){const {error}=await sb.from('receipts').upsert(recv); if(error)throw error;}
      if(paid.length){const {error}=await sb.from('payments').upsert(paid); if(error)throw error;}
      if(off.length){const {error}=await sb.from('days_off').upsert(off); if(error)throw error;}
      const {error}=await sb.from('settings').upsert({org:ORG,key:'basis',value:DB.basis||'完工'}); if(error)throw error;
      kvLast=kv;
    }
    dbState='保存した '+new Date().toTimeString().slice(0,5);
  }catch(e){
    dbDirty=true; dbState='保存できていない：'+String((e&&e.message)||e); alog('save ERR',(e&&e.message)||e);
    toast('保存に失敗した（'+String((e&&e.message)||e)+'）。もう一度操作するか、再読み込みしてください');
  }finally{ dbBusy=false; }
  const el=document.getElementById('dbState'); if(el)el.textContent=dbState;
}
window.addEventListener('beforeunload',()=>{ if(dbDirty){ clearTimeout(dbSaveTimer); dbSaveNow(); } });

/* ---- 他の人の変更を受け取る ---- */
let rtChan=null;
function dbSubscribe(){
  if(!sb||rtChan)return;
  rtChan=sb.channel('ledger');
  Object.keys(COLS).forEach(t=>{
    rtChan.on('postgres_changes',{event:'*',schema:'public',table:t},payload=>{
      const arr=DB[t]||[];
      if(payload.eventType==='DELETE'){ const id=payload.old&&payload.old.id; const i=arr.findIndex(r=>r.id===id); if(i>=0){arr.splice(i,1); delete recLast[t+':'+id]; renderIdle();} return; }
      const rec=rowToRec(t,payload.new); const k=t+':'+rec.id, sg=sig(rec);
      if(recLast[k]===sg)return;                       /* 自分の書き込みの反射 */
      const i=arr.findIndex(r=>r.id===rec.id);
      if(i>=0){ const l=arr[i]; Object.keys(l).forEach(x=>delete l[x]); Object.assign(l,rec); } else { if(t==='cases')arr.unshift(rec); else arr.push(rec); }
      recLast[k]=sg;
      if(t==='orders'&&typeof onOrderRemote==='function'){ try{ onOrderRemote(arr.find(r=>r.id===rec.id)); }catch(e){ alog('onOrderRemote',e&&e.message); } }
      renderIdle();
    });
  });
  rtChan.subscribe(st=>{ alog('realtime',st); });
}
let idleTimer=null;
function renderIdle(){
  clearTimeout(idleTimer);
  const a=document.activeElement, typing=a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&!a.closest('.ask');
  if(typing||document.querySelector('.ask')){ idleTimer=setTimeout(renderIdle,3000); return; }
  render();
}
/* 発注番号：サーバーの連番 */
async function allocOrderNo(){ const {data,error}=await sb.rpc('next_no',{p_org:ORG,p_name:'order'}); if(error)throw error; return +data; }
function purgeShared(){ /* v4 では不要（行単位の delete で消える） */ }
function known(){ }

/* ---- ログイン ---- */
async function initAuth(){
  sb=window.supabase.createClient(SB_URL,SB_KEY);
  const {data:{session}}=await sb.auth.getSession(); SESSION=session;
  sb.auth.onAuthStateChange((_e,s)=>{ SESSION=s; if(s&&!ME)boot(); if(!s){ME=null; render();} });
  if(SESSION)await boot(); else render();
}
async function boot(){
  try{
    const {data:me}=await sb.from('profiles').select('*').eq('id',SESSION.user.id).single();
    ME=me||{role:'staff',org:'hq'}; ORG=ME.org||'hq';
    await dbLoad(); dbSubscribe(); render();
    await reloadInbox();
  }catch(e){ dbState='読み込めなかった：'+String((e&&e.message)||e); toast(dbState); render(); }
}
async function sendMagicLink(email){
  const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});
  if(error){toast('送れなかった：'+error.message);return false;}
  toast('ログイン用のリンクをメールで送った。メールのリンクを開くと入れます'); return true;
}
async function signOut(){ await sb.auth.signOut(); ME=null; SESSION=null; location.reload(); }
