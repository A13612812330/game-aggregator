#!/usr/bin/env bash
# tools/refresh-bannerhub.sh — 重新拉取 BannerHub 社区配置仓库并重建本地索引
#
# 说明：github.com 主站在本机常被拦截，但 codeload.github.com（压缩包）与
#       api.github.com 可通，所以这里走 codeload 下载 tar.gz，不做 git clone。
#
# 用法： bash tools/refresh-bannerhub.sh
set -euo pipefail

REPO="The412Banner/bannerhub-game-configs"
BRANCH="main"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/data/bannerhub"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$DATA/raw"

echo "① 下载仓库快照（codeload）…"
curl -fsSL --retry 3 --max-time 600 \
  -o "$TMP/bh.tar.gz" \
  "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH"
echo "   $(du -h "$TMP/bh.tar.gz" | cut -f1)"

echo "② 提取顶层数据文件…"
tar -xzf "$TMP/bh.tar.gz" -C "$TMP" \
  "bannerhub-game-configs-$BRANCH/games.json" \
  "bannerhub-game-configs-$BRANCH/devices.json" \
  "bannerhub-game-configs-$BRANCH/recent.json"
cp "$TMP/bannerhub-game-configs-$BRANCH/games.json"   "$DATA/raw/games.json"
cp "$TMP/bannerhub-game-configs-$BRANCH/devices.json" "$DATA/raw/devices.json"
cp "$TMP/bannerhub-game-configs-$BRANCH/recent.json"  "$DATA/raw/recent.json"

echo "③ 导出配置清单（不落地 1.4 万个文件）…"
tar -tzf "$TMP/bh.tar.gz" \
  | grep '^bannerhub-game-configs-'"$BRANCH"'/configs/' \
  | grep '\.json$' \
  | sed "s|^bannerhub-game-configs-$BRANCH/||" \
  > "$DATA/filelist.txt"
echo "   $(wc -l < "$DATA/filelist.txt") 条配置"

echo "④ 重建索引…"
node "$ROOT/tools/build-bannerhub.js"

echo "✅ 完成。重启服务后生效： node server.js"
