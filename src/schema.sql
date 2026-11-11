-- Aチーム統合台帳 v4 — Supabase (PostgreSQL) スキーマ
-- 方針：
--   * すべての表に org（所属：hq＝本部／fc_a..fc_d）。本部版では全行 'hq'。
--   * id は既存のテキスト id をそのまま使う（移行で C1302 / P00012 / L284-c8d などを維持）。
--   * JS 側の項目名と列名はできるだけ同じ。予約語だけ変える（case→case_id, order→order_id, end→end_date, date→start_date）。
--   * updated_at はトリガで自動。削除は物理削除（監査が要るものは audit に残す）。
--   * 権限は RLS：profiles.role が 'hq' なら全部、'fc' なら自分の org だけ。職人・業者は専用ビュー＋トークンで読む。

create extension if not exists pgcrypto;

-- ---------- 所属と利用者 ----------
create table if not exists orgs (
  id text primary key,            -- 'hq','fc_a','fc_b','fc_c','fc_d'
  name text not null,
  created_at timestamptz default now()
);
insert into orgs (id,name) values ('hq','本部') on conflict do nothing;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  org text not null default 'hq' references orgs(id),
  role text not null default 'staff',   -- 'hq'（本部管理者：全 org を見る）／'staff'（自 org の読み書き）／'viewer'（自 org の閲覧）
  created_at timestamptz default now()
);

-- ---------- マスタ ----------
create table if not exists clients (            -- 依頼元
  id text primary key default ('CL'||substr(gen_random_uuid()::text,1,8)),
  org text not null default 'hq' references orgs(id),
  name text not null,
  full_name text default '',
  mail text default '',
  method text default '',         -- 請求書の様式：先方規定／弊社仕様
  close_day int default 31,       -- 締日
  site int default 30,            -- 支払サイト（日）
  note text default '',
  src text default '',
  updated_at timestamptz default now(),
  unique(org,name)
);

create table if not exists vendors (            -- 発注先（職人・業者・経費）。全社共通（org は作成元の記録）
  id text primary key default ('V'||substr(gen_random_uuid()::text,1,8)),
  org text not null default 'hq' references orgs(id),
  name text not null unique,
  full_name text default '',
  type text default '外注',        -- 専属／外注／経費
  def_kind text default '',       -- 既定の工程区分
  inv text default '',            -- インボイス登録番号
  bank text default '',
  close_day int default 30,
  site int default 30,
  phone text default '',
  email text default '',
  token text unique default encode(gen_random_bytes(12),'hex'),  -- 職人ページ用の個人リンク
  active boolean default true,
  src text default '',
  updated_at timestamptz default now()
);

create table if not exists prices (             -- 単価表
  id text primary key,
  org text not null default 'hq' references orgs(id),
  name text not null,
  alias text default '',          -- 別名（／区切り）
  kind text default '',
  unit text default '式',
  price int default 0,
  who text default '',            -- 既定の発注先
  client text default '',         -- 依頼元別単価（空＝共通）
  memo text default '',
  updated_at timestamptz default now()
);

-- ---------- 案件 ----------
create table if not exists cases (
  id text primary key,
  org text not null default 'hq' references orgs(id),
  client text default '',         -- 依頼元名（clients.name）
  prop text default '',           -- 物件名＋号室
  kind text default '',
  st text default '受注',          -- 受注／施工中／完工／請求済 …
  live boolean default true,      -- 運用中
  ord text default '未',           -- 発注：未／済
  ord_by text default '',         -- 'order'＝発注から自動／'' ＝手動
  sales int default 0,            -- 売上税抜
  add_amt int default 0,          -- 追加
  bill text default '',           -- 請求月 YYYY-MM
  kisan date,                     -- 起算日
  want date,                      -- 依頼元の完了希望日
  plan date,                      -- 弊社の完了予定日
  plan_manual boolean default false,
  done date,                      -- 完工日
  keyx text default '',           -- 鍵交換（'有'／''）
  warr text default '',           -- 設備保証（'有'／''）
  recv text default '',           -- 受注受付の受付ID（inbox.key）
  case_no text default '',        -- 案件番号
  src text default '',
  memo text default '',
  items text default '',
  report text default '',
  photo text default '',
  addr text default '',           -- 現場住所（職人ページ用）
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists cases_org_live on cases(org,live);
create index if not exists cases_client on cases(client);
create index if not exists cases_done on cases(done);

create table if not exists procs (               -- 工程
  id text primary key,
  org text not null default 'hq' references orgs(id),
  case_id text not null references cases(id) on delete cascade,
  kind text default '',
  who text default '',            -- 発注先名
  start_date date,
  end_date date,
  amt int default 0,              -- 税込
  month text default '',          -- 支払月
  prog text default '',           -- 完了など
  order_id text default '',
  auto boolean default false,     -- 発注から自動生成
  memo text default '',
  updated_at timestamptz default now()
);
create index if not exists procs_case on procs(case_id);
create index if not exists procs_who_date on procs(who,start_date);

create table if not exists lines (               -- 明細
  id text primary key,
  org text not null default 'hq' references orgs(id),
  case_id text not null references cases(id) on delete cascade,
  no int,                         -- 依頼元の行番号
  name text default '',
  spec text default '',           -- 場所
  qty numeric default 1,
  unit text default '式',
  sell int default 0,             -- 販売単価
  price int default 0,            -- 原価単価
  kind text default '',
  who text default '',
  memo text default '',
  cut boolean default false,      -- 依頼元が落とした行
  src text default '',            -- 'PO'＝依頼元の発注書から
  order_id text default '',
  updated_at timestamptz default now()
);
create index if not exists lines_case on lines(case_id);

create table if not exists orders (              -- 発注
  id text primary key,
  org text not null default 'hq' references orgs(id),
  no text unique,                 -- AW-H0001
  case_id text not null references cases(id) on delete cascade,
  who text default '',
  kind text default '',
  start_date date,
  end_date date,
  due date,                       -- 回答期限
  naiyo text default '',
  memo text default '',
  st text default '下書き',         -- 下書き／送付済／承諾／完了／請求済
  sent timestamptz,
  accepted_at timestamptz,        -- 業者が承諾した日時
  accepted_by text default '',
  token text unique default encode(gen_random_bytes(12),'hex'),  -- 業者の承諾ページ用URL
  proc_id text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists orders_case on orders(case_id);
create index if not exists orders_who on orders(who);

-- ---------- 入金・支払・休み・設定 ----------
create table if not exists receipts (            -- 入金 recv：依頼元×月
  org text not null default 'hq' references orgs(id),
  client text not null,
  month text not null,
  amount int default 0,
  updated_at timestamptz default now(),
  primary key(org,client,month)
);
create table if not exists payments (            -- 支払済 paid：発注先×月
  org text not null default 'hq' references orgs(id),
  who text not null,
  month text not null,
  amount int default 0,
  updated_at timestamptz default now(),
  primary key(org,who,month)
);
create table if not exists days_off (            -- 職人の休み
  org text not null default 'hq' references orgs(id),
  who text not null,
  month text not null,
  days int[] default '{}',
  primary key(org,who,month)
);
create table if not exists settings (            -- 計上基準など
  org text not null default 'hq' references orgs(id),
  key text not null,
  value jsonb,
  primary key(org,key)
);

-- ---------- 受注受付（定期タスク・GAS が書く） ----------
create table if not exists inbox (
  key text primary key,           -- 受付ID
  org text not null default 'hq' references orgs(id),
  case_no text default '',
  client text default '',
  order_no text default '',
  prop text default '',
  room text default '',
  prop_code text default '',
  recv_date date,
  net int default 0, tax int default 0, gross int default 0,
  estimate int default 0,
  plan date, move_in date, cancel date,
  memo text default '', items text default '', url text default '',
  po_lines jsonb,                 -- 依頼元の発注書の明細（配列）
  merged_case text default '',    -- 台帳に取り込んだ案件 id
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- 採番 ----------
create table if not exists counters (
  org text not null references orgs(id),
  name text not null,
  value bigint not null default 0,
  primary key(org,name)
);
insert into counters(org,name,value) values ('hq','order',0),('hq','case',0),('hq','proc',0),('hq','line',0),('hq','price',0)
  on conflict do nothing;

create or replace function next_no(p_org text, p_name text) returns bigint
language sql security definer as $$
  insert into counters(org,name,value) values (p_org,p_name,1)
  on conflict (org,name) do update set value = counters.value + 1
  returning value;
$$;

-- ---------- updated_at ----------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['clients','vendors','prices','cases','procs','lines','orders','receipts','payments','inbox'] loop
    execute format('drop trigger if exists touch_%1$s on %1$s; create trigger touch_%1$s before update on %1$s for each row execute function touch_updated_at();', t);
  end loop; end $$;

-- ---------- 監査（消した・直した記録。後で「誰がいつ」を追える） ----------
create table if not exists audit (
  id bigserial primary key,
  at timestamptz default now(),
  uid uuid default auth.uid(),
  tbl text, op text, row_id text, before jsonb, after jsonb
);
create or replace function audit_row() returns trigger language plpgsql security definer as $$
begin
  if tg_op='DELETE' then insert into audit(tbl,op,row_id,before) values (tg_table_name,tg_op,old.id,to_jsonb(old)); return old;
  elsif tg_op='UPDATE' then insert into audit(tbl,op,row_id,before,after) values (tg_table_name,tg_op,new.id,to_jsonb(old),to_jsonb(new)); return new;
  else insert into audit(tbl,op,row_id,after) values (tg_table_name,tg_op,new.id,to_jsonb(new)); return new; end if;
end $$;
do $$ declare t text; begin
  foreach t in array array['cases','procs','lines','orders'] loop
    execute format('drop trigger if exists audit_%1$s on %1$s; create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function audit_row();', t);
  end loop; end $$;

-- ---------- 権限（RLS） ----------
create or replace function my_role() returns text language sql stable security definer as $$
  select coalesce((select role from profiles where id = auth.uid()), 'none') $$;
create or replace function my_org() returns text language sql stable security definer as $$
  select coalesce((select org from profiles where id = auth.uid()), '') $$;
-- 読める：本部管理者は全部、それ以外は自 org。書ける：本部管理者と staff（自 org）。
do $$ declare t text; begin
  foreach t in array array['clients','vendors','prices','cases','procs','lines','orders','receipts','payments','days_off','settings','inbox'] loop
    execute format('alter table %1$s enable row level security;', t);
    execute format('drop policy if exists sel_%1$s on %1$s; create policy sel_%1$s on %1$s for select using (my_role()=''hq'' or org=my_org());', t);
    execute format('drop policy if exists ins_%1$s on %1$s; create policy ins_%1$s on %1$s for insert with check (my_role()=''hq'' or (my_role()=''staff'' and org=my_org()));', t);
    execute format('drop policy if exists upd_%1$s on %1$s; create policy upd_%1$s on %1$s for update using (my_role()=''hq'' or (my_role()=''staff'' and org=my_org()));', t);
    execute format('drop policy if exists del_%1$s on %1$s; create policy del_%1$s on %1$s for delete using (my_role()=''hq'' or (my_role()=''staff'' and org=my_org()));', t);
  end loop; end $$;
alter table profiles enable row level security;
drop policy if exists sel_profiles on profiles; create policy sel_profiles on profiles for select using (id=auth.uid() or my_role()='hq');
drop policy if exists upd_profiles on profiles; create policy upd_profiles on profiles for update using (my_role()='hq');
alter table orgs enable row level security;
drop policy if exists sel_orgs on orgs; create policy sel_orgs on orgs for select using (true);
alter table counters enable row level security;   -- next_no() は security definer なので直接は触れない
alter table audit enable row level security;
drop policy if exists sel_audit on audit; create policy sel_audit on audit for select using (my_role()='hq');

-- 新規ユーザーに profile を自動で作る（役割は本部が後で直す）
create or replace function handle_new_user() returns trigger language plpgsql security definer as $$
begin insert into profiles(id,email,name) values (new.id,new.email,split_part(new.email,'@',1)) on conflict do nothing; return new; end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ---------- 職人・業者向け（ログイン無し、トークンで） ----------
-- 職人：自分の工程（vendors.token で引く）。業者：発注1件（orders.token で引く）。anon から RPC だけ許す。
create or replace function my_schedule(p_token text, p_from date, p_to date)
returns table(proc_id text, case_id text, prop text, addr text, kind text, start_date date, end_date date, prog text, memo text, client text)
language sql security definer stable as $$
  select p.id, c.id, c.prop, c.addr, p.kind, p.start_date, p.end_date, p.prog, p.memo, c.client
  from procs p join cases c on c.id=p.case_id join vendors v on v.name=p.who
  where v.token=p_token and v.active and p.start_date between p_from and p_to
  order by p.start_date, c.prop $$;
create or replace function order_view(p_token text)
returns table(order_no text, who text, kind text, start_date date, end_date date, due date, naiyo text, memo text, st text, accepted_at timestamptz,
              prop text, addr text, client text, lines jsonb)
language sql security definer stable as $$
  select o.no, o.who, o.kind, o.start_date, o.end_date, o.due, o.naiyo, o.memo, o.st, o.accepted_at, c.prop, c.addr, c.client,
    (select jsonb_agg(jsonb_build_object('name',l.name,'spec',l.spec,'qty',l.qty,'unit',l.unit,'price',l.price,'memo',l.memo) order by l.no) from lines l where l.order_id=o.id)
  from orders o join cases c on c.id=o.case_id where o.token=p_token $$;
create or replace function order_accept(p_token text, p_by text) returns boolean
language sql security definer as $$
  update orders set st='承諾', accepted_at=now(), accepted_by=coalesce(p_by,'') where token=p_token and st in ('送付済','下書き') returning true $$;
create or replace function proc_done(p_token text, p_proc text, p_done boolean) returns boolean
language sql security definer as $$
  update procs p set prog = case when p_done then '完了' else '' end
  from vendors v where v.token=p_token and v.name=p.who and p.id=p_proc returning true $$;
create or replace function my_vendor(p_token text) returns table(name text, type text)
language sql security definer stable as $$ select name, type from vendors where token=p_token and active $$;
grant execute on function my_schedule(text,date,date), order_view(text), order_accept(text,text), proc_done(text,text,boolean), my_vendor(text) to anon, authenticated;

-- ---------- Realtime（他の人の変更を画面に流す） ----------
do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    execute 'alter publication supabase_realtime add table cases, procs, lines, orders, vendors, clients, prices';
  end if;
exception when others then null; end $$;

-- ---------- 仕上げ：security definer 関数の search_path 固定、anon に不要な実行権を外す ----------
do $$ declare f text; begin
  foreach f in array array['next_no(text,text)','my_role()','my_org()','audit_row()','handle_new_user()','my_schedule(text,date,date)','order_view(text)','order_accept(text,text)','proc_done(text,text,boolean)','my_vendor(text)'] loop
    execute format('alter function %s set search_path = public', f);
  end loop; end $$;
revoke execute on function next_no(text,text) from anon;
revoke execute on function my_role() from anon; revoke execute on function my_org() from anon;

-- ---------- 関数の実行権（Supabase は PUBLIC に既定で execute を与えるため明示的に外す） ----------
alter function touch_updated_at() set search_path = public;
revoke execute on function audit_row() from public, anon, authenticated;
revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function touch_updated_at() from public, anon, authenticated;
revoke execute on function my_role() from public, anon;
revoke execute on function my_org() from public, anon;
revoke execute on function next_no(text,text) from public, anon;
grant execute on function next_no(text,text) to authenticated;
revoke execute on function my_schedule(text,date,date), order_view(text), order_accept(text,text), proc_done(text,text,boolean), my_vendor(text) from public;
grant execute on function my_schedule(text,date,date), order_view(text), order_accept(text,text), proc_done(text,text,boolean), my_vendor(text) to anon, authenticated;
drop policy if exists none_counters on counters; create policy none_counters on counters for select using (my_role()='hq');
