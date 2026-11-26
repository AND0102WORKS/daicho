-- 2026-11-27 顧客のページ：担当者・電話・住所、入金日（締めの月から pay_m か月後の pay_d 日。空ならサイトの日数）、発注書の備考テンプレート
alter table clients add column if not exists contact text default '';
alter table clients add column if not exists phone text default '';
alter table clients add column if not exists addr text default '';
alter table clients add column if not exists pay_m int;
alter table clients add column if not exists pay_d int;
alter table clients add column if not exists tpls jsonb default '[]';   -- [{id,title,body,always}]
