#!/bin/bash
# 全部のテストを、1つずつ reset してから流す。最後に結果の一覧を出す（cd test && ./all.sh）
cd "$(dirname "$0")"
for t in run pages report ask fix5 hide est modes drag kfocus site info cpage; do
  ./reset.sh >/dev/null 2>&1
  out=$(timeout 200 node $t.js 2>&1); code=$?
  ng=$(echo "$out" | grep -c "^NG")
  if [ $code -ne 0 ] || [ "$ng" != "0" ] || echo "$out" | grep -q "SOME NG"; then echo "NG   $t (exit $code, NG $ng)"; echo "$out" | grep "^NG" | head -5
  else echo "OK   $t"; fi
done
