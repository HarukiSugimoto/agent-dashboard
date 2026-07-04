# agent-dashboard

AIコーディングエージェント（Claude Code / Codex）のセッションが「今何をしているか」を
リアルタイムに可視化するダッシュボード。3Dバーチャルオフィスと管制室リストの2ビューを持つ。

![status](https://img.shields.io/badge/phase-1-green)

## 仕組み

```
[Claude Code hooks] ──┐
                      ├─→ collector (server.js, SSE) ─→ dashboard (index.html)
[Codex adapter (予定)]┘
```

- エージェントごとの**アダプタ**がイベントを共通形式に変換してコレクタに POST
- **コレクタ**がツール名を coding / reading / searching / running… のアクティビティに分類し、SSE でブラウザにプッシュ
- **UI** はエージェント非依存。セッション＝キャラクター／行として表示

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

## 2つのビュー

ヘッダーの「テーマ」ボタンで切り替え（選択は記憶される）。

### 🏢 バーチャルオフィス（既定）
夜のオフィスをローポリ3D（three.js）で描画。セッションはキャラクターとして
ドアから入室し、アクティビティに応じた場所へ歩いていく。使用中の机はデスクランプが灯る。

- **クリック** → 右下にセッション詳細パネル
- **ダブルクリック** → そのセッションの作業フォルダをエディタで前面化（後述）
- **承認待ち** のセッションは足元に赤いリングが脈打ち、吹き出しも赤くなる

### 🖥️ 管制室
1セッション=2行の高密度リスト。小さいウィンドウに置いて稼働数を一覧する用途。
クリック=詳細パネル / ダブルクリック=エディタ前面化 はオフィスと共通。

### アクティビティの種類（全10種）

| 状態 | 内容 | トリガー | オフィスでの居場所 |
|---|---|---|---|
| coding | コード編集 | Edit / Write / MultiEdit | 机（着席） |
| reading | 読む・探す | Read / Grep / Glob | ソファ |
| searching | Web検索 | WebSearch / WebFetch | 本棚の前 |
| running | 実行 | Bash / Skill | サーバーラック前 |
| delegating | 委任 | Agent / Task / Workflow | 前方右 |
| planning | タスク整理 | TodoWrite / TaskCreate | ホワイトボード前 |
| thinking | 考えている | ツール完了・プロンプト送信 | その場 |
| waiting | 承認待ち | Notification | 前方中央 |
| idle | 待機 | Stop | コーヒーマシン前 |
| ended | 終了 | SessionEnd | ドアから退出 |

## エディタで開く

ダッシュボードからセッションをダブルクリックすると、その作業フォルダ（cwd）を
エディタで前面化する。複数ウィンドウが並んでいても cwd を開いているウィンドウが選ばれる。

- エディタは自動検出：**起動中なら Zed → なければ VS Code**
- `EDITOR_APP="Zed"`（または `"Visual Studio Code"`）で固定も可
- リモートマシンのセッションは cwd が手元に無いため開けない（その旨を表示）

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

ブラウザタブだとバックグラウンド時に描画が間引かれるため、専用の WebView アプリを用意している
（コレクタも自動起動する）。ビルド後 `/Applications` にコピーすると Spotlight から起動できる。

```bash
./app/build.sh          # swiftc でビルド（Xcode プロジェクト不要）
open AgentOps.app
```

アイコンは `app/icon.png`（1024×1024 PNG）を置いて再ビルドすると自動で組み込まれる。

## 環境変数

| 変数 | 既定 | 用途 |
|---|---|---|
| `PORT` | `4820` | コレクタのポート |
| `BIND` | `127.0.0.1` | 待受アドレス（LAN公開は `0.0.0.0`） |
| `AGENT_DASH_URL` | `http://127.0.0.1:4820` | hook の送信先（リモート側で使用） |
| `EDITOR_APP` | 自動検出 | 「エディタで開く」で使うアプリ |

## ファイル構成

| ファイル | 役割 |
|---|---|
| `server.js` | コレクタ。イベント受信・分類・SSE配信・エディタ起動 |
| `assets/office.js` | 3Dバーチャルオフィス（three.js） |
| `index.html` | ダッシュボード UI（2ビュー・詳細パネル・Feedドロワー） |
| `hooks/claude-hook.sh` | Claude Code hook → コレクタ転送スクリプト |
| `install.sh` | hooks 登録 + LaunchAgent セットアップ |
| `app/` | Mac アプリ（Swift WebView ラッパー + build.sh） |
| `hooks-snippet.json` | settings.json に貼る hooks 設定（手動で入れたい場合） |
| `events.jsonl` | イベント履歴（自動生成、git 管理外） |

## コレクタの API

| メソッド / パス | 用途 |
|---|---|
| `POST /ingest/claude` | Claude Code hook イベント受信 |
| `POST /ingest/generic` | 他エージェント用（共通形式で直接送信） |
| `GET /stream` | SSE 配信（snapshot + update） |
| `POST /focus-session` | セッションの cwd をエディタで開く |
| `POST /clear-session` | 1セッションを消す |
| `POST /clear` | 全消去 |

## ロードマップ

- [x] Phase 1: Claude Code 対応（hooks → collector → SSE dashboard）
- [x] 3Dバーチャルオフィス / 管制室リスト / 詳細パネル / エディタ遷移 / 承認待ち表示
- [x] Mac アプリ・マルチマシン対応（SSHトンネル / ホスト名区別）
- [ ] Phase 2: Codex アダプタ（`~/.codex/logs_2.sqlite` の tail）
- [ ] トークン消費・セッション履歴の集計ビュー
