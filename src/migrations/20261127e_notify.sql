-- 2026-11-27 発注を業者に知らせる（携帯の通知・メール）
--  ・vendor_push：業者ページで「通知を受け取る」を押した端末。書き込みは業者のリンク（vendors.token）で確かめる関数だけ
--  ・notify_log：知らせた記録（送るのは Edge Function notify-order。鍵は Supabase 側の環境変数だけ）
create table if not exists vendor_push (
  id bigserial primary key,
  org text not null default 'hq' references orgs(id),
  vendor_id text not null references vendors(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null default '',
  auth text not null default '',
  ua text default '',
  created_at timestamptz default now()
);
create index if not exists vendor_push_vendor on vendor_push(vendor_id);
alter table vendor_push enable row level security;
drop policy if exists sel_vendor_push on vendor_push; create policy sel_vendor_push on vendor_push for select using (my_role()='hq' or org=my_org());
revoke all on vendor_push from anon, authenticated;
grant select (id, org, vendor_id, created_at) on vendor_push to authenticated;   -- 台帳は台数だけ見る（端末の宛先や鍵は見せない）

create or replace function push_subscribe(p_token text, p_endpoint text, p_p256dh text, p_auth text, p_ua text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v vendors%rowtype;
begin
  select * into v from vendors where token = p_token and active limit 1;
  if not found or coalesce(p_endpoint,'') !~ '^https://' or length(p_endpoint) > 1000 or coalesce(p_p256dh,'')='' or coalesce(p_auth,'')='' then return false; end if;
  insert into vendor_push(org, vendor_id, endpoint, p256dh, auth, ua) values (v.org, v.id, p_endpoint, p_p256dh, p_auth, left(coalesce(p_ua,''),200))
    on conflict (endpoint) do update set vendor_id=excluded.vendor_id, org=excluded.org, p256dh=excluded.p256dh, auth=excluded.auth, ua=excluded.ua;
  -- 1業者 10台まで（古い端末から外す）
  delete from vendor_push where vendor_id=v.id and id not in (select id from vendor_push where vendor_id=v.id order by created_at desc, id desc limit 10);
  return true;
end $$;
create or replace function push_unsubscribe(p_token text, p_endpoint text) returns boolean
language sql security definer set search_path = public as $$
  delete from vendor_push p using vendors v where v.token = p_token and p.vendor_id = v.id and p.endpoint = p_endpoint returning true $$;
revoke execute on function push_subscribe(text,text,text,text,text) from public;
revoke execute on function push_unsubscribe(text,text) from public;
grant execute on function push_subscribe(text,text,text,text,text) to anon, authenticated;
grant execute on function push_unsubscribe(text,text) to anon, authenticated;

create table if not exists notify_log (
  id bigserial primary key,
  org text not null default 'hq' references orgs(id),
  order_id text default '',
  vendor_id text default '',
  kind text not null,               -- push／mail
  ok boolean not null default false,
  detail text default '',
  at timestamptz default now()
);
create index if not exists notify_log_order on notify_log(order_id);
alter table notify_log enable row level security;
drop policy if exists sel_notify_log on notify_log; create policy sel_notify_log on notify_log for select using (my_role()='hq' or org=my_org());
revoke all on notify_log from anon, authenticated;
grant select on notify_log to authenticated;
