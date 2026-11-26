-- 2026-11-26 振込先は、経理の担当と管理者だけが見られる（北村さんの指示）
--  ・人ごとに「経理の印」（profiles.fin）。初回ログイン前の人は role_presets.fin
--  ・振込先は別の表 vendor_bank に置き、印のある人だけが読み書きできる（印が無ければ DB が1行も返さない）
--  ・今 vendors.bank に入っている振込先は vendor_bank に写し、vendors.bank は空にする（置き場所が変わるだけ。消さない）
alter table profiles     add column if not exists fin boolean not null default false;
alter table role_presets add column if not exists fin boolean not null default false;
create or replace function my_fin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select fin from profiles where id = auth.uid()), false) $$;
revoke execute on function my_fin() from public;
grant execute on function my_fin() to anon, authenticated;

create table if not exists vendor_bank (
  vendor_id text primary key references vendors(id) on delete cascade,
  org text not null default 'hq' references orgs(id),
  bank text not null default '',
  updated_at timestamptz default now()
);
alter table vendor_bank enable row level security;
drop policy if exists sel_vendor_bank on vendor_bank; create policy sel_vendor_bank on vendor_bank for select using (my_fin() and (my_role()='hq' or org=my_org()));
drop policy if exists ins_vendor_bank on vendor_bank; create policy ins_vendor_bank on vendor_bank for insert with check (my_fin() and (my_role()='hq' or (my_role()='staff' and org=my_org())));
drop policy if exists upd_vendor_bank on vendor_bank; create policy upd_vendor_bank on vendor_bank for update using (my_fin() and (my_role()='hq' or (my_role()='staff' and org=my_org())));
drop policy if exists del_vendor_bank on vendor_bank; create policy del_vendor_bank on vendor_bank for delete using (my_fin() and (my_role()='hq' or (my_role()='staff' and org=my_org())));
revoke all on vendor_bank from anon;
grant select, insert, update, delete on vendor_bank to authenticated;
drop trigger if exists touch_vendor_bank on vendor_bank;
create trigger touch_vendor_bank before update on vendor_bank for each row execute function touch_updated_at();

-- 今ある振込先を写す
insert into vendor_bank(vendor_id, org, bank) select id, org, bank from vendors where coalesce(bank,'')<>''
  on conflict (vendor_id) do update set bank=excluded.bank;
-- vendors.bank はいつも空にする（古い画面を開いたままの人が保存しても、振込先が vendors に戻らない）
create or replace function vendors_no_bank() returns trigger language plpgsql set search_path = public as $$
begin new.bank := ''; return new; end $$;
drop trigger if exists vendors_no_bank on vendors;
create trigger vendors_no_bank before insert or update on vendors for each row execute function vendors_no_bank();
revoke execute on function vendors_no_bank() from public, anon, authenticated;
update vendors set bank='' where coalesce(bank,'')<>'';

-- 初回ログインのとき、登録（role_presets）の印も写す
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare p role_presets%rowtype;
begin
  select * into p from role_presets where lower(email)=lower(new.email);
  if not found then return new; end if;
  insert into profiles(id,email,name,org,role,fin)
    values (new.id, new.email, coalesce(nullif(p.name,''), split_part(new.email,'@',1)), p.org, p.role, coalesce(p.fin,false))
  on conflict (id) do nothing;
  return new;
end $$;
create or replace function ensure_profile() returns text language plpgsql security definer set search_path = public as $$
declare p role_presets%rowtype; em text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if auth.uid() is null or em='' then return 'none'; end if;
  if exists (select 1 from profiles where id=auth.uid()) then return (select role from profiles where id=auth.uid()); end if;
  select * into p from role_presets where lower(email)=em;
  if not found then return 'none'; end if;
  insert into profiles(id,email,name,org,role,fin) values (auth.uid(), em, coalesce(nullif(p.name,''), split_part(em,'@',1)), p.org, p.role, coalesce(p.fin,false)) on conflict (id) do nothing;
  return p.role;
end $$;
