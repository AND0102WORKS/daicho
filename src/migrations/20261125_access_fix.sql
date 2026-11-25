-- 2026-11-25 権限と発注書の出方の直し（追加・置き換えのみ。表やデータは変えない）
-- 1) 登録（role_presets）の無いメールアドレスは利用者にしない（今までは staff／hq で入れた）
-- 2) 後から登録された人のために、ログイン時に profile を作る関数
-- 3) 業者ページの工程に出す発注書は、宛先が自分のものだけ
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare p role_presets%rowtype;
begin
  select * into p from role_presets where lower(email)=lower(new.email);
  if not found then return new; end if;   -- 登録（role_presets）の無いメールアドレスは利用者にしない。profile が無ければ my_role()='none'・my_org()='' で何も見えない
  insert into profiles(id,email,name,org,role)
    values (new.id, new.email, coalesce(nullif(p.name,''), split_part(new.email,'@',1)), p.org, p.role)
  on conflict (id) do nothing;
  return new;
end $$;
-- 初回ログインの後で登録された人：ログイン時に台帳が呼ぶ。登録があれば profile を作る。無ければ何もしない
create or replace function ensure_profile() returns text language plpgsql security definer set search_path = public as $$
declare p role_presets%rowtype; em text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if auth.uid() is null or em='' then return 'none'; end if;
  if exists (select 1 from profiles where id=auth.uid()) then return (select role from profiles where id=auth.uid()); end if;
  select * into p from role_presets where lower(email)=em;
  if not found then return 'none'; end if;
  insert into profiles(id,email,name,org,role) values (auth.uid(), em, coalesce(nullif(p.name,''), split_part(em,'@',1)), p.org, p.role) on conflict (id) do nothing;
  return p.role;
end $$;
revoke execute on function ensure_profile() from public, anon;
grant execute on function ensure_profile() to authenticated;
create or replace function my_job_orders(p_token text)
returns table(proc_id text, order_no text, order_token text, order_st text)
language sql security definer stable as $$
  select p.id, o.no, o.token, o.st
  from vendors v join procs p on p.who=v.name join orders o on o.id=p.order_id and p.order_id<>''
  where v.token=p_token and v.active and o.who=v.name $$;   -- 発注書の宛先が自分のものだけ（工程の業者を付け替えても、前の業者宛ての発注書は出さない）
