// ページ側に差し込む supabase-js もどき。from().select().range() / upsert / delete().in() / rpc / auth / channel
(function(){
  const call=async(body)=>{ const r=await fetch('http://localhost:8787/',{method:'POST',body:JSON.stringify(body)}); return r.json(); };
  const listeners=[];
  function from(table){
    return {
      select:()=>({ range:(a,b)=>call({op:'select',table,range:[a,b]}), eq:()=>({single:async()=>({data:{id:'u1',role:'hq',org:'hq',name:'テスト'},error:null})}) }),
      upsert:(rows,opt)=>call({op:'upsert',table,rows:Array.isArray(rows)?rows:[rows],conflict:(opt&&opt.onConflict)||'id'}).then(r=>{ (Array.isArray(rows)?rows:[rows]).forEach(row=>listeners.forEach(l=>l(table,'UPDATE',row))); return r; }),
      delete:()=>({ in:(col,ids)=>call({op:'delete',table,ids}).then(r=>{ ids.forEach(id=>listeners.forEach(l=>l(table,'DELETE',{id}))); return r; }) }),
    };
  }
  window.supabase={createClient:()=>({
    from, rpc:(fn,args)=>call({op:'rpc',fn,args}),
    auth:{ getSession:async()=>({data:{session:window.__NOSESSION?null:{user:{id:'u1',email:'t@example.com'}}}}), onAuthStateChange:()=>{}, signInWithOtp:async()=>({error:null}), signOut:async()=>{} },
    channel:()=>{ const ch={on:(ev,opt,cb)=>{ listeners.push((t,type,row)=>{ if(t===opt.table)cb({eventType:type,new:row,old:row}); }); return ch; }, subscribe:(cb)=>{cb&&cb('SUBSCRIBED'); return ch;} }; return ch; },
  })};
  window.__fakeListeners=listeners;
})();
