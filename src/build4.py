#!/usr/bin/env python3
"""app3.src.html（Artifact版）→ app4.src.html / index.html（Supabase版）を組み立てる。
   v3 の画面コードはそのまま、保存層だけ store4.js に差し替える。"""
import re, sys, os, json
HERE=os.path.dirname(os.path.abspath(__file__))
V3=os.path.join(HERE,'app3.src.html')
src=open(V3,encoding='utf-8').read()
store=open(os.path.join(HERE,'store4.js'),encoding='utf-8').read()
lines=src.split('\n')

def find(pat, start=0):
    for i in range(start,len(lines)):
        if pat in lines[i]: return i
    raise SystemExit('not found: '+pat)

# 1) 保存層の差し替え：const M = ... から snap/undo の直前まで
a=find("const M = /*__MODEL__*/;")
b=find("let lastSnapKey=null;")
lines[a:b]=store.split('\n')
# 2) 旧 beforeunload と起動の load() を消す
i=find("window.addEventListener('beforeunload',()=>{ if(dbDirty&&LDB)"); del lines[i]
i=next(i for i,l in enumerate(lines) if l.strip()=='load();'); lines[i]="load();   /* 空の DB。ログイン後に dbLoad() で埋まる */"
# 3) 受注受付：inbox 表から
a=find("let DBX=null, INBOX=null, inboxMsg='', PRICEIN=null;")
b=find("/* 単価表のうち、まだマスタに入っていないもの */")
keep=[l for l in lines[a:b] if not (l.startswith('async function openInbox') or l.startswith('async function reloadInbox'))]
# openInbox / reloadInbox の関数本体をそのまま取り除くため、区間を切り出して書き直す
seg='\n'.join(lines[a:b])+'\n'
seg=re.sub(r"async function openInbox\(\)\{.*?\n\}\n", "", seg, flags=re.S)
seg=re.sub(r"async function reloadInbox\(\)\{.*?\n  render\(\);\n\}\n", "", seg, flags=re.S)
assert 'DBX.collection' not in seg, 'reloadInbox not removed'
seg=seg.replace("let DBX=null, INBOX=null, inboxMsg='', PRICEIN=null;",
"""let INBOX=null, inboxMsg='', PRICEIN=[];
async function openInbox(){ /* v4：ログイン後に boot() が呼ぶ */ }
async function reloadInbox(){
  if(!sb||!SESSION)return;
  try{
    const rows=await fetchAll('inbox');
    INBOX=rows.map(r=>({_id:r.key,key:r.key,caseNo:r.case_no,client:r.client,orderNo:r.order_no,prop:r.prop,room:r.room,propCode:r.prop_code,
      recvDate:r.recv_date||'',net:r.net,tax:r.tax,gross:r.gross,estimate:r.estimate,plan:r.plan||'',moveIn:r.move_in||'',cancel:r.cancel||'',
      memo:r.memo,items:r.items,url:r.url,poLines:r.po_lines||undefined}));
    inboxMsg='';
    try{ autoMergeInbox(); }catch(e){}
  }catch(e){ INBOX=[]; inboxMsg='受注受付を読めなかった：'+String((e&&e.message)||e); }
  render();
}""")
lines[a:b]=seg.split('\n')
# 4) ダウンロード：ふつうのブラウザなので a[download]
a=find("let DL=null, canDl=null;")
b=find("async function exportCsv(){")
lines[a:b]=["""const DL={save:async({filename,data})=>{ const u=URL.createObjectURL(data); const el=document.createElement('a'); el.href=u; el.download=filename; document.body.appendChild(el); el.click(); el.remove(); setTimeout(()=>URL.revokeObjectURL(u),2000); }};
let canDl=true;"""]
# 5) 起動：render(); openInbox(); → initAuth()
i=find("openInbox();"); assert lines[i].strip()=='openInbox();'; lines[i]="initAuth();"
# 6) render()：未ログインならログイン画面
i=find("function render(){")
lines.insert(i+1,"""  if(!SESSION||!ME){ paintLogin(); return; }""")
# 7) 管理画面の v3 専用部分（元データに戻す・墓標・移行コピー）を v4 用に
src2='\n'.join(lines)
src2=src2.replace("""      ${location.hash==='#admin'?'<button class="btn small danger" id="resetBtn">元データに戻す（共有保存も10/20時点に戻る）</button>':'<span class="note" style="margin:0">「元データに戻す」は封印（共有保存ごと10/20時点に戻ってしまうため）</span>'}</div>""",
"""      <span class="note" style="margin:0">データベース：Supabase（${esc(SB_URL.replace(/^https?:\\/\\//,''))}）　ログイン中：${esc((ME&&(ME.name||ME.email))||'')}　役割：${esc((ME&&ME.role)||'')}</span>
      <button class="btn small" id="signOut">ログアウト</button></div>""")
# 移行コピーのカード → 取り込みカード
src2=re.sub(r"""    \$\{location\.hash==='#admin'\?`<div class="card" style="margin-top:10px"><h3 style="margin:0 0 6px">新しい台帳（v4）への移行</h3>.*?<button class="btn small primary" id="exportAll">全データをコピーする</button> <span id="exportMsg" class="note"></span></div>\n""",
"""    ${location.hash==='#admin'?`""", src2, flags=re.S)
src2=src2.replace("""診断ログ（この端末）　端末 ${esc(DEV)}　墓標 ${Object.keys(DB.tomb||{}).length}　状態 ${esc(dbState)}""",
                  """診断ログ（この端末）　端末 ${esc(DEV)}　状態 ${esc(dbState)}""")
# resetBtn handler → signOut / import handlers
src2=src2.replace("""  if(e.target.id==='resetBtn'){""","""  if(e.target.id==='signOut'){signOut();return;}
  if(e.target.id==='impRun'){importFromV3();return;}
  if(e.target.id==='resetBtn'){""")
# exportAll handler を外す
src2=re.sub(r"  if\(e\.target\.id==='exportAll'\)\{.*?\n    return;\}\n","",src2,flags=re.S)
# 元データ表記
src2=src2.replace("""    `元データ：${esc(M.asof)}<br>運用中""","""    `運用中""")
src2=src2.replace("""<br>（この画面の編集は元シートに書き戻しません）<br><span id="dbState">${esc(dbState||(LDB?'':'共有保存：未接続（この端末のみ）'))}</span>""",
                  """<br><span id="dbState">${esc(dbState)}</span>""")
EXTRA=r'''
/* 旧台帳からの取り込み：マスタタブの一番下、#admin を付けて開いた時だけ出す（手配ボードには置かない） */
function adminCards(){
  if(location.hash!=='#admin')return '';
  return `<div class="card" style="margin-top:18px"><h3 style="margin:0 0 6px">旧台帳（Artifact版）からの取り込み</h3>
      <p class="note">旧台帳のマスタ画面（#admin）で「全データをコピーする」を押してから、ここに貼り付けて「取り込む」。同じ id は上書き、無いものは追加。</p>
      <textarea id="impJson" style="width:100%;height:120px;font:11px ui-monospace,monospace" placeholder="ここに貼り付け"></textarea>
      <div class="bar"><button class="btn small primary" id="impRun">取り込む</button><span id="impMsg" class="note"></span></div></div>`;
}
function vMaster(){ return vMaster0()+adminCards(); }
function paintLogin(){
  const main=document.getElementById('main')||document.body;
  const email=(()=>{try{return localStorage.getItem('aw-email')||'';}catch(e){return '';}})();
  main.innerHTML=`<div class="card" style="max-width:420px;margin:60px auto;padding:24px">
    <h2 style="margin:0 0 6px">ワークス台帳</h2>
    <p class="note" style="margin:0 0 14px">会社のメールアドレスを入れると、ログイン用のリンクが届きます。</p>
    <input type="email" id="lgEmail" placeholder="name@and-w.co.jp" value="${esc(email)}" style="width:100%;margin-bottom:10px">
    <button class="btn primary" id="lgSend" style="width:100%">ログイン用リンクを送る</button>
    <p class="note" id="lgMsg" style="margin-top:10px">${esc(dbState)}</p></div>`;
  const btn=document.getElementById('lgSend');
  btn.onclick=async()=>{ const v=document.getElementById('lgEmail').value.trim(); if(!v){return;} try{localStorage.setItem('aw-email',v);}catch(e){}
    btn.disabled=true; const ok=await sendMagicLink(v); document.getElementById('lgMsg').textContent=ok?'メールを確認してください（届かない場合は迷惑メールも）':'送れませんでした'; btn.disabled=false; };
}
/* 旧台帳（Artifact版）の全データを貼り付けて取り込む */
async function importFromV3(){
  const ta=document.getElementById('impJson'), msg=document.getElementById('impMsg'); if(!ta)return;
  let d; try{ d=JSON.parse(ta.value); }catch(e){ msg.textContent='貼り付けた内容が読めない（JSON ではない）'; return; }
  if(!d||!Array.isArray(d.cases)){ msg.textContent='形式が違う'; return; }
  msg.textContent='取り込み中…';
  try{
    const put=async(t,recs)=>{ for(let i=0;i<recs.length;i+=200){ const {error}=await sb.from(t).upsert(recs.slice(i,i+200).map(r=>recToRow(t,r)),{onConflict:t==='vendors'?'name':'id'}); if(error)throw new Error(t+'：'+error.message); } };
    const vendors=(d.vendors||[]).map(v=>Object.assign({},v,{id:v.id||('V'+Math.random().toString(36).slice(2,10))}));
    const clients=(d.clients||[]).map(c=>Object.assign({},c,{id:c.id||('CL'+Math.random().toString(36).slice(2,10))}));
    await put('clients',clients); await put('vendors',vendors); await put('prices',d.prices||[]);
    await put('cases',d.cases||[]); await put('procs',d.procs||[]); await put('lines',d.lines||[]); await put('orders',d.orders||[]);
    const recv=Object.entries(d.recv||{}).map(([k,v])=>{const [client,month]=k.split('|'); return {org:ORG,client,month,amount:+v||0};});
    const paid=Object.entries(d.paid||{}).map(([k,v])=>{const [who,month]=k.split('|'); return {org:ORG,who,month,amount:+v||0};});
    const off=[]; Object.entries(d.off||{}).forEach(([who,m])=>Object.entries(m||{}).forEach(([month,days])=>off.push({org:ORG,who,month,days:(days||[]).map(Number)})));
    if(recv.length){const {error}=await sb.from('receipts').upsert(recv); if(error)throw error;}
    if(paid.length){const {error}=await sb.from('payments').upsert(paid); if(error)throw error;}
    if(off.length){const {error}=await sb.from('days_off').upsert(off); if(error)throw error;}
    await sb.from('settings').upsert({org:ORG,key:'basis',value:d.basis||'完工'});
    msg.textContent=`取り込んだ：案件 ${(d.cases||[]).length}・工程 ${(d.procs||[]).length}・明細 ${(d.lines||[]).length}・発注 ${(d.orders||[]).length}。読み直します`;
    await dbLoad(); render();
  }catch(e){ msg.textContent='失敗：'+String((e&&e.message)||e); }
}
'''
assert src2.count("function vMaster(){")==1
src2=src2.replace("function vMaster(){","function vMaster0(){")
i=src2.index("render();\ninitAuth();")
src2=src2[:i]+EXTRA+"\n"+src2[i:]
# v4 固有の画面追加：発注書に業者用リンク、発注先マスタに職人用リンク
n_os=src2.count('''    <div class="askbtn" style="margin-top:14px"><button class="btn small" id="askNo">閉じる</button></div></div>`;''')
assert n_os==1, '発注書の差し替え先が見つからない（app3 の orderSheet が変わった？）'
src2=src2.replace("function orderSheet(oid){",'''/* 業者に送る文面（メール・LINE 共通） */
/* 業者ページのリンクを作り直す（古いリンクは使えなくなる） */
async function resetVendorLink(nm){
  const v=vendorOf(nm); if(!v)return;
  if(!confirm(`${nm} さんの業者ページのリンクを作り直しますか？\n今のリンクはすぐ使えなくなります。新しいリンクを送り直してください。`))return;
  const {data,error}=await sb.rpc('reset_vendor_token',{p_name:nm});
  if(error||!data){ toast('作り直せなかった：'+((error&&error.message)||'')); return; }
  v.token=data; render(); copyText(vendorLink(v),`${nm} さんの新しいリンクをコピーした。送り直してください`);
}
function orderMessage(o,c,v){
  const amt=orderLines(o.id).reduce((a,l)=>a+lineAmt(l),0);
  const subject=`【発注書】${o.no} ${c.prop||''}`;
  const body=[`${v.full||o.who||''} 様`,'','いつもお世話になっております。アンドワークスです。',
    '下記の工事を発注いたします。リンク先で内容をご確認のうえ、「承諾」を押してください。','',
    `発注No：${o.no}`,`現場：${c.prop||''}`,`工期：${o.start?spanLabel({date:o.start,end:o.end}):'未定'}`,
    orderTaxable(o)?`金額：${yen(inc(amt))}（税込）`:`金額：${yen(amt)}（消費税なし）`, ...(o.due?[`回答期限：${o.due}`]:[]),'',
    `発注書：${orderLink(o)}`, ...(v.token?['',`これまでの発注の一覧（承諾待ち・工程）：${vendorLink(v)}`]:[]),'','アンドワークス株式会社'].join('\\n');
  return {subject,body};
}
function orderSheet(oid){''',1)
src2=src2.replace('''    <div class="askbtn" style="margin-top:14px"><button class="btn small" id="askNo">閉じる</button></div></div>`;
  document.body.appendChild(el);
  el.querySelector('#askNo').onclick=()=>el.remove();
}''','''    <div class="askbtn obact" style="flex-wrap:wrap;gap:6px">
      ${o.st==='下書き'?`<button class="btn primary" id="oSent" title="発注書を業者ページに出す。業者が見て「承諾」を押せるようになる。状態が「送付済」になる">発注</button>`:''}
      ${o.token?`<button class="btn small" id="oLink" title="発注No・現場・工期・金額と、発注書のリンクをコピーする。LINE やメールに貼って業者に知らせる">リンクをコピー</button><a class="btn small" href="${esc(orderLink(o))}" target="_blank" rel="noopener">業者の画面を見る</a>`:''}
      <span class="grow"></span><button class="btn small" id="askNo">閉じる</button></div>
    <p class="note" style="margin:6px 0 0">${o.st==='下書き'?'「発注」を押すと、業者ページに出て、業者が承諾できるようになる。':'この発注書は業者ページに出ている。'}${o.st==='下書き'?'押すと自動で業者に知らせる（'+vReachLabel(v)+'）。':''}${orderNotifyNote(o)?'<b>'+orderNotifyNote(o)+'。</b>':''}届かない業者には「リンクをコピー」して、LINE やメールに貼る。</p></div>`;
  document.body.appendChild(el);
  el.querySelector('#askNo').onclick=()=>el.remove();
  const lk=el.querySelector('#oLink'); if(lk)lk.onclick=()=>copyText(orderMessage(o,c,v).body,'文面とリンクをコピーした。LINE やメールに貼って知らせる');
  const sn=el.querySelector('#oSent'); if(sn)sn.onclick=()=>{ el.remove(); nextOrderSt(o.id);
    };
}''')
src2=src2.replace('''        <th class="r">使用</th><th class="r">旧区分</th><th></th></tr></thead>''','''        <th class="r">使用</th><th class="r">旧区分</th><th title="業者・職人が自分への発注と工程を見るページ（ログイン無し）">業者ページ</th><th></th></tr></thead>''')
src2=src2.replace('''        <td class="r">${old?`<b style="color:var(--warn)">${old}</b>`:'—'}</td>
        <td>${old?`<button class="btn small" data-conv="${esc(v.name)}">旧${old}件を直す</button> `:''}${''','''        <td class="r">${old?`<b style="color:var(--warn)">${old}</b>`:'—'}</td>
        <td style="white-space:nowrap">${v.token?`<button class="btn small" data-vlink="${esc(v.name)}" title="業者・職人が自分への発注と工程を見るページのリンクをコピー。最初に1回送れば、新しい発注は自動でそのページに出る">リンク</button> <button class="btn small" data-vreset="${esc(v.name)}" title="リンクが漏れたときに作り直す。古いリンクはすぐ使えなくなる">作り直す</button>`:''}</td>
        <td>${old?`<button class="btn small" data-conv="${esc(v.name)}">旧${old}件を直す</button> `:''}${''')
src2=src2.replace('''  const osh=e.target.closest('[data-osheet]'); if(osh){orderSheet(osh.dataset.osheet);return;}''','''  const osh=e.target.closest('[data-osheet]'); if(osh){orderSheet(osh.dataset.osheet);return;}
  const vl=e.target.closest('[data-vlink]'); if(vl){ const v=vendorOf(vl.dataset.vlink); copyText(vendorLink(v),`${v.name} さんの業者ページのリンクをコピーした`); return; }
  const vr=e.target.closest('[data-vreset]'); if(vr){ resetVendorLink(vr.dataset.vreset); return; }''')
src2=src2.replace("M.kensa||'藤森正則'","M.kensa||'検査担当'").replace("// 藤森の検査予定（この月）","// 検査担当の検査予定（この月）")
assert '藤森' not in src2 and '長沼' not in src2, '個人名がコードに残っている'
assert '統合台帳' not in src2, '旧名称（統合台帳）が画面に残っている'
open(os.path.join(HERE,'app4.src.html'),'w',encoding='utf-8').write(src2)

# 8) 公開用 index.html：完全な HTML に包み、supabase-js を読み込み、URL/KEY を差し込む
cfg={}
try: cfg=json.load(open(os.path.join(HERE,'config.json')))
except Exception: pass
page=src2.replace('__SB_URL__',cfg.get('url','')).replace('__SB_KEY__',cfg.get('anon','')).replace('/*__MODEL__*/','null')
page=page.replace('<meta name="claude:viewport-fit-sides" content="true">\n','')
head='<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.min.js"></script>\n'
# <title> … <style>…</style> は head、残りは body
m=re.search(r'(<title>.*?</title>.*?</style>\n)',page,flags=re.S)
page=head+m.group(1)+'</head>\n<body>\n'+page[m.end():]+'\n</body>\n</html>\n'
# ログイン画面

OUT=os.path.join(HERE,'..','docs')
open(os.path.join(OUT,'index.html'),'w',encoding='utf-8').write(page)
# 職人・業者ページにも URL/KEY を差し込む（docs/ のファイルを正とするため、プレースホルダが残っていれば置換）
for f in ('me.html','order.html'):
    fp=os.path.join(OUT,f); t=open(fp,encoding='utf-8').read()
    t=re.sub(r"const SB_URL='[^']*', SB_KEY='[^']*';", "const SB_URL='%s', SB_KEY='%s';"%(cfg.get('url',''),cfg.get('anon','')), t)
    open(fp,'w',encoding='utf-8').write(t)
print('built', len(page))
