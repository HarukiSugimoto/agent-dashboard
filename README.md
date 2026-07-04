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

## セットアップ（どのマシンでも）

```bash
git clone git@github.com:HarukiSugimoto/agent-dashboard.git
cd agent-dashboard
./install.sh                # hooks を ~/.claude/settings.json に登録（再実行OK）
./install.sh --launchagent  # macOS: ログイン時にコレクタも自動起動する場合

node server.js              # コレクタ起動
open http://localhost:4820  # ダッシュボード
```

フックは非同期・失敗無視で送るため、コレクタが落ちていてもセッションは遅くならない。

## リモートマシンのセッションを見る

イベントには送信元ホスト名が付き、ダッシュボード上でマシンごとに区別される。

**SSH リバーストンネル（推奨）** — リモート側にも clone + `./install.sh` しておき、
トンネル付きで接続するだけ。リモートの `127.0.0.1:4820` が手元に転送される：

```bash
ssh -R 4820:localhost:4820 user@remote
```

`~/.ssh/config` に書いておけば毎回自動で張られる：

```
Host remote
    RemoteForward 4820 localhost:4820
```

**Tailscale / LAN 直接続** — 手元で `BIND=0.0.0.0 node server.js` で起動し、
リモート側で `export AGENT_DASH_URL=http://<手元のIP>:4820` を設定する。

## Mac アプリ

ブラウザタブだとバックグラウンド時に描画が間引かれるため、専用の WebView アプリを用意している（コレクタも自動起動する）。

```bash
./app/build.sh          # swiftc でビルド（Xcode プロジェクト不要）
open AgentOps.app
```

アイコンは `app/icon.png`（1024×1024 PNG）を置いて再ビルドすると自動で組み込まれる。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `server.js` | コレクタ。`POST /ingest/claude`（Claude hooks 用）、`POST /ingest/generic`（他エージェント用）、`GET /stream`（SSE） |
| `hooks/claude-hook.sh` | Claude Code hook → コレクタ転送スクリプト |
| `index.html` | ダッシュボード UI（single-file） |
| `install.sh` | hooks 登録 + LaunchAgent セットアップ |
| `hooks-snippet.json` | settings.json に貼る hooks 設定（手動で入れたい場合） |
| `events.jsonl` | イベント履歴（自動生成、git 管理外） |

## ロードマップ

- [x] Phase 1: Claude Code 対応（hooks → collector → SSE dashboard）
- [ ] Phase 2: Codex アダプタ（`~/.codex/logs_2.sqlite` の tail）
- [ ] コレクタの常駐化（LaunchAgent）
- [ ] トークン消費・セッション履歴の集計ビュー
