# agent-dashboard

AIコーディングエージェント（Claude Code / Codex）のセッションが「今何をしているか」をリアルタイムに可視化する管制室風ダッシュボード。

![status](https://img.shields.io/badge/phase-1-green)

## 仕組み

```
[Claude Code hooks] ──┐
                      ├─→ collector (server.js, SSE) ─→ dashboard (index.html)
[Codex adapter (予定)]┘
```

- エージェントごとの**アダプタ**がイベントを共通形式に変換してコレクタに POST
- **コレクタ**がツール名を coding / reading / searching / running / delegating などのアクティビティに分類し、SSE でブラウザにプッシュ
- **UI** はエージェント非依存。セッションカードが現在のアクティビティ色で光る

## 使い方

```bash
# 1. コレクタを起動（依存ゼロ、Node 標準ライブラリのみ）
node server.js

# 2. ブラウザで開く
open http://localhost:4820
```

Claude Code 側は `hooks-snippet.json` の `hooks` ブロックを `~/.claude/settings.json` に追加すると、全セッションのイベントが流れ込む（`hooks/claude-hook.sh` のパスは環境に合わせて変更）。フックは非同期・失敗無視で送るため、コレクタが落ちていてもセッションは遅くならない。

## Mac アプリ

ブラウザタブだとバックグラウンド時に描画が間引かれるため、専用の WebView アプリを用意している（コレクタも自動起動する）。

```bash
./app/build.sh          # swiftc でビルド（Xcode プロジェクト不要）
open AgentOps.app
```

## ファイル構成

| ファイル | 役割 |
|---|---|
| `server.js` | コレクタ。`POST /ingest/claude`（Claude hooks 用）、`POST /ingest/generic`（他エージェント用）、`GET /stream`（SSE） |
| `hooks/claude-hook.sh` | Claude Code hook → コレクタ転送スクリプト |
| `index.html` | ダッシュボード UI（single-file） |
| `hooks-snippet.json` | settings.json に貼る hooks 設定 |
| `events.jsonl` | イベント履歴（自動生成、git 管理外） |

## ロードマップ

- [x] Phase 1: Claude Code 対応（hooks → collector → SSE dashboard）
- [ ] Phase 2: Codex アダプタ（`~/.codex/logs_2.sqlite` の tail）
- [ ] コレクタの常駐化（LaunchAgent）
- [ ] トークン消費・セッション履歴の集計ビュー
