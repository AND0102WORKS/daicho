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
  cases: {cols:['id','org','client','prop','kind','st','live','ord','ord_by','sales','add_amt','bill','kisan','want','plan','plan_manual','done','keyx','warr','recv','case_no','src','memo','items','report','photo','addr','key_info','madori','est_amt','est_date','est_file'],
          map:{add:'add_amt',planManual:'plan_manual',caseNo:'case_no',ordBy:'ord_by',keyInfo:'key_info',estAmt:'est_amt',estDate:'est_date',estFile:'est_file'}, dates:['kisan','want','plan','done','est_date'], bools:['live','plan_manual']},
  procs: {cols:['id','org','case_id','kind','who','start_date','end_date','amt','month','prog','order_id','auto','memo','ask','ask_at'],
          map:{case:'case_id',date:'start_date',end:'end_date',order:'order_id',askAt:'ask_at'}, dates:['start_date','end_date'], bools:['auto'], ts:['ask_at']},
  lines: {cols:['id','org','case_id','no','name','spec','qty','unit','sell','price','kind','who','memo','cut','src','order_id','cost_qty','cost_unit'],
          map:{case:'case_id',order:'order_id',cqty:'cost_qty',cunit:'cost_unit'}, dates:[], bools:['cut']},
  orders:{cols:['id','org','no','case_id','who','kind','start_date','end_date','due','naiyo','memo','st','sent','proc_id','taxable','token'],
          map:{case:'case_id',start:'start_date',end:'end_date',proc:'proc_id'}, dates:['start_date','end_date','due','sent'], bools:['taxable']},
  vendors:{cols:['id','org','name','full_name','type','def_kind','inv','bank','close_day','site','phone','email','taxable','kinds','active','src'],
          map:{full:'full_name',defKind:'def_kind',close:'close_day'}, dates:[], bools:['active','taxable']},
  clients:{cols:['id','org','name','full_name','mail','method','close_day','site','note','src','est_mode'],
          map:{full:'full_name',close:'close_day',estMode:'est_mode'}, dates:[], bools:[]},
  prices:{cols:['id','org','name','alias','kind','unit','price','who','client','memo'], map:{}, dates:[], bools:[]},
  /* 完了報告（業者ページから出る）。スタッフは承認・差し戻しだけ書く */
  reports:{cols:['id','org','proc_id','case_id','who','done_date','note','base','extra','extra_note','photos','st','reply','approved_at','invoice_id'],
          map:{proc:'proc_id',case:'case_id',done:'done_date',extraNote:'extra_note',approvedAt:'approved_at',invoiceId:'invoice_id'}, dates:['done_date'], bools:[], ts:['approved_at']},
  /* 業者の請求書（業者ページで発行）／支払明細書（台帳で発行） */
  invoices:{cols:['id','org','who','kind','month','period_from','period_to','items','subtotal','tax','total','taxable','inv','st','issued_at','confirmed_at','paid_date'],
          map:{from:'period_from',to:'period_to',issuedAt:'issued_at',confirmedAt:'confirmed_at',paidDate:'paid_date'}, dates:['period_from','period_to','paid_date'], bools:['taxable'], ts:['issued_at','confirmed_at']},
};
const REV={}; Object.keys(TABLES).forEach(t=>{ REV[t]={}; Object.entries(TABLES[t].map).forEach(([j,c])=>{REV[t][c]=j;}); });
/* 行（DBの列）→ JS のレコード */
function rowToRec(t,row){
  const T=TABLES[t], r={};
  Object.keys(row).forEach(c=>{ if(c==='updated_at'||c==='created_at')return;   /* token は読むだけ（職人・業者のリンク用。書き戻さない） */
    let v=row[c]; const j=REV[t][c]||c;
    if(v===null||v===undefined) v=(T.bools.indexOf(c)>=0)?(c==='taxable'):'';   /* 課税区分が空なら課税として扱う */
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
    else if((T.ts||[]).indexOf(c)>=0) v=v?String(v):null;   /* 日時。空は null */
    else if(T.bools.indexOf(c)>=0) v=!!v;
    else if(['sales','add_amt','est_amt','amt','sell','price','close_day','site','base','extra','subtotal','tax','total'].indexOf(c)>=0||(t==='lines'&&c==='no')) v=(v===''||v==null)?(c==='no'?null:0):Math.round(+v||0);   /* DB は int。小数だと保存が全部止まる */
    else if(c==='qty') v=(v===''||v==null)?0:(+v||0);
    else if(c==='cost_qty') v=(v===''||v==null)?null:(+v||0);   /* 空＝販売の数量と同じ */
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
const COLS={cases:1,procs:1,lines:1,orders:1,vendors:1,clients:1,prices:1,reports:1,invoices:1};
function rememberAll(){ recLast={}; Object.keys(COLS).forEach(t=>(DB[t]||[]).forEach(r=>{ if(r.id)recLast[t+':'+r.id]=sig(r); })); kvSaved=kvFlat(); }
/* 入金・支払済・休み・計上基準・見送り：最後に保存した値（キーごと）。
   全件をまとめて書くと、古い画面の人が他の人の入力を古い値で上書きしてしまうので、変わったキーだけ書く */
let kvSaved={recv:{},paid:{},off:{},skip:{},basis:'完工',pl:'null'};
function kvFlat(){
  const num=o=>{ const r={}; Object.entries(o||{}).forEach(([k,v])=>{ const n=Math.round(+v||0); if(n)r[k]=n; }); return r; };
  const off={}; Object.entries(DB.off||{}).forEach(([who,m])=>Object.entries(m||{}).forEach(([month,days])=>{ const d=(days||[]).map(Number).join(','); if(d)off[who+'|'+month]=d; }));
  const skip={}; Object.keys(DB.skip||{}).forEach(k=>{ if(DB.skip[k])skip[k]=1; });
  return {recv:num(DB.recv),paid:num(DB.paid),off,skip,basis:DB.basis||'完工',pl:JSON.stringify(DB.plItems||null)};
}
const kvChanged=(cur,old)=>[...new Set([...Object.keys(cur),...Object.keys(old)])].filter(k=>cur[k]!==old[k]);
const kvSplit=k=>{ const i=k.lastIndexOf('|'); return [k.slice(0,i),k.slice(i+1)]; };
const SKIP_KEY='inbox_skip:';

/* ---- 読み込み ---- */
async function fetchAll(t,select){
  const out=[]; let from=0; const step=1000;
  for(;;){ const {data,error}=await sb.from(t).select(select||'*').range(from,from+step-1); if(error)throw error; out.push(...(data||[])); if(!data||data.length<step)break; from+=step; }
  return out;
}
async function dbLoad(){
  const [cases,procs,lines,orders,vendors,clients,prices,recv,paid,off,settings,reports,invoices]=await Promise.all([
    fetchAll('cases'),fetchAll('procs'),fetchAll('lines'),fetchAll('orders'),fetchAll('vendors'),fetchAll('clients'),fetchAll('prices'),
    fetchAll('receipts'),fetchAll('payments'),fetchAll('days_off'),fetchAll('settings'),
    fetchAll('reports').catch(()=>[]),fetchAll('invoices').catch(()=>[])]);   /* 表がまだ無い DB でも台帳は開けるように */
  DB={cases:cases.map(r=>rowToRec('cases',r)),procs:procs.map(r=>rowToRec('procs',r)),lines:lines.map(r=>rowToRec('lines',r)),
      orders:orders.map(r=>rowToRec('orders',r)),vendors:vendors.map(r=>rowToRec('vendors',r)),clients:clients.map(r=>rowToRec('clients',r)),
      prices:prices.map(r=>rowToRec('prices',r)),
      reports:reports.map(r=>rowToRec('reports',r)),invoices:invoices.map(r=>rowToRec('invoices',r)),
      recv:{},paid:{},off:{},skip:{},basis:'完工',seed:'db',seq:0,pseq:0,lseq:0,oseq:0,prseq:0};
  recv.forEach(r=>{ if(+r.amount)DB.recv[r.client+'|'+r.month]=r.amount; });      /* 0 は「消した」の意味 */
  paid.forEach(r=>{ if(+r.amount)DB.paid[r.who+'|'+r.month]=r.amount; });
  off.forEach(r=>{ if((r.days||[]).length)(DB.off[r.who]=DB.off[r.who]||{})[r.month]=(r.days||[]).slice(); });
  settings.forEach(r=>{ if(r.key==='basis')DB.basis=r.value;
    else if(r.key==='cfg'&&r.value&&typeof r.value==='object')DB.cfg=r.value;
    else if(r.key==='pl_items'&&r.value&&typeof r.value==='object')DB.plItems=r.value;   /* 月次の科目（売上原価の内訳・販管費）。無ければ画面の既定 */   /* 会社ごとの設定（ボリュームの点数など）。無ければ画面の既定 */
    else if(String(r.key).indexOf(SKIP_KEY)===0&&r.value===true)DB.skip[String(r.key).slice(SKIP_KEY.length)]=1; });   /* 見送った受注受付 */
  /* 案件は新しいものが上。採番は既存の最大＋1 から */
  DB.cases.sort((a,b)=>String(b.id).localeCompare(String(a.id)));
  const mx=(arr,re)=>arr.reduce((m,r)=>{const k=re.exec(String(r.id)); return k?Math.max(m,+k[1]):m;},0);
  DB.seq=mx(DB.cases,/^[CRN](\d+)/); DB.pseq=mx(DB.procs,/^[PQ](\d+)/); DB.lseq=mx(DB.lines,/^L(\d+)/); DB.prseq=mx(DB.prices,/^PR(\d+)/);
  migrate(); rememberAll();
  if(typeof undoStack!=='undefined')undoStack.length=0; remoteLog.length=0;   /* 読み直す前の控えに戻すと、その間の他の人の変更を消してしまう */
  M.senzoku.length=0; DB.vendors.filter(v=>v.type==='専属').forEach(v=>M.senzoku.push(v.name));
  M.kensa=(DB.vendors.find(v=>v.defKind==='AW検査')||{}).name||'';
  dbState='読み込んだ '+new Date().toTimeString().slice(0,5);
  alog('load','cases='+DB.cases.length+' procs='+DB.procs.length+' lines='+DB.lines.length+' orders='+DB.orders.length);
}
function migrate(){
  if(!DB.basis)DB.basis='完工';
  if(!DB.skip)DB.skip={};
  DB.cases.forEach(c=>{ if(!c.ord)c.ord='未'; if(c.live==null)c.live=true; if(c.keyx==null)c.keyx=''; if(c.warr==null)c.warr='';
    if(c.st==='新規案件')c.st='受付'; });   /* v4 の状態一覧に「新規案件」は無い */
}
function reset(){ toast('v4 では「元データに戻す」は無い（データベースが正）'); }
function load(){ DB={cases:[],procs:[],lines:[],orders:[],vendors:[],clients:[],prices:[],reports:[],invoices:[],recv:{},paid:{},off:{},skip:{},basis:'完工',seed:'db',seq:0,pseq:0,lseq:0,oseq:0,prseq:0}; }

/* ---- 保存：変わった行だけ ---- */
function save(){ if(typeof syncOrdersFromProcs==='function'){ try{ syncOrdersFromProcs(); }catch(e){} } dbSaveSoon(); }
function dbSaveSoon(){ dbDirty=true; clearTimeout(dbSaveTimer); dbSaveTimer=setTimeout(dbSaveNow,400); }
async function dbSaveNow(){
  if(!sb||!dbDirty)return; if(dbBusy){dbSaveSoon();return;}
  dbBusy=true; dbDirty=false;
  try{
    /* 画面側で id 無しで作られたマスタ行に id を振る */
    (DB.vendors||[]).forEach(v=>{ if(!v.id)v.id='V'+Math.random().toString(36).slice(2,10); });
    (DB.clients||[]).forEach(c=>{ if(!c.id)c.id='CL'+Math.random().toString(36).slice(2,10); });
    /* 先に全部の表の差分を出し、自分が消す行・書く行を覚えておく（Realtime の反射を「他の人の変更」と取り違えないため。
       案件を消すと DB 側で工程・明細・発注も一緒に消え、その通知が自分の delete より先に届くことがある） */
    const plan={};
    for(const t of Object.keys(COLS)){
      const arr=DB[t]||[], seen=new Set(), ups=[], dels=[], after=[];
      arr.forEach(r=>{ if(!r.id)return; seen.add(r.id); const k=t+':'+r.id, sg=sig(r); if(recLast[k]!==sg){ const row=recToRow(t,r); ups.push(row); after.push([k,sg]); sentRows[k]=row; } });
      Object.keys(recLast).forEach(k=>{ if(k.indexOf(t+':')!==0)return; const id=k.slice(t.length+1); if(!seen.has(id)){ dels.push(id); ownDel[k]=Date.now(); } });
      plan[t]={ups,dels,after};
    }
    for(const t of Object.keys(COLS)){
      const {ups,dels,after}=plan[t];
      if(dels.length){ const {error}=await sb.from(t).delete().in('id',dels); if(error)throw error; dels.forEach(id=>delete recLast[t+':'+id]); alog('del '+t,dels.length); }
      for(let i=0;i<ups.length;i+=200){ const {error}=await sb.from(t).upsert(ups.slice(i,i+200),{onConflict:'id'}); if(error)throw error; }
      after.forEach(([k,sg])=>{recLast[k]=sg;});     /* 成功してから「保存済み」にする（失敗分は次回また書く） */
      if(ups.length)alog('upsert '+t,ups.length);
    }
    /* 入金・支払済・休み・計上基準・見送り：変わったキーだけ書く。消したものは 0（休みは空）で上書きする */
    const cur=kvFlat();
    const recv=kvChanged(cur.recv,kvSaved.recv).map(k=>{const [client,month]=kvSplit(k); return {org:ORG,client,month,amount:cur.recv[k]||0};});
    const paid=kvChanged(cur.paid,kvSaved.paid).map(k=>{const [who,month]=kvSplit(k); return {org:ORG,who,month,amount:cur.paid[k]||0};});
    const off=kvChanged(cur.off,kvSaved.off).map(k=>{const [who,month]=kvSplit(k); return {org:ORG,who,month,days:cur.off[k]?cur.off[k].split(',').map(Number):[]};});
    const sets=kvChanged(cur.skip,kvSaved.skip).map(k=>({org:ORG,key:SKIP_KEY+k,value:!!cur.skip[k]}));
    if(cur.basis!==kvSaved.basis)sets.push({org:ORG,key:'basis',value:cur.basis});
    if(cur.pl!==kvSaved.pl&&DB.plItems)sets.push({org:ORG,key:'pl_items',value:DB.plItems});
    if(recv.length){const {error}=await sb.from('receipts').upsert(recv); if(error)throw error; kvSaved.recv=cur.recv;}
    if(paid.length){const {error}=await sb.from('payments').upsert(paid); if(error)throw error; kvSaved.paid=cur.paid;}
    if(off.length){const {error}=await sb.from('days_off').upsert(off); if(error)throw error; kvSaved.off=cur.off;}
    if(sets.length){const {error}=await sb.from('settings').upsert(sets); if(error)throw error; kvSaved.skip=cur.skip; kvSaved.basis=cur.basis; kvSaved.pl=cur.pl;}
    dbState='保存した '+new Date().toTimeString().slice(0,5);
  }catch(e){
    dbDirty=true; dbState='保存できていない：'+String((e&&e.message)||e); alog('save ERR',(e&&e.message)||e);
    const em=String((e&&e.message)||e);
    toast(/JWT|permission denied|not authenticated|401/i.test(em)?'保存できなかった。ログインが切れている可能性があります。ページを再読み込みしてログインし直してください（'+em+'）'
      :'保存に失敗した（'+em+'）。もう一度操作するか、再読み込みしてください');
  }finally{ dbBusy=false; }
  const el=document.getElementById('dbState'); if(el)el.textContent=dbState;
}
window.addEventListener('beforeunload',()=>{ if(dbDirty){ clearTimeout(dbSaveTimer); dbSaveNow(); } });

/* ---- 他の人の変更を受け取る ---- */
let rtChan=null;
/* 自分が送った行・消した行（Realtime で戻ってくる反射を、他の人の変更と区別する） */
let sentRows={}, ownDel={};
function isOwnEcho(t,k,rec){
  const sent=sentRows[k]; if(!sent)return false;
  const got=recToRow(t,rec);
  return Object.keys(sent).every(c=>{ const a=sent[c], b=got[c]; return String(a==null?'':a)===String(b==null?'':b); });
}
/* 他の人（と職人・業者ページ）の変更の記録。「元に戻す」は画面全体を控えに戻すので、
   そのままだと控えを取った後に入った他の人の追加・変更まで消してしまう。戻したあとにこれを掛け直す */
let remoteLog=[], remoteSeq=0;
function logRemote(e){ if(!undoStack.length){ remoteLog.length=0; return; } e.seq=++remoteSeq; remoteLog.push(e); if(remoteLog.length>3000)remoteLog.splice(0,remoteLog.length-3000); }
function remoteCanReplay(seq){ return !remoteLog.length || remoteLog[0].seq<=(seq||0)+1; }
function remoteReplay(seq){
  remoteLog.forEach(e=>{ if(e.seq<=(seq||0))return; const arr=DB[e.t]; if(!arr)return;
    const id=e.del||e.rec.id, i=arr.findIndex(r=>r.id===id);
    if(e.del){ if(i>=0)arr.splice(i,1); return; }
    const rec=JSON.parse(JSON.stringify(e.rec));
    if(i>=0)arr[i]=rec; else if(e.t==='cases')arr.unshift(rec); else arr.push(rec); });
}
function dbSubscribe(){
  if(!sb||rtChan)return;
  rtChan=sb.channel('ledger');
  Object.keys(COLS).forEach(t=>{
    rtChan.on('postgres_changes',{event:'*',schema:'public',table:t},payload=>{
      const arr=DB[t]||[];
      if(payload.eventType==='DELETE'){ const id=payload.old&&payload.old.id; if(!id)return; const dk=t+':'+id;
        const mine=ownDel[dk]&&Date.now()-ownDel[dk]<60000; delete ownDel[dk];
        const i=arr.findIndex(r=>r.id===id);
        if(mine&&i<0)return;                           /* 自分が消した行の反射 */
        logRemote({t,del:id});
        if(i>=0){arr.splice(i,1); delete recLast[dk]; renderIdle();} return; }
      const rec=rowToRec(t,payload.new); const k=t+':'+rec.id, sg=sig(rec);
      if(recLast[k]===sg)return;                       /* 自分の書き込みの反射 */
      const i=arr.findIndex(r=>r.id===rec.id);
      if(i>=0&&isOwnEcho(t,k,rec)){                    /* 自分の書き込みの反射（DB が足した項目だけ受け取る。token など） */
        const l=arr[i]; let added=false; Object.keys(rec).forEach(x=>{ if(l[x]===undefined){ l[x]=rec[x]; added=true; } });
        ['vendor_id','client_id'].forEach(x=>{ if(rec[x]!==undefined&&l[x]!==rec[x])l[x]=rec[x]; });   /* 番号は DB が名前から埋める。画面は書かないので、いつも DB の値を受け取る */
        delete sentRows[k]; if(recLast[k]!==undefined)recLast[k]=sig(l); if(added)renderIdle(); return; }
      logRemote({t,rec:JSON.parse(JSON.stringify(rec))});
      if(i>=0){ const l=arr[i]; Object.keys(l).forEach(x=>delete l[x]); Object.assign(l,rec); } else { if(t==='cases')arr.unshift(rec); else arr.push(rec); }
      recLast[k]=sg;
      if(t==='orders'&&typeof onOrderRemote==='function'){ try{ onOrderRemote(arr.find(r=>r.id===rec.id)); }catch(e){ alog('onOrderRemote',e&&e.message); } }
      renderIdle();
    });
  });
  rtChan.subscribe(st=>{ alog('realtime',st);
    if(st==='SUBSCRIBED'){ if(rtDown)dbResync('つなぎ直し'); rtDown=false; }
    else if(st==='CHANNEL_ERROR'||st==='TIMED_OUT'||st==='CLOSED')rtDown=true; });
}
/* ---- 取り直し：Realtime が切れていた間（スリープ・回線切れ）の他の人・業者の変更を受け取る ----
   これが無いと、切れていた間の変更を知らないまま行を直したとき、行ごと古い値で上書きしてしまう（承諾・完了が元に戻る）。
   手元で直してまだ保存していない行は触らない。手元で消してまだ保存していない行は戻さない。 */
let rtDown=false, resyncBusy=false, hiddenAt=0;
async function dbResync(why){
  if(!sb||!ME||resyncBusy)return;
  if(dbBusy||dbDirty){ setTimeout(()=>dbResync(why),1500); return; }
  resyncBusy=true;
  try{
    const ts=Object.keys(COLS), got=await Promise.all(ts.map(t=>fetchAll(t).catch(()=>null)));
    const same=(t,a,b)=>JSON.stringify(recToRow(t,a))===JSON.stringify(recToRow(t,b));
    let n=0;
    ts.forEach((t,ix)=>{ const rows=got[ix]; if(!rows)return; const arr=DB[t]||(DB[t]=[]), seen=new Set();
      rows.forEach(row=>{ const rec=rowToRec(t,row), k=t+':'+rec.id; seen.add(rec.id);
        const i=arr.findIndex(r=>r.id===rec.id);
        if(i<0){ if(recLast[k]!==undefined)return;                       /* 手元で消して、まだ保存していない */
          logRemote({t,rec:JSON.parse(JSON.stringify(rec))}); if(t==='cases')arr.unshift(rec); else arr.push(rec); recLast[k]=sig(rec); n++; return; }
        const l=arr[i];
        if(recLast[k]===undefined||sig(l)!==recLast[k])return;           /* 手元で作った・直した行で、まだ保存していない */
        if(same(t,l,rec))return;
        logRemote({t,rec:JSON.parse(JSON.stringify(rec))});
        Object.keys(l).forEach(x=>delete l[x]); Object.assign(l,rec); recLast[k]=sig(l); n++;
        if(t==='orders'&&typeof onOrderRemote==='function'){ try{ onOrderRemote(l); }catch(e){} } });
      for(let i=arr.length-1;i>=0;i--){ const r=arr[i], k=t+':'+r.id;     /* 向こうで消えた行 */
        if(!r.id||seen.has(r.id)||recLast[k]===undefined||sig(r)!==recLast[k])continue;
        logRemote({t,del:r.id}); arr.splice(i,1); delete recLast[k]; n++; } });
    alog('resync',why+' '+n);
    if(n){ M.senzoku.length=0; DB.vendors.filter(v=>v.type==='専属').forEach(v=>M.senzoku.push(v.name)); renderIdle(); }
  }catch(e){ alog('resync ERR',(e&&e.message)||e); }
  finally{ resyncBusy=false; }
}
document.addEventListener('visibilitychange',()=>{ if(document.hidden){ hiddenAt=Date.now(); return; }
  if(hiddenAt&&Date.now()-hiddenAt>60000)dbResync('画面に戻った'); hiddenAt=0; });
window.addEventListener('online',()=>dbResync('回線が戻った'));
setInterval(()=>{ if(!document.hidden)dbResync('定期'); },600000);
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
  /* この中から supabase を直接呼ばない。auth の内部ロックを持ったまま呼ぶことになり、トークン更新と重なって詰まる。
     必ず setTimeout で外に出してから処理する */
  sb.auth.onAuthStateChange((ev,s)=>{ setTimeout(()=>onAuth(ev,s),0); });
  if(SESSION)await boot(); else render();
}
function onAuth(ev,s){
  const had=!!SESSION; SESSION=s;
  if(!s){ if(denied){ dbState=denied; denied=''; render(); return; }
    if(had||ME){ ME=null; dbState='ログインが切れました。もう一度ログインしてください'; alog('auth',ev+' signed out'); render(); } return; }
  if(ev==='TOKEN_REFRESHED')checkClock(s);
  if(!ME)boot();
}
/* 取り立てのトークンの残り時間が有効期間と大きく違う＝この端末の時計がずれている。
   ずれているとトークンが「もう切れた」と判定され続け、更新が繰り返されてログインが切れる */
let clockWarned=false;
function checkClock(s){
  if(clockWarned||!s||!s.expires_at||!s.expires_in)return;
  const left=s.expires_at-Date.now()/1000;
  if(Math.abs(left-s.expires_in)>180){ clockWarned=true; alog('clock','left='+Math.round(left)+' expires_in='+s.expires_in);
    toast('この端末の時計がずれているようです。ログインが切れやすくなるので、日付と時刻の自動設定を確かめてください'); }
}
/* 読み込みは同時に1本だけ。以前はログイン直後の通知（INITIAL_SESSION・SIGNED_IN・TOKEN_REFRESHED）ごとに
   読み込みが重ねて走り、そのたびにトークン更新が起きて、更新の回数制限に当たってログインが切れていた */
let bootP=null, bootFails=0, denied='';
function boot(){ if(!bootP)bootP=boot1().finally(()=>{ bootP=null; }); return bootP; }
async function boot1(){
  if(!SESSION||ME)return;
  if(bootFails>=3)return;     /* 続けて失敗したら自動では繰り返さない（再読み込みでやり直す） */
  try{
    let {data:me}=await sb.from('profiles').select('*').eq('id',SESSION.user.id).maybeSingle();
    if(!me){   /* 初回ログインの後で登録された人：登録（role_presets）があれば、ここで利用者として作る */
      try{ await sb.rpc('ensure_profile'); const r=await sb.from('profiles').select('*').eq('id',SESSION.user.id).maybeSingle(); me=r.data; }catch(e){ alog('ensure_profile',(e&&e.message)||e); } }
    if(!me||['hq','staff','viewer'].indexOf(me.role)<0){   /* 登録の無いメールアドレス：何も読み込まない */
      denied='このメールアドレスは台帳に登録されていません。管理者に登録を頼んでください（'+((SESSION.user&&SESSION.user.email)||'')+'）';
      alog('auth','not registered'); dbState=denied; toast(denied); try{ await sb.auth.signOut(); }catch(e){} SESSION=null; ME=null; dbState=denied; render(); return; }
    ME=me; ORG=ME.org||'hq';
    await dbLoad(); dbSubscribe(); bootFails=0; render();
    await reloadInbox();
  }catch(e){ bootFails++; ME=null; dbState='読み込めなかった：'+String((e&&e.message)||e)+'。ページを再読み込みしてください'; alog('boot ERR',(e&&e.message)||e); toast(dbState); render(); }
}
async function sendMagicLink(email){
  const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});
  if(error){toast('送れなかった：'+error.message);return false;}
  toast('ログイン用のリンクをメールで送った。メールのリンクを開くと入れます'); return true;
}
async function signOut(){ await sb.auth.signOut(); ME=null; SESSION=null; location.reload(); }
