-- 2026-11-27 設定の「利用者」：管理者が、台帳を使える人・役割・振込先を見られる印を画面から変えられる
create or replace function staff_users() returns jsonb language sql stable security definer set search_path = public as $$
  select case when my_role()<>'hq' then '[]'::jsonb else coalesce((select jsonb_agg(x order by (x->>'in') desc, x->>'email') from (
      select jsonb_build_object('email',lower(p.email),'name',p.name,'role',p.role,'fin',p.fin,'in',true,'me',p.id=auth.uid()) x from profiles p
      union all
      select jsonb_build_object('email',lower(r.email),'name',r.name,'role',r.role,'fin',r.fin,'in',false,'me',false) from role_presets r
        where not exists (select 1 from profiles p where lower(p.email)=lower(r.email))) q),'[]'::jsonb) end $$;
create or replace function staff_user_save(p_email text, p_name text, p_role text, p_fin boolean) returns text
language plpgsql security definer set search_path = public as $$
declare em text := lower(trim(coalesce(p_email,''))); v_fin boolean := coalesce(p_fin,false) and p_role<>'none';
begin
  if my_role()<>'hq' then raise exception '管理者だけが変えられる'; end if;
  if em='' or position('@' in em)=0 then raise exception 'メールアドレスを入れてください'; end if;
  if p_role not in ('hq','staff','viewer','none') then raise exception '役割が正しくない'; end if;
  if exists (select 1 from profiles where id=auth.uid() and lower(email)=em) and p_role<>'hq' then raise exception '自分の役割は下げられない'; end if;
  update profiles set name=coalesce(nullif(trim(coalesce(p_name,'')),''),name), role=p_role, fin=v_fin where lower(email)=em;
  update role_presets set name=trim(coalesce(p_name,'')), role=p_role, fin=v_fin where lower(email)=em;
  if not found then insert into role_presets(email,name,org,role,fin) values (em,trim(coalesce(p_name,'')),my_org(),p_role,v_fin); end if;
  return 'ok';
end $$;
revoke execute on function staff_users() from public, anon;
revoke execute on function staff_user_save(text,text,text,boolean) from public, anon;
grant execute on function staff_users() to authenticated;
grant execute on function staff_user_save(text,text,text,boolean) to authenticated;
