-- 2026-11-20 写真台帳（案件ごと・区分ごと）。src/schema.sql と同じ内容。消す手順を含まない「足すだけ」の形。何度実行しても同じ結果
create table if not exists photos (             -- 写真台帳：案件ごと・区分ごと（現地調査／清掃／クロス貼替／リペア／その他／完了検査）。1枚1行
  id text primary key default ('F'||substr(replace(gen_random_uuid()::text,'-',''),1,12)),
  org text not null default 'hq' references orgs(id),
  case_id text not null references cases(id) on delete cascade,
  proc_id text default '',        -- どの工程から入れたか
  who text default '',            -- 入れた人（発注先名。社員も発注先として登録して業者ページから入れる）
  cat text not null default 'その他',
  phase text default '',          -- 前／後／''（清掃・クロス貼替・リペアは施工前後を分ける）
  path text not null unique,      -- 保存領域 reports の中の場所
  created_at timestamptz default now()
);
create index if not exists photos_case on photos(case_id);
alter table photos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='photos' and policyname='sel_photos') then
    create policy sel_photos on photos for select using (my_role()='hq' or org=my_org()); end if;
  if not exists (select 1 from pg_policies where tablename='photos' and policyname='ins_photos') then
    create policy ins_photos on photos for insert with check (my_role()='hq' or (my_role()='staff' and org=my_org())); end if;
  if not exists (select 1 from pg_policies where tablename='photos' and policyname='upd_photos') then
    create policy upd_photos on photos for update using (my_role()='hq' or (my_role()='staff' and org=my_org())); end if;
  if not exists (select 1 from pg_policies where tablename='photos' and policyname='del_photos') then
    create policy del_photos on photos for delete using (my_role()='hq' or (my_role()='staff' and org=my_org())); end if;
end $$;
-- ---------- 写真台帳 ----------
-- 業者ページから写真を登録（写真の本体は先に保存領域へ送ってある）。自分の工程の案件にだけ。場所は自分のリンクのフォルダだけ
create or replace function add_photos(p_token text, p_proc text, p_cat text, p_phase text, p_paths jsonb) returns int
language plpgsql security definer as $$
declare v vendors; p procs; n int;
begin
  select * into v from vendors where token=p_token and active; if not found then return 0; end if;
  select * into p from procs where id=p_proc and who=v.name; if not found then return 0; end if;
  insert into photos(org,case_id,proc_id,who,cat,phase,path)
  select p.org, p.case_id, p.id, v.name, coalesce(nullif(p_cat,''),'その他'), coalesce(p_phase,''), x
  from jsonb_array_elements_text(coalesce(p_paths,'[]'::jsonb)) x where x like p_token||'/%'
  on conflict (path) do nothing;
  get diagnostics n = row_count; return n;
end $$;
-- 業者ページ：その工程の案件で、自分が入れた写真
create or replace function my_photos(p_token text, p_proc text) returns table(id text, cat text, phase text, path text, created_at timestamptz)
language sql security definer stable as $$
  select f.id, f.cat, f.phase, f.path, f.created_at from vendors v join procs p on p.who=v.name and p.id=p_proc
    join photos f on f.case_id=p.case_id and f.who=v.name
  where v.token=p_token and v.active order by f.created_at $$;
-- 業者ページ：自分が入れた写真を外す（その工程の完了報告が承認される前だけ）。本体は画面から保存領域で消す
create or replace function del_my_photo(p_token text, p_id text) returns boolean
language sql security definer as $$
  delete from photos f using vendors v where v.token=p_token and v.active and f.who=v.name and f.id=p_id
    and not exists (select 1 from reports r where r.proc_id=f.proc_id and r.st='承認') returning true $$;
-- 台帳：案件の写真（スタッフだけ）
create or replace function case_photos(p_case text) returns table(id text, proc_id text, who text, cat text, phase text, path text, created_at timestamptz)
language sql security definer stable as $$
  select f.id, f.proc_id, f.who, f.cat, f.phase, f.path, f.created_at from photos f
  where f.case_id=p_case and my_role() in ('hq','staff','viewer') and (my_role()='hq' or f.org=my_org()) order by f.cat, f.phase, f.created_at $$;
do $$ begin
  if exists (select 1 from pg_namespace where nspname='storage')
     and not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='reports_vendor_delete') then
    execute $p$create policy reports_vendor_delete on storage.objects for delete to anon
      using (bucket_id='reports' and public.vendor_token_ok((storage.foldername(name))[1]))$p$;
  end if;
end $$;
do $$ declare f text; begin
  foreach f in array array['add_photos(text,text,text,text,jsonb)','my_photos(text,text)','del_my_photo(text,text)','case_photos(text)'] loop
    execute format('alter function %s set search_path = public', f);
  end loop; end $$;
revoke execute on function add_photos(text,text,text,text,jsonb), my_photos(text,text), del_my_photo(text,text), case_photos(text) from public;
grant execute on function add_photos(text,text,text,text,jsonb), my_photos(text,text), del_my_photo(text,text) to anon, authenticated;
grant execute on function case_photos(text) to authenticated;
