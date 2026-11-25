-- 2026-11-26 業者・顧客を「番号」でつなぐ土台（第1・第2段階）。追加のみ。今ある列・データは変えない
--  ・名前の列（who／client）はそのまま残し、横に番号の列（vendor_id／client_id）を足す
--  ・保存のたびに、データベースが名前から番号を埋める（古い画面のままの人が保存しても番号が入る）
--  ・マスタで名前を変えたら、番号でつながっている行の名前もデータベースが一緒に変える
--    （完了報告・業者の請求書・写真・支払済み・入金の記録が、古い名前のまま取り残されない）
--  いまは名前が正。お金の集計を番号で読むように切り替えるのは次の段階

-- ---------- 1) 番号の列 ----------
alter table procs    add column if not exists vendor_id text;
alter table lines    add column if not exists vendor_id text;
alter table orders   add column if not exists vendor_id text;
alter table reports  add column if not exists vendor_id text;
alter table invoices add column if not exists vendor_id text;
alter table photos   add column if not exists vendor_id text;
alter table prices   add column if not exists vendor_id text;
alter table payments add column if not exists vendor_id text;
alter table days_off add column if not exists vendor_id text;
alter table cases    add column if not exists client_id text;
alter table prices   add column if not exists client_id text;
alter table receipts add column if not exists client_id text;
alter table inbox    add column if not exists client_id text;
create index if not exists procs_vendor_id_idx   on procs(vendor_id);
create index if not exists orders_vendor_id_idx  on orders(vendor_id);
create index if not exists reports_vendor_id_idx on reports(vendor_id);
create index if not exists cases_client_id_idx   on cases(client_id);

-- ---------- 2) 保存のたびに、名前から番号を埋める ----------
create or replace function link_vendor_id() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.who,'')='' then new.vendor_id := null;
  else new.vendor_id := (select v.id from vendors v where v.name=new.who and v.org=new.org limit 1); end if;
  return new;
end $$;
create or replace function link_client_id() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.client,'')='' then new.client_id := null;
  else new.client_id := (select c.id from clients c where c.name=new.client and c.org=new.org limit 1); end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['procs','lines','orders','reports','invoices','photos','prices','payments','days_off'] loop
    execute format('drop trigger if exists link_vendor_%1$s on %1$s; create trigger link_vendor_%1$s before insert or update on %1$s for each row execute function link_vendor_id();', t);
  end loop;
  foreach t in array array['cases','prices','receipts','inbox'] loop
    execute format('drop trigger if exists link_client_%1$s on %1$s; create trigger link_client_%1$s before insert or update on %1$s for each row execute function link_client_id();', t);
  end loop; end $$;

-- ---------- 3) マスタの名前が変わったら、つながっている行を一緒に直す ----------
-- 先に「番号でつながっている行」の名前を新しい名前にそろえ、次に「新しい名前の行」に番号を入れる
-- （台帳は名前を変えるとき、工程などを先に新しい名前で保存し、そのあとマスタを保存する。その順でも番号が抜けないように）
create or replace function vendor_renamed() returns trigger language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if tg_op='UPDATE' and new.name is distinct from old.name then
    foreach t in array array['procs','lines','orders','reports','invoices','photos','prices'] loop
      execute format('update %I set who=$1 where vendor_id=$2 and who is distinct from $1', t) using new.name, new.id;
    end loop;
    foreach t in array array['payments','days_off'] loop   -- 名前が主キーに入っている表：同じ月の行が既にあれば、そのままにする
      begin execute format('update %I set who=$1 where vendor_id=$2 and who is distinct from $1', t) using new.name, new.id;
      exception when unique_violation then null; end;
    end loop;
  end if;
  foreach t in array array['procs','lines','orders','reports','invoices','photos','prices','payments','days_off'] loop
    execute format('update %I set vendor_id=$2 where who=$1 and org=$3 and vendor_id is distinct from $2', t) using new.name, new.id, new.org;
  end loop;
  return null;
end $$;
create or replace function client_renamed() returns trigger language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if tg_op='UPDATE' and new.name is distinct from old.name then
    foreach t in array array['cases','prices','inbox'] loop
      execute format('update %I set client=$1 where client_id=$2 and client is distinct from $1', t) using new.name, new.id;
    end loop;
    begin update receipts set client=new.name where client_id=new.id and client is distinct from new.name;
    exception when unique_violation then null; end;
  end if;
  foreach t in array array['cases','prices','receipts','inbox'] loop
    execute format('update %I set client_id=$2 where client=$1 and org=$3 and client_id is distinct from $2', t) using new.name, new.id, new.org;
  end loop;
  return null;
end $$;
drop trigger if exists vendor_renamed on vendors;
create trigger vendor_renamed after insert or update of name on vendors for each row execute function vendor_renamed();
drop trigger if exists client_renamed on clients;
create trigger client_renamed after insert or update of name on clients for each row execute function client_renamed();
revoke execute on function link_vendor_id(), link_client_id(), vendor_renamed(), client_renamed() from public, anon, authenticated;

-- ---------- 4) 今あるデータに番号を入れる ----------
do $$ declare t text; begin
  foreach t in array array['procs','lines','orders','reports','invoices','photos','prices','payments','days_off'] loop
    execute format('update %1$s x set vendor_id=v.id from vendors v where v.name=x.who and v.org=x.org and x.vendor_id is distinct from v.id', t);
  end loop;
  foreach t in array array['cases','prices','receipts','inbox'] loop
    execute format('update %1$s x set client_id=c.id from clients c where c.name=x.client and c.org=x.org and x.client_id is distinct from c.id', t);
  end loop; end $$;
