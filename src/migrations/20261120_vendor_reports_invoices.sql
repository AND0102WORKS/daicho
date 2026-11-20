-- 2026-11-20 業者ページ：完了報告・請求書／支払明細書（src/schema.sql と同じ内容。消す手順を含まない「足すだけ」の形）
-- Supabase の SQL Editor にそのまま貼っても実行できる。何度実行しても同じ結果になる
create table if not exists reports (            -- 完了報告：工程1つに1つ（出し直しは上書き）
  id text primary key default ('R'||substr(replace(gen_random_uuid()::text,'-',''),1,12)),
  org text not null default 'hq' references orgs(id),
  proc_id text not null unique,
  case_id text not null references cases(id) on delete cascade,
  who text default '',
  done_date date,
  note text default '',           -- 業者のコメント
  base int default 0,             -- 報告した時点の発注金額（税抜）
  extra int default 0,            -- 追加金額（税抜）。スタッフが承認すると工程の金額に足される
  extra_note text default '',     -- 追加の理由
  photos jsonb default '[]',      -- 保存領域 reports の中の場所の一覧
  st text default '報告済',        -- 報告済／承認／差し戻し
  reply text default '',          -- 差し戻しの理由
  approved_at timestamptz,
  invoice_id text default '',     -- 請求書・支払明細書に載ったら入る（二重請求を防ぐ）
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists invoices (           -- 業者の請求書（業者が発行）／支払明細書（会社が発行）：発注先×締め期間
  id text primary key default ('I'||substr(replace(gen_random_uuid()::text,'-',''),1,12)),
  org text not null default 'hq' references orgs(id),
  who text not null,
  kind text default '請求書',      -- 請求書／支払明細書
  month text default '',          -- 締めた月 '2026-11'
  period_from date,
  period_to date,
  items jsonb default '[]',       -- 載せた完了報告の写し（物件・区分・完了日・金額）
  subtotal int default 0,         -- 税抜
  tax int default 0,
  total int default 0,
  taxable boolean default true,   -- 発行した時点の発注先の課税区分
  inv text default '',            -- 発行した時点の登録番号（インボイス）
  st text default '発行',          -- 発行／確認済（業者が支払明細書を確認）／支払済
  issued_at timestamptz default now(),
  confirmed_at timestamptz,
  paid_date date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);


do $$ declare t text; begin
  foreach t in array array['reports','invoices'] loop
    if not exists (select 1 from pg_trigger where tgname='touch_'||t) then
      execute format('create trigger touch_%1$s before update on %1$s for each row execute function touch_updated_at();', t); end if;
    execute format('alter table %1$s enable row level security;', t);
    if not exists (select 1 from pg_policies where tablename=t and policyname='sel_'||t) then
      execute format('create policy sel_%1$s on %1$s for select using (my_role()=''hq'' or org=my_org());', t); end if;
    if not exists (select 1 from pg_policies where tablename=t and policyname='ins_'||t) then
      execute format('create policy ins_%1$s on %1$s for insert with check (my_role()=''hq'' or (my_role()=''staff'' and org=my_org()));', t); end if;
    if not exists (select 1 from pg_policies where tablename=t and policyname='upd_'||t) then
      execute format('create policy upd_%1$s on %1$s for update using (my_role()=''hq'' or (my_role()=''staff'' and org=my_org()));', t); end if;
    if not exists (select 1 from pg_policies where tablename=t and policyname='del_'||t) then
      execute format('create policy del_%1$s on %1$s for delete using (my_role()=''hq'' or (my_role()=''staff'' and org=my_org()));', t); end if;
  end loop; end $$;
-- 業者ページの工程（今はこちらを使う）：my_schedule に、発注金額（amt・税抜）と完了報告（rep）を足したもの
create or replace function my_jobs(p_token text, p_from date, p_to date)
returns table(proc_id text, case_id text, prop text, addr text, kind text, start_date date, end_date date, prog text, memo text, client text, key_info text,
              amt int, rep jsonb)
language sql security definer stable as $$
  select s.*, coalesce(p.amt,0),
    (select jsonb_build_object('st',r.st,'reply',r.reply,'done_date',r.done_date,'note',r.note,'extra',r.extra,'extra_note',r.extra_note,
        'photos',r.photos,'billed',r.invoice_id<>'') from reports r where r.proc_id=s.proc_id)
  from my_schedule(p_token,p_from,p_to) s join procs p on p.id=s.proc_id $$;
-- ---------- 業者ページ：完了報告・請求 ----------
-- 業者ページのリンク（vendors.token）が有効か。写真の保存領域のきまり（anon が自分のフォルダにだけ置ける）で使う
create or replace function vendor_token_ok(p_token text) returns boolean
language sql security definer stable as $$ select exists(select 1 from vendors where token=p_token and active) $$;
-- 締め期間：締日（1〜27。28 以上は月末）で、その月に締める期間を返す。例：5日締めの 2026-11 → 10/6〜11/5
create or replace function close_period(p_month text, p_close int) returns table(pfrom date, pto date)
language sql immutable as $$
  with m as (select to_date(p_month||'-01','YYYY-MM-DD') d0)
  select case when coalesce(p_close,31)>=28 then d0 else ((d0 - interval '1 month')::date + least(p_close,27)) end,
         case when coalesce(p_close,31)>=28 then (d0 + interval '1 month' - interval '1 day')::date else d0 + (least(p_close,27)-1) end
  from m $$;
-- 完了報告を出す（出し直しは上書き）。承認済み・請求済みは出し直せない。出すと工程は「完了」
create or replace function submit_report(p_token text, p_proc text, p_done date, p_note text, p_extra int, p_extra_note text, p_photos jsonb)
returns boolean language plpgsql security definer as $$
declare v vendors; p procs;
begin
  select * into v from vendors where token=p_token and active; if not found then return false; end if;
  select * into p from procs where id=p_proc and who=v.name; if not found then return false; end if;
  if exists(select 1 from reports where proc_id=p_proc and (st='承認' or invoice_id<>'')) then return false; end if;
  insert into reports(org,proc_id,case_id,who,done_date,note,base,extra,extra_note,photos,st,reply)
  values(p.org,p.id,p.case_id,v.name,coalesce(p_done,(now() at time zone 'Asia/Tokyo')::date),coalesce(p_note,''),coalesce(p.amt,0),
         greatest(coalesce(p_extra,0),0),coalesce(p_extra_note,''),coalesce(p_photos,'[]'::jsonb),'報告済','')
  on conflict (proc_id) do update set done_date=excluded.done_date, note=excluded.note, base=excluded.base, extra=excluded.extra,
    extra_note=excluded.extra_note, photos=excluded.photos, st='報告済', reply='';
  update procs set prog='完了' where id=p.id;
  return true;
end $$;
-- 完了報告を取り消す（承認前だけ）。工程の「完了」も外す
create or replace function cancel_report(p_token text, p_proc text) returns boolean
language plpgsql security definer as $$
declare v vendors;
begin
  select * into v from vendors where token=p_token and active; if not found then return false; end if;
  if not exists(select 1 from procs where id=p_proc and who=v.name) then return false; end if;
  if exists(select 1 from reports where proc_id=p_proc and (st='承認' or invoice_id<>'')) then return false; end if;
  delete from reports where proc_id=p_proc;
  update procs set prog='' where id=p_proc;
  return true;
end $$;
-- 業者ページの「請求」：発注先の情報、完了報告（まだ請求書に載っていないもの）、請求書・支払明細書の一覧
create or replace function my_billing(p_token text) returns jsonb
language sql security definer stable as $$
  select jsonb_build_object(
    'vendor', jsonb_build_object('name',v.name,'full',v.full_name,'inv',v.inv,'taxable',coalesce(v.taxable,true),'close',v.close_day),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('proc_id',r.proc_id,'prop',c.prop,'kind',p.kind,'done_date',r.done_date,
                'base',r.base,'extra',r.extra,'extra_note',r.extra_note,'st',r.st,'reply',r.reply) order by r.done_date),'[]'::jsonb)
              from reports r join procs p on p.id=r.proc_id join cases c on c.id=r.case_id where r.who=v.name and r.invoice_id=''),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(i)-'org' order by i.issued_at desc),'[]'::jsonb) from invoices i where i.who=v.name))
  from vendors v where v.token=p_token and v.active $$;
-- 業者が請求書を発行する：締め期間内の「承認」済みで、まだ請求書に載っていない完了報告をまとめる。発行した ID を返す
create or replace function issue_invoice(p_token text, p_month text) returns text
language plpgsql security definer as $$
declare v vendors; pf date; pt date; its jsonb; sub int; tx int; nid text;
begin
  select * into v from vendors where token=p_token and active; if not found then raise exception 'link'; end if;
  select pfrom,pto into pf,pt from close_period(p_month,v.close_day);
  select coalesce(jsonb_agg(jsonb_build_object('report_id',r.id,'proc_id',r.proc_id,'prop',c.prop,'kind',p.kind,'done_date',r.done_date,
           'base',r.base,'extra',r.extra,'extra_note',r.extra_note) order by r.done_date),'[]'::jsonb), coalesce(sum(r.base+r.extra),0)
    into its, sub
    from reports r join procs p on p.id=r.proc_id join cases c on c.id=r.case_id
    where r.who=v.name and r.st='承認' and r.invoice_id='' and r.done_date between pf and pt;
  if jsonb_array_length(its)=0 then raise exception 'empty'; end if;
  tx := case when coalesce(v.taxable,true) then round(sub*0.1) else 0 end;
  insert into invoices(org,who,kind,month,period_from,period_to,items,subtotal,tax,total,taxable,inv)
  values(v.org,v.name,'請求書',p_month,pf,pt,its,sub,tx,sub+tx,coalesce(v.taxable,true),coalesce(v.inv,'')) returning id into nid;
  update reports set invoice_id=nid where id in (select x->>'report_id' from jsonb_array_elements(its) x);
  return nid;
end $$;
-- 会社が出した支払明細書を、業者が「内容を確認した」にする
create or replace function confirm_statement(p_token text, p_id text) returns boolean
language sql security definer as $$
  update invoices i set st='確認済', confirmed_at=now() from vendors v
  where v.token=p_token and v.active and i.who=v.name and i.id=p_id and i.kind='支払明細書' and i.st='発行' returning true $$;
-- 完了報告の写真：非公開の保存領域 reports。業者は自分のリンクの名前のフォルダにだけ置ける・見られる。スタッフは全部見られる
do $$ begin
  if exists (select 1 from pg_namespace where nspname='storage') then
    insert into storage.buckets(id,name,public) values ('reports','reports',false) on conflict (id) do nothing;
    if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='reports_vendor_insert') then
      execute $p$create policy reports_vendor_insert on storage.objects for insert to anon, authenticated
        with check (bucket_id='reports' and public.vendor_token_ok((storage.foldername(name))[1]))$p$; end if;
    if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='reports_vendor_select') then
      execute $p$create policy reports_vendor_select on storage.objects for select to anon
        using (bucket_id='reports' and public.vendor_token_ok((storage.foldername(name))[1]))$p$; end if;
    if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='reports_staff_select') then
      execute $p$create policy reports_staff_select on storage.objects for select to authenticated
        using (bucket_id='reports' and public.my_role() in ('hq','staff','viewer'))$p$; end if;
  end if;
end $$;

do $$ declare f text; begin
  foreach f in array array['my_jobs(text,date,date)','close_period(text,int)','vendor_token_ok(text)','submit_report(text,text,date,text,int,text,jsonb)','cancel_report(text,text)','my_billing(text)','issue_invoice(text,text)','confirm_statement(text,text)'] loop
    execute format('alter function %s set search_path = public', f);
  end loop; end $$;
revoke execute on function my_jobs(text,date,date), vendor_token_ok(text), submit_report(text,text,date,text,int,text,jsonb), cancel_report(text,text), my_billing(text), issue_invoice(text,text), confirm_statement(text,text) from public;
grant execute on function my_jobs(text,date,date), vendor_token_ok(text), submit_report(text,text,date,text,int,text,jsonb), cancel_report(text,text), my_billing(text), issue_invoice(text,text), confirm_statement(text,text) to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='reports') then
    execute 'alter publication supabase_realtime add table reports, invoices';
  end if;
end $$;
