#!/bin/bash
# Claude Code hook -> collector 転送
# stdin で受け取った hook JSON をそのまま POST する。
# コレクタが落ちていても Claude Code 本体を一切ブロックしないよう、
# バックグラウンド・短タイムアウト・失敗無視で送る。
#
# 送信先は AGENT_DASH_URL で上書き可能（デフォルトはローカル）。
# リモートマシンでは ssh -R 4820:localhost:4820 のリバーストンネルを張れば
# デフォルトのままで手元のコレクタに届く。

# Claude Agent SDK が起動したセッションはダッシュボードの対象外。
# SDK の query() もユーザー設定の hooks を読み込むため、ここで除外する。
if [[ -n "${CLAUDE_AGENT_SDK:-}" || -n "${CLAUDE_AGENT_SDK_VERSION:-}" ]]; then
  exit 0
fi

DASH="${AGENT_DASH_URL:-http://127.0.0.1:4820}"
INPUT=$(cat)
(curl -s --noproxy '*' --connect-timeout 0.5 --max-time 1 \
  -X POST "$DASH/ingest/claude" \
  -H 'Content-Type: application/json' \
  -H "X-Agent-Host: $(hostname -s)" \
  --data-binary "$INPUT" -o /dev/null 2>/dev/null &)
exit 0
