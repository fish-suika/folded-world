#!/bin/sh
# 分割ソースを1枚のHTMLに結合する
cd "$(dirname "$0")"

# --- 本体 ---
cat src/00-head.html \
    src/10-config.js \
    src/20-logic.js \
    src/30-scene.js \
    src/60-hud.js \
    src/90-boot.js \
    src/99-tail.html > folded-world.html
cp folded-world.html index.html   # GitHub Pages はルートの index.html を配信する

# --- 検証ページ（three.js を使わない部分だけ） ---
cat src/verify-head.html \
    src/10-config.js \
    src/20-logic.js \
    src/verify-tests.js \
    src/99-tail.html > verify.html

echo "built folded-world.html + index.html ($(wc -c < folded-world.html) bytes)"
echo "built verify.html ($(wc -c < verify.html) bytes)"
