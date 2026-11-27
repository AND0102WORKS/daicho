-- 2026-11-27 業者ページの請求：出した請求書に支払予定日を出すため、my_billing が業者の支払日の決まり（site・pay_m・pay_d）も返す
create or replace function my_billing(p_token text) returns jsonb
language sql security definer stable as $$
  select jsonb_build_object(
    'vendor', jsonb_build_object('name',v.name,'full',v.full_name,'inv',v.inv,'taxable',coalesce(v.taxable,true),'close',v.close_day,'site',v.site,'pay_m',v.pay_m,'pay_d',v.pay_d),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('proc_id',r.proc_id,'prop',c.prop,'kind',p.kind,'done_date',r.done_date,
                'base',r.base,'extra',r.extra,'extra_note',r.extra_note,'st',r.st,'reply',r.reply) order by r.done_date),'[]'::jsonb)
              from reports r join procs p on p.id=r.proc_id join cases c on c.id=r.case_id where r.who=v.name and r.invoice_id=''),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(i)-'org' order by i.issued_at desc),'[]'::jsonb) from invoices i where i.who=v.name))
  from vendors v where v.token=p_token and v.active $$;
