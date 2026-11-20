-- 2026-11-20 写真の保存量（台帳の支払タブに出す）
-- 写真の保存量（スタッフが台帳で見る）。無料枠は 1GB
do $$ begin
  if exists (select 1 from pg_namespace where nspname='storage') then
    execute $f$create or replace function photo_usage() returns jsonb language sql security definer stable set search_path = public as $b$
      select case when my_role() in ('hq','staff','viewer') then
        (select jsonb_build_object('bytes',coalesce(sum((metadata->>'size')::bigint),0),'files',count(*)) from storage.objects where bucket_id='reports')
      else '{}'::jsonb end $b$ $f$;
    execute 'revoke execute on function photo_usage() from public, anon';
    execute 'grant execute on function photo_usage() to authenticated';
  end if;
end $$;
