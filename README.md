# agent-dashboard

AIコーディングエージェント（Claude Code / Codex）のセッションが「今何をしているか」を
リアルタイムに可視化するダッシュボード。3Dバーチャルオフィスと管制室リストの2ビューを持つ。

![status](https://img.shields.io/badge/phase-2-green)

## 仕組み

```
[Claude Code hooks]  ──┐
                       ├─→ collector (server.js, SSE) ─→ dashboard (index.html)
[Codex adapter]      ──┘
```

- エージェントごとの**アダプタ**がイベントを共通形式に変換してコレクタに POST
  - Claude Code: hooks が各イベントを直接 POST
  - Codex: `~/.codex` のセッション DB をポーリングするアダプタが POST
- **コレクタ**がツール名を coding / reading / searching / running… のアクティビティに分類し、SSE でブラウザにプッシュ
- **UI** はエージェント非依存。セッション＝キャラクター／行として表示
- セッションが「待ち」になると **macOS 通知**を出す（後述）

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
node が必要なのは**コレクタを動かすマシンだけ**（hooks 転送は curl のみで動く）。

## 3つのビュー

ヘッダーの「テーマ」ボタンで切り替え（選択は記憶される）。
横幅を取らずに常時眺めたいときは、これとは別に[デスクトップペット](#-デスクトップペット)がある。

### 🏢 バーチャルオフィス（既定）
夜のオフィスをローポリ3D（three.js）で描画。セッションはキャラクターとして
ドアから入室し、アクティビティに応じた場所へ歩いていく。使用中の机はデスクランプが灯る。

- **クリック** → 右下にセッション詳細パネル
- **ダブルクリック** → そのセッションの作業フォルダをエディタで前面化（後述）
- **承認待ち** のセッションは足元に赤いリングが脈打ち、吹き出しも赤くなる

### 🏙️ AIカンパニー
夜のオフィスビルにロボット社員。1セッション = 1ロボット = 1個室で、頭上のカード型
吹き出しにプロジェクト・状態・コンテキスト残量が出る。クリック=詳細パネル。

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

## 🤖 デスクトップペット

オフィスや管制室は横幅を取るので、**ロボット1体と吹き出しだけ**をデスクトップに常駐させる
モードを用意している。枠なし・背景透明・常に最前面の小さなウィンドウで、
稼働中セッションの吹き出しがロボットの頭上に段積みされる。

```bash
open -n -a AgentOps.app --args --pet     # ロボットだけを常駐（Dock アイコンなし）
```

- `-n`（新規インスタンス）が必要。付けないと、既に起動中の AgentOps が前面に出るだけで
  `--args` は届かない
- ダッシュボードを開いている場合は **⌘D**（メニュー →「デスクトップにロボットを置く」）が早い
- メニューバーのアイコンから 表示/非表示・**大きさ**・**カーソルのある画面に追従**・
  位置リセット・ダッシュボードを開く・終了
- **ロボットをドラッグ** → 位置を移動（次回起動時も同じ場所に出る）
- **⌥ + ロボットをドラッグ** → 無段階に拡大縮小（上へ引くと大きく）
- **吹き出しにカーソルを乗せると右上に ✕** が出る。押すとそのセッションを消す
  （ダッシュボードのカードの ✕ と同じ `/clear-session`）
- 吹き出し本体は見るだけ（クリックしても何も起きない）。エディタ前面化はダッシュボードのビューで
- **ロボットと ✕ 以外はクリックが背後のアプリに素通り**する。吹き出しの本文をクリックしても
  下のエディタに届く（WebView がマウスを受ける矩形だけを Swift に通知し、カーソル位置で
  `ignoresMouseEvents` を切り替えている。透過中は mouseover が届かないので、
  ホバー判定用にカーソル座標を Swift 側からページへ流し込んでいる）

### メニューバーのアイコン

既定は `app/menu-icon.png`（build.sh がバンドルの Resources へコピーする）。
テンプレート画像として扱うので**アルファチャンネルだけ**が意味を持ち、色は macOS が塗る
＝ライト/ダークのメニューバーに自動追従する。自作するときは
**背景を完全に透明**にし、図形は単色ベタで、18×18pt に縮めても読める太さにすること。

差し替えは下記（アプリの再起動で反映）。

```bash
defaults write dev.harusugi.agent-ops MenuIcon "🐧"            # 絵文字・短い文字列
defaults write dev.harusugi.agent-ops MenuIconSymbol "cpu"     # SF Symbols 名
defaults write dev.harusugi.agent-ops MenuIconFile ~/foo.png   # 画像ファイル
defaults write dev.harusugi.agent-ops MenuIconTemplate -bool false  # 単色化をやめて元の色で出す
```

優先順位は MenuIconFile > MenuIconSymbol > MenuIcon > 同梱の menu-icon.png。
元に戻すときは `defaults delete dev.harusugi.agent-ops MenuIcon…`。

吹き出しの並びは 承認待ち → 稼働中 → その他 の順で選び、**承認待ちが一番下**（ロボットの
すぐ上）に来る。縦に入りきらない分は「ほか N セッション」に畳まれる。

### 大きさ

窓は縦横比 3:5 のまま拡縮し、ロボットも文字も相似で大きくなる。表示できる吹き出しの数は
高さに合わせて自動で増減する（上限 8、`?max=N` で変更可）。設定は記憶される。

| プリセット | サイズ | 目安 |
|---|---|---|
| 小 | 264×440 | 端に置いて存在だけ確認 |
| 中（既定） | 360×600 | 吹き出し4件くらい |
| 大 | 456×760 | 離れた席からでも読める |
| 特大 | 552×920 | 吹き出し6件前後 |

拡縮は**下辺と左右中心を固定**して行うので、ロボットの立ち位置は動かない。

### 複数ディスプレイ / Space

- **Space（デスクトップ切替）** — `canJoinAllSpaces` 指定で全 Space に出る。他アプリの
  フルスクリーンにも重なる（`fullScreenAuxiliary`）
- **別のディスプレイ** — ウィンドウは1枚のディスプレイにしか存在できないので、置いた画面に
  留まる。別モニタで作業すると見えないのは仕様。追いかけさせたい場合のみ、メニューの
  「カーソルのある画面に追従」を有効にする（**既定 OFF**）。有効時はカーソルが別画面に
  0.1 秒留まると移動し、移動先でも画面右下からの距離を保つ。
  待ち時間は `defaults write dev.harusugi.agent-ops PetFollowDelay -float 0.3` で変更可

うまく出ないときは `~/Library/Logs/AgentOps-pet.log` を見る。表示時と Space 切替時と
画面追従時に、ウィンドウの座標・レベル・collectionBehavior を記録している。

ブラウザでも `http://localhost:4820/pet` で開ける（背景は透明のまま。`?checker` を付けると
市松模様で確認できる）。

| クエリ | 既定 | 用途 |
|---|---|---|
| `?max=N` | `8` | 吹き出しの上限（実際の数は窓の高さに入るだけ） |
| `?robot=expressive` | `worker` | ロボットを RobotExpressive（アニメ入り）に差し替え |
| `?checker` | — | 透明部分を市松模様で表示（デバッグ用） |

## エディタで開く

ダッシュボードからセッションをダブルクリックすると、その作業フォルダ（cwd）を
エディタで前面化する。複数ウィンドウが並んでいても cwd を開いているウィンドウが選ばれる。

- エディタは自動検出：**起動中なら Zed → なければ VS Code**
- `EDITOR_APP="Zed"`（または `"Visual Studio Code"`）で固定も可
- リモートマシンのセッションは cwd が手元に無いため開けない（その旨を表示）

## macOS 通知

セッションが稼働中から「待ち」（承認待ち / 応答待ち / 待機中）に遷移すると、
コレクタが macOS 通知を出す。リモートマシンのセッションも対象（判定はコレクタ側のため）。
`NOTIFY=0` でコレクタを起動すると無効化できる。

- 送信は `AgentOps.app --notify`（GUI を立てず通知だけ出すモード）経由。
  バンドルが無い環境では osascript にフォールバックする（送り主がスクリプトエディタ名義になる）
- **通知アイコンの制約**: macOS は通知アイコンを送信アプリの署名から解決するため、
  Apple 発行の証明書が無いと白い汎用アイコンになる（ad-hoc・自己署名では不可、検証済み）。
  直したい場合は Xcode + Apple ID（無料）で **Apple Development** 証明書を発行して
  `app/build.sh` を再実行するだけでよい（build.sh がその証明書を自動で優先する）

## Codex 対応

Codex は hooks を持たないため、CLI が書き出すセッション記録をポーリングするアダプタで対応する。

```bash
node adapters/codex-adapter.js   # コレクタと併せて起動（Mac アプリなら自動起動）
```

- `~/.codex/state_5.sqlite` の `threads` テーブルから稼働中セッション（cwd・title・tokens_used）を取得
- 各セッションの `rollout_path`（JSONL）末尾を読み、直近イベントをアクティビティに変換
  - 実データで確認済み: `task_started`→考えている / `task_complete`→待機中 / `message`→応答中
  - ツール系（`exec_command_begin`→実行中 / `patch_apply_begin`→編集中 / `web_search`→検索中）は Codex の標準イベント名にマップ
- `sqlite3` CLI を使うため追加依存なし。環境変数 `AGENT_DASH_URL` / `CODEX_DB` / `POLL_MS` で調整可

Codex CLI のセットアップ（API キー認証）:

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh   # インストール
echo "sk-..." | codex login --with-api-key             # 認証
```

## リモートマシンのセッションを見る

イベントには送信元ホスト名が付き、ダッシュボード上でマシンごとに区別される。

**SSH リバーストンネル（推奨）** — リモート側にも clone + `./install.sh` しておき、
トンネル付きで接続するだけ。リモートの `127.0.0.1:4820` が手元に転送される：

```bash
ssh -R 4820:localhost:4820 user@remote
```

リモートに必要なのは実質 `hooks/claude-hook.sh` と settings.json への登録だけなので、
clone できない環境では hook スクリプト1枚を scp して `install.sh` の登録処理だけ流してもよい
（node 不要、curl があれば動く。プロキシ環境でも `--noproxy` 付きなので影響なし）。
トンネルは ssh 接続中のみ有効で、切断中のイベントは届かない（hook は失敗無視）。

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
./app/build.sh                        # swiftc でビルド（Xcode プロジェクト不要）
open AgentOps.app                     # ダッシュボード
open -n -a AgentOps.app --args --pet  # デスクトップペットだけ（前述）
```

アイコンは `app/icon.png`（1024×1024 PNG）を置いて再ビルドすると自動で組み込まれる。

## 環境変数

| 変数 | 既定 | 用途 |
|---|---|---|
| `PORT` | `4820` | コレクタのポート |
| `BIND` | `127.0.0.1` | 待受アドレス（LAN公開は `0.0.0.0`） |
| `AGENT_DASH_URL` | `http://127.0.0.1:4820` | hook の送信先（リモート側で使用） |
| `EDITOR_APP` | 自動検出 | 「エディタで開く」で使うアプリ |
| `NOTIFY` | `1` | 「待ち」遷移時の macOS 通知（`0` で無効） |

## ファイル構成

| ファイル | 役割 |
|---|---|
| `server.js` | コレクタ。イベント受信・分類・SSE配信・エディタ起動・待ち通知 |
| `adapters/codex-adapter.js` | Codex セッションDBをポーリングして送信 |
| `assets/office.js` | 3Dバーチャルオフィス（three.js） |
| `assets/company.js` | AIカンパニー ビュー（three.js） |
| `assets/pet.js` | デスクトップペット（ロボット1体＋吹き出し。透明背景） |
| `index.html` | ダッシュボード UI（3ビュー・詳細パネル・Feedドロワー） |
| `pet.html` | デスクトップペットのページ（`/pet`） |
| `hooks/claude-hook.sh` | Claude Code hook → コレクタ転送スクリプト |
| `install.sh` | hooks 登録 + LaunchAgent セットアップ |
| `app/` | Mac アプリ（Swift WebView ラッパー + build.sh）。`icon.png`=アプリアイコン / `menu-icon.png`=メニューバー用の透過アイコン |
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
- [x] トークン / コンテキスト使用量ゲージ・サブエージェント表示
- [x] Phase 2: Codex アダプタ（`~/.codex` セッションDB + rollout のポーリング）
- [x] 「待ち」遷移時の macOS 通知
- [ ] セッション履歴の集計ビュー
