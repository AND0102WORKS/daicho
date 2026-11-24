// 発注書の読み取りのテスト用の見本（架空の内容）。実際の依頼元の書類と同じ「形」だけをまねる。 node mksamples.js
//   list-sample.pdf  … 箇条書き（・項目　¥金額。品番と金額が次の行）＋ 上に物件所在地・鍵の所在・受渡期日
//   table2-sample.pdf … 表（材・手／工事区分／工事内容／数量／単位／単価／金額／備考）、備考の折り返し、2ページ目に表の無い案内
const {chromium}=require('playwright');
const list=`<html><body style="font-family:sans-serif;font-size:12px;padding:40px;line-height:1.9"><h2 style="text-align:center;letter-spacing:1em">工事依頼書</h2>
<p>アンドワークス株式会社　御中　　　　　　　　　　　　　　　株式会社サンプル管理</p><p>下記の通り工事を発注させていただきます。　　　　　　　　2026年11月18日</p>
<p>物 件 所 在 地 ：　東京都杉並区見本町１－２－３<br>物　件　名　：　サンプルハイツ　　　　　　　　　　　　号 室 ：　　101号室<br>間　　取　：　1Ｋ　　　　　鍵 の 所 在 ：　　エントランス横フェンス 0000<br>受 渡 期 日 ：　2026年11月20日　　　近隣コインパーキングをご利用ください。</p>
<h3 style="text-align:center;letter-spacing:.8em">工事依頼内容</h3>
<p>・ルームクリーニング　¥18,000<br>（浴室鏡研磨含む）<br>・エアコンクリーニング　¥8,000<br>・洗面台下収納底板シート貼（430×360）<br>　TA0000　白　¥6,000<br>・各所コーク補修　¥2,000<br>※別紙参照</p><p>合計　¥34,000（税抜）</p></body></html>`;
const td='style="border:1px solid #999;padding:4px"';
const row=(a)=>`<tr>${a.map((x,i)=>`<td ${td}${i>=3&&i<=6?' align="right"':''}>${x}</td>`).join('')}</tr>`;
const table2=`<html><body style="font-family:sans-serif;font-size:10px;padding:24px"><h3>工事発注書 (内訳書) 1 ページ目　　　発注書番号 20261029-00000-N　　ご発注日 2026-11-18</h3>
<p>物件名　サンプルレジデンス １２０７　　　　　　　　　　　　　　　　　　　　　　　　　　　　　アンドワークス株式会社　御中</p><p>所在地　東京都品川区見本４丁目５－９　　　　　　　間取り　1K　　　金額 (税抜) ¥23,560-</p><p>　　　　AL:呼0000　玄関：ダイヤル錠００００</p>
<table style="border-collapse:collapse;width:100%"><tr>${['材・手','工事区分','工事内容','数量','単位','単価','金額','備考'].map(x=>`<th ${td}>${x}</th>`).join('')}</tr>
${row(['材工','クリーニング工事','室内ハウスクリーニング','1.0','式','13,000','13,000','状態:B 1.9年 ノンワックス'])}
${row(['材工','クリーニング工事','浴室鏡薬品洗浄','1.0','式','3,000','3,000',''])}
${row(['材工','クリーニング工事','仕上り調整費','1.0','式','3,000','3,000','<div style="width:150px">建具や各所調整、ぐらつき固定（3か所まで）／写真撮影（清掃後）</div>'])}
${row(['材工','クリーニング工事','玄関廊下左右壁クロスクリーニング','0.0','','','0',''])}
${row(['材工','修繕工事','キッチンガスコンロ電池交換（単1×2本）','2.0','本','250','500',''])}
${row(['材工','修繕工事','洗面室クロス壁涙目取付','1.0','個','60','60',''])}
${row(['材工','修繕工事','浴室入口右縦コーキング打ち直し','4.0','式','1,000','4,000','白'])}</table>
<div style="page-break-before:always"></div><h3>工事発注書 (内訳書) 2 ページ目　　　発注書番号 20261029-00000-N</h3><p>物件名　サンプルレジデンス １２０７</p><p>営業　見本 太郎　※曜日指定なし</p><p>現調　※時間指定 8：00～ 19：00(目安)</p><p>施工管理　※退出時ダイヤル錠にそろえてご退出ください。</p><p>株式会社サンプルプランニング　TEL :03-0000-0000</p></body></html>`;
(async()=>{ const b=await chromium.launch(); const p=await b.newPage();
  for(const [h,f,o] of [[list,'list-sample.pdf',{format:'A4'}],[table2,'table2-sample.pdf',{format:'A4',landscape:true}]]){ await p.setContent(h); await p.pdf(Object.assign({path:__dirname+'/samples/'+f},o)); }
  await b.close(); })();
