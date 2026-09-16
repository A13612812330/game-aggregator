#!/usr/bin/env bash
# refresh-sources.sh — 刷新外部数据源（芯片规格 / 主板代号 / Turnip 驱动）
#
# 三个源都在 GitHub，本机 github.com 主站被拦，脚本走 api.github.com（已验证可行）。
# 抓完必须重启服务（数据是启动时加载的只读索引）。
#
# 用法：
#   bash tools/refresh-sources.sh            # 全刷
#   bash tools/refresh-sources.sh soc        # 只刷 soc-db
#   bash tools/refresh-sources.sh turnip     # 只刷 Turnip（驱动更新最频繁，建议每周跑）
#
# 建议节奏：
#   turnip  → 每周（Mesa 上游提交很频繁，构建看板几乎每天变）
#   soc-db  → 每月（新芯片上市节奏）
#   board   → 每月
set -e

cd "$(dirname "$0")/.."

ONLY="${1:-}"
if [ -n "$ONLY" ]; then
  echo "▸ 只刷新: $ONLY"
  node tools/fetch-sources.js --only="$ONLY"
else
  echo "▸ 刷新全部数据源"
  node tools/fetch-sources.js
fi

echo ""
echo "▸ 落盘结果："
ls -la data/soc-db.json data/device-board.json data/turnip.json 2>/dev/null | awk '{printf "   %8s B  %s\n", $5, $9}'

echo ""
echo "⚠️  数据是服务启动时加载的只读索引 — 请重启服务后生效："
echo "   pkill -f 'node server.js' && node server.js"
