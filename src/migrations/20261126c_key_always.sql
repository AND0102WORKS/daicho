-- 2026-11-26 鍵情報は日付で絞らない（北村さんの指示）。業者ページの工程と発注書ページで、その業者の工程・発注ならいつでも見せる。
-- 打診中の工程には今までどおり出さない（my_schedule は打診中を返さない。my_asks・my_case_info は鍵情報を返さない）。関数の置き換えのみ
create or replace function my_schedule(p_token text, p_from date, p_to date)
returns table(proc_id text, case_id text, prop text, addr text, kind text, start_date date, end_date date, prog text, memo text, client text, key_info text)
language sql security definer stable set search_path = public as $$
  select p.id, c.id, c.prop, c.addr, p.kind, p.start_date, p.end_date, p.prog, p.memo, c.client,
    -- 鍵情報は、その工程の業者にはいつでも見せる（2026-11-26 北村さんの指示。以前は作業日の3日前〜終了の翌日だけだった）。打診中の工程は下の条件で出ない
    coalesce(c.key_info,'')
  from procs p join cases c on c.id=p.case_id join vendors v on v.name=p.who
  where v.token=p_token and v.active and coalesce(p.ask,'')<>'打診中'      -- 打診中は出さない（受けたら出る）
    and p.start_date<=p_to and coalesce(p.end_date,p.start_date)>=p_from   -- 期間に少しでも掛かる工程（前の週から続く工程も出す）
  order by p.start_date, c.prop $$;
create or replace function order_view(p_token text)
returns table(order_no text, who text, kind text, start_date date, end_date date, due date, naiyo text, memo text, st text, accepted_at timestamptz,
              prop text, addr text, client text, lines jsonb, plan date, procs jsonb, key_info text, taxable boolean)
language sql security definer stable set search_path = public as $$
  select o.no, o.who, o.kind, o.start_date, o.end_date, o.due, o.naiyo, o.memo, o.st, o.accepted_at, c.prop, c.addr, c.client,
    (select jsonb_agg(jsonb_build_object('name',l.name,'spec',l.spec,'qty',coalesce(l.cost_qty,l.qty),'unit',coalesce(nullif(l.cost_unit,''),l.unit),'price',l.price,'memo',l.memo) order by l.no) from lines l where l.order_id=o.id),
    c.plan,
    (select jsonb_agg(jsonb_build_object('kind',p.kind,'start_date',p.start_date,'end_date',p.end_date,'prog',p.prog,
        'mine',(p.order_id=o.id or p.id=o.proc_id),
        'naiyo',(select o2.naiyo from orders o2 where o2.id=p.order_id and p.order_id<>''),
        'items',(select jsonb_agg(trim(coalesce(l.spec,'')||' '||l.name) order by l.no, l.id) from lines l
                 where l.case_id=p.case_id and l.kind=p.kind and p.kind<>'' and not l.cut and l.qty>0)
      ) order by p.start_date nulls last, p.id) from procs p where p.case_id=o.case_id),
    coalesce(c.key_info,''),   -- 鍵情報は日付で絞らない（2026-11-26 北村さんの指示）
    coalesce(o.taxable,true)
  from orders o join cases c on c.id=o.case_id where o.token=p_token
    and not exists (select 1 from vendors v where v.name=o.who and not v.active) $$;
