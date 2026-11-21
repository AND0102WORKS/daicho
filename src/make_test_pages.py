# テスト用の台帳・業者ページ・発注書（docs/test/）を、今の本番のページから作る（2026-11-21 時点で固定）。
#   python3 src/make_test_pages.py
# 今後の本番の直しはテスト用には入れない（このスクリプトは作り直しのときだけ手で流す）。
# 違うところ：データはテスト用の棚（schema test）、写真は reports-test、画面の上に「テスト用」の帯。ログインは本番と共通。
import os
os.makedirs('docs/test', exist_ok=True)
BAR = ('<div style="position:sticky;top:0;z-index:999;background:#B4261A;color:#fff;font-weight:900;text-align:center;'
       'padding:6px 8px;font-size:14px;letter-spacing:.05em">テスト用（本番とは別のデータです。自由に入れて・消して大丈夫）</div>')

def conv(name, reps):
    s = open('docs/' + name, encoding='utf-8').read()
    for a, b, n in reps:
        c = s.count(a)
        assert c == n, (name, a[:60], c, n)
        s = s.replace(a, b)
    s = s.replace("storage.from('reports')", "storage.from('reports-test')")
    assert "from('reports')" not in s
    i = s.index('<body'); j = s.index('>', i) + 1
    s = s[:j] + BAR + s[j:]
    open('docs/test/' + name, 'w', encoding='utf-8').write(s)
    print('docs/test/' + name, len(s))

conv('index.html', [
    ("sb=window.supabase.createClient(SB_URL,SB_KEY);", "sb=window.supabase.createClient(SB_URL,SB_KEY,{db:{schema:'test'}});", 1),
    ("schema:'public'", "schema:'test'", 1),
    ("<title>ワークス台帳</title>", "<title>【テスト用】ワークス台帳</title>", 1),
])
OPT = "{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}"
OPT2 = "{db:{schema:'test'},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}"
conv('me.html', [(OPT, OPT2, 1), ("<title>発注と工程｜アンドワークス</title>", "<title>【テスト用】発注と工程</title>", 1)])
conv('order.html', [(OPT, OPT2, 1), ("<title>発注書</title>", "<title>【テスト用】発注書</title>", 1)])
