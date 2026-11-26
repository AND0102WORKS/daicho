-- 2026-11-27 顧客への請求書（台帳で作る）。作った時点の中身を写して固定する。番号は月ごとの連番（next_no の 'bill-YYYY-MM'）
create table if not exists bills (
  id text primary key default ('B'||substr(replace(gen_random_uuid()::text,'-',''),1,12)),
  org text not null default 'hq' references orgs(id),
  no text not null default '',       -- 請求書番号 R-2611-001
  client text not null,              -- 顧客の名前（作った時点）
  client_id text default '',
  month text default '',             -- 締め月 '2026-11'
  period_from date,
  period_to date,
  items jsonb default '[]',          -- 載せた案件の写し（case_id・完工日・物件・区分・税抜金額）
  subtotal int default 0,            -- 税抜
  tax int default 0,                 -- 請求書の合計に対して1回だけ計算
  total int default 0,
  issued_date date,
  due_date date,                     -- 入金予定日
  st text default '請求済',           -- 請求済／入金済／取消
  paid_date date,
  paid_amt int default 0,
  memo text default '',
  updated_at timestamptz default now()
);
create index if not exists bills_month on bills(org, month);
alter table bills enable row level security;
drop policy if exists sel_bills on bills; create policy sel_bills on bills for select using (my_role()='hq' or org=my_org());
drop policy if exists ins_bills on bills; create policy ins_bills on bills for insert with check (my_role()='hq' or (my_role()='staff' and org=my_org()));
drop policy if exists upd_bills on bills; create policy upd_bills on bills for update using (my_role()='hq' or (my_role()='staff' and org=my_org()));
drop policy if exists del_bills on bills; create policy del_bills on bills for delete using (my_role()='hq' or (my_role()='staff' and org=my_org()));
revoke all on bills from anon;
grant select, insert, update, delete on bills to authenticated;
drop trigger if exists touch_bills on bills;
create trigger touch_bills before update on bills for each row execute function touch_updated_at();
drop trigger if exists audit_bills on bills;
create trigger audit_bills after insert or update or delete on bills for each row execute function audit_row();
do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='bills') then
    execute 'alter publication supabase_realtime add table bills';
  end if; end $$;
