-- 2026-11-27 打診：知らせた記録に工程の id、業者ページの打診の内容から「名前も場所も空の明細」を外す
alter table notify_log add column if not exists proc_id text default '';
create or replace function my_ask_items(p_token text)
returns table(proc_id text, items jsonb)
language sql security definer stable as $$
  select p.id,
    (select coalesce(jsonb_agg(jsonb_build_object('name',l.name,'spec',l.spec,'qty',coalesce(l.cost_qty,l.qty),'unit',coalesce(nullif(l.cost_unit,''),l.unit)) order by l.no, l.id),'[]'::jsonb)
       from lines l where l.case_id=p.case_id and not l.cut and l.qty>0 and btrim(coalesce(l.name,'')||coalesce(l.spec,''))<>''
        and l.kind = case when p.kind in ('AW検査','検査') then '自社施工' else p.kind end)
  from procs p join vendors v on v.name=p.who
  where v.token=p_token and v.active and p.ask='打診中' $$;
