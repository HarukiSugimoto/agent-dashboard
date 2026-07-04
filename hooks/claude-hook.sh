#!/bin/bash
# Claude Code hook -> collector 転送
# stdin で受け取った hook JSON をそのまま POST する。
# コレクタが落ちていても Claude Code 本体を一切ブロックしないよう、
# バックグラウンド・短タイムアウト・失敗無視で送る。
INPUT=$(cat)
(curl -s --max-time 2 -X POST http://127.0.0.1:4820/ingest/claude \
  -H 'Content-Type: application/json' \
  --data-binary "$INPUT" >/dev/null 2>&1 &)
exit 0
