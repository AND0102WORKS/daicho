-- 2026-11-21 業者ページの工程に発注書をつなぐ。足すだけ。何度実行しても同じ
-- 工程ごとに、紐づいた発注（番号・発注書のリンク・状態）を返す。下書きの発注は業者ページの工程に出さないために使う
create or replace function my_job_orders(p_token text)
returns table(proc_id text, order_no text, order_token text, order_st text)
language sql security definer stable as $$
  select p.id, o.no, o.token, o.st
  from vendors v join procs p on p.who=v.name join orders o on o.id=p.order_id and p.order_id<>''
  where v.token=p_token and v.active $$;
alter function my_job_orders(text) set search_path = public;
revoke execute on function my_job_orders(text) from public;
grant execute on function my_job_orders(text) to anon, authenticated;
