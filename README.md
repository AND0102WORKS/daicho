# ワークス台帳 v4（Supabase 版）　※旧称：Aチーム統合台帳

- `docs/index.html` … 台帳本体（スタッフ用。メールのリンクでログイン）。**build4.py が作る。直接編集しない**
- `docs/me.html` … 職人用（自分の工程。`?t=<vendors.token>`）
- `docs/order.html` … 業者用の発注書・承諾（`?t=<orders.token>`）
- `src/app3.src.html` … 画面コード（CSS+JS 一体。ここを直す）
- `src/store4.js` … 台帳の保存層（Supabase の読み書き・Realtime・ログイン）
- `src/build4.py` … `app3.src.html` + `store4.js` + `config.json` → `src/app4.src.html` と `docs/index.html`
- `src/schema.sql` … Supabase（PostgreSQL）の表・権限・関数
- `src/config.json` … `{ "url": "https://xxxx.supabase.co", "anon": "<公開キー>" }`（秘密鍵は置かない）

## 作り直し方
```
python3 src/build4.py
```
## テスト（手元の PostgreSQL で）
```
cd test && npm install                     # 初回だけ（pg を入れる。playwright は環境のものを使う）
cd test && ./reset.sh && node run.js       # 台帳：読み込み→編集→取り込み→発注→再読み込み
cd test && ./reset.sh && node pages.js     # 職人ページ（鍵情報・完了）・業者ページ（承諾）
```
`test/stub.sql` は Supabase の土台（auth.users・auth.uid()・anon などの役割）の、テスト用の代わり。
