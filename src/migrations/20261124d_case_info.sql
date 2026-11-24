-- 2026-11-24 業者ページ：案件の詳細（打診のときも見られる）。鍵情報・金額・ほかの業者の名前は出さない。足すだけ。何度実行しても同じ
create or replace function my_case_info(p_token text, p_proc text) returns jsonb
language sql security definer stable as $$
  select jsonb_build_object('prop',c.prop,'addr',c.addr,'client',c.client,
    'madori',coalesce(nullif(c.madori,''), substring(coalesce(c.memo,'')||' '||coalesce(c.items,'')||' '||coalesce(c.prop,'') from '([1-4](?:SLDK|LDK|DK|K|R))')),
    'plan',c.plan,'kind',p.kind,'start_date',p.start_date,'end_date',p.end_date,'ask',p.ask,
    'items',(select coalesce(jsonb_agg(jsonb_build_object('name',l.name,'spec',l.spec,'qty',coalesce(l.cost_qty,l.qty),'unit',coalesce(nullif(l.cost_unit,''),l.unit),'memo',l.memo) order by l.no, l.id),'[]'::jsonb)
       from lines l where l.case_id=c.id and not l.cut and l.qty>0
        and l.kind = case when p.kind in ('AW検査','検査') then '自社施工' else p.kind end),
    'procs',(select coalesce(jsonb_agg(jsonb_build_object('kind',q.kind,'start_date',q.start_date,'end_date',q.end_date,'prog',q.prog,'mine',q.id=p.id) order by q.start_date nulls last, q.id),'[]'::jsonb)
       from procs q where q.case_id=c.id),
    'photos',(select count(*) from photos f where f.case_id=c.id))
  from vendors v join procs p on p.who=v.name join cases c on c.id=p.case_id
  where v.token=p_token and v.active and p.id=p_proc $$;
alter function my_case_info(text,text) set search_path = public;
revoke execute on function my_case_info(text,text) from public;
grant execute on function my_case_info(text,text) to anon, authenticated;
