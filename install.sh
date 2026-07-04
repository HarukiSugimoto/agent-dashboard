#!/bin/bash
# agent-dashboard セットアップ
#   ./install.sh                hooks を ~/.claude/settings.json に登録
#   ./install.sh --launchagent  さらにログイン時にコレクタを自動起動 (macOS)
# 再実行しても安全（既存の登録はパスだけ更新される）。
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

command -v node >/dev/null || { echo "error: node が必要です"; exit 1; }
command -v python3 >/dev/null || { echo "error: python3 が必要です"; exit 1; }

# --- Claude Code hooks を settings.json にマージ ---
python3 - "$DIR" <<'PYEOF'
import json, os, sys

repo = sys.argv[1]
cmd = f'"{repo}/hooks/claude-hook.sh"'
path = os.path.expanduser("~/.claude/settings.json")

try:
    with open(path) as f:
        settings = json.load(f)
except FileNotFoundError:
    settings = {}

hooks = settings.setdefault("hooks", {})
events = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "SessionEnd"]

for ev in events:
    groups = hooks.setdefault(ev, [])
    existing = [h for g in groups for h in g.get("hooks", [])
                if "claude-hook.sh" in h.get("command", "")]
    if existing:
        for h in existing:  # 登録済みならパスだけこの repo に更新
            h["command"] = cmd
    else:
        entry = {"hooks": [{"type": "command", "command": cmd}]}
        if ev in ("PreToolUse", "PostToolUse"):
            entry["matcher"] = "*"
        groups.append(entry)

os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump(settings, f, ensure_ascii=False, indent=2)
print(f"ok: hooks を登録しました -> {path}")
PYEOF

chmod +x "$DIR/hooks/claude-hook.sh"

# --- LaunchAgent (macOS, ログイン時にコレクタ自動起動) ---
if [[ "${1:-}" == "--launchagent" ]]; then
  [[ "$(uname)" == "Darwin" ]] || { echo "error: --launchagent は macOS のみ"; exit 1; }
  NODE="$(command -v node)"
  PLIST="$HOME/Library/LaunchAgents/dev.harusugi.agent-dashboard.plist"
  cat > "$PLIST" <<PLEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.harusugi.agent-dashboard</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/server.js</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLEOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "ok: LaunchAgent を登録しました（ログイン時にコレクタが自動起動）"
fi

echo ""
echo "セットアップ完了。次の新しい Claude Code セッションからイベントが流れます。"
echo "  コレクタ起動:       node $DIR/server.js"
echo "  ダッシュボード:     http://localhost:4820"
if [[ "$(uname)" == "Darwin" ]]; then
  echo "  Mac アプリをビルド: $DIR/app/build.sh"
fi
echo ""
echo "リモートマシンの場合: 手元へのリバーストンネルを張ると、そのまま手元の"
echo "ダッシュボードに届きます:  ssh -R 4820:localhost:4820 <このマシン>"
