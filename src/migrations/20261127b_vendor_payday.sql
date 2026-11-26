-- 2026-11-27 協力業者の支払日（業者ごと）：締めの月から pay_m か月後の pay_d 日（31＝月末）。空なら今までどおりサイトから決める
alter table vendors add column if not exists pay_m int;
alter table vendors add column if not exists pay_d int;
