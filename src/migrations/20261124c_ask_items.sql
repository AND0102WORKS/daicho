-- 2026-11-24 打診に、その業者が受け持つ工事の内容（その区分の明細。検査は自社施工）を出す。金額は出さない。足すだけ。何度実行しても同じ
create or replace function my_ask_items(p_token text)
returns table(proc_id text, items jsonb)
language sql security definer stable as $$
  select p.id,
    (select coalesce(jsonb_agg(jsonb_build_object('name',l.name,'spec',l.spec,'qty',coalesce(l.cost_qty,l.qty),'unit',coalesce(nullif(l.cost_unit,''),l.unit)) order by l.no, l.id),'[]'::jsonb)
       from lines l where l.case_id=p.case_id and not l.cut and l.qty>0
        and l.kind = case when p.kind in ('AW検査','検査') then '自社施工' else p.kind end)
  from procs p join vendors v on v.name=p.who
  where v.token=p_token and v.active and p.ask='打診中' $$;
alter function my_ask_items(text) set search_path = public;
revoke execute on function my_ask_items(text) from public;
grant execute on function my_ask_items(text) to anon, authenticated;
