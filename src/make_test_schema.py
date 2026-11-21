# テスト用の棚（schema test）の設計図を、本番の schema.sql から作る（2026-11-21 時点で固定）。
#   python3 src/make_test_schema.py  →  src/test_schema.sql
# 本番（public）には一切触らない：
#   * 表・関数・権限はすべて test の中に作る（search_path を test に）
#   * ログインの人と役割は本番と共通（test.profiles は public.profiles を見るだけの view。新しい人の登録は本番側だけ）
#   * auth.users のトリガー・role_presets は作らない（本番のものをそのまま使う）
#   * 写真は別の置き場所（バケット reports-test）
import re, sys
src = open('src/schema.sql', encoding='utf-8').read()
s = src

def cut(start, end_pat):
    """start で始まる行から end_pat を含む行までを消す（1回だけ）"""
    global s
    i = s.index(start); j = s.index(end_pat, i) + len(end_pat)
    s = s[:i] + s[j:]

# 拡張（pgcrypto は extensions に既にある）
s = s.replace("create extension if not exists pgcrypto;", "")
# profiles 表 → 後で view にする
cut("create table if not exists profiles (", ");")
s = s.replace("alter table profiles enable row level security;\n", "")
s = re.sub(r"drop policy if exists (sel|upd)_profiles on profiles; create policy [^\n]*\n", "", s)
# 新規ユーザーのトリガー（2か所）と role_presets
cut("create or replace function handle_new_user() returns trigger language plpgsql security definer as $$", "execute function handle_new_user();")
cut("create table if not exists role_presets (", "revoke execute on function handle_new_user() from public, anon, authenticated;")
s = s.replace("revoke execute on function handle_new_user() from public, anon, authenticated;", "")
s = s.replace("'handle_new_user()',", "")
# 役割は本番の profiles から
s = s.replace(" from profiles ", " from public.profiles ")
# 関数の search_path
s = s.replace("set search_path = public", "set search_path = test, extensions")
# 写真の置き場所
s = s.replace("bucket_id='reports'", "bucket_id='reports-test'")
s = s.replace("values ('reports','reports',false)", "values ('reports-test','reports-test',false)")
s = s.replace("public.vendor_token_ok(", "test.vendor_token_ok(").replace("public.my_role()", "test.my_role()")
s = re.sub(r"\breports_(vendor|staff)_(insert|select|delete)\b", r"reportstest_\1_\2", s)

# 残っていてはいけないもの
bad = [w for w in ['auth.users for each row', 'on auth.users', 'public.vendor_token_ok', "bucket_id='reports'", 'search_path = public', 'create table if not exists profiles'] if w in s]
if bad: sys.exit('残っている: %s' % bad)
if re.search(r"(?<!test\.)(?<!public\.)\bpublic\.(?!profiles)", s): sys.exit('public. の参照が残っている')

head = """-- テスト用の棚（schema test）。src/make_test_schema.py が本番の schema.sql から作った（2026-11-21 時点で固定。今後の本番の変更は入れない）
create schema if not exists test;
set search_path = test, extensions;
create or replace view test.profiles with (security_invoker = on) as select * from public.profiles;
"""
tail = """
-- テスト用の棚を画面（anon・ログインした人）から使えるように
grant usage on schema test to anon, authenticated, service_role;
grant all on all tables in schema test to anon, authenticated, service_role;
grant all on all sequences in schema test to anon, authenticated, service_role;
alter default privileges in schema test grant all on tables to anon, authenticated, service_role;
alter default privileges in schema test grant all on sequences to anon, authenticated, service_role;
-- 所属（hq ほか）は本番と同じ行を入れておく（中身のデータは空）
insert into test.orgs select * from public.orgs on conflict do nothing;
reset search_path;
"""
open('src/test_schema.sql', 'w', encoding='utf-8').write(head + s + tail)
print('ok', len(head + s + tail))
